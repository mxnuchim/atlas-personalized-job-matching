import { describe, expect, it } from "vitest";

import { extractContact } from "./contact";

describe("extractContact", () => {
  it("returns null when there is nothing to find", () => {
    // The common case: most postings route through a form.
    expect(extractContact("Apply through our careers portal.")).toBeNull();
    expect(extractContact("")).toBeNull();
    expect(extractContact(null)).toBeNull();
  });

  it("finds a plain address", () => {
    expect(extractContact("Questions? Email maria.chen@acme.com")).toEqual({
      email: "maria.chen@acme.com",
      personal: true,
    });
  });

  it("prefers a person over a role mailbox", () => {
    const text = "Write to careers@acme.com or reach the hiring manager at maria.chen@acme.com.";
    expect(extractContact(text)?.email).toBe("maria.chen@acme.com");
  });

  it("still returns a role mailbox when that is all there is", () => {
    expect(extractContact("Send your CV to careers@acme.com")).toEqual({
      email: "careers@acme.com",
      personal: false,
    });
  });

  it.each([
    "no-reply@acme.com",
    "noreply@acme.com",
    "do-not-reply@acme.com",
    "notifications@acme.com",
    "privacy@acme.com",
    "legal@acme.com",
  ])("rejects %s — nothing reaches a person there", (email) => {
    expect(extractContact(`Contact ${email} for details.`)).toBeNull();
  });

  it.each([
    "jobs@boards.greenhouse.io",
    "apply@acme.lever.co",
    "hr@acme.myworkdaysite.com",
    "test@example.com",
  ])("rejects the platform address %s", (email) => {
    // These are the applicant-tracking plumbing, not the employer.
    expect(extractContact(`Apply via ${email}`)).toBeNull();
  });

  it("is not fooled by asset filenames in inline markup", () => {
    expect(extractContact("background: url(sprite@2x.png) no-repeat")).toBeNull();
  });

  it("strips trailing punctuation", () => {
    expect(extractContact("Reach me at maria.chen@acme.com.")?.email).toBe("maria.chen@acme.com");
    expect(extractContact("(maria.chen@acme.com)")?.email).toBe("maria.chen@acme.com");
  });

  it("normalises case and does not report the same address twice", () => {
    expect(extractContact("Maria.Chen@ACME.com and maria.chen@acme.com")).toEqual({
      email: "maria.chen@acme.com",
      personal: true,
    });
  });
});
