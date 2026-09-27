import { boolean, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { createdAt, id } from "./columns";
import { sourceKind } from "./enums";
import type { SourceConfig } from "./json";
import { users } from "./users";

/**
 * A job-board connection Atlas ingests from (PRD §7).
 *
 * `enabled` used to carry three unrelated questions at once — can we read this board,
 * should we spend a call on it today, and does anyone want it — which is why one
 * person switching a board off silently changed everyone's corpus. They are separated
 * here:
 *
 *   - **Capability** is `kind` + `config`: whether a fetcher exists and is configured.
 *   - **Health** is `consecutive_failures` and the timestamps, written only by the
 *     pipeline. Nobody's opinion; a board that keeps failing quarantines itself.
 *   - **Intent** is `enabled`, plus who set it and when — so a board being off is a
 *     fact with an author rather than an unexplained switch.
 *
 * Per-user subscriptions are the eventual shape, and deliberately not built yet: two
 * people who mostly want the same boards do not need a tenancy model. The attribution
 * columns are what make the shared flag honest in the meantime.
 */
export const sources = pgTable("sources", {
  id: id(),
  name: text().notNull(),
  kind: sourceKind().notNull(),
  config: jsonb().$type<SourceConfig>().notNull().default({}),
  enabled: boolean().notNull().default(true),

  /** Who last turned this off, and when. Null while it has never been disabled. */
  disabledBy: uuid().references(() => users.id, { onDelete: "set null" }),
  disabledAt: timestamp({ withTimezone: true }),

  /** Health, written by ingest only. See `pipeline/source-health.ts`. */
  lastOkAt: timestamp({ withTimezone: true }),
  lastErrorAt: timestamp({ withTimezone: true }),
  lastError: text(),
  consecutiveFailures: integer().notNull().default(0),

  createdAt: createdAt(),
});

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
