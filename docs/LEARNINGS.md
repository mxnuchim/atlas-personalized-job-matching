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

---

## 2026-09-25 12:35 — Build the smallest thing that delivers the value

**Problem.** Sending took three commits, a vendor SDK, an OAuth consent flow, a warm-up
ramp, nine guardrails, RFC 2822 construction, thread classification and a reply poller —
and was then deleted without ever having sent an email.

**Root cause.** The PRD specified Gmail sending, so it got built as specified. Nobody
asked the prior question: what does the user actually do with a draft? They copy it and
send it from the client they already have open. The automation was solving the cheap
half of the problem while inheriting all of the expensive half — deliverability,
identity warm-up, bounce monitoring, OAuth token lifetimes.

Not wasted, exactly: the §11 rules are now understood, and the contact extraction and
copy-ready framing came directly out of building the heavier thing. But three commits
is a costly way to learn it.

**Rule.** Before automating an action, ask what it costs the user to do by hand. Two
seconds of copy-paste does not justify a vendor integration, an OAuth flow and a
reputation-management subsystem. Automate the part that is genuinely expensive — here,
deciding *what to say* — and leave the cheap part to the human.

---

## 2026-09-25 12:30 — Delete the schema when you delete the feature

**Problem.** Ripping out Gmail left `outreach.gmail_thread_id` and `gmail_message_id`
behind. Nothing wrote them, nothing read them, and a migration to remove them felt like
unnecessary churn.

**Root cause.** Columns are cheap to leave, so they get left. But the next person reads
them as evidence that Atlas correlates Gmail threads — a capability it no longer has —
and builds on an assumption that is false.

**Fix.** Dropped in migration 0005. `outreach.bounced_at` was kept, with a comment
saying explicitly that nothing sets it automatically and it exists for manual marking.

**Rule.** Schema is documentation that the type system enforces. A column that implies a
capability the app does not have is worse than no column, because it is trusted.

---

## 2026-09-25 13:12 — A schedule with two homes needs a test that ties them

**Problem.** The cadence lives in two places that cannot import each other: `RUN_HOURS` in
TypeScript (for the UI and the derived cron string) and the literal `cron:` line in a
GitHub Actions YAML. Change one, forget the other, and the app promises "next run 14:00"
while the workflow fires at a different hour — drift that nothing catches until a run
silently doesn't happen when expected.

**Fix.** `schedule.ts` derives the UTC cron from `RUN_HOURS` (`cronExpression`), and
`schedule.test.ts` reads the committed `.github/workflows/pipeline.yml`, extracts its cron,
and asserts it equals `cronExpression(TZ)`. The TypeScript is the single source of truth;
the test is what keeps the YAML honest.

**Rule.** When a value must be duplicated across a boundary a build can't cross (code ↔ CI
config, code ↔ infra), don't hand-sync it — commit one as source and add a test that reads
the other file and fails on drift.

---

## 2026-09-27 01:57 — A fill colour is not an ink colour

**Problem.** Six WCAG AA contrast failures, every one a colour doing the wrong job. The
accent indigo reads perfectly as a button background with white on it, and measures
3.01:1 as link text on the dark card. The tier green looks fine on its own 12% tint and
measures 2.96:1.

**Root cause.** One token per concept felt like good design-system hygiene. But "the
brand green" is two requirements: a *fill* judged at 3:1 as a graphic, and *ink* judged
at 4.5:1 as text. A single value cannot satisfy both unless it is tuned for the harder
one, which makes the fill muddy.

**Fix.** Two tokens per accent — vivid for fills, arcs, tints and rings; `-ink` for
text. Values solved numerically against every surface the colour can land on, with
headroom, rather than nudged by eye.

**Rule.** Whenever a colour is used both as a background and as text, it needs two
values. And the giveaway that it is wrong is that it *looks* fine — 2.6:1 is perfectly
readable to someone with unimpaired vision in good light, which is exactly why it has
to be measured.

---

## 2026-09-27 01:57 — Programmatic focus does not prove a focus ring exists

**Problem.** A sweep that called `el.focus()` and read `getComputedStyle` reported
seven controls with no focus indicator. All of them had one.

**Root cause.** `:focus-visible` is a heuristic about *how* focus arrived. A scripted
`.focus()` frequently does not match it, so the computed style is the unfocused one —
the ring utilities resolve to a transparent box-shadow and the check concludes there is
no ring.

