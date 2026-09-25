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
