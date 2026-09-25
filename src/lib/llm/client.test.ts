import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { APICallError, NoObjectGeneratedError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  addUsage,
  backoffMs,
  emptyUsageTotals,
  generateStructured,
  isRetryable,
  mapWithConcurrency,
  normalizeUsage,
  retryAfterMs,
} from "./client";
import { LlmError } from "./errors";

const schema = z.object({ answer: z.string() });

function apiError(statusCode: number, isRetryable?: boolean) {
  return new APICallError({
    message: `HTTP ${statusCode}`,
    url: "https://example.test",
    requestBodyValues: {},
    statusCode,
    isRetryable,
  });
}

/** A model that returns `answer` as JSON, optionally failing the first N calls. */
function mockModel(options: { failures?: number; error?: unknown } = {}) {
  let calls = 0;

  // The result is annotated rather than returned inline: `doGenerate` is typed as
  // returning `PromiseLike<…>`, which does not propagate contextual typing into an
  // async arrow's return, so `finishReason: "stop"` would widen to `string`.
  const doGenerate: MockLanguageModelV4["doGenerate"] = async () => {
    calls += 1;
    if (options.failures && calls <= options.failures) {
      throw options.error ?? apiError(503);
    }
    const result: LanguageModelV4GenerateResult = {
      content: [{ type: "text" as const, text: JSON.stringify({ answer: "ok" }) }],
      finishReason: { unified: "stop", raw: "stop" },
      // NOTE: the *provider-level* usage shape (nested totals), which differs from
      // the public `LanguageModelUsage` (flat + `*TokenDetails`) that generateObject
      // returns. Easy to confuse; see docs/LEARNINGS.md.
      usage: {
        inputTokens: { total: 100, noCache: 60, cacheRead: 40, cacheWrite: 0 },
        outputTokens: { total: 20, text: 20, reasoning: 0 },
      },
      warnings: [],
    };
    return result;
  };

  return new MockLanguageModelV4({ provider: "mock", modelId: "mock-model", doGenerate });
}

