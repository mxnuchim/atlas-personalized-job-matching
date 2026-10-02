import "server-only";

import { getJob } from "@/db/queries/jobs";
import {
  getCachedRequirements,
  getCurrentMaster,
  getOwnedTailored,
  getTailoredForJob,
  insertMaster,
  insertTailored,
  recordResumeEvent,
  resumeUsageSince,
  saveCoverLetter,
  saveTailoredEdits,
  updateTailored,
  type ResumeEventKind,
} from "@/db/queries/resumes";
import type { MasterResumeRow, TailoredResumeRow } from "@/db/schema";
import { env } from "@/lib/env";
import { htmlToText } from "@/lib/html";
import { isLlmError, type TokenUsage } from "@/lib/llm";
import { log } from "@/lib/logger";
import { buildReport } from "@/lib/resume/report";
import { cleanLine } from "@/lib/resume/text";
import type { MasterResume, Requirements, TailoredResume } from "@/lib/resume/types";

import { getRequirements, masterHasSkill, parseResume, tailor, writeCoverLetter } from "./steps";

/**
 * The resume feature's entry points. Everything that spends money goes through here, so
 * the guarantees live in one place:
 *  - a per-user rolling 24h cap, checked *before* any model call;
 *  - every call written to the ledger, with its cost;
 *  - nothing regenerated that already exists — opening a resume you already tailored for
 *    a job costs nothing;
 *  - "I have this" is a free database write, then one tailoring call.
 */

const logger = log("resume");
const DAY_MS = 24 * 60 * 60 * 1000;
export const MIN_JD_CHARS = 200;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

const NO_MASTER = "Add your resume in Profile first — tailoring starts from it.";

async function capError(userId: string, calls: number): Promise<string | null> {
  const usage = await resumeUsageSince(userId, new Date(Date.now() - DAY_MS));
  if (usage.calls + calls <= env.RESUME_DAILY_LIMIT) return null;
  return `You've reached today's limit of ${env.RESUME_DAILY_LIMIT} resume generations. It frees up on a rolling 24 hours.`;
}

async function track(userId: string, kind: ResumeEventKind, usage: TokenUsage): Promise<number> {
  await recordResumeEvent({
    userId,
    kind,
    model: usage.model,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    costUsd: usage.costUsd,
  });
  return usage.costUsd ?? 0;
}

function failure(error: unknown, action: string): { ok: false; error: string } {
  const message = isLlmError(error)
    ? `${error.kind}: ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error);
  logger.error({ error: message }, `${action} failed`);
  return {
    ok: false,
    error: isLlmError(error) && error.kind === "rate_limit"
      ? "The model is busy right now. Try again in a minute."
      : `Couldn't ${action}. Try again in a moment.`,
  };
}

// --- Source resume -------------------------------------------------------------------

export async function importResume(
  userId: string,
  source: { text: string; fileName: string | null; mime: string | null },
): Promise<Result<MasterResumeRow>> {
  const cap = await capError(userId, 1);
  if (cap) return { ok: false, error: cap };

  try {
    const { master, warnings, usage } = await parseResume(source.text);
    await track(userId, "parse", usage);
    if (master.roles.length === 0 && master.projects.length === 0) {
      return {
        ok: false,
        error: "No work experience or projects could be read from that. Check it's your resume, or paste the text.",
      };
    }

    // A re-import carries over the skills you confirmed earlier — you said you have them.
    const previous = await getCurrentMaster(userId);
    const carried = (previous?.content.confirmedSkills ?? []).filter((s) => !masterHasSkill(master, s));

    const row = await insertMaster({
      userId,
      sourceText: source.text,
      sourceFileName: source.fileName,
      sourceMime: source.mime,
      content: { ...master, confirmedSkills: carried },
      warnings,
      model: usage.model,
    });
    logger.info({ version: row.version, roles: master.roles.length }, "resume imported");
    return { ok: true, value: row };
  } catch (error) {
    return failure(error, "read your resume");
  }
}

// --- Tailoring -----------------------------------------------------------------------

type JobSource = { kind: "job"; jobId: string } | { kind: "text"; jdText: string };

async function resolveJd(source: JobSource): Promise<
  Result<{ jdText: string; jobId: string | null; title: string | null; company: string | null }>
