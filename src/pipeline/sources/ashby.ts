import { z } from "zod";

import { htmlToText } from "@/lib/html";

import { fetchJson } from "./http";
import type { NormalizedJob, SourceFetcher } from "./types";

/**
 * Ashby's public job-board API (PRD §7) — keyless, one source row per company.
 * Unlike Greenhouse and Lever it states remoteness directly (`isRemote`), and it
 * publishes unlisted postings too, which `isListed` marks.
 */
export const ashbyConfigSchema = z.object({
  /** Board name in the URL, e.g. "ramp" for jobs.ashbyhq.com/ramp. */
  board: z.string().min(1),
  company: z.string().min(1),
});

const ashbyJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  location: z.string().nullish(),
  // Null on roughly a third of a large board (261 of OpenAI's 830) — absent and
  // explicitly null both mean "not stated", so fall back to reading the location.
  isRemote: z.boolean().nullish(),
  isListed: z.boolean().nullish(),
  publishedAt: z.string().optional(),
  jobUrl: z.url(),
  descriptionPlain: z.string().optional(),
  descriptionHtml: z.string().optional(),
});

type AshbyJob = z.infer<typeof ashbyJobSchema>;

const ashbyResponseSchema = z.object({ jobs: z.array(ashbyJobSchema) });

/** Pure mapper from an Ashby posting to our normalized shape. Unit-tested. */
export function normalizeAshbyJob(job: AshbyJob, company: string): NormalizedJob {
  return {
    externalId: job.id,
    title: job.title.trim(),
    company,
    location: job.location?.trim() || null,
    remote: job.isRemote ?? /\bremote\b/i.test(job.location ?? ""),
    url: job.jobUrl,
    description: job.descriptionPlain?.trim() || htmlToText(job.descriptionHtml ?? ""),
    postedAt: job.publishedAt ? new Date(job.publishedAt) : null,
    raw: job as unknown as Record<string, unknown>,
  };
}

export const fetchAshby: SourceFetcher = async (rawConfig) => {
  const config = ashbyConfigSchema.parse(rawConfig);
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(config.board)}`;

  const data = ashbyResponseSchema.parse(await fetchJson(url, `Ashby "${config.board}"`));

  // An unlisted posting is one the company has taken off its board; `isListed` absent
  // means the board does not use the flag, which is not the same as false.
  return data.jobs
    .filter((job) => job.isListed !== false)
    .map((job) => normalizeAshbyJob(job, config.company));
};
