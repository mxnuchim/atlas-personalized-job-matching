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

---

## 2026-09-25 09:35 — Radix restores dialog focus in its own hook, not yours

**Problem.** Closing the match drawer with Escape left focus on `<body>`, which silently
killed `j`/`k` navigation. The close handler explicitly refocused the originating row, and
it made no difference.

**Root cause.** `onOpenChange` fires *before* Radix runs its own focus restoration, so
the manual `focus()` was immediately overwritten. And because the drawer is opened
programmatically rather than from a `Dialog.Trigger`, Radix had no trigger to restore to
and fell back to the body.

**Fix.** `onCloseAutoFocus={(e) => { e.preventDefault(); onCloseFocus?.(); }}` on
`Dialog.Content` — the hook Radix provides for exactly this.

**Rule.** When a library owns focus, put focus work in the hook it gives you. A
`focus()` call in an earlier callback is not "also fine"; it is dead code with a plausible
shape.

---

## 2026-09-25 09:35 — `truncate` does nothing in a table without `table-fixed`

**Problem.** The matches table overflowed its `overflow-hidden` container on a 375px
viewport and was clipped. Column widths were declared and cells used `truncate`; neither
had any effect.

**Root cause.** The default `table-layout: auto` sizes columns to their content, so
declared widths are treated as suggestions and a cell never gets the constrained width
that `text-overflow: ellipsis` needs.

**Rule.** A table with fixed column widths or truncating cells needs `table-fixed`.
`w-[Npx]` plus `truncate` on an auto-layout table is a no-op that looks correct in the
markup.

---

## 2026-09-25 09:35 — Size an SVG in viewBox units, not pixels

**Problem.** The fit gauge took `box`/`stroke` as pixel values baked into `width`,
`height` and inline styles. Making it smaller on mobile would have meant rendering two
gauges and hiding one — two mounts, two animations, for one dial.

**Fix.** Keep the geometry in viewBox units and let CSS set the rendered size
(`size-12 sm:size-16`). The stroke scales with the box, so one instance covers every
breakpoint.

**Rule.** An SVG's `viewBox` is its coordinate system, not its size. Put the drawing in
viewBox units and let CSS decide how big it renders — then responsive sizing is a class,
not a second component.

---

## 2026-09-25 09:35 — The defects that matter are the ones green gates cannot see

**Problem.** Lint, types, 69 tests and a clean production build all passed on a UI with
broken focus restoration, truncated content, a clipped mobile table and an
under-scaled hero number.

**Rule.** A green pipeline says the code runs, not that the thing works. Any UI change
gets looked at — at the smallest width, in both themes, and driven by keyboard — before
it is called done. Budget for the visual pass finding real bugs, because it will.

---

## 2026-09-25 09:55 — A hung provider connection has no timeout unless you add one

**Problem.** A two-job scoring run took over fifteen minutes. The jobs eventually
scored — the retry logic worked — but the first attempts simply hung until the socket
gave up on its own.

**Root cause.** Neither the AI SDK nor `fetch` imposes a wall clock. Retries and
backoff only help once a call *fails*; a call that never returns is invisible to them.
The PRD budgets ~2 minutes for a whole run, and a single stalled connection can exceed
that on its own.

**Fix.** Every attempt now carries `AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS)`
(default 60s), combined with any caller signal via `AbortSignal.any`. Fresh per
attempt, so the timeout bounds one call rather than the whole retry budget.

The two abort kinds must stay distinguishable: `AbortSignal.timeout()` rejects with
`TimeoutError` and is retryable (a stalled connection deserves another go), while a
caller's `AbortController` rejects with `AbortError` and is final.

**Rule.** Retry and backoff protect against calls that fail. Only a timeout protects
against calls that never return — every network call needs both.

---

## 2026-09-25 09:57 — An abort mock must check `aborted` before it subscribes

**Problem.** A test that aborted the caller's controller hung until the runner killed
it, making a correct timeout implementation look broken.

**Root cause.** The mock only did `addEventListener("abort", …)`. A signal that was
*already* aborted fires no further event, so the listener never ran and the promise
never settled. Real `fetch` checks `signal.aborted` up front.

**Rule.** Any fake that honours an `AbortSignal` must reject immediately when
`signal.aborted` is already true, then subscribe. Otherwise it models a signal that can
only be aborted late, and tests the wrong thing.

---

## 2026-09-25 10:05 — zsh's `echo` corrupts JSON payloads in test harnesses

**Problem.** Twice today a correct script looked broken because `jq` reported *"Invalid
string: control characters from U+0000 through U+001F must be escaped"* on output that
was in fact valid JSON.

