"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  canDecide,
  canEdit,
  decideDraft,
  getDraft,
  saveDraftEdit,
  setDraftRecipient,
} from "@/db/queries/drafts";
import { log } from "@/lib/logger";
import { requireSession } from "@/lib/session";
import { recipientSchema } from "@/lib/sending/guardrails";

import { sendDraft } from "./send";

/**
 * Review-queue mutations (PRD §6: mutations are Server Actions). Every one checks the
 * session server-side — hiding a button is not authorisation.
 *
 * Nothing here sends. Approval marks a draft ready; M4 owns delivery and the §11
 * guardrails that gate it.
 */

const logger = log("review");

const idSchema = z.object({ draftId: z.uuid() });
const editSchema = z.object({
  draftId: z.uuid(),
  // Generous, but bounded: the column is unbounded text and this is a short email.
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
  await requireSession();

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That draft reference is not valid." };

  const existing = await getDraft(parsed.data.draftId);
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
  await requireSession();

  const parsed = editSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That edit is not valid." };
  }

  const existing = await getDraft(parsed.data.draftId);
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

const recipientInput = z.object({
  draftId: z.uuid(),
  // Empty clears it. §11 requires a verified recipient, and a blank field is an honest
  // "not known yet" — far better than a guess that bounces.
  recipient: z.string().trim(),
});

export async function setRecipientAction(input: unknown): Promise<ActionResult> {
  await requireSession();

  const parsed = recipientInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That draft reference is not valid." };

  const { draftId, recipient } = parsed.data;
  if (recipient.length > 0) {
    const valid = recipientSchema.safeParse(recipient);
    if (!valid.success) {
      return { ok: false, error: valid.error.issues[0]?.message ?? "That address is not valid." };
    }
  }

  const existing = await getDraft(draftId);
  if (!existing) return { ok: false, error: "That draft no longer exists." };
  if (existing.status === "sent") {
    return { ok: false, error: "This draft was already sent; its recipient is fixed." };
  }

  await setDraftRecipient(draftId, recipient.length > 0 ? recipient : null);
  logger.info({ draftId, cleared: recipient.length === 0 }, "recipient set");
  revalidatePath("/review");
  return { ok: true };
}

export type SendActionResult =
  { ok: true; dryRun: boolean } | { ok: false; error: string; blockedBy?: string[] };

/**
 * Send an approved draft. Every §11 guardrail is re-evaluated inside `sendDraft`,
 * immediately before delivery — the readout the UI rendered could be seconds stale,
 * and the daily cap in particular moves underneath it.
 */
export async function sendDraftAction(input: unknown): Promise<SendActionResult> {
  await requireSession();

  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That draft reference is not valid." };

  const result = await sendDraft(parsed.data.draftId);

  revalidatePath("/review");
  revalidatePath("/pipeline");
  revalidatePath("/today");
  return result;
}
