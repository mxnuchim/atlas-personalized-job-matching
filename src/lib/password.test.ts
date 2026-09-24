import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

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
