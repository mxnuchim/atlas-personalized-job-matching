import "@/db/_bootstrap";

import fs from "node:fs";

import { runScore } from "@/pipeline/scoring/score";

const LOG = "backfill-progress.txt";

function note(line: string) {
  fs.appendFileSync(LOG, line + "\n");
}

async function main() {
  const started = Date.now();
  let batch = 0;
  let scored = 0;
  let failed = 0;
  let cost = 0;

  // Batched so a crash loses one batch, not the run. Loops until the queue is empty.
  for (;;) {
    batch += 1;
    const summary = await runScore({ limit: 200 });
    scored += summary.scored;
    failed += summary.failed;
    cost += summary.costUsd ?? 0;

    note(
      `batch ${batch}: scored=${summary.scored} failed=${summary.failed} ` +
        `cost=$${(summary.costUsd ?? 0).toFixed(4)} total=${scored} elapsed=${((Date.now() - started) / 60000).toFixed(1)}m`,
    );

    if (summary.scored === 0 && summary.failed === 0) break;
    if (batch > 20) { note("stopped: batch cap"); break; }
  }

  note(
    `BACKFILL_DONE scored=${scored} failed=${failed} cost=$${cost.toFixed(2)} ` +
      `in ${((Date.now() - started) / 60000).toFixed(1)}m`,
  );
  process.exit(0);
}

main().catch((e) => {
  note(`BACKFILL_DONE error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
