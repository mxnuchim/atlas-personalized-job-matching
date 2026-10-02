import { describe, expect, it } from "vitest";

import { addsUnsupportedOutcome, assembleTailored, type TailorOutput } from "./assemble";
import {
  classifyRequirement,
  coverageContext,
  findTerms,
  lexiconCoverage,
  mentions,
  resumeTerms,
  withImplied,
} from "./keywords";
import { buildReport, coveragePercent, dedupeKeywords } from "./report";
import { documentFileName, numbersIn, pdfSafe, tidyName, yearsOfExperience } from "./text";
import type { MasterResume, Requirements } from "./types";

const master: MasterResume = {
  contact: {
    name: "Manuchim Oliver",
    email: "m@example.com",
    phone: null,
    location: "Lagos, Nigeria",
    links: [{ label: "Portfolio", url: "https://example.com" }],
  },
  headline: "Senior Platform Engineer",
  summary: "Platform engineer who builds and operates cloud infrastructure.",
  roles: [
    {
      id: "r1",
      company: "Senta",
      title: "Senior Platform Engineer",
      location: "Remote",
      start: "Jan 2021",
      end: null,
      current: true,
      bullets: [
        { id: "r1b1", text: "Built AWS infrastructure from zero to production with Terraform, reaching 99.9% uptime." },
        { id: "r1b2", text: "Cut incident MTTR to under 5 minutes by introducing Datadog alerting." },
        { id: "r1b3", text: "Set up GitHub Actions pipelines for 12 services." },
      ],
    },
    {
      id: "r2",
      company: "Acme",
      title: "Backend Engineer",
      location: "Lagos",
      start: "2018",
      end: "2020",
      current: false,
      bullets: [
        { id: "r2b1", text: "Wrote Node.js services handling 1,200 requests per second." },
        { id: "r2b2", text: "Designed PostgreSQL schemas for the payments ledger." },
      ],
    },
  ],
  projects: [],
  education: [
    { school: "University of Lagos", degree: "BSc", field: "Computer Science", start: null, end: "2017", details: null },
  ],
  skills: ["AWS", "Terraform", "k8s", "Node.js", "PostgreSQL"],
  certifications: [],
  confirmedSkills: [],
};

describe("findTerms", () => {
  it("resolves aliases to one canonical term", () => {
    expect(findTerms("k8s on Amazon Web Services")).toEqual(new Set(["Kubernetes", "AWS"]));
  });

  it("ignores ordinary English that collides with a technology name", () => {
    expect(findTerms("We react quickly and express ideas at the helm")).toEqual(new Set());
    expect(findTerms("Own our go to market and Go-to-market motion")).toEqual(new Set());
    expect(findTerms("Work with the rest of the team on each node")).toEqual(new Set());
  });

  it("still finds those terms when they are the technology", () => {
    expect(findTerms("Services written in Go and React, deployed with Helm")).toEqual(
      new Set(["Go", "React", "Helm"]),
    );
    expect(findTerms("Golang, RESTful APIs, Express.js")).toEqual(new Set(["Go", "REST APIs", "Express"]));
  });

  it("handles symbols in names", () => {
    expect(findTerms("C++ and C# and .NET and CI/CD")).toEqual(new Set(["C++", "C#", ".NET", "CI/CD"]));
  });

  it("prefers the longest form at a position", () => {
    expect(findTerms("Shipped with React Native")).toContain("React Native");
  });
});

describe("withImplied", () => {
  it("follows implications transitively", () => {
    const implied = withImplied(["EKS"]);
    expect(implied).toContain("Kubernetes");
    expect(implied).toContain("AWS");
  });
});

describe("lexiconCoverage", () => {
  it("counts the posting's technical terms the resume can claim", () => {
    const claimable = resumeTerms(master);
    const result = lexiconCoverage(
      "We use Kubernetes, Terraform, infrastructure as code and Rust on AWS.",
      claimable,
    );
    // Kubernetes (k8s), Terraform, IaC (implied by Terraform), AWS — not Rust.
    expect(result).toEqual({ matched: 4, total: 5, missing: ["Rust"] });
  });
});

describe("mentions", () => {
  it("matches non-lexicon phrases on word boundaries", () => {
    expect(mentions("Strong stakeholder management skills", { term: "stakeholder management", aliases: [] })).toBe(true);
    expect(mentions("stakeholders", { term: "stakeholder", aliases: [] })).toBe(false);
  });
});

describe("classifyRequirement", () => {
  const ctx = coverageContext({ ...master, confirmedSkills: ["Kafka"] });

  it("separates what the file says, what it implies, what you confirmed, and gaps", () => {
    expect(classifyRequirement({ term: "Terraform", aliases: [] }, ctx)).toBe("covered");
    expect(classifyRequirement({ term: "Infrastructure as Code", aliases: ["IaC"] }, ctx)).toBe("implied");
    expect(classifyRequirement({ term: "Kafka", aliases: [] }, ctx)).toBe("confirmed");
    expect(classifyRequirement({ term: "Rust", aliases: [] }, ctx)).toBe("missing");
  });
});

