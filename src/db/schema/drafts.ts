import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { createdAt, id } from "./columns";
import { draftStatus } from "./enums";
import { evidence } from "./evidence";
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

  /**
   * Which evidence row the draft cites, and which of the rewarded strengths it builds
   * on. Recorded rather than inferred because "build on the flagged strengths and cite
   * a real evidence item" is the spine of the product (PRD §8 step 5) — without these
   * you cannot tell whether a draft actually did it, and the review queue has nothing
   * to show. `set null` on delete: losing the citation must not delete the draft.
   */
  evidenceId: uuid().references(() => evidence.id, { onDelete: "set null" }),
  strengthKeys: jsonb().$type<string[]>().notNull().default([]),

  createdAt: createdAt(),
  decidedAt: timestamp({ withTimezone: true }),
});

export type Draft = typeof drafts.$inferSelect;
export type NewDraft = typeof drafts.$inferInsert;
