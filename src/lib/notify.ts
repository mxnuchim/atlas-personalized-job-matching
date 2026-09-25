import "server-only";

import { env } from "@/lib/env";
import { log } from "@/lib/logger";

/**
 * The run notification (PRD §8 step 7): "Send yourself a short 'N new matches, T strong'
 * message."
 *
 * A webhook rather than email — Atlas no longer touches a mailbox, and every service
 * worth being notified on (Slack, Discord, ntfy, Telegram) accepts an HTTP POST. The
 * body shape differs per service, so it is chosen from the URL: guessing wrong means a
 * silently empty message, which is the same as no notification at all.
 */

const logger = log("notify");

/** Enough time to matter, short enough that a dead webhook cannot stall a run. */
const TIMEOUT_MS = 10_000;

export type RunNotification = {
  newJobs: number;
  scored: number;
  strong: number;
  drafted: number;
  errors: number;
  costUsd: number | null;
  status: "ok" | "partial" | "failed";
  appUrl: string;
};

/**
 * One line, in the product's voice (§10.6): plain, active, no exclamation. The day's
 * headline is how many are worth your attention, so `strong` leads.
 */
export function buildMessage(run: RunNotification): string {
  // `strong` is included so no combination of counts can yield "nothing new"
  // alongside something worth reading.
  if (run.scored === 0 && run.newJobs === 0 && run.drafted === 0 && run.strong === 0) {
    return run.errors > 0
      ? `Atlas run finished with ${run.errors} error${run.errors === 1 ? "" : "s"} and nothing new.`
      : "Atlas ran. Nothing new to review.";
  }

  const parts: string[] = [];
  if (run.strong > 0) {
    parts.push(`${run.strong} strong match${run.strong === 1 ? "" : "es"}`);
  }
  if (run.drafted > 0) {
    parts.push(`${run.drafted} draft${run.drafted === 1 ? "" : "s"} ready`);
  }
  if (parts.length === 0 && run.scored > 0) {
    parts.push(`${run.scored} scored, none strong`);
  }
  if (run.newJobs > 0) parts.push(`${run.newJobs} new posting${run.newJobs === 1 ? "" : "s"}`);

  const tail: string[] = [];
  if (run.errors > 0) tail.push(`${run.errors} error${run.errors === 1 ? "" : "s"}`);
  if (run.costUsd !== null && run.costUsd > 0) tail.push(`$${run.costUsd.toFixed(3)}`);

  return `Atlas: ${parts.join(", ")}${tail.length > 0 ? ` (${tail.join(", ")})` : ""}. ${run.appUrl}/today`;
}

export type WebhookRequest = { body: string; contentType: string };

/**
 * Shape the payload for the service the URL points at. Slack wants `text`, Discord
 * wants `content`, ntfy takes the message as the raw body; anything else gets the most
 * common JSON convention plus the alternates, since a generic endpoint is more likely
 * to ignore an extra key than to invent the one it wants.
 */
export function buildWebhookRequest(url: string, message: string): WebhookRequest {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = "";
  }

  if (host.endsWith("slack.com")) {
    return { body: JSON.stringify({ text: message }), contentType: "application/json" };
  }
  if (host.endsWith("discord.com") || host.endsWith("discordapp.com")) {
    return { body: JSON.stringify({ content: message }), contentType: "application/json" };
  }
  if (host.endsWith("ntfy.sh")) {
    return { body: message, contentType: "text/plain" };
  }
  return {
    body: JSON.stringify({ text: message, content: message, message }),
    contentType: "application/json",
  };
}

/**
 * Post the notification. Never throws: a failed notification must not fail a run that
 * otherwise did its work — the run row is the durable record, this is a convenience.
 */
export async function notifyRun(run: RunNotification): Promise<{ sent: boolean; reason?: string }> {
  const url = env.NOTIFY_WEBHOOK_URL;
  if (!url) return { sent: false, reason: "NOTIFY_WEBHOOK_URL not set" };

  const message = buildMessage(run);
  const { body, contentType } = buildWebhookRequest(url, message);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": contentType },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      const reason = `webhook returned HTTP ${response.status}`;
      logger.warn({ status: response.status }, "notification failed");
      return { sent: false, reason };
    }

    logger.info({ message }, "notification sent");
    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn({ error: reason }, "notification failed");
    return { sent: false, reason };
  }
}
