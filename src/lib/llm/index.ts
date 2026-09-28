/**
 * The LLM layer's public surface.
 *
 * HARD RULE: this directory is the only place in Atlas that may import `ai`, a
 * provider package, or read an API key. Everything else imports from `@/lib/llm`.
 * Enforced by `no-restricted-imports` in eslint.config.mjs and by boundary.test.ts.
 *
 * It is deliberately domain-agnostic — it knows about schemas, tokens, providers and
 * retries, and nothing about jobs, scoring or drafts. Prompts and their Zod schemas
 * live with the pipeline stage that owns them.
 */

export { generateStructured, mapWithConcurrency, addUsage, emptyUsageTotals } from "./client";
export type { TokenUsage, GenerateStructuredOptions } from "./client";

export { evaluate, isEvaluationConfigured, JEV_MODEL_ID, JEV_INPUT_USD_PER_MTOK } from "./evaluate";
export type { EvaluationQuestion, EvaluationState } from "./evaluate";

export { MODELS, PROVIDER, LIMITS, configuredProviders } from "./config";
export type { LlmProvider } from "./config";

export { LlmError, LlmConfigError, isLlmError } from "./errors";
export type { LlmErrorKind } from "./errors";

export { estimateCostUsd, priceFor } from "./pricing";
export type { ModelPrice } from "./pricing";
