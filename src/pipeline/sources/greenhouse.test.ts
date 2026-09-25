import { describe, expect, it } from "vitest";

import { normalizeGreenhouseJob } from "./greenhouse";

const baseJob = {
  id: 12345,
  title: "  Senior Software Engineer  ",
  absolute_url: "https://boards.greenhouse.io/vercel/jobs/12345",
  updated_at: "2026-01-15T10:00:00.000Z",
  location: { name: "Remote - US" },
  content: "&lt;p&gt;Build &amp; ship great software.&lt;/p&gt;",
};

describe("normalizeGreenhouseJob", () => {
  it("maps fields, trims, stringifies the id, and decodes HTML content", () => {
    const job = normalizeGreenhouseJob(baseJob, "Vercel");

    expect(job.externalId).toBe("12345");
    expect(job.title).toBe("Senior Software Engineer");
    expect(job.company).toBe("Vercel");
    expect(job.url).toBe(baseJob.absolute_url);
    expect(job.description).toBe("Build & ship great software.");
    expect(job.postedAt).toEqual(new Date("2026-01-15T10:00:00.000Z"));
  });

  it("detects remote from the location name", () => {
    expect(normalizeGreenhouseJob(baseJob, "Vercel").remote).toBe(true);
  });

  it("treats a physical location as non-remote and keeps the name", () => {
    const job = normalizeGreenhouseJob(
      { ...baseJob, location: { name: "New York, NY" } },
      "Vercel",
    );
    expect(job.remote).toBe(false);
    expect(job.location).toBe("New York, NY");
  });

  it("handles missing location, content, and date", () => {
    const job = normalizeGreenhouseJob(
      { id: 7, title: "Designer", absolute_url: "https://x.co/7" },
      "Acme",
    );
    expect(job.location).toBeNull();
    expect(job.remote).toBe(false);
    expect(job.description).toBe("");
    expect(job.postedAt).toBeNull();
  });
});
