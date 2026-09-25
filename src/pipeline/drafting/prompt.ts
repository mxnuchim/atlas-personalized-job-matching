import type { ProfileWithStrengths } from "@/db/queries/profile";
import type { MatchRow } from "@/db/queries/matches";

/**
 * The drafter's brief (PRD §15-C). The hard constraints are the point: build on the
 * strengths this role was scored as rewarding, and cite one real evidence item. A
 * draft that could have been written without the candidate's record has failed, no
 * matter how well it reads.
 */
export const SYSTEM_PROMPT = `You write short outreach emails on behalf of a specific candidate, to a specific role.

Hard requirements:
- Build on the strengths flagged as rewarded by THIS role. Do not range over the candidate's whole background.
- Cite exactly one concrete item from the supplied evidence. Use its real details — the claim, the context, the metric if there is one. Never invent or embellish a number.
- Report which item you used by putting its id in the \`evidence_id\` field. The id is an internal reference: never write it, or any other identifier, in the subject or body. The recipient must never see one.
- Reference one concrete thing from the posting, so it is obvious this was not sent to fifty companies.
- Include the portfolio link if one is supplied.
- Under 120 words in the body. Shorter is better.

Voice:
- Plain and direct. Write like a senior engineer emailing another engineer.
- No flattery, no "I am excited to", no "I came across your posting", no restating the job description back to them.
- No cliché openers and no hedging. State the fit, show the evidence, propose the next step.
- The subject line is specific and lowercase-ish, not a headline. No emoji.

You are writing as the candidate, in first person.`;

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
    "THE POSTING (anchor one concrete detail from this):",
    match.description
      ? truncate(match.description, MAX_POSTING_CHARS)
      : "(no description provided)",
  );

  return lines.join("\n");
}
