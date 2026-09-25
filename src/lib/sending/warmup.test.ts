import { describe, expect, it } from "vitest";

import { effectiveDailyCap, warmupDay, WARMUP_DAYS } from "./warmup";

const day = (n: number) => new Date(Date.UTC(2026, 0, n, 12, 0, 0));

describe("warmupDay", () => {
  it("counts the first send's own day as day 1", () => {
    expect(warmupDay(day(1), day(1))).toBe(1);
  });

  it("increments per elapsed day", () => {
    expect(warmupDay(day(1), day(2))).toBe(2);
    expect(warmupDay(day(1), day(22))).toBe(22);
  });

  it("is null before anything has ever been sent", () => {
    expect(warmupDay(null)).toBeNull();
  });

  it("clamps a first-send date in the future to day 1 rather than going negative", () => {
    // Clock skew must not hand out a larger cap than the ramp allows.
    expect(warmupDay(day(10), day(1))).toBe(1);
  });
});

describe("effectiveDailyCap", () => {
  const configuredCap = 30;

  it("opens at the first ramp step before anything has been sent", () => {
    const result = effectiveDailyCap({ configuredCap, firstSentAt: null });
    expect(result.cap).toBe(5);
    expect(result.warming).toBe(true);
  });

  it("climbs through the ramp", () => {
    const at = (d: number) =>
      effectiveDailyCap({ configuredCap, firstSentAt: day(1), now: day(d) }).cap;
    expect(at(1)).toBe(5);
    expect(at(3)).toBe(10);
    expect(at(6)).toBe(15);
    expect(at(10)).toBe(20);
    expect(at(15)).toBe(25);
  });

  it("reaches the configured cap only after the warm-up window", () => {
    const atEnd = effectiveDailyCap({ configuredCap, firstSentAt: day(1), now: day(WARMUP_DAYS) });
    expect(atEnd.cap).toBe(25);
    expect(atEnd.warming).toBe(true);

    const warm = effectiveDailyCap({
      configuredCap,
      firstSentAt: day(1),
      now: day(WARMUP_DAYS + 1),
    });
    expect(warm.cap).toBe(configuredCap);
    expect(warm.warming).toBe(false);
  });

  it("never exceeds the configured cap, even once warm", () => {
    // A low configured cap is a deliberate choice; the ramp must not raise it.
    const result = effectiveDailyCap({ configuredCap: 3, firstSentAt: day(1), now: day(60) });
    expect(result.cap).toBe(3);
  });

  it("holds a tiny configured cap down throughout the ramp", () => {
    for (const d of [1, 3, 6, 10, 15, 30]) {
      expect(effectiveDailyCap({ configuredCap: 2, firstSentAt: day(1), now: day(d) }).cap).toBe(2);
    }
  });
});
