import { describe, expect, it } from "vitest";

import { normalizeAshbyJob } from "./ashby";

/** Shaped from a real api.ashbyhq.com posting. */
const baseJob = {
  id: "d3bc1ced-3ce4-4086-a050-555055dbb1ff",
  title: "  Senior Fullstack Engineer  ",
  location: "Europe",
  isRemote: true,
  isListed: true,
  publishedAt: "2021-04-27T20:13:45.158+00:00",
  jobUrl: "https://jobs.ashbyhq.com/linear/d3bc1ced",
  descriptionPlain: "Build the product development system.",
  descriptionHtml: "<p>Build the <b>product</b> development system.</p>",
};

describe("normalizeAshbyJob", () => {
  it("maps fields and trims the title", () => {
    const job = normalizeAshbyJob(baseJob, "Linear");

    expect(job.externalId).toBe(baseJob.id);
    expect(job.title).toBe("Senior Fullstack Engineer");
    expect(job.company).toBe("Linear");
    expect(job.location).toBe("Europe");
    expect(job.url).toBe(baseJob.jobUrl);
    expect(job.postedAt).toEqual(new Date("2021-04-27T20:13:45.158+00:00"));
  });

  it("prefers the plain description over the HTML one", () => {
    expect(normalizeAshbyJob(baseJob, "Linear").description).toBe(
      "Build the product development system.",
    );
  });

  it("falls back to the HTML description", () => {
    const job = normalizeAshbyJob({ ...baseJob, descriptionPlain: undefined }, "Linear");
    expect(job.description).toBe("Build the product development system.");
  });

  it("trusts isRemote when it is stated", () => {
    expect(normalizeAshbyJob({ ...baseJob, isRemote: false }, "Linear").remote).toBe(false);
  });

  it("reads the location when isRemote is null", () => {
    // A third of OpenAI's board publishes isRemote as null; null means "not stated",
    // not "not remote", so the location has to answer it.
    expect(
      normalizeAshbyJob({ ...baseJob, isRemote: null, location: "Remote - US" }, "X").remote,
    ).toBe(true);
    expect(
      normalizeAshbyJob({ ...baseJob, isRemote: null, location: "San Francisco" }, "X").remote,
    ).toBe(false);
  });

  it("treats a missing location as unknown rather than empty", () => {
    expect(normalizeAshbyJob({ ...baseJob, location: null }, "Linear").location).toBeNull();
  });
});