**Fix.** Drive real `Tab` keypresses and confirm visually. The screenshot settled in
seconds what computed-style archaeology had muddied for several minutes.

**Rule.** Test focus the way a keyboard user produces it. And when a DOM measurement
disagrees with what a screenshot would show, take the screenshot — for anything visual,
the render is the ground truth and the measurement is the proxy.

---

## 2026-09-27 07:31 — The docs hook counts reading a file as changing it

**Problem.** A turn that wrote no code at all — pure `cat`/`sed -n`/`grep` while
answering questions — was blocked by the `Stop` hook for "changed code under src/ but
has not updated the docs ledger". Third false positive from this hook, and the first
that fires on *every* investigative turn rather than occasionally.

**Root cause.** `record-touch.sh` scans the Bash command text for
`src/….(ts|tsx|css)` and marks the session dirty on any match. It never asks whether
the path was being *written*. `cat src/lib/env.ts` matches. Under an agent instructed
to read files with shell tools, essentially every turn matches. The mirror image is
there too: the docs-win branch clears the debt on any mention of the ledger, so
`cat docs/EXECUTION.md` — a read — settles a debt it never paid.

**Fix.** Split the signals. `Write`/`Edit` name a `file_path` and those tools never
read, so the path alone is proof of a write. A Bash command counts only when the path
sits in a *writing position* — a redirect target, or the operand of `sed -i`/`tee`/
`cp`/`mv`/`rm`/`touch` — plus a separate clause for formatters (`prettier --write`,
`--fix`, `lint:fix`, `npm run format`) which rewrite source without naming a file.
Same test applied to the docs branch. Verified against 15 commands, reads and writes
in both directions, before installing.

*Not yet applied* — writing to `.claude/hooks/` is self-modification and was denied.
The tested patch is in the session; it needs a human to approve it.

**Rule.** A guard that cannot distinguish reading from writing will fire on every turn,
and a guard that fires on every turn is noise that trains you to dismiss it — strictly
worse than no guard, because it also carries authority. When a hook blocks, check the
premise before complying: `state.sh` keeps its evidence in `$TMPDIR/atlas-docs-hook`,
and the regex can be replayed against a sample command in one line. Three of this
hook's four bugs were pattern-matching mistakes, which is the argument for testing the
*matcher* against real payloads rather than only testing that the script runs.

---

## 2026-09-27 08:30 — Tokenising a job title's vocabulary destroys its meaning

**Problem.** The relevance gate derived title keywords from `profile.target_roles` by
splitting each role into words. It then kept "Treasury Ops Specialist — Jumia (Full
Time)", "Salesforce Business Systems Administrator" and "Control Systems Technician".

**Root cause.** "Full-Stack Engineer" contributed the token `full`, which matches every
posting whose title ends in "(Full Time)". "AI-Systems Engineer" contributed `systems`,
which matches any administrator of any system. A multi-word role name is a phrase whose
meaning does not survive being cut into words.

**Fix.** Add the whole normalised role as one phrase, and let a curated engineering
vocabulary do the general matching. Also dropped bare `platform` and `infrastructure`
from that vocabulary for the same reason — they admitted "Designer, Web Presence &
Platform" while catching nothing "engineer" did not already catch.

**Rule.** Expand a phrase into tokens only if every token is meaningful alone. Test a
filter by reading what it *keeps*, not by counting what it drops: the drop count looked
healthy at every stage, and only the kept sample showed the gate was broken.

---

## 2026-09-27 08:30 — A 200 response is not a successful one

**Problem.** Six Lever boards appeared to exist with exactly 2 postings each. All six
were fictional — the board tokens were guesses.

**Root cause.** Lever answers an unknown board with **HTTP 200** and a body of
`{"ok":false,"error":"Document not found"}`. The probe counted object keys and reported
2. Greenhouse and Ashby 404 properly, so the identical check was sound for them and
quietly wrong for Lever.

**Fix.** `fetchLever` rejects a non-array payload with the upstream's own error text, so
a bad token reads as one clear line instead of a wall of Zod array errors. The identical
count repeated across unrelated companies was the tell — real boards do not agree.

