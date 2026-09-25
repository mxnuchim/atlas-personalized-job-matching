import "server-only";

import { getDraft, markDraftFailed, markDraftSent, setDraftRecipient } from "@/db/queries/drafts";
import { getSendStats, hasReplied, recordSend, repliedMatchIds } from "@/db/queries/outreach";
import { getCurrentProfile } from "@/db/queries/profile";
import type { Draft } from "@/db/schema";
import { env } from "@/lib/env";
import { isGmailConfigured, isGmailError, sendEmail } from "@/lib/gmail";
import { log } from "@/lib/logger";
import { evaluateSend, type SendDecision } from "@/lib/sending/guardrails";

const logger = log("send");

/**
 * Gather the facts the §11 guardrails need and evaluate them. Exported so the review
 * queue can render the same readout it will be judged against — the UI and the gate
 * must never be able to disagree.
 */
export async function assessSend(
  draftId: string,
): Promise<{ found: false } | { found: true; decision: SendDecision; recipient: string | null }> {
  const draft = await getDraft(draftId);
  if (!draft) return { found: false };

  const [stats, replied, profile] = await Promise.all([
    getSendStats(),
    hasReplied(draft.matchId),
    getCurrentProfile(),
  ]);

  const decision = evaluateSend({
    draftStatus: draft.status,
    recipient: draft.recipient,
    sendingAddress: env.SENDING_ADDRESS ?? null,
    // The account Atlas logs in with — §11 says do not send from it.
    primaryAddress: env.AUTH_USER_EMAIL ?? null,
    gmailConfigured: isGmailConfigured(),
    autoSend: env.AUTO_SEND,
    configuredCap: env.DAILY_SEND_CAP,
    sentToday: stats.sentToday,
    firstSentAt: stats.firstSentAt,
    bounces: stats.bounces,
    complaints: stats.complaints,
    totalSent: stats.totalSent,
    hasReplied: replied,
  });

  void profile;
  return { found: true, decision, recipient: draft.recipient };
}

/**
 * Evaluate a whole queue in one pass. The review screen renders these directly rather
 * than re-deriving anything client-side: the readout a person reads and the gate that
 * actually runs must be the same computation, or the UI will confidently promise a send
 * the server then refuses. (It did: the card showed the configured cap of 30 while the
 * warm-up ramp was enforcing 5.)
 */
export async function assessDrafts(
  drafts: { id: string; matchId: string; status: Draft["status"]; recipient: string | null }[],
): Promise<Record<string, SendDecision>> {
  if (drafts.length === 0) return {};

  // The expensive facts are shared across the whole queue; only reply state is per row.
  const [stats, profile, replied] = await Promise.all([
    getSendStats(),
    getCurrentProfile(),
    repliedMatchIds(drafts.map((d) => d.matchId)),
  ]);
  void profile;

  const shared = {
    sendingAddress: env.SENDING_ADDRESS ?? null,
    primaryAddress: env.AUTH_USER_EMAIL ?? null,
    gmailConfigured: isGmailConfigured(),
    autoSend: env.AUTO_SEND,
    configuredCap: env.DAILY_SEND_CAP,
    sentToday: stats.sentToday,
    firstSentAt: stats.firstSentAt,
    bounces: stats.bounces,
    complaints: stats.complaints,
    totalSent: stats.totalSent,
  };

  return Object.fromEntries(
    drafts.map((draft) => [
      draft.id,
      evaluateSend({
        ...shared,
        draftStatus: draft.status,
        recipient: draft.recipient,
        hasReplied: replied.has(draft.matchId),
      }),
    ]),
  );
}

export type SendOutcome =
  { ok: true; dryRun: boolean } | { ok: false; error: string; blockedBy?: string[] };

/**
 * Send one approved draft. The guardrails are re-evaluated here, immediately before
 * delivery — the readout the UI rendered could be seconds old, and the daily cap in
 * particular moves underneath it.
 */
export async function sendDraft(draftId: string): Promise<SendOutcome> {
  const draft = await getDraft(draftId);
  if (!draft) return { ok: false, error: "That draft no longer exists." };

  const assessment = await assessSend(draftId);
  if (!assessment.found) return { ok: false, error: "That draft no longer exists." };

  if (!assessment.decision.allowed) {
    return {
      ok: false,
      error: "This draft cannot be sent yet.",
      blockedBy: assessment.decision.blockedBy,
    };
  }

  const profile = await getCurrentProfile();

  try {
    const result = await sendEmail({
      from: env.SENDING_ADDRESS!,
      fromName: profile?.name ?? null,
      to: draft.recipient!,
      subject: draft.subject,
      // The edit wins when there is one; the generated body stays untouched on the row.
      body: draft.editedBody ?? draft.body,
      // Replies should reach the real inbox, not the sending alias.
      replyTo: env.AUTH_USER_EMAIL ?? null,
    });

    // Only mark sent after Gmail accepted it. The reverse order would record a send
    // that never happened, and reply detection would then wait forever.
    await markDraftSent(draftId);
    await recordSend({ matchId: draft.matchId });

    logger.info({ draftId, dryRun: result.dryRun }, "draft sent");
    return { ok: true, dryRun: result.dryRun };
  } catch (error) {
    const message = isGmailError(error) ? error.message : String(error);
    // `failed` is not terminal for the human: the draft stays visible and can be
    // retried once the cause is fixed.
    await markDraftFailed(draftId);
    logger.error({ draftId, error: message }, "send failed");
    return { ok: false, error: message };
  }
}

export { setDraftRecipient };
