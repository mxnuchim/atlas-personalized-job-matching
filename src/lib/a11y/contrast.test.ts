import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { AA, composite, contrastRatio, extractBlock, parseHex, readTokens } from "./contrast";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const LIGHT = readTokens(extractBlock(css, ":root"));
const DARK = { ...LIGHT, ...readTokens(extractBlock(css, ".dark")) };
const THEMES = [
  ["light", LIGHT],
  ["dark", DARK],
] as const;

describe("contrast maths", () => {
  it("matches the WCAG reference extremes", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("is order-independent", () => {
    expect(contrastRatio("#16181d", "#f5f6f8")).toBeCloseTo(
      contrastRatio("#f5f6f8", "#16181d"),
      10,
    );
  });

  it("parses shorthand and alpha hex", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex("#4c5bd4ff")).toEqual(parseHex("#4c5bd4"));
  });

  it("composites a translucent colour onto its backdrop", () => {
    // 12% of black over white is a light grey, not black.
    expect(composite("#000000", "#ffffff", 0.12)).toEqual({ r: 224, g: 224, b: 224 });
  });
});

/**
 * The real pairings, as the components actually use them. Auditing every token against
 * every other would be noise — what matters is the combinations that ship.
 */
const TEXT_PAIRS: { name: string; fg: string; bg: string }[] = [
  { name: "body text on paper", fg: "--foreground", bg: "--background" },
  { name: "body text on card", fg: "--card-foreground", bg: "--card" },
  { name: "muted text on paper", fg: "--muted-foreground", bg: "--background" },
  { name: "muted text on card", fg: "--muted-foreground", bg: "--card" },
  { name: "muted text on muted fill", fg: "--muted-foreground", bg: "--muted" },
  { name: "primary button label", fg: "--primary-foreground", bg: "--primary" },
  { name: "destructive button label", fg: "--destructive-foreground", bg: "--destructive" },
  { name: "link/accent text on card", fg: "--primary-ink", bg: "--card" },
  { name: "link/accent text on paper", fg: "--primary-ink", bg: "--background" },
  { name: "link/accent text on popover", fg: "--primary-ink", bg: "--popover" },
  { name: "destructive text on card", fg: "--destructive", bg: "--card" },
  { name: "popover text", fg: "--popover-foreground", bg: "--popover" },
];

describe.each(THEMES)("%s theme — text meets WCAG AA (4.5:1)", (_theme, tokens) => {
  it.each(TEXT_PAIRS)("$name", ({ fg, bg }) => {
    const ratio = contrastRatio(tokens[fg]!, tokens[bg]!);
    expect(ratio, `${fg} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA.normalText);
  });
});

/**
 * The fit tiers are the product's signature colour. They carry the score inside the
 * gauge (large display type) and label the tier chip (small text on a 12% tint of
 * themselves), so both roles are checked.
 */
const TIERS = ["strong", "possible", "stretch"] as const;

describe.each(THEMES)("%s theme — fit tiers", (_theme, tokens) => {
  it.each(TIERS)("%s gauge numeral reads as large text on card", (tier) => {
    const ratio = contrastRatio(tokens[`--tier-${tier}`]!, tokens["--card"]!);
    expect(ratio, `--tier-${tier} on --card = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA.largeText,
    );
  });

  it.each(TIERS)("%s chip label reads on its own 12%% tint", (tier) => {
    // TierChip: the label is the `-ink` variant, the background is
    // color-mix(vivid 12%, transparent) over the card — so the real backdrop has to be
    // composited before measuring. Using the vivid token as the label measured
    // 2.6–3.0:1 here: legible enough to look fine, and not actually accessible.
    const tint = composite(tokens[`--tier-${tier}`]!, tokens["--card"]!, 0.12);
    const ratio = contrastRatio(tokens[`--tier-${tier}-ink`]!, tint);
    expect(ratio, `--tier-${tier}-ink on its tint = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA.normalText,
    );
  });

  it.each(TIERS)("%s chip ring is a visible edge, not decoration", (tier) => {
    const ring = composite(tokens[`--tier-${tier}`]!, tokens["--card"]!, 0.28);
    const tint = composite(tokens[`--tier-${tier}`]!, tokens["--card"]!, 0.12);
    // Only needs to separate the chip from its own fill, not to carry meaning alone.
    expect(contrastRatio(ring, tint)).toBeGreaterThan(1);
  });
});

describe.each(THEMES)("%s theme — non-text contrast (3:1)", (_theme, tokens) => {
  it("focus ring is visible against every surface it lands on", () => {
    // A focus ring nobody can see is the same as no focus ring.
    for (const surface of ["--background", "--card", "--muted"]) {
      const ratio = contrastRatio(tokens["--ring"]!, tokens[surface]!);
      expect(ratio, `--ring on ${surface} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        AA.nonText,
      );
    }
  });

  it("every ink token is defined in both themes", () => {
    // A missing token resolves to nothing and the text renders as inherited colour —
    // a silent failure that looks almost right.
    for (const name of [
      "--primary-ink",
      "--tier-strong-ink",
      "--tier-possible-ink",
      "--tier-stretch-ink",
    ]) {
      expect(tokens[name], `${name} is not defined`).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("the gauge track is distinguishable from the card behind it", () => {
    // The unfilled arc is what makes the score read as a proportion; if it vanishes
    // into the card, the gauge is just a number with decoration.
    const ratio = contrastRatio(tokens["--border"]!, tokens["--card"]!);
    expect(ratio, `--border on --card = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(1.2);
  });
});
