import "server-only";

import { createHash } from "node:crypto";

import { z } from "zod";

import { cacheRequirements, getCachedRequirements } from "@/db/queries/resumes";
import { generateStructured, MODELS, type TokenUsage } from "@/lib/llm";
import { assembleTailored, type TailorOutput } from "@/lib/resume/assemble";
import { canonicalOf, classifyRequirement, coverageContext, findTerms, masterText, resumeTerms } from "@/lib/resume/keywords";
import { buildReport } from "@/lib/resume/report";
import { cleanLine, numbersIn, tidyName, unsupportedNumbers, yearsOfExperience } from "@/lib/resume/text";
import {
  parsedResumeSchema,
  requirementsSchema,
  type KeywordReport,
  type MasterResume,
  type Requirements,
  type TailoredResume,
} from "@/lib/resume/types";

import {
  coverPrompt,
  coverSystem,
  PARSE_SYSTEM,
  REQUIREMENTS_SYSTEM,
  tailorPrompt,
  tailorSystem,
} from "./prompts";

/**
 * The four model steps, each sized for cost:
 *
 * | step         | reasoning | when                               |
 * |--------------|-----------|------------------------------------|
 * | parse        | minimal   | once per upload                    |
 * | requirements | minimal   | once per distinct JD, shared, cached |
 * | tailor       | low       | per generate / regenerate          |
 * | cover letter | low       | only when asked                    |
 *
 * Copying and extraction are mechanical, so they get the least thinking. Tailoring and
 * the letter are judgment calls, so they get a little — and the guards catch the rest.
 * Reasoning is billed as output, which is 8x input on gpt-5-mini; this is the lever.
 *
 * Interactive calls retry once, not twice: someone is waiting, and a third attempt would
 * push past the request's time budget anyway.
 */

const INTERACTIVE = { maxRetries: 1, timeoutMs: 150_000 } as const;

// --- Parse ---------------------------------------------------------------------------

export async function parseResume(sourceText: string): Promise<{
  master: MasterResume;
  warnings: string[];
  usage: TokenUsage;
}> {
  const { data, usage } = await generateStructured({
    schema: parsedResumeSchema,
    system: PARSE_SYSTEM,
    prompt: `RESUME TEXT:\n${sourceText}`,
    model: MODELS.resume,
    reasoningEffort: "minimal",
    maxOutputTokens: 12_000,
    ...INTERACTIVE,
  });

  // Ids are assigned here, never by the model: short, stable within a version, and
  // impossible to collide.
  const master: MasterResume = {
    contact: { ...data.contact, name: tidyName(data.contact.name) },
    headline: data.headline,
    summary: data.summary,
    roles: data.roles.map((role, i) => ({
      ...role,
      id: `r${i + 1}`,
      bullets: role.bullets
        .map(cleanLine)
        .filter(Boolean)
        .map((text, j) => ({ id: `r${i + 1}b${j + 1}`, text })),
    })),
    projects: data.projects.map((project, i) => ({
      ...project,
      id: `p${i + 1}`,
      bullets: project.bullets
        .map(cleanLine)
        .filter(Boolean)
        .map((text, j) => ({ id: `p${i + 1}b${j + 1}`, text })),
    })),
    education: data.education,
    skills: [...new Set(data.skills.map(cleanLine).filter(Boolean))],
    certifications: data.certifications,
    confirmedSkills: [],
  };

  return { master, warnings: parseWarnings(master, sourceText), usage };
}

/**
 * Things worth a second look after parsing. The parse is meant to be a copy, so a number
 * that isn't in the file is the clearest sign it wasn't one.
 */
export function parseWarnings(master: MasterResume, sourceText: string): string[] {
  const warnings: string[] = [];
  if (!master.contact.name.trim()) warnings.push("No name was found — add it to the top of your resume.");
  if (master.roles.length === 0 && master.projects.length === 0) {
    warnings.push("No work experience or projects were found.");
  }
  const sourceNumbers = numbersIn(sourceText);
  for (const role of master.roles) {
    for (const bullet of role.bullets) {
      const extra = unsupportedNumbers(bullet.text, sourceNumbers);
      if (extra.length > 0) {
        warnings.push(`A ${role.company} line mentions ${extra.join(", ")}, which isn't in your file: "${bullet.text}"`);
      }
    }
  }
  return warnings;
}

// --- Requirements --------------------------------------------------------------------

/** The longest JD we send. Postings past this are boilerplate (benefits, EEO) by then. */
const MAX_JD_CHARS = 15_000;

export function jdHash(jdText: string): string {
  return createHash("sha256").update(jdText.replace(/\s+/g, " ").trim()).digest("hex");
}

/** The model call alone — no cache. Used by `getRequirements` and the smoke test. */
export async function extractRequirements(
  jdText: string,
): Promise<{ requirements: Requirements; usage: TokenUsage }> {
  const { data, usage } = await generateStructured({
    schema: requirementsSchema,
    system: REQUIREMENTS_SYSTEM,
    prompt: `JOB DESCRIPTION:\n${jdText.slice(0, MAX_JD_CHARS)}`,
    model: MODELS.resume,
    reasoningEffort: "minimal",
    maxOutputTokens: 4_000,
    ...INTERACTIVE,
  });
  return {
    requirements: {
      ...data,
      mustHave: data.mustHave.slice(0, 20),
      niceToHave: data.niceToHave.slice(0, 15),
      responsibilities: data.responsibilities.slice(0, 8),
    },
    usage,
  };
}

