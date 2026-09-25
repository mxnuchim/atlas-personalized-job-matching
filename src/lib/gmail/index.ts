/**
 * The Gmail layer's public surface.
 *
 * HARD RULE, matching `lib/llm`: this directory is the only place that may import
 * `googleapis` / `google-auth-library` or read a Google secret. Enforced by
 * `no-restricted-imports` and by `src/lib/llm/boundary.test.ts`.
 */

export { sendEmail } from "./send";
export { fetchThreadMessages } from "./read";
export type { SendResult } from "./send";

export {
  gmailConfig,
  isGmailConfigured,
  oauthClient,
  oauthClientReady,
  redirectUri,
  GMAIL_SCOPES,
  GMAIL_ENV,
} from "./config";
export type { GmailConfigOk, GmailConfigError } from "./config";

export { GmailError, isGmailError, classifyGmailError } from "./errors";
export type { GmailErrorKind } from "./errors";
