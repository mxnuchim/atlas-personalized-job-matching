import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { id, updatedAt } from "./columns";
import { outreachChannel, outreachStatus } from "./enums";
import { matches } from "./matches";

/**
 * A role's journey through the pipeline. Reply detection flips `status` to
 * `replied` and suppresses further contact (PRD §7 / §11).
 */
export const outreach = pgTable("outreach", {
  id: id(),
  matchId: uuid()
    .notNull()
    .references(() => matches.id, { onDelete: "cascade" }),
  channel: outreachChannel().notNull().default("email"),
  status: outreachStatus().notNull().default("drafted"),
  sentAt: timestamp({ withTimezone: true }),
  repliedAt: timestamp({ withTimezone: true }),
  /**
   * Kept for roles you mark as bounced by hand. Atlas cannot observe a bounce — it has
   * no access to the mailbox you send from — so nothing sets this automatically.
   */
  bouncedAt: timestamp({ withTimezone: true }),

  notes: text(),
  updatedAt: updatedAt(),
});

export type Outreach = typeof outreach.$inferSelect;
export type NewOutreach = typeof outreach.$inferInsert;
