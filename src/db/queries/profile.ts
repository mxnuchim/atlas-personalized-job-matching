import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import type { ProfileDocument } from "@/lib/profile-document";
import {
  evidence,
  profile,
  strengths,
  users,
  type Evidence,
  type Profile,
  type Strength,
} from "@/db/schema";

export type StrengthWithEvidence = Strength & { evidence: Evidence[] };
export type ProfileWithStrengths = Profile & { strengths: StrengthWithEvidence[] };

/**
 * A user's latest profile version with its strengths (highest weight first) and each
 * strength's evidence — the full context the scorer and drafter read (PRD §7 / §9).
 *
 * `userId` is required rather than optional. An optional owner is how "whose data is
 * this?" turns into a question nobody asks: the first caller that forgets silently
 * reads whichever profile happens to sort first.
 */
export async function getCurrentProfile(userId: string): Promise<ProfileWithStrengths | null> {
  const [current] = await db
    .select()
    .from(profile)
    .where(eq(profile.userId, userId))
    .orderBy(desc(profile.version))
    .limit(1);
  if (!current) return null;

  const strengthRows = await db.select().from(strengths).where(eq(strengths.profileId, current.id));

  const ids = strengthRows.map((s) => s.id);
  const evidenceRows = ids.length
    ? await db.select().from(evidence).where(inArray(evidence.strengthId, ids))
    : [];

  const byStrength = new Map<string, Evidence[]>();
  for (const item of evidenceRows) {
    const list = byStrength.get(item.strengthId);
    if (list) list.push(item);
    else byStrength.set(item.strengthId, [item]);
  }

  const withEvidence = strengthRows
    .map((s) => ({ ...s, evidence: byStrength.get(s.id) ?? [] }))
    .sort((a, b) => b.weight - a.weight);

  return { ...current, strengths: withEvidence };
}

/**
 * Every user who has a profile — the scorer's work list, one pass per profile, and the
 * address each person's own daily email goes to.
 */
export async function listProfileOwners(): Promise<
  { userId: string; profileId: string; email: string; name: string | null }[]
> {
  return db
    .selectDistinctOn([profile.userId], {
      userId: profile.userId,
      profileId: profile.id,
      email: users.email,
      name: users.name,
    })
    .from(profile)
    .innerJoin(users, eq(users.id, profile.userId))
    .orderBy(profile.userId, desc(profile.version));
}

/** The profile a match belongs to, for callers holding only an id. */
export async function getProfileById(profileId: string): Promise<Profile | null> {
  const [row] = await db.select().from(profile).where(eq(profile.id, profileId)).limit(1);
  return row ?? null;
}

/**
 * Write a profile document for a user.
 *
 * Two modes, and the difference is money:
 *
 *   - **In place** (default): the profile row keeps its id, so every existing match
 *     stays valid. Fixing a typo in a headline must not cost a re-score of 2,300 jobs.
 *   - **New version**: a new profile row, which means a new id, which means nothing is
 *     scored against it yet — the next run re-scores everything. That is the right
 *     behaviour when positioning genuinely changed, and the wrong default.
 *
 * Strengths and their evidence are replaced wholesale rather than diffed: the document
 * is the source of truth, and a partial merge would leave a strength the user deleted
 * still influencing their scores.
 */
export async function saveProfileDocument(
  userId: string,
  doc: ProfileDocument,
  options: { newVersion?: boolean } = {},
): Promise<{ profileId: string; version: number; rescored: boolean }> {
  const p = doc.profile;

  return db.transaction(async (tx) => {
    const [latest] = await tx
      .select({ id: profile.id, version: profile.version })
      .from(profile)
      .where(eq(profile.userId, userId))
      .orderBy(desc(profile.version))
      .limit(1);

    const createNew = !latest || options.newVersion === true;
    const version = latest ? (createNew ? latest.version + 1 : latest.version) : 1;

    const values = {
      userId,
      version,
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

    let profileId: string;
    if (createNew) {
      const [row] = await tx.insert(profile).values(values).returning({ id: profile.id });
      profileId = row.id;
    } else {
      await tx.update(profile).set(values).where(eq(profile.id, latest.id));
      profileId = latest.id;
    }

    // Replaced, not merged — a strength the user removed must stop counting.
    await tx.delete(strengths).where(eq(strengths.profileId, profileId));

    const inserted = await tx
      .insert(strengths)
      .values(
        doc.strengths.map((st) => ({
          profileId,
          key: st.key,
          label: st.label,
          kind: st.kind,
          weight: st.weight,
          summary: st.summary ?? null,
        })),
      )
      .returning({ id: strengths.id, key: strengths.key });

    const idByKey = new Map(inserted.map((st) => [st.key, st.id]));
    // Evidence pointing at a strength that does not exist is dropped, which the
    // importer warns about before saving rather than discovering here.
    const rows = doc.evidence
      .filter((e) => idByKey.has(e.strength_key))
      .map((e) => ({
        strengthId: idByKey.get(e.strength_key)!,
        claim: e.claim,
        context: e.context ?? null,
        metric: e.metric ?? null,
        source: e.source ?? null,
      }));
    if (rows.length > 0) await tx.insert(evidence).values(rows);

    return { profileId, version, rescored: createNew && Boolean(latest) };
  });
}
