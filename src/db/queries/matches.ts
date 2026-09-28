import { and, desc, eq, inArray, isNull, notExists, or, sql } from "drizzle-orm";

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
import { capPerCompany } from "@/lib/queue";
import { extractContact } from "@/lib/contact";
import { htmlToText } from "@/lib/html";
import { MIN_FOR_RANK, TIER_SHARES, type FitTier } from "@/lib/scoring";

export type MatchWithJob = Match & { job: Job };

/** Scored matches with their job, best fit first (PRD §9). */
export async function listMatches(profileId: string): Promise<MatchWithJob[]> {
  const rows = await db
    .select()
    .from(matches)
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .where(eq(matches.profileId, profileId))
    .orderBy(desc(matches.overall), desc(matches.scoredAt));

  return rows.map((row) => ({ ...row.matches, job: row.jobs }));
}

/** Jobs with no match yet for this profile version — the scorer's work queue. */
export async function getUnscoredJobs(profileId: string, limit: number): Promise<Job[]> {
  return (
    db
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
              .where(and(eq(matches.jobId, jobs.id), eq(matches.profileId, profileId))),
          ),
        ),
      )
      // Freshest *role* first, not freshest fetch. `first_seen_at` is when we happened
      // to pull the posting, and ingest pulls in batches — 2,300 jobs share 83 distinct
      // values locally, and a first ingest gives every row the same instant. Sorting by
      // it therefore claimed "newest first" while actually returning an arbitrary slice,
      // which matters because scoring only reaches 50 a day: the order decides what you
      // ever see. `posted_at` is what the employer said, so it survives batching.
      //
      // Undated postings sort last rather than first: an unknown date is not evidence of
      // freshness, and letting nulls win would hand the queue to the boards that omit it.
      .orderBy(sql`${jobs.postedAt} desc nulls last`, desc(jobs.firstSeenAt))
      .limit(limit)
  );
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
  /**
   * An address found in the posting, if any — the signal that this role can be applied
   * to by email. Extracted at read time (never stored), so it always reflects the current
   * description. Most postings have none: they apply through the link, and the UI shows
   * "Apply" rather than offering a draft.
   */
  contactEmail: string | null;
  contactIsPersonal: boolean;
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
export async function listMatchRows(profileId: string, limit = 200): Promise<MatchRow[]> {
  const rows = await db
    .select()
    .from(matches)
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .where(eq(matches.profileId, profileId))
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
    const contact = extractContact(text);
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
      contactEmail: contact?.email ?? null,
      contactIsPersonal: contact?.personal ?? false,
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
export async function listDailyQueue(
  profileId: string,
  limit: number,
  maxPerCompany: number,
): Promise<MatchRow[]> {
  // Fetch a pool rather than exactly `limit`: the per-company cap can only choose from
  // what it is given, so asking for 20 and then capping would return fewer than 20
  // whenever one employer dominates the top. Bounded, so a pathological corpus
  // degrades to "fewer than asked for" rather than loading everything.
  const pool = Math.min(limit * maxPerCompany * 10, 600);

  const rows = await db
    .select({ matches, jobs })
    .from(matches)
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .leftJoin(outreach, eq(outreach.matchId, matches.id))
    .where(
      and(
        eq(matches.profileId, profileId),
        isNull(jobs.closedAt),
        or(isNull(outreach.id), eq(outreach.status, "drafted")),
      ),
    )
    .orderBy(desc(matches.overall), desc(matches.scoredAt))
    .limit(pool);

  const now = new Date();
  const candidates = rows.map(({ matches: m, jobs: j }) => toMatchRow(m, j, now));
  return capPerCompany(candidates, limit, maxPerCompany);
}

/** How many matches are waiting, so the queue can say what it is holding back. */
export async function countDailyQueue(profileId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(matches)
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .leftJoin(outreach, eq(outreach.matchId, matches.id))
    .where(
      and(
        eq(matches.profileId, profileId),
        isNull(jobs.closedAt),
        or(isNull(outreach.id), eq(outreach.status, "drafted")),
      ),
    );
  return row?.count ?? 0;
}

/** Counts for the Today strip, done in SQL rather than by loading every row. */
export async function getMatchCounts(profileId: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      strong: sql<number>`count(*) filter (where ${matches.tier} = 'strong')::int`,
      possible: sql<number>`count(*) filter (where ${matches.tier} = 'possible')::int`,
      scoredToday: sql<number>`count(*) filter (where ${matches.scoredAt} >= date_trunc('day', now()))::int`,
    })
    .from(matches)
    .where(eq(matches.profileId, profileId));

  return row ?? { total: 0, strong: 0, possible: 0, scoredToday: 0 };
}

/**
 * Re-tier every match for a profile by rank.
 *
 * One statement: a window function ranks the profile's matches by score, and each row
 * takes the tier its percentile earns. Doing it in SQL rather than in a loop matters —
 * a tier depends on the whole population, so reading rows and writing them back one at
 * a time would be both slow and wrong the moment two runs overlap.
 *
 * Skipped below `MIN_FOR_RANK`: with a handful of matches a percentile says nothing,
 * and the absolute thresholds `fitTier` already applied are the better answer.
 *
 * `is distinct from` so only rows that actually change are written — on a steady
 * corpus most runs move a handful, and an UPDATE touching every row would churn the
 * table for nothing.
 */
export async function recalibrateTiers(
  profileId: string,
): Promise<{ scored: number; changed: number; skipped?: string }> {
  const [count] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(matches)
    .where(eq(matches.profileId, profileId));

  const scored = count?.n ?? 0;
  if (scored < MIN_FOR_RANK) {
    return { scored, changed: 0, skipped: `only ${scored} matches — too few to rank` };
  }

  // Rank on the overall score, then on the five dimensions as a tie-break.
  //
  // The model emits a coarse scale — 293 matches across 48 distinct scores, with 26
  // tied at exactly 86, which is where the 15% line falls. Ties share a percentile,
  // so without a second key the whole cluster crosses together and "top 15%" becomes
  // 21%. The dimensions do vary inside a tied score (18 distinct sums among those 26),
  // so this separates them on evidence rather than on row order.
  const rank = sql`
    percent_rank() over (
      order by overall desc,
        (
          coalesce((dimensions->>'role_fit')::int, 0) +
          coalesce((dimensions->>'seniority_fit')::int, 0) +
          coalesce((dimensions->>'tech_fit')::int, 0) +
          coalesce((dimensions->>'location_fit')::int, 0) +
          coalesce((dimensions->>'company_fit')::int, 0)
        ) desc
    )`;

  const rows = await db.execute(sql`
    update ${matches} as m
    set tier = ranked.tier
    from (
      select
        id,
        (case
          when ${rank} < ${TIER_SHARES.strong} then 'strong'
          when ${rank} < ${TIER_SHARES.possible} then 'possible'
          else 'stretch'
        end)::match_tier as tier
      from ${matches}
      where profile_id = ${profileId}
    ) as ranked
    where m.id = ranked.id and m.tier is distinct from ranked.tier
  `);

  return { scored, changed: rows.count ?? 0 };
}

/** How many of these jobs are strong for this profile — read after re-ranking. */
export async function countStrongAmong(profileId: string, jobIds: string[]): Promise<number> {
  if (jobIds.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(matches)
    .where(
      and(
        eq(matches.profileId, profileId),
        eq(matches.tier, "strong"),
        inArray(matches.jobId, jobIds),
      ),
    );
  return row?.n ?? 0;
}