> {
  if (source.kind === "text") {
    const jdText = source.jdText.trim();
    if (jdText.length < MIN_JD_CHARS) {
      return { ok: false, error: "Paste the full job description — that's too short to tailor against." };
    }
    return { ok: true, value: { jdText, jobId: null, title: null, company: null } };
  }
  const job = await getJob(source.jobId);
  if (!job) return { ok: false, error: "That job no longer exists." };
  const jdText = htmlToText(job.description ?? "").trim();
  if (jdText.length < MIN_JD_CHARS) {
    return { ok: false, error: "This posting has too little description to tailor against. Open it and paste the full text instead." };
  }
  return { ok: true, value: { jdText, jobId: job.id, title: job.title, company: job.company } };
}

/**
 * Tailor a resume for a job (from Atlas) or a pasted description. For a job you've
 * already tailored for, returns that one — no model call, no cost.
 */
export async function generateResume(
  userId: string,
  source: JobSource,
): Promise<Result<{ id: string; created: boolean }>> {
  const master = await getCurrentMaster(userId);
  if (!master) return { ok: false, error: NO_MASTER };

  if (source.kind === "job") {
    const existing = await getTailoredForJob(userId, source.jobId);
    if (existing) return { ok: true, value: { id: existing.id, created: false } };
  }

  const jd = await resolveJd(source);
  if (!jd.ok) return jd;

  // Requirements may come from cache; budget for the worst case anyway.
  const cap = await capError(userId, 2);
  if (cap) return { ok: false, error: cap };

  try {
    let cost = 0;
    const { requirements, hash, usage: reqUsage } = await getRequirements(jd.value.jdText);
    if (reqUsage) cost += await track(userId, "requirements", reqUsage);

    const { resume, report, usage } = await tailor(master.content, requirements);
    cost += await track(userId, "tailor", usage);

    const row = await insertTailored(userId, jd.value.jobId, {
      jdHash: hash,
      jdText: jd.value.jdText,
      title: jd.value.title ?? requirements.title,
      company: jd.value.company ?? requirements.company,
      masterId: master.id,
      content: resume,
      report,
      model: usage.model,
      costDelta: cost,
    });
    logger.info({ id: row.id, coverage: report.coverage.mustHave, cost }, "resume tailored");
    return { ok: true, value: { id: row.id, created: true } };
  } catch (error) {
    // Two clicks on the same job can race; the unique index makes the second lose. Hand
    // back the winner rather than an error.
    if (source.kind === "job") {
      const winner = await getTailoredForJob(userId, source.jobId);
      if (winner) return { ok: true, value: { id: winner.id, created: false } };
    }
    return failure(error, "tailor your resume");
  }
}

async function requirementsFor(row: TailoredResumeRow): Promise<{ requirements: Requirements; usage: TokenUsage | null }> {
  const cached = await getCachedRequirements(row.jdHash);
  if (cached) return { requirements: cached, usage: null };
  const fresh = await getRequirements(row.jdText);
  return { requirements: fresh.requirements, usage: fresh.usage };
}

/** Re-tailor against your current master (e.g. after confirming skills). Keeps the letter and applied mark. */
export async function regenerateResume(userId: string, id: string): Promise<Result<TailoredResumeRow>> {
  const row = await getOwnedTailored(id, userId);
  if (!row) return { ok: false, error: "That resume no longer exists." };
  const master = await getCurrentMaster(userId);
  if (!master) return { ok: false, error: NO_MASTER };

  const cap = await capError(userId, 1);
  if (cap) return { ok: false, error: cap };

  try {
    let cost = 0;
    const { requirements, usage: reqUsage } = await requirementsFor(row);
    if (reqUsage) cost += await track(userId, "requirements", reqUsage);

    const { resume, report, usage } = await tailor(master.content, requirements);
    cost += await track(userId, "tailor", usage);

    const updated = await updateTailored(id, userId, {
      masterId: master.id,
      content: resume,
      report,
      model: usage.model,
      costDelta: cost,
    });
    if (!updated) return { ok: false, error: "That resume no longer exists." };
    return { ok: true, value: updated };
  } catch (error) {
    return failure(error, "regenerate your resume");
  }
}

/**
 * "I have this": add a missing keyword to your master as a confirmed skill (a free
 * write, as a new master version), then re-tailor once. Several confirmations can be
 * batched into one regeneration.
 */
