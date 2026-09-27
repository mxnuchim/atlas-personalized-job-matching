import { describe, expect, it } from "vitest";

import { buildHtml, buildSubject, buildText, type DailyEmailInput } from "./email";

function run(overrides: Partial<DailyEmailInput> = {}): DailyEmailInput {
  return {
    newJobs: 0,
    scored: 0,
    strong: 0,
    errors: 0,
    sourcesOk: 10,
    sourcesTotal: 10,
    queued: 0,
    top: [],
    costUsd: 0,
    appUrl: "https://atlas.test",
    ...overrides,
  };
}

const role = (title: string, company: string, overall: number) => ({ title, company, overall });

describe("buildSubject", () => {
  it("carries the decision: is there anything to open the app for", () => {
    expect(buildSubject(run({ queued: 6, strong: 2 }))).toBe("Atlas: 6 roles ready, 2 strong");
  });

  it("says plainly when there is nothing", () => {
    expect(buildSubject(run())).toBe("Atlas: nothing new today");
  });

  it("agrees with itself on one role", () => {
    expect(buildSubject(run({ queued: 1 }))).toBe("Atlas: 1 role ready");
  });

  it("omits strong when there are none, rather than saying zero", () => {
    expect(buildSubject(run({ queued: 4 }))).toBe("Atlas: 4 roles ready");
  });
});

describe("buildText", () => {
  it("lists the preview roles with their fit", () => {
    const text = buildText(run({ queued: 2, top: [role("Backend Engineer", "Monzo", 88)] }));
    expect(text).toContain("88  Backend Engineer — Monzo");
  });

  it("says how many it is not showing", () => {
    const text = buildText(run({ queued: 20, top: [role("A", "B", 90)] }));
    expect(text).toContain("and 19 more");
  });

  it("states a coverage shortfall, since it qualifies every other count", () => {
    const text = buildText(run({ queued: 3, sourcesOk: 46, sourcesTotal: 66 }));
    expect(text).toContain("Only 46 of 66 sources answered");
  });

  it("says nothing about coverage when it was complete", () => {
    expect(buildText(run({ queued: 3 }))).not.toContain("sources answered");
  });

  it("always links the queue", () => {
    expect(buildText(run())).toContain("https://atlas.test/today");
  });
});

describe("buildHtml", () => {
  it("escapes role and company names", () => {
    // Job titles really do contain ampersands and angle brackets.
    const html = buildHtml(run({ queued: 1, top: [role("R&D <Lead>", "A & B", 70)] }));
    expect(html).toContain("R&amp;D &lt;Lead&gt;");
    expect(html).toContain("A &amp; B");
    expect(html).not.toContain("<Lead>");
  });

  it("links to the queue", () => {
    expect(buildHtml(run())).toContain("https://atlas.test/today");
  });

  it("inlines the load-bearing styles, since Gmail strips stylesheets", () => {
    const html = buildHtml(run({ queued: 1, top: [role("A", "B", 70)] }));
    // Colour, spacing and type all inline; the <style> block only carries the dark
    // mode and small-screen enhancements, which are allowed to be dropped.
    expect(html).toMatch(/<td[^>]+style="[^"]*background:/);
    expect(html).toMatch(/<h1[^>]+style="[^"]*font-family:/);
  });

  it("does not depend on the web font landing", () => {
    // Apple Mail honours the @font-face; Gmail and Outlook ignore it. The stack has
    // to carry the design on its own.
    const html = buildHtml(run({ queued: 1, top: [role("A", "B", 70)] }));
    expect(html).toContain("fonts.googleapis.com");
    expect(html).toContain("-apple-system");
    expect(html).toContain("Arial");
  });

  it("lays out in tables, because Outlook renders through Word", () => {
    const html = buildHtml(run({ queued: 1, top: [role("A", "B", 70)] }));
    expect(html).toContain('role="presentation"');
    expect(html).not.toContain("display:flex");
    expect(html).not.toContain("display:grid");
  });

  it("gives Outlook a VML button, which ignores padding on anchors", () => {
    const html = buildHtml(run({ queued: 1, top: [role("A", "B", 70)] }));
    expect(html).toContain("v:roundrect");
    expect(html).toContain("<!--[if mso]>");
  });

  it("carries a preheader so the client does not scrape the wordmark", () => {
    const html = buildHtml(run({ queued: 3, top: [role("A", "Monzo", 70)] }));
    expect(html).toContain("Monzo");
    expect(html).toMatch(/max-height:0/);
  });

  it("loads no remote images, which every client blocks by default", () => {
    const html = buildHtml(run({ queued: 2, top: [role("A", "B", 70)] }));
    expect(html).not.toContain("<img");
  });

  it("states a colour scheme so dark clients do not invert it themselves", () => {
    const html = buildHtml(run({ queued: 1 }));
    expect(html).toContain('name="color-scheme"');
    expect(html).toContain("prefers-color-scheme: dark");
  });

  it("shows the shortfall banner only when coverage was incomplete", () => {
    expect(buildHtml(run({ queued: 1, sourcesOk: 2, sourcesTotal: 9 }))).toContain(
      "Only 2 of 9 sources answered",
    );
    expect(buildHtml(run({ queued: 1 }))).not.toContain("sources answered");
  });
});
