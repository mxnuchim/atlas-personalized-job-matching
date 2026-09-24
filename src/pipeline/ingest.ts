import "server-only";

import { db } from "@/db";
import { getEnabledSources } from "@/db/queries/sources";
import { jobs, type NewJob, type Source } from "@/db/schema";
import { log } from "@/lib/logger";

import { getFetcher } from "./sources";

/** Per-source outcome. `duplicates` are postings already stored (the dedupe win). */
export type IngestResult = {
  source: string;
  seen: number;
  inserted: number;
  duplicates: number;
  error?: string;
};

export type IngestSummary = {
  seen: number;
  inserted: number;
  duplicates: number;
  results: IngestResult[];
};

/**
 * Ingest one source: fetch → normalize → insert, skipping postings we already
 * have via `ON CONFLICT (source_id, external_id) DO NOTHING`. Idempotent by
 * construction — re-running inserts nothing new (PRD §7 / §8). A fetch failure is
 * captured on the result, never thrown, so one bad source can't sink a run.
 */
export async function ingestSource(source: Source): Promise<IngestResult> {
  const logger = log("ingest");
  const empty = { source: source.name, seen: 0, inserted: 0, duplicates: 0 };

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

  // Guard against a source repeating an external id within one payload; the DB
  // unique index would also catch it, but this keeps the insert well-formed.
  const deduped = new Map<string, NewJob>();
  for (const job of normalized) {
    deduped.set(job.externalId, { ...job, sourceId: source.id });
  }
  const rows = [...deduped.values()];

  if (rows.length === 0) {
    return empty;
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
  };
  logger.info(result, "source ingested");
  return result;
}

/** Ingest every enabled source, aggregating counts (PRD §6 pipeline step 1). */
export async function runIngest(): Promise<IngestSummary> {
  const sources = await getEnabledSources();
  const results: IngestResult[] = [];

  for (const source of sources) {
    results.push(await ingestSource(source));
  }

  return {
    seen: results.reduce((total, result) => total + result.seen, 0),
    inserted: results.reduce((total, result) => total + result.inserted, 0),
    duplicates: results.reduce((total, result) => total + result.duplicates, 0),
    results,
  };
}
