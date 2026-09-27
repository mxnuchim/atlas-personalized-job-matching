/**
 * Fit tiers (PRD §9).
 *
 * Tiers come from a match's **rank**, not from the raw number the model wrote.
 *
 * Why: an LLM's absolute score is not portable. Measured on 293 real matches, this
 * model put 112 of them in the 80–90 band and barely used 0–70 at all — so the old
 * `>= 85` line cut straight through the densest part of the distribution, and roles a
 * point apart landed in different tiers on a number the model essentially guessed.
 * Raising the line to 90 would have left six strong matches; lowering it, hundreds.
 * There was no good place to put it.
 *
 * Ranking survives that, and survives changing models — a different model will produce
 * different numbers but a broadly similar ordering, and the ordering is the part worth
 * trusting. Tier-by-threshold quietly ties the product to one model's scoring habits;
 * tier-by-rank does not.
 */
export type FitTier = "strong" | "possible" | "stretch";

/**
 * What share of a person's matches each tier may hold, best first.
 *
 * "Strong" means *the best 15% of everything scored for you* — a shortlist, by
 * construction. It cannot drift into meaning "most of them", which is what an absolute
 * threshold did.
 */
export const TIER_SHARES = {
  /** Top 15%. */
  strong: 0.15,
  /** The next 35%, so half of everything is one of the two worth reading. */
  possible: 0.5,
} as const;

/**
 * Below this many matches a percentile says nothing — with five scored jobs the best
 * one is "top 15%" by arithmetic alone. Under it, fall back to absolute thresholds.
 */
export const MIN_FOR_RANK = 25;

/** Kept for the fallback, and for the first score of a run before ranking happens. */
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

/**
 * Tier from a percentile, where 0 is the best-scoring match and 1 the worst — the
 * orientation Postgres's `percent_rank() OVER (ORDER BY overall DESC)` produces.
 *
 * Ties share a percentile, so two matches on the same score always land in the same
 * tier. Splitting equal scores by row order would make the boundary arbitrary in
 * exactly the place it matters most.
 */
export function tierByRank(percentile: number): FitTier {
  if (percentile < TIER_SHARES.strong) return "strong";
  if (percentile < TIER_SHARES.possible) return "possible";
  return "stretch";
}

export const TIER_LABELS: Record<FitTier, string> = {
  strong: "Strong",
  possible: "Possible",
  stretch: "Stretch",
};
