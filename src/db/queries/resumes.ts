import { and, count, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  jdRequirements,
  matches,
  masterResumes,
  resumeEvents,
  tailoredResumes,
  type MasterResumeRow,
  type TailoredResumeRow,
} from "@/db/schema";
import { clampPage, offsetOf, paginated, type PageParams, type Paginated } from "@/lib/pagination";
import { lexiconCoverage, resumeTerms } from "@/lib/resume/keywords";
import type { KeywordReport, MasterResume, Requirements, TailoredResume } from "@/lib/resume/types";

/**
 * Resume persistence. Every read is scoped to the user in the query itself — an action
 * that cannot fetch someone else's row cannot act on it (same rule as `getOwnedDraft`).
 */

// --- Master resume -------------------------------------------------------------------

/** The current master: the highest version for this user, or null if none uploaded. */
export async function getCurrentMaster(userId: string): Promise<MasterResumeRow | null> {
  const [row] = await db
    .select()
    .from(masterResumes)
    .where(eq(masterResumes.userId, userId))
    .orderBy(desc(masterResumes.version))
    .limit(1);
  return row ?? null;
}

/** The gate for the whole feature — cheap enough to call on every page that shows a button. */
export async function hasMasterResume(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql`1` })
    .from(masterResumes)
    .where(eq(masterResumes.userId, userId))
    .limit(1);
  return Boolean(row);
}

export async function insertMaster(params: {
  userId: string;
  sourceText: string;
  sourceFileName: string | null;
  sourceMime: string | null;
  content: MasterResume;
  warnings: string[];
  model: string;
}): Promise<MasterResumeRow> {
  const [latest] = await db
    .select({ version: masterResumes.version })
    .from(masterResumes)
    .where(eq(masterResumes.userId, params.userId))
    .orderBy(desc(masterResumes.version))
    .limit(1);

  const [row] = await db
    .insert(masterResumes)
    .values({ ...params, version: (latest?.version ?? 0) + 1 })
    .returning();
  if (!row) throw new Error("Failed to save the resume");
  return row;
}

// --- Requirements cache --------------------------------------------------------------

export async function getCachedRequirements(hash: string): Promise<Requirements | null> {
  const [row] = await db
    .select({ requirements: jdRequirements.requirements })
    .from(jdRequirements)
    .where(eq(jdRequirements.hash, hash))
    .limit(1);
  return row?.requirements ?? null;
}

export async function cacheRequirements(hash: string, requirements: Requirements, model: string) {
  await db.insert(jdRequirements).values({ hash, requirements, model }).onConflictDoNothing();
}

// --- Usage ledger --------------------------------------------------------------------

export type ResumeEventKind = "parse" | "requirements" | "tailor" | "cover";

