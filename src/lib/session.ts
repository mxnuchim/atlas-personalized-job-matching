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
