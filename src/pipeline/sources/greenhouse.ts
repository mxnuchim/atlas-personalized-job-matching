import { z } from "zod";

import { htmlToText } from "@/lib/html";

import type { NormalizedJob, SourceFetcher } from "./types";

/**
 * Greenhouse job-board API — a public, ToS-clean JSON endpoint (PRD §7). One
 * source row per board; `config` names the board token and a display company.
 */
export const greenhouseConfigSchema = z.object({
  /** Board token in the URL, e.g. "vercel" for boards.greenhouse.io/vercel. */
  board: z.string().min(1),
  /** Display name for the company (the API doesn't reliably include it). */
  company: z.string().min(1),
});

export type GreenhouseConfig = z.infer<typeof greenhouseConfigSchema>;

const greenhouseJobSchema = z.object({
  id: z.number(),
  title: z.string(),
  absolute_url: z.url(),
  updated_at: z.string().optional(),
  location: z.object({ name: z.string() }).nullish(),
  content: z.string().optional(),
});

const greenhouseResponseSchema = z.object({
  jobs: z.array(greenhouseJobSchema),
});

type GreenhouseJob = z.infer<typeof greenhouseJobSchema>;

const REMOTE_RE = /\bremote\b/i;
const FETCH_TIMEOUT_MS = 15_000;

/** Pure mapper from a Greenhouse job to our normalized shape. Unit-tested. */
export function normalizeGreenhouseJob(job: GreenhouseJob, company: string): NormalizedJob {
  const location = job.location?.name?.trim() || null;
  const remote = REMOTE_RE.test(location ?? "") || REMOTE_RE.test(job.title);

  return {
    externalId: String(job.id),
    title: job.title.trim(),
    company,
    location,
    remote,
    url: job.absolute_url,
    description: job.content ? htmlToText(job.content) : "",
    postedAt: job.updated_at ? new Date(job.updated_at) : null,
    raw: job as unknown as Record<string, unknown>,
  };
}

export const fetchGreenhouse: SourceFetcher = async (rawConfig) => {
  const config = greenhouseConfigSchema.parse(rawConfig);
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
    config.board,
  )}/jobs?content=true`;

  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Greenhouse "${config.board}" returned HTTP ${response.status}`);
  }

  const data = greenhouseResponseSchema.parse(await response.json());
  return data.jobs.map((job) => normalizeGreenhouseJob(job, config.company));
};
