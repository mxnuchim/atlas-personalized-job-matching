import { NextResponse } from "next/server";

import { classifyGmailError, GMAIL_ENV, oauthClient } from "@/lib/gmail";
import { log } from "@/lib/logger";
import { requireSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const logger = log("gmail");

/**
 * Google's consent callback. Exchanges the code for a refresh token and shows it once,
 * for you to paste into `.env.local`.
 *
 * Deliberately not persisted: §12 keeps secrets in env, not in the database, and a
 * long-lived Google refresh token sitting in a table is a materially worse place for
 * it than a gitignored env file. This happens once per identity.
 */
export async function GET(request: Request) {
  await requireSession();

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    // e.g. the consent screen was dismissed.
    return html(
      `<h1>Gmail not connected</h1><p>Google returned: <code>${escapeHtml(error)}</code></p>`,
      400,
    );
  }

  const code = url.searchParams.get("code");
  if (!code) {
    return html("<h1>Gmail not connected</h1><p>No authorisation code was returned.</p>", 400);
  }

  try {
    const { tokens } = await oauthClient({ withRefreshToken: false }).getToken(code);

    if (!tokens.refresh_token) {
      // Google only issues one on first consent; `prompt=consent` should have forced it.
      return html(
        "<h1>No refresh token</h1><p>Google did not return a refresh token. Remove Atlas from " +
          '<a href="https://myaccount.google.com/permissions">your account permissions</a> and try again.</p>',
        400,
      );
    }

    logger.info("gmail refresh token issued");

    // Shown, never logged: the log line above deliberately carries no token.
    return html(
      `<h1>Gmail connected</h1>
       <p>Add these to <code>.env.local</code>, then restart the dev server:</p>
       <pre>${GMAIL_ENV.refreshToken}="${escapeHtml(tokens.refresh_token)}"
${GMAIL_ENV.sendingAddress}="the alias you just authorised"</pre>
       <p><strong>Use a separate address from your primary one.</strong> Cold outreach
       from the inbox you actually job hunt with puts that inbox's reputation behind
       every send.</p>
       <p>This token is shown once and is not stored anywhere by Atlas.</p>`,
    );
  } catch (err) {
    const gmailError = classifyGmailError(err);
    logger.error(
      { kind: gmailError.kind, error: gmailError.message },
      "gmail token exchange failed",
    );
    return html(`<h1>Gmail not connected</h1><p>${escapeHtml(gmailError.message)}</p>`, 400);
  }
}

function html(body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex">
     <title>Gmail · Atlas</title>
     <style>
       body{font:15px/1.6 ui-sans-serif,system-ui,sans-serif;max-width:46rem;margin:4rem auto;padding:0 1.5rem;color:#16181d}
       pre{background:#f5f6f8;padding:1rem;border-radius:.5rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
       code{background:#f5f6f8;padding:.1rem .3rem;border-radius:.25rem}
       @media(prefers-color-scheme:dark){body{background:#12141a;color:#e7e9ee}pre,code{background:#1a1d26}}
     </style>${body}`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
