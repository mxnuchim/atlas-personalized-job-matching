import { describe, expect, it } from "vitest";

import { fitTier, tierByRank, TIER_LABELS, TIER_THRESHOLDS } from "./scoring";

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

describe("tierByRank", () => {
  it("puts the best 15% in strong", () => {
    expect(tierByRank(0)).toBe("strong");
    expect(tierByRank(0.149)).toBe("strong");
    expect(tierByRank(0.15)).toBe("possible");
  });

  it("puts the next 35% in possible, so half is worth reading", () => {
    expect(tierByRank(0.3)).toBe("possible");
    expect(tierByRank(0.499)).toBe("possible");
    expect(tierByRank(0.5)).toBe("stretch");
  });

  it("puts the bottom half in stretch", () => {
    expect(tierByRank(0.75)).toBe("stretch");
    expect(tierByRank(1)).toBe("stretch");
  });

  it("gives tied scores the same tier", () => {
    // percent_rank() assigns ties one shared value, so equal scores cannot be split
    // by row order — which is exactly where an arbitrary boundary would hurt most.
    expect(tierByRank(0.14)).toBe(tierByRank(0.14));
  });

  it("uses every tier across the range", () => {
    expect(new Set([tierByRank(0), tierByRank(0.3), tierByRank(0.9)]).size).toBe(3);
  });

  it("keeps strong genuinely scarce", () => {
    // The point of the change: a label that applies to one in five sorts nothing.
    const population = Array.from({ length: 100 }, (_, i) => tierByRank(i / 100));
    expect(population.filter((t) => t === "strong")).toHaveLength(15);
    expect(population.filter((t) => t === "possible")).toHaveLength(35);
    expect(population.filter((t) => t === "stretch")).toHaveLength(50);
  });
});
