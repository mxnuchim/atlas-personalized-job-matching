import { describe, expect, it } from "vitest";

import { hasHardNo, isNearDuplicate, isPickable, pickScore, selectLane, type PickCandidate } from "./picks";

const NOW = new Date("2026-10-11T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

let seq = 0;
function c(over: Partial<PickCandidate> & { loc?: number; sen?: number; role?: number } = {}): PickCandidate {
  const { loc = 95, sen = 90, role = 90, ...rest } = over;
  return {
    id: String(++seq),
    company: "Acme",
    title: "Senior Backend Engineer",
    location: "Remote",
    overall: 88,
    dimensions: { role_fit: role, seniority_fit: sen, location_fit: loc },
    redFlags: [],
    postedAt: daysAgo(30),
    ...rest,
  };
}

describe("isPickable", () => {
  it("drops roles you likely can't get — the real Vercel case: fit 89, location 60", () => {
    expect(isPickable(c({ overall: 89, loc: 60 }))).toBe(false);
    expect(isPickable(c({ sen: 60 }))).toBe(false);
    expect(isPickable(c({ role: 60 }))).toBe(false);
    expect(isPickable(c())).toBe(true);
  });
});

describe("hasHardNo", () => {
  it("excludes sponsorship stated as unavailable", () => {
    expect(hasHardNo(["The company does not sponsor visas for this role."])).toBe(true);
    expect(hasHardNo(["No visa sponsorship is available."])).toBe(true);
    expect(hasHardNo(["Candidates must already have the right to work in the UK."])).toBe(true);
  });

  it("keeps uncertainty — the model writes 'dealbreaker' for 45% of roles, mostly hedged", () => {
    expect(hasHardNo(["Visa sponsorship not stated — possible dealbreaker."])).toBe(false);
    expect(
      hasHardNo(["Relocation role with no visa sponsorship: Dashlane's posting doesn't state sponsorship"]),
    ).toBe(false);
  });
});

describe("pickScore", () => {
  it("prefers an achievable 88 over a long-shot 89", () => {
    expect(pickScore(c({ overall: 88, loc: 100 }), NOW)).toBeGreaterThan(pickScore(c({ overall: 89, loc: 70 }), NOW));
  });

  it("nudges fresh postings up and long-open ones down", () => {
    const base = pickScore(c({ postedAt: daysAgo(30) }), NOW);
    expect(pickScore(c({ postedAt: daysAgo(3) }), NOW)).toBe(base + 2);
    expect(pickScore(c({ postedAt: daysAgo(200) }), NOW)).toBe(base - 3);
  });
});

describe("isNearDuplicate", () => {
  it("collapses level variants of one role at one employer — the real Wheely trio", () => {
    const a = c({ company: "Wheely", title: "Senior Backend Engineer" });
    expect(isNearDuplicate(a, c({ company: "Wheely", title: "Backend Engineer" }))).toBe(true);
    expect(isNearDuplicate(a, c({ company: "Wheely", title: "Backend Engineer (Mid/Senior), Marketplace" }))).toBe(true);
  });

  it("keeps genuinely different roles, and the same title at different employers", () => {
    expect(isNearDuplicate(c({ title: "Backend Engineer, Core Technology" }), c({ title: "Frontend Engineer, Expansion" }))).toBe(false);
    expect(isNearDuplicate(c({ company: "Stripe" }), c({ company: "Wheely" }))).toBe(false);
  });
});

describe("selectLane", () => {
  it("gates, ranks, collapses duplicates and caps at two per employer", () => {
    const pool = [
      c({ company: "Wheely", title: "Senior Backend Engineer", overall: 88 }),
      c({ company: "Wheely", title: "Backend Engineer", overall: 88 }),
      c({ company: "Stripe", title: "Backend Engineer, Core Technology", overall: 89 }),
      c({ company: "Stripe", title: "Frontend Engineer, Expansion", overall: 89 }),
      c({ company: "Stripe", title: "Full Stack Engineer, Web Presence", overall: 89 }),
      c({ company: "Vercel", title: "Software Engineer, AI Gateway", overall: 89, loc: 60 }),
      c({ company: "Moniepoint", title: "Platform Engineer", location: "Remote, Lagos, Nigeria" }),
    ];
    // Three slots: enough for the cap, not the fill, to decide (fill has its own test).
    const picked = selectLane(pool, "global", 3, 2, NOW);
    const companies = picked.map((p) => p.company);
    expect(companies.filter((x) => x === "Wheely")).toHaveLength(1);
    expect(companies.filter((x) => x === "Stripe")).toHaveLength(2);
    expect(companies).not.toContain("Vercel");
    expect(companies).not.toContain("Moniepoint");
  });

  it("still fills a lane that has only one employer", () => {
    const pool = ["Platform", "Mobile Architect", "Data", "Security"].map((t) =>
      c({ company: "Moniepoint", title: `${t} Engineer`, location: "Lagos, Nigeria" }),
    );
    expect(selectLane(pool, "nigeria", 10, 2, NOW)).toHaveLength(4);
  });
});
