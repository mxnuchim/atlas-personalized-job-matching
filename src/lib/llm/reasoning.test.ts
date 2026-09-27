import { describe, expect, it } from "vitest";

import { reasoningOptions } from "./client";

/**
 * Reasoning is billed as output, and output is 8x input on gpt-5-mini — measured at
 * ~3.6k in against ~2.1k out on real scoring calls, so roughly 90% of the bill was
 * the model thinking. This mapping is the lever on that.
 */
describe("reasoningOptions", () => {
  it("sends nothing when no effort is set, so the provider default stands", () => {
    expect(reasoningOptions(undefined)).toEqual({});
  });

  it("passes OpenAI its effort level verbatim", () => {
    for (const effort of ["minimal", "low", "medium", "high"] as const) {
      expect(reasoningOptions(effort).providerOptions?.openai).toEqual({
        reasoningEffort: effort,
      });
    }
  });

  it("translates effort into Google's thinking budget", () => {
    // Google takes a token budget rather than a level, and 0 disables thinking.
    expect(reasoningOptions("minimal").providerOptions?.google).toEqual({
      thinkingConfig: { thinkingBudget: 0 },
    });
    expect(reasoningOptions("high").providerOptions?.google).toEqual({
      thinkingConfig: { thinkingBudget: 16_384 },
    });
  });

  it("orders the budget the same way the effort levels are ordered", () => {
    const budget = (e: "minimal" | "low" | "medium" | "high") =>
      (reasoningOptions(e).providerOptions?.google as { thinkingConfig: { thinkingBudget: number } })
        .thinkingConfig.thinkingBudget;

    expect(budget("minimal")).toBeLessThan(budget("low"));
    expect(budget("low")).toBeLessThan(budget("medium"));
    expect(budget("medium")).toBeLessThan(budget("high"));
  });
});
