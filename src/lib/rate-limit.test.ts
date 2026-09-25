import { describe, expect, it } from "vitest";

import { clientIp, throttleKeys } from "./rate-limit";

/**
 * The counting itself needs a database and is covered by an integration check; these
 * cover the key derivation, which is where the security properties actually live.
 */

const req = (headers: Record<string, string>) =>
  new Request("https://atlas.test/login", { headers });

describe("clientIp", () => {
  it("takes the left-most entry of x-forwarded-for — the original client", () => {
    // Everything after the first entry is a proxy that handled the request.
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9, 70.41.3.18, 150.172.238.178" }))).toBe(
      "203.0.113.9",
    );
  });

  it("trims whitespace around the entry", () => {
    expect(clientIp(req({ "x-forwarded-for": "  203.0.113.9  , 70.41.3.18" }))).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("returns null rather than a bogus key when no header is present", () => {
    expect(clientIp(req({}))).toBeNull();
    expect(clientIp(undefined)).toBeNull();
  });

  it("returns null for an empty header instead of keying on the empty string", () => {
    // `ip:` would otherwise become one shared bucket for every header-less caller.
    expect(clientIp(req({ "x-forwarded-for": "" }))).toBeNull();
    expect(clientIp(req({ "x-forwarded-for": "   " }))).toBeNull();
  });
});

describe("throttleKeys", () => {
  it("always includes the email key, so a distributed attempt still counts", () => {
    expect(throttleKeys("Person@Example.com", null)).toEqual(["email:person@example.com"]);
  });

  it("normalises the email so case and padding cannot split the bucket", () => {
    expect(throttleKeys("  PERSON@example.COM ", null)).toEqual(["email:person@example.com"]);
  });

  it("counts email and IP independently when both are known", () => {
    // Either being over its limit refuses the request; neither alone is sufficient —
    // email-only lets anyone lock out the real user, IP-only is trivially distributed.
    expect(throttleKeys("person@example.com", "203.0.113.9")).toEqual([
      "email:person@example.com",
      "ip:203.0.113.9",
    ]);
  });
});
