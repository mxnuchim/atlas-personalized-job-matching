import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { drafts, jobs, matches, outreach, type Outreach } from "@/db/schema";
import type { FitTier } from "@/lib/scoring";

// One definition of the funnel and its rules, shared with the client island.
export {
  allowedTransitions,
  canTransition,
  FUNNEL_ORDER,
  STAGE_LABEL,
  STAGE_TOKEN,
} from "@/lib/outreach";

/** Everything the §11 guardrails need about sending history, in one round trip each. */
export type SendStats = {
  sentToday: number;
  totalSent: number;
  firstSentAt: Date | null;
  /**
   * Null, and honestly so. Atlas has no access to the mailbox you send from, so it
   * cannot observe a bounce or a complaint. Rendering either as 0% would claim a
   * signal that does not exist.
   */
  bounces: number | null;
  complaints: number | null;
};

export async function getSendStats(profileId: string): Promise<SendStats> {
  const [row] = await db
    .select({
      totalSent: sql<number>`count(*) filter (where ${outreach.sentAt} is not null)::int`,
      sentToday: sql<number>`count(*) filter (where ${outreach.sentAt} >= date_trunc('day', now()))::int`,
      firstSentAt: sql<Date | null>`min(${outreach.sentAt})`,
    })
    .from(outreach)
    .innerJoin(matches, eq(outreach.matchId, matches.id))
    .where(eq(matches.profileId, profileId));

  return {
    sentToday: row?.sentToday ?? 0,
    totalSent: row?.totalSent ?? 0,
    firstSentAt: row?.firstSentAt ? new Date(row.firstSentAt) : null,
    bounces: null,
    complaints: null,
  };
}

/** §11: once someone replies, all further contact stops. */
export async function hasReplied(matchId: string): Promise<boolean> {
  const [row] = await db
    .select({ status: outreach.status })
    .from(outreach)
    .where(and(eq(outreach.matchId, matchId), eq(outreach.status, "replied")))
    .limit(1);
  return Boolean(row);
}

/** Matches whose thread already has a reply — batched, so a queue is one query. */
export async function repliedMatchIds(matchIds: string[]): Promise<Set<string>> {
  if (matchIds.length === 0) return new Set();
  const rows = await db
    .select({ matchId: outreach.matchId })
    .from(outreach)
    .where(and(inArray(outreach.matchId, matchIds), eq(outreach.status, "replied")));
  return new Set(rows.map((r) => r.matchId));
}

export async function getOutreachForMatch(matchId: string): Promise<Outreach | null> {
  const [row] = await db.select().from(outreach).where(eq(outreach.matchId, matchId)).limit(1);
  return row ?? null;
}

/**
 * Record a completed send. One row per match: a re-send updates in place rather than
 * accumulating rows, so the tracker shows a role's current state, not its history.
 */
export async function recordSend(params: {
  matchId: string;
  channel?: Outreach["channel"];
}): Promise<Outreach | null> {
  const existing = await getOutreachForMatch(params.matchId);
  const values = {
    matchId: params.matchId,
    channel: params.channel ?? ("email" as const),
    status: "sent" as const,
    sentAt: new Date(),
    // A re-send starts the follow-up clock over.
    repliedAt: null,
    bouncedAt: null,
  };

  const [row] = existing
    ? await db.update(outreach).set(values).where(eq(outreach.id, existing.id)).returning()
    : await db.insert(outreach).values(values).returning();

  return row ?? null;
}

export async function markReplied(id: string, repliedAt: Date): Promise<void> {
  await db.update(outreach).set({ status: "replied", repliedAt }).where(eq(outreach.id, id));
}

/**
 * Move a role to a new stage, stamping whichever timestamp the stage implies so no
 * caller has to remember. `repliedAt` is set once and never cleared by a later stage —
 * an interview does not un-happen the reply that produced it.
 */
export async function setOutreachStatus(
  id: string,
  status: Outreach["status"],
): Promise<Outreach | null> {
  const now = new Date();
  const stamps: Partial<Outreach> = { status };
  if (status === "replied") stamps.repliedAt = now;
  if (status === "bounced") stamps.bouncedAt = now;
  if (status === "sent") stamps.sentAt = now;

  const [row] = await db.update(outreach).set(stamps).where(eq(outreach.id, id)).returning();
  return row ?? null;
}

