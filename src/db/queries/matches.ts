import { and, desc, eq, isNull, notExists, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  jobs,
  matches,
  outreach,
  type FitDimensions,
  type Job,
  type Match,
  type StrengthMatch,
} from "@/db/schema";
import { isStale, relativeAge } from "@/lib/age";
import { htmlToText } from "@/lib/html";
import type { FitTier } from "@/lib/scoring";

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
      and(
        // A closed posting is not worth a scoring call — the role is gone.
        isNull(jobs.closedAt),
        notExists(
          db
            .select({ one: sql`1` })
            .from(matches)
            .where(and(eq(matches.jobId, jobs.id), eq(matches.profileVersion, profileVersion))),
        ),
      ),
    )
    .orderBy(desc(jobs.firstSeenAt))
    .limit(limit);
}

/**
 * The shape the Matches UI actually renders. Built on the server and handed to a
 * client island, so it is deliberately lean and fully serializable: dates are
 * pre-formatted (formatting them on the client risks a locale hydration mismatch)
 * and the posting is decoded to plain text and capped, since raw job HTML is by far
 * the largest thing in the payload.
 */
export type MatchRow = {
  id: string;
  jobId: string;
  overall: number;
  tier: FitTier;
  dimensions: FitDimensions;
  strengthMatches: StrengthMatch[];
  whyYou: string;
  reasoning: string;
  redFlags: string[];
  model: string;
  /** ISO — for sorting. */
  scoredAt: string;
  /** Pre-formatted for display. */
  scoredAtLabel: string;
  title: string;
  company: string;
  location: string | null;
  remote: boolean;
  url: string;
  /**
   * How long the role has been open, pre-formatted on the server. Computing it in the
   * client island would compare the browser's clock to the server's render and
   * mismatch on hydration. Null when the board published no date.
   */
  /** ISO — for sorting. Null when the board published no date. */
  postedAt: string | null;
  postedAgeLabel: string | null;
  /** Open long enough to be an evergreen requisition rather than a new opening. */
  evergreen: boolean;
  /**
   * The posting has come off its board — filled or withdrawn. The match is kept (you
   * may already have drafted for it) but it must be visibly dead, or you would send
   * outreach for a role that no longer exists.
   */
  closed: boolean;
  /** Plain text, capped. `descriptionTruncated` says whether anything was cut. */
  description: string;
  descriptionTruncated: boolean;
};

/** Generous enough to read in the drawer; the original is always one link away. */
const MAX_DESCRIPTION_CHARS = 9000;

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/** Scored matches shaped for the UI, best fit first. */
export async function listMatchRows(limit = 200, profileVersion?: number): Promise<MatchRow[]> {
  const rows = await db
    .select()
    .from(matches)
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .where(profileVersion ? eq(matches.profileVersion, profileVersion) : undefined)
    .orderBy(desc(matches.overall), desc(matches.scoredAt))
    .limit(limit);

  // One instant for the whole page, so two rows of the same age never disagree.
  const now = new Date();

  return rows.map(({ matches: m, jobs: j }) => toMatchRow(m, j, now));
}

/** One place that turns a (match, job) pair into what the UI renders. */
function toMatchRow(m: Match, j: Job, now: Date): MatchRow {
  {
    const text = htmlToText(j.description ?? "");
    return {
      id: m.id,
      jobId: m.jobId,
      overall: m.overall,
      tier: m.tier as FitTier,
      dimensions: m.dimensions,
      strengthMatches: m.strengthMatches,
      whyYou: m.whyYou,
      reasoning: m.reasoning,
      redFlags: m.redFlags,
      model: m.model,
      scoredAt: m.scoredAt.toISOString(),
      scoredAtLabel: DATE_FORMAT.format(m.scoredAt),
      title: j.title,
      company: j.company,
      location: j.location,
      remote: j.remote,
      url: j.url,
      postedAt: j.postedAt?.toISOString() ?? null,
      postedAgeLabel: relativeAge(j.postedAt, now),
      evergreen: isStale(j.postedAt, 180, now),
      closed: j.closedAt !== null,
      description: text.slice(0, MAX_DESCRIPTION_CHARS),
      descriptionTruncated: text.length > MAX_DESCRIPTION_CHARS,
    };
  }
}

/**
 * The day's queue: the best matches you have not yet acted on.
 *
 * Capped on purpose. The constraint is how many roles a person can apply to in a day —
 * ten or twenty — not how many exist, and a list of four hundred is the same as no
 * list at all. Acting on one removes it, so tomorrow's queue is genuinely new.
 *
 * "Not acted on" means no outreach row, or one still at `drafted`. Anything sent,
 * closed or further along has been dealt with and does not come back.
 */
export async function listDailyQueue(limit: number): Promise<MatchRow[]> {
  const rows = await db
    .select({ matches, jobs })
    .from(matches)
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .leftJoin(outreach, eq(outreach.matchId, matches.id))
    .where(and(isNull(jobs.closedAt), or(isNull(outreach.id), eq(outreach.status, "drafted"))))
    .orderBy(desc(matches.overall), desc(matches.scoredAt))
    .limit(limit);

  const now = new Date();
  return rows.map(({ matches: m, jobs: j }) => toMatchRow(m, j, now));
}

/** How many matches are waiting, so the queue can say what it is holding back. */
export async function countDailyQueue(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(matches)
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .leftJoin(outreach, eq(outreach.matchId, matches.id))
    .where(and(isNull(jobs.closedAt), or(isNull(outreach.id), eq(outreach.status, "drafted"))));
  return row?.count ?? 0;
}

/** Counts for the Today strip, done in SQL rather than by loading every row. */
export async function getMatchCounts(profileVersion?: number) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      strong: sql<number>`count(*) filter (where ${matches.tier} = 'strong')::int`,
      possible: sql<number>`count(*) filter (where ${matches.tier} = 'possible')::int`,
      scoredToday: sql<number>`count(*) filter (where ${matches.scoredAt} >= date_trunc('day', now()))::int`,
    })
    .from(matches)
    .where(profileVersion ? eq(matches.profileVersion, profileVersion) : undefined);

  return row ?? { total: 0, strong: 0, possible: 0, scoredToday: 0 };
}
