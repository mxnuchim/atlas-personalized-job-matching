import "./_bootstrap";

import { readdirSync } from "node:fs";
import { join } from "node:path";

import postgres from "postgres";

/**
 * Which migrations has this database actually had?
 *
 * Written after a whole evening of diagnosing React error 441 one page at a time.
 * Every failing page turned out to reference a column from an unapplied migration, but
 * the production error is masked, so each one looked like a fresh mystery. This answers
 * the question directly, against whichever database `DATABASE_URL` points at.
 *
 * Read-only and self-contained — its own connection, no `server-only` modules — so it
 * is safe to run against production.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");

  const onDisk = readdirSync(join(process.cwd(), "drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const sql = postgres(url, { max: 1 });

  let applied: { created_at: string }[] = [];
  try {
    applied = await sql`
      select created_at from drizzle.__drizzle_migrations order by created_at asc
    `;
  } catch {
    // No migrations table at all: nothing has ever been applied here.
    applied = [];
  }

  const host = new URL(url).host;
  console.info(`\nDatabase: ${host}`);
  console.info(`Migrations on disk:  ${onDisk.length}`);
  console.info(`Migrations applied:  ${applied.length}\n`);

  onDisk.forEach((file, index) => {
    const done = index < applied.length;
    console.info(`  ${done ? "✓" : "✗"} ${file}${done ? "" : "   NOT APPLIED"}`);
  });

  const missing = onDisk.length - applied.length;
  if (missing > 0) {
    console.info(
      `\n${missing} migration${missing === 1 ? "" : "s"} pending. Run:\n` +
        `  DATABASE_URL="…" npm run db:migrate\n\n` +
        `Until then, any page touching a column from those migrations fails — in\n` +
        `production that surfaces as React error 441 with the real message stripped.\n`,
    );
  } else {
    console.info("\nUp to date.\n");
  }

  await sql.end();
  process.exit(missing > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Could not read migration status:", error instanceof Error ? error.message : error);
  process.exit(1);
});
