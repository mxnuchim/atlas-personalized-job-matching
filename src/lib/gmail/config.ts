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

/**
 * The env var names this layer owns. Exported so callers can *name* them in a setup
 * message without reaching for the values — which is what keeps the secret boundary
 * meaningful rather than merely stated.
 */
export const GMAIL_ENV = {
  clientId: "GOOGLE_CLIENT_ID",
  clientSecret: "GOOGLE_CLIENT_SECRET",
  refreshToken: "GMAIL_OAUTH_REFRESH_TOKEN",
  sendingAddress: "SENDING_ADDRESS",
} as const;

export type GmailConfigError = { configured: false; missing: string[] };
export type GmailConfigOk = { configured: true; sendingAddress: string };

export function gmailConfig(): GmailConfigOk | GmailConfigError {
  const missing: string[] = [];
  if (!env.GOOGLE_CLIENT_ID) missing.push(GMAIL_ENV.clientId);
  if (!env.GOOGLE_CLIENT_SECRET) missing.push(GMAIL_ENV.clientSecret);
  if (!env.GMAIL_OAUTH_REFRESH_TOKEN) missing.push(GMAIL_ENV.refreshToken);
  if (!env.SENDING_ADDRESS) missing.push(GMAIL_ENV.sendingAddress);

  if (missing.length > 0) return { configured: false, missing };
  return { configured: true, sendingAddress: env.SENDING_ADDRESS! };
}

/**
 * Whether the OAuth *client* credentials exist — enough to start a consent flow, which
 * is a weaker requirement than being able to send.
 */
export function oauthClientReady(): { ready: true } | { ready: false; missing: string[] } {
  const missing: string[] = [];
  if (!env.GOOGLE_CLIENT_ID) missing.push(GMAIL_ENV.clientId);
  if (!env.GOOGLE_CLIENT_SECRET) missing.push(GMAIL_ENV.clientSecret);
  return missing.length > 0 ? { ready: false, missing } : { ready: true };
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
