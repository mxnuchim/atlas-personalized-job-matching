import "server-only";

import { getTrackedThreads, markBounced, markReplied } from "@/db/queries/outreach";
import type { RunError } from "@/db/schema";
import { mapWithConcurrency } from "@/lib/concurrency";
import { fetchThreadMessages, isGmailConfigured, isGmailError } from "@/lib/gmail";
import { log } from "@/lib/logger";
import { classifyThread } from "@/lib/sending/classify";
import { env } from "@/lib/env";

/**
 * Reply and bounce detection (PRD §8 step 7 / §11).
 *
 * Two §11 rules depend on this stage. "Respect replies — stop all further contact once
 * someone replies" is only true if replies are noticed; and bounce monitoring cannot
 * auto-throttle on a number nobody measures.
 *
 * Idempotent: only outreach still in `sent` is polled, and a verdict moves it to a
 * settled state, so a re-run costs one Gmail call per genuinely-open thread.
 */

/** Gmail's per-user quota is generous, but there is no reason to burst against it. */
const CONCURRENCY = 4;
const DEFAULT_LIMIT = 200;

export type ReplySummary = {
  checked: number;
  replied: number;
  bounced: number;
  failed: number;
  errors: RunError[];
  skipped?: string;
};

function empty(): ReplySummary {
  return { checked: 0, replied: 0, bounced: 0, failed: 0, errors: [] };
}

export async function runReplyCheck({
  limit = DEFAULT_LIMIT,
}: { limit?: number } = {}): Promise<ReplySummary> {
  const logger = log("replies");

  if (!isGmailConfigured()) {
    return { ...empty(), skipped: "Gmail not connected — nothing to poll" };
  }
  if (!env.SENDING_ADDRESS) {
    return { ...empty(), skipped: "SENDING_ADDRESS not set" };
  }

  const tracked = await getTrackedThreads(limit);
  if (tracked.length === 0) return empty();

  const summary = empty();
  summary.checked = tracked.length;

  const outcomes = await mapWithConcurrency(tracked, CONCURRENCY, async (row) => {
    try {
      const messages = await fetchThreadMessages(row.gmailThreadId);
      const verdict = classifyThread({
        messages,
        sendingAddress: env.SENDING_ADDRESS!,
        sentAt: row.sentAt,
        sentMessageId: row.gmailMessageId ?? undefined,
      });

      if (verdict.kind === "replied") {
        await markReplied(row.id, verdict.at);
        logger.info({ matchId: row.matchId, from: verdict.from }, "reply detected — chasing stops");
        return { kind: "replied" as const };
      }

      if (verdict.kind === "bounced") {
        await markBounced(row.id, verdict.at, verdict.reason);
        logger.warn({ matchId: row.matchId, reason: verdict.reason }, "bounce detected");
        return { kind: "bounced" as const };
      }

      return { kind: "quiet" as const };
    } catch (error) {
      const message = isGmailError(error) ? `${error.kind}: ${error.message}` : String(error);
      logger.error({ matchId: row.matchId, error: message }, "reply check failed");
      return { kind: "failed" as const, matchId: row.matchId, message };
    }
  });

  for (const outcome of outcomes) {
    if (outcome.kind === "replied") summary.replied += 1;
    else if (outcome.kind === "bounced") summary.bounced += 1;
    else if (outcome.kind === "failed") {
      summary.failed += 1;
      summary.errors.push({
        stage: "replies",
        job_id: outcome.matchId,
        message: outcome.message,
      });
    }
  }

  logger.info(
    { checked: summary.checked, replied: summary.replied, bounced: summary.bounced },
    "reply check complete",
  );
  return summary;
}
