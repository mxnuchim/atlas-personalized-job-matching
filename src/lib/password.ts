import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id password hashing. OWASP-aligned parameters; runs in the Node runtime
 * only (kept external from the bundle in next.config.ts).
 */
const ARGON2_OPTIONS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain, ARGON2_OPTIONS);
  } catch {
    // A malformed stored hash should read as "does not match", never throw into auth.
    return false;
  }
}
