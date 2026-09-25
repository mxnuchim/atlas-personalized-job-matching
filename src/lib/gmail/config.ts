import "server-only";

import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

import { env } from "@/lib/env";

/**
 * Gmail credentials and client construction — the only module that imports googleapis
 * or reads a Google secret, mirroring the boundary `lib/llm` holds for model providers.
 * Enforced by `no-restricted-imports` and by `boundary.test.ts`.
 */

/**
 * `gmail.send` to deliver, `gmail.readonly` for the reply and bounce detection §11
 * requires. Both are requested at once so consent happens a single time — re-prompting
 * later is friction that gets skipped, and unmonitored bounces are a §11 violation.
 */
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export type GmailConfigError = { configured: false; missing: string[] };
export type GmailConfigOk = { configured: true; sendingAddress: string };

export function gmailConfig(): GmailConfigOk | GmailConfigError {
  const missing: string[] = [];
  if (!env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!env.GMAIL_OAUTH_REFRESH_TOKEN) missing.push("GMAIL_OAUTH_REFRESH_TOKEN");
  if (!env.SENDING_ADDRESS) missing.push("SENDING_ADDRESS");

  if (missing.length > 0) return { configured: false, missing };
  return { configured: true, sendingAddress: env.SENDING_ADDRESS! };
}

export function isGmailConfigured(): boolean {
  return gmailConfig().configured;
}

/** The redirect Google sends the consent code back to. */
export function redirectUri(): string {
  return new URL("/api/gmail/callback", env.APP_URL).toString();
}

/**
 * An OAuth2 client. With a refresh token set, google-auth-library mints and refreshes
 * access tokens itself — nothing here caches one, because a stale cached token is a
 * failure mode with no upside for a twice-daily job.
 */
export function oauthClient(options: { withRefreshToken?: boolean } = {}): OAuth2Client {
  const client = new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    redirectUri(),
  );

  if (options.withRefreshToken !== false && env.GMAIL_OAUTH_REFRESH_TOKEN) {
    client.setCredentials({ refresh_token: env.GMAIL_OAUTH_REFRESH_TOKEN });
  }

  return client;
}

export function gmailClient() {
  return google.gmail({ version: "v1", auth: oauthClient() });
}
