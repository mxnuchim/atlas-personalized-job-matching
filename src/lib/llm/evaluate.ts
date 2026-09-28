import "server-only";

import { createGateway } from "@ai-sdk/gateway";
import type {
  Experimental_EvaluationModelV4CallOptions,
  Experimental_EvaluationModelV4Question,
} from "@ai-sdk/provider";
import { experimental_evaluate as aiEvaluate } from "ai";

import { env } from "@/lib/env";

import { LIMITS } from "./config";
import { LlmConfigError } from "./errors";

/**
 * Jev — TypeSafe AI's System-1 evaluation model, reached through Vercel AI Gateway.
 *
 * Unlike a language model, Jev generates no text: it evaluates a block of state against
 * typed questions and returns choices, scores and boolean probabilities directly. Input
 * tokens only, ~100x cheaper than a generative call — so it is the right tool for the
 * high-volume numeric half of scoring, and the wrong tool for anything needing prose
 * (why-you, reasoning, a draft email). Those stay on `generateStructured`.
 *
 * This module keeps the same boundary rule as the rest of `lib/llm`: it is the only
 * place that names the Gateway or reads its key.
 */

/** The one evaluation question shape, re-exported so pipeline stages needn't import a provider package. */
export type EvaluationQuestion = Experimental_EvaluationModelV4Question;
export type EvaluationState = Experimental_EvaluationModelV4CallOptions["state"];

export const JEV_MODEL_ID = "typesafe-ai/jev";

/** Jev bills input tokens only, at this rate. Output is free. */
export const JEV_INPUT_USD_PER_MTOK = 0.042;

/** Whether Jev evaluation can run right now — i.e. a Gateway key is configured. */
export function isEvaluationConfigured(): boolean {
  return Boolean(env.AI_GATEWAY_API_KEY);
}

function evaluationModel() {
  const apiKey = env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new LlmConfigError(
      "AI_GATEWAY_API_KEY is not set — Jev evaluation is unavailable. Set it, or leave " +
        "Jev scoring off to score with the generative model alone.",
      { provider: "gateway" },
    );
  }
  return createGateway({ apiKey }).evaluationModel(JEV_MODEL_ID);
}

/**
 * One Jev evaluation. Typed questions in, typed answers out (each with probabilities);
 * the return type is inferred from `questions`, so a caller reads `answers[id].score`
 * or `.choice` or `.probability` with no casting. Carries the same per-attempt timeout
 * and retry budget as `generateStructured`.
 */
export async function evaluate<
  const QUESTIONS extends Record<string, EvaluationQuestion>,
>(options: { state: EvaluationState; questions: QUESTIONS; signal?: AbortSignal }) {
  const timeout = AbortSignal.timeout(LIMITS.requestTimeoutMs);
  const abortSignal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;

  return aiEvaluate({
    model: evaluationModel(),
    state: options.state,
    questions: options.questions,
    maxRetries: LIMITS.maxRetries,
    abortSignal,
    // Zero-retention / no-training is a Pro/Enterprise Gateway feature; asking for it on
    // a hobby plan 403s the whole call, so request it only when the account allows it.
    providerOptions: env.AI_GATEWAY_ZERO_RETENTION
      ? { gateway: { zeroDataRetention: true } }
      : undefined,
  });
}
