import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { dailyPicks, jobs, matches, outreach } from "@/db/schema";
import { env } from "@/lib/env";
import { LANES, type Lane } from "@/lib/lanes";
import { selectLane } from "@/lib/picks";
import { queueDay } from "@/lib/schedule";

import { toMatchRow, type MatchRow } from "./matches";

/**
 * Today's two fixed lists (see `daily_picks`). Chosen once per queue day per lane, then
 * only read: acting on a role is progress against the day's set, never a reason to load
 * another. Which roles make it is `selectLane` (lib/picks.ts): strong/possible only, gated
 * on role, seniority and location fit, ranked by a feasibility-weighted pick score, near-
 * duplicates collapsed, at most `MAX_PER_COMPANY` per employer.
 */

export function laneSize(lane: Lane): number {
  return lane === "nigeria" ? env.DAILY_NIGERIA_SIZE : env.DAILY_QUEUE_SIZE;
}

/** Not yet acted on: no outreach, or only a draft. Same rule the old queue used. */
const unacted = or(isNull(outreach.id), eq(outreach.status, "drafted"));

/**
 * Make sure the day's picks exist for every lane — a no-op once they do. Called by the
 * morning run (so the email lists exactly what Today shows) and by the first view of the
 * day (in case the run hasn't happened). An advisory lock serialises the two, so a race
 * can't pick a lane twice.
 */
export async function ensureDailyPicks(profileId: string, day: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`daily:${profileId}:${day}`}))`);

    const existing = await tx
      .selectDistinct({ lane: dailyPicks.lane })
      .from(dailyPicks)
      .where(and(eq(dailyPicks.profileId, profileId), eq(dailyPicks.day, day)));
    const have = new Set(existing.map((e) => e.lane));
    const missing = LANES.filter((lane) => !have.has(lane));
    if (missing.length === 0) return;

    // Light rows only — the full posting is read for the ~30 picked, not ~1,000 candidates.
    const candidates = await tx
      .select({
        id: matches.id,
        company: jobs.company,
        title: jobs.title,
        location: jobs.location,
        overall: matches.overall,
        dimensions: matches.dimensions,
        redFlags: matches.redFlags,
        postedAt: jobs.postedAt,
      })
      .from(matches)
      .innerJoin(jobs, eq(matches.jobId, jobs.id))
      .leftJoin(outreach, eq(outreach.matchId, matches.id))
      .where(
        and(
          eq(matches.profileId, profileId),
          isNull(jobs.closedAt),
          inArray(matches.tier, ["strong", "possible"]),
          unacted,
        ),
      )
      .orderBy(desc(matches.overall), desc(matches.scoredAt)); // stable input; selectLane ranks

    for (const lane of missing) {
      const picked = selectLane(candidates, lane, laneSize(lane), env.MAX_PER_COMPANY);
      if (picked.length === 0) continue; // Nothing clears the bar — the next view tries again.
      await tx
        .insert(dailyPicks)
        .values(picked.map((p, position) => ({ profileId, day, lane, matchId: p.id, position })))
        .onConflictDoNothing();
    }
  });
}

export type LaneView = {
  lane: Lane;
  /** Picked and not yet acted on, in pick order. */
  remaining: MatchRow[];
  /** Acted on today (applied, dismissed, or further along). */
  done: number;
  /** The day's set, less any role whose posting has since closed. */
  total: number;
};

export async function readLane(profileId: string, day: string, lane: Lane): Promise<LaneView> {
  const rows = await db
    .select({ matches, jobs, status: outreach.status })
    .from(dailyPicks)
    .innerJoin(matches, eq(dailyPicks.matchId, matches.id))
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .leftJoin(outreach, eq(outreach.matchId, matches.id))
    .where(and(eq(dailyPicks.profileId, profileId), eq(dailyPicks.day, day), eq(dailyPicks.lane, lane)))
    .orderBy(asc(dailyPicks.position));

  const now = new Date();
  const acted = (status: string | null) => status !== null && status !== "drafted";
  const done = rows.filter((r) => acted(r.status)).length;
  // A role that closed since the morning can't be applied to, so it leaves the set
  // rather than sitting there undoable.
  const remaining = rows
    .filter((r) => !acted(r.status) && r.jobs.closedAt === null)
    .map((r) => toMatchRow(r.matches, r.jobs, now));

  return { lane, remaining, done, total: done + remaining.length };
}

/** The queue day right now, in the app's zone — shared by the page and the morning run. */
export function currentQueueDay(): string {
  return queueDay(new Date(), env.APP_TZ);
}

/** Both lanes, creating today's picks first if they don't exist yet. */
export async function todaysLanes(
  profileId: string,
  day: string = currentQueueDay(),
): Promise<Record<Lane, LaneView>> {
  await ensureDailyPicks(profileId, day);
  const [nigeria, global] = await Promise.all([
    readLane(profileId, day, "nigeria"),
    readLane(profileId, day, "global"),
  ]);
  return { nigeria, global };
}