export async function getOutreach(id: string): Promise<Outreach | null> {
  const [row] = await db.select().from(outreach).where(eq(outreach.id, id)).limit(1);
  return row ?? null;
}

/** The outreach row, only if it belongs to this profile. See `getOwnedDraft`. */
export async function getOwnedOutreach(id: string, profileId: string): Promise<Outreach | null> {
  const [row] = await db
    .select({ outreach })
    .from(outreach)
    .innerJoin(matches, eq(outreach.matchId, matches.id))
    .where(and(eq(outreach.id, id), eq(matches.profileId, profileId)))
    .limit(1);
  return row?.outreach ?? null;
}

/**
 * Get or open the outreach row for a match you own, in one scoped operation.
 *
 * Replaces `ownsMatch` + `openOutreach` + `getOutreachForMatch` at the call sites that
 * used all three. Ownership was correct there only because the check happened to run
 * first; here it is the query, so call order cannot break it. Returns null when the
 * match is not yours, which reads the same as "no such match" — distinguishing them
 * would confirm someone else's row exists.
 */
export async function openOwnedOutreach(
  matchId: string,
  profileId: string,
): Promise<Outreach | null> {
  if (!(await ownsMatch(matchId, profileId))) return null;

  const existing = await getOutreachForMatch(matchId);
  if (existing) return existing;

  const [row] = await db.insert(outreach).values({ matchId, status: "drafted" }).returning();
  return row ?? null;
}

/** True when this match belongs to this profile — the guard for match-level actions. */
export async function ownsMatch(matchId: string, profileId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(matches)
    .where(and(eq(matches.id, matchId), eq(matches.profileId, profileId)))
    .limit(1);
  return Boolean(row);
}

/**
 * Open a row when a draft is written, so a role enters the funnel at `drafted` rather
 * than materialising at `sent`. Without this the tracker's first column is structurally
 * always zero, and the drawer has no row to act on until after you have already sent.
 */
export async function openOutreach(matchId: string): Promise<void> {
  const existing = await getOutreachForMatch(matchId);
  if (existing) return;
  await db.insert(outreach).values({ matchId, status: "drafted" });
}

/** The pipeline funnel (PRD §10.3 #5), newest movement first. */
export type PipelineRow = {
  id: string;
  matchId: string;
  status: Outreach["status"];
  channel: Outreach["channel"];
  sentAtLabel: string | null;
  repliedAtLabel: string | null;
  title: string;
  company: string;
  url: string;
  overall: number;
  tier: FitTier;
  recipient: string | null;
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export async function listPipeline(profileId: string, limit = 200): Promise<PipelineRow[]> {
  const rows = await db
    .select({ outreach, matches, jobs, recipient: drafts.recipient })
    .from(outreach)
    .innerJoin(matches, eq(outreach.matchId, matches.id))
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .leftJoin(drafts, eq(drafts.matchId, matches.id))
    .where(eq(matches.profileId, profileId))
    .orderBy(desc(outreach.updatedAt))
    .limit(limit);

  return rows.map(({ outreach: o, matches: m, jobs: j, recipient }) => ({
    id: o.id,
    matchId: o.matchId,
    status: o.status,
    channel: o.channel,
    sentAtLabel: o.sentAt ? DATE_FORMAT.format(o.sentAt) : null,
    repliedAtLabel: o.repliedAt ? DATE_FORMAT.format(o.repliedAt) : null,
    title: j.title,
    company: j.company,
    url: j.url,
    overall: m.overall,
    tier: m.tier as FitTier,
    recipient,
  }));
}

export async function getFunnelCounts(
  profileId: string,
): Promise<Record<Outreach["status"], number>> {
  const rows = await db
    .select({ status: outreach.status, count: sql<number>`count(*)::int` })
    .from(outreach)
    .innerJoin(matches, eq(outreach.matchId, matches.id))
    .where(eq(matches.profileId, profileId))
    .groupBy(outreach.status)
    .orderBy(asc(outreach.status));

  const counts = {
    drafted: 0,
    sent: 0,
    bounced: 0,
    replied: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    closed: 0,
  };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

/** Sends in the last 24h — used by the Today strip and for a quick throttle read. */
export async function countRecentSends(hours = 24): Promise<number> {
  const since = new Date(Date.now() - hours * 3_600_000);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(outreach)
    .where(gte(outreach.sentAt, since));
  return row?.count ?? 0;
}
