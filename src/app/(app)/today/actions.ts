"use server";

import { revalidatePath } from "next/cache";

import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { requireSession } from "@/lib/session";
import { runPipeline } from "@/pipeline/run";

/**
 * Fetch new roles on demand, so you are not waiting on tomorrow's cron.
 *
 * Scoring is the slow part — roughly seven roles a minute — so this deliberately
 * scores only enough to refill the queue twice over rather than the whole backlog.
 * A button that takes an hour is not a button.
 *
 * Drafting is skipped: it costs more per item than scoring and the drawer can draft
 * a single role on demand, which is the only time it is actually wanted.
 */
export type FetchResult =
  { ok: true; newJobs: number; scored: number; strong: number } | { ok: false; error: string };

export async function fetchNowAction(): Promise<FetchResult> {
  await requireSession();
  const logger = log("today");

  try {
    const { ingest, scoring } = await runPipeline({
      scoreLimit: env.DAILY_QUEUE_SIZE * 2,
      draftLimit: 0,
    });

    revalidatePath("/today");
    revalidatePath("/jobs");
    return {
      ok: true,
      newJobs: ingest.inserted,
      scored: scoring.scored,
      strong: scoring.strong,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "manual fetch failed");
    return { ok: false, error: message };
  }
}
