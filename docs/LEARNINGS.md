# Learnings

Things that cost time once and should never cost it again. Each entry: what went wrong,
why, the fix, and — the part that matters — the **rule** to carry forward.

Newest last. Timestamps are `Africa/Lagos` (WAT).

---

## 2026-09-25 00:30 — The AI SDK has *two* token-usage shapes

**Problem.** A unit test drove a mock model that returned a perfectly reasonable-looking
`usage` object. Every token count came back `0`.

**Root cause.** There are two different usage types and they are easy to confuse:

| Level | Shape |
|---|---|
| **Provider** (what `doGenerate` returns) | `{ inputTokens: { total, noCache, cacheRead, cacheWrite }, outputTokens: { total, text, reasoning } }` |
| **Public** (what `generateObject` returns) | `{ inputTokens: number, inputTokenDetails: { noCacheTokens, cacheReadTokens, cacheWriteTokens }, outputTokens: number, outputTokenDetails: {…} }` |

The production code read the public shape correctly; the *test mock* used the public
shape where the provider shape belongs, so nothing mapped and everything defaulted to 0.

`finishReason` is split the same way: `{ unified, raw }` at the provider level, a plain
string union at the public level.

**Fix.** Mock with the provider shape; read the public shape.

**Rule.** When mocking an AI SDK model, type the result as
`LanguageModelV4GenerateResult` from `@ai-sdk/provider`. The annotation catches the
mismatch at compile time instead of as a silent zero.

---

## 2026-09-25 00:35 — AI SDK 7 renamed `system` to `instructions`

**Problem.** Recalled API shape didn't match the installed package.

**Root cause.** AI SDK 7 renamed the top-level prompt option `system` → `instructions`
across `generateText` / `streamText` / `generateObject` / `streamObject`. `system` still
works as a deprecated fallback, and `instructions` wins when both are passed — so the old
spelling fails silently-correctly and you never notice you're on a deprecated path.

`instructions` accepts `string | SystemModelMessage | SystemModelMessage[]`, and
`SystemModelMessage` carries `providerOptions` — which is what makes per-provider cache
control possible on the system block.

**Fix.** Use `instructions` everywhere. `src/lib/llm/client.ts` is the only place it
appears.

**Rule.** Before writing against any SDK past your training cutoff, read the installed
`.d.ts`. `grep -n "declare function <name>" -A 5 node_modules/<pkg>/dist/index.d.ts`
takes ten seconds and beats being confidently wrong.

---

## 2026-09-25 00:40 — `server-only` throws under vitest and tsx

**Problem.** Any test or script importing a module with `import "server-only"` died with
*"This module cannot be imported from a Client Component module."*

**Root cause.** The package resolves to an empty module only under the `react-server`
export condition, which Next.js sets and plain Node does not. Without it you get
`index.js`, whose entire body is a `throw`.

**Fix.** Two different ones, because the two runtimes differ:

- **vitest** — alias it in `vitest.config.ts`:
  `"server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url))`
- **tsx scripts** — pass the condition instead:
  `tsx --conditions=react-server src/…` (see the `llm:smoke` script)

**Rule.** Don't drop `import "server-only"` to make a test pass — it is a real guarantee.
Fix the resolution, not the source. Note `src/db/seed.ts` predates this and works around
it by opening its own DB connection; that workaround is no longer necessary.

---

## 2026-09-25 00:50 — `vi.resetModules()` breaks `instanceof`

**Problem.** `expect(() => resolveModel(…)).toThrow(LlmConfigError)` failed even though
the thrown object printed as an `LlmConfigError`.

**Root cause.** The test re-imported `./config` after `vi.resetModules()` to pick up
stubbed env. That produced a *fresh module graph* — including a fresh `./errors` with a
new class identity. The statically imported `LlmConfigError` at the top of the test file
belonged to the old graph, so `instanceof` was comparing two unrelated classes.

**Fix.** Re-import the error module from the same fresh graph and assert against that.

**Rule.** After `vi.resetModules()`, every class identity you assert on must come from
the same dynamic import. Alternatively assert on a structural field (`error.kind`)
instead of identity.

---

## 2026-09-25 00:55 — TypeScript widens literals through `PromiseLike` returns

**Problem.** `finishReason: "stop" as const` inside an async arrow still typechecked as
`string`, failing assignment to the SDK's finish-reason type.

