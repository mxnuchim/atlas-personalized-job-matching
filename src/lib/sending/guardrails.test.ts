import { describe, expect, it } from "vitest";

import { evaluateSend, MIN_SENDS_FOR_RATE, type SendFacts } from "./guardrails";

/** A draft that is clear to send. Each test breaks exactly one thing. */
function facts(overrides: Partial<SendFacts> = {}): SendFacts {
  return {
    draftStatus: "approved",
    recipient: "hiring@example.com",
    sendingAddress: "outreach@atlas.test",
    primaryAddress: "me@personal.test",
    gmailConfigured: true,
    autoSend: false,
    configuredCap: 30,
    sentToday: 0,
    // Warmed up, so the ramp is not the thing under test.
    firstSentAt: new Date(Date.UTC(2026, 0, 1)),
    now: new Date(Date.UTC(2026, 2, 1)),
    bounces: 0,
    complaints: 0,
    totalSent: 100,
    hasReplied: false,
    ...overrides,
  };
}

const idOf = (d: ReturnType<typeof evaluateSend>, id: string) =>
  d.guardrails.find((g) => g.id === id)!;

describe("evaluateSend — the happy path", () => {
  it("allows an approved draft that clears every check", () => {
    const decision = evaluateSend(facts());
    expect(decision.allowed).toBe(true);
    expect(decision.blockedBy).toEqual([]);
  });

  it("reports every guardrail even when they all pass", () => {
    // The review queue shows the whole readout; a guardrail you cannot see is one you
    // stop trusting.
    const decision = evaluateSend(facts());
    expect(decision.guardrails.map((g) => g.id)).toEqual([
      "approved",
      "not-already-sent",
      "recipient",
      "identity",
      "daily-cap",
      "warmup",
      "bounce-rate",
      "complaint-rate",
      "reply-suppression",
      "auto-send",
    ]);
  });
});

describe("human approval is mandatory (§11)", () => {
  it.each(["pending", "skipped", "failed"] as const)("refuses a %s draft", (draftStatus) => {
    const decision = evaluateSend(facts({ draftStatus }));
    expect(decision.allowed).toBe(false);
    expect(idOf(decision, "approved").status).toBe("fail");
  });

  it("refuses to send the same draft twice", () => {
    const decision = evaluateSend(facts({ draftStatus: "sent" }));
    expect(decision.allowed).toBe(false);
    expect(idOf(decision, "not-already-sent").status).toBe("fail");
  });

  it("does not let auto-send bypass approval", () => {
    // AUTO_SEND is advisory here by design: it can never turn a non-approved draft
    // into a sendable one.
    const decision = evaluateSend(facts({ autoSend: true, draftStatus: "pending" }));
    expect(decision.allowed).toBe(false);
    expect(idOf(decision, "auto-send").blocking).toBe(false);
  });
});

describe("recipient verification (§11)", () => {
  it("blocks when there is no recipient", () => {
    const decision = evaluateSend(facts({ recipient: null }));
    expect(decision.allowed).toBe(false);
    expect(idOf(decision, "recipient").label).toMatch(/No recipient/);
  });

  it.each(["not-an-email", "a@b", "@example.com", "person@", "person example.com"])(
    "blocks the malformed address %s",
    (recipient) => {
      expect(evaluateSend(facts({ recipient })).allowed).toBe(false);
    },
  );
});

describe("separate sending identity (§11)", () => {
  it("blocks when Gmail is not connected", () => {
    const decision = evaluateSend(facts({ gmailConfigured: false }));
    expect(decision.allowed).toBe(false);
    expect(idOf(decision, "identity").label).toMatch(/not connected/);
  });

  it("blocks sending from the primary account", () => {
    // The whole point of the rule: cold outreach must not put the real inbox's
    // reputation at risk.
    const decision = evaluateSend(
      facts({ sendingAddress: "me@personal.test", primaryAddress: "me@personal.test" }),
    );
    expect(decision.allowed).toBe(false);
    expect(idOf(decision, "identity").label).toMatch(/separate alias/);
  });

  it("compares addresses case-insensitively", () => {
    const decision = evaluateSend(
      facts({ sendingAddress: "Me@Personal.Test", primaryAddress: "me@personal.test" }),
    );
    expect(decision.allowed).toBe(false);
  });
});

describe("daily cap and warm-up (§11)", () => {
  it("blocks once today's cap is reached", () => {
    const decision = evaluateSend(facts({ sentToday: 30, configuredCap: 30 }));
    expect(decision.allowed).toBe(false);
    expect(idOf(decision, "daily-cap").label).toBe("30 of 30 sent today");
  });

  it("allows the last send under the cap", () => {
    expect(evaluateSend(facts({ sentToday: 29, configuredCap: 30 })).allowed).toBe(true);
  });

  it("enforces the ramp's cap, not the configured one, while warming", () => {
    const decision = evaluateSend(
      facts({
        configuredCap: 30,
        firstSentAt: new Date(Date.UTC(2026, 0, 1)),
        now: new Date(Date.UTC(2026, 0, 1)),
        sentToday: 5,
      }),
    );
    expect(decision.effectiveCap).toBe(5);
    expect(decision.warming).toBe(true);
    expect(decision.allowed).toBe(false);
  });

  it("treats a never-used identity as day one, not as warm", () => {
    const decision = evaluateSend(facts({ firstSentAt: null, sentToday: 5 }));
    expect(decision.effectiveCap).toBe(5);
    expect(decision.allowed).toBe(false);
  });
});

describe("bounce and complaint thresholds (§11)", () => {
  it("blocks when bounces reach 2%", () => {
    const decision = evaluateSend(facts({ bounces: 2, totalSent: 100 }));
    expect(decision.allowed).toBe(false);
    expect(idOf(decision, "bounce-rate").status).toBe("fail");
  });

  it("allows just under the bounce threshold", () => {
    expect(evaluateSend(facts({ bounces: 1, totalSent: 100 })).allowed).toBe(true);
  });

  it("blocks when complaints reach 0.1%", () => {
    const decision = evaluateSend(facts({ complaints: 1, totalSent: 1000 }));
    expect(decision.allowed).toBe(false);
    expect(idOf(decision, "complaint-rate").status).toBe("fail");
  });

  it("reports an unmonitored rate as unknown and does not block on it", () => {
    // A gap in observability is not evidence of a problem — but it must be visible
    // rather than rendered as a reassuring zero.
    const decision = evaluateSend(facts({ bounces: null, complaints: null }));
    expect(idOf(decision, "bounce-rate").status).toBe("unknown");
    expect(idOf(decision, "bounce-rate").label).toMatch(/not monitored/);
    expect(decision.allowed).toBe(true);
  });

  it("does not judge a rate on too few sends", () => {
    const decision = evaluateSend(facts({ bounces: 1, totalSent: MIN_SENDS_FOR_RATE - 1 }));
    expect(idOf(decision, "bounce-rate").status).toBe("unknown");
    expect(decision.allowed).toBe(true);
  });
});

describe("respect replies (§11)", () => {
  it("blocks all further contact once they have replied", () => {
    const decision = evaluateSend(facts({ hasReplied: true }));
    expect(decision.allowed).toBe(false);
    expect(idOf(decision, "reply-suppression").label).toMatch(/already replied/);
  });
});

describe("multiple failures", () => {
  it("reports every blocking failure, not just the first", () => {
    const decision = evaluateSend(
      facts({ draftStatus: "pending", recipient: null, hasReplied: true }),
    );
    expect(decision.allowed).toBe(false);
    expect(decision.blockedBy).toHaveLength(3);
  });
});
