import { describe, expect, it } from "vitest";

import { canDecide, canEdit } from "./drafts";

/**
 * The review queue's safety rule. Worth asserting explicitly: a regression here would
 * let a sent draft be edited after the fact, so the stored copy would no longer be
 * what actually went out.
 */
describe("canDecide / canEdit", () => {
  it("allows a pending draft", () => {
    expect(canDecide("pending")).toBe(true);
    expect(canEdit("pending")).toBe(true);
  });

  it.each(["approved", "skipped", "sent", "failed"] as const)("refuses a %s draft", (status) => {
    expect(canDecide(status)).toBe(false);
    expect(canEdit(status)).toBe(false);
  });
});
