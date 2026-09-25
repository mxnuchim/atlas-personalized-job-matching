import { desc, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  evidence,
  profile,
  strengths,
  type Evidence,
  type Profile,
  type Strength,
} from "@/db/schema";

export type StrengthWithEvidence = Strength & { evidence: Evidence[] };
export type ProfileWithStrengths = Profile & { strengths: StrengthWithEvidence[] };

/**
 * The latest profile version with its strengths (highest weight first) and each
 * strength's evidence — the full context the scorer and drafter read (PRD §7 / §9).
 */
export async function getCurrentProfile(): Promise<ProfileWithStrengths | null> {
  const [current] = await db.select().from(profile).orderBy(desc(profile.version)).limit(1);
  if (!current) return null;

  const strengthRows = await db
    .select()
    .from(strengths)
    .where(eq(strengths.profileVersion, current.version));

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