export async function confirmSkills(
  userId: string,
  id: string,
  terms: string[],
): Promise<Result<TailoredResumeRow>> {
  const row = await getOwnedTailored(id, userId);
  if (!row) return { ok: false, error: "That resume no longer exists." };
  const current = await getCurrentMaster(userId);
  if (!current) return { ok: false, error: NO_MASTER };

  const additions = [...new Set(terms.map(cleanLine).filter(Boolean))]
    .filter((t) => t.length <= 60)
    .filter((t) => !masterHasSkill(current.content, t));
  if (additions.length === 0) return regenerateResume(userId, id);

  const content: MasterResume = {
    ...current.content,
    confirmedSkills: [...current.content.confirmedSkills, ...additions],
  };
  await insertMaster({
    userId,
    sourceText: current.sourceText,
    sourceFileName: current.sourceFileName,
    sourceMime: current.sourceMime,
    content,
    warnings: current.warnings,
    model: current.model,
  });
  return regenerateResume(userId, id);
}

export async function generateCoverLetter(userId: string, id: string): Promise<Result<TailoredResumeRow>> {
  const row = await getOwnedTailored(id, userId);
  if (!row) return { ok: false, error: "That resume no longer exists." };
  const master = await getCurrentMaster(userId);
  if (!master) return { ok: false, error: NO_MASTER };

  const cap = await capError(userId, 1);
  if (cap) return { ok: false, error: cap };

  try {
    let cost = 0;
    const { requirements, usage: reqUsage } = await requirementsFor(row);
    if (reqUsage) cost += await track(userId, "requirements", reqUsage);

    const { letter, warnings, usage } = await writeCoverLetter({
      master: master.content,
      requirements,
      jdText: row.jdText,
    });
    cost += await track(userId, "cover", usage);

    const updated = await saveCoverLetter(id, userId, letter, warnings, cost);
    if (!updated) return { ok: false, error: "That resume no longer exists." };
    return { ok: true, value: updated };
  } catch (error) {
    return failure(error, "write the cover letter");
  }
}

/** Your own edits to the letter. No model, no guards — you are the author. */
export async function saveCoverLetterEdit(userId: string, id: string, letter: string): Promise<Result<TailoredResumeRow>> {
  const text = letter.replace(/\r\n?/g, "\n").trim();
  if (!text) return { ok: false, error: "The letter can't be empty." };
  if (text.length > 6_000) return { ok: false, error: "That's far longer than a cover letter should be." };
  const updated = await saveCoverLetter(id, userId, text, [], 0);
  return updated ? { ok: true, value: updated } : { ok: false, error: "That resume no longer exists." };
}

export type ResumeEdits = {
  headline: string | null;
  summary: string | null;
  roles: { id: string; bullets: string[] }[];
  skills: string[];
};

/**
 * Save hand edits to the wording. Merged into the stored resume server-side so only
 * wording can change — companies, titles, dates and education stay exactly as stored,
 * whatever a request sends. The keyword report is recomputed against the new text.
 */
export async function saveResumeEdits(
  userId: string,
  id: string,
  edits: ResumeEdits,
): Promise<Result<TailoredResumeRow>> {
  const row = await getOwnedTailored(id, userId);
  if (!row) return { ok: false, error: "That resume no longer exists." };
  const master = await getCurrentMaster(userId);
  if (!master) return { ok: false, error: NO_MASTER };

  const byId = new Map(edits.roles.map((r) => [r.id, r.bullets]));
  const content: TailoredResume = {
    ...row.content,
    headline: edits.headline?.trim() || null,
    summary: edits.summary?.trim() || null,
    roles: row.content.roles.map((role) => {
      const next = byId.get(role.id);
      if (!next) return role;
      const texts = next.map(cleanLine).filter(Boolean).slice(0, 10);
      return {
        ...role,
        bullets: texts.map((text, i) => ({ sourceId: role.bullets[i]?.sourceId ?? `${role.id}-edit${i + 1}`, text })),
      };
    }),
    skills: [...new Set(edits.skills.map(cleanLine).filter(Boolean))].slice(0, 40),
  };

  const requirements = await getCachedRequirements(row.jdHash);
  const report = requirements
    ? buildReport(requirements, master.content, content, row.report.reverted)
    : row.report;
  const updated = await saveTailoredEdits(id, userId, content, report);
  return updated ? { ok: true, value: updated } : { ok: false, error: "That resume no longer exists." };
}
