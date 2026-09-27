import "./_bootstrap";

import { readFileSync } from "node:fs";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";

import { evidence, profile, strengths, users } from "./schema";

/**
 * Seeds `profile` / `strengths` / `evidence` from the ```json block in the
 * candidate profile doc (PRD §7). The doc is the single source of truth — edit
 * weights or evidence there and re-run; this is idempotent per `profile.version`
 * (strengths+evidence for that version are replaced, the profile row upserted).
 *
 * Self-contained (own connection, direct process.env) to avoid the app's
 * `server-only`-guarded modules, which throw outside a React Server Component.
 */
const DEFAULT_DOC = "atlas-candidate-profile.md";

const seedSchema = z.object({
  profile: z.object({
    version: z.number().int().positive(),
    headline: z.string().min(1),
    name: z.string().min(1).nullish(),
    portfolio_url: z.string().min(1).nullish(),
    target_roles: z.array(z.string()).default([]),
    seniority: z.string().nullish(),
    locations: z.array(z.string()).default([]),
    relocation: z.boolean().default(false),
    dealbreakers: z.array(z.string()).default([]),
    cv_text: z.string().nullish(),
  }),
  strengths: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        kind: z.enum(["core", "differentiator"]),
        weight: z.number().int().min(1).max(10),
        summary: z.string().nullish(),
      }),
    )
    .min(1),
  evidence: z
    .array(
      z.object({
        strength_key: z.string().min(1),
        claim: z.string().min(1),
        context: z.string().nullish(),
        metric: z.string().nullish(),
        source: z.string().nullish(),
      }),
    )
    .default([]),
});

function extractSeedJson(docPath: string) {
  const markdown = readFileSync(docPath, "utf8");
  const match = markdown.match(/```json\s*([\s\S]*?)```/);
  if (!match) {
    throw new Error(`No \`\`\`json block found in ${docPath}`);
  }
  return seedSchema.parse(JSON.parse(match[1]));
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const docPath = path.resolve(process.cwd(), process.argv[2] ?? DEFAULT_DOC);
  const data = extractSeedJson(docPath);

  // Referential sanity before we touch the DB.
  const strengthKeys = new Set(data.strengths.map((s) => s.key));
  for (const item of data.evidence) {
    if (!strengthKeys.has(item.strength_key)) {
      throw new Error(`Evidence references unknown strength_key "${item.strength_key}".`);
    }
  }

  const p = data.profile;
  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql, { casing: "snake_case" });

  // The profile belongs to someone. Seeding picks the user by AUTH_USER_EMAIL, the
  // same address `db:seed` created, rather than guessing at "the only user" — which
  // stops being true the moment a second person signs up.
  const ownerEmail = process.env.AUTH_USER_EMAIL?.toLowerCase();
  if (!ownerEmail) {
    throw new Error("Set AUTH_USER_EMAIL — it names which user this profile belongs to.");
  }

  const [owner] = await db.select({ id: users.id }).from(users).where(eq(users.email, ownerEmail));
  if (!owner) {
    throw new Error(`No user with email ${ownerEmail}. Run npm run db:seed first.`);
  }

  await db.transaction(async (tx) => {
    const profileValues = {
      userId: owner.id,
      version: p.version,
      headline: p.headline,
      name: p.name ?? null,
      portfolioUrl: p.portfolio_url ?? null,
      targetRoles: p.target_roles,
      seniority: p.seniority ?? null,
      locations: p.locations,
      relocation: p.relocation,
      dealbreakers: p.dealbreakers,
      cvText: p.cv_text ?? null,
    };

    await tx
      .insert(profile)
      .values(profileValues)
      .onConflictDoUpdate({ target: [profile.userId, profile.version], set: profileValues });

    const [saved] = await tx
      .select({ id: profile.id })
      .from(profile)
      .where(and(eq(profile.userId, owner.id), eq(profile.version, p.version)))
      .limit(1);

    // Replace this version's strengths (cascades to their evidence), then reinsert.
    await tx.delete(strengths).where(eq(strengths.profileId, saved.id));

    const insertedStrengths = await tx
      .insert(strengths)
      .values(
        data.strengths.map((s) => ({
          profileId: saved.id,
          key: s.key,
          label: s.label,
          kind: s.kind,
          weight: s.weight,
          summary: s.summary ?? null,
        })),
      )
      .returning({ id: strengths.id, key: strengths.key });

    const idByKey = new Map(insertedStrengths.map((s) => [s.key, s.id]));

    if (data.evidence.length > 0) {
      await tx.insert(evidence).values(
        data.evidence.map((e) => ({
          strengthId: idByKey.get(e.strength_key)!,
          claim: e.claim,
          context: e.context ?? null,
          metric: e.metric ?? null,
          source: e.source ?? null,
        })),
      );
    }
  });

  console.info(
    `✓ Seeded profile v${p.version}: ${data.strengths.length} strengths, ${data.evidence.length} evidence (from ${path.basename(docPath)})`,
  );
  await sql.end();
}

main().catch((error) => {
  console.error("Profile seed failed:", error);
  process.exit(1);
});
