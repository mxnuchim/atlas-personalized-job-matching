import { describe, expect, it } from "vitest";

import { allowedTransitions, canTransition, FUNNEL_ORDER } from "./outreach";

describe("canTransition", () => {
  it("lets a drafted role be sent", () => {
    expect(canTransition("drafted", "sent")).toBe(true);
  });

  it("lets a sent role reach every outcome it can actually have", () => {
    for (const to of ["replied", "bounced", "rejected", "closed"] as const) {
      expect(canTransition("sent", to), to).toBe(true);
    }
  });

  it("allows closing from anywhere that is not already terminal", () => {
    for (const from of FUNNEL_ORDER) {
      if (from === "closed") continue;
      expect(canTransition(from, "closed"), from).toBe(true);
    }
  });

  it("allows resending after a bounce", () => {
    // The message never reached a person; fixing the address and resending is repair,
    // not a step backwards.
    expect(canTransition("bounced", "sent")).toBe(true);
  });

  it("refuses to move the funnel backwards", () => {
    expect(canTransition("replied", "sent")).toBe(false);
    expect(canTransition("interview", "replied")).toBe(false);
    expect(canTransition("offer", "interview")).toBe(false);
  });

  it("treats closed as terminal", () => {
    expect(allowedTransitions("closed")).toEqual([]);
    for (const to of FUNNEL_ORDER) {
      expect(canTransition("closed", to), to).toBe(false);
    }
  });

  it("refuses a self-transition", () => {
    for (const from of FUNNEL_ORDER) {
      expect(canTransition(from, from), from).toBe(false);
    }
  });

  it("never offers a target that is not a real status", () => {
    for (const from of FUNNEL_ORDER) {
      for (const to of allowedTransitions(from)) {
        expect(FUNNEL_ORDER).toContain(to);
      }
    }
  });
});
