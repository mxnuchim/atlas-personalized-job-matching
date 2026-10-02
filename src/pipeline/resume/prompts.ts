import type { PreCoverage } from "@/lib/resume/keywords";
import type { MasterResume, RequirementKeyword, Requirements } from "@/lib/resume/types";

/**
 * Prompts for the resume feature.
 *
 * Cost shape: every tailoring and cover-letter call opens its `system` prefix with the
 * candidate's master resume, which is identical across their generations. OpenAI bills a
 * repeated prefix (≥1024 tokens) at the cached rate — a tenth of the price — so the
 * second and later resumes for the same person pay full price only for what's new.
 */

export const PARSE_SYSTEM = `You convert a resume into structured data. You copy; you do not write.

Rules:
- Copy every bullet VERBATIM. Only repair text-extraction damage: words split across lines, broken spacing. Never rephrase, merge, split, shorten or summarise a bullet.
- Never invent anything. If something isn't in the text, use null or an empty list.
- roles: every job, in the order the resume lists them (normally most recent first). One entry per title held — if someone held two titles at one company, that is two roles.
- Dates exactly as written ("Jan 2021", "2019", "03/2020"). If the role is ongoing ("Present", "Current", "Now"), set current=true and end=null.
- skills: only items listed in a skills/technologies section, as written. Do not infer skills from bullets.
- projects: only a dedicated projects section.
- headline: the title line under the name, if there is one. summary: the summary/profile paragraph verbatim, if there is one.
- contact.links: each URL with a short label (LinkedIn, GitHub, Portfolio, Website).
- education and certifications exactly as written.`;

export const REQUIREMENTS_SYSTEM = `You extract what a job description asks for, so a resume can be checked against it the way an applicant-tracking system and a recruiter's keyword search would.

- mustHave: requirements the posting marks as required, minimum or essential — and any technology clearly central to the role. At most 20.
- niceToHave: anything marked preferred, bonus, "a plus", "nice to have". At most 15.
- term: the keyword as THIS posting writes it — keep its spelling and capitalisation. Put other common spellings in aliases. Example: "Amazon Web Services (AWS)" → term "AWS", aliases ["Amazon Web Services"].
- Prefer concrete, searchable keywords: technologies, tools, platforms, methodologies, domains, certifications. Include a soft skill only when the posting stresses it.
- Each term is 1-4 words. Never a sentence. No duplicates.
- Not keywords, so leave them out: years of experience ("6+ years"), degree requirements, location, work authorisation, salary.
- kind: skill (languages, disciplines), tool (products, platforms, services), domain (industry or problem space), certification, soft.
- title: the role title as posted. company: if stated. seniority: if stated or unambiguous.
- responsibilities: up to 8 short phrases naming what the person will actually do.`;

/** Compact JSON of the master, ids included — the model cites them, the reader never sees them. */
export function masterForPrompt(master: MasterResume): string {
  return JSON.stringify({
    headline: master.headline,
    summary: master.summary,
    roles: master.roles.map((r) => ({
      roleId: r.id,
      title: r.title,
      company: r.company,
      dates: [r.start, r.current ? "Present" : r.end].filter(Boolean).join(" – "),
      bullets: r.bullets.map((b) => ({ id: b.id, text: b.text })),
    })),
    projects: master.projects.map((p) => ({
      projectId: p.id,
      name: p.name,
      bullets: p.bullets.map((b) => ({ id: b.id, text: b.text })),
    })),
    skills: master.skills,
    confirmedSkills: master.confirmedSkills,
    certifications: master.certifications.map((c) => c.name),
    education: master.education.map((e) => [e.degree, e.field, e.school].filter(Boolean).join(", ")),
  });
}

function masterPreamble(master: MasterResume): string {
  return `THE CANDIDATE'S MASTER RESUME. Ids (roleId, projectId, id) are internal references for you to cite — never write one in any text a reader will see.\n${masterForPrompt(master)}`;
}

