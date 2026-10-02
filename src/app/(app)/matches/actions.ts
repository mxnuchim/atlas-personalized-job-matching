"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getOwnedDraftByMatch } from "@/db/queries/drafts";
import { openOwnedOutreach, ownsMatch, setOutreachStatus } from "@/db/queries/outreach";
import { markResumeUsedForMatch } from "@/db/queries/resumes";
import { log } from "@/lib/logger";
import { actingProfileId, actingUserId, requireSession } from "@/lib/session";
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

export type ActionResult =
  | { ok: true; message?: string; draft?: { subject: string; body: string } }
  | { ok: false; error: string };

/** Draft this role now, regardless of tier. */
export async function draftMatchAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();
  const acting = await actingProfileId();
  if (!acting.ok) return { ok: false, error: acting.error };

  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That match reference is not valid." };

  // `runDraft` already scopes to this user's matches, so an id belonging to someone
  // else would produce nothing. Checking here anyway makes the refusal explicit and
  // the reason legible, rather than an empty result that reads like a model failure.
  if (!(await ownsMatch(parsed.data.matchId, acting.profileId))) {
    return { ok: false, error: "That match no longer exists." };
  }

  // A match can only have one draft. If it already has one — from a prior click or the
  // scheduled run — show that rather than refusing, which is what "already has a draft"
  // used to do. Re-clicking should surface the draft, not a dead end.
  const existing = await getOwnedDraftByMatch(parsed.data.matchId, acting.profileId);
  if (existing) {
    return {
      ok: true,
      message: "Here's your draft.",
      draft: { subject: existing.subject, body: existing.editedBody ?? existing.body },
    };
  }

  const summary = await runDraft({ userId: session.user.id, matchId: parsed.data.matchId });

  if (summary.skipped) return { ok: false, error: summary.skipped };
  if (summary.drafted === 0) {
    const first = summary.errors[0]?.message;
    return { ok: false, error: first ?? "The model could not produce a grounded draft." };
  }

  logger.info({ matchId: parsed.data.matchId }, "drafted on demand");
  revalidatePath("/review");
  revalidatePath("/pipeline");
  // Hand the content back so the drawer can show it inline and open Gmail — the draft is
  // also saved to Review, but the point is you see it now, not after navigating away.
  return { ok: true, message: "Draft ready.", draft: summary.draft };
}

/**
 * Record that you applied. Moves the role to `sent` — Atlas never sends anything
 * itself, so this is you telling it what you did, which is what keeps the tracker
 * honest and clears the role out of tomorrow's queue.
 */
export async function markAppliedAction(input: unknown): Promise<ActionResult> {
  const userId = await actingUserId();
  const acting = await actingProfileId();
  if (!acting.ok) return { ok: false, error: acting.error };

  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That match reference is not valid." };

  // "No such match" and "not yours" give the same answer on purpose — distinguishing
  // them would confirm that someone else's match exists.
  const row = await openOwnedOutreach(parsed.data.matchId, acting.profileId);
  if (!row) return { ok: false, error: "That match no longer exists." };

  if (row.status !== "drafted") {
    return { ok: false, error: `This role is already ${row.status}.` };
  }

  const updated = await setOutreachStatus(row.id, "sent");
  if (!updated) return { ok: false, error: "Could not record that. Try again." };

  // If you tailored a resume for this role, that's the version you sent — record it.
  await markResumeUsedForMatch(parsed.data.matchId, userId);

  logger.info({ matchId: parsed.data.matchId }, "marked applied");
  revalidatePath("/today");
  revalidatePath("/pipeline");
  revalidatePath("/resume");
  return { ok: true, message: "Tracked. It will not come back tomorrow." };
}

/**
 * Take a role off the table. Recorded as outreach at `closed` rather than a new
 * column: the funnel already has an ending, and one state machine per match is easier
 * to reason about than a dismissal flag sitting beside it.
 */
export async function dismissMatchAction(input: unknown): Promise<ActionResult> {
  const acting = await actingProfileId();
  if (!acting.ok) return { ok: false, error: acting.error };

  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That match reference is not valid." };

  // "No such match" and "not yours" give the same answer on purpose — distinguishing
  // them would confirm that someone else's match exists.
  const row = await openOwnedOutreach(parsed.data.matchId, acting.profileId);
  if (!row) return { ok: false, error: "That match no longer exists." };

  if (row.status === "closed") return { ok: true, message: "Already closed." };

  const updated = await setOutreachStatus(row.id, "closed");
  if (!updated) return { ok: false, error: "Could not record that. Try again." };

  logger.info({ matchId: parsed.data.matchId }, "match dismissed");
  revalidatePath("/pipeline");
  revalidatePath("/matches");
  return { ok: true, message: "Closed. It stays in the pipeline as a record." };
}
