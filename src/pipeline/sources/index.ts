import { fetchAggregator } from "./aggregators";
import { fetchAshby } from "./ashby";
import { fetchGreenhouse } from "./greenhouse";
import { fetchLever } from "./lever";
import type { SourceFetcher } from "./types";

/**
 * Registry of source fetchers keyed by `source_kind` (PRD §7).
 *
 * `greenhouse`/`lever`/`ashby` are per-company ATS boards — one source row per
 * employer, `config` naming the board token. `api` is the cross-company aggregators,
 * discriminated by `config.adapter`. `rss` has no fetcher yet and is skipped.
 */
const FETCHERS: Partial<Record<string, SourceFetcher>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  api: fetchAggregator,
};

export function getFetcher(kind: string): SourceFetcher | null {
  return FETCHERS[kind] ?? null;
}

export type { NormalizedJob, SourceFetcher } from "./types";
