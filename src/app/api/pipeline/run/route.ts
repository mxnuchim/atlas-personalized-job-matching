import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { env } from "@/lib/env";
import { runPipeline } from "@/pipeline/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Caps a caller-supplied limit so a stray value cannot start an unbounded run.
 *
 * Raised from 200 once ingest covered 66 boards: the first multi-source run left
 * ~4,000 relevant postings unscored, and a ceiling of 200 made draining that backlog
 * impossible rather than merely slow. Scheduled runs are unaffected — they send no
 * body and use the stage default of 50, so the cost of the twice-daily run is
 * unchanged. This ceiling only bounds a backfill someone asked for on purpose.
 */
const MAX_LIMIT = 1000;

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
    scoreLimit = positiveLimit(body?.scoreLimit);
    draftLimit = positiveLimit(body?.draftLimit);
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

function positiveLimit(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.floor(value), MAX_LIMIT);
}
