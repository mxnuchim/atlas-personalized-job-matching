import { boolean, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { createdAt, id } from "./columns";
import { sourceKind } from "./enums";
import type { SourceConfig } from "./json";

/** A job-board connection Atlas ingests from (PRD §7). */
export const sources = pgTable("sources", {
  id: id(),
  name: text().notNull(),
  kind: sourceKind().notNull(),
  config: jsonb().$type<SourceConfig>().notNull().default({}),
  enabled: boolean().notNull().default(true),
  createdAt: createdAt(),
});

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
