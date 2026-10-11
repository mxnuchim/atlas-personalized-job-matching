import { index, integer, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";

import { createdAt } from "./columns";
import { matches } from "./matches";
import { profile } from "./profile";

/**
 * The day's picks, fixed once chosen.
 *
 * Today used to recompute "the best N you haven't acted on" on every load — so finishing
 * one role pulled the next one in, and the list never ended. A day's set is now chosen
 * once (by the morning run, or the first view if the run hasn't happened) and stored;
 * acting on a role marks progress against it instead of replacing it. Tomorrow is a new
 * set. `day` is the queue day (`queueDay`), which starts at the run hour, not midnight.
 */
export const dailyPicks = pgTable(
  "daily_picks",
  {
    profileId: uuid()
      .notNull()
      .references(() => profile.id, { onDelete: "cascade" }),
    day: text().notNull(),
    /** nigeria · global */
    lane: text().notNull(),
    matchId: uuid()
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.day, t.matchId] }),
    index("daily_picks_profile_day_lane_idx").on(t.profileId, t.day, t.lane),
  ],
);
