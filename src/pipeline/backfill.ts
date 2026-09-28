import "@/db/_bootstrap";

import { listProfileOwners } from "@/db/queries/profile";
import { MODELS, PROVIDER } from "@/lib/llm";

import { runScore } from "./scoring/score";

/**
 * One-time scoring backfill for a single user, run against whatever `DATABASE_URL` and
 * provider the environment selects. Separate from the scheduled pipeline: the cron is
 * capped at 50/run and iterates every owner, but a catch-up wants a high limit for one
 * person, and — to spend the prepaid Gateway credit rather than a direct key — often a
 * different provider than the daily default.
 *
 *   LLM_PROVIDER=gateway MODEL_SCORING=openai/gpt-5-mini \
 *     tsx --conditions=react-server src/pipeline/backfill.ts <emailSubstr> <limit>
 *
 * Idempotent: `runScore` only touches jobs with no match for the profile, so a re-run
 * resumes where it stopped.
 */
const EMAIL = process.argv[2] ?? "manuchim";
const LIMIT = Math.max(1, Number(process.argv[3] ?? 50));

async function main() {
  const owners = await listProfileOwners();
  const owner = owners.find((o) => o.email.includes(EMAIL)) ?? owners[0];
  if (!owner) {
    console.error("No profile owners.");
    process.exit(1);
  }

  console.info(
    `Backfill: ${owner.email} · provider=${PROVIDER} · model=${MODELS.scoring} · limit=${LIMIT}`,
  );
  const started = Date.now();
  const s = await runScore({ userId: owner.userId, limit: LIMIT });

  console.info(
    JSON.stringify(
      {
        scored: s.scored,
        strong: s.strong,
        failed: s.failed,
        skipped: s.skipped,
        tokensIn: s.tokensIn,
        tokensOut: s.tokensOut,
        tokensCached: s.tokensCached,
        costUsd: s.costUsd,
        model: s.model,
        provider: s.provider,
        minutes: ((Date.now() - started) / 60_000).toFixed(1),
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((error) => {
  console.error("Backfill failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
