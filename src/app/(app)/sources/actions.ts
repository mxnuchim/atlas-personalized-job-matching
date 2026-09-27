"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  createSource,
  deleteSource,
  getSource,
  getSourceImpact,
  setSourceEnabledBy,
} from "@/db/queries/sources";
import { log } from "@/lib/logger";
import { requireSession } from "@/lib/session";
import { aggregatorConfigSchema } from "@/pipeline/sources/aggregators";
import { ashbyConfigSchema } from "@/pipeline/sources/ashby";
import { greenhouseConfigSchema } from "@/pipeline/sources/greenhouse";
import { leverConfigSchema } from "@/pipeline/sources/lever";

/**
 * Source management (PRD §6: mutations are Server Actions). Every one checks the
 * session server-side — hiding a control is not authorisation.
 *
 * Config is validated with the fetchers' own schemas rather than a second copy, so a
 * board saved here is one the fetcher can actually read. A wrong shape caught at save
 * time is a form error; caught at run time it is a silent source failure twice a day.
 */

const logger = log("sources");

const boardConfig = z.object({
  board: z.string().trim().min(1, "A board token is required."),
  company: z.string().trim().min(1, "A display name is required."),
});

const sourceInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("greenhouse"), config: boardConfig }),
  z.object({ kind: z.literal("lever"), config: boardConfig }),
  z.object({ kind: z.literal("ashby"), config: boardConfig }),
  z.object({
    kind: z.literal("api"),
    config: z.object({
      adapter: z.enum(["remotive", "arbeitnow", "himalayas", "jobicy"]),
      limit: z.coerce.number().int().min(1).max(500).default(200),
    }),
  }),
]);

/** The fetcher's own schema gets the final say on the config shape. */
const FETCHER_SCHEMA = {
  greenhouse: greenhouseConfigSchema,
  lever: leverConfigSchema,
  ashby: ashbyConfigSchema,
  api: aggregatorConfigSchema,
} as const;

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function createSourceAction(input: unknown): Promise<ActionResult> {
  await requireSession();

  const parsed = sourceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "That source is not valid." };
  }

  const { kind, config } = parsed.data;
  const checked = FETCHER_SCHEMA[kind].safeParse(config);
  if (!checked.success) {
    return {
      ok: false,
      error: `The fetcher rejected this config: ${checked.error.issues[0]?.message}`,
    };
  }

  // The display name is the company for a board, the adapter for an aggregator.
  const name =
    kind === "api"
      ? (config as { adapter: string }).adapter
      : (config as { company: string }).company;

  await createSource({ name, kind, config: checked.data, enabled: true });
  logger.info({ name, kind }, "source created");
  revalidatePath("/sources");
  return { ok: true };
}

export async function toggleSourceAction(input: unknown): Promise<ActionResult> {
  const session = await requireSession();

  const parsed = z.object({ id: z.uuid(), enabled: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That source reference is not valid." };

  // Sources are shared: disabling one changes what every user sees, silently and with
  // no way for them to tell why their matches thinned out. Until subscriptions are
  // per-user, that decision belongs to whoever owns the install.
  if (!parsed.data.enabled && session.user.role !== "owner") {
    return {
      ok: false,
      error: "Only the owner of this Atlas can turn a source off — it changes everyone's corpus.",
    };
  }

  const row = await setSourceEnabledBy(parsed.data.id, parsed.data.enabled, session.user.id);
  if (!row) return { ok: false, error: "That source no longer exists." };

  logger.info({ source: row.name, enabled: row.enabled, by: session.user.id }, "source toggled");
  revalidatePath("/sources");
  return { ok: true };
}

/**
 * Deleting cascades into jobs, and from there into matches and drafts. The caller has
 * to name how many rows it expects to destroy, and the server re-counts and refuses
 * on a mismatch — so a stale page cannot silently delete more than the user was shown.
 */
export async function deleteSourceAction(input: unknown): Promise<ActionResult> {
  await requireSession();

  const parsed = z.object({ id: z.uuid(), expectedJobs: z.number().int().min(0) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "That source reference is not valid." };

  const source = await getSource(parsed.data.id);
  if (!source) return { ok: false, error: "That source no longer exists." };

  const impact = await getSourceImpact(parsed.data.id);
  if (impact.jobs !== parsed.data.expectedJobs) {
    return {
      ok: false,
      error: `This source now holds ${impact.jobs} postings, not ${parsed.data.expectedJobs}. Reload and try again.`,
    };
  }

  await deleteSource(parsed.data.id);
  logger.warn({ name: source.name, ...impact }, "source deleted with its postings");
  revalidatePath("/sources");
  revalidatePath("/jobs");
  return { ok: true };
}
