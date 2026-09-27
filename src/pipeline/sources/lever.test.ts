import { describe, expect, it } from "vitest";

import { normalizeLeverJob } from "./lever";

/** Shaped from a real api.lever.co posting. */
const baseJob = {
  id: "6ed76ce8-4156-4b60-b120-403538bd66cd",
  text: "  Backend Engineer  ",
  hostedUrl: "https://jobs.lever.co/palantir/6ed76ce8",
  createdAt: 1786469891368,
  workplaceType: "hybrid",
  categories: { location: "London, United Kingdom", commitment: "Full-time" },
  descriptionPlain: "Build the ingestion layer.",
  additionalPlain: "Nice to have: Rust.",
};

describe("normalizeLeverJob", () => {
  it("maps fields and trims the title", () => {
    const job = normalizeLeverJob(baseJob, "Palantir");

    expect(job.externalId).toBe(baseJob.id);
    expect(job.title).toBe("Backend Engineer");
    expect(job.company).toBe("Palantir");
    expect(job.location).toBe("London, United Kingdom");
    expect(job.url).toBe(baseJob.hostedUrl);
  });

  it("reads createdAt as milliseconds, not seconds", () => {
    // Lever is the odd one out: every other board here publishes ISO or epoch seconds.
    expect(normalizeLeverJob(baseJob, "Palantir").postedAt).toEqual(new Date(1786469891368));
  });

  it("joins the description and the additional section", () => {
    expect(normalizeLeverJob(baseJob, "Palantir").description).toBe(
      "Build the ingestion layer.\n\nNice to have: Rust.",
    );
  });

  it("falls back to the HTML description when no plain text is given", () => {
    const job = normalizeLeverJob(
      {
        ...baseJob,
        descriptionPlain: undefined,
        additionalPlain: undefined,
        description: "<p>Ship &amp; iterate.</p>",
      },
      "Palantir",
    );
    expect(job.description).toBe("Ship & iterate.");
  });

  it("trusts workplaceType for remoteness", () => {
    expect(normalizeLeverJob({ ...baseJob, workplaceType: "remote" }, "Palantir").remote).toBe(
      true,
    );
    expect(normalizeLeverJob(baseJob, "Palantir").remote).toBe(false);
  });

  it("still detects remote from the location when workplaceType is absent", () => {
    const job = normalizeLeverJob(
      {
        ...baseJob,
        workplaceType: undefined,
        categories: { location: "Remote - EU", commitment: null },
      },
      "Palantir",
    );
    expect(job.remote).toBe(true);
  });

  it("handles a posting with no categories at all", () => {
    const job = normalizeLeverJob({ ...baseJob, categories: null }, "Palantir");
    expect(job.location).toBeNull();
    expect(job.remote).toBe(false);
  });
});
