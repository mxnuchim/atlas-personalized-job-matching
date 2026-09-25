import { describe, expect, it } from "vitest";

import { DECOY_HASH, hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
    expect(await verifyPassword(hash, "not the password")).toBe(false);
  }, 15_000);

  it("treats a malformed hash as a non-match instead of throwing", async () => {
    expect(await verifyPassword("not-a-real-hash", "anything")).toBe(false);
  });
});

describe("DECOY_HASH", () => {
  it("is a well-formed argon2id hash with the same cost as hashPassword", async () => {
    // verifyPassword swallows malformed hashes, so a typo here would silently turn the
    // timing mitigation into a no-op. Check the shape explicitly.
    expect(DECOY_HASH).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[^$]+\$[^$]+$/);

    const real = await hashPassword("some-real-password");
    expect(DECOY_HASH.split("$").slice(1, 4)).toEqual(real.split("$").slice(1, 4));
  });

  it("verifies false for any password, and takes real work to do it", async () => {
    const started = performance.now();
    await expect(verifyPassword(DECOY_HASH, "anything at all")).resolves.toBe(false);
    // A malformed hash would reject instantly; a real argon2id verify cannot.
    expect(performance.now() - started).toBeGreaterThan(1);
  });
});
