import { describe, expect, it } from "vitest";

import { assessmentSchema, assessmentToMatch, buildAssessmentSchema } from "./schema";

const assessment = {
  overall: 88,
  dimensions: {
    role_fit: 90,
    seniority_fit: 85,
    tech_fit: 92,
    location_fit: 70,
    company_fit: 95,
  },
  strength_matches: [
    { strength_key: "payments-fintech", rewarded: 95 },
    { strength_key: "invented-key", rewarded: 80 },
  ],
  why_you: "Deep payments experience across multiple fintechs.",
  reasoning: "Strong domain fit; location needs visa clarity.",
  red_flags: ["Visa sponsorship unconfirmed"],
};

describe("assessmentToMatch", () => {
  it("derives the tier from overall and drops unknown strength keys", () => {
    const row = assessmentToMatch({
      jobId: "job-1",
      profileId: "11111111-1111-4111-8111-111111111111",
      assessment: assessmentSchema.parse(assessment),
      model: "claude-sonnet-4-5",
      tokensIn: 1200,
      tokensOut: 300,
      validStrengthKeys: new Set(["payments-fintech", "ai-systems"]),
    });

    expect(row.tier).toBe("strong"); // 88 >= 85
    expect(row.overall).toBe(88);
    expect(row.strengthMatches).toEqual([{ strength_key: "payments-fintech", rewarded: 95 }]);
    expect(row.redFlags).toEqual(["Visa sponsorship unconfirmed"]);
    expect(row.model).toBe("claude-sonnet-4-5");
  });

  it("maps a mid score to the possible tier", () => {
    const row = assessmentToMatch({
      jobId: "job-2",
      profileId: "11111111-1111-4111-8111-111111111111",
      assessment: assessmentSchema.parse({ ...assessment, overall: 72 }),
      model: "m",
      tokensIn: null,
      tokensOut: null,
      validStrengthKeys: new Set(["payments-fintech"]),
    });
    expect(row.tier).toBe("possible");
  });
});

describe("assessmentSchema", () => {
  it("rejects out-of-range scores", () => {
    expect(() => assessmentSchema.parse({ ...assessment, overall: 130 })).toThrow();
  });
});

describe("buildAssessmentSchema", () => {
  it("constrains strength_key to the candidate's own keys", () => {
    const schema = buildAssessmentSchema(["payments-fintech", "ai-systems"]);

    const valid = {
      ...assessment,
      strength_matches: [{ strength_key: "ai-systems", rewarded: 80 }],
    };
    expect(schema.safeParse(valid).success).toBe(true);

    const invented = {
      ...assessment,
      strength_matches: [{ strength_key: "invented-key", rewarded: 80 }],
    };
    expect(schema.safeParse(invented).success).toBe(false);
  });

  it("falls back to a free string when the profile has no strengths yet", () => {
    const schema = buildAssessmentSchema([]);
    const row = { ...assessment, strength_matches: [{ strength_key: "anything", rewarded: 10 }] };
    expect(schema.safeParse(row).success).toBe(true);
  });
});
