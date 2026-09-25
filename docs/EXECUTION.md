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
