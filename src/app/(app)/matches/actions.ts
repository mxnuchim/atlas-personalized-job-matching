"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getOutreachForMatch, openOutreach, setOutreachStatus } from "@/db/queries/outreach";
import { log } from "@/lib/logger";
import { requireSession } from "@/lib/session";
import { runDraft } from "@/pipeline/drafting/draft";

/**
 * Actions on a single match, from the drawer (PRD §6: mutations are Server Actions).
 *
 * The drawer was read-only, which broke the flow exactly where it should pay off: you
 * read a compelling match, agree with it, and could do nothing but wait for the next
 * scheduled run — and only if it was `strong`, since that is all the drafter targets.
 */

const logger = log("matches");
const matchSchema = z.object({ matchId: z.uuid() });

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

/** Draft this role now, regardless of tier. */
export async function draftMatchAction(input: unknown): Promise<ActionResult> {
  await requireSession();

  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That match reference is not valid." };

  const summary = await runDraft({ matchId: parsed.data.matchId });

  if (summary.skipped) return { ok: false, error: summary.skipped };
  if (summary.drafted === 0) {
    const first = summary.errors[0]?.message;
    return { ok: false, error: first ?? "The model could not produce a grounded draft." };
  }

  logger.info({ matchId: parsed.data.matchId }, "drafted on demand");
  revalidatePath("/review");
  revalidatePath("/pipeline");
  return { ok: true, message: "Draft ready in Review." };
}

/**
 * Record that you applied. Moves the role to `sent` — Atlas never sends anything
 * itself, so this is you telling it what you did, which is what keeps the tracker
 * honest and clears the role out of tomorrow's queue.
 */
export async function markAppliedAction(input: unknown): Promise<ActionResult> {
  await requireSession();

  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That match reference is not valid." };

  await openOutreach(parsed.data.matchId);
  const row = await getOutreachForMatch(parsed.data.matchId);
  if (!row) return { ok: false, error: "Could not record that. Try again." };

  if (row.status !== "drafted") {
    return { ok: false, error: `This role is already ${row.status}.` };
  }

  const updated = await setOutreachStatus(row.id, "sent");
  if (!updated) return { ok: false, error: "Could not record that. Try again." };

  logger.info({ matchId: parsed.data.matchId }, "marked applied");
  revalidatePath("/today");
  revalidatePath("/pipeline");
  return { ok: true, message: "Tracked. It will not come back tomorrow." };
}

/**
 * Take a role off the table. Recorded as outreach at `closed` rather than a new
 * column: the funnel already has an ending, and one state machine per match is easier
 * to reason about than a dismissal flag sitting beside it.
 */
export async function dismissMatchAction(input: unknown): Promise<ActionResult> {
  await requireSession();

  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That match reference is not valid." };

  await openOutreach(parsed.data.matchId);
  const row = await getOutreachForMatch(parsed.data.matchId);
  if (!row) return { ok: false, error: "Could not record that. Try again." };

  if (row.status === "closed") return { ok: true, message: "Already closed." };

  const updated = await setOutreachStatus(row.id, "closed");
  if (!updated) return { ok: false, error: "Could not record that. Try again." };

  logger.info({ matchId: parsed.data.matchId }, "match dismissed");
  revalidatePath("/pipeline");
  revalidatePath("/matches");
  return { ok: true, message: "Closed. It stays in the pipeline as a record." };
}
