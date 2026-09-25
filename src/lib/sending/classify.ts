/**
 * Deciding what happened to a sent message, from the other messages in its Gmail
 * thread. Pure and separately tested: getting this wrong either chases someone who
 * already replied (a §11 violation) or silently treats a bounce as success.
 */

export type ThreadMessage = {
  id: string;
  /** The `From` header, e.g. `Postmaster <mailer-daemon@googlemail.com>`. */
  from: string;
  subject: string;
  /** Epoch milliseconds. */
  receivedAt: number;
  /** First part of the body, used only to explain a bounce. */
  snippet: string;
};

export type ThreadVerdict =
  | { kind: "quiet" }
  | { kind: "replied"; at: Date; from: string }
  | { kind: "bounced"; at: Date; reason: string };

/**
 * Addresses that deliver delivery-status notifications rather than human replies.
 * Matched on the local part so it holds across `googlemail.com`, a company's own MTA,
 * and the `postmaster@` variants.
 */
const DAEMON_LOCAL_PARTS = ["mailer-daemon", "postmaster", "mail-daemon", "no-reply-delivery"];

/** Subjects Gmail and other MTAs use for a DSN when the sender is not a daemon. */
const BOUNCE_SUBJECTS =
  /^(undeliverable|undelivered mail|delivery status notification|mail delivery (failed|subsystem)|returned mail|failure notice)/i;

export function extractAddress(fromHeader: string): string {
  const angled = /<([^>]+)>/.exec(fromHeader);
  return (angled?.[1] ?? fromHeader).trim().toLowerCase();
}

function localPart(address: string): string {
  return address.split("@")[0] ?? "";
}

export function isDaemonAddress(fromHeader: string): boolean {
  const local = localPart(extractAddress(fromHeader));
  return DAEMON_LOCAL_PARTS.some((d) => local === d || local.startsWith(`${d}+`));
}

/**
 * Classify a thread relative to our own send.
 *
 * A bounce outranks a reply: if both somehow appear, the message did not reach the
 * person, and treating it as contact would be wrong in the direction that costs
 * deliverability.
 */
export function classifyThread(params: {
  messages: ThreadMessage[];
  /** The address Atlas sends from — its own messages are not replies. */
  sendingAddress: string;
  /** Our sent message; anything at or before it is not a response to it. */
  sentAt: Date;
  /** Our own message id, excluded even if the timestamps collide. */
  sentMessageId?: string;
}): ThreadVerdict {
  const { messages, sendingAddress, sentAt, sentMessageId } = params;
  const ours = sendingAddress.trim().toLowerCase();

  const candidates = messages
    .filter((m) => m.id !== sentMessageId)
    .filter((m) => m.receivedAt > sentAt.getTime())
    .sort((a, b) => a.receivedAt - b.receivedAt);

  const bounce = candidates.find(
    (m) => isDaemonAddress(m.from) || BOUNCE_SUBJECTS.test(m.subject.trim()),
  );
  if (bounce) {
    return {
      kind: "bounced",
      at: new Date(bounce.receivedAt),
      reason: bounce.snippet.trim().slice(0, 300) || bounce.subject.trim(),
    };
  }

  const reply = candidates.find((m) => extractAddress(m.from) !== ours);
  if (reply) {
    return { kind: "replied", at: new Date(reply.receivedAt), from: extractAddress(reply.from) };
  }

  return { kind: "quiet" };
}
