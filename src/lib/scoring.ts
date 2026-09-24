/**
 * Fit tiers (PRD §9). Configurable thresholds; the scoring pipeline (M2) maps an
 * overall 0–100 onto a tier, and the UI colors the gauge by it.
 */
export type FitTier = "strong" | "possible" | "stretch";

export const TIER_THRESHOLDS = {
  /** overall ≥ 85 → strong */
  strong: 85,
  /** overall 65–84 → possible */
  possible: 65,
} as const;

export function fitTier(overall: number): FitTier {
  if (overall >= TIER_THRESHOLDS.strong) return "strong";
  if (overall >= TIER_THRESHOLDS.possible) return "possible";
  return "stretch";
}

export const TIER_LABELS: Record<FitTier, string> = {
  strong: "Strong",
  possible: "Possible",
  stretch: "Stretch",
};
