import { describe, expect, it } from "vitest";

import { buildMessage, buildWebhookRequest, type RunNotification } from "./notify";

function run(overrides: Partial<RunNotification> = {}): RunNotification {
  return {
    newJobs: 0,
    scored: 0,
    strong: 0,
    drafted: 0,
    errors: 0,
    costUsd: 0,
    status: "ok",
    appUrl: "https://atlas.test",
    ...overrides,
  };
}

describe("buildMessage", () => {
  it("leads with strong matches — that is the day's headline", () => {
    const message = buildMessage(run({ scored: 12, strong: 3, drafted: 3, newJobs: 12 }));
    expect(message).toMatch(/^Atlas: 3 strong matches, 3 drafts ready, 12 new postings/);
  });

  it("links to Today so the message is actionable", () => {
    expect(buildMessage(run({ scored: 4, strong: 1 }))).toContain("https://atlas.test/today");
  });

  it("says plainly when there is nothing to review", () => {
    // An empty run is the common case and must not read as a failure.
    expect(buildMessage(run())).toBe("Atlas ran. Nothing new to review.");
  });

  it("does not claim strong matches when the scoring found none", () => {
    expect(buildMessage(run({ scored: 9 }))).toMatch(/9 scored, none strong/);
  });

  it("reports errors on an otherwise empty run", () => {
    expect(buildMessage(run({ errors: 2 }))).toBe(
      "Atlas run finished with 2 errors and nothing new.",
    );
  });

  it("appends errors and cost as a parenthetical, not as the headline", () => {
    const message = buildMessage(
      run({ scored: 6, strong: 2, drafted: 2, errors: 1, costUsd: 0.0731 }),
    );
    expect(message).toContain("(1 error, $0.073)");
  });

  it("omits cost when it is zero or unknown", () => {
    expect(buildMessage(run({ scored: 4, strong: 1, costUsd: 0 }))).not.toContain("$");
    expect(buildMessage(run({ scored: 4, strong: 1, costUsd: null }))).not.toContain("$");
  });

  it.each([
    [1, "1 strong match,"],
    [2, "2 strong matches,"],
  ])("pluralises for %i", (strong, expected) => {
    expect(buildMessage(run({ scored: 5, strong, drafted: 1 }))).toContain(expected);
  });
});

describe("buildWebhookRequest", () => {
  const message = "Atlas: 3 strong matches.";

  it("uses Slack's `text` key", () => {
    const req = buildWebhookRequest("https://hooks.slack.com/services/T/B/X", message);
    expect(JSON.parse(req.body)).toEqual({ text: message });
    expect(req.contentType).toBe("application/json");
  });

  it.each(["https://discord.com/api/webhooks/1/x", "https://discordapp.com/api/webhooks/1/x"])(
    "uses Discord's `content` key for %s",
    (url) => {
      expect(JSON.parse(buildWebhookRequest(url, message).body)).toEqual({ content: message });
    },
  );

  it("sends ntfy the raw message as the body", () => {
    const req = buildWebhookRequest("https://ntfy.sh/my-atlas-topic", message);
    expect(req.body).toBe(message);
    expect(req.contentType).toBe("text/plain");
  });

  it("sends every common key to an unknown endpoint", () => {
    // Guessing one key wrong means a silently empty message, which is the same as no
    // notification; an extra key is far more likely to be ignored.
    const req = buildWebhookRequest("https://hooks.example.com/atlas", message);
    expect(JSON.parse(req.body)).toEqual({ text: message, content: message, message });
  });

  it("does not throw on a malformed URL", () => {
    expect(() => buildWebhookRequest("not a url", message)).not.toThrow();
  });
});
