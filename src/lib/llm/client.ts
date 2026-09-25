import "server-only";

import {
  APICallError,
  generateObject,
  NoObjectGeneratedError,
  TypeValidationError,
  type LanguageModel,
  type LanguageModelUsage,
} from "ai";
import type { z } from "zod";

import { mapWithConcurrency } from "@/lib/concurrency";
import { log } from "@/lib/logger";

import {
  LIMITS,
  MODELS,
  PROVIDER,
  resolveModel,
  supportsExplicitCacheControl,
  type LlmProvider,
} from "./config";
import { LlmError } from "./errors";
import { estimateCostUsd } from "./pricing";

// Re-exported so `@/lib/llm` stays the single import for pipeline stages.
export { mapWithConcurrency };

const logger = log("llm");

/**
 * Default output ceiling. Reasoning models (gpt-5*, gemini-3*) spend output tokens on
 * reasoning *before* emitting the object, so a ceiling sized for the JSON alone
 * truncates mid-object and surfaces as a schema failure. Measured: gpt-5-mini used
 * ~1.9k output tokens for a single assessment, so 2k truncated most calls.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const BASE_BACKOFF_MS = 500;
/** Cap for our own blind backoff. */
const MAX_BACKOFF_MS = 8000;
/** Higher cap for a delay the provider explicitly asked for — it knows its own limits. */
const MAX_HONORED_RETRY_AFTER_MS = 60_000;

export type TokenUsage = {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  /** `null` when the model has no published price — never a fabricated zero. */
  costUsd: number | null;
};

export type GenerateStructuredOptions<T> = {
  /** Validates the model's output before it reaches any caller. */
  schema: z.ZodType<T>;
  /** Invariant prefix. Marked cacheable where the provider bills cached prefixes. */
  system: string;
  /** Volatile, per-call content. */
  prompt: string;
  /** Defaults to the configured scoring model. */
  model?: string;
  maxOutputTokens?: number;
  /** Retries *after* the first attempt. Defaults to `LLM_MAX_RETRIES`. */
  maxRetries?: number;
  /** Per-attempt wall clock. Defaults to `LLM_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Injected in tests to drive a mock model. Never set in application code. */
  languageModel?: LanguageModel;
};

/**
 * The one low-level primitive the rest of Atlas calls. Domain-agnostic: it knows
 * about schemas, tokens and providers, and nothing about jobs, strengths or drafts.
 */
export async function generateStructured<T>(
  opts: GenerateStructuredOptions<T>,
): Promise<{ data: T; usage: TokenUsage }> {
  const modelId = opts.model ?? MODELS.scoring;
  const maxRetries = opts.maxRetries ?? LIMITS.maxRetries;
  const model = opts.languageModel ?? resolveModel(modelId);

  const timeoutMs = opts.timeoutMs ?? LIMITS.requestTimeoutMs;

  const result = await withRetry(
    () =>
      generateObject({
        model,
        schema: opts.schema,
        instructions: buildInstructions(opts.system),
        prompt: opts.prompt,
        maxOutputTokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
        // Retrying is ours, not the SDK's — we classify which failures deserve it.
        maxRetries: 0,
        // Fresh per attempt: a timeout bounds one call, not the retry budget.
        abortSignal: withTimeout(opts.signal, timeoutMs),
      }),
    { maxRetries, modelId, signal: opts.signal },
  );

  return {
    data: result.object as T,
    usage: normalizeUsage(result.usage, modelId, PROVIDER),
  };
}

/**
 * Bound one attempt without swallowing the caller's own cancellation. A timeout aborts
 * with `TimeoutError`, a caller aborts with `AbortError` — `isRetryable` tells them
 * apart, so a hung connection is retried and a deliberate cancel is not.
 */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Attach a cache breakpoint to the invariant prefix where the provider charges for
 * one. Gemini and OpenAI cache automatically; Anthropic needs to be asked. Callers
 * never see this — it is a provider detail, so it lives here.
 */
function buildInstructions(system: string) {
  if (!supportsExplicitCacheControl()) return system;
  return {
    role: "system" as const,
    content: system,
    providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
  };
}

/** Every field on the SDK's usage object is optional; treat absent as zero. */
export function normalizeUsage(
  usage: LanguageModelUsage | undefined,
  model: string,
  provider: LlmProvider | string,
): TokenUsage {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  const cachedInputTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0;

  return {
    provider,
    model,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    costUsd: estimateCostUsd({ model, inputTokens, outputTokens, cachedInputTokens }),
  };
}

/**
 * Retry only what retrying can fix. A 400 or a bad API key will fail identically on
 * the next attempt, so retrying it just burns time and money.
 */