**Root cause.** `doGenerate` is typed as returning `PromiseLike<T>`, not `Promise<T>`.
Contextual typing does not propagate into an async function's returned object literal
through `PromiseLike`, so the literal widens at the boundary — and `as const` inside the
literal doesn't survive it.

**Fix.** Annotate an intermediate: `const result: LanguageModelV4GenerateResult = {…};
return result;`.

**Rule.** When a callback's return type is `PromiseLike<T>`, annotate the value, not the
function. `as const` is not a substitute for an annotation across that boundary.

---

## 2026-09-25 01:00 — Blind backoff is useless against a provider that tells you the delay

**Problem.** Gemini's free tier returned 429s asking to retry in ~14.7s. Our capped
exponential backoff waited at most 8s, so every retry hit the same closed window and the
job failed anyway. Retries were pure waste.

**Root cause.** We ignored the provider's own hint. Worse, Google sends **no
`retry-after` header at all** — the delay only appears in the error message body
(`"Please retry in 14.708622049s"`).

**Fix.** `retryAfterMs()` in `client.ts` reads `retry-after` (seconds or HTTP date),
falls back to parsing the body, pads by 250ms, and caps the honored delay at 60s so a
hostile hint can't stall a run.

**Rule.** Always prefer the provider's stated delay over your own guess, and never assume
the hint is in a header. Cap what you honor.

---

## 2026-09-25 01:05 — "Schema failure" that was really output truncation

**Problem.** 9 of 15 jobs failed on `gpt-5-mini` with *"Model did not return output
matching the schema."* The obvious reading — a weak model that can't follow a schema —
was wrong, and would have led to swapping models for no reason.

**Root cause.** `maxOutputTokens` was 2048. `gpt-5-mini` is a *reasoning* model: reasoning
tokens are billed and counted as output *before* the object is emitted. Measured output
was ~1,940 tokens per successful assessment — right at the ceiling. Generation stopped at
`finishReason: "length"`, the JSON was cut off mid-object, and the SDK reported the
symptom (unparseable) rather than the cause (truncated).

**Fix.** Ceiling raised to 8192. More importantly, `client.ts` now detects
`finishReason === "length"` and says so explicitly — *"Output truncated at the token
ceiling (N output tokens) … Raise maxOutputTokens"* — and does **not** retry it, since
the same ceiling truncates identically every time.

Re-run after the fix: **15/15 scored, 0 failures.**

**Rule.** Size `maxOutputTokens` for reasoning + output, not output alone — budget several
times what the JSON alone needs. And when a model "fails the schema", check
`finishReason` before blaming the model.

---

## 2026-09-25 01:08 — Free tiers throttle on *tokens*, not just requests

**Problem.** Groq looked like the obvious default — 839ms per call, cheapest per token of
the three. On a real 12-job batch it managed 7.

**Root cause.** The binding limit was not requests per minute but **7,000 input tokens
per minute** (and 1,000 output). At ~3,700 input tokens per job that is roughly two jobs
a minute, no matter how fast each call is. Gemini's free tier binds differently again:
5 requests/minute.

Measured prompt breakdown, which is the number that actually matters:

```
system prefix (rubric + profile + strengths + evidence)  9,492 chars  ~2,373 tokens
job context (posting, truncated to 6k chars)             5,234 chars  ~1,309 tokens
                                                         ─────────────────────────
per call                                                             ~3,682 tokens
```

The 2,373-token prefix is byte-identical on every call in a run — 64% of the spend is
repetition.

**Fix.** Two things. The prefix moved from the per-job `prompt` into `instructions`,
which is what lets a provider cache it — OpenAI then served **78% of input tokens from
cache** on a real run. And the default provider was chosen by measurement: OpenAI, the
only one of the three on a paid tier.

**Rule.** Benchmark a provider on a realistic *batch*, not a single call — per-call
latency hides the limit that actually binds. Put invariant context in `instructions` and
volatile context in `prompt`; the split is free and cuts most of the bill.

---

## 2026-09-25 01:10 — A guard you haven't seen fail is not a guard

**Problem.** `boundary.test.ts` and the new ESLint rule both passed on first run. That
proves nothing — a test that scans zero files also passes.

**Fix.** Planted a file importing `ai` and referencing `OPENAI_API_KEY`, confirmed both
guards failed and named the violation, then deleted it and confirmed green again. The
test also asserts it found at least 30 source files, so an empty walk can't pass vacuously.

**Rule.** Every guard gets deliberately tripped once, at the time it's written. An
assertion you've only ever seen pass is decoration.
