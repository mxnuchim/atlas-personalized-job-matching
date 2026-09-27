import { describe, expect, it } from "vitest";

import { isStale, relativeAge } from "./age";

const now = new Date("2026-09-27T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeAge", () => {
  it("scales the unit to the distance", () => {
    expect(relativeAge(ago(30 * 1000), now)).toBe("just now");
    expect(relativeAge(ago(5 * MINUTE), now)).toBe("5m ago");
    expect(relativeAge(ago(3 * HOUR), now)).toBe("3h ago");
    expect(relativeAge(ago(2 * DAY), now)).toBe("2d ago");
    expect(relativeAge(ago(10 * DAY), now)).toBe("1w ago");
    expect(relativeAge(ago(60 * DAY), now)).toBe("2mo ago");
    expect(relativeAge(ago(800 * DAY), now)).toBe("2y ago");
  });

  it("returns null for a missing date rather than inventing one", () => {
    // Plenty of boards publish no date at all; "now" would be a lie.
    expect(relativeAge(null, now)).toBeNull();
    expect(relativeAge(undefined, now)).toBeNull();
  });

  it("treats a future timestamp as clock skew, not a prediction", () => {
    expect(relativeAge(new Date(now.getTime() + HOUR), now)).toBe("just now");
  });

  it("does not round an hour-old posting up to a day", () => {
    expect(relativeAge(ago(HOUR - 1), now)).toBe("59m ago");
    expect(relativeAge(ago(DAY - 1), now)).toBe("23h ago");
  });
});

describe("isStale", () => {
  it("marks long-open requisitions", () => {
    expect(isStale(ago(200 * DAY), 180, now)).toBe(true);
    expect(isStale(ago(100 * DAY), 180, now)).toBe(false);
  });

  it("does not call an undated posting stale", () => {
    // Unknown is not old — the Ashby and Lever boards omit dates routinely.
    expect(isStale(null, 180, now)).toBe(false);
  });
});
