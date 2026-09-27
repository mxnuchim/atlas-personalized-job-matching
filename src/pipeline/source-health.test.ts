import { describe, expect, it } from "vitest";

import { backoffHours, FAILURES_BEFORE_QUARANTINE, shouldSkip } from "./source-health";

const now = new Date("2026-09-27T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

describe("backoffHours", () => {
  it("rests nothing below the threshold", () => {
    expect(backoffHours(0)).toBe(0);
    expect(backoffHours(FAILURES_BEFORE_QUARANTINE - 1)).toBe(0);
  });

  it("lengthens the rest as failures accumulate", () => {
    expect(backoffHours(3)).toBe(6);
    expect(backoffHours(6)).toBe(24);
    expect(backoffHours(10)).toBe(24 * 7);
  });

  it("never shortens as failures grow", () => {
    let previous = 0;
    for (let n = 0; n <= 20; n += 1) {
      const current = backoffHours(n);
      expect(current, `at ${n} failures`).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });
});

describe("shouldSkip", () => {
  it("never skips a healthy source", () => {
    expect(shouldSkip({ consecutiveFailures: 0, lastErrorAt: null }, now)).toEqual({ skip: false });
  });

  it("tolerates a couple of failures — those are usually weather", () => {
    // Twenty sources once failed in one run and all twenty were transient.
    expect(shouldSkip({ consecutiveFailures: 2, lastErrorAt: hoursAgo(1) }, now)).toEqual({
      skip: false,
    });
  });

  it("rests a source that keeps failing", () => {
    const result = shouldSkip({ consecutiveFailures: 4, lastErrorAt: hoursAgo(1) }, now);
    expect(result.skip).toBe(true);
    if (result.skip) expect(result.reason).toContain("4 consecutive failures");
  });

  it("tries again once the rest has elapsed — a quarantine is a pause, not a verdict", () => {
    expect(shouldSkip({ consecutiveFailures: 4, lastErrorAt: hoursAgo(7) }, now)).toEqual({
      skip: false,
    });
  });

  it("rests a long-dead board for a week", () => {
    expect(shouldSkip({ consecutiveFailures: 12, lastErrorAt: hoursAgo(48) }, now).skip).toBe(true);
    expect(shouldSkip({ consecutiveFailures: 12, lastErrorAt: hoursAgo(24 * 8) }, now).skip).toBe(
      false,
    );
  });

  it("tries a source with failures but no recorded time", () => {
    // Incomplete data must not rest a board forever.
    expect(shouldSkip({ consecutiveFailures: 99, lastErrorAt: null }, now)).toEqual({
      skip: false,
    });
  });
});
