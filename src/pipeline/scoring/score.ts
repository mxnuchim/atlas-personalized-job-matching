import "server-only";

import { db } from "@/db";
import { getUnscoredJobs } from "@/db/queries/matches";
import { getCurrentProfile } from "@/db/queries/profile";
import { matches, type Job } from "@/db/schema";
import {
  addUsage,
  emptyUsageTotals,
  generateStructured,
  isLlmError,
  LIMITS,
  mapWithConcurrency,
  MODELS,
  PROVIDER,
} from "@/lib/llm";
import { log } from "@/lib/logger";

import { buildJobContext, buildSystemPrompt } from "./prompt";
import { assessmentToMatch, buildAssessmentSchema } from "./schema";

/** Safety cap so an unattended run can't score an unbounded number of jobs. */
const DEFAULT_LIMIT = 50;

export type ScoreSummary = {
  scored: number;
  /** Of those scored this run, how many landed in the `strong` tier. */
  strong: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  /** `null` when any scored model has no published price (PRD §11, cost). */
  costUsd: number | null;
  model: string;
  provider: string;
  skipped?: string;
  errors: { jobId: string; message: string }[];
};

function emptySummary(): ScoreSummary {
  return {
    scored: 0,
    strong: 0,
    failed: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCached: 0,
    costUsd: 0,
    model: MODELS.scoring,
    provider: PROVIDER,
    errors: [],
  };
}

/**
 * Score every unscored job against the current profile (PRD §9). Per-job failures are
 * captured, not thrown, so one bad response can't sink a run. Idempotent against the
 * `(job_id, profile_version)` unique key — a re-run re-scores in place.
 *
 * The provider is whatever `@/lib/llm` resolves from env; nothing here knows or cares.
 */
export async function runScore({ limit = DEFAULT_LIMIT } = {}): Promise<ScoreSummary> {
  const logger = log("score");

  const profile = await getCurrentProfile();
  if (!profile) {
    return { ...emptySummary(), skipped: "No profile seeded — run db:seed:profile" };
  }

  const queue = await getUnscoredJobs(profile.version, limit);
  if (queue.length === 0) {
    return emptySummary();
  }

  const strengthKeys = profile.strengths.map((s) => s.key);
  const validStrengthKeys = new Set(strengthKeys);
  const schema = buildAssessmentSchema(strengthKeys);
  // Invariant across every job in this run — that is what makes it cacheable.
  const system = buildSystemPrompt(profile);

  const summary = emptySummary();
  let totals = emptyUsageTotals();

  const outcomes = await mapWithConcurrency(queue, LIMITS.maxConcurrency, async (job) => {
    try {
      const result = await scoreJob({
        job,
        schema,
        system,
        profileVersion: profile.version,
        validStrengthKeys,
      });
      return { ok: true as const, usage: result.usage, tier: result.tier };
    } catch (error) {
      const message = isLlmError(error)
        ? `${error.kind}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
      logger.error({ jobId: job.id, title: job.title, error: message }, "job scoring failed");
      return { ok: false as const, jobId: job.id, message };
    }
  });

  for (const outcome of outcomes) {
    if (outcome.ok) {
      summary.scored += 1;
      if (outcome.tier === "strong") summary.strong += 1;
      totals = addUsage(totals, outcome.usage);
    } else {
      summary.failed += 1;
      summary.errors.push({ jobId: outcome.jobId, message: outcome.message });
    }
  }

  summary.tokensIn = totals.inputTokens;
  summary.tokensOut = totals.outputTokens;
  summary.tokensCached = totals.cachedInputTokens;
  summary.costUsd = totals.costUsd;

  logger.info(
    {
      scored: summary.scored,
      failed: summary.failed,
      provider: summary.provider,
      model: summary.model,
      tokensIn: summary.tokensIn,
      tokensOut: summary.tokensOut,
      tokensCached: summary.tokensCached,
      costUsd: summary.costUsd,
    },
    "scoring complete",
  );
  return summary;
}

async function scoreJob(params: {
  job: Job;
  schema: ReturnType<typeof buildAssessmentSchema>;
  system: string;
  profileVersion: number;
  validStrengthKeys: Set<string>;
}) {
  const { job, schema, system, profileVersion, validStrengthKeys } = params;

  const { data: assessment, usage } = await generateStructured({
    schema,
    system,
    prompt: buildJobContext(job),
    model: MODELS.scoring,
  });

  const row = assessmentToMatch({
    jobId: job.id,
    profileVersion,
    assessment,
    model: usage.model,
    tokensIn: usage.inputTokens,
    tokensOut: usage.outputTokens,
    validStrengthKeys,
  });

  await db
    .insert(matches)
    .values(row)
    .onConflictDoUpdate({
      target: [matches.jobId, matches.profileVersion],
      set: {
        overall: row.overall,
        tier: row.tier,
        dimensions: row.dimensions,
        strengthMatches: row.strengthMatches,
        whyYou: row.whyYou,
        reasoning: row.reasoning,
        redFlags: row.redFlags,
        model: row.model,
        tokensIn: row.tokensIn,
        tokensOut: row.tokensOut,
        scoredAt: new Date(),
      },
    });

  return { usage, tier: row.tier };
}
