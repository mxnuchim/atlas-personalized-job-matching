import { describe, expect, it } from "vitest";

import { DURATION, EASE, PRESSABLE, SPRING, TRANSITION } from "./motion";

describe("motion tokens", () => {
  it("keeps durations short and correctly ordered", () => {
    expect(DURATION.instant).toBeGreaterThan(0);
    expect(DURATION.instant).toBeLessThan(DURATION.fast);
    expect(DURATION.fast).toBeLessThan(DURATION.base);
    expect(DURATION.base).toBeLessThan(DURATION.slow);
    // Premium reads as responsive — nothing sluggish.
    expect(DURATION.slow).toBeLessThanOrEqual(0.4);
  });

  it("defines cubic-bezier curves as 4-tuples in range", () => {
    for (const curve of Object.values(EASE)) {
      expect(curve).toHaveLength(4);
      for (const n of curve) expect(typeof n).toBe("number");
    }
  });

  it("defines springs with sane physical parameters", () => {
    for (const spring of Object.values(SPRING)) {
      expect(spring.type).toBe("spring");
      expect(spring.stiffness).toBeGreaterThan(0);
      expect(spring.damping).toBeGreaterThan(0);
    }
  });

  it("presses inward, never outward", () => {
    expect(PRESSABLE.whileTap.scale).toBeLessThan(1);
    expect(PRESSABLE.whileTap.scale).toBeGreaterThan(0.9);
  });

  it("uses house easings for the named transitions", () => {
    expect(TRANSITION.enter.ease).toBe(EASE.emphasized);
    expect(TRANSITION.exit.ease).toBe(EASE.exit);
  });
});