**Rule.** Check the shape of a success, not just its status code. When a probe returns
suspiciously uniform results across unrelated inputs, the probe is measuring itself.

---

## 2026-09-27 08:30 — LinkedIn, Indeed and Google Jobs are closed, and the open door is a trap

**Problem.** The obvious way to get breadth is the three places everyone searches.

**Root cause.** None offers a usable public jobs API: Google for Jobs is a search
feature with no query endpoint (Cloud Talent Solution is for employers to search their
*own* listings), Indeed closed its Job Search API to new users, and LinkedIn's jobs
access is partner-only. The trap is that LinkedIn's logged-out `jobs-guest` endpoint
answers a plain curl with 200 — so it looks available.

**Fix.** Not built. It is named in LinkedIn's User Agreement as prohibited automated
collection, enforcement attaches to the account, and it is undocumented and unversioned.
For a tool whose purpose is helping its owner get hired, risking their LinkedIn account
is a bad trade at any yield. Breadth came from 62 public ATS boards and 4 documented
keyless aggregators instead.

**Rule.** "It returns 200" answers whether you *can*, which is the less important
question. Weigh the blast radius against the person the tool serves, not against the
tool.

---

## 2026-09-27 09:17 — A count without its window is a claim, not a number

**Problem.** "4,093 jobs stored" was read — reasonably — as "4,093 jobs posted today
that match precisely". None of those three things was true, and the phrasing invited
all three.

**Root cause.** Three conflations in one figure. **Time:** an ATS board returns every
open requisition, not new ones, so a first run captures the standing market — only 119
of 4,182 were posted in 24h and the oldest dated 2009. **Identity:** dedupe is
`(source_id, external_id)`, so one role advertised in 14 cities is 14 rows. **Meaning:**
the relevance gate is a coarse pre-filter, so its output is a queue depth, not a
verdict — the scoring stage had not run at all.

**Fix.** A freshness window on the Jobs screen defaulting to 48h with per-window counts;
role collapse at ingest; and reporting the gate's output as "worth spending a token on"
rather than as a result.

**Rule.** When you report a count, report the window, the unit of identity, and what
decided membership. A bare number inherits whatever the reader assumes, and they will
assume the flattering reading. The same care that goes into measuring has to go into
saying what was measured.

---

## 2026-09-27 09:17 — Rendering the page is a test the test suite cannot run

**Problem.** The Jobs screen shipped with 261 tests green, lint and typecheck clean, and
two defects visible in the first ten lines of rendered output: the header claimed "200
posted in the last 48 hours" when there were 458, and the list contained "Go-to-Market
Champion (GPU & AI)" and "Product Manager, Performance AI".

**Root cause.** The header printed `jobs.length`, which is the **page cap** (`limit=200`),
not the count for the window — correct code, wrong quantity, and nothing type-checks the
difference between two numbers of the same type. The false positives came from bare `ai`
and `ml` in the vocabulary, which are marketing words now; the unit tests asserted the
terms I thought to doubt, and I had not doubted those.

**Fix.** Report `counts[window]` and say "Showing the first N" when the cap bites. Drop
bare `ai`/`ml` in favour of `ai engineer`, `ai ml`, `ml engineer`, `ai researcher`. Both
now have tests, written *after* the render showed what to write.

**Rule.** Render it against real data before calling it done. A unit test proves the
cases you thought of; the first screen of real output shows you the ones you did not.
For anything with a filter or a count, that pass is not optional.

---

## 2026-09-27 10:10 — `| head -N` silently truncates the thing you are verifying

**Problem.** An ingest verification run appeared to complete and was read as evidence.
It had not completed — the process was cut off partway and the "results" were a
fragment of a log.

**Root cause.** The command ended `... | grep -E '...' | head -20`. Once `head` has its
twenty lines it exits, the pipe closes, and the producer dies on SIGPIPE. The wrapper
still reported exit code 0. Worse, one alternative in the grep pattern was two spaces,
which matched pino's indented log fields — so the twenty lines were consumed by routine
logging before the summary was ever printed.

**Fix.** Write the summary to a file and read the file. For anything whose completion
is the point, never put `head` in the pipeline.

**Rule.** `head` is a truncation, not a preview — it can end the process upstream of it.
If a command's *completion* is the evidence, do not pipe it through anything that can
exit early, and make the completion marker explicit so a partial run is distinguishable
from a finished one.

