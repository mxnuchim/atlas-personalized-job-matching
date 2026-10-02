import { canonicalOf, findTerms, masterText, normalizePhrase, resumeTerms, withImplied } from "./keywords";
import { cleanLine, numbersIn, sentences, unsupportedNumbers, yearsOfExperience } from "./text";
import type { MasterResume, TailoredResume } from "./types";

/**
 * Turn the model's tailoring into a resume — and refuse anything it made up.
 *
 * The model chooses *which* of your bullets to show, *in what order*, and *how to word
 * them* for this role. Everything factual is copied from the master here, in code:
 * companies, titles, dates, locations, education, certifications, contact. The model is
 * never asked for those, so it can't get them wrong.
 *
 * Every rewritten line then has to pass three checks against the line it claims to come from:
 *  - **No new numbers.** "99.9%" may not become "99.99%".
 *  - **No new technologies.** A bullet may only name tools its source names or directly
 *    implies (Terraform → "infrastructure as code"). Skills you confirmed may appear in
 *    the summary and skills list, but never inside a bullet — that would claim *where*
 *    you used them.
 *  - **No invented outcomes.** ", improving developer experience" tacked onto a line that
 *    never said so is reverted (`addsUnsupportedOutcome`).
 * A line that fails is **reverted to your original wording**, not dropped: real experience
 * is never lost to a guard. The count of reversions is reported, not hidden.
 */

export type TailorOutput = {
  headline: string;
  summary: string;
  roles: { roleId: string; bullets: { sourceId: string; text: string }[] }[];
  projects?: { projectId: string; bullets: { sourceId: string; text: string }[] }[];
  skills: string[];
};

/** Bullets kept per role, most recent first. Older roles condense; none disappear. */
const ROLE_BULLET_CAPS = [6, 5, 4, 3];
const OLDER_ROLE_CAP = 2;
const PROJECT_BULLET_CAP = 3;
const MAX_SKILLS = 30;

function roleCap(index: number): number {
  return ROLE_BULLET_CAPS[index] ?? OLDER_ROLE_CAP;
}

type Bullet = { id: string; text: string };

/**
 * A vague purpose or outcome tacked onto the end of a line — ", improving developer
 * experience", "to increase code reliability". The most common way a keyword-hungry
 * rewrite embellishes: no new number, no new tool, just an outcome nobody measured. Seen
 * in practice on freelance websites "improving developer delivery practices".
 */
const OUTCOME_TAIL =
  /(?:,\s*(?:and\s+)?|\s+(?:to|in order to|thereby|helping to)\s+)(improv|increas|enhanc|ensur|support|driv|boost|strengthen|enabl|streamlin|optimi[sz]|elevat|foster|empower|maximi[sz]|bolster)\w*\b([^.;]*)$/i;

/** True when the rewrite ends with an unmeasured outcome its source never claimed. */
export function addsUnsupportedOutcome(text: string, source: string): boolean {
  const match = text.replace(/[.\s]+$/, "").match(OUTCOME_TAIL);
  if (!match) return false;
  const [, root, rest] = match;
  // A clause carrying a number is restating a real result (the number guard vouches for it).
  if (/\d/.test(rest ?? "")) return false;
  return !source.toLowerCase().includes(root!.toLowerCase());
}

/**
 * Keep the model's selection and order for one section, guarding each line against its
 * own source. Returns the kept bullets and how many were reverted or discarded.
 */
function guardBullets(
  source: Bullet[],
  proposed: { sourceId: string; text: string }[],
  cap: number,
): { bullets: { sourceId: string; text: string }[]; reverted: number } {
  const byId = new Map(source.map((b) => [b.id, b]));
  const seen = new Set<string>();
  const out: { sourceId: string; text: string }[] = [];
  let reverted = 0;

  for (const p of proposed) {
    const original = byId.get(p.sourceId);
    if (!original || seen.has(p.sourceId)) {
      // A citation to a bullet from another role, or a repeat — not something to show.
      if (!original) reverted += 1;
      continue;
    }
    seen.add(p.sourceId);

    const text = cleanLine(p.text);
    const allowedTerms = withImplied(findTerms(original.text));
    const inventsNumber = unsupportedNumbers(text, numbersIn(original.text)).length > 0;
    const inventsTerm = [...findTerms(text)].some((t) => !allowedTerms.has(t));
    const inventsOutcome = addsUnsupportedOutcome(text, original.text);

    if (!text || inventsNumber || inventsTerm || inventsOutcome) {
      if (text) reverted += 1;
      out.push({ sourceId: original.id, text: original.text });
    } else {
      out.push({ sourceId: original.id, text });
    }
  }

  const kept = out.slice(0, cap);
  if (kept.length > 0) return { bullets: kept, reverted };

  // The model left this role empty. Show its first lines rather than a bare title — a
  // role with no bullets reads as a gap, and gaps are what screeners probe.
  return {
    bullets: source.slice(0, Math.min(cap, 2)).map((b) => ({ sourceId: b.id, text: b.text })),
    reverted,
  };
}

