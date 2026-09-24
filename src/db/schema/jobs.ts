import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { id } from "./columns";
import { sources } from "./sources";

/**
 * A normalized job posting. `(source_id, external_id)` is the idempotency key:
 * re-ingesting a posting is a no-op (PRD §7 / §8).
 */
export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    sourceId: uuid()
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    externalId: text().notNull(),
    title: text().notNull(),
    company: text().notNull(),
    location: text(),
    remote: boolean().notNull().default(false),
    url: text().notNull(),
    description: text().notNull().default(""),
    postedAt: timestamp({ withTimezone: true }),
    firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    raw: jsonb().$type<Record<string, unknown>>(),
  },
  (t) => [
    uniqueIndex("jobs_source_external_uq").on(t.sourceId, t.externalId),
    index("jobs_company_idx").on(t.company),
  ],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
