import type { Outreach } from "@/db/schema";

/**
 * The outreach state machine, and how each stage reads.
 *
 * Deliberately *without* `server-only`: the pipeline tracker is a client island and
 * needs the same rules the server enforces, so offering an illegal move is impossible
 * rather than merely unlikely. Same arrangement as `lib/scoring.ts`. The type import
 * is erased at compile time, so nothing from `@/db` reaches the browser bundle.
 */

export type OutreachStatus = Outreach["status"];

/** The funnel, in the order it runs. */
export const FUNNEL_ORDER = [
  "drafted",
  "sent",
  // Sits where it happens — a bounce is a terminal failure of the send itself, not a
  // later stage of a conversation that started.
  "bounced",
  "replied",
  "interview",
  "offer",
  "rejected",
  "closed",
] as const satisfies readonly OutreachStatus[];

/**
 * Forgiving in one direction and strict in the other: `closed` is legal from anywhere,
 * because you can always walk away, and `bounced → sent` is legal because fixing an
 * address and resending is the normal repair. Everything else moves forward only — a
 * funnel that can go backwards stops being a record of what happened.
 */
const TRANSITIONS: Record<OutreachStatus, OutreachStatus[]> = {
  drafted: ["sent", "closed"],
  sent: ["replied", "bounced", "rejected", "closed"],
  bounced: ["sent", "closed"],
  replied: ["interview", "offer", "rejected", "closed"],
  interview: ["offer", "rejected", "closed"],
  offer: ["rejected", "closed"],
  rejected: ["closed"],
  closed: [],
};

export function canTransition(from: OutreachStatus, to: OutreachStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: OutreachStatus): OutreachStatus[] {
  return TRANSITIONS[from];
}

/** Where each stage sits: progress, a stop, or an ending. */
export const STAGE_TOKEN: Record<OutreachStatus, string> = {
  drafted: "--tier-stretch",
  sent: "--primary",
  bounced: "--destructive",
  replied: "--tier-strong",
  interview: "--tier-strong",
  offer: "--tier-strong",
  rejected: "--tier-stretch",
  closed: "--tier-stretch",
};

export const STAGE_LABEL: Record<OutreachStatus, string> = {
  drafted: "Drafted",
  sent: "Sent",
  bounced: "Bounced",
  replied: "Replied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  closed: "Closed",
};
