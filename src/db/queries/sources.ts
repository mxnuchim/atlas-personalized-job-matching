import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobs, sources, users, type NewSource, type Source } from "@/db/schema";

export async function getEnabledSources(): Promise<Source[]> {
  return db.select().from(sources).where(eq(sources.enabled, true));
}

/**
 * Every source with what it has actually produced. The counts are the point: a board
 * that has been enabled for a week and holds nothing is either misconfigured or not
 * hiring, and without the number next to it you cannot tell which.
 */
export type SourceRow = Source & {
  jobCount: number;
  openCount: number;
  /** Who turned it off, resolved — a switch with no author explains nothing. */
  disabledByName: string | null;
};

export async function listSourcesWithCounts(): Promise<SourceRow[]> {
  const rows = await db
    .select({
      source: sources,
      jobCount: sql<number>`count(${jobs.id})::int`,
      openCount: sql<number>`count(${jobs.id}) filter (where ${jobs.closedAt} is null)::int`,
      disabledByName: sql<string | null>`max(coalesce(${users.name}, ${users.email}))`,
    })
    .from(sources)
    .leftJoin(jobs, eq(jobs.sourceId, sources.id))
    .leftJoin(users, eq(users.id, sources.disabledBy))
    .groupBy(sources.id)
    .orderBy(asc(sources.name));

  return rows.map(({ source, jobCount, openCount, disabledByName }) => ({
    ...source,
    jobCount,
    openCount,
    disabledByName,
  }));
}

export async function createSource(row: NewSource): Promise<Source> {
  const [created] = await db.insert(sources).values(row).returning();
  return created;
}

export async function setSourceEnabled(id: string, enabled: boolean): Promise<Source | null> {
  const [row] = await db.update(sources).set({ enabled }).where(eq(sources.id, id)).returning();
  return row ?? null;
}

/**
 * What deleting a source would take with it. `jobs` cascades from `sources`, and
 * `matches`/`drafts` cascade from `jobs` — so removing a board silently destroys
 * scored history and anything drafted from it. The UI states these numbers before
 * asking, because the cascade is invisible from the button.
 */
export async function getSourceImpact(id: string): Promise<{ jobs: number; matches: number }> {
  const [row] = await db
    .select({
      jobs: sql<number>`count(distinct ${jobs.id})::int`,
      matches: sql<number>`(
        select count(*)::int from matches m
        join jobs j on j.id = m.job_id
        where j.source_id = ${id}
      )`,
    })
    .from(jobs)
    .where(eq(jobs.sourceId, id));

  return { jobs: row?.jobs ?? 0, matches: row?.matches ?? 0 };
}

export async function deleteSource(id: string): Promise<void> {
  await db.delete(sources).where(eq(sources.id, id));
}

export async function getSource(id: string): Promise<Source | null> {
  const [row] = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
  return row ?? null;
}

/**
 * Health is written only here, only by the pipeline. A user's opinion about a source
 * lives in `enabled`; whether it answers is not an opinion.
 */
export async function recordSourceSuccess(id: string): Promise<void> {
  await db
    .update(sources)
    .set({ lastOkAt: new Date(), consecutiveFailures: 0, lastError: null })
    .where(eq(sources.id, id));
}

export async function recordSourceFailure(id: string, message: string): Promise<void> {
  await db
    .update(sources)
    .set({
      lastErrorAt: new Date(),
      // Incremented in SQL rather than read-modify-write: two runs must never race
      // each other into losing a failure and resetting the backoff.
      consecutiveFailures: sql`${sources.consecutiveFailures} + 1`,
      lastError: message.slice(0, 500),
    })
    .where(eq(sources.id, id));
}

/** Set or clear `enabled`, recording who did it — a switch with no author is a mystery. */
export async function setSourceEnabledBy(
  id: string,
  enabled: boolean,
  userId: string,
): Promise<Source | null> {
  const [row] = await db
    .update(sources)
    .set(
      enabled
        ? { enabled: true, disabledBy: null, disabledAt: null }
        : { enabled: false, disabledBy: userId, disabledAt: new Date() },
    )
    .where(eq(sources.id, id))
    .returning();
  return row ?? null;
}
