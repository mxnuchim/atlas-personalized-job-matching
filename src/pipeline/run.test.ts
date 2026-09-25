import { describe, expect, it } from "vitest";

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
