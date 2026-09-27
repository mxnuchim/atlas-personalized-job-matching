import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
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
