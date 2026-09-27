"use server";

import { revalidatePath } from "next/cache";

import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { requireSession } from "@/lib/session";
import { runPipeline } from "@/pipeline/run";

/**
 * Fetch new roles on demand, so you are not waiting on tomorrow's run.
 *
 * Two modes, because a pipeline run is roughly twelve minutes and that is far past
 * any serverless function ceiling:
 *
 *   - **Dispatched** (production): asks GitHub Actions to run it, and returns at once.
 *     The result arrives as the daily email, same as a scheduled run.
 *   - **Inline** (local dev, where nothing times out): runs it here and reports what
 *     it found, which is much faster to iterate against.
 *
 * The mode is decided by whether the dispatch credentials are configured rather than
 * by a flag, so there is no way to pick the one the environment cannot support.
 */
export type FetchResult =
  | { ok: true; mode: "dispatched" }
  | { ok: true; mode: "inline"; newJobs: number; scored: number; strong: number }
  | { ok: false; error: string };

export async function fetchNowAction(): Promise<FetchResult> {
  await requireSession();
  const logger = log("today");

  if (env.GITHUB_DISPATCH_TOKEN && env.GITHUB_REPO) {
    return dispatch(logger);
  }

  try {
    const { ingest, scoring } = await runPipeline({
      // Enough to refill the queue twice over, not the whole backlog: scoring runs at
      // about seven roles a minute and a button that takes an hour is not a button.
      scoreLimit: env.DAILY_QUEUE_SIZE * 2,
      // Drafting costs more per item than scoring, and the drawer can draft a single
      // role on demand — which is the only time it is actually wanted.
      draftLimit: 0,
    });

    revalidatePath("/today");
    revalidatePath("/jobs");
    return {
      ok: true,
      mode: "inline",
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

async function dispatch(logger: ReturnType<typeof log>): Promise<FetchResult> {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW_FILE}/dispatches`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "content-type": "application/json",
      },
      body: JSON.stringify({ ref: env.GITHUB_REF }),
      signal: AbortSignal.timeout(10_000),
    });

    // A dispatch returns 204 with no body. Anything else, GitHub explains in the body
    // — usually a missing scope or the wrong default branch, and a bare status code
    // would send you looking in the wrong place.
    if (response.status !== 204) {
      const detail = await response.text().catch(() => "");
      logger.warn({ status: response.status, detail: detail.slice(0, 200) }, "dispatch failed");
      return {
        ok: false,
        error: `GitHub returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`,
      };
    }

    logger.info({ repo: env.GITHUB_REPO }, "pipeline dispatched");
    return { ok: true, mode: "dispatched" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "dispatch failed");
    return { ok: false, error: message };
  }
}
