import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Standing guards on the motion system (INTERFACE §5, PRD §10.7).
 *
 * These are static rather than runtime because the failure mode is a *new* animated
 * component that simply forgets — which no amount of testing the existing ones catches.
 */

const SRC = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // The component gallery is a local dev tool, never shipped or deployed.
      return entry === "preview" ? [] : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Files that actually render motion components, as opposed to defining tokens. */
function animatedFiles(): { rel: string; source: string }[] {
  return sourceFiles(SRC)
    .map((file) => ({ rel: relative(SRC, file), source: readFileSync(file, "utf8") }))
    .filter(({ source }) => /<motion\.|<AnimatePresence/.test(source));
}

describe("prefers-reduced-motion", () => {
  it("is honoured by every animated component", () => {
    // Collapsing to instant is a §10.7 requirement, not a nicety: vestibular disorders
    // make unwanted motion genuinely harmful.
    const offenders = animatedFiles()
      .filter(({ source }) => !source.includes("useReducedMotion"))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  it("is neutralised in CSS too, for transitions no component controls", () => {
    const css = readFileSync(join(SRC, "app/globals.css"), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
    expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
  });

  it("finds the files it is meant to be scanning", () => {
    // Guards against a silently-empty walk making the assertions above vacuous.
    expect(animatedFiles().length).toBeGreaterThanOrEqual(4);
  });
});

describe("animation stays on the compositor", () => {
  /**
   * Animating a layout property forces layout on every frame, which is what turns a
   * 120fps interaction into a janky one on a mid-range Android. `transform` and
   * `opacity` do not.
   */
  const LAYOUT_PROPERTIES = [
    "width",
    "height",
    "top",
    "left",
    "right",
    "bottom",
    "margin",
    "padding",
  ];

  it("never animates a layout-triggering property", () => {
    const offenders: string[] = [];

    for (const { rel, source } of animatedFiles()) {
      // Only inspect the object literals passed to initial/animate/exit/whileTap.
      for (const match of source.matchAll(
        /(?:initial|animate|exit|whileTap|whileHover)=\{\{([^}]*)\}\}/g,
      )) {
        const body = match[1] ?? "";
        for (const prop of LAYOUT_PROPERTIES) {
          if (new RegExp(`(^|[\\s,{])${prop}\\s*:`).test(body)) {
            offenders.push(`${rel} animates ${prop}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

describe("motion tokens are the single source", () => {
  it("no component hardcodes a cubic-bezier or a spring", () => {
    // INTERFACE §5: every animated component imports from lib/motion, so the whole app
    // moves as one system. An inline easing is how that quietly stops being true.
    const offenders: string[] = [];

    for (const { rel, source } of animatedFiles()) {
      if (/cubic-bezier\(/.test(source)) offenders.push(`${rel} has an inline cubic-bezier`);
      if (/type:\s*["']spring["']/.test(source)) offenders.push(`${rel} declares a spring inline`);
      // A bare bezier tuple passed as `ease`.
      if (/ease:\s*\[\s*[\d.]+\s*,/.test(source)) offenders.push(`${rel} has an inline ease tuple`);
    }

    expect(offenders).toEqual([]);
  });
});
