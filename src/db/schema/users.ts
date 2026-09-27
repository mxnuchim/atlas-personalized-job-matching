import { pgTable, text } from "drizzle-orm/pg-core";

import { createdAt, id, updatedAt } from "./columns";
import { userRole } from "./enums";

/**
 * An application user. Login is email + password (Argon2id hash); sessions are JWT
 * cookies, so there are no Auth.js adapter tables.
 *
 * Everything a user owns hangs off `profile`, which carries the `user_id` — so a
 * match, draft or outreach row is scoped transitively rather than by a denormalised
 * column that can drift from it.
 */
export const users = pgTable("users", {
  id: id(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  name: text(),
  /** Avatar for the sign-in picker. Null falls back to initials on a derived colour. */
  image: text(),
  role: userRole().notNull().default("owner"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
