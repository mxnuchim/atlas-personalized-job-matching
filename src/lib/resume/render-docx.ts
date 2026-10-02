import "server-only";

import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  TabStopPosition,
  TabStopType,
  TextRun,
} from "docx";

import type { TailoredResume } from "./types";

/**
 * The Word version. Some older applicant-tracking systems parse .docx more reliably than
 * PDF, and recruiters sometimes ask for it. Same rules as the PDF — one column, real text,
 * plain section names — in a font every machine has. Word is full Unicode, so unlike the
 * PDF nothing needs transliterating.
 */

const FONT = "Calibri";
const BODY = 21; // half-points: 10.5pt
const MUTED = "555555";

function run(text: string, opts: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}) {
  return new TextRun({ text, font: FONT, size: opts.size ?? BODY, bold: opts.bold, color: opts.color, italics: opts.italics });
}

function heading(text: string): Paragraph {
  return new Paragraph({
    spacing: { before: 220, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 2 } },
    keepNext: true,
    children: [run(text.toUpperCase(), { bold: true, size: 22 })],
  });
}

/** Title on the left, dates flush right — via a right tab stop, so it stays one line of text. */
function lineWithDates(left: string, dates: string): Paragraph {
  return new Paragraph({
    keepNext: true,
    tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
    spacing: { before: 120 },
    children: [run(left, { bold: true }), ...(dates ? [run(`\t${dates}`, { color: MUTED })] : [])],
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({ bullet: { level: 0 }, spacing: { after: 20 }, children: [run(text)] });
}

function dateRange(start: string | null, end: string | null, current: boolean): string {
  return [start, current ? "Present" : end].filter(Boolean).join(" – ");
}

function contactLine(resume: TailoredResume): string {
  const { contact } = resume;
  return [contact.location, contact.email, contact.phone, ...contact.links.map((l) => l.url)]
    .filter(Boolean)
    .join("  |  ");
}

export async function renderResumeDocx(resume: TailoredResume, title: string): Promise<Buffer> {
  const children: Paragraph[] = [
    new Paragraph({ children: [run(resume.contact.name, { bold: true, size: 36 })] }),
  ];
  if (resume.headline) children.push(new Paragraph({ children: [run(resume.headline, { size: 22 })] }));
  children.push(new Paragraph({ spacing: { after: 80 }, children: [run(contactLine(resume), { size: 18, color: MUTED })] }));

  if (resume.summary) {
    children.push(heading("Summary"), new Paragraph({ children: [run(resume.summary)] }));
  }

  if (resume.roles.length > 0) {
    children.push(heading("Experience"));
    for (const role of resume.roles) {
      children.push(lineWithDates(`${role.title}, ${role.company}`, dateRange(role.start, role.end, role.current)));
      if (role.location) children.push(new Paragraph({ keepNext: true, children: [run(role.location, { size: 19, color: MUTED, italics: true })] }));
      for (const b of role.bullets) children.push(bullet(b.text));
    }
  }

  if (resume.projects.length > 0) {
    children.push(heading("Projects"));
    for (const project of resume.projects) {
      children.push(lineWithDates(project.name, ""));
      if (project.description) children.push(new Paragraph({ children: [run(project.description, { size: 19, color: MUTED })] }));
      for (const b of project.bullets) children.push(bullet(b.text));
    }
  }

  if (resume.skills.length > 0) {
    children.push(heading("Skills"), new Paragraph({ children: [run(resume.skills.join(", "))] }));
  }

  if (resume.education.length > 0) {
    children.push(heading("Education"));
    for (const e of resume.education) {
      const left = [[e.degree, e.field].filter(Boolean).join(" "), e.school].filter(Boolean).join(", ");
      children.push(lineWithDates(left, [e.start, e.end].filter(Boolean).join(" – ")));
    }
  }

  if (resume.certifications.length > 0) {
    children.push(heading("Certifications"));
    for (const c of resume.certifications) {
      children.push(new Paragraph({ children: [run([c.name, c.issuer, c.year].filter(Boolean).join(", "))] }));
    }
  }

  const doc = new Document({
    title,
    creator: resume.contact.name,
    styles: { default: { document: { run: { font: FONT, size: BODY } } } },
    sections: [{ properties: { page: { margin: { top: 720, bottom: 720, left: 860, right: 860 } } }, children }],
  });
  return Packer.toBuffer(doc);
}

export async function renderCoverLetterDocx(resume: TailoredResume, letter: string, title: string): Promise<Buffer> {
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const paragraphs = letter
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        new Paragraph({
          spacing: { after: 180 },
          // Keep the sign-off's own line breaks ("Best regards,\nName").
          children: p.split("\n").flatMap((line, i) => (i === 0 ? [run(line)] : [new TextRun({ break: 1 }), run(line)])),
        }),
    );

  const doc = new Document({
    title,
    creator: resume.contact.name,
    styles: { default: { document: { run: { font: FONT, size: BODY } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } },
        children: [
          new Paragraph({ children: [run(resume.contact.name, { bold: true, size: 32 })] }),
          new Paragraph({ children: [run(contactLine(resume), { size: 18, color: MUTED })] }),
          new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: 360, after: 240 }, children: [run(date, { color: MUTED })] }),
          ...paragraphs,
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
