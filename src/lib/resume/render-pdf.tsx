import "server-only";

import { Document, Font, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";

import { pdfSafe } from "./text";
import type { TailoredResume } from "./types";

/**
 * No hyphenation, ever. By default react-pdf splits long words at line ends — it turned
 * "github.com/jrivera-example" into "jrivera-ex-" / "ample" in our own read-back test.
 * A parser indexes the pieces, so "infrastructure" split across a line stops matching the
 * keyword it is. Whole words wrap whole.
 */
Font.registerHyphenationCallback((word) => [word]);

/**
 * The PDF, built for applicant-tracking systems first and people second — which turns out
 * to be the same thing:
 *  - one column, in reading order, so a parser can't scramble experience and skills;
 *  - real text in a standard font (Helvetica — nothing embedded, nothing to mis-map);
 *  - plain section names a parser recognises (Experience, Skills, Education);
 *  - contact details in the body, never in a page header a parser may skip.
 * Every string passes through `pdfSafe` first: an unencodable glyph doesn't fail, it
 * silently turns into the wrong character, and the wrong character is what gets indexed.
 */

const INK = "#111111";
const MUTED = "#555555";

const s = StyleSheet.create({
  page: {
    paddingTop: 38,
    paddingBottom: 38,
    paddingHorizontal: 44,
    fontFamily: "Helvetica",
    fontSize: 10,
    lineHeight: 1.35,
    color: INK,
  },
  name: { fontFamily: "Helvetica-Bold", fontSize: 19, lineHeight: 1.1 },
  headline: { fontSize: 11, marginTop: 3, color: INK },
  contact: { fontSize: 9, marginTop: 4, color: MUTED },
  section: { marginTop: 12 },
  heading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10.5,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingBottom: 2,
    borderBottomWidth: 0.75,
    borderBottomColor: "#999999",
    marginBottom: 6,
  },
  role: { marginBottom: 7 },
  roleRow: { flexDirection: "row", justifyContent: "space-between" },
  roleTitle: { fontFamily: "Helvetica-Bold", flexShrink: 1, paddingRight: 8 },
  dates: { color: MUTED, flexShrink: 0 },
  sub: { color: MUTED, fontSize: 9.5, marginBottom: 2 },
  bullet: { flexDirection: "row", marginTop: 1.5 },
  bulletMark: { width: 10 },
  bulletText: { flex: 1 },
  paragraph: { marginBottom: 8 },
});

function dateRange(start: string | null, end: string | null, current: boolean): string {
  const finish = current ? "Present" : end;
  return [start, finish].filter(Boolean).join(" – ");
}

function contactLine(resume: TailoredResume): string {
  const { contact } = resume;
  return [contact.location, contact.email, contact.phone, ...contact.links.map((l) => l.url)]
    .filter(Boolean)
    .join("  |  ");
}

function Bullets({ items }: { items: { text: string }[] }) {
  return (
    <>
      {items.map((b, i) => (
        <View key={i} style={s.bullet}>
          <Text style={s.bulletMark}>•</Text>
          <Text style={s.bulletText}>{pdfSafe(b.text)}</Text>
        </View>
      ))}
    </>
  );
}

function ResumeDocument({ resume, title }: { resume: TailoredResume; title: string }) {
  const name = pdfSafe(resume.contact.name);
  return (
    <Document title={pdfSafe(title)} author={name} creator="Atlas" producer="Atlas">
      <Page size="A4" style={s.page}>
        <Text style={s.name}>{name}</Text>
        {resume.headline ? <Text style={s.headline}>{pdfSafe(resume.headline)}</Text> : null}
        <Text style={s.contact}>{pdfSafe(contactLine(resume))}</Text>

        {resume.summary ? (
          <View style={s.section}>
            <Text style={s.heading} minPresenceAhead={30}>Summary</Text>
            <Text>{pdfSafe(resume.summary)}</Text>
          </View>
        ) : null}

        {resume.roles.length > 0 ? (
          <View style={s.section}>
            <Text style={s.heading} minPresenceAhead={50}>Experience</Text>
            {resume.roles.map((role) => (
              <View key={role.id} style={s.role} wrap>
                <View style={s.roleRow} minPresenceAhead={24}>
                  <Text style={s.roleTitle}>{pdfSafe(`${role.title}, ${role.company}`)}</Text>
                  <Text style={s.dates}>{pdfSafe(dateRange(role.start, role.end, role.current))}</Text>
                </View>
                {role.location ? <Text style={s.sub}>{pdfSafe(role.location)}</Text> : null}
                <Bullets items={role.bullets} />
              </View>
            ))}
          </View>
        ) : null}

        {resume.projects.length > 0 ? (
          <View style={s.section}>
            <Text style={s.heading} minPresenceAhead={40}>Projects</Text>
            {resume.projects.map((project) => (
              <View key={project.id} style={s.role}>
                <Text style={s.roleTitle}>{pdfSafe(project.name)}</Text>
                {project.description ? <Text style={s.sub}>{pdfSafe(project.description)}</Text> : null}
                <Bullets items={project.bullets} />
              </View>
            ))}
          </View>
        ) : null}

        {resume.skills.length > 0 ? (
          <View style={s.section}>
            <Text style={s.heading} minPresenceAhead={24}>Skills</Text>
            <Text>{pdfSafe(resume.skills.join(", "))}</Text>
          </View>
        ) : null}

        {resume.education.length > 0 ? (
          <View style={s.section}>
            <Text style={s.heading} minPresenceAhead={24}>Education</Text>
            {resume.education.map((e, i) => (
              <View key={i} style={s.roleRow}>
                <Text style={s.roleTitle}>
                  {pdfSafe([[e.degree, e.field].filter(Boolean).join(" "), e.school].filter(Boolean).join(", "))}
                </Text>
                <Text style={s.dates}>{pdfSafe([e.start, e.end].filter(Boolean).join(" – "))}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {resume.certifications.length > 0 ? (
          <View style={s.section}>
            <Text style={s.heading} minPresenceAhead={24}>Certifications</Text>
            {resume.certifications.map((c, i) => (
              <Text key={i}>{pdfSafe([c.name, c.issuer, c.year].filter(Boolean).join(", "))}</Text>
            ))}
          </View>
        ) : null}
      </Page>
    </Document>
  );
}

function CoverLetterDocument({ resume, letter, title }: { resume: TailoredResume; letter: string; title: string }) {
  const name = pdfSafe(resume.contact.name);
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  return (
    <Document title={pdfSafe(title)} author={name} creator="Atlas" producer="Atlas">
      <Page size="A4" style={{ ...s.page, fontSize: 10.5, lineHeight: 1.5 }}>
        <Text style={s.name}>{name}</Text>
        <Text style={s.contact}>{pdfSafe(contactLine(resume))}</Text>
        <Text style={{ marginTop: 18, marginBottom: 14, color: MUTED }}>{date}</Text>
        {letter
          .split(/\n{2,}/)
          .map((p) => p.trim())
          .filter(Boolean)
          .map((paragraph, i) => (
            <Text key={i} style={s.paragraph}>
              {pdfSafe(paragraph)}
            </Text>
          ))}
      </Page>
    </Document>
  );
}

export async function renderResumePdf(resume: TailoredResume, title: string): Promise<Buffer> {
  return renderToBuffer(<ResumeDocument resume={resume} title={title} />);
}

export async function renderCoverLetterPdf(resume: TailoredResume, letter: string, title: string): Promise<Buffer> {
  return renderToBuffer(<CoverLetterDocument resume={resume} letter={letter} title={title} />);
}
