import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { createdAt, id } from "./columns";
import { draftStatus } from "./enums";
import { matches } from "./matches";

/** A strength-grounded outreach draft awaiting a human decision (PRD §7). */
export const drafts = pgTable("drafts", {
  id: id(),
  matchId: uuid()
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  recipient: text(),
  subject: text().notNull(),
  body: text().notNull(),
  editedBody: text(),
  status: draftStatus().notNull().default("pending"),
  createdAt: createdAt(),
  decidedAt: timestamp({ withTimezone: true }),
});

export type Draft = typeof drafts.$inferSelect;
export type NewDraft = typeof drafts.$inferInsert;
