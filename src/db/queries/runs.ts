import { desc, eq, isNotNull } from "drizzle-orm";

import { db } from "@/db";
import { runs, type Run, type RunError } from "@/db/schema";

export type RunStatus = Run["status"];

/**
 * Open a run row immediately, before any work happens. Writing it up front rather
 * than at the end means a crashed or timed-out run still leaves evidence — a row with
 * no `finished_at` is exactly the signal you want on the Runs screen (PRD §12).
 */
export async function startRun(): Promise<string> {
  const [row] = await db.insert(runs).values({}).returning({ id: runs.id });
  if (!row) throw new Error("Failed to open a run row");
  return row.id;
}

export type RunTotals = {
  jobsSeen: number;
  newJobs: number;
  scored: number;
  drafted: number;
  tokensIn: number;
  tokensOut: number;
  /** `null` when any model used had no published price — unknown, not free. */
  costUsd: number | null;
  errors: RunError[];
  /** Source coverage — see the column comment on `runs`. */
  sourcesOk: number;
  sourcesTotal: number;
  status: RunStatus;
};

export async function finishRun(id: string, totals: RunTotals): Promise<void> {
  await db
    .update(runs)
    .set({
      finishedAt: new Date(),
      jobsSeen: totals.jobsSeen,
      newJobs: totals.newJobs,
      scored: totals.scored,
      drafted: totals.drafted,
      tokensIn: totals.tokensIn,
      tokensOut: totals.tokensOut,
      // numeric(10,4) is carried as a string by the driver to avoid float drift.
      costUsd: totals.costUsd === null ? "0" : totals.costUsd.toFixed(4),
      errors: totals.errors,
      sourcesOk: totals.sourcesOk,
      sourcesTotal: totals.sourcesTotal,
      status: totals.status,
    })
    .where(eq(runs.id, id));
}

/** Mark a run that threw before it could finish, so it is never left open. */
export async function failRun(id: string, message: string): Promise<void> {
  await db
    .update(runs)
    .set({
      finishedAt: new Date(),
      status: "failed",
      errors: [{ stage: "pipeline", message }],
    })
    .where(eq(runs.id, id));
}

export async function listRuns(limit = 50): Promise<Run[]> {
  return db.select().from(runs).orderBy(desc(runs.startedAt)).limit(limit);
}

/**
 * `ok` when nothing failed, `partial` when some work landed alongside errors, and
 * `failed` when errors occurred and nothing was produced.
 */
export function runStatusFor(params: { errors: RunError[]; produced: number }): RunStatus {
  if (params.errors.length === 0) return "ok";
  return params.produced > 0 ? "partial" : "failed";
}

/**
 * The most recent finished run, for the coverage banner. A run still in flight is not
 * evidence of anything yet, so it is skipped rather than reported as zero coverage.
 */
export async function getLastFinishedRun(): Promise<Run | null> {
  const [row] = await db
    .select()
    .from(runs)
    .where(isNotNull(runs.finishedAt))
    .orderBy(desc(runs.finishedAt))
    .limit(1);
  return row ?? null;
}
