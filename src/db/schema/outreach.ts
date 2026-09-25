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
  bouncedAt: timestamp({ withTimezone: true }),

  /**
   * How a send is followed up. A reply lands in the same Gmail thread, so the thread id
   * is the correlation key — without it there is no way to tell a reply to *this*
   * outreach from any other message in the mailbox.
   */
  gmailThreadId: text(),
  gmailMessageId: text(),
  notes: text(),
  updatedAt: updatedAt(),
});

export type Outreach = typeof outreach.$inferSelect;
export type NewOutreach = typeof outreach.$inferInsert;
