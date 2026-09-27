"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { canTransition, getOutreach, setOutreachStatus } from "@/db/queries/outreach";
import { log } from "@/lib/logger";
import { requireSession } from "@/lib/session";

/**
 * Pipeline mutations (PRD §6: mutations are Server Actions). Session-checked
 * server-side — a control the UI chose not to render is not authorisation.
 *
 * The legality of a move lives in `canTransition`, not here, so the rule is tested on
 * its own and the UI and the server cannot disagree about it.
 */

const logger = log("pipeline");

const STATUSES = [
  "drafted",
  "sent",
  "bounced",
  "replied",
  "interview",
  "offer",
  "rejected",
  "closed",
] as const;

const schema = z.object({
  outreachId: z.uuid(),
  status: z.enum(STATUSES),
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function setOutreachStatusAction(input: unknown): Promise<ActionResult> {
  await requireSession();

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That is not a valid stage." };

  const existing = await getOutreach(parsed.data.outreachId);
  if (!existing) return { ok: false, error: "That role is no longer in the pipeline." };

  if (!canTransition(existing.status, parsed.data.status)) {
    return {
      ok: false,
      error: `A ${existing.status} role cannot move to ${parsed.data.status}.`,
    };
  }

  const row = await setOutreachStatus(parsed.data.outreachId, parsed.data.status);
  if (!row) return { ok: false, error: "Could not save that. Try again." };

  logger.info(
    { outreachId: row.id, from: existing.status, to: row.status },
    "outreach stage changed",
  );
  revalidatePath("/pipeline");
  revalidatePath("/today");
  return { ok: true };
}
