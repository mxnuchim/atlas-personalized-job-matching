import { describe, expect, it } from "vitest";

import { runStatusFor } from "./runs";

describe("runStatusFor", () => {
  it("is ok when nothing failed", () => {
    expect(runStatusFor({ errors: [], produced: 12 })).toBe("ok");
    // A run with nothing to do is still a clean run, not a failure.
    expect(runStatusFor({ errors: [], produced: 0 })).toBe("ok");
  });

  it("is partial when work landed alongside errors", () => {
    const errors = [{ stage: "score", job_id: "j1", message: "rate limited" }];
    expect(runStatusFor({ errors, produced: 7 })).toBe("partial");
  });

  it("is failed only when errors occurred and nothing was produced", () => {
    const errors = [{ stage: "score", message: "no provider key" }];
    expect(runStatusFor({ errors, produced: 0 })).toBe("failed");
  });
});
