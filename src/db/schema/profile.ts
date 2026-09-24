import { boolean, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { createdAt, id } from "./columns";

/**
 * The user's positioning, versioned. `version` is the stable key that strengths
 * and matches reference, so bumping it can trigger a targeted re-score (PRD §7).
 */
export const profile = pgTable("profile", {
  id: id(),
  version: integer().notNull().unique(),
  headline: text().notNull(),
  targetRoles: jsonb().$type<string[]>().notNull().default([]),
  seniority: text(),
  locations: jsonb().$type<string[]>().notNull().default([]),
  relocation: boolean().notNull().default(false),
  dealbreakers: jsonb().$type<string[]>().notNull().default([]),
  cvText: text(),
  createdAt: createdAt(),
});

export type Profile = typeof profile.$inferSelect;
export type NewProfile = typeof profile.$inferInsert;