export async function recordResumeEvent(params: {
  userId: string;
  kind: ResumeEventKind;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number | null;
}): Promise<void> {
  await db.insert(resumeEvents).values({
    ...params,
    costUsd: params.costUsd === null ? null : params.costUsd.toFixed(6),
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The rolling 24 hours the daily cap counts — the window the Resume page reports. */
export function resumeUsageLastDay(userId: string): Promise<{ calls: number; costUsd: number }> {
  return resumeUsageSince(userId, new Date(Date.now() - DAY_MS));
}

/** Calls and dollars in the rolling window — what the cap counts and the page displays. */
export async function resumeUsageSince(
  userId: string,
  since: Date,
): Promise<{ calls: number; costUsd: number }> {
  const [row] = await db
    .select({
      calls: count(),
      costUsd: sql<string>`coalesce(sum(${resumeEvents.costUsd}), 0)`,
    })
    .from(resumeEvents)
    .where(and(eq(resumeEvents.userId, userId), gte(resumeEvents.createdAt, since)));
  return { calls: row?.calls ?? 0, costUsd: Number(row?.costUsd ?? 0) };
}

// --- Tailored resumes ----------------------------------------------------------------

export async function getOwnedTailored(id: string, userId: string): Promise<TailoredResumeRow | null> {
  const [row] = await db
    .select()
    .from(tailoredResumes)
    .where(and(eq(tailoredResumes.id, id), eq(tailoredResumes.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function getTailoredForJob(userId: string, jobId: string): Promise<TailoredResumeRow | null> {
  const [row] = await db
    .select()
    .from(tailoredResumes)
    .where(and(eq(tailoredResumes.userId, userId), eq(tailoredResumes.jobId, jobId)))
    .limit(1);
  return row ?? null;
}

export type TailoredWrite = {
  jdHash: string;
  jdText: string;
  title: string;
  company: string | null;
  masterId: string;
  content: TailoredResume;
  report: KeywordReport;
  model: string;
  /** Added to the running total, not set. */
  costDelta: number;
};

export async function insertTailored(
  userId: string,
  jobId: string | null,
  write: TailoredWrite,
): Promise<TailoredResumeRow> {
  const { costDelta, ...values } = write;
  const [row] = await db
    .insert(tailoredResumes)
    .values({ ...values, userId, jobId, costUsd: costDelta.toFixed(6) })
    .returning();
  if (!row) throw new Error("Failed to save the tailored resume");
  return row;
}

/** Overwrite a tailored resume with a regeneration, keeping its id, letter and applied mark. */
export async function updateTailored(
  id: string,
  userId: string,
  write: Omit<TailoredWrite, "jdHash" | "jdText" | "title" | "company">,
): Promise<TailoredResumeRow | null> {
  const { costDelta, ...values } = write;
  const [row] = await db
    .update(tailoredResumes)
    .set({ ...values, costUsd: sql`${tailoredResumes.costUsd} + ${costDelta.toFixed(6)}` })
    .where(and(eq(tailoredResumes.id, id), eq(tailoredResumes.userId, userId)))
    .returning();
  return row ?? null;
}

/** Save hand edits. No cost, no model — the report is recomputed by the caller. */
export async function saveTailoredEdits(
  id: string,
  userId: string,
  content: TailoredResume,
  report: KeywordReport,
): Promise<TailoredResumeRow | null> {
  const [row] = await db
    .update(tailoredResumes)
    .set({ content, report })
    .where(and(eq(tailoredResumes.id, id), eq(tailoredResumes.userId, userId)))
    .returning();
  return row ?? null;
}

export async function saveCoverLetter(
  id: string,
  userId: string,
  letter: string,
  warnings: string[],
  costDelta: number,
): Promise<TailoredResumeRow | null> {
  const [row] = await db
    .update(tailoredResumes)
    .set({
      coverLetter: letter,
      coverLetterWarnings: warnings,
      costUsd: sql`${tailoredResumes.costUsd} + ${costDelta.toFixed(6)}`,
    })
    .where(and(eq(tailoredResumes.id, id), eq(tailoredResumes.userId, userId)))
    .returning();
  return row ?? null;
}

export async function deleteTailored(id: string, userId: string): Promise<boolean> {
  const rows = await db
    .delete(tailoredResumes)
    .where(and(eq(tailoredResumes.id, id), eq(tailoredResumes.userId, userId)))
    .returning({ id: tailoredResumes.id });
  return rows.length > 0;
}

/**
 * Stamp the tailored resume for this match as the one you sent. Called when you mark a
 * role applied, so the Resume page can say which version went out.
 */
export async function markResumeUsedForMatch(matchId: string, userId: string): Promise<void> {
  const [match] = await db
    .select({ jobId: matches.jobId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!match) return;
  await db
    .update(tailoredResumes)
    .set({ usedAt: new Date() })
    .where(and(eq(tailoredResumes.userId, userId), eq(tailoredResumes.jobId, match.jobId)));
}

/**
 * Attach resume state to the rows on screen: which have a tailored resume, and how the
 * posting's technical keywords line up with yours. Two small queries for the page —
 * the keyword figure itself is the lexicon, with no model call, so it's free per row.
 */
export async function attachResumeInfo<T extends { jobId: string; description: string }>(
  rows: T[],
  userId: string,
): Promise<{
  ready: boolean;
  rows: (T & { resumeId: string | null; keywords: { matched: number; total: number; missing: string[] } | null })[];
}> {
  const [master, ids] = await Promise.all([
    getCurrentMaster(userId),
    tailoredIdsForJobs(userId, rows.map((r) => r.jobId)),
  ]);
  const claimable = master ? resumeTerms(master.content) : null;
  return {
    ready: master !== null,
    rows: rows.map((r) => ({
      ...r,
      resumeId: ids.get(r.jobId) ?? null,
      keywords: claimable ? lexiconCoverage(r.description, claimable) : null,
    })),
  };
}

/** jobId → tailored resume id, for the handful of rows on screen. */
export async function tailoredIdsForJobs(userId: string, jobIds: string[]): Promise<Map<string, string>> {
  if (jobIds.length === 0) return new Map();
  const rows = await db
    .select({ id: tailoredResumes.id, jobId: tailoredResumes.jobId })
    .from(tailoredResumes)
    .where(and(eq(tailoredResumes.userId, userId), inArray(tailoredResumes.jobId, jobIds)));
  return new Map(rows.filter((r) => r.jobId).map((r) => [r.jobId!, r.id]));
}

export type TailoredListRow = {
  id: string;
  jobId: string | null;
  title: string;
  company: string | null;
  coverage: KeywordReport["coverage"];
  hasCoverLetter: boolean;
  usedAt: Date | null;
  updatedAt: Date;
};

export async function listTailored(
  userId: string,
  { page, pageSize }: PageParams,
): Promise<Paginated<TailoredListRow>> {
  const where = eq(tailoredResumes.userId, userId);
  const [counted] = await db.select({ n: count() }).from(tailoredResumes).where(where);
  const total = counted?.n ?? 0;
  const safePage = clampPage(page, total, pageSize);

  const rows = await db
    .select({
      id: tailoredResumes.id,
      jobId: tailoredResumes.jobId,
      title: tailoredResumes.title,
      company: tailoredResumes.company,
      report: tailoredResumes.report,
      coverLetter: tailoredResumes.coverLetter,
      usedAt: tailoredResumes.usedAt,
      updatedAt: tailoredResumes.updatedAt,
    })
    .from(tailoredResumes)
    .where(where)
    .orderBy(desc(tailoredResumes.updatedAt))
    .limit(pageSize)
    .offset(offsetOf(safePage, pageSize));

  return paginated(
    rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      title: r.title,
      company: r.company,
      coverage: r.report.coverage,
      hasCoverLetter: Boolean(r.coverLetter),
      usedAt: r.usedAt,
      updatedAt: r.updatedAt,
    })),
    total,
    safePage,
    pageSize,
  );
}
