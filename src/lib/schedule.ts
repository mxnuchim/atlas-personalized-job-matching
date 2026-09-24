/**
 * The twice-daily cadence (PRD §4). The scheduler that actually fires these lands
 * in M5; this shared helper lets the UI speak truthfully about the next run today.
 */
export const RUN_HOURS = [6, 14] as const;

/** The next scheduled hour as "HH:00" in the given timezone. */
export function nextRunLabel(now: Date = new Date(), timeZone = "UTC"): string {
  const currentHour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone }).format(now),
  );
  const nextHour = RUN_HOURS.find((h) => h > currentHour) ?? RUN_HOURS[0];
  return `${String(nextHour).padStart(2, "0")}:00`;
}
