import { integer, jsonb, numeric, pgTable, timestamp } from "drizzle-orm/pg-core";

import { id } from "./columns";
import { runStatus } from "./enums";
import type { RunError } from "./json";

/** Per-run audit trail — counts, tokens, cost, errors — the observability spine (PRD §7 / §12). */
export const runs = pgTable("runs", {
  id: id(),
  startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp({ withTimezone: true }),
  jobsSeen: integer().notNull().default(0),
  newJobs: integer().notNull().default(0),
  scored: integer().notNull().default(0),
  drafted: integer().notNull().default(0),
  errors: jsonb().$type<RunError[]>().notNull().default([]),
  tokensIn: integer().notNull().default(0),
  tokensOut: integer().notNull().default(0),
  costUsd: numeric({ precision: 10, scale: 4 }).notNull().default("0"),
  status: runStatus().notNull().default("ok"),
});

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
