/**
 * RFC 2822 message construction. Pure and separately testable, because a malformed
 * header is the kind of bug you discover in someone else's inbox.
 *
 * Deliberately minimal: plain text only, no HTML alternative. Cold outreach that
 * arrives as a plain-text message from a person reads as one, and an HTML multipart
 * body is one more thing spam filters weigh.
 */

export type OutgoingMessage = {
  from: string;
  fromName?: string | null;
  to: string;
  subject: string;
  body: string;
  replyTo?: string | null;
};

/**
 * Headers must not contain CR or LF: an injected newline lets anything in the subject
 * or a name forge additional headers (a Bcc, a different Reply-To). The values here
 * come from a model and from user input, so neither is trusted.
 */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * RFC 2047 encoded-word for any header carrying non-ASCII. Without it a name or
 * subject with an accent or an em dash arrives as mojibake.
 */
export function encodeHeaderValue(value: string): string {
  const clean = sanitizeHeaderValue(value);
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function addressHeader(address: string, name?: string | null): string {
  const clean = sanitizeHeaderValue(address);
  if (!name) return clean;
  // Quote the display name so a comma in it cannot read as a second recipient.
  return `"${encodeHeaderValue(name).replace(/"/g, "")}" <${clean}>`;
}

export function buildMimeMessage(message: OutgoingMessage): string {
  const headers = [
    `From: ${addressHeader(message.from, message.fromName)}`,
    `To: ${sanitizeHeaderValue(message.to)}`,
    message.replyTo ? `Reply-To: ${sanitizeHeaderValue(message.replyTo)}` : null,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ].filter((h): h is string => h !== null);

  // The body is base64 so a long line or a non-ASCII character cannot break transport.
  const body = Buffer.from(message.body, "utf8").toString("base64");
  return `${headers.join("\r\n")}\r\n\r\n${chunk(body, 76)}`;
}

/** Gmail's API takes the whole message base64url-encoded, unpadded. */
export function encodeForGmail(mime: string): string {
  return Buffer.from(mime, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function chunk(value: string, size: number): string {
  const lines: string[] = [];
  for (let i = 0; i < value.length; i += size) lines.push(value.slice(i, i + size));
  return lines.join("\r\n");
}
