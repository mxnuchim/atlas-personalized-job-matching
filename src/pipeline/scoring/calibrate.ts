import "@/db/_bootstrap";

import { listMatchRows } from "@/db/queries/matches";
import { getCurrentProfile, listProfileOwners } from "@/db/queries/profile";
import { isEvaluationConfigured, JEV_INPUT_USD_PER_MTOK } from "@/lib/llm";

import { scoreJobWithJev, type JevDimensions } from "./jev";

/**
 * The Jev calibration pass (the go/no-go before adopting it). Re-scores jobs that the
 * generative model already scored, and compares. For a rank-based tiering system the
 * headline metric is the RANK correlation of `overall` — if Jev orders jobs the way the
 * LLM does, the tiers will largely agree even where absolute numbers drift.
 *
 * Run: `npm run scoring:calibrate [sampleSize]`. Makes real Jev calls; costs a cent or two.
 */
const SAMPLE = Math.max(2, Number(process.argv[2] ?? 15));
const DIMENSION_KEYS: (keyof JevDimensions)[] = [
  "role_fit",
  "seniority_fit",
  "tech_fit",
  "location_fit",
  "company_fit",
];

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function mae(a: number[], b: number[]): number {
  return mean(a.map((x, i) => Math.abs(x - b[i])));
}

function pearson(a: number[], b: number[]): number {
  const ma = mean(a);
  const mb = mean(b);
  const cov = mean(a.map((x, i) => (x - ma) * (b[i] - mb)));
  const sa = Math.sqrt(mean(a.map((x) => (x - ma) ** 2)));
  const sb = Math.sqrt(mean(b.map((x) => (x - mb) ** 2)));
  return sa === 0 || sb === 0 ? 0 : cov / (sa * sb);
}

/** Average ranks (ties shared), then Pearson on the ranks — Spearman's ρ. */
function spearman(a: number[], b: number[]): number {
  const rank = (xs: number[]): number[] => {
    const order = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const ranks = new Array(xs.length).fill(0);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      const shared = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[order[k][1]] = shared;
      i = j + 1;
    }
    return ranks;
  };
  return pearson(rank(a), rank(b));
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Jev's upstream rate-limits bursts, so hold a steady gap between calls. */
const PACE_MS = 8_000;

async function scoreWithRetry(
  profile: NonNullable<Awaited<ReturnType<typeof getCurrentProfile>>>,
  job: Parameters<typeof scoreJobWithJev>[1],
  tries = 6,
) {
  for (let attempt = 1; attempt <= tries; attempt++) {
    try {
      return await scoreJobWithJev(profile, job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transient = /rate.?limit|429|high demand|experiencing high/i.test(message);
      if (transient && attempt < tries) {
        const backoff = 10_000 * attempt;
        console.info(`  … Jev busy, retry ${attempt}/${tries - 1} in ${backoff / 1000}s`);
        await delay(backoff);
        continue;
      }
      throw error;
    }
  }
  throw new Error("unreachable");
}

async function main() {
  if (!isEvaluationConfigured()) {
    console.error("AI_GATEWAY_API_KEY is not set — cannot reach Jev.");
    process.exit(1);
  }

  const [owner] = await listProfileOwners();
  if (!owner) {
    console.error("No profile owners — seed a profile first.");
    process.exit(1);
  }
  const profile = await getCurrentProfile(owner.userId);
  if (!profile) {
    console.error("No current profile for the first owner.");
    process.exit(1);
  }

  const rows = await listMatchRows(profile.id, SAMPLE);
  if (rows.length === 0) {
    console.error("No scored matches to calibrate against — run scoring first.");
    process.exit(1);
  }

  console.info(
    `Calibrating Jev against ${rows.length} LLM-scored jobs for ${owner.email} (profile ${profile.id}).\n`,
  );
  console.info("  LLM  Jev  tier      role");
  console.info("  ───  ───  ────────  ──────────────────────────────────");

  const llmOverall: number[] = [];
  const jevOverall: number[] = [];
  const dims: Record<string, { llm: number[]; jev: number[] }> = Object.fromEntries(
    DIMENSION_KEYS.map((k) => [k, { llm: [], jev: [] }]),
  );
  let inputTokens = 0;

  let first = true;
  for (const row of rows) {
    if (!first) await delay(PACE_MS);
    first = false;
    const jev = await scoreWithRetry(profile, {
      title: row.title,
      company: row.company,
      location: row.location,
      remote: row.remote,
      description: row.description,
    });

    llmOverall.push(row.overall);
    jevOverall.push(jev.overall);
    for (const key of DIMENSION_KEYS) {
      dims[key].llm.push(row.dimensions[key]);
      dims[key].jev.push(jev.dimensions[key]);
    }
    inputTokens += jev.inputTokens;

    console.info(
      `  ${String(row.overall).padStart(3)}  ${String(jev.overall).padStart(3)}  ${row.tier.padEnd(8)}  ${row.title.slice(0, 40)}`,
    );
  }

  const jevCost = (inputTokens / 1_000_000) * JEV_INPUT_USD_PER_MTOK;

  console.info("\n── Summary ─────────────────────────────────────────────");
  console.info(`  jobs                 ${rows.length}`);
  console.info(`  overall  Spearman ρ  ${spearman(llmOverall, jevOverall).toFixed(3)}   (rank agreement — the one that matters)`);
  console.info(`  overall  Pearson r   ${pearson(llmOverall, jevOverall).toFixed(3)}`);
  console.info(`  overall  MAE         ${mae(llmOverall, jevOverall).toFixed(1)} points`);
  for (const key of DIMENSION_KEYS) {
    console.info(`  ${key.padEnd(20)} MAE ${mae(dims[key].llm, dims[key].jev).toFixed(1)}`);
  }
  console.info(`\n  Jev input tokens     ${inputTokens} (${Math.round(inputTokens / rows.length)}/job)`);
  console.info(`  Jev cost             $${jevCost.toFixed(5)} total, $${(jevCost / rows.length).toFixed(6)}/job`);
  console.info(`  projected 2,000 jobs $${((jevCost / rows.length) * 2000).toFixed(3)} (Jev numbers only)`);
  process.exit(0);
}

main().catch((error) => {
  console.error("Calibration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
