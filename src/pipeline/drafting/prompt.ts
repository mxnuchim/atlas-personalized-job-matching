import type { ProfileWithStrengths } from "@/db/queries/profile";
import type { MatchRow } from "@/db/queries/matches";

/**
 * The drafter's brief (PRD §15-C). The hard constraints are the point: build on the
 * strengths this role was scored as rewarding, and cite one real evidence item. A
 * draft that could have been written without the candidate's record has failed, no
 * matter how well it reads.
 */
export const SYSTEM_PROMPT = `You write cold outreach emails on behalf of a specific candidate, to a specific role. The candidate copies what you write and sends it themselves, so it has to be ready to go as-is.

Write like a YC application answer: every sentence does work, nothing is throat-clearing.

Shape (roughly 5 short sentences, under 90 words):
1. One line on who they are — the specific combination, not "senior engineer".
2. The proof. One concrete thing they built, with its real number. This is the whole email; lead with the strongest one.
3. One line connecting that to something specific in THIS posting.
4. The portfolio link.
5. A direct, low-friction ask.

Hard requirements:
- Build on the strengths flagged as rewarded by THIS role. Do not range over their whole background.
- Cite exactly one item from the supplied evidence, using its real claim and metric. Never invent or embellish a number.
- Report which item you used by putting its id in the \`evidence_id\` field. The id is an internal reference: never write it, or any other identifier, in the subject or body. The recipient must never see one.
- Reference one concrete detail from the posting, so it is obvious this was not sent to fifty companies.

Never write:
- "I hope this email finds you well", "I came across your posting", "I am excited/thrilled/passionate", "I would love the opportunity", "reaching out regarding".
- A restatement of the job description back at them.
- Adjectives about themselves. "I led a team of 6 through X" lands; "I am a highly motivated leader" does not.
- A closing paragraph of gratitude. End on the ask.

Subject: 4-8 words, lower case, concrete and specific. It should read like a note from a person, not a campaign. No emoji, no colons-as-branding.

Voice: first person, plain, direct. One engineer emailing another. Contractions are fine. Short sentences.

Formatting — this gets pasted straight into a mail client, so the shape matters:
- Open with "Hi —" on its own line.
- Two or three short paragraphs, separated by a blank line. Do not put every sentence on its own line.
- The ask goes in its own final paragraph.
- Sign off with the first name alone on the last line. Do not state the full name in the opening sentence as well — the signature already says it.`;

/** How much of the posting the drafter needs — enough to anchor one specific detail. */
const MAX_POSTING_CHARS = 2500;

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated]`;
}

/**
 * The invariant half: who the candidate is. Identical for every draft in a run, so it
 * belongs in `instructions` where a provider can cache it.
 */
export function buildDraftSystem(profile: ProfileWithStrengths, contact: ContactDetails): string {
  return [
    SYSTEM_PROMPT,
    "",
    "CANDIDATE",
    `Name: ${contact.name}`,
    contact.portfolioUrl ? `Portfolio: ${contact.portfolioUrl}` : "Portfolio: (none supplied)",
    `Headline: ${profile.headline}`,
    `Seniority: ${profile.seniority ?? "n/a"}`,
    `Open to relocation: ${profile.relocation ? "yes" : "no"}`,
  ].join("\n");
}

export type ContactDetails = {
  name: string;
  portfolioUrl: string | null;
};

/** One evidence item as offered to the model, with the id it must report back. */
export type EvidenceOption = {
  id: string;
  strengthKey: string;
  strengthLabel: string;
  claim: string;
  context: string | null;
  metric: string | null;
};

/**
 * The volatile half: this role, the strengths it rewards, and only the evidence that
 * backs those strengths. Narrowing the evidence to the rewarded strengths is what
 * keeps the draft on-argument — the model cannot cite something irrelevant if it was
 * never offered it.
 */
export function buildDraftPrompt(params: {
  match: MatchRow;
  evidenceOptions: EvidenceOption[];
}): string {
  const { match, evidenceOptions } = params;
  const lines: string[] = [
    "ROLE",
    `Title: ${match.title}`,
    `Company: ${match.company}`,
    `Location: ${match.location ?? "n/a"}${match.remote ? " (remote)" : ""}`,
    "",
    `WHY THIS ROLE FITS (from scoring): ${match.whyYou}`,
    "",
    "STRENGTHS THIS ROLE REWARDS (build on these, strongest first):",
  ];

  for (const s of [...match.strengthMatches].sort((a, b) => b.rewarded - a.rewarded)) {
    const label = evidenceOptions.find((e) => e.strengthKey === s.strength_key)?.strengthLabel;
    lines.push(`- ${label ?? s.strength_key} (rewarded ${s.rewarded}/100)`);
  }

  lines.push("", "EVIDENCE YOU MAY CITE (choose exactly one, and report its id):");
  for (const e of evidenceOptions) {
    const metric = e.metric ? ` [${e.metric}]` : "";
    const context = e.context ? ` — ${e.context}` : "";
    lines.push(`- id=${e.id} (${e.strengthLabel}) ${e.claim}${context}${metric}`);
  }

  lines.push(
    "",
    'Open with "Hi —" (no name is known) and sign off with the candidate\'s first name only.',
    "",
    "THE POSTING (anchor one concrete detail from this):",
    match.description
      ? truncate(match.description, MAX_POSTING_CHARS)
      : "(no description provided)",
  );

  return lines.join("\n");
}
