import "server-only";

import { db } from "@/db";
import { getSourceExternalIds, markJobsClosed, reopenJobs } from "@/db/queries/jobs";
import { getCurrentProfile, listProfileOwners } from "@/db/queries/profile";
import { getEnabledSources, recordSourceFailure, recordSourceSuccess } from "@/db/queries/sources";
import { jobs, type NewJob, type Source } from "@/db/schema";
import { isStale } from "@/lib/age";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

import { decideClosure } from "./closure";
import { collapseRoles } from "./dedupe";
import { shouldSkip } from "./source-health";
import { buildCriteria, isRelevant, type RelevanceCriteria } from "./relevance";
import { getFetcher } from "./sources";

/**
 * Per-source outcome. `duplicates` are postings already stored (the dedupe win);
 * `filtered` are postings the relevance gate rejected before they were ever stored;
 * `collapsed` are extra listings of a role already counted — one job advertised in
 * many cities; `expired` were older than the posting-age limit; `closed` and
 * `reopened` are stored rows this run marked gone or revived.
 */
export type IngestResult = {
  source: string;
  seen: number;
  inserted: number;
  duplicates: number;
  filtered: number;
  collapsed: number;
  expired: number;
  closed: number;
  reopened: number;
  /** Set when the source was rested rather than attempted. Not an error. */
  resting?: string;
  error?: string;
};

export type IngestSummary = {
  seen: number;
  inserted: number;
  duplicates: number;
  filtered: number;
  collapsed: number;
  expired: number;
  closed: number;
  reopened: number;
  /** How many attempted sources answered, out of how many were attempted. */
  sourcesOk: number;
  sourcesTotal: number;
  /** Rested this run, so neither attempted nor failed. */
  sourcesResting: number;
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
  criteria: RelevanceCriteria[],
): Promise<IngestResult> {
  const logger = log("ingest");
  const empty = {
    source: source.name,
    seen: 0,
    inserted: 0,
    duplicates: 0,
    filtered: 0,
    collapsed: 0,
    expired: 0,
    closed: 0,
    reopened: 0,
  };

  const fetcher = getFetcher(source.kind);
  if (!fetcher) {
    return { ...empty, error: `No fetcher for source kind "${source.kind}"` };
  }

  // A board that has failed repeatedly is rested rather than asked again every run.
  // Reported as `resting`, never as an error: it is a decision we made, not a failure
  // this run suffered, and counting it as one would make coverage look worse than it is.
  const rest = shouldSkip({
    consecutiveFailures: source.consecutiveFailures,
    lastErrorAt: source.lastErrorAt,
  });
  if (rest.skip) {
    logger.info({ source: source.name, until: rest.until, reason: rest.reason }, "source resting");
    return { ...empty, resting: rest.reason };
  }

  let normalized;
  try {
    normalized = await fetcher(source.config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ source: source.name, error: message }, "source fetch failed");
    await recordSourceFailure(source.id, message);
    return { ...empty, error: message };
  }

  await recordSourceSuccess(source.id);

  // Closure detection diffs against the *raw* fetch — every id the board returned,
  // before the age limit and the relevance gate. Diffing the filtered set would read
  // "aged past the window" or "not an engineering title" as "this role is gone".
  const { closed, reopened } = await applyClosure(
    source,
    normalized.map((job) => job.externalId),
  );

  // Postings older than the limit never enter. A board lists every open requisition,
  // so without this a first run ingests years of backlog — and re-ingests it on every
  // run, because deleting a row does not stop the board still listing it.
  // `isStale` owns the one definition of "too old", and it keeps an undated posting:
  // unknown age is not evidence of staleness, and Ashby and Lever omit the field
  // routinely.
  const now = new Date();
  const fresh = normalized.filter((job) => !isStale(job.postedAt, env.MAX_POSTING_AGE_DAYS, now));
  const expired = normalized.length - fresh.length;

  // The relevance gate (see `./relevance`) runs before anything is stored. Dozens of
  // boards is thousands of postings, and scoring is one LLM call each — filtering here
  // keeps the corpus, the queue and the bill proportionate to what is actually worth
  // reading. A run with no profile yet filters nothing rather than dropping everything.
  // The job corpus is shared between users, so a posting survives if it is relevant
  // to *any* profile — filtering to one person's criteria would quietly hide roles
  // from everyone else. No profiles yet means no filtering, rather than dropping
  // everything.
  const relevant =
    criteria.length === 0
      ? fresh
      : fresh.filter((job) =>
          criteria.some((c) => isRelevant({ title: job.title, location: job.location }, c).keep),
        );
  const filtered = fresh.length - relevant.length;

  // One role advertised in many cities is many postings with many ids. Collapse them
  // after the gate, so each variant is judged on its own location first (see
  // `./dedupe`).
  const collapsedJobs = collapseRoles(relevant);
  const collapsed = relevant.length - collapsedJobs.length;

  // Guard against a source repeating an external id within one payload; the DB
  // unique index would also catch it, but this keeps the insert well-formed.
  const deduped = new Map<string, NewJob>();
  for (const job of collapsedJobs) {
    deduped.set(job.externalId, { ...job, sourceId: source.id });
  }
  const rows = [...deduped.values()];

  if (rows.length === 0) {
    return { ...empty, seen: normalized.length, filtered, collapsed, expired, closed, reopened };
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
    collapsed,
    expired,
    closed,
    reopened,
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
  const owners = await listProfileOwners();
  const profiles = (await Promise.all(owners.map((o) => getCurrentProfile(o.userId)))).filter(
    (p) => p !== null,
  );
  const criteria = profiles.map((p) =>
    buildCriteria({ targetRoles: p.targetRoles, locations: p.locations }),
  );
  if (criteria.length === 0) {
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
    collapsed: results.reduce((total, result) => total + result.collapsed, 0),
    expired: results.reduce((total, result) => total + result.expired, 0),
    closed: results.reduce((total, result) => total + result.closed, 0),
    reopened: results.reduce((total, result) => total + result.reopened, 0),
    // Resting sources are excluded from both: coverage answers "of the boards we
    // asked, how many answered", and a board we chose not to ask is neither.
    sourcesOk: results.filter((r) => !r.error && !r.resting).length,
    sourcesTotal: results.filter((r) => !r.resting).length,
    sourcesResting: results.filter((r) => r.resting).length,
    results,
  };
  logger.info({ sources: sources.length, ...summary, results: undefined }, "ingest complete");
  return summary;
}

