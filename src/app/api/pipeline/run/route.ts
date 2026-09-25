import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { runIngest } from "@/pipeline/ingest";
import { runScore } from "@/pipeline/scoring/score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The scheduled pipeline's entry point (PRD §6). Guarded by a bearer token from
 * the first commit. As of M2 it ingests new jobs then scores the unscored ones;
 * drafting and sending are layered on in later milestones. An optional body
 * `{ "scoreLimit": n }` caps scoring for a manual/partial run.
 */
export async function POST(request: Request) {
  const secret = env.PIPELINE_TRIGGER_SECRET;
  const provided = request.headers.get("authorization");

  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let scoreLimit: number | undefined;
  try {
    const body = (await request.json()) as { scoreLimit?: unknown };
    if (typeof body?.scoreLimit === "number" && body.scoreLimit > 0) {
      scoreLimit = Math.floor(body.scoreLimit);
    }
  } catch {
    // No/invalid body — cron triggers send none; fall back to the default cap.
  }

  const logger = log("pipeline");
  const startedAt = Date.now();

  try {
    const ingest = await runIngest();
    const scoring = await runScore(scoreLimit ? { limit: scoreLimit } : {});
    logger.info({ ingest, scoring, ms: Date.now() - startedAt }, "pipeline run complete");
    return NextResponse.json({ ok: true, ran: true, ingest, scoring });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "pipeline run failed");
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