**Root cause.** `echo "$json" | jq` under zsh. The builtin `echo` interprets backslash
escapes, so every `\n` inside a JSON string becomes a real newline — an unescaped control
character, which is exactly what the error says. The script under test was fine both times.

**Fix.** `printf '%s' "$json" | jq`, or write to a file, or drive the harness from Python.

**Rule.** Never pipe JSON through `echo`. When a hook or script "emits invalid JSON",
verify the raw bytes (`> file; jq . file`) before touching the script — the harness is the
likelier culprit.

---

## 2026-09-25 10:05 — A guard that passes everything is as broken as one that fails

**Problem.** After fixing two real bugs in the docs hook, every test case returned
"allow" — including the ones that had to block. The fixes looked like they had worked.

**Root cause.** The source-path regex used `(^|[^a-zA-Z0-9_./-])src/`, whose negated class
excludes `/`. Every path the file tools pass is absolute, so `/src/` never matched and the
hook could not fire at all.

**Rule.** Assert both directions. A guard test needs cases that must block *and* cases
that must not; checking only the happy path cannot distinguish "correctly permissive" from
"completely inert". This is the same lesson as tripping the boundary test deliberately —
it just cost a second time because the test only asserted one side.

---

## 2026-09-25 10:15 — A model will copy your internal ids into the prose

**Problem.** The first real draft read well and cited genuine evidence — and contained
`…at <400ms latency (id=a8c730f3-9067-451d-ab0b-cfe0d215e7ff)`. That was one approval
away from being emailed to a hiring manager.

**Root cause.** The evidence list was given to the model as `id=<uuid> (label) claim…`
and it was told to "report which one by its id". It did both: it put the id in the
structured field *and* copied the pattern into the body.

**Fix.** Two layers. The prompt now says the id belongs in the `evidence_id` field only
and that the recipient must never see one. And `stripIdentifiers()` removes
`(id=…)`, `id=…` and bare UUIDs from the subject and body before storage, with a test
using the verbatim leaked string.

**Rule.** Anything you put in a prompt can come back out in the generated text. If a
value must never reach the reader — an internal id, a system instruction, a raw score —
strip it deterministically on the way out. A prompt is a request, not a guarantee.

---

## 2026-09-25 10:20 — Don't regex personal details out of free text

**Problem.** The drafter needed the candidate's name and portfolio URL. Neither was on
the `profile` table, so the first version scraped them out of `cv_text` with a regex,
falling back to the literal string `"the candidate"`.

**Root cause.** Reaching for an extraction hack instead of extending the contract. The
failure mode is silent and public: an outreach email signed "the candidate".

**Fix.** `name` and `portfolio_url` are columns on `profile`, part of the seed
contract, and `runDraft` refuses with a clear message when `name` is unset.

**Rule.** When output goes in front of another human, a missing input is a hard stop,
not a default. Add the field; never infer identity from prose.

---

## 2026-09-25 10:25 — Python's `str.replace` fails silently; `Edit` does not

**Problem.** The login throttle was written, imported into `auth.ts`, and not wired up.
Lint caught it only because the imports were unused — otherwise a security control
would have shipped as dead code.

**Root cause.** Patching files with `python … s.replace(old, new)`. Prettier had
reformatted the target block onto one line in an earlier commit, so `old` no longer
matched and `replace` returned the string unchanged, exit code 0, no output.

**Rule.** For surgical edits to existing code, use the `Edit` tool — it errors when the
pattern does not match. If patching from a script, `assert old in s` before replacing.
An edit that silently does nothing is worse than one that fails.

---

## 2026-09-25 10:45 — Fixing the script is not fixing the hook

**Problem.** A hook bug was diagnosed correctly, fixed correctly in the script, tested
thoroughly against the script — and still happened again on the next real run.

**Root cause.** A Claude Code hook is two pieces: the script, and the `matcher` in
`settings.json` that decides when it runs. `record-touch.sh` was taught to read
`tool_input.command` so Bash-written files would count, but the matcher stayed
`Write|Edit`, so the script was never invoked for a Bash call. Every test passed
because the tests piped payloads straight into the script, bypassing the matcher
entirely — the one part that was broken.

**Fix.** Matcher is `Write|Edit|Bash`.

**Rule.** When a hook misbehaves, check the matcher before the script. And a test that
invokes the script directly verifies the script, not the hook — it cannot see a
configuration that never dispatches to it. The same trap as any integration boundary:
testing both halves separately proves nothing about the seam.

---

## 2026-09-25 11:20 — A readout that re-derives its own numbers will eventually lie

