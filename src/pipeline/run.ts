import "server-only";

import { listDailyQueue } from "@/db/queries/matches";
import { failRun, finishRun, runStatusFor, startRun, type RunTotals } from "@/db/queries/runs";
import type { RunError } from "@/db/schema";
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
    const ingest = await runIngest();
    const scoring = await runScore(options.scoreLimit ? { limit: options.scoreLimit } : {});
    const drafting = await runDraft(options.draftLimit ? { limit: options.draftLimit } : {});

    const errors: RunError[] = [
      ...ingest.results
        .filter((r) => r.error)
        .map((r) => ({ stage: "ingest", message: `${r.source}: ${r.error}` })),
      ...scoring.errors.map((e) => ({ stage: "score", job_id: e.jobId, message: e.message })),
      ...drafting.errors,
      // A skipped stage is not an error, but it must be visible — otherwise a run that
      // silently did nothing looks identical to one with nothing to do.
      ...stageSkips({ scoring, drafting }),
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

    // The email reports exactly what the screen will show — the capped queue, not the
    // raw backlog. "276 roles ready" is the firehose this whole design exists to avoid.
    const queue = await listDailyQueue(env.DAILY_QUEUE_SIZE, env.MAX_PER_COMPANY);

    // After the run is durably recorded, never before: the `runs` row is the record,
    // the notification is a convenience, and `notifyRun` swallows its own failures so
    // an unreachable provider cannot fail a run that did its work.
    const { sent } = await notifyRun({
      newJobs: ingest.inserted,
      scored: scoring.scored,
      strong: scoring.strong,
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
