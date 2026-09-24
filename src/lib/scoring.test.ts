import { describe, expect, it } from "vitest";

import { fitTier } from "./scoring";

describe("fitTier", () => {
  it("classifies strong at the threshold and above", () => {
    expect(fitTier(85)).toBe("strong");
    expect(fitTier(92)).toBe("strong");
    expect(fitTier(100)).toBe("strong");
  });

  it("classifies possible in the 65–84 band", () => {
    expect(fitTier(65)).toBe("possible");
    expect(fitTier(84)).toBe("possible");
  });

  it("classifies stretch below 65", () => {
    expect(fitTier(64)).toBe("stretch");
    expect(fitTier(0)).toBe("stretch");
  });
});
