import { z } from "zod";

import type { Draft } from "@/db/schema";

import { effectiveDailyCap } from "./warmup";

/**
 * The §11 deliverability guardrails, as one pure decision.
 *
 * Kept free of database and network access on purpose: this is the rule that decides
 * whether a real email leaves, so it must be exhaustively testable without mocking
 * anything. The caller gathers the facts; this decides.
 *
 * Every check reports itself even when it passes, because the review queue shows the
 * whole readout — a guardrail you cannot see is one you stop trusting.
 */

export const recipientSchema = z.email("That does not look like an email address.");

/** §11 thresholds. Exceeding either means throttling, not "keep going and watch". */
export const MAX_BOUNCE_RATE = 0.02;
export const MAX_COMPLAINT_RATE = 0.001;
/** Below this many sends a rate is noise, not signal. */
export const MIN_SENDS_FOR_RATE = 20;

export type GuardrailId =
  | "approved"
  | "not-already-sent"
  | "recipient"
  | "identity"
  | "daily-cap"
  | "warmup"
  | "bounce-rate"
  | "complaint-rate"
  | "reply-suppression"
  | "auto-send";

export type Guardrail = {
  id: GuardrailId;
  label: string;
  /** `false` stops the send. Advisory rows are shown but never block. */
  blocking: boolean;
  status: "pass" | "fail" | "unknown";
};

export type SendFacts = {
  draftStatus: Draft["status"];
  recipient: string | null;
  /** The alias sends come from. §11: never the primary address. */
  sendingAddress: string | null;
  /** The account Atlas logs in with — the address §11 says not to send from. */
  primaryAddress: string | null;
  gmailConfigured: boolean;
  autoSend: boolean;
  configuredCap: number;
  sentToday: number;
  firstSentAt: Date | null;
  /** Null when bounces are not yet monitored — reported as unknown, never as zero. */
  bounces: number | null;
  complaints: number | null;
  totalSent: number;
  /** True once anyone replied on this thread. §11: stop all further contact. */
  hasReplied: boolean;
  now?: Date;
};

export type SendDecision = {
  allowed: boolean;
  guardrails: Guardrail[];
  /** Labels of the blocking checks that failed, for the error message. */
  blockedBy: string[];
  effectiveCap: number;
  warming: boolean;
};

export function evaluateSend(facts: SendFacts): SendDecision {
  const { cap, warming, day } = effectiveDailyCap({
    configuredCap: facts.configuredCap,
    firstSentAt: facts.firstSentAt,
    now: facts.now,
  });

  const recipientValid =
    facts.recipient !== null && recipientSchema.safeParse(facts.recipient).success;

  const guardrails: Guardrail[] = [
    {
      id: "approved",
      label:
        facts.draftStatus === "approved"
          ? "Approved by you"
          : `Draft is ${facts.draftStatus} — approve it first`,
      blocking: true,
      status: facts.draftStatus === "approved" ? "pass" : "fail",
    },
    {
      id: "not-already-sent",
      label: facts.draftStatus === "sent" ? "Already sent" : "Not sent yet",
      blocking: true,
      status: facts.draftStatus === "sent" ? "fail" : "pass",
    },
    {
      id: "recipient",
      label: recipientValid
        ? `Recipient ${facts.recipient}`
        : facts.recipient === null
          ? "No recipient — add one before sending"
          : "Recipient is not a valid address",
      blocking: true,
      status: recipientValid ? "pass" : "fail",
    },
    identityGuardrail(facts),
    {
      id: "daily-cap",
      label: `${facts.sentToday} of ${cap} sent today`,
      blocking: true,
      status: facts.sentToday < cap ? "pass" : "fail",
    },
    {
      id: "warmup",
      label: warming
        ? `Warming up${day ? ` — day ${day}` : ", not started"}, capped at ${cap}/day`
        : "Identity warmed up",
      // Advisory: the ramp already constrains the cap above, so this only explains it.
      blocking: false,
      status: "pass",
    },
    rateGuardrail({
      id: "bounce-rate",
      name: "Bounce",
      count: facts.bounces,
      total: facts.totalSent,
      max: MAX_BOUNCE_RATE,
    }),
    rateGuardrail({
      id: "complaint-rate",
      name: "Complaint",
      count: facts.complaints,
      total: facts.totalSent,
      max: MAX_COMPLAINT_RATE,
    }),
    {
      id: "reply-suppression",
      label: facts.hasReplied
        ? "They already replied — no further contact"
        : "No reply on this thread yet",
      blocking: true,
      status: facts.hasReplied ? "fail" : "pass",
    },
    {
      id: "auto-send",
      label: facts.autoSend ? "Auto-send ON — every send still needs approval" : "Auto-send off",
      blocking: false,
      status: "pass",
    },
  ];

  // `unknown` never blocks: an unmeasurable rate is a gap in observability, not
  // evidence of a problem. It is surfaced so the gap is visible.
  const blockedBy = guardrails.filter((g) => g.blocking && g.status === "fail").map((g) => g.label);

  return { allowed: blockedBy.length === 0, guardrails, blockedBy, effectiveCap: cap, warming };
}

/**
 * §11 requires a separate sending identity. Sending from the address you actually job
 * hunt with puts your real inbox's reputation behind every cold email.
 */
function identityGuardrail(facts: SendFacts): Guardrail {
  if (!facts.gmailConfigured || !facts.sendingAddress) {
    return {
      id: "identity",
      label: "Gmail not connected — connect a sending identity",
      blocking: true,
      status: "fail",
    };
  }

  const sameAsPrimary =
    facts.primaryAddress !== null &&
    facts.sendingAddress.toLowerCase() === facts.primaryAddress.toLowerCase();

  if (sameAsPrimary) {
    return {
      id: "identity",
      label: "Sending address is your primary account — use a separate alias",
      blocking: true,
      status: "fail",
    };
  }

  return {
    id: "identity",
    label: `Sending as ${facts.sendingAddress}`,
    blocking: true,
    status: "pass",
  };
}

function rateGuardrail(params: {
  id: GuardrailId;
  name: string;
  count: number | null;
  total: number;
  max: number;
}): Guardrail {
  const { id, name, count, total, max } = params;

  if (count === null) {
    return {
      id,
      label: `${name} rate not monitored yet`,
      blocking: false,
      status: "unknown",
    };
  }

  if (total < MIN_SENDS_FOR_RATE) {
    return {
      id,
      label: `${name} rate — too few sends to judge (${total})`,
      blocking: false,
      status: "unknown",
    };
  }

  const rate = count / total;
  return {
    id,
    label: `${name} rate ${(rate * 100).toFixed(2)}% of ${total}`,
    blocking: true,
    status: rate < max ? "pass" : "fail",
  };
}
