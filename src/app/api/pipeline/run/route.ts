import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { MAX_LIMIT, parseLimit } from "@/pipeline/limits";
import { runPipeline } from "@/pipeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The scheduled pipeline's entry point (PRD §6). Guarded by a bearer token.
 * An optional body `{ "scoreLimit": n, "draftLimit": n }` caps a manual/partial run.
 */
export async function POST(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let scoreLimit: number | undefined;
  let draftLimit: number | undefined;
  try {
    const body = (await request.json()) as { scoreLimit?: unknown; draftLimit?: unknown };
    scoreLimit = parseLimit(body?.scoreLimit, MAX_LIMIT);
    draftLimit = parseLimit(body?.draftLimit, MAX_LIMIT);
  } catch {
    // No/invalid body — cron triggers send none; fall back to the stage defaults.
  }

  try {
    const { runId, ingest, scoring, drafting, totals, notified } = await runPipeline({
      scoreLimit,
      draftLimit,
    });
    // `notified` was returned by runPipeline but dropped here, so a caller could never
    // tell whether the run notification actually went out.
    return NextResponse.json({ ok: true, runId, ingest, scoring, drafting, totals, notified });
  } catch (error) {
    // The run row is already closed as `failed` by runPipeline; this is the caller's copy.
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

/**
 * Constant-time compare. A plain `!==` leaks the shared secret a character at a time
 * to anyone who can measure the response.
 */
function authorized(request: Request): boolean {
  const secret = env.PIPELINE_TRIGGER_SECRET;
  if (!secret) return false; // Fail closed when unconfigured.

  const provided = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which is itself a (minor) leak; it is
  // unavoidable without hashing, and length alone gives an attacker very little.
  return a.length === b.length && timingSafeEqual(a, b);
}
