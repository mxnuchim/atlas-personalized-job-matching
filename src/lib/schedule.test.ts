import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cronExpression, nextRunLabel, queueDay, runHoursUtc, RUN_HOURS } from "./schedule";

describe("nextRunLabel", () => {
  const at = (hourUtc: number) => new Date(Date.UTC(2026, 0, 15, hourUtc, 30));

  it("names today's run when it is still ahead", () => {
    expect(nextRunLabel(at(3))).toBe("06:00");
  });

  it("wraps to tomorrow once the run has passed", () => {
    // With a single daily run, everything after it points at the next day.
    expect(nextRunLabel(at(9))).toBe("06:00");
    expect(nextRunLabel(at(20))).toBe("06:00");
  });

  it("reads the hour in the given timezone, not the server's", () => {
    // 04:30 UTC is 05:30 in Lagos — still before the morning run.
    expect(nextRunLabel(at(4), "Africa/Lagos")).toBe("06:00");
    // 09:30 UTC is 10:30 in Lagos, so today's run has already gone.
    expect(nextRunLabel(at(9), "Africa/Lagos")).toBe("06:00");
  });
});

describe("runHoursUtc", () => {
  it("is the configured hours unchanged when the zone is UTC", () => {
    expect(runHoursUtc("UTC")).toEqual([...RUN_HOURS]);
  });

  it("shifts by the zone's offset", () => {
    // Lagos is UTC+1, so 06:00 local fires at 05:00 UTC.
    expect(runHoursUtc("Africa/Lagos")).toEqual([5]);
    // New York is behind UTC, so the hour moves forward.
    expect(runHoursUtc("America/New_York", new Date(Date.UTC(2026, 0, 15)))).toEqual([11]);
  });

  it("wraps around midnight rather than going negative", () => {
    // Tokyo is UTC+9: 06:00 local is 21:00 the previous day UTC.
    const hours = runHoursUtc("Asia/Tokyo", new Date(Date.UTC(2026, 0, 15)));
    expect(hours.every((h) => h >= 0 && h < 24)).toBe(true);
    expect(hours).toEqual([21]);
  });
});

describe("the committed cron matches the configured schedule", () => {
  it("does not drift from RUN_HOURS", () => {
    // The workflow's hours are UTC and written by hand; this is what stops them
    // silently disagreeing with the schedule the UI promises.
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/pipeline.yml"), "utf8");
    const committed = /-\s*cron:\s*"([^"]+)"/.exec(workflow)?.[1];

    expect(committed, "no cron line found in .github/workflows/pipeline.yml").toBeTruthy();
    expect(committed).toBe(cronExpression(process.env.APP_TZ ?? "UTC"));
  });

  it("is a single daily run", () => {
    // The cadence is a product decision — a person can apply to ten or twenty roles
    // a day, so a second run adds cost and noise without adding anything actionable.
    expect(RUN_HOURS).toHaveLength(1);
  });
});

describe("queueDay", () => {
  // The run is at 06:00; a queue day starts there, not at midnight.
  it("rolls over at the run hour in the configured zone", () => {
    expect(queueDay(new Date("2026-10-11T05:59:00Z"), "UTC")).toBe("2026-10-10");
    expect(queueDay(new Date("2026-10-11T06:00:00Z"), "UTC")).toBe("2026-10-11");
    // Lagos is UTC+1: 05:30 UTC is 06:30 there — already the new day.
    expect(queueDay(new Date("2026-10-11T05:30:00Z"), "Africa/Lagos")).toBe("2026-10-11");
    expect(queueDay(new Date("2026-10-11T04:30:00Z"), "Africa/Lagos")).toBe("2026-10-10");
  });
});
