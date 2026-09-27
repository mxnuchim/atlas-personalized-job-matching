import { integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { createdAt, id } from "./columns";
import { strengthKind } from "./enums";
import { profile } from "./profile";

/**
 * The spine: the user's capabilities as first-class data. Jobs are scored
 * *against* these and outreach argues *from* them (PRD §7).
 */
export const strengths = pgTable(
  "strengths",
  {
    id: id(),
    // Keyed on the profile row, not its version number: a version is only unique
    // within a user, so `version` alone cannot identify whose strengths these are.
    profileId: uuid()
      .notNull()
      .references(() => profile.id, { onDelete: "cascade" }),
    key: text().notNull(),
    label: text().notNull(),
    kind: strengthKind().notNull(),
    weight: integer().notNull().default(1),
    summary: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("strengths_profile_key_uq").on(t.profileId, t.key)],
);

export type Strength = typeof strengths.$inferSelect;
export type NewStrength = typeof strengths.$inferInsert;
