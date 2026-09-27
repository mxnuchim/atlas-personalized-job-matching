import "server-only";

import { z } from "zod";

/**
 * Typed, validated configuration (PRD §12). Parsed once at import. Secrets are
 * server-only; nothing here is exposed to the client. Values required at M0 fail
 * fast; later-milestone values are optional so the app boots without them.
 */

/** Does the runtime's timezone database know this name? */
function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

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
   * How many roles the day's queue offers at once, and at most how many may come from
   * any one employer.
   *
   * The limit is how many a person can actually apply to in a day, not how many exist.
   * The ceiling of 30 is deliberate: a cap you can raise without limit is not a cap.
   */
  DAILY_QUEUE_SIZE: z.coerce.number().int().min(5).max(30).default(20),
  /**
   * Sorting purely by fit let one employer take a third of the queue — four
   * consecutive roles at the same company, all genuinely strong. Fifteen roles at
   * eleven companies is a better day's work than fifteen at four.
   */
  MAX_PER_COMPANY: z.coerce.number().int().min(1).max(10).default(4),

  /**
   * Postings older than this never enter the corpus. A board returns every open
   * requisition, so without a limit a first run ingests years of backlog. 30 days
   * covers the normal life of an open role; widening it is one line and one re-run,
   * since the boards still list what they still have.
   */
  MAX_POSTING_AGE_DAYS: z.coerce.number().int().min(1).max(365).default(30),

  /**
   * Who may create an account. Comma-separated emails; signup is closed while unset.
   *
   * A gate is needed because Atlas runs at a public URL and every account spends the
   * owner's model budget — an open form is a funded denial of wallet.
   *
   * An allowlist rather than an invite code, because for a tool with two known users
   * the code is worse in every way: a secret to generate, share over some channel,
   * and remember to revoke, protecting against nobody in particular. Naming the two
   * addresses is self-documenting, cannot be forwarded to a stranger, and needs no
   * extra field in the form.
   */
  SIGNUP_ALLOWED_EMAILS: z.string().optional(),

  /**
   * Triggering a run from the app.
   *
   * A pipeline run is ~12 minutes, far past any serverless ceiling, so in production
   * the Fetch now button cannot do the work itself — it asks GitHub Actions to. Set
   * these and the button dispatches the workflow; leave them unset (local dev) and it
   * runs the pipeline inline, which is faster to iterate against.
   *
   * The token needs only `actions: write` on this one repository.
   */
  GITHUB_DISPATCH_TOKEN: z.string().optional(),
  /** `owner/repo`, e.g. "mxnuchim/atlas". */
  GITHUB_REPO: z.string().optional(),
  GITHUB_REF: z.string().default("main"),
  GITHUB_WORKFLOW_FILE: z.string().default("pipeline.yml"),

  /**
   * The daily email (PRD §8 step 7). Sent through Resend; unset means no email, and
   * the run still records everything it did either way.
   *
   * `NOTIFY_EMAIL_FROM` defaults to Resend's shared sandbox sender, which delivers to
   * your own account address without verifying a domain. Sending anywhere else needs
   * a domain verified in Resend.
   */
  RESEND_API_KEY: z.string().optional(),
  NOTIFY_EMAIL_TO: z.email().optional(),
  NOTIFY_EMAIL_FROM: z.string().default("Atlas <onboarding@resend.dev>"),

  // Ops
  /**
   * An IANA name — "UTC", "Africa/Lagos". Validated here because the failure is
   * otherwise invisible: `Intl.DateTimeFormat` throws on an unknown zone, and a throw
   * inside a Server Component render reaches the browser as a minified React error
   * with the real message stripped. "WAT" and "GMT+1" are the tempting wrong answers;
   * neither is an IANA zone.
   */
  TZ: z
    .string()
    .default("UTC")
    .refine(isValidTimeZone, {
      message:
        'Not an IANA timezone. Use a Region/City name such as "Africa/Lagos", or "UTC". ' +
        '"WAT" and "GMT+1" are the tempting wrong answers; neither is valid.',
    }),
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

/**
 * An empty variable means "not set".
 *
 * Zod's `.default()` and `.optional()` only apply when a key is *absent*, and every
 * hosting dashboard sets a blank field to `""` rather than omitting it. So adding
 * `LOG_LEVEL` and leaving it empty produced "Invalid option" instead of `info`, and
 * an empty `LLM_MAX_CONCURRENCY` coerced through `Number("")` to `0` and reported
 * "too small" — an error naming a value nobody typed.
 *
 * Stripping them here means a variable you created but left blank behaves exactly
 * like one you never created, which is what anyone filling in a dashboard expects.
 */
function withoutBlanks(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== "string") continue;
    // Trimmed, not just tested for blankness. The first version checked
    // `value.trim() !== ""` and then stored the *untrimmed* string, so a value pasted
    // into a dashboard with a trailing space survived validation and failed later —
    // `TZ="UTC "` passes `z.string()` and then throws RangeError inside Intl, which
    // surfaces as a masked React error on whichever page happened to format a date.
    const trimmed = value.trim();
    if (trimmed !== "") out[key] = trimmed;
  }
  return out;
}

function loadEnv(): Env {
  const skipValidation =
    process.env.SKIP_ENV_VALIDATION === "1" || process.env.SKIP_ENV_VALIDATION === "true";

  const present = withoutBlanks(process.env);
  const source = skipValidation ? { ...BUILD_PLACEHOLDERS, ...present } : present;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`,
    );
    console.error(
      `\n❌ Invalid environment variables:\n${lines.join("\n")}\n\n` +
        `Blank values are treated as unset, so an empty variable is never the cause.\n` +
        `See docs/DEPLOY.md for the required set.\n`,
    );
    throw new Error("Invalid environment variables. See messages above.");
  }
  return parsed.data;
}

export const env = loadEnv();

export const isProduction = env.NODE_ENV === "production";
export const isDevelopment = env.NODE_ENV === "development";
