import "server-only";

import { z } from "zod";

/**
 * Typed, validated configuration (PRD §12). Parsed once at import. Secrets are
 * server-only; nothing here is exposed to the client. Values required at M0 fail
 * fast; later-milestone values are optional so the app boots without them.
 */

/** Parse "true"/"false"/"1"/"0"/"yes"/"on" into a boolean; undefined → false. */
const boolFromString = z.preprocess(
  (v) => (typeof v === "string" ? ["1", "true", "yes", "on"].includes(v.toLowerCase()) : false),
  z.boolean(),
);

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

  // M2 — scoring & drafting
  ANTHROPIC_API_KEY: z.string().optional(),
  MODEL_SCORING: z.string().default("claude-sonnet-4-5"),
  MODEL_DRAFTING: z.string().default("claude-opus-4-1"),

  // M4 — Gmail sending
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GMAIL_OAUTH_REFRESH_TOKEN: z.string().optional(),
  SENDING_ADDRESS: z.email().optional(),
  DAILY_SEND_CAP: z.coerce.number().int().positive().default(30),
  AUTO_SEND: boolFromString, // defaults off, ships off (PRD §11)

  // Ops
  TZ: z.string().default("UTC"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  // Allow `next build` in CI without real secrets (schema is still the contract).
  if (process.env.SKIP_ENV_VALIDATION === "1" || process.env.SKIP_ENV_VALIDATION === "true") {
    return process.env as unknown as Env;
  }

  const parsed = envSchema.safeParse(process.env);
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
