import { describe, expect, it } from "vitest";

import { decideClosure, supportsClosureDetection } from "./closure";

const base = {
  kind: "greenhouse",
  fetchFailed: false,
  seen: ["a", "b", "c"],
  storedOpen: ["a", "b", "c"],
  storedClosed: [] as string[],
};

describe("supportsClosureDetection", () => {
  it("allows the per-company ATS boards and refuses the aggregators", () => {
    for (const kind of ["greenhouse", "lever", "ashby"]) {
      expect(supportsClosureDetection(kind), kind).toBe(true);
    }
    // These return a capped page of a rolling feed — absence means nothing.
    for (const kind of ["api", "rss"]) {
      expect(supportsClosureDetection(kind), kind).toBe(false);
    }
  });
});

describe("decideClosure", () => {
  it("closes what the board stopped listing", () => {
    const result = decideClosure({ ...base, seen: ["a", "b"] });
    expect(result).toEqual({ act: true, closed: ["c"], reopened: [] });
  });

  it("closes nothing when everything is still listed", () => {
    expect(decideClosure(base)).toEqual({ act: true, closed: [], reopened: [] });
  });

  it("reopens a posting that came back", () => {
    // A board can drop an entry for one run; without this a blip kills a live role.
    const result = decideClosure({
      ...base,
      seen: ["a", "b", "c", "d"],
      storedClosed: ["d"],
    });
    expect(result).toEqual({ act: true, closed: [], reopened: ["d"] });
  });

  it("refuses to act on an aggregator", () => {
    const result = decideClosure({ ...base, kind: "api", seen: ["a"] });
    expect(result.act).toBe(false);
  });

  it("refuses to act when the fetch failed", () => {
    const result = decideClosure({ ...base, fetchFailed: true, seen: [] });
    expect(result.act).toBe(false);
  });

  it("refuses to act on an empty response", () => {
    // An outage and a genuinely empty board look identical from here.
    const result = decideClosure({ ...base, seen: [] });
    expect(result).toEqual({ act: false, reason: "empty response" });
  });

  it("refuses a mass close that looks like a truncated response", () => {
    const storedOpen = Array.from({ length: 100 }, (_, i) => `id${i}`);
    const result = decideClosure({ ...base, storedOpen, seen: ["id0", "id1"] });

    expect(result.act).toBe(false);
    if (!result.act) expect(result.reason).toContain("98/100");
  });

  it("allows a close that stays under the ratio", () => {
    const storedOpen = Array.from({ length: 100 }, (_, i) => `id${i}`);
    const seen = storedOpen.slice(0, 60);
    const result = decideClosure({ ...base, storedOpen, seen });

    expect(result.act).toBe(true);
    if (result.act) expect(result.closed).toHaveLength(40);
  });

  it("acts on an empty board that holds nothing yet", () => {
    // Nothing stored means nothing to wrongly close, so an empty fetch is harmless.
    expect(decideClosure({ ...base, seen: [], storedOpen: [] })).toEqual({
      act: true,
      closed: [],
      reopened: [],
    });
  });
});
