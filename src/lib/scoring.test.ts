import { describe, expect, it } from "vitest";

import { fitTier, TIER_LABELS, TIER_THRESHOLDS } from "./scoring";

describe("fitTier", () => {
  it("classifies strong at the threshold and above", () => {
    expect(fitTier(85)).toBe("strong");
    expect(fitTier(92)).toBe("strong");
    expect(fitTier(100)).toBe("strong");
  });

  it("classifies possible in the 65–84 band", () => {
    expect(fitTier(65)).toBe("possible");
    expect(fitTier(84)).toBe("possible");
  });

  it("classifies stretch below 65", () => {
    expect(fitTier(64)).toBe("stretch");
    expect(fitTier(0)).toBe("stretch");
  });

  it("covers every tier that has a label and a CSS token", () => {
    // The UI reads `--tier-${tier}` straight from these keys, so a tier without a
    // label is a tier that renders with no colour and no text.
    const tiers = new Set([fitTier(100), fitTier(70), fitTier(10)]);
    for (const tier of tiers) {
      expect(TIER_LABELS[tier]).toBeTruthy();
    }
    expect(Object.keys(TIER_LABELS).sort()).toEqual(["possible", "stretch", "strong"]);
  });

  it("leaves no gap between the bands", () => {
    expect(fitTier(TIER_THRESHOLDS.possible - 1)).toBe("stretch");
    expect(fitTier(TIER_THRESHOLDS.possible)).toBe("possible");
    expect(fitTier(TIER_THRESHOLDS.strong - 1)).toBe("possible");
    expect(fitTier(TIER_THRESHOLDS.strong)).toBe("strong");
  });
});