describe("text helpers", () => {
  it("normalises numbers so the guard compares like with like", () => {
    expect(numbersIn("1,200 rps, 99.9% uptime, <5min")).toEqual(new Set(["1200", "99.9", "5"]));
  });

  it("makes text safe for the PDF's standard font without losing meaning", () => {
    expect(pdfSafe("0→production ≥ 99.9% · café – done ✓")).toBe("0->production >= 99.9% · café – done ");
    // Ọ is outside the font's encoding, so it's transliterated; á is inside, so it's kept.
    expect(pdfSafe("Ọlá 🚀")).toBe("Olá ");
  });

  it("names files the way a recruiter wants to see them", () => {
    expect(
      documentFileName({
        name: "Manuchim Oliver",
        kind: "Resume",
        company: "Cohere",
        title: "Senior Platform Engineer, Infra (NA)",
        ext: "pdf",
      }),
    ).toBe("Manuchim-Oliver-Resume-Cohere-Senior-Platform-Engineer-Infra-NA.pdf");
  });

  it("derives years of experience from the earliest dated role", () => {
    expect(yearsOfExperience(master, new Date("2026-10-02"))).toBe(8);
  });

  it("title-cases names set in capitals, and only those", () => {
    expect(tidyName("JORDAN RIVERA")).toBe("Jordan Rivera");
    expect(tidyName("SEÁN O'BRIEN-KAY")).toBe("Seán O'Brien-Kay");
    expect(tidyName("Anna van der Berg")).toBe("Anna van der Berg");
  });
});

describe("addsUnsupportedOutcome", () => {
  // Every "true" case below is a real embellishment from a smoke run.
  it("catches unmeasured outcomes tacked onto a true line", () => {
    expect(
      addsUnsupportedOutcome(
        "Delivered 12 client websites with React and a headless CMS, improving developer delivery practices.",
        "Delivered 12 client websites with React and a headless CMS.",
      ),
    ).toBe(true);
    expect(
      addsUnsupportedOutcome(
        "Built Node.js (Express) APIs for shipment tracking used by 150,000 monthly users to improve service reliability.",
        "Built Node.js (Express) APIs for shipment tracking used by 150,000 monthly users.",
      ),
    ).toBe(true);
    expect(
      addsUnsupportedOutcome(
        "Ran PCI DSS audit evidence collection for the card-data environment, supporting compliance for platform services.",
        "Ran PCI DSS audit evidence collection for the card-data environment.",
      ),
    ).toBe(true);
  });

  it("allows a real result restated with its number, and outcomes the source already claimed", () => {
    expect(
      addsUnsupportedOutcome(
        "Migrated 40 services from EC2 to EKS, reducing compute cost 32%.",
        "Led migration of 40 services from EC2 to EKS, cutting compute cost 32%.",
      ),
    ).toBe(false);
    expect(
      addsUnsupportedOutcome(
        "Added Datadog SLOs, improving MTTR visibility for on-call.",
        "Introduced Datadog SLOs, improving MTTR visibility.",
      ),
    ).toBe(false);
    expect(addsUnsupportedOutcome("Set up Nginx on Linux VPS hosting.", "Set up Nginx on Linux VPS hosting.")).toBe(false);
  });
});

const baseOutput: TailorOutput = {
  headline: "Senior Platform Engineer",
  summary: "Platform engineer with 8 years building AWS infrastructure.",
  roles: [
    {
      roleId: "r1",
      bullets: [
        { sourceId: "r1b1", text: "Built AWS infrastructure as code with Terraform from zero to production at 99.9% uptime." },
        { sourceId: "r1b3", text: "Built CI/CD with GitHub Actions for 12 services." },
      ],
    },
    { roleId: "r2", bullets: [{ sourceId: "r2b1", text: "Built Node.js services at 1,200 requests per second." }] },
  ],
  skills: ["Terraform", "Kubernetes", "AWS"],
};

