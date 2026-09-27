# Atlas

A personal job-match command center. Twice a day it ingests job postings, scores each
against your **structured strengths**, drafts strength-grounded outreach for the strong
matches, and presents everything in a calm console where you approve and send with one
keystroke.

Built as a single **Next.js (App Router)** app — Server Components for reads, Server
Actions for mutations, route handlers only for the scheduled pipeline and OAuth. It is
deliberately **not** a distributed system (PRD §0). The full spec lives in
[`docs/atlas-prd.md`](docs/atlas-prd.md).

> **Status: M0 — Skeleton.** Runs cleanly, does nothing yet. The schema, auth, config,
> logging, and CI are in place; ingestion/scoring/drafting/sending arrive in M1–M5.

## Stack

- Next.js 16 (App Router, React 19, Turbopack) · TypeScript strict
- Postgres via Drizzle ORM (postgres.js) — local Docker Postgres for dev, Neon for deploy
- Auth.js v5 — email/password (Argon2id), JWT cookie sessions
- Tailwind v4 + shadcn/ui + Framer Motion (`motion`) · Zod at every boundary · pino logging

## Prerequisites

- Node.js **20 LTS or 22 LTS** (this repo also runs on 21, but LTS avoids engine warnings)
- Docker (for local Postgres)

## Getting started

```bash
# 1. Configure environment
cp .env.example .env.local
#    then set at least:
#      AUTH_SECRET            (openssl rand -base64 32)
#      AUTH_USER_EMAIL        your login email
#      AUTH_USER_PASSWORD     your login password (min 8 chars)

# 2. Install
npm install

# 3. Start local Postgres
npm run db:up

# 4. Create the schema and your user
npm run db:generate     # writes drizzle/0000_*.sql (first time)
npm run db:migrate      # applies migrations → 10 tables
npm run db:seed         # creates the single user from .env.local
npm run db:seed:profile # loads your positioning, strengths and evidence
npm run db:seed:sources # loads the 66-source catalogue (safe to re-run)

# 5. Run the app
npm run dev             # http://localhost:3000
```

Visit the app → you're redirected to `/login` → sign in → land on **Today**.

Health check: `curl localhost:3000/api/health` → `{ "ok": true }`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the app (Turbopack) |
| `npm run build` / `start` | Production build / serve |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit` |
| `npm run test` / `test:watch` | Vitest |
| `npm run db:up` / `db:down` | Local Postgres (Docker) up / down |
| `npm run db:generate` | Generate a migration from the schema |
| `npm run db:migrate` | Apply migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run db:seed` | Seed the single user |
| `npm run db:seed:profile` | Seed the profile, strengths and evidence |
| `npm run db:seed:sources` | Seed the verified job-source catalogue |

## Project layout

```
src/
  app/            routes + UI (server shells, client islands, route handlers)
  auth.ts         Auth.js v5 (Credentials + Argon2)
  components/     UI + shadcn primitives
  db/             schema (10 tables), client, queries, seed
  lib/            env, logger, password, session, scoring, validation
  pipeline/       the batch pipeline (lands in M1)
```

## Security notes

- The single user's credentials are hashed with **Argon2id**; sessions are signed JWT
  cookies. Auth is enforced server-side in the authenticated layout and every action.
- Secrets live in `.env.local` (git-ignored). Never commit them.
- `POST /api/pipeline/run` is guarded by `PIPELINE_TRIGGER_SECRET`.
- Auto-send defaults **off** and ships **off** (PRD §11).
