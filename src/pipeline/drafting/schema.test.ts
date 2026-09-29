import { describe, expect, it } from "vitest";

import { buildDraftGenerationSchema, draftGrounding, draftToRow, stripIdentifiers } from "./schema";

const evidenceOptions = [
  {
    id: "a8c730f3-9067-451d-ab0b-cfe0d215e7ff",
    strengthKey: "ai-systems",
    strengthLabel: "AI / ML systems integration",
    claim: "Built a Node.js orchestration layer",
    context: "BreezeLearn",
    metric: "250K+ inferences/day",
  },
];

const output = {
  subject: "typescript ai-sdk — inference orchestration",
  body: "I built an orchestration layer handling 250K+ daily requests.",
  evidence_id: "a8c730f3-9067-451d-ab0b-cfe0d215e7ff",
  strength_keys: ["ai-systems"],
};

describe("stripIdentifiers", () => {
  it("removes a parenthesised id the model copied into the prose", () => {
    // Verbatim from a real draft — this would have gone to a hiring manager.
    const body =
      "…at <400ms latency (id=a8c730f3-9067-451d-ab0b-cfe0d215e7ff). I've shipped Next.js frontends.";
    const cleaned = stripIdentifiers(body);
    expect(cleaned).not.toMatch(/a8c730f3/);
    expect(cleaned).not.toMatch(/id=/);
    expect(cleaned).toContain("at <400ms latency.");
    expect(cleaned).toContain("I've shipped Next.js frontends.");
  });

  it("removes a bare uuid with no id= prefix", () => {
    expect(stripIdentifiers("see a8c730f3-9067-451d-ab0b-cfe0d215e7ff here")).not.toMatch(
      /a8c730f3/,
    );
  });

  it("leaves a clean draft untouched", () => {
    const clean = "I built an orchestration layer handling 250K+ daily requests at <400ms.";
    expect(stripIdentifiers(clean)).toBe(clean);
  });

  it("does not eat legitimate hyphenated text or numbers", () => {
    const text = "Shipped a PCI-DSS compliant flow; 99.99% uptime across 10M+ transactions.";
    expect(stripIdentifiers(text)).toBe(text);
  });
});

describe("buildDraftGenerationSchema", () => {
  it("constrains evidence_id to the items actually offered", () => {
    const schema = buildDraftGenerationSchema({
      evidenceOptions,
      strengthKeys: ["ai-systems"],
    });
    expect(schema.safeParse(output).success).toBe(true);
    expect(
      schema.safeParse({ ...output, evidence_id: "11111111-1111-1111-1111-111111111111" }).success,
    ).toBe(false);
  });

  it("constrains strength_keys to the rewarded strengths", () => {
    const schema = buildDraftGenerationSchema({ evidenceOptions, strengthKeys: ["ai-systems"] });
    expect(schema.safeParse({ ...output, strength_keys: ["invented"] }).success).toBe(false);
  });
});

describe("draftToRow", () => {
  const valid = {
    validEvidenceIds: new Set(["a8c730f3-9067-451d-ab0b-cfe0d215e7ff"]),
    validStrengthKeys: new Set(["ai-systems"]),
    recipient: "maria.chen@acme.com" as string | null,
  };

  it("stores a grounded draft as pending with the recipient it was written for", () => {
    const row = draftToRow({ matchId: "m1", output, ...valid });
    expect(row.status).toBe("pending");
    // The address is persisted, not re-derived: a draft only exists because there was
    // one, so the review queue must not later disagree by re-reading the posting.
    expect(row.recipient).toBe("maria.chen@acme.com");
    expect(row.evidenceId).toBe("a8c730f3-9067-451d-ab0b-cfe0d215e7ff");
    expect(row.strengthKeys).toEqual(["ai-systems"]);
  });

  it("drops an invented evidence id rather than writing a dangling reference", () => {
    const row = draftToRow({
      matchId: "m1",
      output: { ...output, evidence_id: "22222222-2222-2222-2222-222222222222" },
      ...valid,
    });
    expect(row.evidenceId).toBeNull();
  });

  it("filters unknown strength keys", () => {
    const row = draftToRow({
      matchId: "m1",
      output: { ...output, strength_keys: ["ai-systems", "invented"] },
      ...valid,
    });
    expect(row.strengthKeys).toEqual(["ai-systems"]);
  });

  it("strips identifiers from what it stores", () => {
    const row = draftToRow({
      matchId: "m1",
      output: { ...output, body: "latency (id=a8c730f3-9067-451d-ab0b-cfe0d215e7ff) was low" },
      ...valid,
    });
    expect(row.body).not.toMatch(/a8c730f3/);
  });
});

describe("draftGrounding", () => {
  const base = { matchId: "m1", subject: "s", body: "b" };

  it("is grounded when it cites evidence and builds on a strength", () => {
    expect(draftGrounding({ ...base, evidenceId: "e1", strengthKeys: ["ai-systems"] })).toEqual({
      grounded: true,
    });
  });

  it("is not grounded without a real evidence citation", () => {
    // The whole point of the product — a draft with nothing real to cite is the
    // generic blurb it exists to avoid, so the run records it.
    const result = draftGrounding({ ...base, evidenceId: null, strengthKeys: ["ai-systems"] });
    expect(result.grounded).toBe(false);
    expect(result.reason).toMatch(/evidence/);
  });

  it("is not grounded when it builds on none of the rewarded strengths", () => {
    const result = draftGrounding({ ...base, evidenceId: "e1", strengthKeys: [] });
    expect(result.grounded).toBe(false);
    expect(result.reason).toMatch(/strengths/);
  });
});