const TAILOR_RULES = `YOUR TASK: tailor the master resume above to one job. You select, order and reword. You never add facts.

Hard rules — a line that breaks one is thrown away and replaced with the original:
1. Every bullet you output cites sourceId: the id of the master bullet it rewrites, from the SAME role (roleId) or project. One output bullet per source bullet. Never merge or split.
2. Keep every number exactly as the source bullet has it. Never add a metric, percentage, team size, money figure or duration.
3. Name only the technologies the source bullet names. You MAY use the posting's word for something the bullet already shows — a Terraform bullet can say "infrastructure as code", a GitHub Actions bullet can say "CI/CD".
4. Never append a purpose or outcome the source doesn't state — no ", improving developer experience", "to increase reliability", "supporting compliance". If a bullet already reads well and has nothing this posting cares about to surface, return it unchanged. Unchanged is a good answer.
5. Don't write employers, titles or dates — they are copied in separately.
6. A keyword marked [missing] isn't in the candidate's words. Use it ONLY inside a bullet that plainly demonstrates it ("across 3 regions" demonstrates "multi-region") — never in the summary, headline or skills, and never for a technology the bullet doesn't name.

What to do:
- Order each role's bullets by relevance to this job; drop the least relevant. Most recent role: up to 6. Next: up to 5. Then 4, then 3. Older roles: 2. Every role keeps at least one bullet.
- Rewrite bullets to foreground what this posting cares about, using its exact phrasing where the bullet supports it ([covered] and [implied] keywords especially).
- Bullet style: open with a strong verb, impact first, under 30 words, no "I", no filler. Keep the source's tense. A completed achievement with a result stays in the past tense even in a current role ("Led the migration…", not "Lead the migration…"); present tense is only for ongoing responsibilities.
- summary: 2-3 sentences, under 60 words, positioning the candidate for THIS role. Weave in the most important [covered], [implied] and [confirmed] must-have keywords. If the posting asks for years of experience and the dates support it, state the candidate's years. No other numbers unless they appear in the resume. Never "passionate", "results-driven", "dynamic", "synergy".
- headline: under 8 words, the target role framed truthfully for this candidate (e.g. "Senior Platform Engineer — AWS & Kubernetes").
- skills: the posting-relevant ones first, spelled as the posting spells them. Only skills the master lists, confirmed skills, or technologies the resume's bullets show.`;

export function tailorSystem(master: MasterResume): string {
  return `${masterPreamble(master)}\n\n${TAILOR_RULES}`;
}

function keywordLines(
  keywords: RequirementKeyword[],
  status: (k: RequirementKeyword) => PreCoverage,
): string {
  if (keywords.length === 0) return "  (none)";
  return keywords.map((k) => `  - ${k.term} [${status(k)}]`).join("\n");
}

export function tailorPrompt(params: {
  requirements: Requirements;
  status: (k: RequirementKeyword) => PreCoverage;
}): string {
  const { requirements: r, status } = params;
  return [
    `TARGET ROLE: ${r.title}${r.company ? ` at ${r.company}` : ""}${r.seniority ? ` (${r.seniority})` : ""}`,
    r.responsibilities.length > 0 ? `THEY WILL:\n${r.responsibilities.map((x) => `  - ${x}`).join("\n")}` : "",
    `MUST-HAVE KEYWORDS (status against the master):\n${keywordLines(r.mustHave, status)}`,
    `NICE-TO-HAVE KEYWORDS:\n${keywordLines(r.niceToHave, status)}`,
    "[covered] = the resume says it · [implied] = the resume shows it under another name · [confirmed] = the candidate confirmed it · [missing] = unsupported, never use",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const COVER_RULES = `YOUR TASK: write a cover letter for one job, as the candidate, in the first person.

- 180-260 words. 3 or 4 short paragraphs separated by a blank line. Plain text — no markdown, no placeholders like [Company].
- Open with a complete sentence that names the role, then the single strongest reason this candidate fits: one concrete achievement from the resume, with its real number.
- Then two or three proofs from the resume that map to what this posting needs. Specific, not adjectives.
- Close with one direct, low-key line about talking further.
- Use only facts from the master resume. Every number about the candidate must appear in it, exactly. Never claim a technology or a [missing] keyword the resume doesn't support, and never characterise the work beyond what it says (don't call it "multi-cluster" if the resume doesn't).
- Never write "I am excited/thrilled/passionate", "I believe I would be a great fit", "I came across", or a restatement of the job description.
- Start with "Dear Hiring Team," unless the posting names the hiring manager. End with "Best regards," and the candidate's name on the next line.`;

export function coverSystem(master: MasterResume): string {
  return `${masterPreamble(master)}\n\n${COVER_RULES}`;
}

export function coverPrompt(params: {
  requirements: Requirements;
  status: (k: RequirementKeyword) => PreCoverage;
  jdExcerpt: string;
  candidateName: string;
}): string {
  return [
    tailorPrompt(params),
    `FROM THE POSTING (for company and role specifics):\n${params.jdExcerpt}`,
    `Sign as: ${params.candidateName}`,
  ].join("\n\n");
}
