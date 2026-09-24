# Atlas — Product Requirements Document

*A personal job-match command center that finds the roles worth your energy,
scores them against your real strengths, and drafts outreach that argues for you.*
*Version 1.0 — final build spec, ready for Claude Code.*

---

## 0. How to read this document

This is a build spec, not a pitch. It is written to be handed to a coding agent
and executed phase by phase. Section 14 has the Claude Code prompt. Every decision
here has a reason next to it, because right-sized judgment is part of what makes
the result read as senior engineering.

Two framing decisions, stated loudly up front:

**Atlas is deliberately NOT a distributed system.** It is a scheduled batch job
plus a web app, for one user. No message queue, no workers, no microservices. A
queue would be over-engineering for a workload that runs ~2 minutes, twice a day,
for one person. Choosing the simple architecture *because the problem is simple* is
the senior signal.

**Atlas is a single Next.js app** (App Router), not a separate frontend and
backend. Next.js is both: Server Components render the read screens, Server Actions
handle mutations, and a couple of route handlers are the entry points for the
scheduled pipeline and OAuth. One repo, one deploy, backend included — but with a
disciplined server/client split (see §6 and §12) so nothing is a tangle.

**Atlas is built around your strengths, not a static CV blob.** Your strengths are
structured, first-class data. They are what jobs are scored *against* and what
outreach argues *from*. This is the spine of the product — see §7, §9, and the
drafting spec.

---

## 1. Product overview

**What it is.** Twice a day Atlas pulls new job postings, scores each against your
structured strengths and preferences, drafts a tailored outreach email for the
strong matches that cites real evidence from your background, and presents
everything in a calm console where you approve and send with one keystroke. It
tracks each role through your pipeline and stops chasing anyone who replies.

**Who it is for.** You — a senior full-stack engineer targeting Forward Deployed
Engineer and AI-systems roles, open to relocation. You are user number one, which
is the whole reason this is worth building: the customer is real, the pain is real,
and competition is irrelevant because you are not selling it.

**The problem it solves.** Applying is draining and noisy. Most listings are not a
fit; the few that are get buried; and personalizing outreach by hand does not scale
across a real search. Worse, generic tools flatten your actual edge — the unusual
fintech-reliability + distributed-systems + AI combination — into "senior engineer."
Atlas removes the noise, does the repetition, and makes the case *for you
specifically*, leaving you only the decision to reach out and the final word on what
gets said.

**What "done" feels like.** You open Atlas in the morning, five strong matches wait
with drafts attached — each draft already citing a real thing you built — you read
two, edit one, approve three, and close it in four minutes.

---

## 2. Goals and non-goals

**Goals**
1. Surface the few roles worth your energy each day, scored and explained *by which
   of your strengths they reward*.
2. Cut per-application effort to seconds without sacrificing personalization.
3. Draft outreach grounded in your real strengths and evidence, not generic
   enthusiasm.
4. Keep a human in the loop on every send. Nothing goes out unapproved.
5. Protect your sender reputation and your time.
6. Be a portfolio-grade artifact: clean architecture, real engineering standards, a
   world-class interface.

**Non-goals**
- Not a client/freelance lead-gen tool. Jobs only.
- Not an auto-apply spray machine. Quality over volume, always.
- Not multi-tenant. Single user.
- Not a distributed system. No queue, workers, or microservices.
- Not a LinkedIn scraper. Official and public sources only (§11).

---

## 3. Success metrics

- **Signal quality:** of the roles marked "strong," what share do you agree are
  genuinely worth applying to? Target ≥ 80%.
- **Effort:** median time to clear a day's queue ≤ 5 minutes.
- **Throughput without spam:** deliverability-safe volume, bounce < 2%, complaints
  < 0.1%.
- **Outcome:** reply rate and interviews. The real scoreboard.
- **Portfolio:** a repo and a build-in-public thread that make senior engineers and
  FDE recruiters take you seriously.

