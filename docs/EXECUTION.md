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
