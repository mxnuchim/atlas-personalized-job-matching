import "./_bootstrap";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { sources } from "./schema";
import { SOURCE_CATALOGUE } from "./sources.catalogue";

/**
 * Loads the verified source catalogue (PRD §7). Idempotent and safe to re-run: an
 * existing source is matched by name and has its kind and config refreshed, so fixing
 * a wrong board token is a re-run rather than a migration.
 *
 * `enabled` is deliberately never overwritten on update. Turning a noisy board off is
 * a decision this script has no business reversing.
 *
 * Self-contained — its own connection, reading `process.env` directly — so it does not
 * import the `server-only`-guarded env/db modules, which throw outside a React Server
 * Component. Same shape as `seed.ts`.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql, { casing: "snake_case" });

  let inserted = 0;
  let updated = 0;

  for (const entry of SOURCE_CATALOGUE) {
    // `region`/`sector` are documentation in the catalogue file, not columns — so the
    // row is built explicitly rather than by stripping them off.
    const row = {
      name: entry.name,
      kind: entry.kind,
      config: entry.config,
      enabled: entry.enabled,
    };

    const [existing] = await db
      .select({ id: sources.id })
      .from(sources)
      .where(eq(sources.name, row.name))
      .limit(1);

    if (existing) {
      await db
        .update(sources)
        .set({ kind: row.kind, config: row.config })
        .where(eq(sources.id, existing.id));
      updated += 1;
    } else {
      await db.insert(sources).values(row);
      inserted += 1;
    }
  }

  const byKind = SOURCE_CATALOGUE.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.kind] = (acc[entry.kind] ?? 0) + 1;
    return acc;
  }, {});

  console.info(`✓ Sources: ${inserted} added, ${updated} refreshed`);
  console.info(
    `  ${Object.entries(byKind)
      .map(([kind, count]) => `${kind}=${count}`)
      .join("  ")}`,
  );

  await sql.end();
}

main().catch((error) => {
  console.error("Source seed failed:", error);
  process.exit(1);
});
