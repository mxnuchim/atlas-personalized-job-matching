import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobs, sources, type NewSource, type Source } from "@/db/schema";

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
};

export async function listSourcesWithCounts(): Promise<SourceRow[]> {
  const rows = await db
    .select({
      source: sources,
      jobCount: sql<number>`count(${jobs.id})::int`,
      openCount: sql<number>`count(${jobs.id}) filter (where ${jobs.closedAt} is null)::int`,
    })
    .from(sources)
    .leftJoin(jobs, eq(jobs.sourceId, sources.id))
    .groupBy(sources.id)
    .orderBy(asc(sources.name));

  return rows.map(({ source, jobCount, openCount }) => ({ ...source, jobCount, openCount }));
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
