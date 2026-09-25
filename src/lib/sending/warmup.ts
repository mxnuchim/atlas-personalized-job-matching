/**
 * Warm-up ramp (PRD §11): "warm up a new identity over 2–4 weeks; cap at ~30–50
 * sends/day, ramp gradually."
 *
 * A brand-new sending identity that starts at 30/day looks exactly like a spam run to
 * every reputation system that matters, and the damage is slow to undo. The ramp is
 * derived from the first recorded send rather than a configured start date, so it
 * cannot drift out of sync with reality — there is no "warming up" state to forget to
 * clear, and a dormant identity is not falsely treated as warm.
 */

/** Day (1-indexed, from the first send) → the most sends allowed that day. */
const RAMP: { throughDay: number; cap: number }[] = [
  { throughDay: 2, cap: 5 },
  { throughDay: 5, cap: 10 },
  { throughDay: 9, cap: 15 },
  { throughDay: 14, cap: 20 },
  { throughDay: 21, cap: 25 },
];

/** After this many days the identity is considered warm and the configured cap applies. */
export const WARMUP_DAYS = 21;

/**
 * Whole days elapsed since the first send, 1-indexed: the day of the first send is
 * day 1. `null` when nothing has ever been sent.
 */
export function warmupDay(firstSentAt: Date | null, now: Date = new Date()): number | null {
  if (!firstSentAt) return null;
  const elapsedMs = now.getTime() - firstSentAt.getTime();
  if (elapsedMs < 0) return 1;
  return Math.floor(elapsedMs / 86_400_000) + 1;
}

/**
 * The cap actually in force today: the lower of the configured cap and the ramp.
 * Before the first send ever, the ramp's opening step applies — day one is day one
 * whether or not it has started.
 */
export function effectiveDailyCap(params: {
  configuredCap: number;
  firstSentAt: Date | null;
  now?: Date;
}): { cap: number; warming: boolean; day: number | null } {
  const day = warmupDay(params.firstSentAt, params.now);

  if (day === null) {
    const opening = RAMP[0]!.cap;
    return { cap: Math.min(params.configuredCap, opening), warming: true, day: null };
  }

  if (day > WARMUP_DAYS) {
    return { cap: params.configuredCap, warming: false, day };
  }

  const step = RAMP.find((r) => day <= r.throughDay) ?? RAMP[RAMP.length - 1]!;
  return { cap: Math.min(params.configuredCap, step.cap), warming: true, day };
}
