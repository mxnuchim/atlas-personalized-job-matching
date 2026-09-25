import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm";

import { db } from "@/db";
import { drafts, evidence, jobs, matches, type Draft, type NewDraft } from "@/db/schema";
import { extractContact } from "@/lib/contact";
import { htmlToText } from "@/lib/html";
import type { FitTier } from "@/lib/scoring";

/** Matches that qualify for a draft but do not have one yet — the drafter's queue. */
export async function getUndraftedMatches(
  tiers: FitTier[],
  limit: number,
): Promise<{ matchId: string }[]> {
  if (tiers.length === 0) return [];

  return db
    .select({ matchId: matches.id })
    .from(matches)
    .where(
      and(
        inArray(matches.tier, tiers),
        notExists(
          db
            .select({ one: sql`1` })
            .from(drafts)
            .where(eq(drafts.matchId, matches.id)),
        ),
      ),
    )
    .orderBy(desc(matches.overall))
    .limit(limit);
}

/**
 * A draft with everything the review queue needs to judge it: the role it is for, and
 * the evidence it claims to cite — so "cites a real achievement" is visible rather
 * than asserted.
 */
export type DraftRow = {
  id: string;
  matchId: string;
  status: Draft["status"];
  subject: string;
  body: string;
  editedBody: string | null;
  recipient: string | null;
  strengthKeys: string[];
  createdAtLabel: string;
  /** Role context. */
  title: string;
  company: string;
  location: string | null;
  url: string;
  overall: number;
  tier: FitTier;
  whyYou: string;
  /** The cited evidence, resolved. Null when the model failed to cite anything real. */
  evidence: { claim: string; context: string | null; metric: string | null } | null;
  /**
   * An address found in the posting, if any. Extracted at read time rather than stored,
   * so it always reflects the current description and needs no re-ingest to improve.
   */
  contactEmail: string | null;
  contactIsPersonal: boolean;
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

/**
 * Postings arrive as HTML, so decode before looking for an address. Extracted at read
 * time rather than stored: it always reflects the current description, and improving
 * the matcher needs no re-ingest.
 */
function contactOf(description: string | null): { email: string | null; personal: boolean } {
  const found = extractContact(htmlToText(description ?? ""));
  return { email: found?.email ?? null, personal: found?.personal ?? false };
}

/**
 * `awaiting` is pending + approved: an approved draft has not gone anywhere yet, so it
 * belongs on the review screen until it is actually sent.
 */
export type DraftFilter = Draft["status"] | "all" | "awaiting";

function statusFilter(filter: DraftFilter) {
  if (filter === "all") return undefined;
  if (filter === "awaiting") return inArray(drafts.status, ["pending", "approved"]);
  return eq(drafts.status, filter);
}

export async function listDrafts(
  status: DraftFilter = "pending",
  limit = 200,
): Promise<DraftRow[]> {
  const rows = await db
    .select({ drafts, matches, jobs, evidence })
    .from(drafts)
    .innerJoin(matches, eq(drafts.matchId, matches.id))
    .innerJoin(jobs, eq(matches.jobId, jobs.id))
    .leftJoin(evidence, eq(drafts.evidenceId, evidence.id))
    .where(statusFilter(status))
    .orderBy(desc(matches.overall), desc(drafts.createdAt))
    .limit(limit);

  return rows.map(({ drafts: d, matches: m, jobs: j, evidence: e }) => {
    const contact = contactOf(j.description);
    return {
      id: d.id,
      matchId: d.matchId,
      status: d.status,
      subject: d.subject,
      body: d.body,
      editedBody: d.editedBody,
      recipient: d.recipient,
      strengthKeys: d.strengthKeys,
      createdAtLabel: DATE_FORMAT.format(d.createdAt),
      title: j.title,
      company: j.company,
      location: j.location,
      url: j.url,
      overall: m.overall,
      tier: m.tier as FitTier,
      whyYou: m.whyYou,
      evidence: e ? { claim: e.claim, context: e.context, metric: e.metric } : null,
      contactEmail: contact.email,
      contactIsPersonal: contact.personal,
    };
  });
}

export async function countDraftsByStatus(): Promise<Record<Draft["status"], number>> {
  const rows = await db
    .select({ status: drafts.status, count: sql<number>`count(*)::int` })
    .from(drafts)
    .groupBy(drafts.status);

  const counts = { pending: 0, approved: 0, skipped: 0, sent: 0, failed: 0 };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

/**
 * Only a pending draft can be decided or edited. Re-deciding a sent one would rewrite
 * history, and editing it would make the stored copy disagree with what actually went
 * out. Pulled out of the action so the rule is testable on its own.
 */
export function canDecide(status: Draft["status"]): boolean {
  return status === "pending";
}

export function canEdit(status: Draft["status"]): boolean {
  return status === "pending";
}

export async function insertDraft(row: NewDraft): Promise<void> {
  await db.insert(drafts).values(row);
}

/**
 * Record a decision. `decidedAt` is stamped here rather than by the caller so every
 * path through the review queue records it the same way.
 */
export async function decideDraft(
  id: string,
  status: Extract<Draft["status"], "approved" | "skipped">,
): Promise<Draft | null> {
  const [row] = await db
    .update(drafts)
    .set({ status, decidedAt: new Date() })
    .where(eq(drafts.id, id))
    .returning();
  return row ?? null;
}

/** Save an edit without deciding — the original `body` is never overwritten. */
export async function saveDraftEdit(id: string, editedBody: string): Promise<Draft | null> {
  const [row] = await db.update(drafts).set({ editedBody }).where(eq(drafts.id, id)).returning();
  return row ?? null;
}

/**
 * Set or clear the recipient. Manual entry for now — a posting never carries a human's
 * address, and guessing one costs deliverability (PRD §11).
 */
export async function setDraftRecipient(
  id: string,
  recipient: string | null,
): Promise<Draft | null> {
  const [row] = await db.update(drafts).set({ recipient }).where(eq(drafts.id, id)).returning();
  return row ?? null;
}

/** Mark a draft as delivered. Terminal — `canDecide`/`canEdit` refuse it afterwards. */
export async function markDraftSent(id: string): Promise<Draft | null> {
  const [row] = await db
    .update(drafts)
    .set({ status: "sent", decidedAt: new Date() })
    .where(eq(drafts.id, id))
    .returning();
  return row ?? null;
}

export async function markDraftFailed(id: string): Promise<void> {
  await db.update(drafts).set({ status: "failed" }).where(eq(drafts.id, id));
}

export async function getDraft(id: string): Promise<Draft | null> {
  const [row] = await db.select().from(drafts).where(eq(drafts.id, id)).limit(1);
  return row ?? null;
}
