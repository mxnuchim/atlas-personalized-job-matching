import "server-only";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGateway } from "@ai-sdk/gateway";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { env } from "@/lib/env";

import { LlmConfigError } from "./errors";

/**
 * Provider resolution — the ONLY module in Atlas that names a provider or reads an
 * API key. Swapping Claude for an open-source model is a change to this file plus
 * env; the prompts, schemas, pipeline and UI never move (PRD §12).
 */

export type LlmProvider = "anthropic" | "openai" | "google" | "groq" | "gateway";

/**
 * The two model slots from the PRD §15-D env contract. These are task *slots*, not
 * domain knowledge — this module still knows nothing about jobs, strengths or drafts.
 */
export const MODELS = {
  scoring: env.MODEL_SCORING,
  drafting: env.MODEL_DRAFTING,
} as const;

export const PROVIDER: LlmProvider = env.LLM_PROVIDER;

export const LIMITS = {
  maxConcurrency: env.LLM_MAX_CONCURRENCY,
  maxRetries: env.LLM_MAX_RETRIES,
  requestTimeoutMs: env.LLM_REQUEST_TIMEOUT_MS,
} as const;

/**
 * Keys are passed explicitly rather than left to each provider's own env lookup.
 * That is what lets `GEMINI_API_KEY` drive `@ai-sdk/google` (which would otherwise
 * expect `GOOGLE_GENERATIVE_AI_API_KEY`), and it keeps key access auditable in one
 * place — `boundary.test.ts` asserts no other file references one.
 */
const API_KEYS: Record<LlmProvider, string | undefined> = {
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
  google: env.GEMINI_API_KEY,
  groq: env.GROQ_API_KEY,
  gateway: env.AI_GATEWAY_API_KEY,
};

const ENV_VAR_NAMES: Record<LlmProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  groq: "GROQ_API_KEY",
  gateway: "AI_GATEWAY_API_KEY",
};

/** Providers that bill cached prompt prefixes only when asked explicitly. */
const EXPLICIT_CACHE_PROVIDERS = new Set<LlmProvider>(["anthropic"]);

export function supportsExplicitCacheControl(provider: LlmProvider = PROVIDER): boolean {
  return EXPLICIT_CACHE_PROVIDERS.has(provider);
}

/**
 * Resolve a model handle. Throws `LlmConfigError` at call time rather than import
 * time, so the app still boots (and the Settings screen still renders) when a key
 * for the selected provider is absent.
 */
export function resolveModel(modelId: string, provider: LlmProvider = PROVIDER): LanguageModel {
  const apiKey = API_KEYS[provider];
  if (!apiKey) {
    throw new LlmConfigError(
      `${ENV_VAR_NAMES[provider]} is not set, but LLM_PROVIDER is "${provider}". ` +
        `Set the key, or point LLM_PROVIDER at a provider you have credentials for.`,
      { provider },
    );
  }

  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey })(modelId);
    case "openai":
      return createOpenAI({ apiKey })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey })(modelId);
    case "groq":
      return createGroq({ apiKey })(modelId);
    case "gateway":
      // Gateway model ids are creator-namespaced, e.g. "openai/gpt-5-mini".
      return createGateway({ apiKey })(modelId);
    default: {
      // Unreachable while the env enum and this switch agree; the assignment makes
      // TypeScript enforce that they do.
      const exhaustive: never = provider;
      throw new LlmConfigError(`Unknown LLM provider "${String(exhaustive)}"`);
    }
  }
}

/** Which providers have a usable key right now — used by the smoke script. */
export function configuredProviders(): LlmProvider[] {
  return (Object.keys(API_KEYS) as LlmProvider[]).filter((p) => Boolean(API_KEYS[p]));
}