export function isRetryable(error: unknown): boolean {
  // A deliberate cancel is final; a timeout is a stalled connection worth one more try.
  if (error instanceof DOMException && error.name === "AbortError") return false;
  if (error instanceof DOMException && error.name === "TimeoutError") return true;

  // Truncation repeats deterministically under the same ceiling — retrying only
  // spends the tokens again.
  if (isTruncation(error)) return false;

  // The model produced unparseable or schema-invalid output — a different sample
  // genuinely may succeed, so this is worth one more roll.
  if (NoObjectGeneratedError.isInstance(error) || TypeValidationError.isInstance(error)) {
    return true;
  }

  if (APICallError.isInstance(error)) {
    if (error.isRetryable !== undefined) return error.isRetryable;
    const status = error.statusCode;
    if (status === undefined) return true; // network-level failure
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }

  // Unknown failures are usually transport-level (DNS, socket, fetch).
  return error instanceof Error && !(error instanceof LlmError);
}

/**
 * True when generation stopped at the output ceiling. The object is then truncated
 * mid-JSON, which the SDK reports as "no object generated" — a misleading symptom
 * whose real cause is `maxOutputTokens`, not a confused model.
 */
function isTruncation(error: unknown): boolean {
  return NoObjectGeneratedError.isInstance(error) && error.finishReason === "length";
}

function classify(error: unknown): "schema" | "rate_limit" | "upstream" {
  if (NoObjectGeneratedError.isInstance(error) || TypeValidationError.isInstance(error)) {
    return "schema";
  }
  if (APICallError.isInstance(error) && error.statusCode === 429) return "rate_limit";
  return "upstream";
}

/** Exponential backoff with full jitter, capped — avoids a thundering herd on 429. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.round(random() * ceiling);
}

/**
 * A provider that tells us how long to wait knows better than our blind backoff —
 * Gemini's free tier asks for ~15s, well past our 8s ceiling, so ignoring the hint
 * guarantees the retry fails too. Reads the standard `retry-after` header (seconds
 * or HTTP date) and falls back to the delay some providers only put in the body.
 */
export function retryAfterMs(error: unknown): number | null {
  if (!APICallError.isInstance(error)) return null;

  const header = error.responseHeaders?.["retry-after"] ?? error.responseHeaders?.["Retry-After"];
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_HONORED_RETRY_AFTER_MS);
    }
    const date = Date.parse(header);
    if (!Number.isNaN(date)) {
      return Math.min(Math.max(0, date - Date.now()), MAX_HONORED_RETRY_AFTER_MS);
    }
  }

  // Google returns no retry-after header; the delay is only in the message body.
  const body = error.responseBody ?? error.message;
  const match = /retry in ([0-9.]+)s/i.exec(body) ?? /"retryDelay"\s*:\s*"([0-9.]+)s"/i.exec(body);
  if (match?.[1]) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds)) {
      // Pad slightly: the window is usually measured from the provider's clock.
      return Math.min(Math.ceil(seconds * 1000) + 250, MAX_HONORED_RETRY_AFTER_MS);
    }
  }

  return null;
}

async function withRetry<R>(
  fn: () => Promise<R>,
  ctx: { maxRetries: number; modelId: string; signal?: AbortSignal },
): Promise<R> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= ctx.maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const canRetry = attempt < ctx.maxRetries && isRetryable(error);
      if (!canRetry) break;

      const delay = retryAfterMs(error) ?? backoffMs(attempt);
      logger.warn(
        { model: ctx.modelId, attempt: attempt + 1, delay, kind: classify(error) },
        "llm call failed, retrying",
      );
      await sleep(delay, ctx.signal);
    }
  }

  throw new LlmError(classify(lastError), describe(lastError), {
    cause: lastError,
    model: ctx.modelId,
    provider: PROVIDER,
    attempts: ctx.maxRetries + 1,
  });
}

function describe(error: unknown): string {
  if (isTruncation(error)) {
    const used = (error as InstanceType<typeof NoObjectGeneratedError>).usage?.outputTokens;
    return (
      `Output truncated at the token ceiling${used ? ` (${used} output tokens)` : ""} — ` +
      `the object was cut off mid-JSON. Raise maxOutputTokens for this model.`
    );
  }
  if (NoObjectGeneratedError.isInstance(error)) {
    return "Model did not return output matching the schema";
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Running totals for a whole pipeline run. */
export function emptyUsageTotals() {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 as number | null };
}

export function addUsage(
  totals: ReturnType<typeof emptyUsageTotals>,
  usage: TokenUsage,
): ReturnType<typeof emptyUsageTotals> {
  return {
    inputTokens: totals.inputTokens + usage.inputTokens,
    outputTokens: totals.outputTokens + usage.outputTokens,
    cachedInputTokens: totals.cachedInputTokens + usage.cachedInputTokens,
    // One unpriced model makes the whole run's cost unknown rather than understated.
    costUsd:
      totals.costUsd === null || usage.costUsd === null ? null : totals.costUsd + usage.costUsd,
  };
}
