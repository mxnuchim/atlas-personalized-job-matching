# Deploying Atlas

Atlas runs as two halves that share one database. Understanding the split is most of
the deployment.

```
Vercel                          GitHub Actions              Neon
┌────────────────────┐          ┌──────────────────┐        ┌──────────┐
│ the UI             │          │ the pipeline     │        │ Postgres │
│ Today, Matches,    │──reads──▶│ ingest → score → │──────▶ │          │
│ Review, Sources    │          │ draft → email    │        │          │
│ Server Actions     │──writes─▶│ once daily 06:00 │        │          │
└────────────────────┘          └──────────────────┘        └──────────┘
```

**Why the pipeline is not on Vercel.** A run is roughly twelve minutes of LLM calls.
Every serverless function ceiling is far below that, on any plan. GitHub Actions allows
six hours, costs nothing at this volume, and keeps the schedule outside the app — which
is what `src/lib/schedule.ts` and its drift test already assumed.

---

## 1. Database

Create a project at [neon.tech](https://neon.tech). The free tier is 0.5 GB; a corpus
of ~2,000 jobs with descriptions is around 55 MB, so there is plenty of room.

Take the **pooled** connection string — the one whose host contains `-pooler`. Atlas
opens one connection per instance in production (`src/db/index.ts`), which is correct
for a pooled endpoint and wrong for a direct one.

## 2. Migrate and seed, once

From your machine, pointed at Neon:

```bash
export DATABASE_URL="postgres://…-pooler.…neon.tech/…?sslmode=require"
npm run db:migrate
npm run db:seed          # the single user, from AUTH_USER_EMAIL / AUTH_USER_PASSWORD
npm run db:seed:profile  # positioning, strengths, evidence
npm run db:seed:sources  # the 66-source catalogue
```

Nothing runs migrations automatically. That is deliberate — a migration that runs on
every deploy is a migration that runs during a rollback.

## 3. Vercel

Import the repository. Framework detection handles the build; no overrides needed.

Set these in **Settings → Environment Variables**:

| Variable | Value | Notes |
|---|---|---|
| `DATABASE_URL` | Neon pooled URL | |
| `AUTH_SECRET` | `openssl rand -base64 32` | |
| `APP_URL` | `https://your-app.vercel.app` | **Must be set.** Defaults to localhost, and the email's links use it |
| `LLM_PROVIDER` | `openai` | |
| `MODEL_SCORING` | `gpt-5-mini` | |
| `MODEL_DRAFTING` | `gpt-5-mini` | |
| `OPENAI_API_KEY` | your key | |
| `RESEND_API_KEY` | your key | |
| `NOTIFY_EMAIL_TO` | your address | |
| `NOTIFY_EMAIL_FROM` | `Atlas <updates@yourdomain>` | domain must be verified in Resend |
| `TZ` | `UTC` | must match what the cron was generated for |
| `DAILY_QUEUE_SIZE` | `20` | 5–30 |
| `MAX_PER_COMPANY` | `4` | |
| `MAX_POSTING_AGE_DAYS` | `30` | |

**Do not set `SKIP_ENV_VALIDATION`.** It substitutes a placeholder database URL so CI
can build without secrets; in production it would let the app boot pointed at nothing.

## 4. The scheduled pipeline

In the repository, under **Settings → Secrets and variables → Actions**:

**Secrets** — `DATABASE_URL`, `AUTH_SECRET`, `OPENAI_API_KEY`, `RESEND_API_KEY`,
`NOTIFY_EMAIL_TO`.

**Variables** — `APP_URL`, `NOTIFY_EMAIL_FROM`, and optionally `LLM_PROVIDER`,
`MODEL_SCORING`, `MODEL_DRAFTING`, `DAILY_QUEUE_SIZE`, `MAX_PER_COMPANY`,
`MAX_POSTING_AGE_DAYS`, `TZ`. The workflow has sane defaults for every variable, so
only the first two are required.

Variables rather than secrets for the non-sensitive ones on purpose: a secret is masked
in the logs, and a masked model name is unreadable exactly when you are trying to work
out why a run behaved oddly.

`AUTH_SECRET` is needed even though the pipeline never authenticates — `src/lib/env.ts`
validates the whole schema on import, and failing fast on a half-configured environment
is worth one extra secret.

Then run it once by hand: **Actions → Pipeline → Run workflow**. It writes a summary
table to the run page and emails you when it finishes.

## 5. Fetch now in production (optional)

The button runs the pipeline inline in local development. In production that would
exceed the function ceiling, so it dispatches the workflow instead — if you configure
it to:

| Variable | Value |
|---|---|
| `GITHUB_DISPATCH_TOKEN` | fine-grained PAT, **Actions: read and write**, this repo only |
| `GITHUB_REPO` | `owner/repo` |
| `GITHUB_REF` | `main` (default) |

Leave them unset and the button still works locally, and in production returns whatever
error the function ceiling produces. The mode is chosen by what is configured rather
than by a flag, so it cannot be pointed at the option the environment cannot support.

## 5b. The HTTP trigger is now optional

`POST /api/pipeline/run` predates the Actions runner and nothing calls it any more.
It still works — bearer token, constant-time compare, fails closed when
`PIPELINE_TRIGGER_SECRET` is unset — and is useful if you ever want to trigger from
somewhere that is not GitHub.

On Vercel it will exceed the function ceiling on anything but a small `scoreLimit`,
so treat it as a way to run a *bounded* slice, not a full run. If you have no use for
it, leave `PIPELINE_TRIGGER_SECRET` unset and it refuses every request.

## 6. Verify

1. Open the deployment and sign in.
2. `/sources` should show 66 enabled.
3. `/today` should show the queue, or an empty state if nothing is scored yet.
4. Trigger the workflow by hand and wait for the email.
5. Check the run summary on the Actions page — particularly the **sources** row. Fewer
   than 66 means the run saw an incomplete picture, and every count below it is
   proportionally understated.

## What it costs

Measured, not estimated — from real runs in the `runs` table.

| | per unit | per day | per month |
|---|---|---|---|
| Ingest | free | — | $0 |
| Scoring, 50/day | $0.0047 | $0.235 | ~$7.05 |
| Drafting, ~10 new strong/day | $0.0055 | $0.055 | ~$1.65 |
| **LLM total** | | **~$0.29** | **~$9** |

Infrastructure is free at this scale: Neon free (0.5 GB against ~55 MB), Vercel Hobby,
Resend free (3,000/month against ~30), GitHub Actions free (2,000 min/month against
~360).

**The one thing that is not covered:** the cron scores 50 a day, while 70–181 new
postings clear the relevance gate daily. The unscored backlog therefore grows. That is
deliberate — scoring is newest-first and the queue only needs 20 — but "everything
scored" is not the steady state. Raising `SCORE_LIMIT` to match full inflow costs about
$26/month.

## Troubleshooting

**The email never arrives.** The run row records why: `notifyRun` returns a reason and
the pipeline logs it. The usual cause is an unverified sending domain, which Resend
explains in its response body rather than as a bare 403.

**Every source failed.** Almost always transient network trouble on the runner. Closure
detection is unaffected by design — a failed fetch returns before anything can be marked
closed — so a bad run costs coverage for a day and nothing more.

**The cron does not fire.** GitHub disables scheduled workflows on repositories with no
activity for 60 days, and schedules on a fork never run. The drift test
(`src/lib/schedule.test.ts`) only proves the cron line matches `RUN_HOURS`; it cannot
prove GitHub is honouring it.
