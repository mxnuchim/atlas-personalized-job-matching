import { and, desc, eq, gte, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobs, type Job } from "@/db/schema";
import {
  clampPage,
  offsetOf,
  type PageParams,
  paginated,
  type Paginated,
} from "@/lib/pagination";

/**
 * How fresh a posting has to be to appear on the Jobs screen.
 *
 * This is a *view* over what was ingested, not an ingest filter — changing it is a
 * link, not a re-ingest, so the window can be tuned without losing data. It matters
 * because an ATS board returns every open requisition, not new ones: a first run
 * pulls the whole standing market, including reqs open since 2023. Without a window
 * the list reads as "4,000 jobs appeared today", which is false.
 */
export const FRESHNESS_WINDOWS = {
  "24h": { label: "24 hours", hours: 24 },
  "48h": { label: "48 hours", hours: 48 },
  "7d": { label: "7 days", hours: 24 * 7 },
  "30d": { label: "30 days", hours: 24 * 30 },
  all: { label: "All time", hours: null },
} as const;

export type FreshnessKey = keyof typeof FRESHNESS_WINDOWS;

export const DEFAULT_FRESHNESS: FreshnessKey = "48h";

export function parseFreshness(value: unknown): FreshnessKey {
  return typeof value === "string" && value in FRESHNESS_WINDOWS
    ? (value as FreshnessKey)
    : DEFAULT_FRESHNESS;
}

function since(window: FreshnessKey): Date | null {
  const { hours } = FRESHNESS_WINDOWS[window];
  return hours === null ? null : new Date(Date.now() - hours * 3_600_000);
}

/**
 * Postings within the window, newest *posted* first — not newest ingested, which is
 * the same instant for thousands of rows after a first run and so sorts arbitrarily.
 *
 * An undated posting is excluded from every bounded window: "no date" is not evidence
 * of freshness, and quietly admitting it would undo the point of asking for 48 hours.
 * They remain visible under "All time".
 */
export async function listJobs(
  window: FreshnessKey = DEFAULT_FRESHNESS,
  limit = 200,
): Promise<Job[]> {
  return db
    .select()
    .from(jobs)
    .where(freshnessWhere(window))
    .orderBy(desc(jobs.postedAt), desc(jobs.firstSeenAt))
    .limit(limit);
}

/** The open/dated/in-window predicate, shared by the list and its count. */
function freshnessWhere(window: FreshnessKey) {
  const cutoff = since(window);
  return cutoff
    ? and(isNull(jobs.closedAt), isNotNull(jobs.postedAt), gte(jobs.postedAt, cutoff))
    : isNull(jobs.closedAt);
}

/**
 * Postings in the window, paginated in SQL. Same shape and discipline as the matches
 * console — the count query shares the exact predicate, so "X–Y of N" never disagrees
 * with the rows below it, and an out-of-range `?page=` clamps to the last page.
 */
export async function listJobsPage(
  window: FreshnessKey,
  { page, pageSize }: PageParams,
): Promise<Paginated<Job>> {
  const where = freshnessWhere(window);

  const [counted] = await db.select({ count: sql<number>`count(*)::int` }).from(jobs).where(where);
  const total = counted?.count ?? 0;
  const safePage = clampPage(page, total, pageSize);

  const rows = await db
    .select()
    .from(jobs)
    .where(where)
    .orderBy(desc(jobs.postedAt), desc(jobs.firstSeenAt))
    .limit(pageSize)
    .offset(offsetOf(safePage, pageSize));

  return paginated(rows, total, safePage, pageSize);
}

export async function countJobs(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(jobs);
  return row?.count ?? 0;
}

/**
 * How many postings each window would show. Rendered on the switcher so the choice
 * between 24h and 7d is made against the actual numbers rather than guessed at.
 * One round trip — filtered aggregates, not five queries.
 */
export async function countJobsByFreshness(): Promise<Record<FreshnessKey, number>> {
  const bounded = (hours: number) =>
    sql<number>`count(*) filter (where ${jobs.postedAt} >= now() - make_interval(hours => ${hours}))::int`;

  const [row] = await db
    .select({
      "24h": bounded(24),
      "48h": bounded(48),
      "7d": bounded(24 * 7),
      "30d": bounded(24 * 30),
      all: sql<number>`count(*)::int`,
    })
    .from(jobs)
    .where(isNull(jobs.closedAt));

  return {
    "24h": row?.["24h"] ?? 0,
    "48h": row?.["48h"] ?? 0,
    "7d": row?.["7d"] ?? 0,
    "30d": row?.["30d"] ?? 0,
    all: row?.all ?? 0,
  };
}

/**
 * Every external id this source has on file, split by whether it is still open.
 * Closure detection needs both: the open ones to test for absence, the closed ones so
 * a posting that reappears can be revived (see `pipeline/closure.ts`).
 */
export async function getSourceExternalIds(
  sourceId: string,
): Promise<{ open: string[]; closed: string[] }> {
  const rows = await db
    .select({ externalId: jobs.externalId, closedAt: jobs.closedAt })
    .from(jobs)
    .where(eq(jobs.sourceId, sourceId));

  return {
    open: rows.filter((r) => r.closedAt === null).map((r) => r.externalId),
    closed: rows.filter((r) => r.closedAt !== null).map((r) => r.externalId),
  };
}

/** Mark postings closed. Never deletes — `matches` and `drafts` cascade off this row. */
export async function markJobsClosed(sourceId: string, externalIds: string[]): Promise<number> {
  if (externalIds.length === 0) return 0;
  const rows = await db
    .update(jobs)
    .set({ closedAt: new Date() })
    .where(and(eq(jobs.sourceId, sourceId), inArray(jobs.externalId, externalIds)))
    .returning({ id: jobs.id });
  return rows.length;
}

/** Revive postings that came back. A board dropping an entry for one run is not a close. */
export async function reopenJobs(sourceId: string, externalIds: string[]): Promise<number> {
  if (externalIds.length === 0) return 0;
  const rows = await db
    .update(jobs)
    .set({ closedAt: null })
    .where(and(eq(jobs.sourceId, sourceId), inArray(jobs.externalId, externalIds)))
    .returning({ id: jobs.id });
  return rows.length;
}
