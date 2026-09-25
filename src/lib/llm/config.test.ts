import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `config.ts` reads env at import, so each case re-imports the module with the env it
 * needs. `vitest.config.ts` sets SKIP_ENV_VALIDATION, so no real secret is involved.
 *
 * `./errors` is re-imported from the same fresh module graph — after `resetModules`
 * a statically imported class is a *different* identity, so `instanceof` would fail
 * against an error the reloaded config threw.
 */
async function loadConfig(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const [config, errors] = await Promise.all([import("./config"), import("./errors")]);
  return { ...config, LlmConfigError: errors.LlmConfigError };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const PROVIDERS = [
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", model: "claude-sonnet-5" },
  { provider: "openai", envVar: "OPENAI_API_KEY", model: "gpt-5-mini" },
  { provider: "google", envVar: "GEMINI_API_KEY", model: "gemini-3.8-flash" },
  { provider: "groq", envVar: "GROQ_API_KEY", model: "qwen/qwen3.8-27b" },
] as const;

describe("resolveModel", () => {
  it.each(PROVIDERS)(
    "resolves a model for $provider when its key is set",
    async ({ provider, envVar, model }) => {
      const { resolveModel } = await loadConfig({
        LLM_PROVIDER: provider,
        [envVar]: "test-key-not-real",
      });

      const handle = resolveModel(model);
      expect(handle).toBeDefined();
      expect(typeof handle === "string" ? handle : handle.modelId).toBe(model);
    },
  );

  it.each(PROVIDERS)(
    "throws a typed config error for $provider when its key is missing",
    async ({ provider, envVar }) => {
      const { resolveModel, LlmConfigError } = await loadConfig({ LLM_PROVIDER: provider });

      expect(() => resolveModel("some-model")).toThrow(LlmConfigError);
      // The message has to name the variable to set — a bare "not configured" is useless.
      expect(() => resolveModel("some-model")).toThrow(envVar);
    },
  );
});

describe("MODELS", () => {
  it("reads both slots from env", async () => {
    const { MODELS } = await loadConfig({
      MODEL_SCORING: "model-a",
      MODEL_DRAFTING: "model-b",
    });
    expect(MODELS).toEqual({ scoring: "model-a", drafting: "model-b" });
  });

  it("falls back to the schema defaults", async () => {
    const { MODELS, PROVIDER } = await loadConfig({});
    expect(PROVIDER).toBe("openai");
    expect(MODELS.scoring).toBe("gpt-5-mini");
    expect(MODELS.drafting).toBe("gpt-5-mini");
  });
});

describe("configuredProviders", () => {
  it("lists only providers that actually have a key", async () => {
    const { configuredProviders } = await loadConfig({
      GEMINI_API_KEY: "g",
      GROQ_API_KEY: "q",
    });
    expect(configuredProviders().sort()).toEqual(["google", "groq"]);
  });
});

describe("supportsExplicitCacheControl", () => {
  it("is true only for providers that need to be asked to cache", async () => {
    const { supportsExplicitCacheControl } = await loadConfig({});
    expect(supportsExplicitCacheControl("anthropic")).toBe(true);
    expect(supportsExplicitCacheControl("google")).toBe(false);
    expect(supportsExplicitCacheControl("openai")).toBe(false);
  });
});
