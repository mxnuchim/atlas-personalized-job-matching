import type { NormalizedJob } from "./sources";

/**
 * Collapse one role advertised in many places into a single posting.
 *
 * A company that opens a role in fourteen cities publishes fourteen postings with
 * fourteen ids, and `(source_id, external_id)` — the idempotency key — correctly
 * treats them as distinct. Measured on a real ingest: 4,182 rows for 3,421 distinct
 * company+title pairs, with one Databricks role listed 14 times and a Celonis one 11.
 * Left alone that is fourteen LLM calls to reach one verdict, and a Matches list that
 * shows you the same job fourteen times.
 *
 * Runs *after* the relevance gate, never before: each variant is judged on its own
 * location first, so a role open in both Singapore and London keeps London and drops
 * Singapore, rather than merging into an ambiguous blob and being judged once.
 *
 * Scope is one source. The same role listed on both a company board and an aggregator
 * is a different problem — different `source_id`, so the unique index permits both —
 * and is not what the measured duplication was.
 */

/** Distinct locations shown before the merge is summarised. */
const MAX_LOCATIONS = 6;

function key(job: NormalizedJob): string {
  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  return `${norm(job.company)}\u0000${norm(job.title)}`;
}

function mergeLocations(variants: NormalizedJob[]): string | null {
  const seen = new Set<string>();
  for (const variant of variants) {
    const location = variant.location?.trim();
    if (location) seen.add(location);
  }
  if (seen.size === 0) return null;

  // Sorted so the merged value is stable across runs — an unstable string would make
  // every ingest look like a change.
  const sorted = [...seen].sort();
  if (sorted.length <= MAX_LOCATIONS) return sorted.join("; ");
  return `${sorted.slice(0, MAX_LOCATIONS).join("; ")} +${sorted.length - MAX_LOCATIONS} more`;
}

export function collapseRoles(jobs: NormalizedJob[]): NormalizedJob[] {
  const groups = new Map<string, NormalizedJob[]>();
  for (const job of jobs) {
    const k = key(job);
    const existing = groups.get(k);
    if (existing) existing.push(job);
    else groups.set(k, [job]);
  }

  return [...groups.values()].map((variants) => {
    if (variants.length === 1) return variants[0];

    // The representative is chosen by lowest external id, not by payload order. If it
    // were positional, a board reordering its response would elect a different id,
    // which the unique index would store as a *new* job — the collapse would breed
    // duplicates instead of removing them.
    const representative = variants.reduce((best, variant) =>
      variant.externalId < best.externalId ? variant : best,
    );

    // Earliest date wins: this is how long the role has actually been open. Taking the
    // latest would let a re-post into one new city refresh a year-old requisition, and
    // hiding that is the precise thing the freshness window exists to prevent.
    const dates = variants.map((v) => v.postedAt).filter((d): d is Date => d !== null);
    const postedAt = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;

    return {
      ...representative,
      location: mergeLocations(variants),
      remote: variants.some((variant) => variant.remote),
      postedAt,
    };
  });
}