/**
 * Mark postings that have come off this board, and revive any that came back.
 *
 * Never throws: closure is bookkeeping, and losing it must not cost a run its
 * ingest. `decideClosure` holds the judgement — including the refusals that keep a
 * truncated response from mass-closing live roles.
 */
async function applyClosure(
  source: Source,
  seen: string[],
): Promise<{ closed: number; reopened: number }> {
  const logger = log("ingest");
  try {
    const stored = await getSourceExternalIds(source.id);
    const decision = decideClosure({
      kind: source.kind,
      fetchFailed: false,
      seen,
      storedOpen: stored.open,
      storedClosed: stored.closed,
    });

    if (!decision.act) {
      // Only worth saying when there was something it could have acted on.
      if (stored.open.length > 0 && source.kind !== "api") {
        logger.info({ source: source.name, reason: decision.reason }, "closure skipped");
      }
      return { closed: 0, reopened: 0 };
    }

    const [closed, reopened] = await Promise.all([
      markJobsClosed(source.id, decision.closed),
      reopenJobs(source.id, decision.reopened),
    ]);
    if (closed || reopened) {
      logger.info({ source: source.name, closed, reopened }, "closure applied");
    }
    return { closed, reopened };
  } catch (error) {
    logger.error(
      { source: source.name, error: error instanceof Error ? error.message : String(error) },
      "closure failed",
    );
    return { closed: 0, reopened: 0 };
  }
}
