import { z } from "zod";

import { htmlToText } from "@/lib/html";

import { fetchJson } from "./http";
import type { NormalizedJob, SourceFetcher } from "./types";

/**
 * Lever's public postings API (PRD §7) — `?mode=json` on a company's board token.
 * Keyless and documented, same contract as Greenhouse: one source row per company.
 *
 * Lever inlines every description, so a large board is a multi-megabyte response —
 * Palantir's is ~6 MB and needs well over the default timeout.
 */
export const leverConfigSchema = z.object({
  /** Board token in the URL, e.g. "palantir" for jobs.lever.co/palantir. */
  board: z.string().min(1),
  company: z.string().min(1),
});

const leverJobSchema = z.object({
  id: z.string(),
  text: z.string(),
  hostedUrl: z.url(),
  /** Milliseconds since the epoch, unlike most boards' ISO strings. */
  createdAt: z.number().optional(),
  workplaceType: z.string().optional(),
  categories: z
    .object({ location: z.string().nullish(), commitment: z.string().nullish() })
    .nullish(),
  descriptionPlain: z.string().optional(),
  description: z.string().optional(),
  additionalPlain: z.string().optional(),
});

type LeverJob = z.infer<typeof leverJobSchema>;

const REMOTE_RE = /\bremote\b/i;
const TIMEOUT_MS = 45_000;

/** Pure mapper from a Lever posting to our normalized shape. Unit-tested. */
export function normalizeLeverJob(job: LeverJob, company: string): NormalizedJob {
  const location = job.categories?.location?.trim() || null;
  const body = job.descriptionPlain?.trim() || htmlToText(job.description ?? "");
  const extra = job.additionalPlain?.trim() ?? "";

  return {
    externalId: job.id,
    title: job.text.trim(),
    company,
    location,
    remote:
      job.workplaceType?.toLowerCase() === "remote" ||
      REMOTE_RE.test(location ?? "") ||
      REMOTE_RE.test(job.text),
    url: job.hostedUrl,
    description: [body, extra].filter(Boolean).join("\n\n").trim(),
    postedAt: job.createdAt ? new Date(job.createdAt) : null,
    raw: job as unknown as Record<string, unknown>,
  };
}

export const fetchLever: SourceFetcher = async (rawConfig) => {
  const config = leverConfigSchema.parse(rawConfig);
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(config.board)}?mode=json`;

  const payload = await fetchJson(url, `Lever "${config.board}"`, TIMEOUT_MS);

  // Lever answers an unknown board with HTTP 200 and `{"ok":false,...}`, so a typo in
  // a board token looks like success until Zod fails on a wall of array errors. Name
  // it here instead — a misconfigured source should say so in one line.
  if (!Array.isArray(payload)) {
    const reason =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as { error: unknown }).error)
        : "unexpected response shape";
    throw new Error(`Lever "${config.board}": ${reason}`);
  }

  const data = z.array(leverJobSchema).parse(payload);
  return data.map((job) => normalizeLeverJob(job, config.company));
};