describe("assembleTailored", () => {
  const now = new Date("2026-10-02");

  it("keeps faithful rewrites, including terms the source implies", () => {
    const { resume, reverted } = assembleTailored(master, baseOutput, now);
    expect(reverted).toBe(0);
    expect(resume.roles[0]!.bullets.map((b) => b.text)).toEqual([
      "Built AWS infrastructure as code with Terraform from zero to production at 99.9% uptime.",
      "Built CI/CD with GitHub Actions for 12 services.",
    ]);
  });

  it("copies every fact from the master, never from the model", () => {
    const { resume } = assembleTailored(master, baseOutput, now);
    expect(resume.roles.map((r) => [r.company, r.title, r.start, r.end])).toEqual([
      ["Senta", "Senior Platform Engineer", "Jan 2021", null],
      ["Acme", "Backend Engineer", "2018", "2020"],
    ]);
    expect(resume.education).toEqual(master.education);
    expect(resume.contact).toEqual(master.contact);
  });

  it("reverts a line that invents a number", () => {
    const { resume, reverted } = assembleTailored(
      master,
      { ...baseOutput, roles: [{ roleId: "r1", bullets: [{ sourceId: "r1b1", text: "Built AWS at 99.99% uptime." }] }] },
      now,
    );
    expect(reverted).toBe(1);
    expect(resume.roles[0]!.bullets[0]!.text).toBe(master.roles[0]!.bullets[0]!.text);
  });

  it("reverts a line that claims a technology its source never used", () => {
    const { resume, reverted } = assembleTailored(
      master,
      { ...baseOutput, roles: [{ roleId: "r1", bullets: [{ sourceId: "r1b2", text: "Cut MTTR under 5 minutes on Kubernetes with Datadog." }] }] },
      now,
    );
    expect(reverted).toBe(1);
    expect(resume.roles[0]!.bullets[0]!.text).toBe(master.roles[0]!.bullets[1]!.text);
  });

  it("never lets a confirmed skill into a bullet, but allows it in the summary and skills", () => {
    const withKafka = { ...master, confirmedSkills: ["Kafka"] };
    const { resume, reverted } = assembleTailored(
      withKafka,
      {
        ...baseOutput,
        summary: "Platform engineer working with Kafka and AWS.",
        roles: [{ roleId: "r1", bullets: [{ sourceId: "r1b3", text: "Set up GitHub Actions and Kafka for 12 services." }] }],
        skills: ["Kafka"],
      },
      now,
    );
    expect(reverted).toBe(1);
    expect(resume.roles[0]!.bullets[0]!.text).toBe(master.roles[0]!.bullets[2]!.text);
    expect(resume.summary).toContain("Kafka");
    expect(resume.skills[0]).toBe("Kafka");
  });

  it("drops a bullet cited against another role", () => {
    const { resume, reverted } = assembleTailored(
      master,
      { ...baseOutput, roles: [{ roleId: "r1", bullets: [{ sourceId: "r2b1", text: "Node.js at 1,200 rps." }] }] },
      now,
    );
    expect(reverted).toBe(1);
    // r1 then falls back to its own first lines rather than appearing empty.
    expect(resume.roles[0]!.bullets.map((b) => b.sourceId)).toEqual(["r1b1", "r1b2"]);
  });

  it("drops summary sentences with invented numbers but allows derived years of experience", () => {
    const { resume, reverted } = assembleTailored(
      master,
      { ...baseOutput, summary: "Platform engineer with 8 years on AWS. Saved $4M in cloud spend." },
      now,
    );
    expect(reverted).toBe(1);
    expect(resume.summary).toBe("Platform engineer with 8 years on AWS.");
  });

  it("falls back to the master headline when the model's claims something unsupported", () => {
    const { resume } = assembleTailored(master, { ...baseOutput, headline: "Rust Platform Engineer" }, now);
    expect(resume.headline).toBe("Senior Platform Engineer");
  });

  it("orders relevant skills first, dedupes aliases, and keeps the rest of your skills", () => {
    const { resume, reverted } = assembleTailored(
      master,
      { ...baseOutput, skills: ["Terraform", "Kubernetes", "Rust", "AWS"] },
      now,
    );
    expect(reverted).toBe(1); // Rust — not claimable
    expect(resume.skills).toEqual(["Terraform", "Kubernetes", "AWS", "Node.js", "PostgreSQL"]);
  });
});

describe("buildReport", () => {
  const requirements: Requirements = {
    title: "Platform Engineer",
    company: "Cohere",
    seniority: "Senior",
    mustHave: [
      { term: "Terraform", aliases: [], kind: "tool" },
      { term: "Kubernetes", aliases: ["k8s"], kind: "tool" },
      { term: "k8s", aliases: [], kind: "tool" },
      { term: "Rust", aliases: [], kind: "skill" },
    ],
    niceToHave: [{ term: "PostgreSQL", aliases: ["Postgres"], kind: "tool" }],
    responsibilities: [],
  };

  it("measures coverage on the tailored page and dedupes repeated requirements", () => {
    const { resume } = assembleTailored(master, baseOutput, new Date("2026-10-02"));
    const report = buildReport(requirements, master, resume, 0);
    expect(report.mustHave.map((k) => [k.term, k.status])).toEqual([
      ["Terraform", "covered"],
      ["Kubernetes", "covered"],
      ["Rust", "missing"],
    ]);
    expect(report.coverage.mustHave).toEqual({ matched: 2, total: 3 });
    expect(coveragePercent(report)).toBe(67);
    expect(dedupeKeywords(requirements.mustHave)).toHaveLength(3);
  });
});
