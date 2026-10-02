import { LEXICON } from "./lexicon";
import type { MasterResume, RequirementKeyword, TailoredResume } from "./types";

/**
 * Deterministic keyword matching — no model calls. Client-safe.
 *
 * The lexicon is compiled once into two alternation regexes (case-insensitive aliases,
 * case-sensitive ambiguous words) so a text is scanned in a single pass rather than once
 * per term. Alternatives are ordered longest-first, so "React Native" wins over "React"
 * at the same position.
 */

/** Not preceded by a word character, "+" or "#" — so "C++" and "C#" don't match inside "C++x". */
const BEFORE = "(?<![A-Za-z0-9+#])";
const AFTER = "(?![A-Za-z0-9+#])";
/**
 * Very short ambiguous words also refuse a following hyphen, so "Go" doesn't match in
 * "Go-to-market". Longer terms keep normal boundaries so "React-powered" still counts.
 */
const AFTER_STRICT = "(?![A-Za-z0-9+#-])";

function normForm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formPattern(form: string, strict = false): string {
  return escapeRegex(form).replace(/\s+/g, "\\s+") + (strict ? AFTER_STRICT : AFTER);
}

const ciForms = new Map<string, string>();
const csForms = new Map<string, string>();
const impliesOf = new Map<string, string[]>();

for (const entry of LEXICON) {
  for (const alias of entry.aliases ?? []) ciForms.set(normForm(alias), entry.term);
  if (entry.exact) for (const form of entry.exact) csForms.set(form, entry.term);
  else ciForms.set(normForm(entry.term), entry.term);
  if (entry.implies) impliesOf.set(entry.term, entry.implies);
}

function alternation(forms: string[], strictShort: boolean): string {
  return [...forms]
    .sort((a, b) => b.length - a.length)
    .map((f) => formPattern(f, strictShort && f.length <= 2))
    .join("|");
}

const CI_REGEX = new RegExp(`${BEFORE}(?:${alternation([...ciForms.keys()], false)})`, "gi");
const CS_REGEX = new RegExp(`${BEFORE}(?:${alternation([...csForms.keys()], true)})`, "g");

/** Canonical lexicon terms literally present in `text`. */
export function findTerms(text: string): Set<string> {
  const found = new Set<string>();
  if (!text) return found;
  for (const m of text.matchAll(CI_REGEX)) {
    const canonical = ciForms.get(normForm(m[0]));
    if (canonical) found.add(canonical);
  }
  for (const m of text.matchAll(CS_REGEX)) {
    const canonical = csForms.get(m[0]);
    if (canonical) found.add(canonical);
  }
  return found;
}

/** The terms plus everything they imply, transitively (EKS → Kubernetes, AWS). */
export function withImplied(terms: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...terms];
  while (stack.length > 0) {
    const term = stack.pop()!;
    if (out.has(term)) continue;
    out.add(term);
    for (const implied of impliesOf.get(term) ?? []) stack.push(implied);
  }
  return out;
}

/** The lexicon term a phrase names ("k8s" → "Kubernetes"), or null if it isn't one. */
export function canonicalOf(phrase: string): string | null {
  const [first] = findTerms(phrase);
  return first ?? null;
}

/** Lowercased, punctuation-light form for comparing free-text skills that aren't in the lexicon. */
export function normalizePhrase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#./ ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const phraseCache = new Map<string, RegExp>();
function phraseRegex(phrase: string): RegExp {
  const key = normForm(phrase);
  let re = phraseCache.get(key);
  if (!re) {
    re = new RegExp(`${BEFORE}${formPattern(key)}`, "i");
    phraseCache.set(key, re);
  }
  return re;
}

/**
 * Does `text` mention this requirement? Lexicon terms match by canonical form (so "k8s"
 * satisfies "Kubernetes"); anything else falls back to a boundary-aware phrase match on
 * the term and its aliases.
 */
