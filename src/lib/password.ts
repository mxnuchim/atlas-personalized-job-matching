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

/**
 * A real Argon2id hash of a random string, with the same cost parameters as
 * `hashPassword`. Verify against this when no user matches, so a wrong email costs the
 * same ~50ms as a wrong password — otherwise the difference is a timing oracle that
 * reveals which addresses exist.
 *
 * `verifyPassword` swallows malformed hashes, so a typo here would silently do nothing.
 * `password.test.ts` asserts it is genuinely well-formed and cost-matched.
 */
export const DECOY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$9kd9BEaNrfRiqbwr9ZoA0Q$Pfh4uAGWlufSSnPWC8O8SLeo3Jo1njK3oqw9Ag4Ikcc";

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
