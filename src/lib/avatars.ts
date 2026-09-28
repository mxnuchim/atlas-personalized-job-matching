/**
 * Which committed portrait stands in for a user, by email. A small static map, not a
 * `users.image` column: these are two known people with repo-committed photos, so a
 * table field + upload flow would be machinery for nothing. Feeds the existing
 * `Avatar` component's `image` prop; unknown emails return null and fall back to its
 * name-derived initials tile.
 *
 * Client-safe (no secrets, no server-only).
 */
const AVATARS: Record<string, string> = {
  "manuchimoliver779@gmail.com": "/avatars/manuchim.jpeg",
  "alabiamazingrace3@gmail.com": "/avatars/anwuri.jpg",
};

export function avatarFor(email?: string | null): string | null {
  if (!email) return null;
  return AVATARS[email.toLowerCase()] ?? null;
}
