import "server-only";

import { renderDailyEmail, type DailyEmailInput } from "@/lib/email";
import { env } from "@/lib/env";
import { log } from "@/lib/logger";

/**
 * Delivery for the daily email (PRD §8 step 7). The template lives in `lib/email`;
 * this module only sends it, so the key never leaves here and the layout can be
 * tested without a network.
 *
 * Email rather than a webhook: the point is one message each morning saying whether
 * opening Atlas is worth it. A push is read and dismissed; an email sits in the inbox
 * beside the rest of the job search, which is where this belongs.
 */

const logger = log("notify");

/** Enough time to matter, short enough that a dead provider cannot stall a run. */
const TIMEOUT_MS = 10_000;

export type RunNotification = DailyEmailInput;

/**
 * Never throws: a failed notification must not fail a run that otherwise did its work
 * — the `runs` row is the durable record, this is a convenience.
 */
export async function notifyRun(run: RunNotification): Promise<{ sent: boolean; reason?: string }> {
  if (!env.RESEND_API_KEY) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!env.NOTIFY_EMAIL_TO) return { sent: false, reason: "NOTIFY_EMAIL_TO not set" };

  const { subject, html, text } = renderDailyEmail(run);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: env.NOTIFY_EMAIL_FROM,
        to: [env.NOTIFY_EMAIL_TO],
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // Resend explains refusals in the body — an unverified sender is the common one,
      // and a bare "HTTP 403" would send you looking in the wrong place.
      const detail = await response.text().catch(() => "");
      const reason = `Resend returned HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`;
      logger.warn({ status: response.status, detail: detail.slice(0, 200) }, "email failed");
      return { sent: false, reason };
    }

    logger.info({ to: env.NOTIFY_EMAIL_TO, queued: run.queued }, "daily email sent");
    return { sent: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.warn({ error: reason }, "email failed");
    return { sent: false, reason };
  }
}
