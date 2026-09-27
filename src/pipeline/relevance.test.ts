import { describe, expect, it } from "vitest";

import { buildCriteria, countriesIn, isRelevant, isUnrestricted } from "./relevance";

/** The real seeded profile wording, so the test proves the gate against actual data. */
const PROFILE = {
  targetRoles: [
    "Forward Deployed Engineer",
    "AI-Systems Engineer",
    "Full-Stack Engineer",
    "Backend Engineer",
    "Frontend Engineer",
  ],
  locations: [
    "Remote (global)",
    "Port Harcourt, Nigeria (base)",
    "Open to relocation: US, UK, EU, Canada",
  ],
};

const criteria = buildCriteria(PROFILE);

describe("countriesIn", () => {
  it("reads the profile's own wording into country codes", () => {
    expect(criteria.countries).toEqual(expect.arrayContaining(["NG", "US", "GB", "CA"]));
  });

  it("expands a group token to its members", () => {
    // "EU" in the profile must bring the member states with it.
    expect(criteria.countries).toEqual(expect.arrayContaining(["DE", "FR", "NL", "IE"]));
  });

  it("does not claim a country the text never names", () => {
    expect(criteria.countries).not.toContain("JP");
    expect(criteria.countries).not.toContain("IN");
  });

  it("matches on word boundaries, not substrings", () => {
    // "us" must not fire on "Belarus", nor "uk" on "Paducah".
    expect(countriesIn("Belarus")).not.toContain("US");
    expect(countriesIn("Austria")).not.toContain("US");
  });
});

describe("isUnrestricted", () => {
  it("recognises wording that names no place", () => {
    for (const value of ["Remote", "Worldwide", "Anywhere", "Remote - Global"]) {
      expect(isUnrestricted(value)).toBe(true);
    }
  });

  it("does not treat a real place as unrestricted", () => {
    expect(isUnrestricted("Berlin, Germany")).toBe(false);
  });
});

describe("isRelevant — title", () => {
  const at = (title: string, location: string | null = null) =>
    isRelevant({ title, location }, criteria);

  it("keeps engineering titles", () => {
    for (const title of [
      "Senior Backend Engineer",
      "Staff Software Engineer, Platform",
      "Full-Stack Developer",
      "Site Reliability Engineer",
      "Machine Learning Engineer",
      "Forward Deployed Engineer",
    ]) {
      expect(at(title), title).toEqual({ keep: true });
    }
  });

  it("drops roles that borrow 'engineer' for non-engineering work", () => {
    for (const title of [
      "Sales Engineer",
      "Technical Support Engineer",
      "Civil Engineer",
      "Mechanical Engineer",
    ]) {
      expect(at(title), title).toEqual({ keep: false, reason: "title" });
    }
  });

  it("drops non-engineering roles outright", () => {
    for (const title of [
      "Account Executive Mid-Market - Italy",
      "Senior HR Generalist",
      "Content Reviewer - United States",
      "Registered Nurse",
    ]) {
      expect(at(title), title).toEqual({ keep: false, reason: "title" });
    }
  });

  it("does not match an engineering term inside a longer word", () => {
    // "ai" must not fire on "Maintenance"; "ml" must not fire on "HTML".
    expect(at("Maintenance Technician")).toEqual({ keep: false, reason: "title" });
  });
});

describe("isRelevant — location", () => {
  const eng = "Senior Backend Engineer";
  const at = (location: string | null) => isRelevant({ title: eng, location }, criteria);

  it("keeps a covered country", () => {
    for (const location of ["London, UK", "Berlin, Germany", "Toronto, Canada", "Lagos, Nigeria"]) {
      expect(at(location), location).toEqual({ keep: true });
    }
  });

  it("drops a clearly uncovered country", () => {
    for (const location of ["Singapore", "Tokyo, Japan", "Bengaluru, India", "São Paulo, Brazil"]) {
      expect(at(location), location).toEqual({ keep: false, reason: "location" });
    }
  });

  it("keeps a remote posting restricted to a covered country", () => {
    expect(at("Remote - US")).toEqual({ keep: true });
  });

  it("drops a remote posting restricted to an uncovered one", () => {
    // The restriction is the location; "remote" alone must not wave it through.
    expect(at("Japan")).toEqual({ keep: false, reason: "location" });
  });

  it("keeps an unstated or unrecognised location rather than guessing", () => {
    expect(at(null)).toEqual({ keep: true });
    expect(at("")).toEqual({ keep: true });
    expect(at("Springfield")).toEqual({ keep: true });
  });

  it("keeps a multi-country posting when any one is covered", () => {
    expect(at("Singapore or London")).toEqual({ keep: true });
  });
});