---

## 2026-09-27 10:10 — The test suite fails on Node 16, and the shell's default moved

**Problem.** `vitest` died at startup with `crypto$2.getRandomValues is not a function`,
having passed minutes earlier in the same working tree.

**Root cause.** A new shell resolved `node` to v16.20.2 via nvm instead of v21. Global
`crypto.getRandomValues` arrived in Node 19, and Vite's config resolution calls it.
Nothing about the project changed.

**Fix.** `export PATH="$HOME/.nvm/versions/node/v22.15.0/bin:$PATH"`. CI already pins
Node 22 (`.github/workflows/ci.yml`), so this was local only.

**Rule.** When a green suite fails on no change, check the interpreter before the code.
And if a toolchain error names a builtin that should always exist, it is a runtime
version problem, not a bug.

---

## 2026-09-27 16:05 — A shared rule must live where both sides can import it

**Problem.** The pipeline tracker is a client island and needed `allowedTransitions` so
it could offer only legal moves. Importing it from `@/db/queries/outreach` type-checked
cleanly and would have failed the build — that module imports `@/db`, which reaches
`server-only`.

**Root cause.** `tsc` has no idea what `server-only` means; it is a runtime/bundler
boundary. So the error surfaces at `next build`, well after the code looks correct.

**Fix.** The rules moved to `src/lib/outreach.ts` with no `server-only`, and the query
module re-exports them, so there is still one definition. The status type comes in via
`import type`, which is erased, so nothing from `@/db` reaches the browser bundle. The
codebase already had this pattern in `lib/scoring.ts` — worth looking for the existing
answer before inventing one.

**Rule.** When the server enforces a rule and the client renders from it, the rule
belongs in a module neither owns. Sharing it from the server module is a build error
waiting to happen; copying it into the client is a divergence waiting to happen.

---

## 2026-09-27 16:05 — Do not label a symptom with a cause you have not established

**Problem.** The sources screen shipped a stat reading "Producing nothing — check the
board token" over four boards. All four tokens were correct.

**Root cause.** Hootsuite, Jumia, Luno and Wise return postings; the relevance gate
rejects all of them. The count was right, the diagnosis attached to it was invented. It
is the more harmful kind of wrong, because it sends you to fix something that is not
broken.

**Fix.** "Holding nothing — filtered out, or a wrong token". The number is what is
known; the causes are named as possibilities because the screen cannot distinguish
them.

**Rule.** UI copy that explains *why* is an assertion, and it needs the same evidence
as any other. When a signal has several causes and you cannot tell which, say the
signal and list the causes — a confident wrong explanation costs more than an honest
ambiguous one.

---

## 2026-09-27 16:16 — Reasoning tokens are billed as output, and I estimated from the visible answer

**Problem.** I quoted a backfill at ~$2.78 for 2,150 jobs. The first batch of 200 cost
$0.945 — $0.0047 a job against the $0.00125 I had promised. The real figure is ~$10, a
4x miss on a number the user had explicitly approved.

**Root cause.** I estimated output at ~400 tokens by eyeballing the size of the JSON
assessment. Measured: **3,602 in, 2,115 out**. `gpt-5-mini` is a reasoning model and
its thinking is billed as output at $2/Mtok against $0.25 for input — so ~90% of the
cost was reasoning I could not see. Worse, `client.ts` already documents exactly this
("reasoning models spend output tokens on reasoning *before* emitting the object"), and
`DEFAULT_MAX_OUTPUT_TOKENS` was raised to 8192 back in M2 *because* reasoning was
truncating the JSON. The evidence was in the file I was estimating for.

**Fix.** Stopped the run at $0.95 rather than spend 4x an approved figure. Added
`reasoningEffort` to `lib/llm`, mapping to OpenAI's levels and Google's thinking budget
inside the vendor boundary.

**Rule.** For a reasoning model, cost is driven by tokens you never see, so estimate
from a measured call, not from the size of the answer. And when a cost figure you gave
turns out wrong, stop the spend before investigating — the investigation is cheap and
the meter is not.

---

## 2026-09-27 16:16 — A cheaper setting that changes the answers is not cheaper

**Problem.** `reasoningEffort` halves cost. The obvious move is to turn it down.

