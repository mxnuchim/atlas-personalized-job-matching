import { z } from "zod";

/**
 * The resume feature's data shapes, shared by the pipeline (server), the UI (client) and
 * the renderers. Client-safe: no `server-only`, no secrets.
 *
 * Three layers:
 *  - `ParsedResume` — what the model extracts from an uploaded/pasted resume. No ids.
 *  - `MasterResume` — the stored source of truth: the parse plus stable ids, so every
 *    tailored bullet can cite the bullet it came from.
 *  - `TailoredResume` — one per job. Facts (company, title, dates, education) are copied
 *    from the master in code; only wording and selection come from the model.
 *
 * LLM-facing schemas use `nullable`, never `optional`: strict structured outputs require
 * every key to be present.
 */

const contactSchema = z.object({
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  location: z.string().nullable(),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
});

const educationSchema = z.object({
  school: z.string(),
  degree: z.string().nullable(),
  field: z.string().nullable(),
  start: z.string().nullable(),
  end: z.string().nullable(),
  details: z.string().nullable(),
});

const certificationSchema = z.object({
  name: z.string(),
  issuer: z.string().nullable(),
  year: z.string().nullable(),
});

/** What the parser returns. Bullets are plain strings; ids are assigned in code. */
export const parsedResumeSchema = z.object({
  contact: contactSchema,
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  roles: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      location: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      current: z.boolean(),
      bullets: z.array(z.string()),
    }),
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      description: z.string().nullable(),
      bullets: z.array(z.string()),
    }),
  ),
  education: z.array(educationSchema),
  skills: z.array(z.string()),
  certifications: z.array(certificationSchema),
});
export type ParsedResume = z.infer<typeof parsedResumeSchema>;

const bulletSchema = z.object({ id: z.string(), text: z.string() });

export const masterResumeSchema = z.object({
  contact: contactSchema,
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  roles: z.array(
    z.object({
      id: z.string(),
      company: z.string(),
      title: z.string(),
      location: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      current: z.boolean(),
      bullets: z.array(bulletSchema),
    }),
  ),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      bullets: z.array(bulletSchema),
    }),
  ),
  education: z.array(educationSchema),
  skills: z.array(z.string()),
  certifications: z.array(certificationSchema),
  /**
   * Skills the person confirmed from a job's gap list ("I have this"). Kept apart from
   * `skills` so the UI can say which came from their file and which they added — and so
   * the guards know these may appear in the summary and skills, but never in a bullet,
   * which would claim *where* they were used.
   */
  confirmedSkills: z.array(z.string()),
});
export type MasterResume = z.infer<typeof masterResumeSchema>;
export type MasterRole = MasterResume["roles"][number];

const keywordSchema = z.object({
  term: z.string().min(1),
  aliases: z.array(z.string()),
  kind: z.enum(["skill", "tool", "domain", "certification", "soft"]),
});
export type RequirementKeyword = z.infer<typeof keywordSchema>;

/** What a job description asks for — extracted once per distinct JD and cached. */
export const requirementsSchema = z.object({
  title: z.string().min(1),
  company: z.string().nullable(),
  seniority: z.string().nullable(),
  mustHave: z.array(keywordSchema),
  niceToHave: z.array(keywordSchema),
  responsibilities: z.array(z.string()),
});
export type Requirements = z.infer<typeof requirementsSchema>;

const tailoredBulletSchema = z.object({ sourceId: z.string(), text: z.string() });

export const tailoredResumeSchema = z.object({
  contact: contactSchema,
  headline: z.string().nullable(),
  summary: z.string().nullable(),
  roles: z.array(
    z.object({
      id: z.string(),
      company: z.string(),
      title: z.string(),
      location: z.string().nullable(),
      start: z.string().nullable(),
      end: z.string().nullable(),
      current: z.boolean(),
      bullets: z.array(tailoredBulletSchema),
    }),
  ),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().nullable(),
      bullets: z.array(tailoredBulletSchema),
    }),
  ),
  education: z.array(educationSchema),
  skills: z.array(z.string()),
  certifications: z.array(certificationSchema),
});
export type TailoredResume = z.infer<typeof tailoredResumeSchema>;

export type KeywordStatus = "covered" | "unused" | "missing";

export type KeywordResult = {
  term: string;
  /** covered: in the tailored resume · unused: in your master but not used · missing: nowhere. */
  status: KeywordStatus;
  /** True when you confirmed it ("I have this") rather than it coming from your file. */
  confirmed: boolean;
};

export type KeywordReport = {
  mustHave: KeywordResult[];
  niceToHave: KeywordResult[];
  coverage: {
    mustHave: { matched: number; total: number };
    niceToHave: { matched: number; total: number };
  };
  /** How many model edits the guards rejected and reverted to your original wording. */
  reverted: number;
};
