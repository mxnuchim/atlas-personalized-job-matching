import "@/db/_bootstrap";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getJob } from "@/db/queries/jobs";
import { htmlToText } from "@/lib/html";
import { MODELS, PROVIDER, type TokenUsage } from "@/lib/llm";
import { coveragePercent } from "@/lib/resume/report";

import { extractRequirements, parseResume, tailor, writeCoverLetter } from "./steps";

/**
 * End-to-end check of the resume pipeline against a fixture resume — real model calls,
 * no database writes. Prints every step's output and what it actually cost.
 *
 *   npm run resume:smoke                    # fixture resume vs fixture JD
 *   npm run resume:smoke -- --job <jobId>   # fixture resume vs a real posting (read-only)
 *
 * The fixture is a fictional person, so this never sends anyone's real resume anywhere.
 */

const FIXTURES = join(process.cwd(), "src/pipeline/resume/fixtures");

function money(usage: TokenUsage): string {
  const cost = usage.costUsd === null ? "unpriced" : `$${usage.costUsd.toFixed(5)}`;
  return `${cost}  (in ${usage.inputTokens}, cached ${usage.cachedInputTokens}, out ${usage.outputTokens})`;
}

async function main() {
  const jobFlag = process.argv.indexOf("--job");
  const jobId = jobFlag > -1 ? process.argv[jobFlag + 1] : undefined;

  const resumeText = readFileSync(join(FIXTURES, "sample-resume.txt"), "utf8");
  let jdText = readFileSync(join(FIXTURES, "sample-jd.txt"), "utf8");
  if (jobId) {
    const job = await getJob(jobId);
    if (!job) throw new Error(`No job ${jobId}`);
    jdText = htmlToText(job.description ?? "");
    console.log(`JD: ${job.title} @ ${job.company} (${jdText.length} chars)`);
  }

  console.log(`provider=${PROVIDER} model=${MODELS.resume}\n`);
  let total = 0;
  const add = (u: TokenUsage) => (total += u.costUsd ?? 0);

  console.log("── 1. parse ──");
  const parsed = await parseResume(resumeText);
  add(parsed.usage);
  console.log(money(parsed.usage));
  for (const r of parsed.master.roles) {
    console.log(`  ${r.id} ${r.title} @ ${r.company} [${r.start} – ${r.current ? "Present" : r.end}] · ${r.bullets.length} bullets`);
  }
  console.log(`  skills: ${parsed.master.skills.join(", ")}`);
  console.log(`  warnings: ${parsed.warnings.length ? parsed.warnings.join(" | ") : "none"}\n`);

  console.log("── 2. requirements ──");
  const req = await extractRequirements(jdText);
  add(req.usage);
  console.log(money(req.usage));
  console.log(`  ${req.requirements.title} @ ${req.requirements.company} (${req.requirements.seniority})`);
  console.log(`  must: ${req.requirements.mustHave.map((k) => k.term).join(", ")}`);
  console.log(`  nice: ${req.requirements.niceToHave.map((k) => k.term).join(", ")}\n`);

  console.log("── 3. tailor ──");
  const tailored = await tailor(parsed.master, req.requirements);
  add(tailored.usage);
  console.log(money(tailored.usage));
  const r = tailored.resume;
  console.log(`  headline: ${r.headline}`);
  console.log(`  summary:  ${r.summary}`);
  for (const role of r.roles) {
    console.log(`  ${role.title} @ ${role.company}`);
    for (const b of role.bullets) console.log(`    • [${b.sourceId}] ${b.text}`);
  }
  console.log(`  skills: ${r.skills.join(", ")}`);
  const rep = tailored.report;
  console.log(
    `  must-have ${rep.coverage.mustHave.matched}/${rep.coverage.mustHave.total} (${coveragePercent(rep)}%) · nice ${rep.coverage.niceToHave.matched}/${rep.coverage.niceToHave.total} · guard reverts: ${rep.reverted}`,
  );
  for (const k of [...rep.mustHave, ...rep.niceToHave].filter((k) => k.status !== "covered")) {
    console.log(`    ${k.status.padEnd(7)} ${k.term}`);
  }
  console.log();

  console.log("── 4. cover letter ──");
  const letter = await writeCoverLetter({ master: parsed.master, requirements: req.requirements, jdText });
  add(letter.usage);
  console.log(money(letter.usage));
  console.log(letter.letter.split("\n").map((l) => `  ${l}`).join("\n"));
  console.log(`  warnings: ${letter.warnings.length ? letter.warnings.join(" | ") : "none"}\n`);

  console.log(`TOTAL: $${total.toFixed(5)} — parse is once per upload; requirements once per JD (cached).`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
