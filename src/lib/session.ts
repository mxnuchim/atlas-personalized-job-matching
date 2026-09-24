import { redirect } from "next/navigation";
import type { Session } from "next-auth";

import { auth } from "@/auth";

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
