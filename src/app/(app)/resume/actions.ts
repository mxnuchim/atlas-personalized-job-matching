"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { deleteTailored } from "@/db/queries/resumes";
import { actingUserId } from "@/lib/session";
import { extractResumeText, tidyExtractedText, validateResumeText } from "@/pipeline/resume/extract";
import {
  confirmSkills,
  generateCoverLetter,
  generateResume,
  importResume,
  regenerateResume,
  saveCoverLetterEdit,
  saveResumeEdits,
} from "@/pipeline/resume/service";

/**
 * Resume Server Actions. Thin on purpose: authenticate, validate, delegate to the
 * service (which owns the gate, the daily cap and the cost ledger), revalidate.
 *
 * The "no resume, no tailoring" rule is enforced in the service, not only by disabled
 * buttons — a request that skips the UI gets the same refusal.
 */

export type ActionResult<T = null> = { ok: true; value: T } | { ok: false; error: string };

const INVALID = { ok: false as const, error: "That request wasn't valid." };

/** Pages that show resume state (the gate, the per-row buttons, the coverage column). */
function revalidateResumeViews(id?: string) {
  for (const path of ["/resume", "/profile", "/matches", "/today", "/jobs"]) revalidatePath(path);
  if (id) revalidatePath(`/resume/${id}`);
}

export async function importResumeAction(
  formData: FormData,
): Promise<ActionResult<{ version: number; warnings: string[] }>> {
  const userId = await actingUserId();
  const file = formData.get("file");
  const pasted = formData.get("text");

  let source: { text: string; fileName: string | null; mime: string | null };
  if (file instanceof File && file.size > 0) {
    const extracted = await extractResumeText(file);
    if (!extracted.ok) return extracted;
    source = { text: extracted.text, fileName: extracted.fileName, mime: extracted.mime };
  } else if (typeof pasted === "string" && pasted.trim()) {
    const text = tidyExtractedText(pasted);
    const invalid = validateResumeText(text);
    if (invalid) return { ok: false, error: invalid };
    source = { text, fileName: null, mime: "text/plain" };
  } else {
    return { ok: false, error: "Upload a PDF or Word file, or paste your resume." };
  }

  const result = await importResume(userId, source);
  if (!result.ok) return result;
  revalidateResumeViews();
  return { ok: true, value: { version: result.value.version, warnings: result.value.warnings } };
}

export async function generateFromTextAction(input: unknown): Promise<ActionResult<{ id: string }>> {
  const userId = await actingUserId();
  const parsed = z.object({ jdText: z.string().max(40_000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Paste a job description under 40,000 characters." };

  const result = await generateResume(userId, { kind: "text", jdText: parsed.data.jdText });
  if (!result.ok) return result;
  revalidateResumeViews(result.value.id);
  return { ok: true, value: { id: result.value.id } };
}

export async function generateForJobAction(input: unknown): Promise<ActionResult<{ id: string; created: boolean }>> {
  const userId = await actingUserId();
  const parsed = z.object({ jobId: z.uuid() }).safeParse(input);
  if (!parsed.success) return INVALID;

  const result = await generateResume(userId, { kind: "job", jobId: parsed.data.jobId });
  if (!result.ok) return result;
  revalidateResumeViews(result.value.id);
  return result;
}

const idInput = z.object({ id: z.uuid() });

export async function regenerateAction(input: unknown): Promise<ActionResult> {
  const userId = await actingUserId();
  const parsed = idInput.safeParse(input);
  if (!parsed.success) return INVALID;

  const result = await regenerateResume(userId, parsed.data.id);
  if (!result.ok) return result;
  revalidateResumeViews(parsed.data.id);
  return { ok: true, value: null };
}

export async function confirmSkillsAction(input: unknown): Promise<ActionResult> {
  const userId = await actingUserId();
  const parsed = idInput
    .extend({ terms: z.array(z.string().min(1).max(60)).min(1).max(25) })
    .safeParse(input);
  if (!parsed.success) return INVALID;

  const result = await confirmSkills(userId, parsed.data.id, parsed.data.terms);
  if (!result.ok) return result;
  revalidateResumeViews(parsed.data.id);
  return { ok: true, value: null };
}

export async function coverLetterAction(input: unknown): Promise<ActionResult> {
  const userId = await actingUserId();
  const parsed = idInput.safeParse(input);
  if (!parsed.success) return INVALID;

  const result = await generateCoverLetter(userId, parsed.data.id);
  if (!result.ok) return result;
  revalidateResumeViews(parsed.data.id);
  return { ok: true, value: null };
}

export async function saveCoverLetterAction(input: unknown): Promise<ActionResult> {
  const userId = await actingUserId();
  const parsed = idInput.extend({ letter: z.string().max(10_000) }).safeParse(input);
  if (!parsed.success) return INVALID;

  const result = await saveCoverLetterEdit(userId, parsed.data.id, parsed.data.letter);
  if (!result.ok) return result;
  revalidateResumeViews(parsed.data.id);
  return { ok: true, value: null };
}

const editsSchema = z.object({
  headline: z.string().max(200).nullable(),
  summary: z.string().max(2_000).nullable(),
  roles: z.array(z.object({ id: z.string().max(40), bullets: z.array(z.string().max(600)).max(12) })).max(30),
  skills: z.array(z.string().max(80)).max(60),
});

export async function saveResumeEditsAction(input: unknown): Promise<ActionResult> {
  const userId = await actingUserId();
  const parsed = idInput.extend({ edits: editsSchema }).safeParse(input);
  if (!parsed.success) return INVALID;

  const result = await saveResumeEdits(userId, parsed.data.id, parsed.data.edits);
  if (!result.ok) return result;
  revalidateResumeViews(parsed.data.id);
  return { ok: true, value: null };
}

export async function deleteResumeAction(input: unknown): Promise<ActionResult> {
  const userId = await actingUserId();
  const parsed = idInput.safeParse(input);
  if (!parsed.success) return INVALID;

  const deleted = await deleteTailored(parsed.data.id, userId);
  if (!deleted) return { ok: false, error: "That resume no longer exists." };
  revalidateResumeViews();
  return { ok: true, value: null };
}
