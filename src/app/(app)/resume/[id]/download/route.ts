import type { NextRequest } from "next/server";
import { z } from "zod";

import { getOwnedTailored } from "@/db/queries/resumes";
import { renderCoverLetterDocx, renderResumeDocx } from "@/lib/resume/render-docx";
import { renderCoverLetterPdf, renderResumePdf } from "@/lib/resume/render-pdf";
import { documentFileName } from "@/lib/resume/text";
import { getSession } from "@/lib/session";

/**
 * Download a tailored resume or its cover letter as PDF or DOCX.
 *
 *   GET /resume/:id/download?doc=resume|cover&format=pdf|docx
 *
 * Route handlers don't inherit the (app) layout's sign-in gate, so this checks the
 * session itself, and fetches the row scoped to the user — someone else's id is a 404,
 * indistinguishable from one that doesn't exist.
 */

const MIME = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const userId = session?.user?.id;
  if (!userId) return new Response("Sign in to download.", { status: 401 });

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response("Not found.", { status: 404 });

  const search = request.nextUrl.searchParams;
  const doc = search.get("doc") === "cover" ? "cover" : "resume";
  const format = search.get("format") === "docx" ? "docx" : "pdf";

  const row = await getOwnedTailored(id, userId);
  if (!row) return new Response("Not found.", { status: 404 });
  if (doc === "cover" && !row.coverLetter) return new Response("No cover letter yet.", { status: 404 });

  const fileName = documentFileName({
    name: row.content.contact.name,
    kind: doc === "cover" ? "Cover-Letter" : "Resume",
    company: row.company,
    title: row.title,
    ext: format,
  });
  const title = `${row.content.contact.name} — ${doc === "cover" ? "Cover letter" : "Resume"} — ${row.title}`;

  const buffer =
    doc === "cover"
      ? format === "pdf"
        ? await renderCoverLetterPdf(row.content, row.coverLetter!, title)
        : await renderCoverLetterDocx(row.content, row.coverLetter!, title)
      : format === "pdf"
        ? await renderResumePdf(row.content, title)
        : await renderResumeDocx(row.content, title);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": MIME[format],
      "Content-Disposition": `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
