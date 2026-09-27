import "server-only";

import { env } from "@/lib/env";
import { log } from "@/lib/logger";

/**
 * The daily email (PRD §8 step 7).
 *
 * Email rather than a webhook: the point is a single message each morning that tells
 * you whether opening Atlas is worth it, and how many roles are waiting. A push
 * notification is read and dismissed; an email sits in the inbox next to the rest of
 * the job search, which is where this belongs.
 *
 * Sent through Resend — one HTTP call, no SDK, and the key never leaves this module.
 */

const logger = log("notify");

/** Enough time to matter, short enough that a dead provider cannot stall a run. */
const TIMEOUT_MS = 10_000;

export type QueuePreview = {
  title: string;
  company: string;
  overall: number;
};

export type RunNotification = {
  newJobs: number;
  scored: number;
  strong: number;
  drafted: number;
  errors: number;
  /** Source coverage; a shortfall changes what every other count means. */
  sourcesOk: number;
  sourcesTotal: number;
  /**
   * How many roles today's queue holds, and the best few to preview. `queued` is the
   * capped queue length, not the raw backlog — an email saying "276 roles ready" is
   * the firehose this design exists to avoid.
   */
  queued: number;
  top: QueuePreview[];
  costUsd: number | null;
  status: "ok" | "partial" | "failed";
  appUrl: string;
};

/** Coverage qualifies every count, so it is stated wherever counts are. */
function shortfall(run: RunNotification): string {
  return run.sourcesTotal > 0 && run.sourcesOk < run.sourcesTotal
    ? `Only ${run.sourcesOk} of ${run.sourcesTotal} sources answered, so today's list is drawn from an incomplete picture.`
    : "";
}

/**
 * The subject line carries the decision: is there anything worth opening the app for?
 * Everything else is detail, and a subject that says "Atlas run complete" wastes the
 * one line that is always read.
 */
export function buildSubject(run: RunNotification): string {
  if (run.queued === 0) return "Atlas: nothing new today";

  const strong = run.strong > 0 ? `, ${run.strong} strong` : "";
  return `Atlas: ${run.queued} role${run.queued === 1 ? "" : "s"} ready${strong}`;
}

/** Plain text, for clients that prefer it and as the accessible fallback. */
export function buildText(run: RunNotification): string {
  const lines: string[] = [];

  lines.push(
    run.queued === 0
      ? "Nothing new to review today."
      : `${run.queued} role${run.queued === 1 ? "" : "s"} waiting in today's queue.`,
  );

  if (run.top.length > 0) {
    lines.push("");
    for (const role of run.top) {
      lines.push(`  ${role.overall}  ${role.title} — ${role.company}`);
    }
    if (run.queued > run.top.length) {
      lines.push(`  …and ${run.queued - run.top.length} more.`);
    }
  }

  const caveat = shortfall(run);
  if (caveat) lines.push("", caveat);

  lines.push("", `Open the queue: ${run.appUrl}/today`);

  const tail: string[] = [`${run.newJobs} new postings`, `${run.scored} scored`];
  if (run.errors > 0) tail.push(`${run.errors} error${run.errors === 1 ? "" : "s"}`);
  if (run.costUsd !== null && run.costUsd > 0) tail.push(`$${run.costUsd.toFixed(3)}`);
  lines.push("", tail.join(" · "));

  return lines.join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Table layout and inline styles throughout: email clients are not browsers, and
 * anything relying on flexbox or a stylesheet renders as an unstyled pile in Outlook.
 */
export function buildHtml(run: RunNotification): string {
  const caveat = shortfall(run);

  const rows = run.top
    .map(
      (role) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e6e8ee;vertical-align:top;width:44px">
            <div style="font:600 15px/1 -apple-system,Segoe UI,sans-serif;color:#4c5bd4">${role.overall}</div>
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #e6e8ee">
            <div style="font:600 14px/1.4 -apple-system,Segoe UI,sans-serif;color:#15171c">${escapeHtml(role.title)}</div>
            <div style="font:400 13px/1.4 -apple-system,Segoe UI,sans-serif;color:#6b7280">${escapeHtml(role.company)}</div>
          </td>
        </tr>`,
    )
    .join("");

  const more =
    run.queued > run.top.length
      ? `<p style="font:400 13px/1.5 -apple-system,Segoe UI,sans-serif;color:#6b7280;margin:12px 0 0">…and ${run.queued - run.top.length} more in the queue.</p>`
      : "";

  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px">
    <tr><td>
      <h1 style="font:600 18px/1.3 -apple-system,Segoe UI,sans-serif;color:#15171c;margin:0 0 4px">
        ${run.queued === 0 ? "Nothing new today" : `${run.queued} role${run.queued === 1 ? "" : "s"} ready`}
      </h1>
      <p style="font:400 14px/1.5 -apple-system,Segoe UI,sans-serif;color:#6b7280;margin:0 0 20px">
        ${run.newJobs} new postings · ${run.scored} scored${run.strong > 0 ? ` · ${run.strong} strong` : ""}
      </p>

      ${rows ? `<table role="presentation" cellpadding="0" cellspacing="0" width="100%">${rows}</table>` : ""}
      ${more}

      ${
        caveat
          ? `<p style="font:400 13px/1.5 -apple-system,Segoe UI,sans-serif;color:#8a5e1d;background:#fdf6e9;border-radius:8px;padding:10px 12px;margin:20px 0 0">${escapeHtml(caveat)}</p>`
          : ""
      }

      <p style="margin:24px 0 0">
        <a href="${run.appUrl}/today" style="display:inline-block;background:#4c5bd4;color:#fff;text-decoration:none;font:600 14px/1 -apple-system,Segoe UI,sans-serif;padding:12px 18px;border-radius:8px">Open today&rsquo;s queue</a>
      </p>
    </td></tr>
  </table>
</body></html>`;
}

/**
 * Send the email. Never throws: a failed notification must not fail a run that
 * otherwise did its work — the `runs` row is the durable record, this is a convenience.
 */
export async function notifyRun(run: RunNotification): Promise<{ sent: boolean; reason?: string }> {
  if (!env.RESEND_API_KEY) return { sent: false, reason: "RESEND_API_KEY not set" };
  if (!env.NOTIFY_EMAIL_TO) return { sent: false, reason: "NOTIFY_EMAIL_TO not set" };

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
        subject: buildSubject(run),
        html: buildHtml(run),
        text: buildText(run),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      // Resend explains refusals in the body — an unverified sender is the common one,
      // and "HTTP 403" alone would send you looking in the wrong place.
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
