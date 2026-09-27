import { describe, expect, it } from "vitest";

import { initialsOf } from "./avatar";

describe("initialsOf", () => {
  it("takes first and last initial from a full name", () => {
    expect(initialsOf("Manuchim Oliver", "x@y.com")).toBe("MO");
    expect(initialsOf("Anwuri Adiele", "x@y.com")).toBe("AA");
  });

  it("uses two letters when there is only one name", () => {
    expect(initialsOf("Manuchim", "x@y.com")).toBe("MA");
  });

  it("falls back to the email local part when there is no name", () => {
    expect(initialsOf(null, "manuchim@example.com")).toBe("MA");
    expect(initialsOf("   ", "anwuri.adiele@example.com")).toBe("AA");
  });

  it("splits on the separators an email local part actually uses", () => {
    expect(initialsOf(null, "manuchim.oliver@x.com")).toBe("MO");
    expect(initialsOf(null, "manuchim_oliver@x.com")).toBe("MO");
    expect(initialsOf(null, "manuchim-oliver@x.com")).toBe("MO");
  });

  it("never returns an empty label", () => {
    // A blank avatar reads as a broken image rather than a person.
    expect(initialsOf(null, "@x.com")).toBe("?");
  });
});
