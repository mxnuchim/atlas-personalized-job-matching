import { fetchGreenhouse } from "./greenhouse";
import type { SourceFetcher } from "./types";

/**
 * Registry of source fetchers keyed by `source_kind` (PRD §7). Kinds without a
 * fetcher yet (lever, ashby, rss, api) return null and are skipped by ingest.
 */
const FETCHERS: Partial<Record<string, SourceFetcher>> = {
  greenhouse: fetchGreenhouse,
};

export function getFetcher(kind: string): SourceFetcher | null {
  return FETCHERS[kind] ?? null;
}

export type { NormalizedJob, SourceFetcher } from "./types";