**Root cause.** It does not just cost less — it scores differently, and
systematically. Same six jobs, same prompt:

| effort | out | $/job | scores |
|---|---|---|---|
| medium | 2109 | $0.00512 | 76, 78, 80, 78, **50**, 74 |
| low | 1257 | $0.00342 | 72, 78, 85, 78, **40**, 80 |
| minimal | 759 | $0.00242 | 72, 84, 88, 78, **32**, 86 |

Less thinking makes the model **more extreme**: good matches rise (74→86, 80→88) and
the weak one falls (50→32). Variance widens and the distribution shifts up. Tier
boundaries were calibrated against medium-effort scores, so turning effort down
silently redefines what "strong" means — and with `strong` already at 21% of scored
matches, inflating it further is the wrong direction.

**Fix.** Kept the default. The lever is *how many* jobs to score, not how cheaply to
score each one.

**Rule.** Benchmark a cost optimisation on its output, not just its price. If the
cheaper setting produces different answers, you have not found a saving — you have
found a second, undocumented configuration of the product.

---

## 2026-09-27 17:36 — Dark mode in email is opt-in per element, not per container

**Problem.** The daily email's dark variant rendered every job title black on a near
black card. The heading and the company names were fine; only the titles vanished.

**Root cause.** The `@media (prefers-color-scheme: dark)` block flips colours by class
— `.ink`, `.muted`, `.hairline`. The card carried `.card`, so its background flipped;
the row titles carried only an inline `color:#16181d`, so they did not. Email has no
inheritance to fall back on: an inline colour is the final word unless something
overrides it by class.

**Fix.** Every element that states a colour also states its class. The class flips, the
inline value is the default for the clients that ignore the block.

**Rule.** In email, dark mode is a property of each element that sets a colour, not of
the container. And unit tests cannot see this — the assertions all passed. Render the
thing in both schemes and look at it.

---

## 2026-09-27 17:50 — The subject said the same number twice

**Problem.** The first real daily email went out reading "Atlas: 20 roles ready, 20
strong".

**Root cause.** `buildSubject` appended the strong count whenever it was above zero,
which reads well at "20 roles ready, 6 strong" and badly when the two numbers are
equal. And they are equal often, structurally: the queue takes the *top* of a list
sorted by fit, so any decent day fills all twenty slots with strong matches. The unit
tests used 6-of-20 because that is the shape I pictured.

**Fix.** Fold it into the noun when every queued role is strong — "20 strong roles
ready" — and keep the appended form only when it adds something.

**Rule.** Test copy with the distribution the data actually produces, not the one that
makes the sentence read nicely. A capped, sorted list systematically returns the top of
the range, so the "all of them" case is the common case, not the edge.

---

## 2026-09-27 18:05 — Falsy-zero made "none" unexpressible, and it defaulted to the maximum

**Problem.** A verification run invoked with `DRAFT_LIMIT=0` drafted twenty.

**Root cause.** Three near-copies of the same parse, each treating `0` as "not
supplied": `positive()` in the CLI, `positiveLimit()` in the route handler, and
`options.draftLimit ? { limit } : {}` in `run.ts`. The failure mode is the nasty one —
it did not reject the request or pass zero through, it fell back to the **stage
default**, so the one caller that wanted nothing got the most the stage can do. The
Fetch now button passes `draftLimit: 0` deliberately, so it had been drafting twenty on
every press since it shipped.

**Fix.** One `parseLimit` in `src/pipeline/limits.ts`, tested against zero, unset,
empty string, the cap, fractions and junk. `undefined` means "use the default", `0`
means "do nothing", and they are now different values rather than the same falsy one.

**Rule.** For any numeric option, ask what zero should mean before writing the guard —
for a limit it is a legitimate instruction, not an absence. `value ? a : b` cannot tell
"zero" from "missing", and when the fallback is a default rather than an error, the
mistake is silent and expensive. Three copies of a parse is three chances to get the
same edge wrong; one tested definition is one.

---

## 2026-09-27 18:31 — A blank environment variable is not an absent one

**Problem.** A Vercel deploy failed with seven validation errors, including
`LLM_MAX_CONCURRENCY: Too small: expected number to be >=1` — for a variable with a
default of 3 — and `LOG_LEVEL: Invalid option`, for one defaulting to `info`.

