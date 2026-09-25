import type { ProfileWithStrengths } from "@/db/queries/profile";
import type { Job } from "@/db/schema";

/** The scorer's job and rubric (PRD §9). Fit for THIS candidate, honestly calibrated. */
export const SYSTEM_PROMPT = `You are the scoring engine for Atlas, a personal job-search copilot. You judge how well a SPECIFIC candidate fits a SPECIFIC job — not generic qualification, but fit for this person's strengths, seniority, location constraints, and dealbreakers.

Principles:
- Be honest and calibrated. Most jobs are "possible" or "stretch"; reserve high scores for genuine strong fits. Never inflate to be encouraging.
- Score against the candidate's NAMED strengths and their weights. A role that heavily rewards a weight-10 strength matters far more than one rewarding a weight-3 strength.
- Respect dealbreakers and constraints. If one is clearly hit (e.g. a relocation role with no visa sponsorship, a non-technical/management-only role, unpaid/equity-only), name it in red_flags and lower the affected dimensions.
- why_you must be concrete and evidence-backed — reference the candidate's actual achievements and numbers, never generic enthusiasm. 2-3 sentences, written for the candidate to read.
- reasoning is your honest analysis, including gaps and how you weighed the dimensions.
- Return only the structured assessment object. No preamble, no commentary outside it.

Dimensions (each 0-100):
- role_fit: match to the target roles and the actual work described.
- seniority_fit: match to the candidate's level.
- tech_fit: overlap with the candidate's stack and strengths.
- location_fit: remote / onsite / relocation / visa alignment against the candidate's locations.
- company_fit: stage and domain alignment (e.g. fintech, AI, infrastructure).

overall (0-100) is holistic, not a raw average of the dimensions: >=85 strong, 65-84 possible, <65 stretch.`;

/** Keep the posting bounded. */
const MAX_DESCRIPTION_CHARS = 6000;
/**
 * The profile prefix is re-sent on every job in a run, so it — not the posting —
 * is the dominant input-token cost. Cap the free-text CV; the structured strengths
 * and evidence below it are what the scorer actually reasons over.
 */
const MAX_CV_CHARS = 4000;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated]`;
}

/**
 * The candidate context. Built once per run and sent as part of the *system* prefix,
 * not the per-job prompt — it is byte-identical across every job in a run, so putting
 * it there is what makes it cacheable (PRD §11, cost).
 */
export function buildProfileContext(profile: ProfileWithStrengths): string {
  const lines: string[] = [
    `CANDIDATE PROFILE (v${profile.version})`,
    `Headline: ${profile.headline}`,
    `Target roles (priority order): ${profile.targetRoles.join(", ") || "n/a"}`,
    `Seniority: ${profile.seniority ?? "n/a"}`,
    `Locations: ${profile.locations.join("; ") || "n/a"}`,
    `Open to relocation: ${profile.relocation ? "yes" : "no"}`,
    `Dealbreakers: ${profile.dealbreakers.join("; ") || "none stated"}`,
    "",
    "Background:",
    profile.cvText ? truncate(profile.cvText, MAX_CV_CHARS) : "n/a",
    "",
    "STRENGTHS (score the job against these):",
  ];

  for (const strength of profile.strengths) {
    lines.push(
      `- ${strength.label} (${strength.key}) [${strength.kind}, weight ${strength.weight}/10]`,
    );
    if (strength.summary) lines.push(`  ${strength.summary}`);
    for (const item of strength.evidence) {
      const metric = item.metric ? ` (${item.metric})` : "";
      const context = item.context ? ` — ${item.context}` : "";
      lines.push(`    • ${item.claim}${context}${metric}`);
    }
  }

  return lines.join("\n");
}

/** The volatile, per-job half of the prompt. Trimmed to keep token cost bounded. */
export function buildJobContext(job: Job): string {
  return [
    "JOB POSTING",
    `Title: ${job.title}`,
    `Company: ${job.company}`,
    `Location: ${job.location ?? "n/a"}${job.remote ? " (remote)" : ""}`,
    `URL: ${job.url}`,
    "",
    "Description:",
    job.description
      ? truncate(job.description, MAX_DESCRIPTION_CHARS)
      : "(no description provided)",
  ].join("\n");
}

/**
 * The full invariant prefix for a run: rubric + candidate. Identical for every job,
 * which is exactly what a provider's prompt cache keys on.
 */
export function buildSystemPrompt(profile: ProfileWithStrengths): string {
  return `${SYSTEM_PROMPT}\n\n${buildProfileContext(profile)}`;
}
