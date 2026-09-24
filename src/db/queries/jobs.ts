import { desc, sql } from "drizzle-orm";

import { db } from "@/db";
import { jobs, type Job } from "@/db/schema";

/** Most-recently-seen postings first, for the Jobs list (PRD §8). */
export async function listJobs(limit = 200): Promise<Job[]> {
  return db.select().from(jobs).orderBy(desc(jobs.firstSeenAt)).limit(limit);
}

export async function countJobs(): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(jobs);
  return row?.count ?? 0;
}
