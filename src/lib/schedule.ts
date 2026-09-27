/**
 * The daily cadence. One definition, shared by the UI (what it tells you about the
 * next run) and by the scheduler check (what the cron actually fires).
 *
 * Was twice daily. Dropped to once because the constraint is how many roles a person
 * can actually apply to in a day — around ten to twenty — not how fast postings
 * appear. A second run added cost and inbox noise without adding anything anyone had
 * time to act on.
 */
export const RUN_HOURS = [6] as const;

/** The next scheduled hour as "HH:00" in the given timezone. */
export function nextRunLabel(now: Date = new Date(), timeZone = "UTC"): string {
  const currentHour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone }).format(now),
  );
  const nextHour = RUN_HOURS.find((h) => h > currentHour) ?? RUN_HOURS[0];
  return `${String(nextHour).padStart(2, "0")}:00`;
}

/**
 * The same hours expressed in UTC, which is the only timezone a cron scheduler speaks.
 *
 * Derived rather than hardcoded so the workflow cannot silently drift from `RUN_HOURS`
 * — `schedule.test.ts` asserts the committed workflow matches what this returns.
 *
 * Caveat: computed against a single instant, so for a zone that observes DST the
 * offset is whichever applies on that date. Atlas runs on a fixed-offset zone; if that
 * changes, the cron needs revisiting twice a year, which is what the test will tell you.
 */
export function runHoursUtc(timeZone = "UTC", on: Date = new Date()): number[] {
  const offsetHours = utcOffsetHours(timeZone, on);
  return RUN_HOURS.map((h) => (((h - offsetHours) % 24) + 24) % 24).sort((a, b) => a - b);
}

/** The cron expression for those hours, e.g. `0 6,14 * * *`. */
export function cronExpression(timeZone = "UTC", on: Date = new Date()): string {
  return `0 ${runHoursUtc(timeZone, on).join(",")} * * *`;
}

function utcOffsetHours(timeZone: string, on: Date): number {
  // Format the same instant in both zones and diff them — the only way to get an
  // offset out of Intl without a timezone database of our own.
  const asUtc = new Date(on.toLocaleString("en-US", { timeZone: "UTC" }));
  const asLocal = new Date(on.toLocaleString("en-US", { timeZone }));
  return Math.round((asLocal.getTime() - asUtc.getTime()) / 3_600_000);
}
