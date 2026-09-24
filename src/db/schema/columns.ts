import { timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Reusable column builders. Column names come from the property key + the
 * `snake_case` casing configured on the client and drizzle-kit, so these stay
 * name-agnostic. `timestamptz` is used everywhere per PRD §7.
 */

export const id = () => uuid().primaryKey().defaultRandom();

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
