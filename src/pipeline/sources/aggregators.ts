import { z } from "zod";

import { htmlToText } from "@/lib/html";

import { fetchJson } from "./http";
import type { NormalizedJob, SourceFetcher } from "./types";

/**
 * Keyless job aggregators, behind the existing `api` source kind (PRD §7).
 *
 * Greenhouse, Lever and Ashby are per-company: you only ever see boards you named, so
 * breadth costs one source row per employer. These four are cross-company and mostly
 * remote-global, which is the category reachable from anywhere without a visa — for a
 * Nigeria-based candidate that is the highest-yield source there is.
 *
 * They ride the `api` kind with a `config.adapter` discriminator rather than new
 * `source_kind` enum values, so adding the fifth needs no migration.
 *
 * Every posting keeps its `url`, which is the attribution these boards ask for.
 */

const ADAPTERS = ["remotive", "arbeitnow", "himalayas", "jobicy"] as const;
export type AdapterName = (typeof ADAPTERS)[number];

export const aggregatorConfigSchema = z.object({
  adapter: z.enum(ADAPTERS),
  /** Postings to request. Kept modest: the relevance gate runs after, not instead. */
  limit: z.number().int().min(1).max(500).default(100),
});

/** Seconds since the epoch → Date. Two of the four publish dates this way. */
function fromEpochSeconds(value: number | null | undefined): Date | null {
  return typeof value === "number" && value > 0 ? new Date(value * 1000) : null;
}

const remotiveSchema = z.object({
  jobs: z.array(
    z.object({
      id: z.number(),
      url: z.url(),
      title: z.string(),
      company_name: z.string(),
      candidate_required_location: z.string().nullish(),
      publication_date: z.string().nullish(),
      description: z.string().nullish(),
    }),
  ),
});

const arbeitnowSchema = z.object({
  data: z.array(
    z.object({
      slug: z.string(),
      url: z.url(),
      title: z.string(),
      company_name: z.string(),
      location: z.string().nullish(),
      remote: z.boolean().optional(),
      created_at: z.number().nullish(),
      description: z.string().nullish(),
    }),
  ),
});

const himalayasSchema = z.object({
  jobs: z.array(
    z.object({
      guid: z.string(),
      title: z.string(),
      companyName: z.string(),
      locationRestrictions: z.array(z.string()).nullish(),
      pubDate: z.number().nullish(),
      applicationLink: z.string().nullish(),
      description: z.string().nullish(),
    }),
  ),
});

const jobicySchema = z.object({
  jobs: z.array(
    z.object({
      id: z.union([z.number(), z.string()]),
      url: z.url(),
      jobTitle: z.string(),
      companyName: z.string(),
      jobGeo: z.string().nullish(),
      pubDate: z.string().nullish(),
      jobDescription: z.string().nullish(),
    }),
  ),
});

/**
 * Each adapter is a URL and a pure mapper. Exported so the mappers are unit-tested
 * against recorded payloads without touching the network.
 */
export const ADAPTER_IMPLS: Record<
  AdapterName,
  { url: (limit: number) => string; normalize: (payload: unknown) => NormalizedJob[] }
> = {
  remotive: {
    url: (limit) => `https://remotive.com/api/remote-jobs?limit=${limit}`,
    normalize: (payload) =>
      remotiveSchema.parse(payload).jobs.map((job) => ({
        externalId: String(job.id),
        title: job.title.trim(),
        company: job.company_name.trim(),
        // Remotive states eligibility rather than an office: "USA", "Worldwide".
        location: job.candidate_required_location?.trim() || null,
        remote: true,
        url: job.url,
        description: htmlToText(job.description ?? ""),
        postedAt: job.publication_date ? new Date(job.publication_date) : null,
        raw: job as unknown as Record<string, unknown>,
      })),
  },

  arbeitnow: {
    // Returns a fixed page; `limit` trims locally rather than being a query parameter.
    url: () => "https://www.arbeitnow.com/api/job-board-api",
    normalize: (payload) =>
      arbeitnowSchema.parse(payload).data.map((job) => ({
        externalId: job.slug,
        title: job.title.trim(),
        company: job.company_name.trim(),
        location: job.location?.trim() || null,
        remote: job.remote ?? false,
        url: job.url,
        description: htmlToText(job.description ?? ""),
        postedAt: fromEpochSeconds(job.created_at),
        raw: job as unknown as Record<string, unknown>,
      })),
  },

  himalayas: {
    url: (limit) => `https://himalayas.app/jobs/api?limit=${limit}`,
    normalize: (payload) =>
      himalayasSchema.parse(payload).jobs.map((job) => ({
        externalId: job.guid,
        title: job.title.trim(),
        company: job.companyName.trim(),
        location: job.locationRestrictions?.join(", ").trim() || null,
        remote: true,
        url: job.applicationLink ?? job.guid,
        description: htmlToText(job.description ?? ""),
        postedAt: fromEpochSeconds(job.pubDate),
        raw: job as unknown as Record<string, unknown>,
      })),
  },

  jobicy: {
    url: (limit) => `https://jobicy.com/api/v2/remote-jobs?count=${limit}`,
    normalize: (payload) =>
      jobicySchema.parse(payload).jobs.map((job) => ({
        externalId: String(job.id),
        title: job.jobTitle.trim(),
        company: job.companyName.trim(),
        location: job.jobGeo?.trim() || null,
        remote: true,
        url: job.url,
        description: htmlToText(job.jobDescription ?? ""),
        postedAt: job.pubDate ? new Date(job.pubDate) : null,
        raw: job as unknown as Record<string, unknown>,
      })),
  },
};

export const fetchAggregator: SourceFetcher = async (rawConfig) => {
  const config = aggregatorConfigSchema.parse(rawConfig);
  const impl = ADAPTER_IMPLS[config.adapter];

  const payload = await fetchJson(impl.url(config.limit), `Aggregator "${config.adapter}"`);
  return impl.normalize(payload).slice(0, config.limit);
};