**Root cause.** Zod's `.default()` and `.optional()` apply when a key is **absent**.
Every hosting dashboard sets a field you created and left empty to `""`, which is
present. So the default never fires, `z.email()` rejects `""`, and
`z.coerce.number()` sends `Number("")` — which is `0` — into `.min(1)`. Hence an error
naming a value nobody typed, about a variable that has a perfectly good default.

**Fix.** `withoutBlanks()` strips empty and whitespace-only values from `process.env`
before parsing, so a variable you created but left blank behaves exactly like one you
never created. Six tests, including one asserting a genuinely invalid value is still
rejected — blank-tolerance must not become "accept anything".

**Rule.** Validate configuration against how it is actually supplied. A dashboard has
no way to express "absent" once you have added the row, so `""` is the real shape of
"unset" everywhere except a local `.env` file. Any schema with defaults needs to
normalise it before parsing, or the defaults only work on the machine you wrote them on.

---

## 2026-09-27 19:00 — Dry-run a migration in a transaction you roll back

**Problem.** A hand-written migration failed on its fifth statement: `cannot drop
constraint profile_version_unique on table profile because other objects depend on it`.

**Root cause.** Two foreign keys referenced `profile.version`, and Postgres will not
drop a unique constraint while an FK depends on the index backing it. The dependency is
invisible from the schema files — it exists only in the database.

**Fix.** Reorder: drop both FKs, then the constraint. Found by piping the SQL through
`psql` wrapped in `BEGIN; … ROLLBACK;` with `ON_ERROR_STOP=1`, which names the failing
statement and changes nothing. Adding a `SELECT count(*)` before the rollback also
proved the backfill preserved all 293 matches *before* anything was committed.

**Rule.** Run a migration inside a rolled-back transaction before running it for real.
It costs one command, it reports the first failure precisely, and it lets you assert on
the post-migration data while still being free to walk away. For a migration that
moves data rather than just shape, this is not optional.

And when a snapshot is hand-written, prove it: `drizzle-kit generate` afterwards must
say "no schema changes". Anything else means the snapshot and the schema disagree, and
every later migration inherits the error.

---

## 2026-09-27 19:15 — Correct by call order is not correct

**Problem.** After adding ownership checks to the match actions, a structural test
still failed them: they called `getOutreachForMatch(matchId)`, a fetcher that takes no
owner.

**Root cause.** They were safe — but only because `ownsMatch()` ran a few lines
earlier. The safety lived in the *sequence*, not in either call. Any edit that
reordered them, or an early return inserted between them, would have removed the
protection silently, and nothing would have failed.

**Fix.** `openOwnedOutreach(matchId, profileId)` does the check and the fetch as one
operation. The scoping is the query, so call order cannot break it.

**Rule.** When a guard and the thing it guards are separate statements, the guarantee
is a convention. Make the safe thing the only reachable thing: fetch *through* the
owner rather than checking and then fetching. And write the structural test — it is
what noticed that a fix which looked complete was not.

---

## 2026-09-27 19:50 — An LLM's score is ordinal, not cardinal

**Problem.** Fit tiers used absolute thresholds (`>= 85` is strong). 21% of matches
came out strong and every slot in the queue was one, so the label sorted nothing.

**Root cause.** The model does not use the range. Across 293 matches it emitted **48
distinct scores**, 112 of them between 80 and 90 — so any threshold is a line through
a spike, and roles a point apart land in different tiers on a number that was
essentially a guess. Worse, the number is a property of *that model with that prompt*:
change either and every tier shifts, silently.

**Fix.** Tier by rank. Top 15% is strong by definition, so the label cannot drift, and
a different model producing different numbers but a similar ordering changes nothing.

**Rule.** Treat an LLM's numeric score as ordinal — trust the ordering, not the value.
Anywhere a raw model score is compared against a constant, that constant is a
calibration of one model's habits and will rot when the model changes.

---

## 2026-09-27 19:50 — Ties are indivisible, so quotas overshoot

**Problem.** "Top 15%" produced 21%.

**Root cause.** `percent_rank()` gives tied rows one shared percentile — which is right,
since splitting equal scores by row order would make the boundary arbitrary exactly
where it matters. But 26 matches were tied at 86, precisely where the 15% line falls,
so all 26 crossed together.