describe("generateStructured", () => {
  it("returns schema-validated data plus normalized usage", async () => {
    const { data, usage } = await generateStructured({
      schema,
      system: "sys",
      prompt: "hi",
      model: "gemini-3.8-flash",
      languageModel: mockModel(),
    });

    expect(data).toEqual({ answer: "ok" });
    expect(usage.inputTokens).toBe(100);
    expect(usage.outputTokens).toBe(20);
    expect(usage.cachedInputTokens).toBe(40);
    expect(usage.model).toBe("gemini-3.8-flash");
    expect(usage.costUsd).not.toBeNull();
  });

  it("retries a retryable failure and then succeeds", async () => {
    const { data } = await generateStructured({
      schema,
      system: "sys",
      prompt: "hi",
      model: "gemini-3.8-flash",
      maxRetries: 2,
      languageModel: mockModel({ failures: 2 }),
    });

    expect(data).toEqual({ answer: "ok" });
  });

  it("gives up after maxRetries and throws a typed LlmError", async () => {
    const promise = generateStructured({
      schema,
      system: "sys",
      prompt: "hi",
      maxRetries: 1,
      languageModel: mockModel({ failures: 99 }),
    });

    await expect(promise).rejects.toBeInstanceOf(LlmError);
    await expect(promise).rejects.toMatchObject({ kind: "upstream", attempts: 2 });
  });

  it("does not retry a non-retryable failure", async () => {
    const model = mockModel({ failures: 99, error: apiError(400, false) });

    await expect(
      generateStructured({
        schema,
        system: "sys",
        prompt: "hi",
        maxRetries: 3,
        languageModel: model,
      }),
    ).rejects.toBeInstanceOf(LlmError);

    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it("reports a schema failure as kind 'schema', not a generic upstream error", async () => {
    const result: LanguageModelV4GenerateResult = {
      content: [{ type: "text", text: '{"wrong":"shape"}' }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    };
    const model = new MockLanguageModelV4({ doGenerate: async () => result });

    await expect(
      generateStructured({ schema, system: "s", prompt: "p", maxRetries: 0, languageModel: model }),
    ).rejects.toMatchObject({ kind: "schema" });
  });
});

describe("isRetryable", () => {
  it("retries rate limits, overloads and network failures", () => {
    expect(isRetryable(apiError(429))).toBe(true);
    expect(isRetryable(apiError(503))).toBe(true);
    expect(isRetryable(apiError(408))).toBe(true);
    expect(isRetryable(new TypeError("fetch failed"))).toBe(true);
  });

  it("does not retry client errors, which would fail identically", () => {
    expect(isRetryable(apiError(400, false))).toBe(false);
    expect(isRetryable(apiError(401, false))).toBe(false);
  });

  it("retries malformed model output — a different sample may parse", () => {
    const error = new NoObjectGeneratedError({
      message: "no object",
      response: { id: "r1", timestamp: new Date(0), modelId: "mock" },
      usage: {
        inputTokens: 0,
        inputTokenDetails: {
          noCacheTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        },
        outputTokens: 0,
        outputTokenDetails: { textTokens: 0, reasoningTokens: 0 },
        totalTokens: 0,
      },
      finishReason: "stop",
    });
    expect(isRetryable(error)).toBe(true);
  });

  it("does not retry a deliberate abort", () => {
    expect(isRetryable(new DOMException("aborted", "AbortError"))).toBe(false);
  });

  it("does retry a timeout — a stalled connection is worth another attempt", () => {
    // Two calls once hung ~15 minutes before the socket gave up, which is why every
    // attempt is now bounded. A timeout must stay distinguishable from a real cancel.
    expect(isRetryable(new DOMException("timed out", "TimeoutError"))).toBe(true);
  });
});

describe("backoffMs", () => {
  it("grows exponentially and stays capped", () => {
    const full = () => 1; // full jitter at its ceiling
    expect(backoffMs(0, full)).toBe(500);
    expect(backoffMs(1, full)).toBe(1000);
    expect(backoffMs(2, full)).toBe(2000);
    expect(backoffMs(10, full)).toBe(8000);
  });

  it("jitters below the ceiling", () => {
    expect(backoffMs(3, () => 0)).toBe(0);
    expect(backoffMs(3, () => 0.5)).toBe(2000);
  });
});

describe("normalizeUsage", () => {
  it("treats every absent field as zero", () => {
    const usage = normalizeUsage(undefined, "gemini-3.8-flash", "google");
    expect(usage).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: 0,
    });
  });

  it("reports null cost for a model with no published price", () => {
    const usage = normalizeUsage(undefined, "unpriced-model", "groq");
    expect(usage.costUsd).toBeNull();
  });
});

describe("mapWithConcurrency", () => {
  it("preserves input order in the results", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithConcurrency(
      Array.from({ length: 20 }, (_, i) => i),
      3,
      async (n) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight -= 1;
        return n;
      },
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("handles an empty list without hanging", async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([]);
  });
});

describe("addUsage", () => {
  const usage = (costUsd: number | null) => ({
    provider: "google",
    model: "m",
    inputTokens: 10,
    outputTokens: 5,
    cachedInputTokens: 2,
    costUsd,
  });

  it("accumulates tokens and cost", () => {
    const totals = addUsage(addUsage(emptyUsageTotals(), usage(0.5)), usage(0.25));
    expect(totals).toEqual({
      inputTokens: 20,
      outputTokens: 10,
      cachedInputTokens: 4,
      costUsd: 0.75,
    });
  });

  it("makes the whole run's cost unknown if any call is unpriced", () => {
    const totals = addUsage(addUsage(emptyUsageTotals(), usage(0.5)), usage(null));
    expect(totals.costUsd).toBeNull();
    expect(totals.inputTokens).toBe(20);
  });
});

describe("retryAfterMs", () => {
  function rateLimited(extra: Partial<ConstructorParameters<typeof APICallError>[0]>) {
    return new APICallError({
      message: "rate limited",
      url: "https://example.test",
      requestBodyValues: {},
      statusCode: 429,
      ...extra,
    });
  }

  it("reads a numeric retry-after header", () => {
    expect(retryAfterMs(rateLimited({ responseHeaders: { "retry-after": "12" } }))).toBe(12_000);
  });

  it("reads an HTTP-date retry-after header", () => {
    const when = new Date(Date.now() + 20_000).toUTCString();
    const ms = retryAfterMs(rateLimited({ responseHeaders: { "retry-after": when } }));
    expect(ms).toBeGreaterThan(18_000);
    expect(ms).toBeLessThanOrEqual(20_000);
  });

  it("falls back to the delay Google only puts in the body", () => {
    // Verbatim shape from a real gemini-3.8-flash free-tier 429.
    const error = rateLimited({
      message:
        "You exceeded your current quota. Quota exceeded for metric: " +
        "generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5. " +
        "Please retry in 14.708622049s.",
    });
    // 14.708622049s → 14709ms, padded by 250ms. Retrying a beat early would just
    // burn another attempt against the same window.
    expect(retryAfterMs(error)).toBe(14_959);
  });

  it("caps an absurd hint so a run cannot stall indefinitely", () => {
    expect(retryAfterMs(rateLimited({ responseHeaders: { "retry-after": "86400" } }))).toBe(60_000);
  });

  it("returns null when the provider gives no hint, so blind backoff applies", () => {
    expect(retryAfterMs(rateLimited({}))).toBeNull();
    expect(retryAfterMs(new Error("boom"))).toBeNull();
  });
});

describe("truncation at the output ceiling", () => {
  function truncated() {
    return new NoObjectGeneratedError({
      message: "No object generated",
      text: '{"answer":"partial',
      response: { id: "r1", timestamp: new Date(0), modelId: "gpt-5-mini" },
      usage: {
        inputTokens: 3000,
        inputTokenDetails: { noCacheTokens: 3000, cacheReadTokens: 0, cacheWriteTokens: 0 },
        outputTokens: 2048,
        outputTokenDetails: { textTokens: 100, reasoningTokens: 1948 },
        totalTokens: 5048,
      },
      finishReason: "length",
    });
  }

  it("is not retried — the same ceiling truncates again", () => {
    expect(isRetryable(truncated())).toBe(false);
  });

  it("names the real cause instead of blaming the schema", async () => {
    const doGenerate: MockLanguageModelV4["doGenerate"] = async () => {
      throw truncated();
    };

    await expect(
      generateStructured({
        schema,
        system: "s",
        prompt: "p",
        maxRetries: 2,
        languageModel: new MockLanguageModelV4({ doGenerate }),
      }),
    ).rejects.toThrow(/truncated at the token ceiling[\s\S]*maxOutputTokens/);
  });
});

/**
 * A model that never resolves and only settles on abort — the shape of a hung
 * connection. It checks `aborted` before subscribing, exactly as a real `fetch` does:
 * a signal that is already aborted fires no event, so a listener alone would hang.
 */
const hangingModel = () =>
  new MockLanguageModelV4({
    doGenerate: ({ abortSignal }) =>
      new Promise((_resolve, reject) => {
        if (abortSignal?.aborted) {
          reject(abortSignal.reason);
          return;
        }
        abortSignal?.addEventListener("abort", () => reject(abortSignal.reason), {
          once: true,
        });
      }),
  });

describe("per-attempt timeout", () => {
  it("aborts an attempt that outlives the timeout, and reports it", async () => {
    const started = Date.now();
    await expect(
      generateStructured({
        schema,
        system: "s",
        prompt: "p",
        maxRetries: 0,
        timeoutMs: 60,
        languageModel: hangingModel(),
      }),
    ).rejects.toBeInstanceOf(LlmError);

    // Bounded by the timeout, not left hanging on the never-resolving promise.
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("leaves a caller's own abort in control", async () => {
    const controller = new AbortController();
    controller.abort();

    // An abort is final: it must not burn the retry budget or wait out the timeout.
    const started = Date.now();
    await expect(
      generateStructured({
        schema,
        system: "s",
        prompt: "p",
        maxRetries: 3,
        timeoutMs: 30_000,
        signal: controller.signal,
        languageModel: hangingModel(),
      }),
    ).rejects.toBeInstanceOf(LlmError);

    expect(Date.now() - started).toBeLessThan(1000);
  });
});
