import { describe, expect, it } from "vitest";

import {
  buildMimeMessage,
  encodeForGmail,
  encodeHeaderValue,
  sanitizeHeaderValue,
} from "./message";

const base = {
  from: "outreach@atlas.test",
  fromName: "Manuchimso Oliver",
  to: "hiring@example.com",
  subject: "ai sdk: node/ts orchestration",
  body: "Hello.\nSecond line.",
};

function headersOf(mime: string): string {
  return mime.split("\r\n\r\n")[0]!;
}

describe("sanitizeHeaderValue", () => {
  it("strips CR and LF so a value cannot forge extra headers", () => {
    // Header injection: without this, a subject can add its own Bcc.
    const injected = "subject\r\nBcc: attacker@evil.test";
    expect(sanitizeHeaderValue(injected)).toBe("subject Bcc: attacker@evil.test");
    expect(sanitizeHeaderValue(injected)).not.toContain("\r");
    expect(sanitizeHeaderValue(injected)).not.toContain("\n");
  });
});

describe("encodeHeaderValue", () => {
  it("leaves plain ASCII alone", () => {
    expect(encodeHeaderValue("ai sdk: orchestration")).toBe("ai sdk: orchestration");
  });

  it("encodes non-ASCII as an RFC 2047 encoded-word", () => {
    // An em dash is extremely likely in generated copy; unencoded it arrives as mojibake.
    const encoded = encodeHeaderValue("orchestration — 250K/day");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?.+\?=$/);
    const payload = encoded.slice("=?UTF-8?B?".length, -2);
    expect(Buffer.from(payload, "base64").toString("utf8")).toBe("orchestration — 250K/day");
  });
});

describe("buildMimeMessage", () => {
  it("writes the headers a plain-text message needs", () => {
    const headers = headersOf(buildMimeMessage(base));
    expect(headers).toContain('From: "Manuchimso Oliver" <outreach@atlas.test>');
    expect(headers).toContain("To: hiring@example.com");
    expect(headers).toContain("MIME-Version: 1.0");
    expect(headers).toContain('Content-Type: text/plain; charset="UTF-8"');
  });

  it("omits Reply-To entirely when there is none", () => {
    expect(headersOf(buildMimeMessage(base))).not.toContain("Reply-To:");
    expect(headersOf(buildMimeMessage({ ...base, replyTo: "me@personal.test" }))).toContain(
      "Reply-To: me@personal.test",
    );
  });

  it("round-trips the body, newlines intact", () => {
    const mime = buildMimeMessage({ ...base, body: "Line one.\n\nLine two — with an em dash." });
    const encoded = mime.split("\r\n\r\n")[1]!.replace(/\r\n/g, "");
    expect(Buffer.from(encoded, "base64").toString("utf8")).toBe(
      "Line one.\n\nLine two — with an em dash.",
    );
  });

  it("wraps the base64 body so no line exceeds 76 characters", () => {
    const mime = buildMimeMessage({ ...base, body: "x".repeat(5000) });
    const bodyLines = mime.split("\r\n\r\n")[1]!.split("\r\n");
    expect(Math.max(...bodyLines.map((l) => l.length))).toBeLessThanOrEqual(76);
  });

  it("cannot be made to forge a header through the subject", () => {
    const mime = buildMimeMessage({
      ...base,
      subject: "hello\r\nBcc: attacker@evil.test",
    });
    expect(headersOf(mime)).not.toMatch(/^Bcc:/m);
  });

  it("cannot be made to forge a header through the display name", () => {
    const mime = buildMimeMessage({
      ...base,
      fromName: 'Name"\r\nBcc: attacker@evil.test',
    });
    expect(headersOf(mime)).not.toMatch(/^Bcc:/m);
  });

  it("quotes a display name containing a comma so it is not read as two recipients", () => {
    const mime = buildMimeMessage({ ...base, fromName: "Oliver, Manuchimso" });
    expect(headersOf(mime)).toContain('From: "Oliver, Manuchimso" <outreach@atlas.test>');
  });
});

describe("encodeForGmail", () => {
  it("produces unpadded base64url", () => {
    const encoded = encodeForGmail(buildMimeMessage(base));
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it("decodes back to the original message", () => {
    const mime = buildMimeMessage(base);
    const decoded = Buffer.from(
      encodeForGmail(mime).replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    expect(decoded).toBe(mime);
  });
});
