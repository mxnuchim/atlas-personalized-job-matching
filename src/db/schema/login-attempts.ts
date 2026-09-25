import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { id } from "./columns";

/**
 * Failed login attempts, for throttling. Kept in Postgres rather than in memory on
 * purpose: on a serverless deploy each instance has its own memory, so an in-memory
 * counter is bypassed simply by landing on a different lambda. One row per failure,
 * swept as they age out of the window.
 *
 * Only failures are recorded — a successful login clears the key — so this is a
 * throttle, not an access log.
 */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: id(),
    /** What is being throttled: `ip:1.2.3.4` or `email:someone@example.com`. */
    key: text().notNull(),
    attemptedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("login_attempts_key_time_idx").on(t.key, t.attemptedAt)],
);

export type LoginAttempt = typeof loginAttempts.$inferSelect;
export type NewLoginAttempt = typeof loginAttempts.$inferInsert;
