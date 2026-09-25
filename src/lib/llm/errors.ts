/**
 * Typed errors for the LLM layer (PRD §12: "typed, surfaced, never swallowed").
 * Callers branch on `kind` rather than string-matching a provider's message — that
 * is what keeps the pipeline's error handling provider-agnostic.
 */

export type LlmErrorKind =
  /** Misconfiguration: unknown provider, or no API key for the selected one. */
  | "config"
  /** The model returned something the Zod schema rejected, after every retry. */
  | "schema"
  /** Provider rate limit or overload. Retried first; surfaced only once exhausted. */
  | "rate_limit"
  /** Any other upstream failure: network, 5xx, timeout, aborted. */
  | "upstream";

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly model: string | undefined;
  readonly provider: string | undefined;
  readonly attempts: number;

  constructor(
    kind: LlmErrorKind,
    message: string,
    options: {
      cause?: unknown;
      model?: string;
      provider?: string;
      attempts?: number;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "LlmError";
    this.kind = kind;
    this.model = options.model;
    this.provider = options.provider;
    this.attempts = options.attempts ?? 1;
  }
}

export class LlmConfigError extends LlmError {
  constructor(message: string, options: { cause?: unknown; provider?: string } = {}) {
    super("config", message, options);
    this.name = "LlmConfigError";
  }
}

export function isLlmError(error: unknown): error is LlmError {
  return error instanceof LlmError;
}
