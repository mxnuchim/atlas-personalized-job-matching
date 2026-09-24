/**
 * The shape every source fetcher produces, mapped onto the `jobs` table by the
 * ingest step (PRD §7). `externalId` is the source's stable id for the posting;
 * `(source_id, externalId)` is the dedupe key.
 */
export type NormalizedJob = {
  externalId: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  url: string;
  description: string;
  postedAt: Date | null;
  raw: Record<string, unknown>;
};

/** A fetcher takes a source's stored `config` and returns normalized postings. */
export type SourceFetcher = (config: unknown) => Promise<NormalizedJob[]>;