---

## 4. Users and primary flow

**Primary user:** you. Single account, Google login.

**Daily flow:** scheduler fires (~6:00 and 14:00 your time) → pipeline ingests,
dedupes, scores, drafts for strong matches, records the run → you get a short "N new
matches" notification → you review, open a match, read the fit + strengths
breakdown and the draft, edit if needed, approve & send or skip → sent roles enter
the pipeline tracker; replies flip them to "replied" and stop further chasing.

---

## 5. Scope — MVP vs later

**MVP (v1):** one to three sources (start with one); ingest → dedupe → score →
draft → review → approve → send; structured strengths model driving scoring and
drafting; human-approved Gmail sending with guardrails; pipeline tracker with reply
detection; twice-daily schedule + run history; the full design system and
interaction polish.

**Later (deferred):** more sources; two-stage model routing for cost (cheap triage →
strong model on finalists); human-gated follow-up sequences; interview-prep notes
per role; the strengths-insight view (§10.3) can be v1.1 if time is short;
containerized pipeline + infrastructure-as-code (optional DevOps layer, §12).

---

## 6. Architecture (single Next.js app, deliberately simple)

```
            ┌──────────────────────────────────────────────┐
  Schedule  │  GitHub Actions cron (or Vercel Cron)         │
  twice/day │  → hits the pipeline route handler            │
            └───────────────────────┬──────────────────────┘
                                    │
                                    ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                    ATLAS — one Next.js app                     │
   │                                                                │
   │  Server Components  →  read screens (Today, Matches, Runs)     │
   │  Server Actions     →  mutations (approve, skip, edit, send)   │
   │  Route handlers     →  pipeline entry, Gmail/OAuth callbacks   │
   │  Client Components   →  interactive islands (table nav,        │
   │                          match drawer, optimistic approve)     │
   │                                                                │
   │  PIPELINE (a plain TS module the route handler invokes):       │
   │  ingest → normalize → dedupe → score(LLM) → draft(LLM)         │
   │        → persist → notify   (~2 min, top-to-bottom)            │
   └───────────────┬───────────────────────────┬──────────────────┘
                   │ Drizzle                    │ googleapis
                   ▼                            ▼
      ┌─────────────────────────┐   ┌────────────────────────────┐
      │  Postgres                │   │  Gmail API (send, guarded) │
      │  deploy: Neon            │   │  human-approved only        │
      │  local dev: Docker PG    │   └────────────────────────────┘
      │  sources, jobs, profile, │
      │  strengths, evidence,    │
      │  matches, drafts,        │
      │  outreach, runs          │
      └─────────────────────────┘
```

**Rendering model (this is how the server/client split stays clean):**
- **Latest stable Next.js, App Router.** No Pages Router.
- **Server Components** for data/read screens (Today, Matches, Match detail, Runs) —
  rendered server-side, data fetched on the server.
- **Server Actions** for every mutation (approve, skip, edit a draft, send, save
  profile/strengths).
- **Route handlers (`app/api/*`)** only for: the scheduled pipeline entry point, the
  Gmail/OAuth callbacks, and any webhook. Not for internal data fetching.
- **Client Components** (`"use client"`) only for interactive islands — the
  keyboard-navigable matches table, the match drawer, optimistic approve/send,
  toasts — mounted inside server-rendered shells. App logic never lives in client
  components; the interactive controls are never server-rendered.
- **Auth on the server:** Auth.js (NextAuth), single Google login; session checked
  in Server Components and Server Actions, not just hidden in the UI.

**Why each piece, and why nothing more:** scheduler is a cron line (two runs a day
needs no broker); the pipeline is one module invoked by a route handler (no
throughput problem, so nothing for a queue to solve); the "review queue" is a
database table, not a message queue.

