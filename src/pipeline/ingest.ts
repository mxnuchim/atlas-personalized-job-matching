import "server-only";

import { db } from "@/db";
import { getCurrentProfile } from "@/db/queries/profile";
import { getEnabledSources } from "@/db/queries/sources";
import { jobs, type NewJob, type Source } from "@/db/schema";
import { log } from "@/lib/logger";

import { buildCriteria, isRelevant, type RelevanceCriteria } from "./relevance";
import { getFetcher } from "./sources";

/**
 * Per-source outcome. `duplicates` are postings already stored (the dedupe win);
 * `filtered` are postings the relevance gate rejected before they were ever stored.
 */
export type IngestResult = {
  source: string;
  seen: number;
  inserted: number;
  duplicates: number;
  filtered: number;
  error?: string;
};

export type IngestSummary = {
  seen: number;
  inserted: number;
  duplicates: number;
  filtered: number;
  results: IngestResult[];
};

/**
 * Ingest one source: fetch → normalize → insert, skipping postings we already
 * have via `ON CONFLICT (source_id, external_id) DO NOTHING`. Idempotent by
 * construction — re-running inserts nothing new (PRD §7 / §8). A fetch failure is
 * captured on the result, never thrown, so one bad source can't sink a run.
 */
export async function ingestSource(
  source: Source,
  criteria: RelevanceCriteria | null,
): Promise<IngestResult> {
  const logger = log("ingest");
  const empty = { source: source.name, seen: 0, inserted: 0, duplicates: 0, filtered: 0 };

  const fetcher = getFetcher(source.kind);
  if (!fetcher) {
    return { ...empty, error: `No fetcher for source kind "${source.kind}"` };
  }

  let normalized;
  try {
    normalized = await fetcher(source.config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ source: source.name, error: message }, "source fetch failed");
    return { ...empty, error: message };
  }

  // The relevance gate (see `./relevance`) runs before anything is stored. Dozens of
  // boards is thousands of postings, and scoring is one LLM call each — filtering here
  // keeps the corpus, the queue and the bill proportionate to what is actually worth
  // reading. A run with no profile yet filters nothing rather than dropping everything.
  const relevant = criteria
    ? normalized.filter(
        (job) => isRelevant({ title: job.title, location: job.location }, criteria).keep,
      )
    : normalized;
  const filtered = normalized.length - relevant.length;

  // Guard against a source repeating an external id within one payload; the DB
  // unique index would also catch it, but this keeps the insert well-formed.
  const deduped = new Map<string, NewJob>();
  for (const job of relevant) {
    deduped.set(job.externalId, { ...job, sourceId: source.id });
  }
  const rows = [...deduped.values()];

  if (rows.length === 0) {
    return { ...empty, seen: normalized.length, filtered };
  }

  const insertedRows = await db
    .insert(jobs)
    .values(rows)
    .onConflictDoNothing({ target: [jobs.sourceId, jobs.externalId] })
    .returning({ id: jobs.id });

  const result: IngestResult = {
    source: source.name,
    seen: normalized.length,
    inserted: insertedRows.length,
    duplicates: rows.length - insertedRows.length,
    filtered,
  };
  logger.info(result, "source ingested");
  return result;
}

/** Ingest every enabled source, aggregating counts (PRD §6 pipeline step 1). */
export async function runIngest(): Promise<IngestSummary> {
  const logger = log("ingest");
  const sources = await getEnabledSources();

  // Built once per run, not per source: the criteria come from the profile, which does
  // not change mid-run. No profile yet means no filtering — better to over-collect on
  // a first run than to silently discard every posting.
  const profile = await getCurrentProfile();
  const criteria = profile
    ? buildCriteria({ targetRoles: profile.targetRoles, locations: profile.locations })
    : null;
  if (!criteria) {
    logger.warn("no profile yet — ingesting without the relevance gate");
  }

  const results: IngestResult[] = [];
  for (const source of sources) {
    results.push(await ingestSource(source, criteria));
  }

  const summary = {
    seen: results.reduce((total, result) => total + result.seen, 0),
    inserted: results.reduce((total, result) => total + result.inserted, 0),
    duplicates: results.reduce((total, result) => total + result.duplicates, 0),
    filtered: results.reduce((total, result) => total + result.filtered, 0),
    results,
  };
  logger.info({ sources: sources.length, ...summary, results: undefined }, "ingest complete");
  return summary;
}
