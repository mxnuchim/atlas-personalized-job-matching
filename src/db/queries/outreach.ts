import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { drafts, jobs, matches, outreach, type Outreach } from "@/db/schema";
import type { FitTier } from "@/lib/scoring";

/** Everything the §11 guardrails need about sending history, in one round trip each. */
export type SendStats = {
  sentToday: number;
  totalSent: number;
  firstSentAt: Date | null;
  /**
   * Null until bounce detection lands. Deliberately *not* zero: an unmeasured rate is
   * a gap in observability, and rendering it as 0% would be a reassuring lie.
   */
  bounces: number | null;
  complaints: number | null;
};

export async function getSendStats(): Promise<SendStats> {
  const [row] = await db
    .select({
      totalSent: sql<number>`count(*) filter (where ${outreach.sentAt} is not null)::int`,
      sentToday: sql<number>`count(*) filter (where ${outreach.sentAt} >= date_trunc('day', now()))::int`,
      firstSentAt: sql<Date | null>`min(${outreach.sentAt})`,
    })
    .from(outreach);

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
  };

  const [row] = existing
    ? await db.update(outreach).set(values).where(eq(outreach.id, existing.id)).returning()
    : await db.insert(outreach).values(values).returning();

  return row ?? null;
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

export async function listPipeline(limit = 200): Promise<PipelineRow[]> {
  const rows = await db
    .select({ outreach, matches, jobs, recipient: drafts.recipient })
    .from(outreach)
    .innerJoin(matches, eq(outreach.matchId, matches.id))
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .leftJoin(drafts, eq(drafts.matchId, matches.id))
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

/** Funnel counts for the tracker header, in the order the funnel runs. */
export const FUNNEL_ORDER = [
  "drafted",
  "sent",
  "replied",
  "interview",
  "offer",
  "rejected",
  "closed",
] as const;

export async function getFunnelCounts(): Promise<Record<Outreach["status"], number>> {
  const rows = await db
    .select({ status: outreach.status, count: sql<number>`count(*)::int` })
    .from(outreach)
    .groupBy(outreach.status)
    .orderBy(asc(outreach.status));

  const counts = {
    drafted: 0,
    sent: 0,
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
