import type { MasterResume } from "./types";

/**
 * Small, pure text helpers for the resume feature. Client-safe.
 */

const NUMBER = /\d+(?:[.,]\d+)*/g;

/**
 * Every number in a text, normalised ("1,200" → "1200", "99.9" stays). The anti-fabrication
 * guard compares these sets: a rewritten line may not contain a number its source did not.
 * Deliberately literal — "10k" vs "10,000" counts as different, so the guard reverts to
 * your original wording rather than trusting the model's arithmetic.
 */
export function numbersIn(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[0];
    // A comma followed by exactly three digits is a thousands separator; otherwise a decimal.
    const normalised = /^\d{1,3}(,\d{3})+$/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", ".");
    out.add(normalised);
  }
  return out;
}

/** Numbers in `text` that aren't in `allowed` — empty when the line invents nothing. */
export function unsupportedNumbers(text: string, allowed: Set<string>): string[] {
  return [...numbersIn(text)].filter((n) => !allowed.has(n));
}

/** Years since the earliest role start the master records, or null if none is dated. */
export function yearsOfExperience(master: MasterResume, now: Date = new Date()): number | null {
  const years = master.roles
    .map((r) => r.start?.match(/\b(19|20)\d{2}\b/)?.[0])
    .filter((y): y is string => Boolean(y))
    .map(Number);
  if (years.length === 0) return null;
  return Math.max(0, now.getUTCFullYear() - Math.min(...years));
}

/**
 * "JORDAN RIVERA" → "Jordan Rivera". Resume headers are often set in capitals, which reads
 * as shouting once it's a signature or a filename. Only all-caps names are touched, so a
 * deliberately cased "McKenzie" or "van der Berg" is left alone.
 */
export function tidyName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!/\p{L}/u.test(trimmed) || trimmed !== trimmed.toUpperCase()) return trimmed;
  return trimmed
    .toLowerCase()
    .replace(/(^|[\s\-'’])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Split prose into sentences, keeping the terminator. Good enough for a resume summary. */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?]+(?:[.!?]+|$)/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

/** Strip list glyphs a model sometimes prefixes ("• ", "- ", "* "). */
export function cleanLine(text: string): string {
  return text.replace(/^\s*(?:[•\-*–—]\s+)/u, "").replace(/\s+/g, " ").trim();
}

/**
 * Windows-1252 — what the PDF's standard Helvetica can encode. Anything outside it is
 * mapped, transliterated or dropped, because an unencodable glyph doesn't fail loudly: it
 * silently becomes a wrong character ("0→production" rendered as "0’production" in our
 * own round-trip test), and that wrong character is what an ATS indexes.
 */
const CP1252_EXTRAS = new Set(
  "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".split(""),
);

function encodable(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (
    ch === "\n" ||
    ch === "\t" ||
    (code >= 0x20 && code <= 0x7e) ||
    (code >= 0xa0 && code <= 0xff) ||
    CP1252_EXTRAS.has(ch)
  );
}

const SYMBOL_MAP: Record<string, string> = {
  "→": "->",
  "⟶": "->",
  "⇒": "=>",
  "←": "<-",
  "↔": "<->",
  "↑": "up ",
  "↓": "down ",
  "≥": ">=",
  "≤": "<=",
  "≈": "~",
  "≠": "!=",
  "✓": "",
  "✔": "",
  "✗": "",
  "★": "*",
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "−": "-",
  "′": "'",
  "″": '"',
  " ": " ",
  " ": " ",
  " ": " ",
  "​": "",
};

/** Make text safe for the PDF's standard font without losing meaning. */
export function pdfSafe(text: string): string {
  let out = "";
  for (const ch of text) {
    if (encodable(ch)) {
      out += ch;
      continue;
    }
    if (ch in SYMBOL_MAP) {
      out += SYMBOL_MAP[ch];
      continue;
    }
    // Ọ → O, ş → s: decompose and drop the combining marks.
    const base = ch.normalize("NFKD").replace(/\p{M}/gu, "");
    out += [...base].every(encodable) ? base : "";
  }
  return out.replace(/ {2,}/g, " ");
}

function slug(part: string, max = 40): string {
  return part
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "");
}

/** `Manuchim-Oliver-Resume-Cohere-Senior-Platform-Engineer.pdf` — what a recruiter sees in their downloads. */
export function documentFileName(params: {
  name: string;
  kind: "Resume" | "Cover-Letter";
  company: string | null;
  title: string | null;
  ext: "pdf" | "docx";
}): string {
  const parts = [slug(params.name) || "Resume", params.kind];
  if (params.company) parts.push(slug(params.company));
  if (params.title) parts.push(slug(params.title));
  return `${parts.filter(Boolean).join("-")}.${params.ext}`;
}
