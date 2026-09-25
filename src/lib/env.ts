import "server-only";

import { z } from "zod";

/**
 * Typed, validated configuration (PRD §12). Parsed once at import. Secrets are
 * server-only; nothing here is exposed to the client. Values required at M0 fail
 * fast; later-milestone values are optional so the app boots without them.
 */

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Required at M0
  DATABASE_URL: z.url(),
  AUTH_SECRET: z.string().min(1, "AUTH_SECRET is required (openssl rand -base64 32)"),
  APP_URL: z.url().default("http://localhost:3000"),

  // Seed-only (consumed by npm run db:seed; validated there too)
  AUTH_USER_EMAIL: z.email().optional(),
  AUTH_USER_PASSWORD: z.string().min(8).optional(),
  AUTH_USER_NAME: z.string().optional(),

  // Pipeline trigger (M1+): guards POST /api/pipeline/run
  PIPELINE_TRIGGER_SECRET: z.string().optional(),

  // M2 — scoring & drafting. Provider-agnostic: src/lib/llm resolves these and is
  // the only module that reads an API key or knows a provider exists (PRD §12).
  LLM_PROVIDER: z.enum(["anthropic", "openai", "google", "groq"]).default("openai"),
  MODEL_SCORING: z.string().default("gpt-5-mini"),
  MODEL_DRAFTING: z.string().default("gpt-5-mini"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  /** Parallel LLM calls per run. Keeps a 50-job run off the provider's rate limit. */
  LLM_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),
  /** Retries *after* the first attempt, per call. */
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /**
   * Per-call wall clock. Without one a hung provider connection stalls a whole run —
   * observed in practice: two calls hung ~15 minutes before the socket gave up.
   */
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(60_000),

  // Login throttle (§11-adjacent: protects the account, and the 19 MiB each Argon2
  // verify allocates makes unbounded attempts a cheap denial-of-service too).
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(3).max(100).default(10),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

  /**
   * Where the "N new matches" run notification goes (PRD §8 step 7). Any endpoint that
   * takes a POST: Slack, Discord, ntfy, or your own. Unset = no notification.
   */
  NOTIFY_WEBHOOK_URL: z.url().optional(),

  // Ops
  TZ: z.string().default("UTC"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Placeholders for the hard-required keys so `next build` can run in CI without real
 * secrets. We still parse through the real schema rather than casting `process.env`,
 * so every default (models, caps, log level) is applied and the types stay honest.
 */
const BUILD_PLACEHOLDERS = {
  DATABASE_URL: "postgres://build:build@localhost:5432/build",
  AUTH_SECRET: "build-only-placeholder-not-a-real-secret",
} as const;

function loadEnv(): Env {
  const skipValidation =
    process.env.SKIP_ENV_VALIDATION === "1" || process.env.SKIP_ENV_VALIDATION === "true";

  const source = skipValidation ? { ...BUILD_PLACEHOLDERS, ...process.env } : process.env;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    console.error(`\n❌ Invalid environment variables:\n${lines.join("\n")}\n`);
    throw new Error("Invalid environment variables. See messages above.");
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