**Database hosting:** Postgres on **Neon** (serverless, free tier, zero ops) for the
deployed app; a **local Postgres via Docker Compose** for development so you never
develop against live data (see §12 / §15). Same Postgres, two instances. Drizzle ORM
+ migrations over both.

---

## 7. Data model

Postgres, Drizzle-managed migrations, `timestamptz` throughout. The strengths and
evidence tables are the new spine.

**`sources`** — `id, name, kind(greenhouse|lever|ashby|rss|api), config(jsonb),
enabled, created_at`

**`jobs`** — `id, source_id, external_id, title, company, location, remote(bool),
url, description(text), posted_at, first_seen_at, raw(jsonb)`
- `UNIQUE(source_id, external_id)` — the idempotency key; re-ingesting a posting is a
  no-op.

**`profile`** — your positioning, versioned.
`id, version, headline, target_roles(jsonb), seniority, locations(jsonb),
relocation(bool), dealbreakers(jsonb), cv_text(text), created_at`
- Versioned so changing preferences can trigger a targeted re-score.

**`strengths`** — your capabilities as first-class data (the spine).
`id, profile_version, key(slug), label, kind(core|differentiator), weight(int),
summary(text), created_at`
- `kind=core` — a named capability (e.g. `payments-reconciliation`,
  `distributed-reliability`, `full-stack-delivery`, `ai-systems`).
- `kind=differentiator` — a rare combination that makes you *you* (e.g.
  `fintech-reliability + ai-systems`, `build-and-operate`,
  `civil-eng-systems-thinking`).
- `weight` — how central it is to your target, for scoring emphasis.

**`evidence`** — concrete proof points, tagged by strength.
`id, strength_id, claim(text), context(text), metric(text|null), source(text),
created_at`
- e.g. claim "built the reconciliation layer for the payments system", context
  "StartButton", metric optional. The drafter pulls from here so outreach cites real
  achievements, not generic enthusiasm.

**`matches`** — one strength-aware score per (job, profile version).
`id, job_id, profile_version, overall(int 0-100), tier(strong|possible|stretch),
dimensions(jsonb), strength_matches(jsonb), why_you(text), reasoning(text),
red_flags(jsonb), model, tokens_in, tokens_out, scored_at`
- `dimensions` = `{ role_fit, seniority_fit, tech_fit, location_fit, company_fit }`,
  each 0–100.