/** Keep only summary sentences that invent neither a number nor a technology. */
function guardProse(
  text: string,
  allowedTerms: Set<string>,
  allowedNumbers: Set<string>,
): { text: string; dropped: number } {
  const kept: string[] = [];
  let dropped = 0;
  for (const sentence of sentences(cleanLine(text))) {
    const badNumber = unsupportedNumbers(sentence, allowedNumbers).length > 0;
    const badTerm = [...findTerms(sentence)].some((t) => !allowedTerms.has(t));
    if (badNumber || badTerm) dropped += 1;
    else kept.push(sentence);
  }
  return { text: kept.join(" "), dropped };
}

export function assembleTailored(
  master: MasterResume,
  output: TailorOutput,
  now: Date = new Date(),
): { resume: TailoredResume; reverted: number } {
  let reverted = 0;

  const claimable = resumeTerms(master);
  const allText = masterText(master);
  const proseNumbers = numbersIn(allText);
  const years = yearsOfExperience(master, now);
  // "8+ years of experience" is derived from your dates, not written anywhere — allow it.
  if (years !== null) for (const y of [years, years - 1]) if (y > 0) proseNumbers.add(String(y));

  const roles = master.roles.map((role, index) => {
    const proposed = output.roles.filter((r) => r.roleId === role.id).flatMap((r) => r.bullets);
    const guarded = guardBullets(role.bullets, proposed, roleCap(index));
    reverted += guarded.reverted;
    return {
      id: role.id,
      company: role.company,
      title: role.title,
      location: role.location,
      start: role.start,
      end: role.end,
      current: role.current,
      bullets: guarded.bullets,
    };
  });

  const projects = master.projects.map((project) => {
    const proposed = (output.projects ?? [])
      .filter((p) => p.projectId === project.id)
      .flatMap((p) => p.bullets);
    const guarded = guardBullets(project.bullets, proposed, PROJECT_BULLET_CAP);
    reverted += guarded.reverted;
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      bullets: guarded.bullets,
    };
  });

  const summary = guardProse(output.summary, claimable, proseNumbers);
  reverted += summary.dropped;

  const headlineCheck = guardProse(output.headline, claimable, proseNumbers);
  const headlineOk = headlineCheck.dropped === 0 && headlineCheck.text.length > 0;
  if (!headlineOk && output.headline.trim()) reverted += 1;

  return {
    resume: {
      contact: master.contact,
      headline: headlineOk
        ? headlineCheck.text.replace(/[.!?]+$/, "")
        : (master.headline ?? master.roles[0]?.title ?? null),
      summary: summary.text || master.summary,
      roles,
      projects,
      education: master.education,
      skills: guardSkills(master, output.skills, claimable, (n) => (reverted += n)),
      certifications: master.certifications,
    },
    reverted,
  };
}

/**
 * The skills section: the model's ordering first (role-relevant skills lead), restricted
 * to what you can claim, then the rest of your skills so nothing true goes missing.
 * Deduplicated by canonical name, so "k8s" and "Kubernetes" don't both appear.
 */
function guardSkills(
  master: MasterResume,
  proposed: string[],
  claimable: Set<string>,
  onReject: (n: number) => void,
): string[] {
  const known = new Set([...master.skills, ...master.confirmedSkills].map(normalizePhrase));
  const keys = new Set<string>();
  const out: string[] = [];
  let rejected = 0;

  const add = (skill: string, trusted: boolean) => {
    const clean = cleanLine(skill);
    if (!clean) return;
    const canonical = canonicalOf(clean);
    const key = canonical ?? normalizePhrase(clean);
    if (keys.has(key)) return;
    const ok = trusted || (canonical ? claimable.has(canonical) : known.has(normalizePhrase(clean)));
    if (!ok) {
      rejected += 1;
      return;
    }
    keys.add(key);
    out.push(clean);
  };

  for (const s of proposed) add(s, false);
  for (const s of [...master.skills, ...master.confirmedSkills]) add(s, true);

  onReject(rejected);
  return out.slice(0, MAX_SKILLS);
}
