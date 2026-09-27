import "@/db/_bootstrap";

import { parseLimit } from "./limits";
import { runPipeline } from "./run";

/**
 * The pipeline as a command, for the scheduler to run directly against the database.
 *
 * A run is roughly twelve minutes of LLM calls, which is far beyond any serverless
 * function ceiling — so the schedule cannot work by calling the deployed app over
 * HTTP. GitHub Actions runs this instead, and the web app only ever serves the UI.
 *
 * Exits non-zero only when the run actually failed. A `partial` run recorded
 * per-item errors and still did its work (PRD §12), so turning the job red for that
 * would train you to ignore a red job.
 */
async function main() {
  const scoreLimit = parseLimit(process.env.SCORE_LIMIT);
  const draftLimit = parseLimit(process.env.DRAFT_LIMIT);

  const started = Date.now();
  const { runId, ingest, scoring, drafting, totals, notified } = await runPipeline({
    scoreLimit,
    draftLimit,
  });

  const minutes = ((Date.now() - started) / 60_000).toFixed(1);
  const summary = {
    runId,
    minutes,
    sources: `${ingest.sourcesOk}/${ingest.sourcesTotal}`,
    seen: ingest.seen,
    newJobs: ingest.inserted,
    closed: ingest.closed,
    scored: scoring.scored,
    drafted: drafting.drafted,
    costUsd: totals.costUsd,
    errors: totals.errors.length,
    status: totals.status,
    emailed: notified,
  };

  console.log(JSON.stringify(summary, null, 2));

  // Written to the Actions summary page so the schedule is observable without
  // opening the app.
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    const coverage =
      ingest.sourcesOk < ingest.sourcesTotal
        ? `| **sources** | ⚠️ ${ingest.sourcesOk}/${ingest.sourcesTotal} answered |\n`
        : `| sources | ${ingest.sourcesOk}/${ingest.sourcesTotal} |\n`;

    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Pipeline run\n\n| stage | result |\n|---|---|\n` +
        coverage +
        `| ingest | ${ingest.seen} seen, ${ingest.inserted} new, ${ingest.closed} closed |\n` +
        `| scoring | ${scoring.scored} scored, ${scoring.failed} failed |\n` +
        `| drafting | ${drafting.drafted} drafted |\n` +
        `| cost | $${totals.costUsd?.toFixed(4) ?? "unknown"} |\n` +
        `| email | ${notified ? "sent" : "not sent"} |\n` +
        `| status | ${totals.status} |\n\n` +
        `Took ${minutes} minutes.\n`,
    );
  }

  if (totals.status === "failed") {
    console.error("Pipeline run finished with status: failed");
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error("Pipeline run threw:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
