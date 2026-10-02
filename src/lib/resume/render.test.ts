import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import { describe, expect, it } from "vitest";

import { renderCoverLetterDocx, renderResumeDocx } from "./render-docx";
import { renderCoverLetterPdf, renderResumePdf } from "./render-pdf";
import type { TailoredResume } from "./types";

/**
 * Render, then read back the way an applicant-tracking system does — by extracting text.
 * The point isn't that a file is produced; it's that a parser gets every word, in reading
 * order, with no character silently swapped for another.
 */

const resume: TailoredResume = {
  contact: {
    name: "Jordan Rivera",
    email: "jordan@example.com",
    phone: null,
    location: "Lisbon, Portugal",
    links: [{ label: "GitHub", url: "github.com/jrivera-example" }],
  },
  headline: "Senior Platform Engineer — AWS & Kubernetes",
  summary: "Platform engineer who builds and runs cloud infrastructure.",
  roles: [
    {
      id: "r1",
      company: "Northwind Pay",
      title: "Senior Platform Engineer",
      location: "Remote",
      start: "Jan 2022",
      end: null,
      current: true,
      bullets: [
        { sourceId: "r1b1", text: "Wrote a Kubernetes operator automating backups → restores across 3 regions." },
        { sourceId: "r1b2", text: "Cut p99 latency to ≤ 80ms for 1,200 requests per second." },
      ],
    },
  ],
  projects: [],
  education: [{ school: "University of Porto", degree: "BSc", field: "Computer Engineering", start: "2011", end: "2015", details: null }],
  skills: ["Kubernetes", "Terraform", "Go"],
  certifications: [{ name: "Certified Kubernetes Administrator (CKA)", issuer: "CNCF", year: "2023" }],
};

async function pdfText(buffer: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  return (await extractText(pdf, { mergePages: true })).text;
}

describe("resume PDF", () => {
  it("reads back complete and in order", async () => {
    const text = await pdfText(await renderResumePdf(resume, "Resume"));
    const order = ["Jordan Rivera", "Senior Platform Engineer", "Summary", "Experience", "Northwind Pay", "Skills", "Education", "Certifications"];
    const positions = order.map((s) => text.toLowerCase().indexOf(s.toLowerCase()));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("never hyphenates — a split URL or keyword is what a parser would index", async () => {
    const longLink = { label: "GitHub", url: "github.com/jrivera-example-with-a-long-handle/platform-tooling" };
    const text = await pdfText(
      await renderResumePdf(
        {
          ...resume,
          contact: { ...resume.contact, links: [longLink, longLink] },
          summary:
            "Infrastructure infrastructure infrastructure observability observability internationalization internationalization responsibilities.",
        },
        "Resume",
      ),
    );
    const flat = text.replace(/\s+/g, " ");
    expect(flat).toContain("github.com/jrivera-example-with-a-long-handle/platform-tooling");
    expect(text).not.toMatch(/[a-z]-\n[a-z]/);
  });

  it("maps symbols the font can't encode instead of corrupting them", async () => {
    const text = await pdfText(await renderResumePdf(resume, "Resume"));
    expect(text).toContain("backups -> restores");
    expect(text).toContain("<= 80ms");
    expect(text).toContain("1,200");
    // The em dash is in the font's encoding, so it survives as itself.
    expect(text).toContain("—");
  });
});

describe("resume DOCX", () => {
  it("reads back complete, keeping Unicode as written", async () => {
    const buffer = await renderResumeDocx(resume, "Resume");
    const { value } = await mammoth.extractRawText({ buffer });
    expect(value).toContain("Jordan Rivera");
    expect(value).toContain("backups → restores");
    expect(value).toContain("Kubernetes, Terraform, Go");
    expect(value.indexOf("EXPERIENCE")).toBeLessThan(value.indexOf("SKILLS"));
  });
});

describe("cover letter", () => {
  const letter = "Dear Hiring Team,\n\nI led the migration.\n\nBest regards,\nJordan Rivera";

  it("renders every paragraph to PDF and DOCX", async () => {
    const pdf = await pdfText(await renderCoverLetterPdf(resume, letter, "Cover letter"));
    expect(pdf).toContain("Dear Hiring Team,");
    expect(pdf).toContain("I led the migration.");

    const { value } = await mammoth.extractRawText({ buffer: await renderCoverLetterDocx(resume, letter, "Cover letter") });
    expect(value).toContain("I led the migration.");
    expect(value).toContain("Best regards,");
  });
});
