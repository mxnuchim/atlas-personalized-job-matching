"use server";

import { revalidatePath } from "next/cache";

import { saveProfileDocument } from "@/db/queries/profile";
import { log } from "@/lib/logger";
import { parseProfileDocument, type ProfileDocument } from "@/lib/profile-document";
import { requireSession } from "@/lib/session";

/**
 * Building a profile by pasting one in.
 *
 * Two steps on purpose. Checking is free and saving is not: a save replaces every
 * strength and every piece of evidence, and bumping the version re-scores the whole
 * corpus. Showing what will happen before it happens is worth the extra click.
 */

const logger = log("profile");

export type PreviewResult =
  | { ok: true; document: ProfileDocument; warnings: string[]; summary: string }
  | { ok: false; errors: string[] };

export async function previewProfileAction(raw: string): Promise<PreviewResult> {
  await requireSession();

  const parsed = parseProfileDocument(raw);
  if (!parsed.ok) return parsed;

  const { document, warnings } = parsed;
  const summary =
    `${document.strengths.length} strength${document.strengths.length === 1 ? "" : "s"}, ` +
    `${document.evidence.length} piece${document.evidence.length === 1 ? "" : "s"} of evidence, ` +
    `${document.profile.target_roles.length} target role${document.profile.target_roles.length === 1 ? "" : "s"}`;

  return { ok: true, document, warnings, summary };
}

export type SaveResult =
  { ok: true; version: number; rescored: boolean } | { ok: false; error: string };

export async function saveProfileAction(raw: string, newVersion: boolean): Promise<SaveResult> {
  const session = await requireSession();

  const parsed = parseProfileDocument(raw);
  // Re-parsed here rather than trusting what preview returned: the client could send
  // anything, and the only text worth saving is text that passes the same gate twice.
  if (!parsed.ok) return { ok: false, error: parsed.errors[0] ?? "That profile is not valid." };

  const result = await saveProfileDocument(session.user.id, parsed.document, { newVersion });
  logger.info(
    { userId: session.user.id, version: result.version, rescored: result.rescored },
    "profile saved",
  );

  revalidatePath("/profile");
  revalidatePath("/today");
  revalidatePath("/matches");
  return { ok: true, version: result.version, rescored: result.rescored };
}
