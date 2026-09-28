# Execution log

Append-only, newest last. One entry per meaningful step: what the situation was, what
was done, what came of it, and which files moved. Timestamps are `Africa/Lagos` (WAT),
matching `TZ` in `.env.local`.

This is the *narrative* of the build. For reusable lessons see [LEARNINGS.md](LEARNINGS.md);
for design decisions see [INTERFACE.md](INTERFACE.md).

> **Note on the PRD path.** The PRD lives at `docs/atlas-prd.md`. Its own §14 refers to
> `docs/PRD.md`. Same document — not renamed, so links from the original prompt still
> make sense.

---

## 2026-09-24 17:48 — M0: skeleton

**Context.** Empty repo. PRD §13 M0 asks for an App Router app, the Drizzle schema
including `strengths` + `evidence`, local Postgres, typed env, auth, logging and CI.

**Action.** Next.js 16.3.6 App Router + React 19. Drizzle schema across ten tables
(`users`, `sources`, `jobs`, `profile`, `strengths`, `evidence`, `matches`, `drafts`,
`outreach`, `runs`) with eight pgEnums; one migration `0000_flaky_black_queen`.
`docker-compose.yml` for Postgres 17 on host port 5433. Zod-validated env in
`src/lib/env.ts`. Auth.js v5 with credentials + Argon2id. Pino logging. GitHub Actions
running lint → typecheck → test → migrate → build.

**Result.** App boots, does nothing yet — as intended.

**Files.** `src/db/schema/*`, `drizzle/0000_*`, `src/lib/{env,logger,password,session}.ts`,
`src/auth*.ts`, `.github/workflows/ci.yml`, `docker-compose.yml`

---

## 2026-09-24 23:09 — M1: ingest + dedupe

**Context.** PRD §8 stages 1–3. One ToS-clean source, proven idempotent.

**Action.** Greenhouse fetcher against the public boards API, normalized into the shared
`NormalizedJob` shape. Static fetcher registry keyed by `source_kind`. Ingest writes
through `onConflictDoNothing` on the `(source_id, external_id)` unique index.

**Result.** 88 Vercel postings ingested. Second run inserts 0 — idempotency proven.

**Files.** `src/pipeline/ingest.ts`, `src/pipeline/sources/*`, `src/db/queries/{jobs,sources}.ts`

---

## 2026-09-24 23:44 — M2 (first pass): strengths + scoring

**Context.** PRD §9. Score each job against structured strengths, not a CV blob.

