import { and, desc, eq, notExists, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobs, matches, type Job, type Match } from "@/db/schema";

export type MatchWithJob = Match & { job: Job };

/** Scored matches with their job, best fit first (PRD §9). */
export async function listMatches(profileVersion?: number): Promise<MatchWithJob[]> {
  const rows = await db
    .select()
    .from(matches)
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .where(profileVersion ? eq(matches.profileVersion, profileVersion) : undefined)
    .orderBy(desc(matches.overall), desc(matches.scoredAt));

  return rows.map((row) => ({ ...row.matches, job: row.jobs }));
}

/** Jobs with no match yet for this profile version — the scorer's work queue. */
export async function getUnscoredJobs(profileVersion: number, limit: number): Promise<Job[]> {
  return db
    .select()
    .from(jobs)
    .where(
      notExists(
        db
          .select({ one: sql`1` })
          .from(matches)
          .where(and(eq(matches.jobId, jobs.id), eq(matches.profileVersion, profileVersion))),
      ),
    )
    .orderBy(desc(jobs.firstSeenAt))
    .limit(limit);
}
