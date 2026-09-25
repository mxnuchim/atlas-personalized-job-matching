import { describe, expect, it } from "vitest";

import { estimateCostUsd, priceFor } from "./pricing";

describe("priceFor", () => {
  it("returns a price for a known model", () => {
    expect(priceFor("gemini-3.8-flash")).toEqual({
      input: 0.75,
      output: 3.75,
      cachedInput: 0.075,
    });
  });

  it("returns null for a model that is not in the table", () => {
    expect(priceFor("some-model-we-have-not-priced")).toBeNull();
  });
});

describe("estimateCostUsd", () => {
  it("prices input and output separately", () => {
    // 1M in @ $0.80 + 1M out @ $4.00 (Groq qwen)
    const cost = estimateCostUsd({
      model: "qwen/qwen3.8-27b",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBe(4.8);
  });

  it("bills cached input at the discounted rate and excludes it from full-price input", () => {
    // gemini-3.8-flash: 1M input of which 800k cached → 200k @ 0.75 + 800k @ 0.075
    const cost = estimateCostUsd({
      model: "gemini-3.8-flash",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 800_000,
    });
    expect(cost).toBeCloseTo(0.15 + 0.06, 6);
  });

  it("falls back to the full input rate when a provider does not price cache reads", () => {
    const cost = estimateCostUsd({
      model: "openai/gpt-oss-120b",
      inputTokens: 1_000_000,
      outputTokens: 0,
      cachedInputTokens: 1_000_000,
    });
    expect(cost).toBe(0.15);
  });

  it("returns null — never 0 — for an unpriced model, so cost reads as unknown", () => {
    const cost = estimateCostUsd({
      model: "llama-vnext-turbo",
      inputTokens: 500_000,
      outputTokens: 500_000,
    });
    expect(cost).toBeNull();
  });
});