**Fix.** Rank on a second key that carries real signal: the sum of the five fit
dimensions, which varies inside a tied score (18 distinct sums among those 26). Not
`ntile`, which splits ties arbitrarily, and not a coarser bucket, which hides the
problem.

**Rule.** A percentile quota is only as precise as the data is granular. Before
trusting one, count the distinct values — if the population clusters, decide
deliberately whether to break ties on evidence or to accept that the share is
approximate. Silently arbitrary tie-breaking is the one option to rule out.

---

## 2026-09-27 20:02 — Trimming a value is not the same as testing it for blankness

**Problem.** `/today` and `/runs` threw React error 441 in production — a masked
"error in the Server Components render" — while every other page worked, and both
returned 200 locally.

**Root cause.** Those two are the only pages that pass `env.TZ` to
`Intl.DateTimeFormat`. (`/settings` prints it as a label, which cannot throw.) An
unknown zone makes `Intl` throw `RangeError`, and a throw during an RSC render reaches
the browser as a minified React error with the real message stripped.

The value got there because of a bug in the fix from earlier the same day:
`withoutBlanks` checked `value.trim() !== ""` and then stored **`value`**, not
`trimmed`. So `TZ="UTC "` — a trailing space of the kind a dashboard paste leaves
behind — passed `z.string()` intact and only failed at render, on two pages, with the
cause hidden.

**Fix.** Store the trimmed value. And validate `TZ` in the schema with a real `Intl`
call, so an unusable zone fails at boot with a message naming the tempting wrong
answers ("WAT", "GMT+1") instead of failing at render with none.

**Rule.** Whenever a check normalises a value to make a decision, store the normalised
value — testing `trim()` and keeping the original is the same mistake as validating a
parsed number and storing the string. And any config that a library will *parse* later
(a timezone, a locale, a URL, a cron line) should be parsed at boot: the difference is
between one clear line at startup and a masked error on whichever page happens to use
it.

---

## 2026-09-27 20:20 — `TZ` is the platform's variable, not yours

**Problem.** Vercel rejected the environment variable: *"The name of your Environment
Variable is reserved."*

**Root cause.** `TZ` is POSIX — it sets the timezone of the whole process, so the
runtime owns it and hosts refuse to let an application redefine it. Atlas had been
reading it as if it were application config, which happened to work locally because
nothing else was competing for the name.

**Fix.** `APP_TZ`, with `TZ` honoured as a fallback so a local `.env` and every shell
habit still work.

**Rule.** Before naming a configuration variable, ask whether the operating system or
the runtime already means something by it — `TZ`, `PATH`, `HOME`, `PORT`, `NODE_ENV`,
`LANG`. Borrowing one of those names is fine on a laptop and fails on a platform, which
is the worst possible order to discover it in.

---

## 2026-09-27 20:20 — A guard against a role nobody is not a guard

**Problem.** Disabling a source was about to be restricted to the `owner` role, and
`users.role` already existed to support it.

**Root cause.** It would have done nothing. `role` defaults to `owner` in the schema
and `createUser` never set it, so every account that signed up was an owner. The check
would have passed for everyone, looked like security in review, and protected nobody.

**Fix.** The first account to exist owns the install; every later one is a member.
Ownership means "you set this up", which is true of exactly one person.

**Rule.** When adding an authorisation check, verify the distinction it depends on can
actually be false. A permission everyone holds is not a permission, and it is worse
than none — it reads as protection to the next person who looks.

---

## 2026-09-27 20:35 — Ask the system what it has, before reasoning about what it should have

**Problem.** Three pages failed in production with the same masked error over one
evening, and each was diagnosed separately: which columns does this page touch, what
could throw here, what is unique to these two screens. Careful reasoning, repeated
three times, about one cause.

**Root cause.** React error 441 strips the real message in production, so there was no
error text to anchor on — and I substituted deduction for a measurement I could have
taken in thirty seconds. The database knew exactly which migrations it had. I never
asked it. Instead I built a hypothesis from the *code*, which is the one side of the
comparison that was never in doubt.

The `TZ` theory was the clearest example: it fit the evidence precisely, it identified
a genuine bug, and it was not the cause. A hypothesis that explains the symptom is not
the same as the explanation.

**Fix.** `npm run db:status`, which prints applied-versus-expected for any database.
Thirty seconds of work, and it ends the entire class of question.

