import { z } from "zod";

import type { NewDraft } from "@/db/schema";

import type { EvidenceOption } from "./prompt";

/** Roughly the §15-C limit in characters, with room for a signature. */
const MAX_BODY_CHARS = 1200;
const MAX_SUBJECT_CHARS = 120;

/**
 * Parse-time contract for a stored draft. Deliberately looser than the schema sent to
 * the model — this validates what we keep, not what we asked for.
 */
export const draftSchema = z.object({
  subject: z.string().min(1).max(MAX_SUBJECT_CHARS),
  body: z.string().min(1).max(MAX_BODY_CHARS),
  evidence_id: z.string().min(1),
  strength_keys: z.array(z.string()).default([]),
});

export type DraftOutput = z.infer<typeof draftSchema>;

/**
 * The generation-time schema, with `evidence_id` and `strength_keys` constrained to
 * what the model was actually offered. Same two-layer defence as scoring: the enum
 * stops the model inventing a citation, and `draftToRow` filters again afterwards.
 */
export function buildDraftGenerationSchema(params: {
  evidenceOptions: EvidenceOption[];
  strengthKeys: string[];
}) {
  const ids = params.evidenceOptions.map((e) => e.id);
  const evidenceId = ids.length > 0 ? z.enum(ids as [string, ...string[]]) : z.string().min(1);
  const strengthKey =
    params.strengthKeys.length > 0
      ? z.enum(params.strengthKeys as [string, ...string[]])
      : z.string().min(1);

  return z.object({
    subject: z
      .string()
      .min(1)
      .max(MAX_SUBJECT_CHARS)
      .describe("Specific and plain. Not a headline, no emoji."),
    body: z
      .string()
      .min(1)
      .max(MAX_BODY_CHARS)
      .describe(
        "The email body, first person, under 120 words. Cites the chosen evidence and one concrete detail from the posting.",
      ),
    evidence_id: evidenceId.describe("The id of the one evidence item this draft cites."),
    strength_keys: z
      .array(strengthKey)
      .describe("The rewarded strengths this draft actually builds on."),
  });
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Remove internal identifiers the model may have copied into the prose. It is told not
 * to, but a prompt is not a guarantee, and a UUID in an email that goes to a real
 * hiring manager is not a defect you want to discover in the outbox.
 *
 * Observed verbatim in a real draft: "…at <400ms latency (id=a8c730f3-…)".
 */
export function stripIdentifiers(text: string): string {
  return (
    text
      .replace(new RegExp(`\\(\\s*id\\s*=\\s*${UUID.source}\\s*\\)`, "gi"), "")
      .replace(new RegExp(`\\bid\\s*=\\s*${UUID.source}`, "gi"), "")
      .replace(UUID, "")
      // Tidy the punctuation and spacing the removal leaves behind.
      .replace(/\(\s*\)/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .trim()
  );
}

/**
 * Pure mapper: validated output → a `drafts` row. An evidence id the model invented
 * is dropped to null rather than written as a dangling reference, and unknown
 * strength keys are filtered out — the same post-parse guard scoring uses.
 */
export function draftToRow(params: {
  matchId: string;
  output: DraftOutput;
  validEvidenceIds: Set<string>;
  validStrengthKeys: Set<string>;
}): NewDraft {
  const { matchId, output, validEvidenceIds, validStrengthKeys } = params;

  return {
    matchId,
    subject: stripIdentifiers(output.subject),
    body: stripIdentifiers(output.body),
    // Null until M4 decides where addresses come from; the review queue surfaces that
    // as a blocked guardrail rather than inventing one (PRD §11: verify each recipient).
    recipient: null,
    evidenceId: validEvidenceIds.has(output.evidence_id) ? output.evidence_id : null,
    strengthKeys: output.strength_keys.filter((k) => validStrengthKeys.has(k)),
    status: "pending",
  };
}

/**
 * Did the draft actually do the job? A draft that cites nothing real is exactly the
 * generic blurb this product exists to avoid, so it is recorded as a run error rather
 * than quietly stored as if it were fine.
 */
export function draftGrounding(row: NewDraft): { grounded: boolean; reason?: string } {
  if (!row.evidenceId) return { grounded: false, reason: "cited no real evidence item" };
  if ((row.strengthKeys ?? []).length === 0) {
    return { grounded: false, reason: "built on none of the rewarded strengths" };
  }
  return { grounded: true };
}
