import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { id } from "./columns";
import { matchTier } from "./enums";
import { jobs } from "./jobs";
import type { FitDimensions, StrengthMatch } from "./json";
import { profile } from "./profile";

/**
 * One strength-aware score per (job, profile). `strength_matches` and `why_you` are
 * what make the score legible and what feed the draft (PRD §7 / §9).
 *
 * Keyed on the profile row rather than its version number, which scopes a match to
 * its owner: two users both have a version 1, so `(job_id, version)` would collide
 * and one person's score would overwrite the other's.
 */
export const matches = pgTable(
  "matches",
  {
    id: id(),
    jobId: uuid()
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    profileId: uuid()
      .notNull()
      .references(() => profile.id, { onDelete: "cascade" }),
    overall: integer().notNull(),
    tier: matchTier().notNull(),
    dimensions: jsonb().$type<FitDimensions>().notNull(),
    strengthMatches: jsonb().$type<StrengthMatch[]>().notNull().default([]),
    whyYou: text().notNull(),
    reasoning: text().notNull(),
    redFlags: jsonb().$type<string[]>().notNull().default([]),
    model: text().notNull(),
    tokensIn: integer(),
    tokensOut: integer(),
    scoredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("matches_job_profile_uq").on(t.jobId, t.profileId)],
);

export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
