import { z } from "zod";

import type { NewMatch } from "@/db/schema";
import { fitTier } from "@/lib/scoring";

const score = z.number().int().min(0).max(100);

/** Validates the model's tool output before it ever reaches the database. */
export const assessmentSchema = z.object({
  overall: score,
  dimensions: z.object({
    role_fit: score,
    seniority_fit: score,
    tech_fit: score,
    location_fit: score,
    company_fit: score,
  }),
  strength_matches: z.array(z.object({ strength_key: z.string(), rewarded: score })).default([]),
  why_you: z.string().min(1),
  reasoning: z.string().min(1),
  red_flags: z.array(z.string()).default([]),
});

export type Assessment = z.infer<typeof assessmentSchema>;

/**
 * The schema actually sent to the model, with `strength_key` constrained to the
 * candidate's real keys so the model cannot invent one. Provider-agnostic: the AI
 * SDK translates this into whichever structured-output mechanism the provider has
 * (tool call, JSON schema, response schema) — the pipeline never knows which.
 *
 * The loose `assessmentSchema` above stays as the parse-time contract for stored
 * rows and tests; this is the generation-time contract.
 */
export function buildAssessmentSchema(strengthKeys: string[]) {
  const strengthKey =
    strengthKeys.length > 0 ? z.enum(strengthKeys as [string, ...string[]]) : z.string();

  return z.object({
    overall: score.describe(
      "Holistic 0-100 fit for THIS candidate. >=85 strong, 65-84 possible, <65 stretch.",
    ),
    dimensions: z.object({
      role_fit: score,
      seniority_fit: score,
      tech_fit: score,
      location_fit: score,
      company_fit: score,
    }),
    strength_matches: z
      .array(z.object({ strength_key: strengthKey, rewarded: score }))
      .describe("Which of the candidate's strengths this role rewards, and how strongly (0-100)."),
    why_you: z
      .string()
      .min(1)
      .describe(
        "2-3 sentences: the concrete, evidence-backed case for why this candidate fits. Reference specific achievements.",
      ),
    reasoning: z
      .string()
      .min(1)
      .describe("Honest analysis including gaps and how you weighed the dimensions."),
    red_flags: z
      .array(z.string())
      .describe(
        "Concerns: dealbreakers hit, seniority mismatch, location/visa issues. Empty if none.",
      ),
  });
}

/** Pure mapper: validated assessment → a `matches` row. Tier is derived, not trusted. */
export function assessmentToMatch(params: {
  jobId: string;
  profileVersion: number;
  assessment: Assessment;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  validStrengthKeys: Set<string>;
}): NewMatch {
  const { jobId, profileVersion, assessment, model, tokensIn, tokensOut, validStrengthKeys } =
    params;

  return {
    jobId,
    profileVersion,
    overall: assessment.overall,
    tier: fitTier(assessment.overall),
    dimensions: assessment.dimensions,
    strengthMatches: assessment.strength_matches.filter((s) =>
      validStrengthKeys.has(s.strength_key),
    ),
    whyYou: assessment.why_you,
    reasoning: assessment.reasoning,
    redFlags: assessment.red_flags,
    model,
    tokensIn,
    tokensOut,
  };
}