export function mentions(
  text: string,
  keyword: Pick<RequirementKeyword, "term" | "aliases">,
  terms: Set<string> = findTerms(text),
): boolean {
  const forms = [keyword.term, ...keyword.aliases];
  for (const form of forms) {
    const canonical = canonicalOf(form);
    if (canonical && terms.has(canonical)) return true;
  }
  return forms.some((form) => form.trim().length > 0 && phraseRegex(form).test(text));
}

/** Every word a reader (or a parser) would see in the master resume, as one string. */
export function masterText(master: MasterResume): string {
  return [
    master.headline,
    master.summary,
    ...master.roles.flatMap((r) => [r.title, r.company, ...r.bullets.map((b) => b.text)]),
    ...master.projects.flatMap((p) => [p.name, p.description, ...p.bullets.map((b) => b.text)]),
    ...master.skills,
    ...master.confirmedSkills,
    ...master.certifications.map((c) => c.name),
    ...master.education.map((e) => [e.degree, e.field].filter(Boolean).join(" ")),
  ]
    .filter(Boolean)
    .join("\n");
}

/** The same, for a tailored resume — what an ATS will actually index. */
export function tailoredText(resume: TailoredResume): string {
  return [
    resume.headline,
    resume.summary,
    ...resume.roles.flatMap((r) => [r.title, r.company, ...r.bullets.map((b) => b.text)]),
    ...resume.projects.flatMap((p) => [p.name, p.description, ...p.bullets.map((b) => b.text)]),
    ...resume.skills,
    ...resume.certifications.map((c) => c.name),
    ...resume.education.map((e) => [e.degree, e.field].filter(Boolean).join(" ")),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Canonical terms the resume can honestly claim: what it says, what that implies, what you confirmed. */
export function resumeTerms(master: MasterResume): Set<string> {
  const terms = withImplied(findTerms(masterText(master)));
  for (const skill of master.confirmedSkills) {
    const canonical = canonicalOf(skill);
    if (canonical) for (const t of withImplied([canonical])) terms.add(t);
  }
  return terms;
}

/**
 * The free coverage figure for the Matches table: of the technical keywords this posting
 * names, how many your resume can claim. Lexicon-only, so it costs nothing per row.
 */
export function lexiconCoverage(
  jdText: string,
  claimable: Set<string>,
): { matched: number; total: number; missing: string[] } {
  const jdTerms = [...findTerms(jdText)];
  const missing = jdTerms.filter((t) => !claimable.has(t));
  return { matched: jdTerms.length - missing.length, total: jdTerms.length, missing };
}

export type PreCoverage = "covered" | "implied" | "confirmed" | "missing";

export type CoverageContext = {
  /** The master as written in the file — confirmed skills excluded. */
  fileText: string;
  fileTerms: Set<string>;
  /** Everything claimable: file terms, their implications, confirmed skills. */
  claimable: Set<string>;
  confirmedSkills: string[];
};

export function coverageContext(master: MasterResume): CoverageContext {
  const fileText = masterText({ ...master, confirmedSkills: [] });
  return {
    fileText,
    fileTerms: findTerms(fileText),
    claimable: resumeTerms(master),
    confirmedSkills: master.confirmedSkills,
  };
}

/**
 * Before tailoring: where does each requirement stand against the master? Fed to the
 * model so it knows which terms it may surface — "implied" ones especially: the Terraform
 * you have that the posting calls "infrastructure as code".
 */
export function classifyRequirement(
  keyword: Pick<RequirementKeyword, "term" | "aliases">,
  ctx: CoverageContext,
): PreCoverage {
  if (mentions(ctx.fileText, keyword, ctx.fileTerms)) return "covered";
  if (ctx.confirmedSkills.some((s) => mentions(s, keyword))) return "confirmed";
  const viaLexicon = [keyword.term, ...keyword.aliases].some((form) => {
    const canonical = canonicalOf(form);
    return canonical !== null && ctx.claimable.has(canonical);
  });
  return viaLexicon ? "implied" : "missing";
}
