import { pgTable, text } from "drizzle-orm/pg-core";

import { createdAt, id, updatedAt } from "./columns";
import { userRole } from "./enums";

/**
 * The single application user. Login is email + password (Argon2id hash);
 * sessions are JWT cookies, so there are no Auth.js adapter tables.
 */
export const users = pgTable("users", {
  id: id(),
  email: text().notNull().unique(),
  passwordHash: text().notNull(),
  name: text(),
  role: userRole().notNull().default("owner"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
