import { integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

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
    profileVersion: integer()
      .notNull()
      .references(() => profile.version, { onDelete: "cascade" }),
    key: text().notNull(),
    label: text().notNull(),
    kind: strengthKind().notNull(),
    weight: integer().notNull().default(1),
    summary: text(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("strengths_version_key_uq").on(t.profileVersion, t.key)],
);

export type Strength = typeof strengths.$inferSelect;
export type NewStrength = typeof strengths.$inferInsert;
