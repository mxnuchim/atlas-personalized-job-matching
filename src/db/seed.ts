import "./_bootstrap";

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { hashPassword } from "@/lib/password";

import { sources, users, type NewSource } from "./schema";

/**
 * A starter source so the pipeline has something to ingest out of the box. It's a
 * public, ToS-clean Greenhouse board; swap or add sources later (in-app editing
 * arrives in a later milestone). Seeded only when absent, so it's safe to re-run.
 */
const DEMO_SOURCE: NewSource = {
  name: "Vercel",
  kind: "greenhouse",
  config: { board: "vercel", company: "Vercel" },
  enabled: true,
};

/**
 * Seeds the single application user from env, plus a starter source. Idempotent:
 * re-running updates the user's password hash rather than creating duplicates, and
 * leaves an existing source untouched. Never logs the plaintext password.
 *
 * This script is self-contained (its own connection, reading process.env directly)
 * so it doesn't import the app's `server-only`-guarded env/db modules, which throw
 * when loaded outside a React Server Component.
 */
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const email = process.env.AUTH_USER_EMAIL;
  const password = process.env.AUTH_USER_PASSWORD;
  const name = process.env.AUTH_USER_NAME ?? "Atlas";

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  if (!email || !password) {
    throw new Error(
      "Set AUTH_USER_EMAIL and AUTH_USER_PASSWORD in .env.local before running db:seed.",
    );
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql, { casing: "snake_case" });

  const normalizedEmail = email.toLowerCase();
  const passwordHash = await hashPassword(password);

  await db
    .insert(users)
    .values({ email: normalizedEmail, passwordHash, name, role: "owner" })
    .onConflictDoUpdate({
      target: users.email,
      set: { passwordHash, name, updatedAt: new Date() },
    });

  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, normalizedEmail));

  console.info(`✓ Seeded user ${user.email} (${user.id})`);

  const [existingSource] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.name, DEMO_SOURCE.name))
    .limit(1);

  if (existingSource) {
    console.info(`• Source "${DEMO_SOURCE.name}" already present — left as is`);
  } else {
    await db.insert(sources).values(DEMO_SOURCE);
    console.info(`✓ Seeded source "${DEMO_SOURCE.name}" (${DEMO_SOURCE.kind})`);
  }

  await sql.end();
}

main().catch((error) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
