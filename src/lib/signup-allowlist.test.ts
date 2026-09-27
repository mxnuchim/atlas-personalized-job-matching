import { describe, expect, it } from "vitest";

import { emailAllowed, parseAllowlist, signupOpen } from "./signup-allowlist";

const LIST = "manuchimoliver779@gmail.com, Anwuri@Example.com";

describe("signup allowlist", () => {
  it("is closed when unset or empty", () => {
    // Closed by default: an open form on a public URL spends the owner's budget.
    for (const value of [undefined, "", "   ", ",,"]) {
      expect(signupOpen(value), String(value)).toBe(false);
    }
  });

  it("is open once an address is named", () => {
    expect(signupOpen(LIST)).toBe(true);
  });

  it("tolerates the spacing and casing people actually type", () => {
    expect(parseAllowlist(LIST)).toEqual(["manuchimoliver779@gmail.com", "anwuri@example.com"]);
  });

  it("matches regardless of how the address was typed", () => {
    // Otherwise this reads to someone as "my own address is not allowed".
    expect(emailAllowed("  ANWURI@example.com ", LIST)).toBe(true);
    expect(emailAllowed("manuchimoliver779@gmail.com", LIST)).toBe(true);
  });

  it("refuses anyone not named", () => {
    expect(emailAllowed("stranger@example.com", LIST)).toBe(false);
  });

  it("refuses everyone when closed", () => {
    expect(emailAllowed("manuchimoliver779@gmail.com", undefined)).toBe(false);
  });
});
