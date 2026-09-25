/**
 * Per-model token prices, USD per 1M tokens. Feeds `runs.cost_usd` (PRD §7) and the
 * per-run cost line in the logs.
 *
 * Verified 2026-09-25 against each provider's published pricing page. Prices move —
 * a model with no entry here yields a `null` cost, never a fabricated `0`, so an
 * unpriced model reads as "unknown" in the run record instead of "free".
 */

export type ModelPrice = {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M cached input tokens, when the provider prices them separately. */
  cachedInput?: number;
};

const PRICES: Record<string, ModelPrice> = {
  // ── Google (Gemini). gemini-3.8-flash is at promotional pricing until 2027-01-01,
  // after which it doubles to 1.50 / 7.50 / 0.15.
  "gemini-3.8-flash": { input: 0.75, output: 3.75, cachedInput: 0.075 },
  "gemini-3.1-pro-preview": { input: 2.0, output: 12.0, cachedInput: 0.2 },
  "gemini-3-flash-preview": { input: 0.5, output: 3.0, cachedInput: 0.05 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0, cachedInput: 0.125 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cachedInput: 0.03 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cachedInput: 0.01 },

  // ── Groq
  "qwen/qwen3.8-27b": { input: 0.8, output: 4.0 },
  "openai/gpt-oss-120b": { input: 0.15, output: 0.6 },
  "openai/gpt-oss-20b": { input: 0.075, output: 0.3 },

  // ── OpenAI
  "gpt-5.2": { input: 1.75, output: 14.0, cachedInput: 0.175 },
  "gpt-5.1": { input: 1.25, output: 10.0, cachedInput: 0.125 },
  "gpt-5": { input: 1.25, output: 10.0, cachedInput: 0.125 },
  "gpt-5-mini": { input: 0.25, output: 2.0, cachedInput: 0.025 },
  "gpt-5-nano": { input: 0.05, output: 0.4, cachedInput: 0.005 },
  "gpt-4.1": { input: 2.0, output: 8.0, cachedInput: 0.5 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6, cachedInput: 0.1 },

  // ── Anthropic
  "claude-opus-5": { input: 5.0, output: 25.0 },
  "claude-opus-5-5": { input: 4.0, output: 20.0 },
  "claude-sonnet-5": { input: 2.0, output: 10.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
};

const PER_MILLION = 1_000_000;

export function priceFor(model: string): ModelPrice | null {
  return PRICES[model] ?? null;
}

/**
 * Cost of one call, or `null` when the model has no published price in the table.
 * Cached input tokens are billed at the discounted rate and excluded from the
 * full-price input count, matching how every provider above bills them.
 */
export function estimateCostUsd(params: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}): number | null {
  const price = priceFor(params.model);
  if (!price) return null;

  const cached = params.cachedInputTokens ?? 0;
  const uncachedInput = Math.max(0, params.inputTokens - cached);
  const cachedRate = price.cachedInput ?? price.input;

  const total =
    (uncachedInput * price.input + cached * cachedRate + params.outputTokens * price.output) /
    PER_MILLION;

  // Sub-cent costs are normal here; keep enough precision for a whole run to sum.
  return Math.round(total * 1e6) / 1e6;
}
