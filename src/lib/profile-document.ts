import { z } from "zod";

/**
 * The profile document: one contract, shared by the CLI seed and the paste-in flow.
 *
 * It began as a seed script's private schema, which is why adding a second user hurt —
 * the only way to get a profile was a JSON file on someone's laptop. The shape was
 * fine; its location was not. Lifting it here makes the same document something a
 * person can produce with an LLM and paste into the app.
 *
 * `snake_case` keys deliberately: it is what the existing document uses, what the
 * prompt below asks an LLM for, and changing it would invalidate a file the user
 * already has.
 */
export const profileDocumentSchema = z.object({
  profile: z.object({
    version: z.number().int().positive().default(1),
    headline: z.string().min(1, "A headline is required."),
    name: z.string().min(1).nullish(),
    portfolio_url: z.string().min(1).nullish(),
    target_roles: z.array(z.string()).default([]),
    seniority: z.string().nullish(),
    locations: z.array(z.string()).default([]),
    relocation: z.boolean().default(false),
    dealbreakers: z.array(z.string()).default([]),
    cv_text: z.string().nullish(),
  }),
  strengths: z
    .array(
      z.object({
        key: z
          .string()
          .min(1)
          .regex(/^[a-z0-9-]+$/, "Use lowercase words joined by hyphens, e.g. cloud-devops."),
        label: z.string().min(1),
        kind: z.enum(["core", "differentiator"]),
        weight: z.number().int().min(1).max(10),
        summary: z.string().nullish(),
      }),
    )
    .min(1, "At least one strength — the scorer has nothing to weigh without them."),
  evidence: z
    .array(
      z.object({
        strength_key: z.string().min(1),
        claim: z.string().min(1),
        context: z.string().nullish(),
        metric: z.string().nullish(),
        source: z.string().nullish(),
      }),
    )
    .default([]),
});

export type ProfileDocument = z.infer<typeof profileDocumentSchema>;

/** A ```json block, as the seed document writes it, or bare JSON. */
export function extractJson(input: string): string {
  const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/);
  return (fenced ? fenced[1] : input).trim();
}

export type ParseResult =
  { ok: true; document: ProfileDocument; warnings: string[] } | { ok: false; errors: string[] };

/**
 * Parse pasted text into a profile document.
 *
 * Errors are phrased for someone who pasted something an LLM produced, not for
 * someone reading a stack trace — the fix is almost always "ask it again for this
 * field", and the message should say which.
 */
export function parseProfileDocument(input: string): ParseResult {
  const json = extractJson(input);
  if (!json) return { ok: false, errors: ["Nothing to read — paste the JSON block."] };

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    return {
      ok: false,
      errors: [
        `That is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        "If you copied from a chat, make sure you took the whole block including both braces.",
      ],
    };
  }

  const parsed = profileDocumentSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      }),
    };
  }

  // Not fatal, but worth saying out loud before it silently changes the scoring.
  const keys = new Set(parsed.data.strengths.map((s) => s.key));
  const orphaned = [
    ...new Set(
      parsed.data.evidence.filter((e) => !keys.has(e.strength_key)).map((e) => e.strength_key),
    ),
  ];

  const warnings: string[] = [];
  if (orphaned.length > 0) {
    warnings.push(
      `Evidence refers to ${orphaned.length === 1 ? "a strength" : "strengths"} that ${
        orphaned.length === 1 ? "does" : "do"
      } not exist (${orphaned.join(", ")}). It will be dropped.`,
    );
  }
  const unevidenced = parsed.data.strengths.filter(
    (s) => !parsed.data.evidence.some((e) => e.strength_key === s.key),
  );
  if (unevidenced.length > 0) {
    warnings.push(
      `${unevidenced.length} strength${unevidenced.length === 1 ? "" : "s"} have no evidence ` +
        `(${unevidenced.map((s) => s.key).join(", ")}). Outreach can only cite what has evidence.`,
    );
  }

  return { ok: true, document: parsed.data, warnings };
}

/**
 * The prompt to paste into an LLM alongside a CV.
 *
 * Writing strengths and evidence by hand is the slowest part of onboarding, and it is
 * exactly what a model with your CV in front of it is good at. Asking for this shape
 * explicitly — and for metrics rather than adjectives — is what makes the output
 * usable without editing.
 */
export const CV_PROMPT = `You are helping me build a structured profile for a job-matching tool.

I will paste my CV below. Read it and return ONE JSON object, in a \`\`\`json code block,
with exactly this shape and nothing else — no commentary before or after.

{
  "profile": {
    "version": 1,
    "headline": "one line, how I would introduce myself professionally",
    "name": "my full name",
    "portfolio_url": "my site or GitHub, or null",
    "target_roles": ["the job titles I should be applying for"],
    "seniority": "e.g. Senior, Staff",
    "locations": ["where I can work, e.g. Remote (global), Lagos Nigeria, open to relocation: UK"],
    "relocation": true,
    "dealbreakers": ["things that rule a job out for me"],
    "cv_text": "my CV as plain text"
  },
  "strengths": [
    {
      "key": "lowercase-hyphenated-id",
      "label": "Human readable name",
      "kind": "core",
      "weight": 8,
      "summary": "one sentence on what this capability actually is"
    }
  ],
  "evidence": [
    {
      "strength_key": "must match a key above",
      "claim": "a specific thing I did",
      "context": "where and when",
      "metric": "the number that makes it real, if there is one",
      "source": "which role or project"
    }
  ]
}

Rules that matter:
- 5 to 10 strengths. "kind" is "core" for what I do everywhere, "differentiator" for
  what makes me unusual. "weight" is 1-10 by how central it is to me.
- Every strength needs at least one piece of evidence. Evidence is the part that gets
  quoted in outreach, so prefer a measured outcome over an adjective — "cut p99 from
  800ms to 120ms" beats "improved performance".
- Never invent a metric. If my CV does not state one, leave "metric" null.
- Keep "cv_text" as the full plain text of my CV; it is used for scoring.

My CV:
---
[PASTE YOUR CV HERE]`;
