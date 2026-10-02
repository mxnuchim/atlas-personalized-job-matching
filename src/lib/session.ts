import { redirect } from "next/navigation";
import type { Session } from "next-auth";

import { auth } from "@/auth";
import { getCurrentProfile, type ProfileWithStrengths } from "@/db/queries/profile";

/** Read the current session (or null). Safe in any Server Component / Server Action. */
export function getSession(): Promise<Session | null> {
  return auth();
}

/**
 * Enforce authentication server-side (PRD §6 / §12). Redirects to /login when
 * there is no session. Used by the authenticated layout and every mutating action.
 */
export async function requireSession(): Promise<Session> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return session;
}

/**
 * The signed-in user's current profile, or null when they have not seeded one.
 *
 * Every screen reads through this rather than reaching for "the" profile, which is
 * what keeps one person's matches out of another's queue. Null is a real state — a new
 * account has no profile until it is seeded — so pages render an empty state rather
 * than failing.
 */
export async function requireProfile(): Promise<{
  session: Session;
  profile: ProfileWithStrengths | null;
}> {
  const session = await requireSession();
  const profile = session.user?.id ? await getCurrentProfile(session.user.id) : null;
  return { session, profile };
}

/**
 * The acting user's profile id, or an error an action can return.
 *
 * Actions cannot redirect the way a page can, so this hands back a result instead of
 * throwing. Pair it with the `getOwned*` queries: together they make ownership part of
 * how a row is fetched rather than a rule each action has to remember.
 */
export async function actingProfileId(): Promise<
  { ok: true; profileId: string } | { ok: false; error: string }
> {
  const { profile } = await requireProfile();
  if (!profile) return { ok: false, error: "Set up your profile before using this." };
  return { ok: true, profileId: profile.id };
}

/**
 * The acting user's id — the owner of user-scoped rows (resumes), as `actingProfileId`
 * is for profile-scoped ones. A resume belongs to the person, not a profile version, so
 * a profile re-import never touches it.
 *
 * Named, rather than read off the session inline, so every action visibly establishes
 * whose rows it may touch — `authorization.test.ts` requires one of the two in each
 * action file. Pair it with `getOwned*(id, userId)` fetches.
 */
export async function actingUserId(): Promise<string> {
  const session = await requireSession();
  return session.user.id;
}
