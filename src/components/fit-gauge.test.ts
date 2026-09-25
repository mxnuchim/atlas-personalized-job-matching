import { describe, expect, it } from "vitest";

import { gaugeArc } from "./fit-gauge";

/**
 * The gauge is the one number this product exists to communicate, so the arc must
 * actually correspond to the score. These assert the fill, not the pixels.
 */
describe("gaugeArc", () => {
  const box = 44;
  const stroke = 3.5;

  it("hides the whole track at 0 and none of it at 100", () => {
    expect(gaugeArc(0, box, stroke).filledOffset).toBeCloseTo(
      gaugeArc(0, box, stroke).trackLength,
      6,
    );
    expect(gaugeArc(100, box, stroke).filledOffset).toBeCloseTo(0, 6);
  });

  it("fills exactly half the track at 50", () => {
    const { trackLength, filledOffset } = gaugeArc(50, box, stroke);
    expect(filledOffset).toBeCloseTo(trackLength / 2, 6);
  });

  it("is linear in the score", () => {
    const at = (v: number) => {
      const g = gaugeArc(v, box, stroke);
      return 1 - g.filledOffset / g.trackLength;
    };
    expect(at(25)).toBeCloseTo(0.25, 6);
    expect(at(87)).toBeCloseTo(0.87, 6);
  });

  it("sweeps 260° of the circle, leaving the dial open at the bottom", () => {
    const { trackLength, circumference } = gaugeArc(100, box, stroke);
    expect((trackLength / circumference) * 360).toBeCloseTo(260, 6);
  });

  it("clamps scores outside 0–100 rather than overdrawing the arc", () => {
    expect(gaugeArc(140, box, stroke).clamped).toBe(100);
    expect(gaugeArc(-20, box, stroke).clamped).toBe(0);
    expect(gaugeArc(Number.NaN, box, stroke).clamped).toBe(0);
  });

  it("keeps the stroke inside the box at every size", () => {
    for (const [b, s] of [
      [44, 3.5],
      [64, 4.5],
      [104, 6],
    ] as const) {
      // radius + half the stroke must not exceed half the viewBox, or it clips.
      expect(gaugeArc(100, b, s).radius + s / 2).toBeLessThanOrEqual(b / 2);
    }
  });
});
