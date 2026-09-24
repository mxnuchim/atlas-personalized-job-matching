/**
 * Typed shapes for `jsonb` columns. These are the contracts the pipeline and the
 * scoring/drafting LLM calls must honor; Zod schemas that validate them at the
 * boundary land alongside the pipeline in M2.
 */

/** Per-dimension fit, each 0–100 (PRD §7 / §9). */
export type FitDimensions = {
  role_fit: number;
  seniority_fit: number;
  tech_fit: number;
  location_fit: number;
  company_fit: number;
};

/** Which of the candidate's named strengths a role rewards, and how strongly (0–100). */
export type StrengthMatch = {
  strength_key: string;
  rewarded: number;
};

/** A per-job failure recorded on a run without aborting it (PRD §8). */
export type RunError = {
  stage: string;
  job_id?: string;
  message: string;
};

/** Source-specific connection details (e.g. a Greenhouse board token). */
export type SourceConfig = Record<string, unknown>;
