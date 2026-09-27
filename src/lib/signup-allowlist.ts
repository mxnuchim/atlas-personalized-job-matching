/**
 * Who may create an account.
 *
 * Pure and free of `server-only` so the rule is testable directly, and so the login
 * and signup screens can ask the same question the action enforces.
 */

/** Parse the comma-separated env value. Unset or empty means signup is closed. */
export function parseAllowlist(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function signupOpen(value: string | undefined): boolean {
  return parseAllowlist(value).length > 0;
}

/**
 * Case-insensitive, whitespace-tolerant. Emails are compared lowercased because that
 * is how they are stored, and a mismatch here would read to the user as "my own
 * address is not allowed".
 */
export function emailAllowed(email: string, value: string | undefined): boolean {
  const list = parseAllowlist(value);
  return list.includes(email.trim().toLowerCase());
}
