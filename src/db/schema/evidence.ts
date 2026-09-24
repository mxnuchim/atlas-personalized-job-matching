import { pgTable, text, uuid } from "drizzle-orm/pg-core";

import { createdAt, id } from "./columns";
import { strengths } from "./strengths";

/**
 * Concrete proof points tagged by strength. The drafter pulls from here so
 * outreach cites real achievements, never generic enthusiasm (PRD §7 / §9C).
 */
export const evidence = pgTable("evidence", {
  id: id(),
  strengthId: uuid()
    .notNull()
    .references(() => strengths.id, { onDelete: "cascade" }),
  claim: text().notNull(),
  context: text(),
  metric: text(),
  source: text(),
  createdAt: createdAt(),
});

export type Evidence = typeof evidence.$inferSelect;
export type NewEvidence = typeof evidence.$inferInsert;