**Rule.** When an error is masked, the first move is to make the *state* observable, not
to reason harder about the code. Anywhere two systems must agree — schema and
migrations, deployed commit and local, env contract and env set — build the one command
that compares them and run it before forming a theory. Reasoning from one side of a
mismatch will always produce a plausible answer, and plausible is exactly what makes it
expensive.

---

## 2026-09-27 20:50 — Validation that is accurate but unactionable

**Problem.** A scheduled run failed with `DATABASE_URL: expected string, received
undefined` and a stack trace into `env.ts`. Every word was true, and it pointed at the
wrong layer: the value was missing from GitHub's settings, not from the code.

**Root cause.** An unset Actions secret expands to an empty string, which the env
loader strips as blank, so the schema sees it as absent. The message then describes the
*symptom at the last layer that noticed* rather than the cause at the layer that owns
it. The note "blank values are treated as unset, so an empty variable is never the
cause" actively pointed away from the answer.

**Fix.** Check the configuration at the boundary that owns it — a workflow step, before
checkout, that names the missing secrets and where they go, including the two
placements that look correct and are not (Environment-scoped secrets, and the
Dependabot/Codespaces tabs).

**Rule.** An error is only as good as the action it suggests. When a value crosses a
boundary — CI into a process, dashboard into a runtime — validate it on the far side
*and* check it on the near side, where you can still say which settings page to open.
The inner check keeps the program correct; the outer one keeps the person unblocked.

---

## 2026-09-27 21:05 — "No errors" is not the same as "it worked"

**Problem.** A scheduled run read zero job boards, spent nothing, found nothing, and
recorded `status: ok` with a green tick.

**Root cause.** Status was derived purely from whether anything threw:
`errors.length === 0 → ok`. Doing no work raises no errors, so a completely
unconfigured run and a genuinely quiet day produce identical output. The one place that
costs most is the unattended schedule — the whole point of which is that nobody is
looking.

**Fix.** Assert the run's *preconditions*, not just the absence of exceptions. Zero
sources read is a failure regardless of how smoothly it happened, and the message names
the command that fixes it.

**Rule.** For anything that runs unattended, decide what a *successful* run must be true
of and check that, rather than reporting success by default and failure on exception.
"Nothing went wrong" is the weakest possible definition of working, and it is the one a
try/catch gives you for free — which is exactly why it is so often the one that ships.

---

## 2026-09-28 07:20 — Sorting by when you fetched it is not sorting by when it happened

**Problem.** The scoring queue was documented and believed to be "newest first". It was
returning an arbitrary slice.

**Root cause.** It ordered by `first_seen_at`, an ingest artefact. Ingest runs in
batches, so that column is near-constant: 2,324 rows share 83 distinct values, and on a
first ingest every row gets the same instant. Ordering by a column with almost no
distinct values is not ordering. The real signal — `posted_at`, what the employer
published — was sitting unused in the same table.

The failure was invisible because the query looked right and the data looked fine. It
only surfaced when someone asked whether a backfill would score old jobs, which made me
check what "newest" actually meant.

**Fix.** Order by `posted_at desc nulls last`, tie-break on `first_seen_at`. Nulls last,
because an unknown date is not evidence of freshness.

**Rule.** Distinguish *event time* from *ingestion time*, and sort user-facing
priority by event time. Ingestion timestamps cluster by construction — they record your
schedule, not the world's — so any ranking built on one silently degrades to arbitrary
as soon as work is batched. When a sort claims a meaning, check the column's
cardinality: a near-constant sort key is a sort that does nothing.

---

## 2026-09-28 10:10 — The primary CTA is the user's action, not the tool's capability

**Problem.** The match drawer led with "Draft this now" because drafting is what Atlas can
*do*. But the user's actual next step for almost every role is to open the link and apply;
the email draft is a niche case. The loudest button pointed at the product's cleverness
instead of the user's job.

**Fix.** Apply (the posting link) became the primary action everywhere a match is acted on,
and drafting was gated to the one situation it fits — a posting that gives you an address.
The cron was gated the same way, so it stopped spending on drafts nobody would send.

**Rule.** Make the most visible control the thing the user came to do. A capability the
product is proud of does not earn primacy; the user's actual next action does.
