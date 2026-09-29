import { describe, expect, it } from "vitest";

import { gmailComposeUrl, mailtoUrl } from "./gmail";

describe("gmailComposeUrl", () => {
  it("builds a compose URL with recipient, subject and body", () => {
    const url = new URL(
      gmailComposeUrl({ to: "maria.chen@acme.com", subject: "Platform role", body: "Hi Maria," }),
    );
    expect(url.origin + url.pathname).toBe("https://mail.google.com/mail/");
    expect(url.searchParams.get("view")).toBe("cm");
    expect(url.searchParams.get("fs")).toBe("1");
    expect(url.searchParams.get("to")).toBe("maria.chen@acme.com");
    expect(url.searchParams.get("su")).toBe("Platform role");
    expect(url.searchParams.get("body")).toBe("Hi Maria,");
  });

  it("preserves newlines in the body so paragraphs survive the handoff", () => {
    const url = new URL(gmailComposeUrl({ to: "a@b.com", subject: "s", body: "line one\n\nline two" }));
    expect(url.searchParams.get("body")).toBe("line one\n\nline two");
  });

  it("omits fields that are empty or null rather than sending blanks", () => {
    const url = new URL(gmailComposeUrl({ to: "a@b.com", subject: null, body: "" }));
    expect(url.searchParams.get("to")).toBe("a@b.com");
    expect(url.searchParams.has("su")).toBe(false);
    expect(url.searchParams.has("body")).toBe(false);
  });
});

describe("mailtoUrl", () => {
  it("targets the recipient and carries subject and body", () => {
    const url = mailtoUrl({ to: "maria.chen@acme.com", subject: "Hello", body: "Hi" });
    expect(url.startsWith("mailto:maria.chen@acme.com?")).toBe(true);
    const query = new URLSearchParams(url.split("?")[1]);
    expect(query.get("subject")).toBe("Hello");
    expect(query.get("body")).toBe("Hi");
  });

  it("degrades to a bare mailto when there is nothing to prefill", () => {
    expect(mailtoUrl({ to: "a@b.com" })).toBe("mailto:a@b.com");
    expect(mailtoUrl({})).toBe("mailto:");
  });
});
