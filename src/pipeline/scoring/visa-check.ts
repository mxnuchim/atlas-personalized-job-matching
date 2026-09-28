import "@/db/_bootstrap";

import { listMatches } from "@/db/queries/matches";
import { getCurrentProfile, listProfileOwners } from "@/db/queries/profile";
import { generateStructured } from "@/lib/llm";

import { buildJobContext, buildSystemPrompt } from "./prompt";
import { buildAssessmentSchema } from "./schema";

/**
 * Does low reasoning still catch visa / relocation dealbreakers? location_fit is the
 * noisiest dimension at low, and this candidate is relocation-minded — so the thing that
 * actually matters is whether the red-flag survives, not the dimension number.
 *
 * Takes the profile's stored (default-reasoning) matches that raised a visa/relocation
 * flag, re-scores them at low, and reports whether the flag is still raised.
 *
 * Run: `npm run scoring:visa-check [n=8] [emailSubstr]`
 */
const N = Math.max(3, Number(process.argv[2] ?? 8));
const EMAIL = process.argv[3] ?? "manuchim";
const RX = /visa|sponsor|relocat|work permit|work authori|right to work/i;

async function main() {
  const owners = await listProfileOwners();
  const owner = owners.find((o) => o.email.includes(EMAIL)) ?? owners[0];
  const profile = owner && (await getCurrentProfile(owner.userId));
  if (!profile) {
    console.error("No profile.");
    process.exit(1);
  }

  const all = await listMatches(profile.id);
  const flagged = all.filter((m) => m.redFlags.some((f) => RX.test(f)) || RX.test(m.reasoning));
  const sample = flagged.slice(0, N);

  if (sample.length === 0) {
    console.info("No stored matches raised a visa/relocation flag — nothing location-critical to lose.");
    process.exit(0);
  }

  const system = buildSystemPrompt(profile);
  const schema = buildAssessmentSchema(profile.strengths.map((s) => s.key));

  console.info(`${owner.email}: ${sample.length} roles the default scorer flagged visa/relocation.\n`);
  console.info("  loc def→low  visa def→low  role");
  console.info("  ───────────  ────────────  ──────────────────────────────────");

  let kept = 0;
  for (const m of sample) {
    const { data } = await generateStructured({
      schema,
      system,
      prompt: buildJobContext(m.job),
      reasoningEffort: "low",
    });
    const defVisa = m.redFlags.some((f) => RX.test(f)) || RX.test(m.reasoning);
    const lowVisa = data.red_flags.some((f) => RX.test(f)) || RX.test(data.reasoning);
    if (defVisa && lowVisa) kept++;
    console.info(
      `  ${String(m.dimensions.location_fit).padStart(3)}→${String(data.dimensions.location_fit).padEnd(3)}       ` +
        `${defVisa ? "Y" : "n"}→${lowVisa ? "Y" : "n"}          ${m.job.title.slice(0, 40)}`,
    );
  }

  console.info(`\n  visa/relocation flag kept at low: ${kept}/${sample.length}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("visa-check failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
