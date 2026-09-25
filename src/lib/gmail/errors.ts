/** Typed failures from the mail layer, so callers branch on `kind`, not on a message. */
export type GmailErrorKind =
  /** Missing credentials — a configuration problem, not a transient one. */
  | "config"
  /** The refresh token was revoked or expired; the identity must be reconnected. */
  | "auth"
  /** Gmail rejected the message itself (bad address, over quota, policy). */
  | "rejected"
  /** Network or 5xx. Retrying may work. */
  | "upstream";

export class GmailError extends Error {
  readonly kind: GmailErrorKind;
  readonly status: number | undefined;

  constructor(
    kind: GmailErrorKind,
    message: string,
    options: { cause?: unknown; status?: number } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "GmailError";
    this.kind = kind;
    this.status = options.status;
  }
}

export function isGmailError(error: unknown): error is GmailError {
  return error instanceof GmailError;
}

/** Map a googleapis failure onto the kinds above. */
export function classifyGmailError(error: unknown): GmailError {
  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const message = error instanceof Error ? error.message : String(error);

  // A revoked or expired refresh token surfaces as invalid_grant, not as a 401.
  if (/invalid_grant|invalid_request|unauthorized/i.test(message) || status === 401) {
    return new GmailError("auth", "Gmail authorisation failed — reconnect the sending identity.", {
      cause: error,
      status,
    });
  }
  if (status === 403 || status === 400 || status === 422) {
    return new GmailError("rejected", `Gmail rejected the message: ${message}`, {
      cause: error,
      status,
    });
  }
  return new GmailError("upstream", message, { cause: error, status });
}
