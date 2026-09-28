import "@/db/_bootstrap";

import { listMatches } from "@/db/queries/matches";
import { getCurrentProfile, listProfileOwners } from "@/db/queries/profile";
import { estimateCostUsd, generateStructured } from "@/lib/llm";
import { fitTier } from "@/lib/scoring";

import { buildJobContext, buildSystemPrompt } from "./prompt";
import { buildAssessmentSchema } from "./schema";

/**
 * Scorer A/B: re-score jobs that already have stored (default-reasoning) scores, using
 * the SAME model at a lower reasoning effort, and compare. Reasoning bills as output and
 * is most of the cost, so this is the cheapest lever that keeps the corpus on one model.
 *
 * The headline metric is Spearman ρ on `overall` — tiers are rank-based, so if low
 * reasoning preserves the ordering, the tiers barely move even where absolute numbers do.
 *
 * Run: `npm run scoring:ab [reasoning=low] [n=10] [emailSubstr]`
 */
type Reasoning = "minimal" | "low" | "medium" | "high";
const REASONING = (process.argv[2] ?? "low") as Reasoning;
const N = Math.max(3, Number(process.argv[3] ?? 10));
const EMAIL = process.argv[4] ?? "manuchim";

const DIMS = ["role_fit", "seniority_fit", "tech_fit", "location_fit", "company_fit"] as const;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const mae = (a: number[], b: number[]) => mean(a.map((x, i) => Math.abs(x - b[i])));
function pearson(a: number[], b: number[]) {
  const ma = mean(a),
    mb = mean(b);
  const cov = mean(a.map((x, i) => (x - ma) * (b[i] - mb)));
  const sa = Math.sqrt(mean(a.map((x) => (x - ma) ** 2)));
  const sb = Math.sqrt(mean(b.map((x) => (x - mb) ** 2)));
  return sa && sb ? cov / (sa * sb) : 0;
}
function spearman(a: number[], b: number[]) {
  const rank = (xs: number[]) => {
    const order = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array(xs.length).fill(0);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      const shared = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[order[k][1]] = shared;
      i = j + 1;
    }
    return r;
  };
  return pearson(rank(a), rank(b));
}

async function main() {
  const owners = await listProfileOwners();
  const owner = owners.find((o) => o.email.includes(EMAIL)) ?? owners[0];
  if (!owner) {
    console.error("No profile owners.");
    process.exit(1);
  }
  const profile = await getCurrentProfile(owner.userId);
  if (!profile) {
    console.error("No profile for", owner.email);
    process.exit(1);
  }

  // Spread the sample across the whole score range (best-first order), not just the top
  // cluster — otherwise every job is ~88 and rank correlation is meaningless.
  const all = await listMatches(profile.id);
  if (all.length === 0) {
    console.error("No stored matches to compare against for", owner.email);
    process.exit(1);
  }
  const step = Math.max(1, Math.floor(all.length / N));
  const scored = Array.from({ length: N }, (_, i) => all[i * step]).filter(Boolean);

  const system = buildSystemPrompt(profile);
  const schema = buildAssessmentSchema(profile.strengths.map((s) => s.key));

  console.info(
    `A/B for ${owner.email}: gpt-5-mini @ reasoning="${REASONING}" vs stored default, ${scored.length} jobs.\n`,
  );
  console.info("  def  new  Δ    role");
  console.info("  ───  ───  ───  ──────────────────────────────────");

  const storedOverall: number[] = [];
  const newOverall: number[] = [];
  const dimErr: Record<string, number[]> = Object.fromEntries(DIMS.map((d) => [d, []]));
  let newIn = 0,
    newOut = 0,
    newCost = 0,
    storedIn = 0,
    storedOut = 0,
    storedCost = 0,
    tierAgree = 0;

  for (const m of scored) {
    const { data, usage } = await generateStructured({
      schema,
      system,
      prompt: buildJobContext(m.job),
      reasoningEffort: REASONING,
    });

    storedOverall.push(m.overall);
    newOverall.push(data.overall);
    for (const d of DIMS) dimErr[d].push(Math.abs(m.dimensions[d] - data.dimensions[d]));
    if (fitTier(m.overall) === fitTier(data.overall)) tierAgree++;

    newIn += usage.inputTokens;
    newOut += usage.outputTokens;
    newCost += usage.costUsd ?? 0;
    storedIn += m.tokensIn ?? 0;
    storedOut += m.tokensOut ?? 0;
    storedCost +=
      estimateCostUsd({
        model: m.model,
        inputTokens: m.tokensIn ?? 0,
        outputTokens: m.tokensOut ?? 0,
        cachedInputTokens: 0,
      }) ?? 0;

    const delta = data.overall - m.overall;
    console.info(
      `  ${String(m.overall).padStart(3)}  ${String(data.overall).padStart(3)}  ${(delta >= 0 ? "+" : "") + delta}`.padEnd(
        18,
      ) + `  ${m.job.title.slice(0, 40)}`,
    );
  }

  const n = scored.length;
  console.info("\n── Quality (new vs stored) ─────────────────────────────");
  console.info(`  overall Spearman ρ   ${spearman(storedOverall, newOverall).toFixed(3)}  ← rank agreement (the one that matters)`);
  console.info(`  overall Pearson r    ${pearson(storedOverall, newOverall).toFixed(3)}`);
  console.info(`  overall MAE          ${mae(storedOverall, newOverall).toFixed(1)} pts`);
  console.info(`  tier agreement       ${tierAgree}/${n}`);
  for (const d of DIMS) console.info(`  ${d.padEnd(16)} MAE  ${mean(dimErr[d]).toFixed(1)}`);

  console.info("\n── Cost / tokens per job ───────────────────────────────");
  console.info(`  stored (default)  in ${Math.round(storedIn / n)}  out ${Math.round(storedOut / n)}  $${(storedCost / n).toFixed(5)}`);
  console.info(`  new ("${REASONING}")      in ${Math.round(newIn / n)}  out ${Math.round(newOut / n)}  $${(newCost / n).toFixed(5)}`);
  const per = newCost / n;
  console.info(`\n  projected backfill 4,441 jobs @ "${REASONING}":  $${(per * 4441).toFixed(2)}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("A/B failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
