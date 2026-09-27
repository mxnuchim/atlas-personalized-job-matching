import { describe, expect, it } from "vitest";

import { MAX_LIMIT, parseLimit } from "./limits";

describe("parseLimit", () => {
  it("keeps zero, which means 'do nothing'", () => {
    // The bug this exists for: 0 was read as "not supplied", so asking for no drafts
    // applied the stage default of 20 instead.
    expect(parseLimit(0)).toBe(0);
    expect(parseLimit("0")).toBe(0);
  });

  it("distinguishes 'do nothing' from 'use the default'", () => {
    expect(parseLimit(undefined)).toBeUndefined();
    expect(parseLimit(null)).toBeUndefined();
    // An unset GitHub Actions input arrives as an empty string.
    expect(parseLimit("")).toBeUndefined();
    expect(parseLimit("   ")).toBeUndefined();
  });

  it("reads a numeric string, since env vars are strings", () => {
    expect(parseLimit("50")).toBe(50);
  });

  it("caps at the ceiling", () => {
    expect(parseLimit(99_999)).toBe(MAX_LIMIT);
    expect(parseLimit(50, 20)).toBe(20);
  });

  it("floors a fractional value rather than passing it to a LIMIT clause", () => {
    expect(parseLimit(7.9)).toBe(7);
  });

  it("rejects what cannot be a count", () => {
    for (const bad of [-1, Number.NaN, Infinity, "abc", {}, true]) {
      expect(parseLimit(bad), String(bad)).toBeUndefined();
    }
  });
});
