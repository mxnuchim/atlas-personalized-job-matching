import "server-only";

import type { ProfileWithStrengths } from "@/db/queries/profile";
import { evaluate, type EvaluationQuestion, type EvaluationState } from "@/lib/llm";

/**
 * The numeric half of scoring, done by Jev (PRD §9 / cost).
 *
 * Jev returns typed scores with no prose, ~100x cheaper than a generative call, so it
 * ranks the whole corpus for cents. The `why_you` / `reasoning` / `red_flags` text is
 * NOT here — it needs generation and stays on `generateStructured`, run only for the
 * shortlist. This module maps the §9 fit rubric onto Jev `score` questions and rescales
 * each answer (a probability-weighted mean over rubric levels) back to the 0-100 the
 * rest of the app speaks.
 */

/** The job fields the fit questions are asked against. */
export type JevJob = {
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  description: string;
};

export type JevDimensions = {
  role_fit: number;
  seniority_fit: number;
  tech_fit: number;
  location_fit: number;
  company_fit: number;
};

export type JevScores = {
  overall: number;
  dimensions: JevDimensions;
  strengthMatches: { strength_key: string; rewarded: number }[];
  inputTokens: number;
};

/** Keep the posting bounded — Jev caps state at 32k tokens and bills input. */
const MAX_DESCRIPTION_CHARS = 6000;

/** 5-level overall rubric, lowest → highest (index 0..4 → 0..100). */
const OVERALL_RUBRIC = [
  "No fit — a different role entirely, or a dealbreaker is hit",
  "Weak fit — a real stretch",
  "Plausible fit — possible, with clear gaps",
  "Good fit — possible, strong on the essentials",
  "Excellent fit — squarely this candidate's strengths and level",
];

/** 4-level dimension rubrics, lowest → highest (index 0..3 → 0..100). */
const DIMENSION_RUBRICS: Record<keyof JevDimensions, string[]> = {
  role_fit: [
    "Not one of the target roles",
    "Adjacent to a target role",
    "A target role, loosely",
    "Squarely one of the target roles",
  ],
  seniority_fit: [
    "Wrong level for the candidate",
    "A stretch up or down in level",
    "Close to the candidate's level",
    "Exactly the candidate's level",
  ],
  tech_fit: [
    "Little overlap with the candidate's stack",
    "Some overlap",
    "Strong overlap",
    "Near-exact match to the stack and strengths",
  ],
  location_fit: [
    "Location or visa is a dealbreaker",
    "Workable, but with friction",
    "Compatible with the candidate's locations",
    "Ideal — remote, or a preferred location with sponsorship where needed",
  ],
  company_fit: [
    "Outside the candidate's domains",
    "A tangentially related domain",
    "A relevant domain and stage",
    "Squarely the candidate's domain (fintech, AI, infrastructure)",
  ],
};

/** Generic 4-level rubric for how strongly a role rewards one named strength. */
const STRENGTH_RUBRIC = [
  "This role does not reward this strength",
  "Slightly rewards it",
  "Moderately rewards it",
  "Strongly rewards it — it is central to the role",
];

const DIMENSION_KEYS = Object.keys(DIMENSION_RUBRICS) as (keyof JevDimensions)[];

/** Prefix a strength's question id so answers map cleanly back to strength keys. */
function strengthQuestionId(key: string): string {
  return `strength__${key}`;
}

/** A Jev `score` answer is a weighted mean over level indices; rescale to 0-100. */
function rescale(score: number, levels: number): number {
  if (levels <= 1) return 0;
  return Math.round((score / (levels - 1)) * 100);
}

export function buildFitState(profile: ProfileWithStrengths, job: JevJob): EvaluationState {
  return {
    candidate: {
      headline: profile.headline,
      target_roles: profile.targetRoles,
      seniority: profile.seniority,
      locations: profile.locations,
      open_to_relocation: profile.relocation,
      dealbreakers: profile.dealbreakers,
      strengths: profile.strengths.map((s) => ({
        key: s.key,
        label: s.label,
        weight: s.weight,
        summary: s.summary,
      })),
    },
    job: {
      title: job.title,
      company: job.company,
      location: job.location ?? (job.remote ? "Remote" : "Not stated"),
      remote: job.remote,
      description: job.description.slice(0, MAX_DESCRIPTION_CHARS),
    },
  };
}

export function buildFitQuestions(profile: ProfileWithStrengths): Record<string, EvaluationQuestion> {
  const questions: Record<string, EvaluationQuestion> = {
    overall: {
      type: "score",
      instructions: "Overall fit of this job for THIS candidate, judged holistically.",
      criteria: OVERALL_RUBRIC,
    },
  };

  for (const key of DIMENSION_KEYS) {
    questions[key] = {
      type: "score",
      instructions: `Rate ${key.replace(/_/g, " ")} for this candidate and role.`,
      criteria: DIMENSION_RUBRICS[key],
    };
  }

  for (const strength of profile.strengths) {
    questions[strengthQuestionId(strength.key)] = {
      type: "score",
      instructions: `How strongly does this role reward the candidate's strength "${strength.label}"?`,
      criteria: STRENGTH_RUBRIC,
    };
  }

  return questions;
}

/** Score one job's numeric fit with Jev. One request answers every question in parallel. */
export async function scoreJobWithJev(
  profile: ProfileWithStrengths,
  job: JevJob,
  signal?: AbortSignal,
): Promise<JevScores> {
  const questions = buildFitQuestions(profile);
  const { answers, usage } = await evaluate({
    state: buildFitState(profile, job),
    questions,
    signal,
  });

  const scoreOf = (id: string): number => {
    const answer = answers[id];
    return answer && answer.type === "score" ? answer.score : 0;
  };

  const dimensions = Object.fromEntries(
    DIMENSION_KEYS.map((key) => [key, rescale(scoreOf(key), DIMENSION_RUBRICS[key].length)]),
  ) as JevDimensions;

  return {
    overall: rescale(scoreOf("overall"), OVERALL_RUBRIC.length),
    dimensions,
    strengthMatches: profile.strengths.map((strength) => ({
      strength_key: strength.key,
      rewarded: rescale(scoreOf(strengthQuestionId(strength.key)), STRENGTH_RUBRIC.length),
    })),
    inputTokens: usage.inputTokens ?? 0,
  };
}
