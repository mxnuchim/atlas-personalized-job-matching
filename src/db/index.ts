import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env, isProduction } from "@/lib/env";

import * as schema from "./schema";

/**
 * Single Drizzle client over postgres.js — the one driver for both local Docker
 * Postgres and Neon (PRD §6 / §12). Cached on globalThis so dev HMR and script
 * re-entry don't open a new pool each time. `prepare: false` keeps it compatible
 * with Neon's pooled endpoint.
 */
const globalForDb = globalThis as unknown as {
  __atlasClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__atlasClient ??
  postgres(env.DATABASE_URL, {
    // One connection per instance in production. Serverless gives every concurrent
    // invocation its own pool, so a `max` above 1 multiplies by however many are warm
    // and exhausts a pooled endpoint's connection limit under trivial load.
    max: isProduction ? 1 : 10,
    prepare: false,
  });

if (!isProduction) globalForDb.__atlasClient = client;

export const db = drizzle(client, { schema, casing: "snake_case" });

export { client, schema };
