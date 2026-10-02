import "server-only";

/**
 * Turn an uploaded resume into plain text. Only the text is kept — the file itself is
 * never stored, so there is no blob storage to run, secure or pay for.
 *
 * PDFs go through unpdf (pdf.js built for serverless); DOCX through mammoth. A scanned
 * PDF has no text layer, and that is caught by the length check rather than passed on to
 * a model that would then "parse" an empty page.
 */

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MIN_RESUME_CHARS = 300;
export const MAX_RESUME_CHARS = 60_000;

const PDF = "application/pdf";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type ExtractResult =
  | { ok: true; text: string; fileName: string | null; mime: string }
  | { ok: false; error: string };

function kindOf(file: File): "pdf" | "docx" | null {
  const name = file.name.toLowerCase();
  if (file.type === PDF || name.endsWith(".pdf")) return "pdf";
  if (file.type === DOCX || name.endsWith(".docx")) return "docx";
  return null;
}

/** Collapse extraction noise: PDF line-wrap hyphenation, runs of blank lines, stray spaces. */
export function tidyExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validateResumeText(text: string): string | null {
  if (text.length < MIN_RESUME_CHARS) {
    return "That's too short to be a resume. If it's a scanned PDF, it has no readable text — paste the text instead.";
  }
  if (text.length > MAX_RESUME_CHARS) {
    return "That's longer than any resume should be. Paste just the resume itself.";
  }
  return null;
}

export async function extractResumeText(file: File): Promise<ExtractResult> {
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Files must be 4 MB or smaller." };

  const kind = kindOf(file);
  if (!kind) return { ok: false, error: "Upload a PDF or a Word (.docx) file." };

  let raw: string;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (kind === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(bytes);
      raw = (await extractText(pdf, { mergePages: true })).text;
    } else {
      const mammoth = await import("mammoth");
      raw = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) })).value;
    }
  } catch {
    return { ok: false, error: "That file couldn't be read. Try saving it again, or paste the text instead." };
  }

  const text = tidyExtractedText(raw);
  const invalid = validateResumeText(text);
  if (invalid) return { ok: false, error: invalid };

  return { ok: true, text, fileName: file.name, mime: kind === "pdf" ? PDF : DOCX };
}
