import { describe, expect, it } from "vitest";

import { ADAPTER_IMPLS, aggregatorConfigSchema } from "./aggregators";

/** All four payloads are shaped from real responses recorded from the live APIs. */

describe("remotive", () => {
  const payload = {
    jobs: [
      {
        id: 2091144,
        url: "https://remotive.com/remote-jobs/x/backend-engineer",
        title: "  Backend Engineer  ",
        company_name: "  TELUS Digital  ",
        candidate_required_location: "USA",
        publication_date: "2026-09-21T12:55:11",
        description: "<p>Own the &amp; API.</p>",
      },
    ],
  };

  it("maps a posting and treats eligibility as the location", () => {
    const [job] = ADAPTER_IMPLS.remotive.normalize(payload);

    expect(job.externalId).toBe("2091144");
    expect(job.title).toBe("Backend Engineer");
    expect(job.company).toBe("TELUS Digital");
    // Remotive states who may apply, not where an office is — that is the restriction
    // the relevance gate needs to read.
    expect(job.location).toBe("USA");
    expect(job.remote).toBe(true);
    expect(job.description).toBe("Own the & API.");
    expect(job.postedAt).toEqual(new Date("2026-09-21T12:55:11"));
  });

  it("passes the limit through as a query parameter", () => {
    expect(ADAPTER_IMPLS.remotive.url(50)).toContain("limit=50");
  });
});

describe("arbeitnow", () => {
  const payload = {
    data: [
      {
        slug: "senior-engineer-berlin-398737",
        url: "https://www.arbeitnow.com/jobs/x",
        title: "Senior Engineer",
        company_name: "TransPerfect",
        location: "Berlin, Berlin, Germany",
        remote: false,
        created_at: 1790487033,
        description: "<p>Join us.</p>",
      },
    ],
  };

  it("maps a posting and reads created_at as epoch seconds", () => {
    const [job] = ADAPTER_IMPLS.arbeitnow.normalize(payload);

    expect(job.externalId).toBe("senior-engineer-berlin-398737");
    expect(job.location).toBe("Berlin, Berlin, Germany");
    expect(job.remote).toBe(false);
    // Seconds, not milliseconds — the wrong unit lands this in 1970.
    expect(job.postedAt).toEqual(new Date(1790487033 * 1000));
  });
});

describe("himalayas", () => {
  const payload = {
    jobs: [
      {
        guid: "https://himalayas.app/companies/aecom/jobs/senior-ict",
        title: "Senior Platform Engineer",
        companyName: "AECOM",
        locationRestrictions: ["United States", "Canada"],
        pubDate: 1790486858,
        applicationLink: "https://himalayas.app/apply/1",
        description: "<p>Remote role.</p>",
      },
    ],
  };

  it("joins the location restrictions and uses the guid as the id", () => {
    const [job] = ADAPTER_IMPLS.himalayas.normalize(payload);

    expect(job.externalId).toBe(payload.jobs[0].guid);
    expect(job.location).toBe("United States, Canada");
    expect(job.url).toBe("https://himalayas.app/apply/1");
    expect(job.remote).toBe(true);
    expect(job.postedAt).toEqual(new Date(1790486858 * 1000));
  });

  it("falls back to the guid when no application link is given", () => {
    const [job] = ADAPTER_IMPLS.himalayas.normalize({
      jobs: [{ ...payload.jobs[0], applicationLink: null }],
    });
    expect(job.url).toBe(payload.jobs[0].guid);
  });

  it("treats an empty restriction list as unstated", () => {
    const [job] = ADAPTER_IMPLS.himalayas.normalize({
      jobs: [{ ...payload.jobs[0], locationRestrictions: [] }],
    });
    expect(job.location).toBeNull();
  });
});

describe("jobicy", () => {
  const payload = {
    jobs: [
      {
        id: 151870,
        url: "https://jobicy.com/jobs/151870-ae",
        jobTitle: "Full-Stack Engineer",
        companyName: "Alma",
        jobGeo: "Italy",
        pubDate: "2026-09-26T11:30:15+00:00",
        jobDescription: "<h3>About</h3><p>Join.</p>",
      },
    ],
  };

  it("maps a posting and accepts a numeric or string id", () => {
    const [job] = ADAPTER_IMPLS.jobicy.normalize(payload);
    expect(job.externalId).toBe("151870");
    expect(job.location).toBe("Italy");
    expect(job.remote).toBe(true);

    const [asString] = ADAPTER_IMPLS.jobicy.normalize({
      jobs: [{ ...payload.jobs[0], id: "151870" }],
    });
    expect(asString.externalId).toBe("151870");
  });
});

describe("aggregatorConfigSchema", () => {
  it("defaults the limit and rejects an unknown adapter", () => {
    expect(aggregatorConfigSchema.parse({ adapter: "jobicy" }).limit).toBe(100);
    expect(() => aggregatorConfigSchema.parse({ adapter: "linkedin" })).toThrow();
  });
});
