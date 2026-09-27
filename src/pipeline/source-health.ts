/**
 * When to stop asking a board that keeps saying no.
 *
 * Observed once already: twenty of sixty-six sources failed in a single run, and the
 * next morning's run asked all twenty again, at the same cost, with the same result.
 * A board that is down, renamed, or has revoked its public endpoint is not going to
 * recover because we tried harder.
 *
 * Deliberately forgiving early and firm late. Two failures are usually weather — a
 * transient network error, which is exactly what those twenty turned out to be. Ten in
 * a row is a board that is gone, and asking daily is just noise in the coverage number.
 *
 * Pure, so the policy is testable without a clock or a database.
 */

/** Failures tolerated before a source is rested at all. */
export const FAILURES_BEFORE_QUARANTINE = 3;

/** How long to rest a source, by how many consecutive failures it has had. */
const BACKOFF_HOURS: { atLeast: number; hours: number }[] = [
  { atLeast: 10, hours: 24 * 7 },
  { atLeast: 6, hours: 24 },
  { atLeast: FAILURES_BEFORE_QUARANTINE, hours: 6 },
];

export function backoffHours(consecutiveFailures: number): number {
  return BACKOFF_HOURS.find((step) => consecutiveFailures >= step.atLeast)?.hours ?? 0;
}

export type HealthState = {
  consecutiveFailures: number;
  lastErrorAt: Date | null;
};

/**
 * Should this run skip the source?
 *
 * Never skips a source that has never failed, and never skips one whose rest period
 * has elapsed — a quarantine is a pause, not a verdict. A missing `lastErrorAt` with
 * failures recorded is treated as "try it": the alternative is resting a source
 * forever on incomplete data.
 */
export function shouldSkip(
  state: HealthState,
  now: Date = new Date(),
): { skip: false } | { skip: true; until: Date; reason: string } {
  if (state.consecutiveFailures < FAILURES_BEFORE_QUARANTINE) return { skip: false };
  if (!state.lastErrorAt) return { skip: false };

  const hours = backoffHours(state.consecutiveFailures);
  const until = new Date(state.lastErrorAt.getTime() + hours * 3_600_000);
  if (now >= until) return { skip: false };

  return {
    skip: true,
    until,
    reason: `${state.consecutiveFailures} consecutive failures — resting for ${hours}h`,
  };
}