**Problem.** The review card's guardrail strip showed "Daily cap 30" while the server
was enforcing 5. Approving and sending would have been refused by a rule the interface
had just told you was satisfied.

**Root cause.** The card took a raw `dailyCap` prop and rendered it. The real cap comes
from the warm-up ramp, which is computed server-side in `evaluateSend`. Two places
computed "the cap", and only one of them was right.

**Fix.** The page runs `assessDrafts` — the same `evaluateSend` the send gate runs,
batched across the queue — and the card renders the returned guardrails verbatim. There
is now exactly one implementation.

**Rule.** When a screen explains a rule the server enforces, it must render the server's
own evaluation, not a second implementation of it. Any check worth showing is worth
passing down whole. A readout that can promise something the server refuses is worse
than no readout, because it is trusted.

---

## 2026-09-25 11:18 — Extending a boundary is how you find out it works

**Problem.** Adding Gmail meant a second vendor with secrets. Extending
`boundary.test.ts` to cover it immediately failed — on the two OAuth route handlers I
had just written, which read `GOOGLE_CLIENT_ID` and `GMAIL_OAUTH_REFRESH_TOKEN` directly.

**Root cause.** Writing a route that needs to *explain* missing configuration feels like
a legitimate reason to read that configuration. It is not: naming a variable and reading
its value are different needs, and only one crosses the boundary.

**Fix.** `lib/gmail` exports `oauthClientReady()` and a `GMAIL_ENV` map of the variable
*names*. The routes report what is missing without touching a value.

Tightening the patterns to be import-shaped was also required: `env.ts` legitimately
contains the literal `"openai"` as a config enum value, and a vendor's name in a string
is not a dependency.

**Rule.** A boundary that has only ever been satisfied has not been tested. Extend it to
the next vendor early — the first thing it catches will be code you just wrote and
believed was fine.

---

## 2026-09-25 11:40 — Complaint rate is not measurable from a plain Gmail account

**Problem.** §11 requires monitoring complaints (< 0.1%) and auto-throttling if they
climb. There is no way to do it with this setup.

**Root cause.** A spam complaint is recorded by the *receiving* provider and surfaced
through a feedback loop to the sending domain's operator. A regular Gmail account is not
that operator. Gmail Postmaster Tools exposes a spam rate, but only for a domain you own
and only above a volume threshold this app will never reach.

**Fix.** None available — so it is reported as `unknown` rather than `0`. The guardrail
renders "Complaint rate not monitored yet" and does not block, and the compensating
controls are named: low volume, mandatory human approval, reply suppression.

**Rule.** When a required signal cannot be obtained, say so in the interface. A metric
rendered as 0% because nothing measured it is worse than an admitted gap — it converts
an unknown into false reassurance, and nobody goes looking for it again.

---

## 2026-09-25 11:38 — Correlate on the provider's id, not on reconstruction

**Problem.** Detecting a reply means knowing which inbound message answers which
outreach. Matching on recipient address and timestamp is ambiguous the moment the same
person is contacted about two roles, or replies from a different address.

**Fix.** Store Gmail's `threadId` and `messageId` at send time. A reply lands in the
same thread by definition, so correlation is a lookup rather than a heuristic.

Two details that matter: `internalDate` (Gmail's own receipt time) is used rather than
the `Date` header, which the sender controls and can be wrong or absent; and a dry run
stores nulls rather than placeholder ids, or the poller chases a thread that does not
exist forever.

**Rule.** When an external system hands you an identifier for something you will need to
find again, persist it at the moment you receive it. Reconstructing the link later is
always a heuristic, and heuristics fail on exactly the edge cases that matter.

---

## 2026-09-25 11:50 — A variable name is a label, not an instruction

**Problem.** Settings reported "Not connected — missing GOOGLE_CLIENT_ID,
GMAIL_OAUTH_REFRESH_TOKEN. Visit /api/gmail/connect". Every word was accurate and it
was still useless: the route was not a link, nothing said where those variables live,
and nothing explained why a Google OAuth client is needed to send an email at all.

**Root cause.** Reporting *state* was mistaken for providing *setup*. Naming what is
missing is the easy half; the hard half is what to do about it, and that half was left
to the reader.

**Fix.** A stepped panel that ticks each prerequisite off as it is satisfied, with the
exact redirect URI to register, the env lines to paste, and a real button for the
consent flow.

**Rule.** When configuration is missing, show the steps, not the variable names. If the
interface names a route, make it a link. The test is whether someone could finish setup
without leaving the page — if they have to ask, the page did not do its job.