export async function getRequirements(jdText: string): Promise<{
  requirements: Requirements;
  hash: string;
  /** Null when served from cache — nothing was spent. */
  usage: TokenUsage | null;
}> {
  const hash = jdHash(jdText);
  const cached = await getCachedRequirements(hash);
  if (cached) return { requirements: cached, hash, usage: null };

  const { requirements, usage } = await extractRequirements(jdText);
  await cacheRequirements(hash, requirements, usage.model);
  return { requirements, hash, usage };
}

// --- Tailor --------------------------------------------------------------------------

/**
 * Constrain citations to ids that exist, the same way drafting constrains evidence ids:
 * the model can only point at real bullets. `z.enum` needs at least one value, so an
 * empty list falls back to a plain string (and the guards drop anything it cites).
 */
function idEnum(ids: string[]) {
  return ids.length > 0 ? z.enum(ids as [string, ...string[]]) : z.string();
}

export function buildTailorSchema(master: MasterResume) {
  const bullets = z.array(
    z.object({
      sourceId: idEnum([
        ...master.roles.flatMap((r) => r.bullets.map((b) => b.id)),
        ...master.projects.flatMap((p) => p.bullets.map((b) => b.id)),
      ]),
      text: z.string(),
    }),
  );
  const shape = {
    headline: z.string(),
    summary: z.string(),
    roles: z.array(z.object({ roleId: idEnum(master.roles.map((r) => r.id)), bullets })),
    skills: z.array(z.string()),
  };
  return master.projects.length > 0
    ? z.object({
        ...shape,
        projects: z.array(z.object({ projectId: idEnum(master.projects.map((p) => p.id)), bullets })),
      })
    : z.object(shape);
}

export async function tailor(
  master: MasterResume,
  requirements: Requirements,
): Promise<{ resume: TailoredResume; report: KeywordReport; usage: TokenUsage }> {
  const ctx = coverageContext(master);
  const { data, usage } = await generateStructured({
    schema: buildTailorSchema(master),
    system: tailorSystem(master),
    prompt: tailorPrompt({ requirements, status: (k) => classifyRequirement(k, ctx) }),
    model: MODELS.resume,
    reasoningEffort: "low",
    maxOutputTokens: 10_000,
    ...INTERACTIVE,
  });

  const { resume, reverted } = assembleTailored(master, data as TailorOutput);
  return { resume, report: buildReport(requirements, master, resume, reverted), usage };
}

// --- Cover letter --------------------------------------------------------------------

/**
 * Write the letter, then list anything in it the master can't back. Prose can't be
 * reverted line by line the way bullets can, so instead of silently rewriting it, the
 * claims are shown next to the (editable) letter.
 */
export async function writeCoverLetter(params: {
  master: MasterResume;
  requirements: Requirements;
  jdText: string;
}): Promise<{ letter: string; warnings: string[]; usage: TokenUsage }> {
  const { master, requirements, jdText } = params;
  const ctx = coverageContext(master);

  const { data, usage } = await generateStructured({
    schema: z.object({ letter: z.string().min(1) }),
    system: coverSystem(master),
    prompt: coverPrompt({
      requirements,
      status: (k) => classifyRequirement(k, ctx),
      jdExcerpt: jdText.slice(0, 2_500),
      candidateName: master.contact.name,
    }),
    model: MODELS.resume,
    reasoningEffort: "low",
    maxOutputTokens: 4_000,
    ...INTERACTIVE,
  });

  const letter = data.letter.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { letter, warnings: coverLetterWarnings(master, letter, jdText), usage };
}

/**
 * Numbers may come from the resume (claims about you) or the posting (facts about them —
 * "your 200 engineers"). Anything else, and any technology the resume doesn't show, is
 * listed for you to check before sending.
 */
export function coverLetterWarnings(master: MasterResume, letter: string, jdText: string): string[] {
  const allowedNumbers = new Set([...numbersIn(masterText(master)), ...numbersIn(jdText)]);
  const years = yearsOfExperience(master);
  if (years !== null) for (const y of [years, years - 1]) if (y > 0) allowedNumbers.add(String(y));

  const claimable = resumeTerms(master);
  const warnings: string[] = [];
  const numbers = unsupportedNumbers(letter, allowedNumbers);
  if (numbers.length > 0) warnings.push(`Mentions ${numbers.join(", ")} — not found in your resume.`);
  const terms = [...findTerms(letter)].filter((t) => !claimable.has(t));
  if (terms.length > 0) warnings.push(`Mentions ${terms.join(", ")} — not something your resume shows.`);
  return warnings;
}

/** Whether a skill phrase is already on the master (as written or by canonical name). */
export function masterHasSkill(master: MasterResume, term: string): boolean {
  const canonical = canonicalOf(term);
  const key = term.trim().toLowerCase();
  return [...master.skills, ...master.confirmedSkills].some(
    (s) => s.trim().toLowerCase() === key || (canonical !== null && canonicalOf(s) === canonical),
  );
}
