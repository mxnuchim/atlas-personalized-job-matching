import { describe, expect, it } from "vitest";

import type { IngestSummary } from "./ingest";
import { configurationErrors } from "./run";

import { sumCost } from "./run";

describe("sumCost", () => {
  it("adds two known costs", () => {
    expect(sumCost(0.25, 0.5)).toBe(0.75);
  });

  it("is unknown if either side is unknown", () => {
    // Understating a run's cost is worse than admitting it is not known.
    expect(sumCost(0.25, null)).toBeNull();
    expect(sumCost(null, 0.5)).toBeNull();
    expect(sumCost(null, null)).toBeNull();
  });

  it("treats a genuine zero as known", () => {
    expect(sumCost(0, 0)).toBe(0);
  });
});

describe("configurationErrors", () => {
  const ingest = (over: Partial<IngestSummary> = {}): IngestSummary => ({
    seen: 0,
    inserted: 0,
    duplicates: 0,
    filtered: 0,
    collapsed: 0,
    expired: 0,
    closed: 0,
    reopened: 0,
    sourcesOk: 0,
    sourcesTotal: 0,
    sourcesResting: 0,
    results: [],
    ...over,
  });

  it("calls a run with no sources a failure, not a quiet day", () => {
    // Observed: a scheduled run read zero boards, spent nothing, and recorded `ok`.
    // A green tick every morning on an unconfigured database is the worst outcome,
    // because it looks like the system is working.
    const errors = configurationErrors(ingest());
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("db:seed:sources");
  });

  it("says so when every source is resting rather than absent", () => {
    // A different problem with the same symptom, and a different fix.
    const errors = configurationErrors(ingest({ sourcesResting: 8 }));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("resting");
    expect(errors[0].message).not.toContain("db:seed:sources");
  });

  it("stays silent when sources were actually read", () => {
    expect(configurationErrors(ingest({ sourcesTotal: 66, sourcesOk: 66 }))).toEqual([]);
  });

  it("stays silent on a genuinely quiet day", () => {
    // Sources read, nothing new found. That is not an error.
    expect(configurationErrors(ingest({ sourcesTotal: 66, sourcesOk: 66, seen: 11000 }))).toEqual(
      [],
    );
  });

  it("stays silent when sources failed — that is already an error elsewhere", () => {
    expect(configurationErrors(ingest({ sourcesTotal: 66, sourcesOk: 40 }))).toEqual([]);
  });
});
