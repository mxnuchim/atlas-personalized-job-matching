import "server-only";

import { listDailyQueue } from "@/db/queries/matches";
import { getCurrentProfile, listProfileOwners } from "@/db/queries/profile";
import { failRun, finishRun, runStatusFor, startRun, type RunTotals } from "@/db/queries/runs";
import type { RunError } from "@/db/schema";
import { MODELS, PROVIDER } from "@/lib/llm";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { notifyRun } from "@/lib/notify";

import { runDraft, type DraftSummary } from "./drafting/draft";
import { runIngest, type IngestSummary } from "./ingest";
import { runScore, type ScoreSummary } from "./scoring/score";

/**
 * The pipeline, top to bottom (PRD §6/§8). A plain module the route handler invokes —
 * not a queue, not a worker.
 *
 * Every run opens a `runs` row before any work starts, so a crash or a timeout still
 * leaves evidence: a row with no `finished_at` is the signal, and that is only true if
 * the row exists before the work. Stage failures are recorded and the run continues;
 * only a throw ends it early, and even then the row is closed as `failed`.
 */
export type PipelineResult = {
  runId: string;
  ingest: IngestSummary;
  scoring: ScoreSummary;
  drafting: DraftSummary;
  totals: RunTotals;
  notified: boolean;
};

export async function runPipeline(
  options: { scoreLimit?: number; draftLimit?: number } = {},
): Promise<PipelineResult> {
  const logger = log("pipeline");
  const runId = await startRun();
  const startedAt = Date.now();

  try {
    // Ingest once. The job corpus is shared — every user is looking at the same
    // market, and fetching 66 boards per person would be waste, not isolation.
    const ingest = await runIngest();

    // Scoring and drafting are per profile: the same posting earns a different verdict
    // for each person. One user today, and the loop is what makes the second one a
    // configuration change rather than a rewrite.
    const owners = await listProfileOwners();
    const perUser: { userId: string; scoring: ScoreSummary; drafting: DraftSummary }[] = [];

    for (const owner of owners) {
      const scoring = await runScore({
        userId: owner.userId,
        ...(options.scoreLimit === undefined ? {} : { limit: options.scoreLimit }),
      });
      // `=== undefined`, never a truthiness check: a limit of 0 means "draft nothing",
      // and `0 ? … : {}` silently turned that into the stage default of 20.
      const drafting = await runDraft({
        userId: owner.userId,
        ...(options.draftLimit === undefined ? {} : { limit: options.draftLimit }),
      });
      perUser.push({ userId: owner.userId, scoring, drafting });
    }

    const scoring = mergeScoring(perUser.map((p) => p.scoring));
    const drafting = mergeDrafting(perUser.map((p) => p.drafting));

    const errors: RunError[] = [
      ...ingest.results
        .filter((r) => r.error)
        .map((r) => ({ stage: "ingest", message: `${r.source}: ${r.error}` })),
      ...perUser.flatMap((p) =>
        p.scoring.errors.map((e) => ({ stage: "score", job_id: e.jobId, message: e.message })),
      ),
      ...perUser.flatMap((p) => p.drafting.errors),
      // A skipped stage is not an error, but it must be visible — otherwise a run that
      // silently did nothing looks identical to one with nothing to do.
      ...perUser.flatMap((p) => stageSkips({ scoring: p.scoring, drafting: p.drafting })),
    ];

    const totals: RunTotals = {
      jobsSeen: ingest.seen,
      newJobs: ingest.inserted,
      scored: scoring.scored,
      drafted: drafting.drafted,
      tokensIn: scoring.tokensIn + drafting.tokensIn,
      tokensOut: scoring.tokensOut + drafting.tokensOut,
      costUsd: sumCost(scoring.costUsd, drafting.costUsd),
      errors,
      sourcesOk: ingest.sourcesOk,
      sourcesTotal: ingest.sourcesTotal,
      status: runStatusFor({
        errors,
        produced: ingest.inserted + scoring.scored + drafting.drafted,
      }),
    };

    await finishRun(runId, totals);

    // After the run is durably recorded, never before: the `runs` row is the record,
    // the email is a convenience, and `notifyRun` swallows its own failures so an
    // unreachable provider cannot fail a run that did its work.
    //
    // One email per user, each reporting their own queue — a shared summary would tell
    // you about roles you cannot see.
    let sent = false;
    for (const entry of perUser) {
      const profile = await getCurrentProfile(entry.userId);
      if (!profile) continue;
      const owner = owners.find((o) => o.userId === entry.userId);

      const queue = await listDailyQueue(profile.id, env.DAILY_QUEUE_SIZE, env.MAX_PER_COMPANY);
      const result = await notifyRun({
        to: owner?.email,
        newJobs: ingest.inserted,
        scored: entry.scoring.scored,
        strong: entry.scoring.strong,
        errors: errors.length,
        sourcesOk: ingest.sourcesOk,
        sourcesTotal: ingest.sourcesTotal,
        queued: queue.length,
        top: queue.slice(0, 5).map((m) => ({
          title: m.title,
          company: m.company,
          overall: m.overall,
          tier: m.tier,
        })),
        costUsd: totals.costUsd,
        appUrl: env.APP_URL,
      });
      sent = sent || result.sent;
    }

    logger.info(
      { runId, ...totals, notified: sent, ms: Date.now() - startedAt },
      "pipeline run complete",
    );

    return { runId, ingest, scoring, drafting, totals, notified: sent };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRun(runId, message);
    logger.error({ runId, error: message, ms: Date.now() - startedAt }, "pipeline run failed");
    throw error;
  }
}

function stageSkips(stages: { scoring: ScoreSummary; drafting: DraftSummary }): RunError[] {
  const skips: RunError[] = [];
  if (stages.scoring.skipped) skips.push({ stage: "score", message: stages.scoring.skipped });
  if (stages.drafting.skipped) skips.push({ stage: "draft", message: stages.drafting.skipped });
  return skips;
}

/** One unpriced model makes the whole run's cost unknown rather than understated. */
export function sumCost(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a + b;
}

/**
 * Fold each user's stage summary into one set of run totals.
 *
 * `model` and `provider` are taken from the first non-empty summary: they are the same
 * for every user in a run, since the model comes from env, not from the profile.
 */
function mergeScoring(parts: ScoreSummary[]): ScoreSummary {
  const merged: ScoreSummary = {
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

  for (const part of parts) {
    merged.scored += part.scored;
    merged.strong += part.strong;
    merged.failed += part.failed;
    merged.tokensIn += part.tokensIn;
    merged.tokensOut += part.tokensOut;
    merged.tokensCached += part.tokensCached;
    merged.costUsd = sumCost(merged.costUsd, part.costUsd);
    merged.errors.push(...part.errors);
    if (part.skipped && !merged.skipped) merged.skipped = part.skipped;
  }
  return merged;
}

function mergeDrafting(parts: DraftSummary[]): DraftSummary {
  const merged: DraftSummary = {
    drafted: 0,
    failed: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCached: 0,
    costUsd: 0,
    errors: [],
  };

  for (const part of parts) {
    merged.drafted += part.drafted;
    merged.failed += part.failed;
    merged.tokensIn += part.tokensIn;
    merged.tokensOut += part.tokensOut;
    merged.tokensCached += part.tokensCached;
    merged.costUsd = sumCost(merged.costUsd, part.costUsd);
    merged.errors.push(...part.errors);
    if (part.skipped && !merged.skipped) merged.skipped = part.skipped;
  }
  return merged;
}
