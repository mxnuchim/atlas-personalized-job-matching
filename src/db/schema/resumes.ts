import { index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { KeywordReport, MasterResume, Requirements, TailoredResume } from "@/lib/resume/types";

import { createdAt, id, updatedAt } from "./columns";
import { jobs } from "./jobs";
import { users } from "./users";

/**
 * Resume tailoring (see docs/INTERFACE.md §10e).
 *
 * Owned by the *user*, not the profile: a resume is a person's document, and a profile
 * re-import (which versions the profile and re-scores everything) must not touch it.
 */

/**
 * The source of truth: what was uploaded/pasted, and its structured parse. Versioned —
 * a new upload or an "I have this" confirmation writes a new row rather than editing in
 * place, so every tailored resume can say exactly which master it was built from.
 * The latest version is current.
 */
export const masterResumes = pgTable(
  "master_resumes",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    /** The extracted text, kept so a parse can be re-run without asking for the file again. */
    sourceText: text().notNull(),
    sourceFileName: text(),
    sourceMime: text(),
    content: jsonb().$type<MasterResume>().notNull(),
    /** Parse-time notes for review (e.g. a bullet whose number isn't in the file). */
    warnings: jsonb().$type<string[]>().notNull().default([]),
    model: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("master_resumes_user_version_uq").on(t.userId, t.version)],
);

/**
 * What a job description asks for, keyed by a hash of its text. Contains nothing about
 * any user, so it's shared: the second person to tailor for a posting, and every
 * regeneration after the first, reuse it instead of paying to extract it again.
 */
export const jdRequirements = pgTable("jd_requirements", {
  hash: text().primaryKey(),
  requirements: jsonb().$type<Requirements>().notNull(),
  model: text().notNull(),
  createdAt: createdAt(),
});

/**
 * One tailored resume per (user, job). Pasted descriptions have no job, and Postgres
 * treats NULLs as distinct, so the unique index allows any number of those.
 */
export const tailoredResumes = pgTable(
  "tailored_resumes",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    jobId: uuid().references(() => jobs.id, { onDelete: "set null" }),
    jdHash: text().notNull(),
    jdText: text().notNull(),
    title: text().notNull(),
    company: text(),
    masterId: uuid()
      .notNull()
      .references(() => masterResumes.id, { onDelete: "cascade" }),
    content: jsonb().$type<TailoredResume>().notNull(),
    report: jsonb().$type<KeywordReport>().notNull(),
    coverLetter: text(),
    /** Claims in the letter that couldn't be traced to the master — shown, not hidden. */
    coverLetterWarnings: jsonb().$type<string[]>().notNull().default([]),
    model: text().notNull(),
    /** Running total of every model call spent on this resume and its letter. */
    costUsd: numeric({ precision: 10, scale: 6 }).notNull().default("0"),
    /** Set when you mark the role applied — the version you actually sent. */
    usedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("tailored_resumes_user_job_uq").on(t.userId, t.jobId),
    index("tailored_resumes_user_updated_idx").on(t.userId, t.updatedAt),
  ],
);

/**
 * A ledger of every model call the resume feature makes. It's what the daily cap counts,
 * and what lets the page say what the feature has actually cost — spend you can see is
 * spend you can control.
 */
export const resumeEvents = pgTable(
  "resume_events",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** parse · requirements · tailor · cover */
    kind: text().notNull(),
    model: text().notNull(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    cachedInputTokens: integer().notNull().default(0),
    /** Null when the model has no published price — unknown, never a fabricated zero. */
    costUsd: numeric({ precision: 10, scale: 6 }),
    createdAt: createdAt(),
  },
  (t) => [index("resume_events_user_created_idx").on(t.userId, t.createdAt)],
);

export type MasterResumeRow = typeof masterResumes.$inferSelect;
export type TailoredResumeRow = typeof tailoredResumes.$inferSelect;
