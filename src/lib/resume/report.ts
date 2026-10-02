import {
  canonicalOf,
  classifyRequirement,
  coverageContext,
  findTerms,
  mentions,
  normalizePhrase,
  tailoredText,
} from "./keywords";
import type {
  KeywordReport,
  KeywordResult,
  MasterResume,
  RequirementKeyword,
  Requirements,
  TailoredResume,
} from "./types";

/** One entry per real requirement — models list "Kubernetes" and "k8s" as two. */
export function dedupeKeywords(keywords: RequirementKeyword[]): RequirementKeyword[] {
  const seen = new Set<string>();
  return keywords.filter((k) => {
    const key = canonicalOf(k.term) ?? normalizePhrase(k.term);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Score the finished resume against the posting. Measured on the *tailored* text —
 * that is what an ATS indexes — so "covered" means the word is actually on the page.
 *  - covered: on the page
 *  - unused:  you can claim it (it's in your master, or implied by it), but this version
 *             doesn't say it — a regenerate usually fixes that
 *  - missing: nothing in your record supports it; "I have this" is how you add it
 */
export function buildReport(
  requirements: Requirements,
  master: MasterResume,
  tailored: TailoredResume,
  reverted: number,
): KeywordReport {
  const text = tailoredText(tailored);
  const terms = findTerms(text);
  const ctx = coverageContext(master);

  const evaluate = (k: RequirementKeyword): KeywordResult => {
    const confirmed = master.confirmedSkills.some((s) => mentions(s, k));
    if (mentions(text, k, terms)) return { term: k.term, status: "covered", confirmed };
    const before = classifyRequirement(k, ctx);
    return { term: k.term, status: before === "missing" ? "missing" : "unused", confirmed };
  };

  const mustHave = dedupeKeywords(requirements.mustHave).map(evaluate);
  const niceToHave = dedupeKeywords(requirements.niceToHave).map(evaluate);
  const count = (list: KeywordResult[]) => ({
    matched: list.filter((k) => k.status === "covered").length,
    total: list.length,
  });

  return {
    mustHave,
    niceToHave,
    coverage: { mustHave: count(mustHave), niceToHave: count(niceToHave) },
    reverted,
  };
}

/** Must-have coverage as a whole percentage, or null when the posting named none. */
export function coveragePercent(report: KeywordReport): number | null {
  const { matched, total } = report.coverage.mustHave;
  return total === 0 ? null : Math.round((matched / total) * 100);
}