**Action.** `atlas-candidate-profile.md` seeded into `profile` / `strengths` / `evidence`
(v1: 9 strengths, 19 evidence items) via `db:seed:profile`, which parses the first
` ```json ` block and upserts in one transaction. Scoring written against
`@anthropic-ai/sdk` using forced tool use for structured output.

**Result.** Worked in principle, but welded to one vendor — see the next entry.

**Files.** `src/db/seed-profile.ts`, `src/pipeline/scoring/*`, `src/db/queries/{profile,matches}.ts`

---

## 2026-09-25 00:20 — Refactor: LLM layer onto the Vercel AI SDK

**Context.** Two problems with M2's scoring. First, `score.ts` imported
`@anthropic-ai/sdk` directly, read `ANTHROPIC_API_KEY`, and hand-wrote an Anthropic
tool-use JSON Schema — switching providers meant rewriting the prompt plumbing, the
schema and the call site. Second, and decisive: **the Anthropic account has no
credits**, so scoring could not run at all. The provider-agnostic seam became a
prerequisite, not a nicety.

**Action.**

1. Verified live model availability against the keys in `.env.local` by calling each
   provider's `/models` endpoint. Confirmed working access to Groq
   (`qwen/qwen3.8-27b`, `openai/gpt-oss-120b`), Gemini (`gemini-3.8-flash`,
   `gemini-3.1-pro-preview`) and OpenAI (`gpt-5.2`, `gpt-5-mini`).
2. Installed `ai@7` + `@ai-sdk/{anthropic,openai,google,groq}`; removed
   `@anthropic-ai/sdk`. Read the installed `.d.ts` rather than trusting recall — see
   LEARNINGS for the three API shapes that differ from what you'd expect.
3. Built `src/lib/llm/`: `config.ts` (provider + key resolution), `client.ts`
   (`generateStructured`, retry, concurrency, usage), `pricing.ts`, `errors.ts`,
   `index.ts`, `smoke.ts`.
4. Rewrote the pipeline against it. `prompt.ts` now splits the invariant profile
   prefix into `system` and the posting into `prompt`; `schema.ts` replaced
   `buildAssessmentTool` with `buildAssessmentSchema` (a Zod schema with
   `strength_key` constrained by `z.enum`); `score.ts` calls `generateStructured` and
   runs jobs through a bounded-concurrency map instead of a serial loop.
5. Enforced the boundary two ways: `no-restricted-imports` in `eslint.config.mjs`, and
   `boundary.test.ts` which walks `src/` for provider imports *and* API-key references.
   Both were verified by planting a violating file and watching them fail.

**Result.** 59 tests green, typecheck and lint clean, production build clean.
`npm run llm:smoke` returned schema-valid output from OpenAI, Google and Groq off one
identical Zod schema; Anthropic failed with "credit balance is too low", confirming the
diagnosis.

**Files.** `src/lib/llm/*` (new), `src/pipeline/scoring/{prompt,schema,score}.ts`,
`src/lib/env.ts`, `eslint.config.mjs`, `vitest.config.ts`, `.env.example`, `package.json`

---

## 2026-09-25 01:05 — Choosing the default provider by measurement

**Context.** With four providers wired, which should ship as the default? The answer
came from running real batches, not from the spec sheet.

**Action.** Scored real job batches on each candidate and recorded what happened.

| Provider / model | Result |
|---|---|
| `google` / `gemini-3.8-flash` | 3/5 scored. Free tier caps at **5 requests/minute**. |
| `groq` / `qwen/qwen3.8-27b` | 7/12 scored. Free tier caps at **7k input tokens/minute** — about 2 jobs/min at this prompt size. Fastest per call (839ms) but the cap binds. |
| `openai` / `gpt-5-mini` | 6/15, then **15/15** once the output ceiling was fixed. Paid tier, no throttling. |

Two fixes fell out of this:

- **Honor `retry-after`.** Blind backoff capped at 8s while Gemini asked for ~15s, so
  every retry failed too. `retryAfterMs` now reads the header, and falls back to parsing
  the delay Google only puts in the message body.
- **Raise `maxOutputTokens` 2048 → 8192.** The 9 `gpt-5-mini` failures were not confused
  models; they were truncation. See LEARNINGS.

**Result.** Default is `openai` / `gpt-5-mini` for scoring, `gpt-5.2` for drafting.
Measured on 15 real jobs: **15/15 scored, 0 failures, 1m53s, ~$0.005/job, and 41,984 of
53,769 input tokens served from cache (78%)** — the payoff from moving the invariant
profile prefix into `system`.

Scoring output is honestly calibrated, which is what PRD §9 asks for: across 31 scored
jobs, 1 strong / 11 possible / 19 stretch. Top match "Software Engineer, AI SDK" at
Vercel, 87, with a `why_you` citing real evidence from the seeded profile.

**Files.** `src/lib/llm/client.ts`, `src/lib/env.ts`, `.env.example`

---

## 2026-09-25 01:15 — Docs ledger + the logging hook

**Context.** Every new session was re-deriving the same context. Standing fix requested:
three durable docs plus a hook that keeps them current.

**Action.** Created this file, `LEARNINGS.md` and `INTERFACE.md`, seeded with the real
M0→M2 history rather than empty headers. Added a project-scoped hook in
`.claude/settings.json` with three scripts: `inject-docs.sh` (SessionStart) puts the
docs into context, `record-touch.sh` (PostToolUse) tracks what a session touched, and
`require-docs.sh` (Stop) blocks a turn that changed `src/` without logging anything.

**Result.** A fresh session starts with the history, and a session that changes code
cannot quietly end without recording why.

**Files.** `docs/{EXECUTION,LEARNINGS,INTERFACE}.md`, `.claude/settings.json`,
`.claude/hooks/*`, `.gitignore`

---

## 2026-09-25 09:20 — M2 UI: the console table, the fit gauge, the drawer

**Context.** M2's remaining half (PRD §13): "the Matches table (Server Component) with
the fit gauge and the strengths-rewarded readout in the drawer. First 'wow.'" Until now
Matches rendered a flat list of cards, the score was a plain number, and there was no
drawer. Today's stat strip was hardcoded to `"0"`.

**Action.**

- **`fit-gauge.tsx`** — the hero (§10.2). A 260° dial, open at the bottom, coloured by
  the semantic `--tier-*` tokens. Sweeps 0 → value once on mount via a spring, never
  again; `prefers-reduced-motion` collapses it to instant, not merely slower. The arc
  math is extracted as a pure `gaugeArc()` and unit-tested — a gauge that draws the
  wrong fill is a lie about the one number the product exists to communicate.
- **`matches-table.tsx`** — the console table as a client island inside the
  server-rendered page. Sortable on all five columns, filterable by tier and free text.
  Keyboard-first per §10.3: `j`/`k` move, `enter` opens, `/` focuses the filter,
  `escape` clears it. Follows the ARIA grid roving-tabindex pattern, so Tab steps past
  the table rather than through every row.
- **`match-drawer.tsx`** — Radix Dialog as a right-hand sheet, in the order you actually
  read it: gauge, why-you, the strengths this role rewards (with meters), the
  five-dimension breakdown, reasoning, red flags, then the posting. This is the one
  component in the app that carries a real shadow (§10.1).
- **`tier-chip.tsx`** — closes an INTERFACE open item. Tier colour now comes from the
  `--tier-*` tokens via `color-mix`, not raw palette classes.
- **`matches/loading.tsx`** — a skeleton matching the table's real geometry, so nothing
  shifts when rows land.
- **Today** now reads real data: counts come from one SQL aggregate rather than loading
  every row, and the top four matches render as cards. This is the product's single
  orchestrated motion moment (§10.4) — cards stagger in once, each gauge sweeping behind
  its card. Nowhere else does a card fade up (§10.5).
- **`listMatchRows()` / `getMatchCounts()`** — a lean, fully serializable view model for
  the client island. Dates are pre-formatted on the server (formatting them on the client
  risks a locale hydration mismatch) and postings are decoded to text and capped, since
  raw job HTML was by far the largest thing in the payload.

**Result.** 67 tests green; typecheck, lint and production build clean.

One lint finding worth keeping: the first version clamped the table cursor inside a
`useEffect`, which React flags as a cascading render. Clamping is derived state — it now
happens during render, and the only remaining effect is the one syncing DOM focus, which
is genuinely external.

**Files.** `src/components/{fit-gauge,matches-table,match-drawer,tier-chip,match-card}.tsx`,
`src/app/(app)/matches/{page,loading}.tsx`, `src/app/(app)/today/page.tsx`,
`src/db/queries/matches.ts`, `src/components/fit-gauge.test.ts`, `src/lib/scoring.test.ts`

---

## 2026-09-25 09:35 — Visual pass on the M2 UI

**Context.** "Review your own output visually and iterate — do not ship the first
render." Every screen sits behind the Auth.js login, and entering a password is not
something I do, so review ran against a temporary dev-only route rendering the same
components with real data. It was deleted before the commit; `git status` and a grep
confirm nothing references it.

**Action.** Checked at 375px, 666px and 1280px, in both themes, and drove every
keyboard path. Five real defects came out of it — none of which the build, types, lint
or tests would ever have caught.

1. **Escape dumped focus on `<body>`.** The drawer is opened programmatically, not from
   a Radix trigger, so Radix had nothing to restore focus to. After one Escape, `j`/`k`
   silently stopped working — the exact user this feature exists for. Fixed with
   `onCloseAutoFocus` + `preventDefault`, which is where Radix actually owns close
   focus; calling `focus()` from `onOpenChange` runs too early and is overwritten.
2. **Every strength label was truncated** in the drawer — "Fintech-grade reliability +
   AI syste…". Two `flex-1` siblings split the row 50/50, giving a decorative meter the
   same width as the content. The meter is now fixed-width and the label takes the rest.
3. **The table overflowed its rounded container on mobile** and was clipped rather than
   scrollable. `table-layout: auto` sizes columns to content, which ignores declared
   widths and makes `truncate` a no-op. `table-fixed` fixed both.
4. **A 64px dial ate a quarter of a 375px card.** The gauge now carries its geometry in
   viewBox units and scales through CSS, so one component covers both sizes without a
   second instance or a second animation.
5. **The `md` score was under-scaled** inside its ring — `text-lg` in a 64px dial, for
   the number the whole product is about. Now `text-base sm:text-xl`.

**Verified working:** `j`/`k`/`enter` navigation; Escape closing and returning focus to
the originating row; `/` focusing the filter; the typing guard (`j` and `k` type into
the filter instead of navigating); filtering narrowing 31 rows to 2; sort indicators;
dark mode across table, cards and drawer; no horizontal overflow at 375px.

**Not browser-verified:** `prefers-reduced-motion`. It is wired through
`useReducedMotion()` in both animated components and collapses transitions to
`duration: 0`, but no emulation was available here — it is code-verified only.

**Files.** `src/components/{fit-gauge,match-drawer,matches-table}.tsx`

---

## 2026-09-25 09:55 — End-to-end verification, and a timeout the run needed

**Context.** Final M2 check: prove the pipeline works end to end and that both
idempotency guarantees the PRD requires actually hold.

**Action.** Ran the pipeline against the live database and compared before/after.

**Result — both guarantees verified:**

- **Ingest:** 89 postings seen, **0 inserted, 89 duplicates**. Re-ingestion is a no-op
  against the `(source_id, external_id)` unique key.
- **Scoring:** matches went 31 → 33, and the top match's `scored_at` was **byte-identical
  before and after** — already-scored jobs are not re-scored. Prompt caching stayed
  active (3,456 of 7,257 input tokens served from cache). 2 scored, 0 failed.

**But the run took over fifteen minutes for two jobs.** The retries recovered, so the
result was correct and the failure was invisible in the output — the calls had simply
hung. Neither the AI SDK nor `fetch` imposes a wall clock, and retry logic only engages
once a call *fails*.

Every attempt now carries `AbortSignal.timeout(LLM_REQUEST_TIMEOUT_MS)` (default 60s),
combined with any caller signal, fresh per attempt. A timeout rejects with
`TimeoutError` and is retried; a caller's abort rejects with `AbortError` and is final.

**Files.** `src/lib/llm/{client,config}.ts`, `src/lib/env.ts`, `.env.example`,
`src/lib/llm/client.test.ts`

---

## 2026-09-25 10:05 — The docs hook blocked a session whose ledger was current

**Context.** The Stop hook fired at the end of the M2 session and blocked it for not
updating the docs ledger — which had in fact been updated and committed. The hook was
working; its logic was wrong. Useful: it caught its own bug the first time it ran for real.

**Action.** Three defects, all found by that one false positive.

1. **It only watched `Write|Edit`.** Most of the ledger updates that session went in
   through Bash — heredocs and inline python — which the matcher never saw. It now also
   inspects `tool_input.command`, so a file written any way still counts.
2. **It accumulated for the whole session**, so writing the docs never cleared the debt.
   The question is "is the ledger current?", not "were docs ever touched?". A docs write
   now resets the flag.
3. **Its source-path regex excluded `/` before `src/`**, so an absolute path — exactly
   what the file tools pass — never matched. Found only because fixing (1) and (2) made
   everything silently pass, which is its own kind of broken.

**Result.** Twelve cases green, driven from a Python harness rather than shell: no
activity, src via Write, src then docs via heredoc, src via Bash python, src via sed then
docs via Write, unrelated Bash, non-src files, CSS as source, block-once, never-twice,
the `stop_hook_active` guard, and malformed stdin.

The shell harness itself cost more time than the hook did — zsh's `echo` interprets `\n`
inside the JSON payload, which corrupts it before `jq` ever sees it. Second time that
exact trap appeared today; see LEARNINGS.

**Files.** `.claude/hooks/{record-touch,require-docs}.sh`

---

## 2026-09-25 10:40 — M3: strength-grounded drafts + review queue, with runs and a login throttle

**Context.** M3 per PRD §13: generate outreach for strong matches that builds on the
strengths the role rewards and cites a real evidence item, then a review queue with
inline edit and approve/skip. No sending. Two items were folded in at the same time:
the `runs` table had never been written, and login had no rate limit.

**Action.**

*Drafting (`src/pipeline/drafting/`).* The grounding requirement is enforced
structurally, not hoped for. Each draft is offered **only** the evidence backing
strengths this role scored ≥50 on, and must report which item it used via an
`evidence_id` constrained by `z.enum` to exactly those ids — the same two-layer
defence scoring uses, with `draftToRow` filtering again afterwards. An invented id is
dropped to null rather than written as a dangling reference, and `draftGrounding`
records an ungrounded draft as a run error instead of storing it as if it were fine.
A match whose rewarded strengths have no evidence behind them **refuses to draft**:
fabricating beats nothing is exactly backwards here.

*Schema.* `drafts` gained `evidence_id` and `strength_keys` — without them "cites a
real achievement" is unverifiable and the review queue has nothing to show. `profile`
gained `name` and `portfolio_url`; the first version scraped them out of `cv_text`
with a regex, which would have signed a real email "the candidate". Drafting now
refuses when `name` is unset rather than guessing.

*Review queue.* `/review` is a server-rendered shell around a client island. Decisions
are optimistic with rollback via `useOptimistic` — the card leaves immediately and
comes back with a toast if the action fails. Inline edit writes `edited_body` and never
overwrites the generated `body`, so what the model produced stays auditable. Every
action re-checks the session server-side and refuses to decide or edit a draft that is
no longer pending. The guardrail readout shows what would still block a send, so the
missing recipient is visible now rather than discovered in M4.

*Runs.* The row is opened **before** any work starts, so a crash or timeout leaves a
row with no `finished_at` — which is the signal. Stage errors accumulate without
ending the run; only a throw does, and the row is still closed as `failed`. Status is
`ok` / `partial` / `failed` by whether anything was produced alongside the errors.
`/runs` renders it.

*Login throttle.* Kept in Postgres, not memory: on a serverless deploy each instance
has its own memory, so an in-memory counter is bypassed by landing on another lambda.
Email and IP are counted independently — email-only lets anyone lock the real user out,
IP-only is trivially distributed — and the check runs *before* hashing, since each
Argon2 verify allocates 19 MiB.

**Result.** 104 tests green; lint, typecheck and production build clean. Verified end to
end against the live database: a real draft generated, cited the real BreezeLearn
evidence with its real metric, included the portfolio link, and came in under 120 words
for $0.0028. Edit preserves the original body, `decided_at` is stamped, and the guard
refuses a second decision. The throttle blocks at exactly 10 attempts, trips on the
email key alone, leaves unrelated keys untouched, and clears on success.

**One defect caught by reading the output.** The first generated draft contained
`…at <400ms latency (id=a8c730f3-9067-451d-ab0b-cfe0d215e7ff)` — the model copied the
internal evidence id into the email body. That would have gone to a hiring manager.
Fixed in the prompt *and* with a `stripIdentifiers` pass, because a prompt is not a
guarantee. Regenerated clean.

**Files.** `src/pipeline/drafting/*`, `src/pipeline/run.ts`, `src/db/queries/{drafts,runs}.ts`,
`src/db/schema/{drafts,profile,login-attempts}.ts`, `src/lib/rate-limit.ts`, `src/auth.ts`,
`src/app/(app)/review/*`, `src/app/(app)/runs/page.tsx`, `src/components/review-queue.tsx`,
`src/app/api/pipeline/run/route.ts`, `drizzle/0001–0003`

---

## 2026-09-25 10:45 — The hook fix that only fixed half the hook

**Context.** The Stop hook blocked the M3 session for not updating the docs ledger,
which had in fact been updated and committed in the same turn — the second false
positive from the same hook, after a fix that was supposed to close exactly this case.

**Action.** `record-touch.sh` was rewritten earlier to read `tool_input.command` so
that files written through Bash heredocs would count. It does. But the matcher in
`.claude/settings.json` was never changed from `Write|Edit`, so the script never ran
for a Bash call at all. The parsing was correct and unreachable: source edited through
Write set the flag, docs written through a heredoc could not clear it.

Matcher is now `Write|Edit|Bash`. Also removed two leftover `.state` files from my own
earlier hook tests, which were cluttering the state directory.

**Result.** Replayed the exact failing sequence — src via Write, then docs via heredoc,
then docs via inline python plus a commit — along with src via `sed`, a prettier glob
(which must *not* count as a source edit), and an unrelated command. Six cases, zero
failures.

**Files.** `.claude/settings.json`

---

## 2026-09-25 11:10 — M4a: the §11 guardrails, message construction, and the Gmail layer

**Context.** M4 is Gmail sending. Recipients are entered by hand for now — a posting
never carries a human's address, and guessing one costs deliverability (§11 caps bounce
at 2%). Address discovery is explicitly out of scope.

**Action.** Built the parts that decide *whether* to send before anything that can
send, so the rules are testable without a mail server.

- **`sending/warmup.ts`** — the §11 ramp. Derived from the first recorded send rather
  than a configured start date, so there is no "warming up" flag to forget to clear and
  a dormant identity is never falsely treated as warm. Caps at 5/day rising to the
  configured cap over 21 days, and never raises a deliberately low cap.
- **`sending/guardrails.ts`** — every §11 rule as one pure decision: human approval,
  no double-send, recipient present and valid, a sending identity that is **not** the
  primary address, the daily cap, the warm-up ramp, bounce < 2%, complaints < 0.1%, and
  reply suppression. Auto-send is advisory and can never make a non-approved draft
  sendable. An unmeasured rate reports `unknown` and does **not** block — a gap in
  observability is not evidence of a problem, but rendering it as a reassuring 0% would
  be a lie.
- **`sending/message.ts`** — RFC 2822 construction, pure. Header values are stripped of
  CR/LF and RFC 2047-encoded. This matters because the subject comes from a model: an
  injected newline would let generated text forge a `Bcc`.
- **`lib/gmail/`** — config, typed errors, and `sendEmail`. It does not decide whether
  to send; it delivers what the guardrails cleared. `GMAIL_DRY_RUN` builds and validates
  the whole message without handing it to Gmail.
- **`db/queries/outreach.ts`** — send stats, reply lookup, funnel counts, and the
  tracker's rows. `bounces`/`complaints` return `null`, not `0`, until detection lands.

**Boundary.** `lib/gmail` now holds the same hard rule as `lib/llm`: nothing else may
import `googleapis`/`google-auth-library` or read a Google secret. ESLint and
`boundary.test.ts` both enforce it, and both were verified by planting a file that
imports `googleapis` *and* `ai` *and* references `GMAIL_OAUTH_REFRESH_TOKEN` — three
violations, all caught, green again on removal.

Tightening the boundary patterns to be import-shaped was necessary: `env.ts` contains
the literal `"openai"` as a config enum value, and a vendor's name in a string is not a
dependency.

**Result.** 154 tests green; lint, typecheck and build clean. Nothing can send yet —
the action that calls `sendEmail` lands next.

**Files.** `src/lib/sending/{warmup,guardrails,message}.ts`, `src/lib/gmail/*`,
`src/db/queries/outreach.ts`, `src/db/queries/drafts.ts`, `src/lib/env.ts`,
`eslint.config.mjs`, `src/lib/llm/boundary.test.ts`, `.env.example`

---

## 2026-09-25 11:25 — M4b: sending wired up, recipient entry, pipeline tracker

**Context.** With the guardrails and the Gmail layer in place, connect them: manual
recipient entry, a send action, the one-time OAuth flow, and the funnel tracker.

**Action.**

- **Recipient entry** on each review card. Blank is an honest "not known yet" — the
  send button stays disabled rather than a guess going out. Enter saves.
- **`sendDraft`** re-evaluates every §11 guardrail *immediately before* delivery, not
  just when the page rendered: the daily cap in particular moves underneath a readout
  that is seconds old. It marks the draft sent only **after** Gmail accepts, because the
  reverse order records a send that never happened and reply detection would then wait
  forever. A failure marks `failed`, which is not terminal for a human — the draft stays
  visible and can be retried once the cause is fixed.
- **`/api/gmail/{connect,callback}`** — the one-time consent flow. The refresh token is
  displayed once for you to paste into `.env.local` and is deliberately *not* persisted:
  §12 keeps secrets in env, and a long-lived Google refresh token in a database table is
  a materially worse place for it. Both `gmail.send` and `gmail.readonly` are requested
  at once so consent happens a single time — re-prompting later is friction that gets
  skipped, and unmonitored bounces are a §11 violation.
- **`/pipeline`** — the funnel (drafted → sent → replied → interview → offer/rejected),
  with replies visibly halting chasing.
- **Settings** now shows the sending identity, whether auto-send is on, and dry-run
  state, so "why can't I send" is answerable without reading env by hand.

**Result.** 154 tests green; lint, typecheck and build clean. The whole chain verified
in dry run against the live database: guardrails blocked correctly at each stage, the
message was built (958 bytes), the draft moved to `sent`, an `outreach` row was created
with `sent_at`, and a second send of the same draft was refused naming both reasons.

**Two defects the verification caught.**

1. *The boundary test caught a real leak.* Both OAuth routes read Google secrets
   directly. Fixed by moving that knowledge into `lib/gmail` — the layer now exports
   `oauthClientReady()` and the env var *names*, so a route can explain what is missing
   without ever touching a value.
2. *The UI and the gate disagreed.* The card re-derived its guardrail strip from a raw
   `dailyCap` prop and displayed "Daily cap 30" while the warm-up ramp was enforcing 5.
   The page now runs the same `evaluateSend` the gate runs, in one batched pass, and the
   card renders that verbatim. A readout that can promise a send the server refuses is
   worse than no readout.

**Files.** `src/app/(app)/review/{send.ts,actions.ts,page.tsx}`,
`src/app/api/gmail/{connect,callback}/route.ts`, `src/app/(app)/pipeline/page.tsx`,
`src/components/review-queue.tsx`, `src/db/queries/{outreach,drafts}.ts`,
`src/lib/gmail/{config,index}.ts`, `src/app/(app)/settings/page.tsx`

---

## 2026-09-25 11:40 — M4c: reply and bounce detection

**Context.** Two §11 rules were stated but not yet true. "Respect replies — stop all
further contact once someone replies" only holds if replies are noticed, and bounce
monitoring cannot auto-throttle on a number nobody measures. Until now both guardrails
honestly reported "not monitored yet".

**Action.**

- **Correlation.** `outreach` gained `gmail_thread_id` / `gmail_message_id`, recorded at
  send. A reply lands in the same Gmail thread, so the thread id is the only thing that
  distinguishes a reply to *this* outreach from any other message in the mailbox. A dry
  run stores nulls rather than placeholder ids — otherwise the poller would chase a
  thread that does not exist, forever.
- **`sending/classify.ts`** — pure, 20 tests. A bounce outranks a reply when both
  appear: the message never reached a person, and treating it as contact would be wrong
  in the direction that costs deliverability. Daemon senders are matched on the local
  part so it holds across `googlemail.com`, a company MTA and `postmaster@` variants,
  with a subject fallback for MTAs that reply under their own name. `internalDate` is
  used rather than the `Date` header, which the sender controls.
- **`pipeline/replies.ts`** — polls only outreach still in `sent`, so a verdict settles
  a thread and a re-run costs one Gmail call per genuinely-open thread. Runs **first**
  in the pipeline: a reply must suppress contact before the same run drafts anything new
  for that role.
- **`bounced`** is a real funnel stage now, not a rejection. `getSendStats` returns a
  real bounce count, so the §11 threshold finally has something to threshold.

**Result.** 174 tests green; lint, typecheck and build clean. Verified end to end against
the live database with a stubbed thread: a send records its thread id and appears in the
poll queue; a reply moves it to `replied`, stamps `replied_at`, makes `hasReplied()` true
(which blocks the send guardrail) and removes it from the queue; a bounce moves it to
`bounced`, stamps `bounced_at`, stores the reason, and increments the real bounce count.

**An honest limitation, deliberately not papered over.** Complaint rate stays `null`.
A spam complaint goes to the *receiving* provider's feedback loop, which a plain Gmail
account has no access to — Postmaster Tools needs domain ownership and meaningful
volume. Reporting 0% would claim a signal that does not exist. The guardrail therefore
shows "not monitored yet" and does not block; the compensating controls are low volume,
mandatory human approval, and reply suppression.

**Files.** `src/lib/sending/classify.ts`, `src/lib/gmail/read.ts`,
`src/pipeline/replies.ts`, `src/pipeline/run.ts`, `src/db/queries/outreach.ts`,
`src/db/schema/{outreach,enums}.ts`, `src/lib/concurrency.ts`, `drizzle/0004`

---

## 2026-09-25 11:50 — Make connecting Gmail findable

**Context.** Asked how to reach `/api/gmail/connect` and where `SENDING_ADDRESS` goes —
and the honest answer was that there was no way to find out from inside the app.
Settings rendered the literal string "Visit /api/gmail/connect" as plain text, not a
link, and said nothing about what to set or where.

**Action.** A `GmailSetup` panel on Settings: three numbered steps that tick off as each
prerequisite is satisfied, with the exact redirect URI to register, the env lines to
paste, a real **Connect Gmail** button (disabled until the OAuth client exists), and the
`GMAIL_DRY_RUN` escape hatch. It disappears once the identity is connected.

**Result.** Verified against the live config: step 1 correctly reports *done* — the
OAuth client credentials were already present — while steps 2 and 3 remain open. The
panel reflects real state rather than a static checklist.

**Note for later.** OAuth was chosen because the PRD specifies it (§14, §15-D) and
because reply detection needs read access regardless. A Gmail **App Password** over
SMTP/IMAP would be materially less setup for a single-user app, at the cost of a
credential that grants the whole mailbox rather than two scopes. Worth revisiting if the
Cloud Console step proves to be friction.

**Files.** `src/components/gmail-setup.tsx`, `src/app/(app)/settings/page.tsx`

---

## 2026-09-25 12:35 — Drop sending entirely; make the draft copy-ready

**Context.** Explicit call: drop the Gmail/OAuth path. A Google Cloud project, a consent
screen, publishing status, refresh-token expiry and a separate warmed-up identity is a
great deal of machinery in front of something that takes two seconds by hand. The
product is the *draft*, not the delivery.

**Action — removed.** `lib/gmail/` (config, send, read, errors), both OAuth route
handlers, `lib/sending/` in full (guardrails, warm-up ramp, RFC 2822 construction,
thread classification), `pipeline/replies.ts`, `review/send.ts`, the `GmailSetup` panel,
the `googleapis` dependency, six env vars, and the Gmail half of the vendor boundary.
Also dropped `outreach.gmail_thread_id` / `gmail_message_id` — schema that implies a
capability the app no longer has is worse than no schema.

**Action — added.**

- **`lib/contact.ts`** — pulls an address out of a posting, preferring a person over a
  role mailbox (`maria.chen@` beats `careers@`), and rejecting noreply addresses,
  applicant-tracking domains and asset filenames the regex otherwise catches. Extracted
  at read time, not stored, so it always reflects the current description and improving
  the matcher needs no re-ingest. Most postings have none — the card says so plainly
  rather than showing an empty field that looks broken.
- **`components/copy-button.tsx`** — the label swap is the confirmation; no toast, since
  this is the most-used control on the screen. Handles a refused clipboard by saying so
  rather than showing a success state for something that did not happen.
- **The draft prompt, rewritten for YC-style punch.** Five short sentences under ~90
  words: who they are, the proof with its real number, the connection to this posting,
  the portfolio link, the ask. An explicit banned-phrase list ("I hope this email finds
  you well", "I came across your posting", "I am excited to") and explicit formatting
  rules, because the output gets pasted straight into a mail client.
- **"Mark sent"** replaces "Send". Atlas cannot observe your mail client, so the only
  honest signal is you telling it.

**Result.** 122 tests green; lint, typecheck and build clean. Two drafts regenerated and
read end to end — 71 and 83 words, lowercase concrete subjects, real metrics
(250K+ inferences at <400ms; +50% feature velocity, 80%+ coverage, −60% bugs), a
specific tie to the posting, a 20-minute ask, first-name sign-off. The copy button was
verified in the browser: 519 characters, subject then blank line then body through the
sign-off, and the label confirms.

`getSendStats` now reports `bounces` and `complaints` as `null` — with no mailbox
access neither is observable, and a zero would claim a signal that does not exist.

**Files.** `src/lib/contact.ts`, `src/components/{copy-button,review-queue}.tsx`,
`src/pipeline/drafting/prompt.ts`, `src/app/(app)/review/{actions,page}.tsx`,
`src/db/queries/{drafts,outreach}.ts`, `src/db/schema/outreach.ts`, `src/lib/env.ts`,
`src/pipeline/run.ts`, `eslint.config.mjs`, `drizzle/0005`

---

## 2026-09-25 13:12 — M5: twice-daily schedule, run notification, verification

**Context.** M5 per PRD §13: the twice-daily cron, the "N new matches, T strong"
notification, and the Runs screen. Runs shipped in M3 and the pipeline entry point has
existed since M0; what remained was the cadence and the notification — and, since sending
was dropped, a notification channel that does not touch a mailbox.

**Action.**

- **`lib/schedule.ts`** — one definition of the cadence (`RUN_HOURS = [6, 14]`), shared by
  the UI (`nextRunLabel` on Today, the schedule line on Settings) and the scheduler. The
  UTC hours the cron needs are *derived* from `RUN_HOURS` (`runHoursUtc`, `cronExpression`),
  not hand-kept in two places.
- **`.github/workflows/pipeline.yml`** — the scheduler as a cron line, not a broker (§6).
  `0 6,14 * * *` plus `workflow_dispatch` with optional score/draft caps. It POSTs the
  bearer-guarded entry point, writes the run to the Actions summary, and maps a `partial`
  run to a warning while only a `failed` run turns the job red. A `concurrency` group stops
  a slow run overlapping the next.
- **`lib/notify.ts`** — a webhook, not email: Atlas no longer touches a mailbox, and
  Slack/Discord/ntfy/generic all take a POST, its body shaped from the URL's host. The
  message leads with strong matches (the day's headline) and links to `/today`; `notifyRun`
  swallows its own failures — a dead webhook must never fail a run that did its work.
- **`pipeline/run.ts`** fires `notifyRun` *after* `finishRun`: the run row is the durable
  record, the notification a convenience. `score.ts` now returns `strong` so the message
  can lead with it.
- **Schedule stays UTC** (chosen this session): `TZ=UTC`, so runs fire 06:00/14:00 UTC and
  the UI says exactly that. `schedule.test.ts` reads the committed workflow and fails if its
  cron ever drifts from `cronExpression(TZ)`.

**Result.** 144 tests green (incl. `schedule.test.ts`, `notify.test.ts`); lint, typecheck
and production build clean. Verified live against the database: triggering the pipeline
wrote a `runs` row (status `ok`), returned the full `{ingest,scoring,drafting,totals}`
shape the workflow consumes, and **POSTed the notification** to a local catcher —
`{"text":"Atlas ran. Nothing new to review.", …}`, the generic multi-key body for an
unknown host. Every job was already scored, so the run was a $0 no-op — which also
re-confirmed ingest idempotency (89 seen, 0 inserted). The richer message shapes
(strong / drafts / errors / cost) are covered by `notify.test.ts`.

UI behind the Auth.js login was not re-screenshotted this session (entering a password is
out of scope here, as in the M2 visual pass); Today's `nextRunLabel` and Settings' schedule
line are code-verified and unit-tested.

**Files.** `src/lib/{schedule,notify}.ts`, `src/lib/{schedule,notify}.test.ts`,
`.github/workflows/pipeline.yml`, `src/pipeline/run.ts`, `src/pipeline/scoring/score.ts`,
`src/lib/env.ts`, `.env.example`

---

## 2026-09-25 13:50 — M6 phase 1: the motion-token foundation

**Context.** M6 is the design pass — the premium bar (Revolut/Monzo precision, Instagram/
Snapchat fluidity); brief in [M6-BRIEF.md](M6-BRIEF.md). Before adding micro-interactions
across the app, motion needs one vocabulary: the two existing animations (the gauge sweep,
Today's reveal) carried their springs and curves as inline magic numbers, which drift the
moment a third animation copies a slightly different value.

**Action.**

- **`src/lib/motion.ts`** — the single source of motion truth: `EASE` (house curve
  `[0.22,1,0.36,1]`), `DURATION` (≤320ms), `SPRING` (gauge/snappy/press/soft),
  `TRANSITION`, `REVEAL`, `STAGGER_STEP`, `PRESSABLE`. GPU-only by convention.
- **`globals.css`** — the CSS mirror (`--ease-*`, `--duration-*`) for non-JS transitions,
  a shared curve/speed on interactive elements, and a global `prefers-reduced-motion` guard
  that collapses every CSS transition/animation to instant.
- Refactored `fit-gauge.tsx` and `match-card.tsx` onto the tokens — no inline springs or
  curves remain.
- Rewrote **INTERFACE §5** from the original five-item set to the expanded-but-disciplined M6
  system (✓ built / ◇ target), in this commit per INTERFACE's own rule.
- **`motion.test.ts`** guards the tokens (durations ordered and short, béziers well-formed,
  springs physical, press scales inward).

**Result.** 149 tests green (5 new); lint, typecheck and production build clean. No behaviour
change yet — this is the base the rest of M6 builds on.

**Files.** `src/lib/{motion,motion.test}.ts`, `src/app/globals.css`,
`src/components/{fit-gauge,match-card}.tsx`, `docs/{INTERFACE,M6-BRIEF}.md`

---

## 2026-09-25 13:58 — M6 phase 2: interaction primitives

**Context.** With the motion tokens in place (phase 1), the first layer of premium *feel* —
the micro-interactions that apply broadly rather than to one screen.

**Action.**

- **Button press** (`ui/button.tsx`) — every button now dips and scales to 0.98 on press,
  on the shared `--ease-standard` / `--duration-fast` curve. One line in the base variant, so
  the whole app gets it at once.
- **Sliding nav indicator** (`app-nav.tsx`) — the active pill is a `motion.span` with a shared
  `layoutId`, so it *slides* between tabs on navigation (`SPRING.snappy`) instead of cutting.
  Reduced-motion collapses the slide to instant.

**Verification.** Built a throwaway dev-only preview gallery at `/preview` (never committed —
git-excluded locally, removed at M6 end) rendering the button variants, the nav, gauges, tier
chips, inputs and match cards. Confirmed in the browser, both themes: the pill slides between
tabs, buttons render across variants/sizes, dark mode holds.

**Result.** 149 tests green; lint, typecheck and build clean.

**Files.** `src/components/ui/button.tsx`, `src/components/app-nav.tsx`

---

## 2026-09-27 01:35 — M6 phase 3: signature moments

**Context.** The moments that carry the premium feel: the score animating, and the review queue
becoming keyboard-driven.

**Action.**

- **Gauge count-up** (`fit-gauge.tsx`) — the digits now count up in step with the arc sweep,
  driven by a `useMotionValue` tween (not a spring, so the number never overshoots its own
  value). It appears everywhere the gauge does — Today, the matches table, the drawer, the review
  queue. Reduced-motion sets the value instantly.
- **Review-queue keyboard** (`review-queue.tsx`) — `j`/`k` move between cards, `a` approves
  (or marks sent), `s` skips, `e` edits; shortcuts stay inert while a field is focused. Editing
  is now controlled at the queue level, so `e` and the Edit button open the same textarea, and
  each card carries a roving tabindex + visible focus ring like the matches table. Its
  enter/exit/layout motion moved onto the shared tokens (`TRANSITION.exit`, `SPRING.soft`).
- Reconciled INTERFACE: gauge count-up, press feedback and the nav slide are now ✓; the
  review-queue-keyboard open item is resolved and the matches-table `a`/`s`/`e` item reframed
  as by-design (a match is navigated, not approved).

**Verification.** In the `/preview` gallery: gauges render their values, and `j` then `e` moved
focus to the second card and opened its editor (focused textarea, Save/Cancel). 149 tests green;
lint, typecheck and build clean.

**Review addendum.** Driving it independently found one gap: `e` opened the editor but
`esc` did nothing, so once you were in the textarea the only way out was clicking Cancel
— a keyboard-first queue you cannot leave by keyboard. `esc` now discards and returns
focus to the card (dropping focus on `<body>` would silently kill `j`/`k`, the same trap
the match drawer had), and the hint line advertises it.

Two things checked and found *correct*, worth recording so they are not re-litigated:
the typing guard genuinely holds — `s`, `j` and `a` all type into the textarea rather
than firing — and all seven gauges land exactly on their `aria-label` values. An earlier
pass that dispatched synthetic `KeyboardEvent`s appeared to show the textarea unfocused
after `e`; that was an artifact of synthetic dispatch, not a defect. Real keystrokes
focus it correctly.

**Files.** `src/components/{fit-gauge,review-queue}.tsx`, `docs/INTERFACE.md`

---

## 2026-09-27 01:57 — M6 phase 4: accessibility and performance sweep

**Context.** The §10.7 quality floor: WCAG AA contrast, visible keyboard focus, reduced
motion respected, no layout shift. Checking these once by eye is worth little — each
fails silently and none of them shows up in a screenshot — so the sweep produced
standing guards rather than a report.

**Contrast — six real AA failures, all the same root cause.** A colour tuned as a
*fill* was being used as *ink*:

| Pairing | Was | Needs |
|---|---|---|
| dark `--primary` as link text on card | 3.01:1 | 4.5:1 |
| dark `--primary` as link text on paper | 3.29:1 | 4.5:1 |
| light `--tier-possible` gauge numeral | 2.94:1 | 3:1 |
| light strong chip label on its own tint | 2.96:1 | 4.5:1 |
| light possible chip label on its own tint | 2.62:1 | 4.5:1 |
| light stretch chip label on its own tint | 4.16:1 | 4.5:1 |

Fixed by separating the two jobs: `--primary-ink` and `--tier-*-ink` carry text,
the vivid tokens keep drawing arcs, tints and rings. Values were solved numerically —
hue preserved, lightness walked until every surface the colour can land on clears the
threshold with headroom — not picked by eye. `--tier-possible` itself was darkened to
`#b77d27` so the gauge numeral clears large-text AA. On dark, the greens and ambers
already passed; only the grey needed lifting.

**Standing guards added.** `a11y/contrast.test.ts` parses the tokens out of
`globals.css` and asserts 52 pairings across both themes, compositing translucent
tints onto their real backdrop first. `a11y/motion.test.ts` asserts every component
rendering `<motion.*>` also calls `useReducedMotion()`, that the CSS neutraliser
exists, that no animation touches a layout-triggering property, and that no inline
easing or spring bypasses `lib/motion`. Both were verified by planting violations —
the motion guards caught all three classes at once.

**Measured clean.** CLS **0** with zero layout-shift events. 39 interactive elements,
all labelled. Heading order with no skipped levels. No unlabelled SVG or image.

**Two findings that were mine, not the code's.** Programmatic `.focus()` does not
reliably match `:focus-visible`, so a computed-style sweep reported missing focus
rings on controls that have them — confirmed visible by screenshot under real Tab
navigation. And the nav buttons it flagged were the gallery's mock markup, not the real
`AppNav`, which carries `focus-visible:ring-3`.

**Result.** 206 tests green; lint, typecheck and build clean.

**Files.** `src/lib/a11y/{contrast.ts,contrast.test.ts,motion.test.ts}`,
`src/app/globals.css`, `src/components/{tier-chip,fit-gauge}.tsx`,
`src/app/(app)/today/page.tsx`, `src/components/{review-queue,match-drawer,ui/button}.tsx`,
`docs/INTERFACE.md`

---

## 2026-09-27 07:31 — Review: the two M6 loose ends, sources, and Vercel

**Context.** No code change. A question-answering pass over four things: why outreach
stalls at `sent`, why the matches drawer has no actions, why no Nigerian roles appear,
and whether Atlas can run on Vercel. Recorded here because the answers are the kind a
fresh session would otherwise re-derive by reading the same eight files.

**Findings.**

*Outreach is a state machine with one transition.* `outreach_status` has eight values;
only `sent` is reachable. `recordSend` (called from `review/actions.ts`) is the single
writer and hard-codes it. `markReplied` exists in `db/queries/outreach.ts` and is called
from nowhere. Because rows are created at send time, `drafted` is structurally always
zero — the funnel's first column cannot be non-zero. The §11 reply guard (`hasReplied`)
is therefore inert: nothing can set `replied`. The fix that resolves both at once is to
create the outreach row when the draft is *written*, so every match has one row from the
start and the drawer has something to act on. Needs no migration.

*The drawer is read-only.* Its only control is "Open original". The missing concept is a
per-match dismissal — nothing in the schema records "not interested", which is why a
rejected match returns to the top of the list forever. Under the unification above it is
an outreach row at `closed`. Also: `MatchRow` carries no `draftId`, so the drawer cannot
link to or act on a draft without a join added to `listMatches`.

*`notified` is dropped by the route, not missing from the pipeline.* `runPipeline`
returns it (`run.ts:90`); `api/pipeline/run/route.ts` destructures five of the six fields
and omits it from the response. This is the `KeyError: 'notified'` left open at M5.

*No Nigerian roles is an ingest gap, not a scoring gap.* The profile carries
`Port Harcourt, Nigeria (base)` and `location_fit` is a scored dimension, so such a role
would score correctly. But the only source is Vercel's Greenhouse board, and Greenhouse
is per-company — there is no query or geography parameter, so Atlas only ever sees boards
explicitly added. `lever`/`ashby`/`rss`/`api` are enum values with no fetcher. There is
also no `/sources` screen: adding a board today means an SQL insert or editing `seed.ts`.

*Vercel: the app yes, the pipeline no.* Deploys as-is (App Router, JWT sessions,
`trustHost: true`, native deps already in `serverExternalPackages`). Five blockers:
hosted Postgres with `max` dropped from 5 to 1 for serverless; nothing runs migrations on
deploy; the pipeline route does ingest + 50 scorings + 20 draftings in one request and
will exceed any function ceiling; Vercel Cron on Hobby is once-daily so the 06:00/14:00
schedule needs Pro (GitHub Actions is better anyway — `schedule.test.ts` guards it from
drift); and `APP_URL` must be set or notification links point at localhost.
Recommendation: run the batch in GitHub Actions against the database and let Vercel serve
UI only. The `lib/llm` boundary holds either way.

**Result.** Nothing implemented — a deliberate answer-only pass. `atlas-candidate-profile.md`
is committed at the repo root and not gitignored; worth checking the repo is private.

**Files.** None under `src/`.

---

## 2026-09-27 08:30 — M7: multi-source ingest and the relevance gate

**Context.** Atlas had exactly one source — Vercel's Greenhouse board — so every match
ever shown came from one company. The ask was breadth: Nigeria, USA, UK, Canada, EU and
Africa, across sectors, all scored.

**What the shape of the problem turned out to be.** Greenhouse, Lever and Ashby are
per-company: no search, no geography parameter, so coverage costs one source row per
employer. LinkedIn, Indeed and Google Jobs have no usable public API at all — checked,
and recorded in LEARNINGS rather than attempted. That leaves two levers: many ATS
boards, and the keyless cross-company aggregators.

**Action.**

*Fetchers.* `lever` and `ashby` joined `greenhouse`; the four aggregators (Remotive,
Arbeitnow, Himalayas, Jobicy) ride the existing `api` kind with a `config.adapter`
discriminator, so adding a fifth needs no migration. A shared `fetchJson` gives every
board the same timeout-and-status handling.

*Catalogue.* `src/db/sources.catalogue.ts` — 66 sources, every one verified live before
being written down. `npm run db:seed:sources` loads it, matching on name so a wrong
board token is a re-run rather than a migration, and never overwriting `enabled`.

*The relevance gate.* `src/pipeline/relevance.ts`, applied at ingest. 66 boards is
~11,900 postings and scoring is one LLM call each — sending that to a model would cost
roughly $17 a run. The gate is pure, tested and derived from the stored profile, so
changing `target_roles` or `locations` changes the filter with no code edit. Ingest
reports the split, which is what makes an over-tight filter visible rather than
silently starving the queue.

**Result — measured, not estimated.** 66 sources, **zero failures**, 84 seconds.
11,865 seen → 7,733 filtered → **4,093 stored**, a 35% keep rate. Re-running inserted 0
of 4,132, so idempotency survives the new code path. Stored spread: US 1,790,
EU/mixed 1,703, UK 336, Canada 329, Africa 20, of which Nigeria 9 — all Moniepoint, all
genuine (SRE, Mobile Architect, five Heads of Engineering).

Two fixes carried along: the pipeline route's `MAX_LIMIT` rose from 200 to 1,000,
because a 4,000-job backlog could not be drained 200 at a time (scheduled runs still use
the stage default of 50, so their cost is unchanged); and the route now returns
`notified`, which `runPipeline` had always produced and the handler dropped.

Per the user's call, the boundary test's secret rule narrowed from any `_API_KEY` to the
four LLM provider keys — the rule was always about keeping model vendors swappable, and
a job-board credential is not that. Verified by planting both cases.

**Result.** 243 tests green (was 222); lint, typecheck and build clean.

**Files.** `src/pipeline/relevance.ts` + test, `src/pipeline/sources/{http,lever,ashby,aggregators}.ts`
+ tests, `src/pipeline/sources/index.ts`, `src/pipeline/ingest.ts`,
`src/db/{sources.catalogue,seed-sources}.ts`, `src/app/api/pipeline/run/route.ts`,
`src/lib/llm/boundary.test.ts`, `package.json`

---

## 2026-09-27 09:17 — Role collapse, posting age, and the freshness window

**Context.** A fair challenge to the previous entry's headline: were 4,093 jobs really
posted in 24 hours, matching precisely, after dedupe? No — and the number invited that
reading. Three things were wrong with it, two of them the report's fault.

**What the data said.** Only 119 of 4,182 rows were posted in the last 24h; 1,618 in 7
days; the oldest dated 2009. An ATS board returns *every open requisition*, so a first
run pulls the whole standing market. 4,182 rows covered 3,421 distinct company+title
pairs — one Databricks role listed 14 times, a Celonis one 11 — because a role
advertised in fourteen cities is fourteen postings with fourteen ids. And the gate is
coarse by design: it asks "does this read as engineering" and "is the location not
excluded", nothing more. It is a queue depth, not a verdict.

**Action.**

*Role collapse* (`src/pipeline/dedupe.ts`) — groups by source + company + normalised
title, merges locations, ORs remoteness, keeps the **earliest** date so a re-post into
one new city cannot refresh a year-old req. The representative is elected by lowest
external id, never by payload order: a positional choice would let a board reordering
its response elect a different id, which the unique index would store as a *new* job —
the collapse would breed duplicates instead of removing them. Runs after the relevance
gate, so each variant is judged on its own location first.

*Posting age* (`src/lib/age.ts`) — the Jobs list showed `first_seen_at`, when Atlas
ingested, which makes a 2023 requisition look like it arrived this morning. Now shows
the board's own `posted_at`, with a "Long open" marker past 180 days. `MatchRow` carries
`postedAgeLabel` and `evergreen`, pre-formatted server-side to avoid a hydration
mismatch. The Matches table's "Scored" column became "Posted" — when Atlas scored
something is an internal detail; the scored date and model remain in the drawer footer.

*Freshness window* — `/jobs?window=` with 24h/48h/7d/30d/all, defaulting to 48h, with
live counts on each pill so the choice is made against real numbers. A **view**, not an
ingest filter: changing it is a link, not a re-ingest. Undated postings are excluded
from bounded windows, since "no date" is not evidence of freshness.

**Two defects the live render exposed.** The header printed `jobs.length` — the page cap
— and so claimed "200 posted in the last 48 hours" when there were 458. And bare `ai`
and `ml` in the vocabulary had admitted "Go-to-Market Champion (GPU & AI)" and "Product
Manager, Performance AI". Both fixed; `ai`/`ml` now only match as part of a real role
name, and `junior`, `product manager`, `product owner`, `gtm` joined the exclusions.

**Result.** Cleanup removed 743 duplicate rows (0 had a match or draft) and 176 newly
irrelevant ones (51 more were protected by an existing match and left alone).
3,263 rows for 3,421→3,240 distinct roles. Windows now read **24h 100 · 48h 433 ·
7d 1,263 · 30d 2,226 · all 3,263**. 261 tests green; lint, typecheck, build clean.

**Files.** `src/pipeline/{dedupe.ts,dedupe.test.ts,ingest.ts,relevance.ts,relevance.test.ts}`,
`src/lib/{age.ts,age.test.ts}`, `src/db/queries/{jobs.ts,matches.ts}`,
`src/app/(app)/jobs/page.tsx`, `src/components/{matches-table,match-drawer}.tsx`,
`src/app/preview/gallery.tsx`

---

## 2026-09-27 10:05 — Closure detection, and moving the age limit to ingest

**Context.** The ask was: detect closures, delete everything older than 7 days, then
score what remains — with problems surfaced first. Four problems, two of which would
have broken it.

**The problems.**

1. *Deleting old rows makes them more likely to be scored.* Those roles are still open
   on their boards, so the next run re-inserts them with a fresh `first_seen_at` — and
   `getUnscoredJobs` orders by `first_seen_at DESC`, so months-old requisitions would
   jump ahead of genuinely new postings. The age limit has to live at **ingest**.
2. *Closure detection cannot work on the aggregators.* The inference is "stored but
   absent from this fetch", which needs a complete set. Greenhouse/Lever/Ashby return
   one; the four aggregators return a capped page of a rolling feed, where absence
   usually means newer postings pushed it off.
3. *An ingest age filter makes closure lie.* A role aging past the window vanishes from
   the filtered set and reads as closed. Closure must diff the **raw** fetch.
4. *Deleting by age destroys work.* `matches` cascades on job delete and `drafts`
   cascade off matches.

**Decisions (user).** 30-day ingest window, not 7 — the window only changes the
one-time backfill (~$2.78 vs ~$1.58), not the ~$0.15/day steady state, so the narrower
one buys $1.20 once at the cost of never seeing a role past its first week. And closed
roles are **marked, not deleted**.

**Action.** `src/pipeline/closure.ts` — pure decision logic with four refusals: ATS
kinds only, never on a failed fetch, never on an empty response, and never more than
50% of a source at once (a truncated response and a hiring freeze look identical, and
are told apart by what being wrong costs). Postings that reappear are reopened, so one
dropped entry cannot kill a live role permanently. Migration `0006` adds `jobs.closed_at`
plus an index; closed rows are excluded from the Jobs list and the scoring queue but
kept, surfacing as "No longer listed" in the drawer and "Closed" in the matches table.
`MAX_POSTING_AGE_DAYS` (default 30) gates ingest, reusing `isStale` so "too old" has one
definition.

**Result.** Cleanup removed 1,037 rows outside 30 days, none with a match attached,
leaving 2,226. The verification ingest was still running at time of writing; first
observed behaviour is 16 inserts and **1 close** across the run so far — the
conservative direction, which is the one the guards are tuned for. Full-run numbers
follow in the next entry. 271 tests green; lint, typecheck clean.

**Files.** `src/pipeline/{closure.ts,closure.test.ts,ingest.ts}`,
`src/db/schema/jobs.ts`, `src/db/queries/{jobs.ts,matches.ts}`, `src/lib/env.ts`,
`src/components/{matches-table,match-drawer}.tsx`, `src/app/preview/gallery.tsx`,
`drizzle/0006_early_kid_colt.sql`, `.env.example`

---

## 2026-09-27 10:10 — Closure verification run, and what it actually proved

**Context.** The previous entry closed with the verification ingest still in flight.
It finished, and the result was more useful than a clean run would have been.

**Result.** `seen=6212 expired=1683 filtered=3213 collapsed=220 inserted=6
duplicates=1090`, `closed=1 reopened=0`, and — the interesting part — **20 of 66
sources failed** with `fetch failed`, the run taking 431s instead of the usual 85s.

**What that proved.** Closure detection stayed correct under conditions I did not
engineer. Twenty sources failed and *none* of them closed anything: a failed fetch
returns from `ingestSource` before `applyClosure` is ever called, so the protection is
structural rather than a flag someone has to remember to set. The single close was
Vercel, a board that genuinely lost a posting. A naive implementation would have marked
several thousand live roles closed in that run.

Worth noting honestly: because of that early return, `decideClosure`'s `fetchFailed`
parameter is always `false` on the real call path. It is tested and kept as
belt-and-braces for any future caller that diffs without going through ingest, but the
guard doing the work in production is the control flow.

**The failures were transient.** All eight boards re-tested afterwards returned HTTP
200 — Stripe, Databricks, Anthropic, Cloudflare, Airbnb, Moniepoint, MongoDB, GitLab.
Local network saturation from repeated full ingests, not the boards refusing us. The
real lesson is that 20 silent source failures only showed up because the summary counts
them; a run that loses a third of its coverage otherwise looks like a quiet day.

**Result.** 271 tests green; lint, typecheck and build clean.

**Files.** None beyond the previous entry — this records the verification.

---

## 2026-09-27 16:05 — Coverage warnings, the sources screen, and a funnel that moves

**Context.** Four things in one pass: make a degraded run impossible to mistake for a
quiet day, make sources editable, make outreach reachable past `sent`, give the drawer
actions. The scoring backfill ran in the background throughout, as a standalone process
so file edits could not disturb it.

**Degraded coverage.** Source failures were already recorded as run errors, so the gap
was framing, not capture: Today showed nothing at all. `runs` gains `sources_ok` /
`sources_total` (migration 0007) — stored as numbers rather than inferred from the
error list, because the question "did this run see the whole market?" has to survive
the source list changing afterwards. A `CoverageBanner` sits above the figures it
qualifies, and renders nothing when coverage was complete. The run notification states
the shortfall too, since that is the signal you get when you are not looking at the app.

**Sources screen.** `/sources` lists every board with what it has actually produced,
adds one, and enables or disables it. Config is validated with the *fetchers' own*
schemas rather than a second copy, so a board saved here is one the fetcher can read —
a wrong shape caught at save time is a form error; caught at run time it is a silent
source failure twice a day. Deleting cascades into jobs, matches and drafts, so the
action re-counts and refuses if the page's number is stale.

**Outreach past `sent`.** The rules moved to `src/lib/outreach.ts`, deliberately
without `server-only`, so the client island offers exactly the moves the server
enforces — the same arrangement as `lib/scoring.ts`. `closed` is legal from anywhere
and `bounced → sent` is legal (fixing an address and resending is repair); everything
else moves forward only. `runDraft` now opens an outreach row at `drafted`, so the
funnel's first column is no longer structurally zero.

**Drawer actions.** "Draft this now" ignores the tier gate on purpose — the scheduled
run only drafts `strong`, so a `possible` role you rate personally would never get one.
"Not interested" records `closed` rather than adding a dismissal flag beside the
funnel: one state machine per match is easier to reason about than two.

**Result.** 283 tests green; lint, typecheck and build clean. Verified by rendering:
`/sources` reports 66/66 enabled and 2,241 open postings, `/pipeline` shows Drafted 7
with a working stage control on every row.

Two things the render caught. The sources screen labelled four empty boards "Producing
nothing — check the board token", which asserts a cause it cannot know: Hootsuite,
Jumia, Luno and Wise all return postings that the relevance gate rejects. Relabelled
"Holding nothing — filtered out, or a wrong token". And the seven existing drafts
predated outreach rows, so the tracker was empty; backfilled at `drafted`.

**Files.** `src/lib/outreach.ts`, `src/components/{coverage-banner,pipeline-tracker,sources-manager,match-drawer}.tsx`,
`src/app/(app)/{sources/page.tsx,sources/actions.ts,pipeline/page.tsx,pipeline/actions.ts,matches/actions.ts,today/page.tsx,runs/page.tsx}`,
`src/db/queries/{sources,outreach,drafts,runs}.ts`, `src/db/queries/outreach.test.ts`,
`src/db/schema/runs.ts`, `src/pipeline/{ingest,run}.ts`, `src/pipeline/drafting/draft.ts`,
`src/lib/notify.ts`, `src/components/app-nav.tsx`, `drizzle/0007_useful_spitfire.sql`

---

## 2026-09-27 16:40 — A daily queue instead of a firehose

**Context.** 292 matches scored, 62 strong, and **zero sent**. The user's read was
correct: nobody applies to four hundred roles, so producing more of them is not
progress. The constraint is applications per day — ten to twenty — not coverage.

**Action.**

*Cadence.* `RUN_HOURS` dropped from `[6, 14]` to `[6]`. A second daily run added cost
and noise without adding anything anyone had time to act on.

*The queue.* Today is now a capped list (`DAILY_QUEUE_SIZE`, default 15) of the
best matches **not yet acted on** — no outreach row, or one still at `drafted`. Each
row has "I applied" (→ `sent`) and "Not interested" (→ `closed`), which remove it
optimistically. The point is that it empties: a list nobody can finish gets skimmed
and then ignored, which is the failure this screen exists to avoid. A second stat says
how many are waiting behind it, so the cap is visible rather than a silent truncation.

*Fetch now.* A button on Today runs the pipeline on demand, scoring
`DAILY_QUEUE_SIZE * 2` and skipping drafting. It states that it takes minutes before
you press it — scoring runs at about seven roles a minute, and a button that looks
instant and is not reads as broken.

**A latent bug the drift test caught — mine.** I regenerated the cron for
`Africa/Lagos` and committed `0 5 * * *`. `.env.local` actually sets `TZ="UTC"`, so the
correct line is `0 6 * * *`; `schedule.test.ts` failed immediately and named both
values. This is the second time that guard has paid for itself.

**Result.** 288 tests green; lint, typecheck and build clean. Verified by rendering:
Today reports "In today's queue 15 · Waiting behind it 276" with the Fetch now control
and fifteen actionable rows.

**Observation for later.** The top of the queue is four consecutive SumUp roles — all
genuinely strong, all one company. Sorting purely by fit lets one employer take a third
of a fifteen-slot queue. Worth a diversity rule.

**Files.** `src/lib/schedule.ts` + test, `.github/workflows/pipeline.yml`,
`src/components/{daily-queue,fetch-now}.tsx`, `src/app/(app)/today/{page.tsx,actions.ts}`,
`src/app/(app)/matches/actions.ts`, `src/db/queries/matches.ts`, `src/lib/env.ts`

---

## 2026-09-27 16:00 — Queue size, a per-company cap, and email instead of a webhook

**Context.** Three corrections from the user. The queue size was 15, which I had picked
without being asked — the stated range was 10–20, up to 25, ceiling 30. One employer
could take a third of the queue. And the notification should be email, not a webhook.

**Action.**

*Size.* `DAILY_QUEUE_SIZE` defaults to 20, with the Zod schema bounded `min(5).max(30)`.
The ceiling is the point: a cap that can be raised without limit is not a cap.

*Per-company cap.* `MAX_PER_COMPANY` (default 4), applied by `capPerCompany` in
`src/lib/queue.ts` — pure, `server-only`-free, seven tests. `listDailyQueue` now fetches
a bounded pool rather than exactly `limit`, because a cap can only choose from what it
is given: asking for 20 and then capping returns fewer than 20 whenever one employer
dominates the top.

*Email.* The webhook is gone entirely — `NOTIFY_WEBHOOK_URL` and the per-service body
shaping with it. `notify.ts` now sends through Resend in one `fetch`, with an HTML body
built on tables and inline styles (email clients are not browsers) and a plain-text
alternative. The subject carries the decision — "Atlas: 6 roles ready, 2 strong" or
"Atlas: nothing new today" — because a subject reading "run complete" wastes the one
line that is always read. `queued` is the **capped queue length**, not the raw backlog:
an email saying "276 roles ready" is the firehose this design exists to avoid.

**Result.** 289 tests green; lint, typecheck and build clean. Verified against real
data: the queue holds 20 roles across **11 companies**, with SumUp and Cohere each at
exactly 4. Without the cap it would have been three employers — SumUp alone has 30
unacted matches, Adyen 35, Cohere 17.

**Setup note.** `RESEND_API_KEY` and `NOTIFY_EMAIL_TO` in `.env.local`; unset means no
email and the run still records everything. `NOTIFY_EMAIL_FROM` defaults to Resend's
shared sandbox sender, which delivers to your own account address without verifying a
domain — anywhere else needs one.

**Files.** `src/lib/{queue.ts,queue.test.ts,notify.ts,notify.test.ts,env.ts}`,
`src/db/queries/matches.ts`, `src/pipeline/run.ts`, `src/app/(app)/today/page.tsx`,
`.env.example`

---

## 2026-09-27 17:36 — Manrope everywhere, and a real email template

**Context.** Two asks: switch the app to Google Sans or Manrope via `next/font/google`,
and build a polished, cross-client HTML email.

**Google Sans is not available.** It is Google's proprietary UI font, not distributed
through Google Fonts, so `next/font/google` cannot serve it. Manrope was the other
option and is a good one.

**Action.**

*Type.* Manrope replaces both Geist Sans and Space Grotesk — its heavier weights carry
a display line, so a second family earned nothing. Self-hosted and subsetted by
`next/font`, so no render-blocking request and no layout shift. The `geist` dependency
is removed. One trap: `next/font`'s `variable` sets a custom property on `<html>`, so
mapping `--font-sans: var(--font-sans)` inside `@theme inline` is circular — the token
is `--font-manrope`. Geist's `cv02/cv03/cv11` character variants meant nothing to
Manrope and were replaced with `lining-nums`.

*Email.* Split delivery from presentation: `src/lib/email.ts` is a pure template with
no `server-only`, `notify.ts` only sends. XHTML doctype, 600px table layout, inline
styles for everything load-bearing, VML button for Outlook, hidden preheader, no images
at all, and a `@media (prefers-color-scheme: dark)` block. Colours are copied from
`globals.css` as literals, since an email cannot read CSS variables.

**What rendering caught.** In dark mode every job title was black on a near-black card.
The heading and company names were fine. The dark block flips colours by class, and the
row titles carried only an inline colour — email has no inheritance to fall back on.
Nineteen passing assertions did not see it; one screenshot did. Fixed by giving every
element that states a colour the matching class.

**Result.** 295 tests green; lint, typecheck and build clean. Verified in light, dark
and at 375px, across the full, degraded and empty states. Rendered sizes are 5.3–13.6 KB,
well under Gmail's ~102 KB clipping threshold.

**Files.** `src/app/layout.tsx`, `src/app/globals.css`, `src/lib/{email.ts,email.test.ts,notify.ts}`,
`src/pipeline/run.ts`, `package.json`, `docs/INTERFACE.md`

---

## 2026-09-27 18:10 — Deployment prep: Vercel for the UI, Actions for the pipeline

**Context.** "How do I deploy on Vercel, and what does it cost?" The app deploys
cleanly; the pipeline cannot. A run is roughly twelve minutes of LLM calls, which is
far past any serverless function ceiling on any plan.

**The split.** Vercel serves the UI and Server Actions. GitHub Actions runs the
pipeline directly against the same database, where the limit is six hours rather than
seconds. Neon holds the data. This is what `src/lib/schedule.ts` already assumed by
keeping the schedule outside the app.

**Action.**

*Pool size.* `src/db/index.ts` drops `max` from 5 to 1 in production. Serverless gives
every concurrent invocation its own pool, so anything above 1 multiplies by however
many instances are warm and exhausts a pooled endpoint under trivial load.

*A real entry point.* `src/pipeline/cli.ts` plus `npm run pipeline:run`. Writes a
summary table to the Actions run page — with the source-coverage row marked when it is
short, since every other count is proportional to it — and exits non-zero only on a
genuinely failed run. A `partial` run recorded per-item errors and still did its work,
so reddening the job for that would train you to ignore a red job.

*The workflow* now runs that command instead of curling the deployed app. Non-sensitive
config lives in repository *variables* rather than secrets, because a masked model name
is unreadable exactly when you are working out why a run behaved oddly.

*Fetch now* gained a dispatched mode: with `GITHUB_DISPATCH_TOKEN` and `GITHUB_REPO`
set it asks Actions to run and reports that it started, which is the honest
confirmation — the page cannot know a count it has not computed. Unset, it runs inline,
which is faster to iterate against locally. The mode follows what is configured rather
than a flag, so it cannot be pointed at the option the environment cannot support.

*`docs/DEPLOY.md`* — the walkthrough, both environment contracts, verification steps,
measured costs, and the three failure modes worth knowing: an unverified sending
domain, a run that loses sources, and GitHub disabling schedules on quiet repositories.

**Cost, from the `runs` table rather than estimated.** Scoring $0.0047/job, drafting
$0.0055/draft. At the default limits — 50 scored, ~10 new strong drafted — that is
**~$0.29/day, ~$9/month**, with Neon, Vercel, Resend and Actions all inside free tiers.
Stated plainly in the guide: the cron scores 50/day against an inflow of 70–181, so the
unscored backlog grows. Deliberate, since scoring is newest-first and the queue needs
20, but "everything scored" is not the steady state.

**Result.** 296 tests green; lint, typecheck and build clean, and the schedule drift
test still passes against the rewritten workflow. The CLI was still executing its first
real run at time of writing — result in the next entry.

**Files.** `src/pipeline/cli.ts`, `src/db/index.ts`, `src/lib/env.ts`,
`src/app/(app)/today/actions.ts`, `src/components/fetch-now.tsx`,
`.github/workflows/pipeline.yml`, `docs/DEPLOY.md`, `README.md`, `.env.example`,
`package.json`

---

## 2026-09-27 18:05 — CLI verification, and the bug it found

**Result of the run promised in the previous entry.** The CLI works end to end:

```
runId e442f2e9 · 3.7 minutes · sources 66/66 · seen 11,865 · new 83
scored 1 · drafted 20 · $0.1121 · status ok · emailed false
```

Two useful confirmations. All 66 sources answered, so the 20 failures in the earlier
run were transient network trouble and not the boards refusing us. And prompt caching
is working — 1,792 of 3,600 input tokens were served from cache, which is why the
measured per-job cost sits slightly under the $0.0047 estimate.

**`drafted: 20` was not what was asked for.** The run was invoked with `DRAFT_LIMIT=0`
to keep the check cheap.

**Root cause.** Three near-copies of the same parse, all treating `0` as "not
supplied": `positive()` in the CLI, `positiveLimit()` in the route handler, and
`options.draftLimit ? … : {}` in `run.ts`. Falsy-zero made "run this stage on nothing"
unexpressible — and it did not fail, it substituted the stage *default*, so asking for
no drafts produced the maximum of twenty. `fetchNowAction` passes `draftLimit: 0` for
exactly this reason, so the Fetch now button had been drafting twenty every press since
it shipped.

**Fix.** One definition in `src/pipeline/limits.ts` — `parseLimit`, with six tests
covering zero, unset, empty string, the cap, fractions and junk. All three call sites
now use it, and `run.ts` checks `=== undefined` rather than truthiness.

The twenty drafts cost $0.108 and are real output for strong matches, so nothing was
wasted beyond the intent.

**Result.** 302 tests green; lint, typecheck and build clean.

**Files.** `src/pipeline/{limits.ts,limits.test.ts,cli.ts,run.ts}`,
`src/app/api/pipeline/run/route.ts`

---

## 2026-09-27 18:31 — Blank env vars broke the Vercel deploy

**Context.** The first Vercel deploy failed on seven environment variables, most of
which have defaults. Reported as a misconfiguration; it was a bug in `env.ts`.

**Action.** `withoutBlanks()` strips empty and whitespace-only values before the schema
runs, so a variable created and left blank in a dashboard behaves like one that was
never created. The failure message now says so, to stop the next person hunting an
empty field. Six tests in `src/lib/env.test.ts` cover absent, blank, whitespace, a real
value and a genuinely invalid one.

**Result.** 308 tests green; lint, typecheck and build clean.

**Open — raised by the user, not yet built.** Two people want to use this, with a
profile picker rather than one account seeded from env. Nothing in the schema is
user-scoped today: `users` exists but no other table references it, and
`profile.version` is globally unique, so two profiles collide at version 1. Scoping is
the work, not the signup form — see the next entry when it happens.

**Files.** `src/lib/env.ts`, `src/lib/env.test.ts`

---

## 2026-09-27 18:55 — Scoping everything to a user

**Context.** A second person wants to use Atlas, with an avatar picker rather than one
account seeded from env. The signup form was never the hard part: `users` existed and
**no other table referenced it**. Nine tables, zero ownership.

**The design.** Everything keys on `profile.id`, not on `profile.version`.

Version numbers cannot identify an owner — two people both start at version 1, so
`(job_id, profile_version)` would collide and one person's score would overwrite the
other's. Keying on the profile *row* scopes a match to its owner transitively, with no
denormalised `user_id` that can drift from the profile it was copied from. Drafts and
outreach hang off matches, so they inherit ownership for free.

- `profile` gains `user_id`; `version` is unique **per user**, not globally.
- `strengths.profile_id` and `matches.profile_id` replace `profile_version`.
- `users` gains `image` for the picker.

**Every read takes a required owner.** `getCurrentProfile(userId)`,
`listDailyQueue(profileId, …)`, `getUnscoredJobs(profileId, …)`,
`getMatchCounts(profileId)`, `listMatchRows(profileId, …)`. Deliberately not optional:
an optional owner is how "whose data is this?" becomes a question nobody asks, and the
first caller that forgets silently reads whichever profile sorts first. Pages go
through `requireProfile()`, which pairs the session with its profile.

**The pipeline is already multi-user.** Ingest runs once — the corpus is shared, and
the relevance gate keeps anything relevant to *any* profile, so one person's criteria
cannot hide roles from another. Scoring, drafting and the email then loop over profile
owners, each email addressed to that user. With one user the behaviour is identical;
a second is a row in `users`, not a rewrite.

**Result.** 308 tests green, typecheck clean, across ~14 files.

**Blocked, and why.** `drizzle-kit generate` needs a TTY to ask whether
`profile_version → profile_id` is a rename or a new column, and the harness has none.
`--custom` copies the previous snapshot, so future migrations would drift; a piped
pseudo-TTY hangs. It is waiting in the user's terminal for two keystrokes
("create column" both times — the types differ, `integer` to `uuid`, so it is genuinely
a new column).

**Do not run the generated SQL as written.** It drops `profile_version` and adds an
empty `profile_id`, which orphans 292 matches and the drafts and outreach beneath them.
The backfill (`UPDATE … FROM profile` keyed on the old version) has to be inserted
between the add and the drop.

**Still to come.** Signup behind an invite gate, and the avatar picker on the login
screen.

**Files.** `src/db/schema/{users,profile,strengths,matches}.ts`,
`src/db/queries/{profile,matches}.ts`, `src/db/seed-profile.ts`, `src/lib/session.ts`,
`src/lib/notify.ts`, `src/pipeline/{run,ingest}.ts`,
`src/pipeline/scoring/{score,schema,schema.test}.ts`, `src/pipeline/drafting/draft.ts`,
`src/app/(app)/{today,matches,review}/page.tsx`, `src/app/(app)/matches/actions.ts`

---

## 2026-09-27 19:00 — The migration, hand-written

**Context.** `drizzle-kit generate` needs a TTY to ask whether `profile_version →
profile_id` is a rename, and the harness has none. `--custom` copies the previous
snapshot, so every later migration would diff against a stale picture. Written by hand
instead: the SQL *and* `0008_snapshot.json`.

**Two orderings a dry run caught, both of which would have failed in production.**

1. The backfill has to read `profile_version` before that column is dropped — obvious
   in hindsight, easy to write the other way round.
2. `profile_version_unique` cannot be dropped while the old foreign keys reference it.
   Postgres refuses, because an FK depends on the index backing the unique. Both FKs
   go first, then the constraint. The first attempt failed on exactly this, inside a
   transaction that was rolled back.

**Verifying a hand-written snapshot.** `drizzle-kit check` says "Everything's fine",
and — the real test — `drizzle-kit generate` reports **"No schema changes, nothing to
migrate"**. If the snapshot disagreed with the schema by so much as a column, it would
have produced a spurious migration or hung on a rename prompt. That round trip is what
makes a hand-written snapshot safe rather than a time bomb.

**Result.** Applied. 293 matches all scoped, 9 strengths, 1 profile owned, 27 drafts
and 27 outreach rows intact — nothing lost. 308 tests green; lint, typecheck and build
clean. `/today` renders against the migrated schema: queue 20, 293 matches, 2,325
postings.

**Files.** `drizzle/0008_scope_to_user.sql`, `drizzle/meta/0008_snapshot.json`,
`drizzle/meta/_journal.json`, `src/db/queries/profile.ts`

---

## 2026-09-27 19:15 — Closing the authorization gap

**Context.** The review found it: scoping stopped at the scoring path. `listDrafts`,
`countDraftsByStatus`, `listPipeline`, `getFunnelCounts` and `getSendStats` took no
owner, and every mutating action called `requireSession()` — which proves you are
signed in and never that the row is yours. The day a second person signed up they
would have seen, edited, approved and sent the first person's drafts.

**Action.** Ownership is now part of *fetching*, not a check after it:
`getOwnedDraft(id, profileId)`, `getOwnedOutreach(id, profileId)`,
`openOwnedOutreach(matchId, profileId)` and `ownsMatch`. An action that cannot obtain
a row cannot act on it, so there is no separate rule to forget. `actingProfileId()`
gives actions the caller's profile as a result rather than a redirect, since an action
cannot redirect the way a page can.

"No such row" and "not yours" return the same message deliberately — distinguishing
them confirms that someone else's row exists.

**The guard that matters more than the fix.** `src/lib/authorization.test.ts` walks
every `actions.ts`, asserts each user-scoped one establishes the acting profile, and
fails if any action calls an unscoped fetcher. It immediately caught a case I had
already "fixed": `markAppliedAction` and `dismissMatchAction` were safe only because
`ownsMatch` happened to run before `getOutreachForMatch`. Correct by call order is not
correct. Collapsed into `openOwnedOutreach`, where the scoping *is* the query.

**Result.** 319 tests green; lint, typecheck and build clean.

**Files.** `src/db/queries/{drafts,outreach}.ts`, `src/lib/session.ts`,
`src/lib/authorization.test.ts`, `src/app/(app)/{review,pipeline,matches}/actions.ts`,
`src/app/(app)/{pipeline,review}/page.tsx`

---

## 2026-09-27 19:30 — Signup, the profile builder, and the avatar picker

**Context.** The user's objection was right and worth quoting: *"Why tf are we seeding
a profile? Let them sign up!"* The data shape was never wrong; its only source was a
JSON file on one laptop, which meant no signup, no form, no validation, and no empty
state. Adding one person exposed all four absences at once.

**Action.**

*The contract moved.* `src/lib/profile-document.ts` holds the schema the seed script
used to keep private, plus `CV_PROMPT` — the prompt you paste into an LLM with your
CV. The same document now has two sources: a file, or a person's clipboard.

*Profile builder* at `/profile`. Copy the prompt, paste the JSON back, and it is
checked before it is saved: schema errors phrased for someone who pasted LLM output,
warnings for evidence pointing at strengths that do not exist, and a preview of every
strength with its evidence count. Two steps on purpose — checking is free, saving
replaces everything.

*Editing in place does not re-score.* `saveProfileDocument` keeps the profile's id by
default, so existing matches stay valid; a new version is an explicit checkbox that
says what it costs. Fixing a typo in a headline must not re-score 2,300 postings.

*Signup*, gated. *Avatar picker* on the login screen, with initials on a name-derived
colour as the normal case rather than a fallback — the same fill-versus-ink split as
the tier chips, so they clear 4.5:1 in both themes.

**The gate changed shape mid-build.** It started as an invite code; the user asked why
it existed. The reason is real — a public URL where every account spends the owner's
model budget — but the code was the wrong form of it. For two known people it is a
secret to generate, share, and remember to revoke, protecting against nobody in
particular. `SIGNUP_ALLOWED_EMAILS` names the two addresses instead: nothing to
forward, nothing to leak, one fewer field in the form, and self-documenting.

**Result.** 333 tests green; lint, typecheck and build clean. Verified by rendering:
`/login` shows the picker, `/signup` correctly reports closed with no allowlist set,
`/profile` shows the current profile and its strengths.

`db:seed:profile` is now a dev shortcut, not the only way in.

**Files.** `src/lib/{profile-document,signup-allowlist,signup-allowlist.test,env}.ts`,
`src/db/queries/{profile,users}.ts`, `src/components/{avatar,avatar.test,profile-importer}.tsx`,
`src/app/signup/*`, `src/app/login/{page,login-form}.tsx`,
`src/app/(app)/profile/*`, `src/components/app-nav.tsx`, `.env.example`, `docs/DEPLOY.md`

---

## 2026-09-27 19:50 — Tiers by rank, not by threshold

**Context.** 21% of matches were `strong` and the whole queue was strong, so the label
sorted nothing. The user's framing was the right one: *"We should always be able to
change models. Model tie-in in a project like this is poor architecture."* An absolute
threshold is exactly that tie-in — it hard-codes one model's scoring habits.

**Why a threshold could not be fixed by moving it.** Measured on 293 real matches:
**48 distinct scores**, 112 of them in the 80–90 band. The old `>= 85` line cut through
the densest part. Raise it to 90 and six matches are strong; lower it and hundreds are.
There is no good place to put a line through a spike.

**Action.** `tierByRank(percentile)` with `TIER_SHARES` — top 15% strong, next 35%
possible, bottom half stretch. `recalibrateTiers(profileId)` re-tiers a whole profile
in one statement with a window function, and `runScore` calls it after every run, since
a tier depends on the population and cannot be settled per row. Below `MIN_FOR_RANK`
(25) it skips and leaves the absolute thresholds: with five matches a percentile says
nothing.

**The first attempt landed at 21%, not 15%.** `percent_rank()` gives tied scores one
shared value — correct, since splitting equal scores by row order is arbitrary — but
**26 matches were tied at exactly 86**, which is where the 15% line falls, so the whole
cluster crossed together.

The fix is a tie-break with actual signal rather than a coarser bucket: rank on
`overall`, then on the sum of the five fit dimensions. Those genuinely vary inside a
tied score — 18 distinct sums among the 26 at 86 — so it separates on evidence.

**Result.** strong **45 (15%)**, possible 101 (34%), stretch 147 (50%), exactly as
specified, and now true by construction rather than by luck. 339 tests green; lint,
typecheck and build clean.

**Honest note.** Today's queue is still 20 of 20 strong — but that is now correct
rather than a symptom. There are 45 strong matches and the queue shows the best 20 of
them. "Strong" being scarce is what changed; the queue showing your best is what it is
for.

**Files.** `src/lib/scoring.ts` + test, `src/db/queries/matches.ts`,
`src/pipeline/scoring/score.ts`

---

## 2026-09-27 20:02 — React 441 on /today and /runs

**Context.** Two pages failed in production with a masked React error; every other page
was fine, and both returned 200 locally — so the code was right and the environment
differed.

**Diagnosis.** Only those two pass `env.TZ` into `Intl.DateTimeFormat`
(`/today` via `nextRunLabel`, `/runs` directly). `/settings` reads `env.TZ` but only
prints it, which cannot throw. `Intl` rejects anything that is not an IANA zone —
including a valid name with a stray space — and a throw inside a Server Component
render is exactly React 441.

**Action.** `withoutBlanks` now stores the trimmed value instead of testing `trim()`
and keeping the original, and `TZ` is validated against a real `Intl` call at boot, so
an unusable zone fails at startup with a message rather than at render without one.

**Result.** 342 tests green; lint, typecheck and build clean.

**Still possible, and worth ruling out second.** `/today` and `/runs` are also the only
two pages that read the `runs` table, which migration 0007 changed. If the fix above
does not clear it, the migration has not reached Neon — the two hypotheses have the
same blast radius, and the same fix order regardless.

**Files.** `src/lib/env.ts`, `src/lib/env.test.ts`

---

## 2026-09-27 20:20 — APP_TZ, and making the shared source flag honest

**Context.** Vercel refuses to let you define `TZ` — it is a POSIX variable that sets
the whole process's timezone, so hosts reserve it. And the sources review: one boolean
answering three unrelated questions.

**`TZ` → `APP_TZ`.** Atlas's display and schedule timezone is now its own variable
rather than an argument with the runtime about what the machine's clock reads. `TZ` is
still honoured as a fallback, because that is what a local `.env` and every shell habit
sets — `APP_TZ` wins where both exist.

**Sources: three concerns, separated.**

*Capability* stays `kind` + `config`. *Health* is new and written only by the pipeline
— `consecutive_failures`, `last_ok_at`, `last_error_at`, `last_error`. *Intent* is
`enabled`, now with `disabled_by` and `disabled_at`, so a board being off is a fact
with an author instead of an unexplained switch.

*Quarantine* (`src/pipeline/source-health.ts`): forgiving early, firm late. Two
failures are weather — the twenty that failed in one run were all transient. Three
rests the board six hours, six rests it a day, ten rests it a week. A rest is a pause,
not a verdict: the source is tried again the moment it elapses, and failures with no
recorded time are always retried rather than rested forever on incomplete data.

Resting sources are excluded from both sides of the coverage figure. Coverage answers
"of the boards we asked, how many answered", and a board we chose not to ask is
neither — counting it as a failure would make the banner cry wolf about a decision we
made on purpose.

*Owner-only disabling.* `users.role` existed and was unused. It was also useless as a
guard, because every signup defaulted to `owner` — the first account now owns the
install and later ones are members. Disabling a source changes everyone's corpus, so
it belongs to whoever set this up.

**Deliberately not built: per-user subscriptions.** That is the eventual shape, and it
is a tenancy model for a household. Two people who mostly want the same boards do not
need one; the attribution columns make the shared flag honest until someone actually
wants a board the other does not.

**Result.** 352 tests green; lint, typecheck and build clean. `/sources` now reports
enabled, open postings, holding-nothing and resting, and each row says whether it is
OK, failing, resting, or off and by whom.

**Files.** `src/lib/env.ts` + test, `src/db/schema/sources.ts`,
`src/db/queries/{sources,users}.ts`, `src/pipeline/{source-health,source-health.test,ingest}.ts`,
`src/app/(app)/sources/{page.tsx,actions.ts}`, `src/components/sources-manager.tsx`,
`drizzle/0009_source_health.sql`, `.github/workflows/pipeline.yml`, `docs/DEPLOY.md`

---

## 2026-09-27 20:35 — db:status, after diagnosing the same bug three times

**Context.** Three pages failed in production with React error 441 across one evening:
`/today`, `/runs`, then `/sources`. Each was investigated as a separate problem.

**They were one problem.** Every failing page referenced a column from a migration the
Neon database had never received:

| page | column | migration |
|---|---|---|
| `/runs`, `/today` | `runs.sources_ok` | 0007 |
| `/today`, `/matches` | `matches.profile_id` | 0008 |
| `/sources` | `sources.disabled_by` | 0009 |

`/sources` only began failing *after* 0009 shipped — which is the tell. The symptom
tracks the code, not the database: a page breaks the moment its query mentions a column
that is not there, so an unapplied migration presents as an unrelated mystery per
screen.

**Action.** `npm run db:status` lists every migration on disk and whether a given
database has it. Read-only, its own connection, no `server-only` modules, so it is safe
to point at production. `DEPLOY.md` now names it as the first thing to run when a
deployed page fails, and the troubleshooting section says what 441 actually means.

**Not wasted.** The `TZ` → `APP_TZ` rename and the untrimmed-env bug found along the
way were both real, and `Intl` genuinely does throw on a padded zone. They were just
not *this*.

**Result.** 352 tests green; lint and typecheck clean.

**Files.** `src/db/status.ts`, `package.json`, `README.md`, `docs/DEPLOY.md`

---

## 2026-09-27 20:50 — A preflight for the scheduled run

**Context.** The first real Actions run failed with the app's env validation — forty
lines of stack trace reporting `DATABASE_URL: expected string, received undefined`.
The workflow was correct; the repository secrets were simply not set.

**Why the message was useless here.** An unset secret arrives as an empty string, which
`withoutBlanks` strips, so the schema reports it as *undefined*. Accurate, and no help
at all: the real problem was a value missing from a settings page, and nothing in the
output said so or where to put it.

**Action.** A `Check configuration` step, first in the job — before checkout, before
`npm ci`, so it fails in seconds rather than after a minute of setup. It names exactly
which secrets are missing, and names the two configurations that look right and are
not: secrets added to an *Environment* (which needs `environment:` on the job) and the
Dependabot/Codespaces tabs, which Actions cannot read. Missing optional values warn
rather than fail — a run with no `RESEND_API_KEY` still does its work, it just cannot
tell you about it.

**Verified against the real shell.** GitHub runs `run:` blocks under
`bash -eo pipefail`, where `[ -z "$X" ] && echo …` can abort the script when the test
is false. I extracted the block verbatim from the committed YAML and ran it under those
exact flags, both with nothing set and everything set, rather than trusting a paraphrase
run under a plain shell.

**Result.** Failure now reads as one error line plus where to fix it.

**Files.** `.github/workflows/pipeline.yml`

---

## 2026-09-27 21:05 — A run that did nothing reported success

**Context.** The first Actions run that got past configuration finished in three
seconds with `sources 0/0`, everything zero, `status: ok`, and a green tick. The Neon
database has no `sources` rows — `db:seed:sources` was never run against it.

**The bug is the green tick, not the empty database.** `runStatusFor` returns `ok`
whenever there are no errors, and reading zero boards produced no errors. So an
unconfigured run is indistinguishable from a quiet day — which matters most for the
scheduled run, because nobody watches it. A green tick every morning on a database with
no sources is the worst available outcome: it looks like the system is working.

**Action.** `configurationErrors(ingest)` reports faults that mean the run could not
have worked whatever it said: no enabled sources at all (with the command that fixes
it), or every source resting. Returned as errors so the existing status logic turns
them into `failed` without inventing a second concept, and so they appear on the Runs
screen with everything else. Five tests, including the two cases that must stay silent
— a genuinely quiet day, and sources that failed, which is already an error elsewhere.

The Actions summary now prints `❌ none read — is the catalogue seeded?` for `0/0`
rather than a tidy-looking row, since the fix differs from a partial shortfall.

Also bumped `actions/checkout` and `actions/setup-node` to v5; v4 targets the
now-deprecated Node 20.

**Result.** 357 tests green; lint, typecheck clean.

**Files.** `src/pipeline/{run.ts,run.test.ts,cli.ts}`, `.github/workflows/pipeline.yml`

---

## 2026-09-28 07:20 — The scoring queue was not scoring the newest jobs

**Context.** Asked whether a backfill would mostly score old jobs. It would not — the
30-day ingest window means the whole corpus is last-month postings, and 57% of it is
from the last week. But checking turned up a real fault.

**The fault.** `getUnscoredJobs` ordered by `first_seen_at` — when *we fetched* a
posting — and ingest fetches in batches. Locally 2,324 jobs share 83 distinct values;
a first ingest gives every row the same instant. So the ordering claimed "newest first"
and delivered an arbitrary slice. That matters precisely because scoring only reaches
50 a day: the order decides what you ever see, and the first Neon run scored 50
effectively at random rather than the 50 freshest roles.

**Fix.** Order by `posted_at desc nulls last`, tie-breaking on `first_seen_at`. What
the employer published survives batching; when we happened to pull it does not.
Undated postings sort last — an unknown date is not evidence of freshness, and letting
nulls win would hand the queue to the boards that omit it.

**Result, measured.** The next 50 jobs to be scored drop from an average age of **6
days to 1 day**. Same cost, six times fresher. 357 tests green; lint, typecheck and
build clean.

**Files.** `src/db/queries/matches.ts`

---

## 2026-09-28 10:10 — Apply is the action, not "draft this now"

**Context.** The drawer's loudest button was "Draft this now", with the actual application
link demoted to a quiet "Open original" text link. But almost every role applies through an
ATS form (Ashby, Greenhouse, Lever) — the user's action is to open that link and apply, not
to write an email. Drafting is only useful for the rare posting that gives you an address.

**Action.**

- **`MatchRow` gained `contactEmail` / `contactIsPersonal`**, extracted from the posting at
  read time via `lib/contact` (the same way drafts already derive it) — the signal for
  "this role can be applied to by email".
- **Drawer CTA inverted** (`match-drawer.tsx`): **Apply** (opens the posting) is now the
  primary button; **Draft email** appears only when `contactEmail` is present; "Not
  interested" stays. A closed role shows a "View posting" link only.
- **The cron only auto-drafts email-apply roles** (`draft.ts`): `runDraft` filters its
  targets to those with a `contactEmail`. Link-apply strong matches are left to Apply — no
  wasted LLM spend and no review-queue clutter for emails with no recipient. On-demand
  drafting refuses a link-apply role with a legible message.

**Verification.** In `/preview`, opened both drawer states: a link-apply role shows **Apply +
Not interested** (no draft); an email-apply role shows **Apply + Draft email + Not interested**.
357 tests green; lint, typecheck and build clean.

**Files.** `src/db/queries/matches.ts`, `src/components/match-drawer.tsx`,
`src/pipeline/drafting/draft.ts`, `docs/INTERFACE.md`

---

## 2026-09-28 11:34 — Apply button on the Today cards

**Context.** Apply became the primary drawer action, but a Today card still needed a click
into the drawer to reach it.

**Action.** Added an **Apply** button to `match-card.tsx` (opens the posting), so you can apply
straight from the daily queue without the detour.

**Result.** 357 tests green; lint, typecheck and build clean. Verified in `/preview`.

**Files.** `src/components/match-card.tsx`

---

## 2026-09-28 13:40 — Jev: the evaluation primitive (calibration blocked on a Gateway card)

**Context.** Sign-off to add Jev (TypeSafe AI's System-1 model) to cut scoring cost. It returns
typed decisions (score / choice / boolean) with no prose, ~100x cheaper — a fit for the numeric
half of scoring, not the why-you / reasoning text, which stays on `generateStructured`.

**Action.**

- **`lib/llm/evaluate.ts`** — wraps AI SDK's `experimental_evaluate` behind the same boundary
  (only `lib/llm` names the Gateway or reads its key), via `@ai-sdk/gateway` and model
  `typesafe-ai/jev`. Answer types are inferred from the questions; same timeout/retry budget as
  `generateStructured`. Exposed through `lib/llm/index.ts`.
- **`AI_GATEWAY_API_KEY`** added to `env.ts` and `.env.example`; `llm:smoke:jev` script.

**Result.** tsc, lint and the 50 `lib/llm` tests green. The smoke call **reached the Gateway and
authenticated** — the request is well-formed — but returned `customer_verification_required`:
the AI Gateway account needs a **credit card on file** to service requests, even to unlock the
free credits. So the seam is verified to the API boundary; the numeric scorer and the
calibration pass are blocked until the card is added.

**Files.** `src/lib/llm/{evaluate,jev-smoke}.ts`, `src/lib/llm/index.ts`, `src/lib/env.ts`,
`.env.example`, `package.json`

---

## 2026-09-28 13:53 — Jev scorer + calibration harness (blocked on paid credits)

**Context.** Card added, ZDR made opt-in. Next: the numeric scorer and the calibration pass.

**Action.**

- **`pipeline/scoring/jev.ts`** — the numeric fit scorer. Maps the §9 rubric onto Jev `score`
  questions (overall + 5 dimensions + one per strength), sends profile + job as state, and
  rescales each answer (a weighted mean over rubric levels) back to 0-100. No prose — `why_you`
  / `reasoning` stay on `generateStructured`, run only for the shortlist in the eventual split.
- **`pipeline/scoring/calibrate.ts`** + `scoring:calibrate` — re-scores N already-LLM-scored
  jobs with Jev and reports Spearman (rank) + Pearson + MAE on `overall`, per-dimension MAE, and
  Jev cost (with a 2,000-job projection). Retries transient 429s with backoff.

**Result.** tsc + lint clean. Calibration could not complete: with the card in place and ZDR
opt-in, the Gateway now returns "Free tier users do not have access to this model — upgrade to
paid credits." **Jev needs paid credits (a top-up)** on the Vercel AI Gateway account, not just a
card on file. Nothing is wired into the live pipeline; the scorer and calibration are staged to
run the moment credits are added, and only then does the split get wired and the backfill run.

**Files.** `src/pipeline/scoring/{jev,calibrate}.ts`, `package.json`

---

## 2026-09-28 14:15 — Jev calibration blocked by upstream rate limits; verdict and routing direction

**Context.** Paid credits added. Ran the calibration to decide Jev adoption before the backfill.

**Action.** Paced the calibration (8s between calls, backoff to 50s) after bursts tripped the
gateway rate limit.

**Result.** Paid access works — Jev returns scores — but the upstream throttles this account to
~1 call every few minutes ("high demand"), so calibration could not complete and a 2,032-job
backfill is infeasible through Jev. The one job that scored diverged sharply from the LLM (91 vs
58/59). **Verdict:** Jev is a System-1 (no-reasoning) model — a fit for crisp gates (relevance
filter, dealbreaker booleans) but the wrong tool for the nuanced fit *score*, where the reasoning
is the value. Not adopting it as the scorer; kept staged for the relevance gate later. Direction:
route the LLM layer through the Vercel AI Gateway (key + credits already present) and pick a
cheaper scoring model per task, reusing the calibration harness to compare it against gpt-5-mini.
Backfill spend (gpt-5-mini now vs after picking the cheaper model) still open with the user.

**Files.** `src/pipeline/scoring/calibrate.ts`

---

## 2026-09-28 14:57 — Scorer A/B: low reasoning holds, ~$0.0027/job

**Context.** Deciding scoring effort before the Neon backfill (2 users, ~4,441 unscored). Reasoning
is ~90% of the bill, so the cheapest lever that keeps the corpus on one model is lower reasoning,
not a different vendor. Jev was rejected as the scorer (no reasoning → 91→59); this tests the same
`gpt-5-mini` at low reasoning vs its stored default-reasoning scores.

**Action.** Built `pipeline/scoring/ab.ts` (`scoring:ab`) — re-scores a spread of a profile's
already-scored jobs at a given reasoning effort and reports rank correlation, error, tier agreement
and cost. Ran 12 spread jobs for manuchim (first sample was top-cluster only and gave a misleading
ρ; fixed to sample across the range).

**Result.** Low tracks default: Spearman ρ **0.888**, Pearson 0.931, overall MAE **2.6**, tier
agreement **9/12** (all boundary wobble). Per-dimension MAE small except **location_fit ~15** (the
most reasoning-dependent dimension). Cost halves — output 2157→1115 tok/job, $0.0052→**$0.0027**.
Projected backfill ~$11.8 both users / ~$5.9 one. Verdict: adopt low reasoning and push it so the
daily cron matches the backfill; back one user fits the $10 credit, both slightly exceeds it.

**Files.** `src/pipeline/scoring/ab.ts`, `package.json`
