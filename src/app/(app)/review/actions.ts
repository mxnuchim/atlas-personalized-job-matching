"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  canDecide,
  canEdit,
  decideDraft,
  getOwnedDraft,
  markDraftSent,
  saveDraftEdit,
} from "@/db/queries/drafts";
import { recordSend } from "@/db/queries/outreach";
import { log } from "@/lib/logger";
import { actingProfileId } from "@/lib/session";

/**
 * Review-queue mutations (PRD §6: mutations are Server Actions). Every one checks the
 * session server-side — hiding a button is not authorisation.
 *
 * Atlas does not send. It drafts, you copy, you send from your own mail client, and
 * you tell Atlas you did so it can track the thread. That keeps the human in the loop
 * by construction rather than by a flag, and removes every deliverability concern that
 * came with sending on your behalf.
 */

const logger = log("review");

const idSchema = z.object({ draftId: z.uuid() });
const editSchema = z.object({
  draftId: z.uuid(),
  editedBody: z.string().trim().min(1, "A draft cannot be empty.").max(4000),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function approveDraftAction(input: unknown): Promise<ActionResult> {
  return decide(input, "approved");
}

export async function skipDraftAction(input: unknown): Promise<ActionResult> {
  return decide(input, "skipped");
}

async function decide(input: unknown, status: "approved" | "skipped"): Promise<ActionResult> {
  const acting = await actingProfileId();
  if (!acting.ok) return { ok: false, error: acting.error };

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That draft reference is not valid." };

  const existing = await getOwnedDraft(parsed.data.draftId, acting.profileId);
  if (!existing) return { ok: false, error: "That draft no longer exists." };
  if (!canDecide(existing.status)) {
    return { ok: false, error: `This draft is already ${existing.status}.` };
  }

  const row = await decideDraft(parsed.data.draftId, status);
  if (!row) return { ok: false, error: "Could not save that decision. Try again." };

  logger.info({ draftId: row.id, status }, "draft decided");
  revalidatePath("/review");
  revalidatePath("/today");
  return { ok: true };
}

export async function saveDraftEditAction(input: unknown): Promise<ActionResult> {
  const acting = await actingProfileId();
  if (!acting.ok) return { ok: false, error: acting.error };

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That edit is not valid." };
  }

  const existing = await getOwnedDraft(parsed.data.draftId, acting.profileId);
  if (!existing) return { ok: false, error: "That draft no longer exists." };
  if (!canEdit(existing.status)) {
    return { ok: false, error: `This draft is already ${existing.status} and cannot be edited.` };
  }

  // Stored alongside the original, never over it — the generated text stays auditable.
  const row = await saveDraftEdit(parsed.data.draftId, parsed.data.editedBody);
  if (!row) return { ok: false, error: "Could not save that edit. Try again." };

  logger.info({ draftId: row.id }, "draft edited");
  revalidatePath("/review");
  return { ok: true };
}

/**
 * You sent it yourself; this records that so the role enters the pipeline tracker.
 * Atlas has no way to observe your mail client, so this is the only honest signal.
 */
export async function markSentAction(input: unknown): Promise<ActionResult> {
  const acting = await actingProfileId();
  if (!acting.ok) return { ok: false, error: acting.error };

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That draft reference is not valid." };

  const existing = await getOwnedDraft(parsed.data.draftId, acting.profileId);
  if (!existing) return { ok: false, error: "That draft no longer exists." };
  if (existing.status === "sent") return { ok: false, error: "Already marked as sent." };

  await markDraftSent(parsed.data.draftId);
  await recordSend({ matchId: existing.matchId });

  logger.info({ draftId: existing.id }, "marked sent by hand");
  revalidatePath("/review");
  revalidatePath("/pipeline");
  revalidatePath("/today");
  return { ok: true };
}
