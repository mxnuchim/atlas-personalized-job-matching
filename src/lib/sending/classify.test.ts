import { describe, expect, it } from "vitest";

import { classifyThread, extractAddress, isDaemonAddress, type ThreadMessage } from "./classify";

const SENT_AT = new Date("2026-09-20T10:00:00Z");
const SENDING = "outreach@atlas.test";

function msg(overrides: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: "m1",
    from: "Hiring <hiring@example.com>",
    subject: "Re: ai sdk",
    receivedAt: new Date("2026-09-21T09:00:00Z").getTime(),
    snippet: "Thanks for reaching out.",
    ...overrides,
  };
}

const classify = (messages: ThreadMessage[], sentMessageId?: string) =>
  classifyThread({ messages, sendingAddress: SENDING, sentAt: SENT_AT, sentMessageId });

describe("extractAddress", () => {
  it("pulls the address out of an angle-bracketed header", () => {
    expect(extractAddress("Hiring Team <hiring@example.com>")).toBe("hiring@example.com");
  });

  it("handles a bare address and normalises case", () => {
    expect(extractAddress("  Hiring@Example.COM ")).toBe("hiring@example.com");
  });
});

describe("isDaemonAddress", () => {
  it.each([
    "mailer-daemon@googlemail.com",
    "Mail Delivery Subsystem <MAILER-DAEMON@googlemail.com>",
    "postmaster@example.com",
    "mailer-daemon+bounce@corp.example",
  ])("recognises %s", (from) => {
    expect(isDaemonAddress(from)).toBe(true);
  });

  it.each(["hiring@example.com", "daemon.smith@example.com", "postmaster.jones@example.com"])(
    "does not mistake %s for a daemon",
    (from) => {
      // A person whose name merely starts with one of these must not be read as a bounce.
      expect(isDaemonAddress(from)).toBe(false);
    },
  );
});

describe("classifyThread", () => {
  it("is quiet when nothing came back", () => {
    expect(classify([]).kind).toBe("quiet");
  });

  it("detects a human reply", () => {
    const verdict = classify([msg()]);
    expect(verdict).toMatchObject({ kind: "replied", from: "hiring@example.com" });
  });

  it("ignores our own messages in the thread", () => {
    // A follow-up we sent is not someone replying to us.
    const verdict = classify([msg({ from: `Atlas <${SENDING}>` })]);
    expect(verdict.kind).toBe("quiet");
  });

  it("ignores our own send even when the ids collide on timestamp", () => {
    const verdict = classify([msg({ id: "sent-1", receivedAt: SENT_AT.getTime() + 1 })], "sent-1");
    expect(verdict.kind).toBe("quiet");
  });

  it("ignores anything at or before our send", () => {
    // Earlier messages in a thread are context, not a response.
    const verdict = classify([msg({ receivedAt: SENT_AT.getTime() - 1000 })]);
    expect(verdict.kind).toBe("quiet");
  });

  it("detects a bounce from the mail daemon", () => {
    const verdict = classify([
      msg({
        from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
        subject: "Delivery Status Notification (Failure)",
        snippet: "Address not found. Your message wasn't delivered to hiring@example.com",
      }),
    ]);
    expect(verdict).toMatchObject({ kind: "bounced" });
    if (verdict.kind === "bounced") expect(verdict.reason).toMatch(/Address not found/);
  });

  it("detects a bounce by subject when the sender is not a known daemon", () => {
    const verdict = classify([
      msg({ from: "Exchange <noreply@corp.example>", subject: "Undeliverable: ai sdk" }),
    ]);
    expect(verdict.kind).toBe("bounced");
  });

  it("prefers a bounce over a reply when both appear", () => {
    // The message never reached a person; treating it as contact would be wrong in the
    // direction that costs deliverability.
    const verdict = classify([
      msg({ id: "reply", receivedAt: new Date("2026-09-21T09:00:00Z").getTime() }),
      msg({
        id: "bounce",
        from: "mailer-daemon@googlemail.com",
        subject: "Delivery Status Notification (Failure)",
        receivedAt: new Date("2026-09-21T10:00:00Z").getTime(),
      }),
    ]);
    expect(verdict.kind).toBe("bounced");
  });

  it("takes the earliest reply when several arrive", () => {
    const verdict = classify([
      msg({
        id: "b",
        from: "second@example.com",
        receivedAt: new Date("2026-09-23T09:00:00Z").getTime(),
      }),
      msg({
        id: "a",
        from: "first@example.com",
        receivedAt: new Date("2026-09-21T09:00:00Z").getTime(),
      }),
    ]);
    expect(verdict).toMatchObject({ kind: "replied", from: "first@example.com" });
  });

  it("falls back to the subject when a bounce has no snippet", () => {
    const verdict = classify([
      msg({
        from: "mailer-daemon@googlemail.com",
        subject: "Returned mail: see transcript",
        snippet: "",
      }),
    ]);
    if (verdict.kind === "bounced") expect(verdict.reason).toBe("Returned mail: see transcript");
  });

  it("caps a very long bounce reason", () => {
    const verdict = classify([
      msg({ from: "mailer-daemon@googlemail.com", snippet: "x".repeat(1000) }),
    ]);
    if (verdict.kind === "bounced") expect(verdict.reason.length).toBeLessThanOrEqual(300);
  });
});
