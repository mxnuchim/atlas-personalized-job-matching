import { boolean, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { createdAt, id } from "./columns";
import { users } from "./users";

/**
 * A user's positioning, versioned. Strengths and matches reference this row's `id`,
 * so bumping the version creates a new row and triggers a targeted re-score (PRD §7).
 *
 * `version` is unique *per user*, not globally: two people both start at version 1,
 * and a global unique would make the second person's first profile impossible.
 */
export const profile = pgTable(
  "profile",
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    version: integer().notNull(),
    headline: text().notNull(),
    /**
     * Who the outreach is from. Required before drafting: an email signed "the
     * candidate" is worse than no email, so `runDraft` refuses rather than guessing.
     */
    name: text(),
    /** §15-C requires the portfolio link in every draft. */
    portfolioUrl: text(),
    targetRoles: jsonb().$type<string[]>().notNull().default([]),
    seniority: text(),
    locations: jsonb().$type<string[]>().notNull().default([]),
    relocation: boolean().notNull().default(false),
    dealbreakers: jsonb().$type<string[]>().notNull().default([]),
    cvText: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("profile_user_version_uq").on(t.userId, t.version)],
);

export type Profile = typeof profile.$inferSelect;
export type NewProfile = typeof profile.$inferInsert;
