import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `env.ts` parses at import, so each case needs a fresh module graph with
 * `process.env` already set the way the case describes.
 */
const REQUIRED = {
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  AUTH_SECRET: "not-a-real-secret-but-long-enough",
};

async function loadWith(vars: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries({ ...REQUIRED, ...vars })) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
  return (await import("./env")).env;
}

beforeEach(() => vi.unstubAllEnvs());
afterEach(() => vi.unstubAllEnvs());

describe("env", () => {
  it("applies defaults when a variable is absent", async () => {
    // Not LOG_LEVEL: `vitest.config` sets it to "silent" to quiet pino, so it is not
    // absent here. The blank case below covers its default.
    const env = await loadWith({});
    expect(env.LLM_MAX_CONCURRENCY).toBe(3);
    expect(env.DAILY_QUEUE_SIZE).toBe(20);
    expect(env.MAX_PER_COMPANY).toBe(4);
  });

  it("treats a blank variable exactly like an absent one", async () => {
    // Every hosting dashboard sets a field you left empty to "", not absent — and
    // Zod's .default() only fires on absent. An empty LOG_LEVEL used to report
    // "Invalid option", and an empty numeric coerced through Number("") to 0 and
    // reported "too small", naming a value nobody typed.
    const env = await loadWith({
      LOG_LEVEL: "",
      LLM_MAX_CONCURRENCY: "",
      LLM_REQUEST_TIMEOUT_MS: "",
      LOGIN_MAX_ATTEMPTS: "",
      LOGIN_WINDOW_MINUTES: "",
      DAILY_QUEUE_SIZE: "",
    });

    expect(env.LOG_LEVEL).toBe("info");
    expect(env.LLM_MAX_CONCURRENCY).toBe(3);
    expect(env.LLM_REQUEST_TIMEOUT_MS).toBe(60_000);
    expect(env.LOGIN_MAX_ATTEMPTS).toBe(10);
    expect(env.DAILY_QUEUE_SIZE).toBe(20);
  });

  it("treats a blank optional as unset rather than invalid", async () => {
    // "" is not a valid email, so an empty AUTH_USER_EMAIL failed the whole parse.
    const env = await loadWith({ AUTH_USER_EMAIL: "", NOTIFY_EMAIL_TO: "" });
    expect(env.AUTH_USER_EMAIL).toBeUndefined();
    expect(env.NOTIFY_EMAIL_TO).toBeUndefined();
  });

  it("treats whitespace as blank", async () => {
    const env = await loadWith({ LOG_LEVEL: "   " });
    expect(env.LOG_LEVEL).toBe("info");
  });

  it("still honours a real value", async () => {
    const env = await loadWith({ LOG_LEVEL: "debug", LLM_MAX_CONCURRENCY: "6" });
    expect(env.LOG_LEVEL).toBe("debug");
    expect(env.LLM_MAX_CONCURRENCY).toBe(6);
  });

  it("trims a padded value rather than passing it through", async () => {
    // A value pasted into a dashboard often carries a trailing space. `TZ="UTC "`
    // passes z.string() and then throws RangeError inside Intl, which reaches the
    // browser as a minified React error with the message stripped.
    const env = await loadWith({ TZ: "  UTC  ", LOG_LEVEL: " debug " });
    expect(env.APP_TZ).toBe("UTC");
    expect(env.LOG_LEVEL).toBe("debug");
  });

  it("falls back to TZ, which is what a local .env actually sets", async () => {
    // Hosts reserve `TZ` (it is POSIX), so deployments must use APP_TZ — but a local
    // .env and every shell habit says TZ. Both work, APP_TZ wins.
    expect((await loadWith({ TZ: "Africa/Lagos" })).APP_TZ).toBe("Africa/Lagos");
    expect((await loadWith({ TZ: "Africa/Lagos", APP_TZ: "UTC" })).APP_TZ).toBe("UTC");
  });

  it("rejects a timezone the runtime cannot use", async () => {
    // Fail at boot with a message, not at render with a masked error.
    await expect(loadWith({ APP_TZ: "WAT" })).rejects.toThrow(/Invalid environment/);
    await expect(loadWith({ APP_TZ: "GMT+1" })).rejects.toThrow(/Invalid environment/);
  });

  it("accepts real IANA zones", async () => {
    expect((await loadWith({ APP_TZ: "Africa/Lagos" })).APP_TZ).toBe("Africa/Lagos");
    expect((await loadWith({ APP_TZ: "UTC" })).APP_TZ).toBe("UTC");
  });

  it("still rejects a genuinely invalid value", async () => {
    // Blank-tolerance must not become "accept anything".
    await expect(loadWith({ LOG_LEVEL: "loud" })).rejects.toThrow(/Invalid environment/);
  });
});
