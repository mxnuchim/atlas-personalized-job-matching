import { describe, expect, it } from "vitest";

import { collapseRoles } from "./dedupe";
import type { NormalizedJob } from "./sources";

const base: NormalizedJob = {
  externalId: "500",
  title: "Staff Software Engineer - Backend",
  company: "Databricks",
  location: "San Francisco",
  remote: false,
  url: "https://example.com/500",
  description: "Build things.",
  postedAt: new Date("2026-09-20T00:00:00Z"),
  raw: {},
};

const variant = (over: Partial<NormalizedJob>): NormalizedJob => ({ ...base, ...over });

describe("collapseRoles", () => {
  it("collapses one role advertised in many cities into a single posting", () => {
    const collapsed = collapseRoles([
      variant({ externalId: "300", location: "New York" }),
      variant({ externalId: "100", location: "San Francisco" }),
      variant({ externalId: "200", location: "Seattle" }),
    ]);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].location).toBe("New York; San Francisco; Seattle");
  });

  it("elects the representative by lowest external id, not payload order", () => {
    // Positional choice would let a board reordering its response elect a different
    // id, which the unique index stores as a *new* job — breeding the duplicates the
    // collapse is meant to remove.
    const forward = collapseRoles([variant({ externalId: "300" }), variant({ externalId: "100" })]);
    const reversed = collapseRoles([variant({ externalId: "100" }), variant({ externalId: "300" })]);

    expect(forward[0].externalId).toBe("100");
    expect(reversed[0].externalId).toBe("100");
  });

  it("keeps genuinely different roles apart", () => {
    const collapsed = collapseRoles([
      variant({ externalId: "1", title: "Backend Engineer" }),
      variant({ externalId: "2", title: "Frontend Engineer" }),
      variant({ externalId: "3", title: "Backend Engineer", company: "Stripe" }),
    ]);
    expect(collapsed).toHaveLength(3);
  });

  it("matches titles that differ only in spacing or case", () => {
    const collapsed = collapseRoles([
      variant({ externalId: "1", title: "Backend  Engineer" }),
      variant({ externalId: "2", title: "backend engineer" }),
    ]);
    expect(collapsed).toHaveLength(1);
    // The surviving title keeps its original form, not the normalised key.
    expect(collapsed[0].title).toBe("Backend  Engineer");
  });

  it("is remote if any variant is remote", () => {
    const collapsed = collapseRoles([
      variant({ externalId: "1", location: "London", remote: false }),
      variant({ externalId: "2", location: "Remote - UK", remote: true }),
    ]);
    expect(collapsed[0].remote).toBe(true);
  });

  it("takes the earliest date, so a re-post cannot refresh an old requisition", () => {
    const collapsed = collapseRoles([
      variant({ externalId: "1", postedAt: new Date("2026-09-25T00:00:00Z") }),
      variant({ externalId: "2", postedAt: new Date("2025-01-01T00:00:00Z") }),
    ]);
    expect(collapsed[0].postedAt).toEqual(new Date("2025-01-01T00:00:00Z"));
  });

  it("summarises a long location list rather than storing a wall of text", () => {
    const cities = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const collapsed = collapseRoles(
      cities.map((city, i) => variant({ externalId: String(i), location: city })),
    );
    expect(collapsed[0].location).toBe("A; B; C; D; E; F +2 more");
  });

  it("produces a stable merged location regardless of input order", () => {
    const a = collapseRoles([
      variant({ externalId: "1", location: "Seattle" }),
      variant({ externalId: "2", location: "Austin" }),
    ]);
    const b = collapseRoles([
      variant({ externalId: "2", location: "Austin" }),
      variant({ externalId: "1", location: "Seattle" }),
    ]);
    expect(a[0].location).toBe(b[0].location);
  });

  it("handles variants with no location at all", () => {
    const collapsed = collapseRoles([
      variant({ externalId: "1", location: null }),
      variant({ externalId: "2", location: null }),
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].location).toBeNull();
  });

  it("leaves a single posting untouched", () => {
    const only = variant({ externalId: "9" });
    expect(collapseRoles([only])[0]).toBe(only);
  });
});
