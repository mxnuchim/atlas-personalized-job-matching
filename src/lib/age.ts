/**
 * How old a posting is, in the compact form a dense list can carry.
 *
 * Job screens previously showed `first_seen_at` — when *Atlas* ingested a posting —
 * which makes a requisition open since 2023 look like it arrived this morning. The
 * board's own `posted_at` is the honest signal, and it is frequently missing or
 * absurd (one Palantir req is dated 2009), so this returns null rather than
 * inventing a value.
 *
 * Pure and timezone-free: it compares two instants, so there is no locale hydration
 * risk in rendering it on the client.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relativeAge(date: Date | null | undefined, now: Date = new Date()): string | null {
  if (!date) return null;

  const ms = now.getTime() - date.getTime();
  // A board publishing a near-future timestamp is a clock skew, not a prediction.
  if (ms < 0) return "just now";

  if (ms < HOUR) {
    const minutes = Math.floor(ms / MINUTE);
    return minutes < 1 ? "just now" : `${minutes}m ago`;
  }
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h ago`;

  const days = Math.floor(ms / DAY);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * True when a posting is older than the given days. Used to mark the evergreen
 * requisitions — the ones that sit open permanently — so they read differently from
 * a role that genuinely appeared this week.
 */
export function isStale(
  date: Date | null | undefined,
  days = 180,
  now: Date = new Date(),
): boolean {
  if (!date) return false;
  return now.getTime() - date.getTime() > days * DAY;
}
