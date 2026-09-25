import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cronExpression, nextRunLabel, runHoursUtc, RUN_HOURS } from "./schedule";

describe("nextRunLabel", () => {
  const at = (hourUtc: number) => new Date(Date.UTC(2026, 0, 15, hourUtc, 30));

  it("names the next run later today", () => {
    expect(nextRunLabel(at(3))).toBe("06:00");
    expect(nextRunLabel(at(9))).toBe("14:00");
  });

  it("wraps to the first run tomorrow after the last one has passed", () => {
    expect(nextRunLabel(at(20))).toBe("06:00");
  });

  it("reads the hour in the given timezone, not the server's", () => {
    // 09:30 UTC is 10:30 in Lagos, so the 06:00 run has already gone.
    expect(nextRunLabel(at(9), "Africa/Lagos")).toBe("14:00");
    expect(nextRunLabel(at(9), "UTC")).toBe("14:00");
    // 04:30 UTC is 05:30 in Lagos — still before the morning run.
    expect(nextRunLabel(at(4), "Africa/Lagos")).toBe("06:00");
  });
});

describe("runHoursUtc", () => {
  it("is the configured hours unchanged when the zone is UTC", () => {
    expect(runHoursUtc("UTC")).toEqual([...RUN_HOURS]);
  });

  it("shifts by the zone's offset", () => {
    // Lagos is UTC+1, so 06:00 and 14:00 local fire at 05:00 and 13:00 UTC.
    expect(runHoursUtc("Africa/Lagos")).toEqual([5, 13]);
    // New York is behind UTC, so the hours move forward and stay sorted.
    expect(runHoursUtc("America/New_York", new Date(Date.UTC(2026, 0, 15)))).toEqual([11, 19]);
  });

  it("wraps around midnight rather than going negative", () => {
    const hours = runHoursUtc("Asia/Tokyo", new Date(Date.UTC(2026, 0, 15)));
    expect(hours.every((h) => h >= 0 && h < 24)).toBe(true);
    // Tokyo is UTC+9: 06:00 local is 21:00 the previous day UTC.
    expect(hours).toEqual([5, 21]);
  });
});

describe("the committed cron matches the configured schedule", () => {
  it("does not drift from RUN_HOURS", () => {
    // The workflow's hours are UTC and written by hand; this is what stops them
    // silently disagreeing with the schedule the UI promises.
    const workflow = readFileSync(join(process.cwd(), ".github/workflows/pipeline.yml"), "utf8");
    const committed = /-\s*cron:\s*"([^"]+)"/.exec(workflow)?.[1];

    expect(committed, "no cron line found in .github/workflows/pipeline.yml").toBeTruthy();
    expect(committed).toBe(cronExpression(process.env.TZ ?? "UTC"));
  });
});
