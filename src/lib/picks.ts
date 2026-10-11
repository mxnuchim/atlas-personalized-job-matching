import { capPerCompany } from "./queue";

/**
 * How Today chooses its picks — "the very best" meaning roles you can actually get, not
 * just roles that read well.
 *
 * The match score alone isn't enough: it's the model's overall verdict, and it was
 * routinely ~89 for roles whose location fit was 60 (hybrid in San Francisco, US work
 * authorisation required). So Today ranks by a pick score that weighs feasibility:
 *
 *   pick = 0.60 · overall + 0.25 · location fit + 0.15 · seniority fit + freshness
 *
 * after three gates — role, seniority and location fit each ≥ 70 — and one exclusion:
 * red flags that say sponsorship is *explicitly not offered*. Not the word "dealbreaker":
 * the model writes it for 45% of roles, mostly hedged ("possible dealbreaker if…"), and
 * excluding on it would empty the pool. Uncertainty is already priced into location fit.
 *
 * Then near-duplicate titles at one employer collapse to the best (three variants of
 * "Backend Engineer" at one company are one application), and at most two per employer.
 *
 * Calibrated on real data (2026-10-11): the top 20 went from 4 visa/location mismatches
 * to none, every pick at location fit ≥ 85. One list, wherever the role is: a Lagos role
 * competes with a remote-EU one on the same score.
 *
 * Pure and client-safe — tested directly in `picks.test.ts`.
 */

export type PickCandidate = {
  id: string;
  company: string;
  title: string;
  location: string | null;
  overall: number;
  dimensions: { role_fit: number; seniority_fit: number; location_fit: number };
  redFlags: string[];
  postedAt: Date | null;
};

export const PICK_GATE = 70;

/** Sponsorship stated as unavailable — a hard no, unlike "not stated" or "unclear". */
const NO_SPONSORSHIP =
  /\b(?:does not|doesn'?t|will not|won'?t|cannot|can'?t|unable to|not able to)\s+(?:offer\s+|provide\s+)?(?:visa\s+)?sponsor|\bno (?:visa )?sponsorship (?:is )?(?:available|offered|provided)\b|\bwithout (?:the need for )?(?:visa )?sponsorship\b|\bmust (?:already )?(?:have|hold) (?:the )?(?:right|authori[sz]ation) to work\b/i;

export function hasHardNo(redFlags: string[]): boolean {
  return redFlags.some((flag) => NO_SPONSORSHIP.test(flag));
}

export function isPickable(c: PickCandidate): boolean {
  const d = c.dimensions;
  return (
    d.role_fit >= PICK_GATE &&
    d.seniority_fit >= PICK_GATE &&
    d.location_fit >= PICK_GATE &&
    !hasHardNo(c.redFlags)
  );
}

/** Fresh postings get a nudge (likelier read, likelier open); long-open ones a small cost. */
function freshness(postedAt: Date | null, now: Date): number {
  if (!postedAt) return 0;
  const days = (now.getTime() - postedAt.getTime()) / 86_400_000;
  if (days <= 7) return 2;
  if (days <= 14) return 1;
  if (days > 180) return -3;
  return 0;
}

export function pickScore(c: PickCandidate, now: Date = new Date()): number {
  return (
    0.6 * c.overall +
    0.25 * c.dimensions.location_fit +
    0.15 * c.dimensions.seniority_fit +
    freshness(c.postedAt, now)
  );
}

const SENIORITY_WORDS = /\b(?:senior|sr|staff|lead|principal|mid|junior|jr|i{1,3}|iv|level\s*\d+|l\d)\b/g;

/** The role a title names, minus level and decoration: "Senior Backend Engineer (Mid/Senior)" → backend, engineer. */
export function titleWords(title: string): Set<string> {
  const normalised = title
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/full[\s-]?stack/g, "fullstack")
    .replace(/back[\s-]end/g, "backend")
    .replace(/front[\s-]end/g, "frontend")
    .replace(SENIORITY_WORDS, " ")
    .replace(/[^a-z0-9 ]+/g, " ");
  return new Set(normalised.split(/\s+/).filter((w) => w.length > 2 && !["and", "the", "for", "with"].includes(w)));
}

function similarity(a: Set<string>, b: Set<string>): number {
  const shared = [...a].filter((w) => b.has(w)).length;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Same employer, essentially the same role — apply to the best one. */
export function isNearDuplicate(a: PickCandidate, b: PickCandidate): boolean {
  return (
    a.company.trim().toLowerCase() === b.company.trim().toLowerCase() &&
    similarity(titleWords(a.title), titleWords(b.title)) >= 0.6
  );
}

/** The day's picks, best first: gate, rank, collapse near-duplicates, cap per employer. */
export function selectPicks<T extends PickCandidate>(
  candidates: T[],
  size: number,
  maxPerCompany: number,
  now: Date = new Date(),
): T[] {
  const ranked = candidates
    .filter(isPickable)
    .map((c) => ({ c, score: pickScore(c, now) }))
    .sort((a, b) => b.score - a.score || b.c.overall - a.c.overall)
    .map(({ c }) => c);

  const distinct: T[] = [];
  for (const c of ranked) if (!distinct.some((kept) => isNearDuplicate(kept, c))) distinct.push(c);

  return capPerCompany(distinct, size, maxPerCompany);
}
