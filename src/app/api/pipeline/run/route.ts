import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { log } from "@/lib/logger";
import { runIngest } from "@/pipeline/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The scheduled pipeline's entry point (PRD §6). Guarded by a bearer token from
 * the first commit. As of M1 it runs ingest across enabled sources; scoring and
 * drafting stages are layered on in later milestones.
 */
export async function POST(request: Request) {
  const secret = env.PIPELINE_TRIGGER_SECRET;
  const provided = request.headers.get("authorization");

  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const logger = log("pipeline");
  const startedAt = Date.now();

  try {
    const summary = await runIngest();
    logger.info({ ...summary, ms: Date.now() - startedAt }, "ingest complete");
    return NextResponse.json({ ok: true, ran: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "pipeline run failed");
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