- `strength_matches` = array of `{ strength_key, rewarded(0-100) }` — which of your
  named strengths this role actually rewards, and how strongly. This is what makes
  the score legible ("strongly rewards payments-reliability + ai-systems, light on
  mobile") and what feeds the draft.
- `why_you` = one specific sentence on why you in particular fit this role.
- `UNIQUE(job_id, profile_version)`.

**`drafts`** — `id, match_id, recipient(text|null), subject, body(text),
edited_body(text|null), status(pending|approved|skipped|sent|failed), created_at,
decided_at`

**`outreach`** — `id, match_id, channel(email|apply_link),
status(drafted|sent|replied|interview|offer|rejected|closed), sent_at, replied_at,
notes, updated_at`
- Reply detection flips to `replied` and suppresses further contact.

**`runs`** — `id, started_at, finished_at, jobs_seen, new_jobs, scored, drafted,
errors(jsonb), tokens_in, tokens_out, cost_usd, status(ok|partial|failed)`

---

## 8. The pipeline, stage by stage

1. **Ingest.** For each enabled source, fetch current postings; write to `jobs`
   keyed by `(source_id, external_id)`. Start with one ToS-clean source.
2. **Normalize.** Map each source's shape into the common fields; parse
   location/remote; keep raw JSON.
3. **Dedupe / idempotency.** The unique key makes re-ingestion a no-op; only new
   postings proceed.
4. **Score (strength-aware).** For each new job, call the LLM with your profile +
   your `strengths` (and their weights) + the posting; get back the §9 JSON:
   overall, dimensions, **strength_matches**, **why_you**, tier, reasoning, red
   flags. Validate with Zod; retry once on malformed output. Persist to `matches`.
   Only score unscored jobs (cost control).
5. **Draft (strength-grounded).** For `strong` matches (and `possible` if opted in),
   draft outreach that is *required* to build on the specific strengths flagged in
   `strength_matches` and cite a real item from `evidence` for one of them.
   Persist to `drafts` as `pending`. Never send here.
6. **Persist + record.** Write a `runs` row (counts, tokens, cost, errors) — your
   observability.
7. **Notify.** Send yourself a short "N new matches, T strong" message.

**Cheap reliability details:** retry LLM/network calls with capped backoff;
rate-limit LLM concurrency; wrap each job so one failure records an error and
continues; every run idempotent (re-run processes only genuinely-unscored jobs).

---

## 9. Scoring logic (strength-aware)

Structured-output/tool-use mode so the result is guaranteed JSON. Schema:

```json
{
  "overall": 0,
  "tier": "strong | possible | stretch",
  "dimensions": {
    "role_fit": 0, "seniority_fit": 0, "tech_fit": 0,
    "location_fit": 0, "company_fit": 0
  },
  "strength_matches": [
    { "strength_key": "payments-reconciliation", "rewarded": 0 },
    { "strength_key": "ai-systems", "rewarded": 0 }
  ],
  "why_you": "one specific sentence: why this candidate in particular",
  "reasoning": "2-3 sentences, specific, no fluff",
  "red_flags": ["e.g. requires on-site in a city ruled out"]
}
```

The model receives your `strengths` (with weights) and `evidence` summaries so it
can map the role onto your actual capabilities rather than re-deriving them from
prose each call. Tiers (configurable): strong ≥ 85, possible 65–84, stretch < 65.
Cost optimization for later: cheap model to triage, strong model on finalists.

---

## 10. Frontend and UX — the world-class layer

Brief: a precision instrument for a draining task — calm, high-signal, in control.
A mission console that filters noise, not a busy dashboard that adds to it. Spend
the boldness in exactly one place: the **fit score**.

### 10.1 Design tokens — "Ink & Signal"

**Color** — Light: paper `#F5F6F8` · surface `#FFFFFF` · ink `#16181D` · muted
`#5A6472` · hairline `#E3E6EB`. Dark (user-toggleable): base `#12141A` (considered
deep slate, not `#0B0B0B`) · surface `#1A1D26` · raised `#222634` · text `#E7E9EE` ·
muted `#8A93A6` · hairline `#2A2F3C`. Interactive accent: indigo `#4C5BD4` (one
accent, interactive intent only). Fit tiers (semantic, used sparingly): strong
`#2E9E6B` · possible `#C98A2B` · stretch `#6B7280`.

**Type** — Display + numerals: **Space Grotesk** (the score/gauge/titles; the score
treatment *is* the type moment). Body/UI: **Geist Sans** (system fallback), chosen
over default Inter deliberately. Tabular data: body face with `tabular-nums`; no
decorative monospace labels. Scale per Elements of Typographic Style; body line
length < 80ch.

**Radius/elevation:** radii vary by hierarchy (not one radius on everything);
elevation quiet, one considered shadow reserved for the match drawer.

### 10.2 The hero and the score

Fit is the characteristic object, so the score is the hero — a considered **gauge**,
not a plain big number. On Today, the day's top matches reveal once on load, each
gauge animating 0 → value a single time. That is the product's one orchestrated
motion moment.

### 10.3 Screens

1. **Today** — the run summary (new / strong / pipeline snapshot) and top strong
   matches with gauges. Empty state as direction: *"Next run at 6:00. Nothing to
   review right now."*
2. **Matches** — the console table. Rows anchored by the fit score, with role,
   company, location, tier chip, status; sortable/filterable by score, tier,
   location, company, date. **Keyboard-first:** `j`/`k` move, `enter` open, `a`
   approve, `s` skip, `e` edit; visible focus states.
3. **Match drawer** — full posting; the five-dimension fit readout; **the strengths
   this role rewards** (from `strength_matches`) and the `why_you` line; reasoning;
   red flags; the editable draft; actions.
4. **Review queue** — drafts awaiting decision; inline edit; approve & send shows a
   guardrail readout (recipient present? within today's cap?).
5. **Pipeline** — the funnel drafted → sent → replied → interview → offer/rejected;
   replies visibly halt chasing.
6. **Profile & strengths** — edit positioning, target roles, locations, relocation,
   dealbreakers, CV text, and your **strengths + evidence** (the spine). Saving
   offers to re-score.
7. **Strengths insight (optional, v1.1 ok)** — a lens on the whole search: which
   strengths the market is rewarding most, which roles keep asking for something you
   lack, where your differentiators land best. Turns Atlas into a mirror on your
   positioning.
8. **Runs** — history with counts, cost, errors — observability.
9. **Settings** — sources, schedule, sending identity, model, budget caps, theme.

### 10.4 Motion (restrained, purposeful)

One orchestrated reveal (Today matches stagger in once); score gauges animate once;
approve & send confirms (check morph), flips status optimistically, slides the row
out, toast *"Sent to {company}."* with rollback on failure; status changes
optimistic with rollback; skeletons not spinners; `prefers-reduced-motion` collapses
all of it to instant.

### 10.5 Anti-patterns — do not ship (they read as AI-generated)

No cream + serif + terracotta. No near-black + single acid-green/vermilion accent.
No SaaS-card kit (identical rounded cards, one radius on everything, the same soft
grey shadow under each, gradient washes as decoration). No tracked-out ALL-CAPS
eyebrow labels. No `→` on buttons/links; no middle-dot meta strings; no
`WORD — fragment` labels. No tinted-black-for-black; no monospace labels. No
fade-and-slide-up on every card / hover-lift on every tile — motion is reserved per
§10.4.

### 10.6 Copy

Plain, active, consistent — a button says what happens ("Approve & send"), the toast
uses the same verb ("Sent"). Errors state what happened and how to fix it, in the
interface's voice, never apologizing. Empty states invite the next action.

### 10.7 Quality floor (non-negotiable)

Responsive to mobile; visible keyboard focus; reduced motion respected; WCAG AA
contrast; harmonious palette; fast (skeletons, optimistic UI, no layout shift).

---

## 11. Guardrails and risks

**Deliverability (protects your real job search — hard rules):** send from a
**separate identity/alias**, not your primary address; **warm up** a new identity
over 2–4 weeks; cap at **~30–50 sends/day**, ramp gradually; **verify** each
recipient; monitor bounce (< 2%) and complaints (< 0.1%) and auto-throttle if either
climbs; **human approval mandatory** (auto-send flag defaults off and ships off);
**respect replies** — stop all further contact once someone replies.

**Legal / ToS:** no LinkedIn scraping; use official job-board APIs (Greenhouse,
Lever, Ashby), company career pages, RSS, licensed aggregator APIs; honor each
source's terms; include your identity and an easy opt-out in outreach.

**Cost:** only score new jobs; cap tokens per run; design for cheap-triage →
strong-finalist routing (later); record cost per run.

**Privacy:** your data; secure secrets, don't commit keys, lock the app to your
account.

---

## 12. Engineering standards (enterprise-level)

- **Language:** TypeScript, `strict`. No `any` at boundaries.
- **App:** single Next.js app (App Router, latest stable). Rendering model per §6:
  Server Components for reads, Server Actions for mutations, route handlers only for
  pipeline/OAuth/webhooks, Client Components for interactive islands. Auth checked
  server-side (Auth.js, single Google login).
- **Structure:** clear internal modules — `pipeline/` (ingest, score, draft),
  `db/` (schema, migrations, queries), `app/` (routes + UI), `lib/` (llm client,
  gmail client, config, logging).
- **DB:** Postgres. **Neon** for deploy; **local Postgres via Docker Compose** for
  dev (never develop against live data). Drizzle ORM + migrations over both.
- **Validation:** Zod at every boundary — env, action inputs, and especially LLM
  output (never trust model JSON unparsed).
- **Errors:** typed, surfaced, never swallowed; per-job failures recorded in the
  run, never abort it.
- **Reliability:** idempotent ingestion, retries with backoff, LLM/Gmail rate
  limiting, graceful degradation.
- **Observability:** structured logs + the `runs` audit trail + a Runs screen.
- **Secrets/config:** typed config module, env-based secrets, nothing committed.
- **Testing:** unit (scoring parse, dedupe, normalizers, strength mapping);
  integration (pipeline run against fixture postings); one Playwright E2E for
  approve → send.
- **CI/CD:** GitHub Actions — lint, typecheck, test on PR; deploy to Vercel on main;
  scheduler as a scheduled Actions workflow (or Vercel Cron).
- **Local dev:** `npm run dev` for the app + `docker compose up` for local Postgres.
  Do **not** containerize the Next.js dev server — that adds friction for no gain.
- **Optional DevOps layer (your Docker/CKAD/Terraform reps — not required for MVP):**
  containerize the *pipeline* module and Terraform the Neon/Vercel resources, added
  *after* the product works, clearly optional. Do not let it delay v1.
- **Accessibility & performance budgets** enforced in CI where practical.

---

## 13. Build order (phased, each milestone shippable)

- **M0 — Skeleton.** Latest Next.js App Router app; Drizzle schema (including
  `strengths` + `evidence`) + first migration; **`docker-compose.yml` for local
  Postgres**; env/config; Auth.js Google login with server-side session; logging;
  CI. Runs cleanly, does nothing yet.
- **M1 — Ingest + dedupe.** One source. Prove idempotency (run twice, second is a
  no-op). Postings visible in a bare list.
- **M2 — Strengths + strength-aware scoring + Matches UI.** Seed your `strengths`
  and `evidence`; LLM scoring with the §9 schema (dimensions, strength_matches,
  why_you); the Matches table (Server Component) with the fit gauge and the
  strengths-rewarded readout in the drawer. First "wow."
- **M3 — Drafts + review queue.** Strength-grounded draft generation (must cite
  evidence); the review queue with inline edit and approve/skip (Server Actions). No
  sending yet.
- **M4 — Sending + tracker.** Gmail send with all §11 guardrails; the pipeline
  tracker; reply detection that halts chasing.
- **M5 — Schedule + notify + runs.** Twice-daily cron; the notification; the Runs
  screen.
- **M6 — Design pass.** Apply the full "Ink & Signal" system, the orchestrated
  reveal, keyboard nav, empty states, accessibility, performance. World-class, not
  merely working.
- **M7 (optional) — DevOps layer + strengths-insight view.** Containerize the
  pipeline; Terraform the infra; ship the strengths-insight screen (§10.3).

Ship and screenshot at each milestone — that is your build-in-public sequence.

---

## 14. Claude Code build prompt

Save this PRD as `docs/PRD.md`, then paste the following into Claude Code from the
repo root.

```
Stack modernity + rendering rules (these override anything vaguer in the PRD):
- Latest stable Next.js with the App Router. No Pages Router. One app — no separate
  backend.
- Read screens (Today, Matches, Runs, Match detail) are React Server Components,
  rendered server-side, fetching data on the server.
- Mutations (approve, skip, edit a draft, send, save profile/strengths) use Server
  Actions.
- Route handlers (app/api/*) only for: the scheduled pipeline entry point, the
  Gmail/OAuth callbacks, and any webhook. Not for internal data fetching.
- Interactive pieces (the keyboard-navigable matches table, the match drawer,
  optimistic approve/send, toasts) are Client Components mounted as islands inside
  server-rendered shells. Do NOT put app logic in client components and do NOT
  server-render the interactive controls. Server components for shell + data; client
  components for interactivity.
- Enforce auth on the server: Auth.js (NextAuth) single Google login; check the
  session in Server Components and Server Actions.
- TypeScript strict; Zod at every boundary (env, action inputs, LLM output);
  Drizzle + Postgres; Tailwind + shadcn/ui + Framer Motion; Anthropic SDK;
  googleapis for Gmail.
- Database: Neon Postgres for deploy; local Postgres via a docker-compose.yml for
  dev. Do NOT containerize the Next.js dev server.

Now build the project specified in docs/PRD.md. Read the whole PRD first and treat
it as the source of truth.

Rules of engagement:
- Work milestone by milestone (M0 → M6, M7 optional). At the end of each milestone,
  stop, show me what you built and how to run it, and wait for my go.
- Hold the §12 engineering standards throughout. Do not cut them to move faster.
- This is NOT a distributed system. No message queue, workers, or microservices.
  Scheduler = cron; pipeline = one module invoked by a route handler; "review
  queue" = a database table. If you think something needs a queue, stop and ask me.
- The product is built around my STRENGTHS as structured data (strengths + evidence
  tables). Scoring must return which of my strengths a role rewards (strength_matches)
  and a why_you line; drafts must build on those strengths and cite a real evidence
  item. Do not collapse this into a static CV blob.
- Sending is human-approved only; the auto-send flag defaults off and ships off.
  Implement every deliverability guardrail in §11.

For the frontend (M6 especially), follow §10 exactly: the "Ink & Signal" tokens,
Space Grotesk for the score/titles and Geist Sans for UI, the restrained motion
rules, and AVOID every anti-pattern in §10.5 (no cream+serif+terracotta, no
SaaS-card kit with one radius and the same grey shadow everywhere, no ALL-CAPS
eyebrows, no "→" on buttons, no monospace labels, no fade-up-on-every-card). Spend
the boldness only on the fit score. Meet the quality floor: responsive, visible
keyboard focus, prefers-reduced-motion respected, WCAG AA contrast, no layout shift.

Start with M0. Propose the exact folder structure, the dependencies you'll add and
why, the docker-compose.yml for local Postgres, and the first migration (including
strengths + evidence), then implement M0 and show me how to run it.
```

---

## 15. Appendix

**A. Local dev setup.** `docker compose up -d` starts local Postgres; set
`DATABASE_URL` to it; `npm run db:migrate`; `npm run dev`. Deploy points
`DATABASE_URL` at Neon. Same schema, two instances.

**B. Scoring prompt (sketch).** System: "You score how well a posting fits a specific
candidate, given their structured strengths and weights. Be strict; most jobs are
not a strong fit. Identify which of the candidate's named strengths the role
rewards. Return only the required JSON." User: profile + strengths (with weights) +
evidence summaries + the posting. Enforce the §9 schema; validate with Zod; retry
once on invalid JSON.

**C. Draft prompt (sketch).** System: "Write a short, specific outreach email from
this candidate to this role. Build on the strengths flagged as rewarded, and cite
one real item from their evidence for one of those strengths. Reference one concrete
thing from the posting. Include the portfolio link. No flattery, no cliché, under
120 words." Never send; store as `pending`.

**D. Environment (`.env`, never committed).** `DATABASE_URL, ANTHROPIC_API_KEY,
AUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GMAIL_OAUTH_*, SENDING_ADDRESS,
DAILY_SEND_CAP, MODEL_SCORING, MODEL_DRAFTING, AUTO_SEND=false, TZ`

**E. Reminder.** The distributed-systems and Python/FastAPI learning you want lives
in the separate chaos-engineering project, where the throughput and the Python-native
ecosystem justify them. Keep Atlas simple and single-language on purpose — that
restraint is the senior move, and it ships faster.
