/**
 * WCAG 2.1 relative luminance and contrast ratio.
 *
 * Pure so the palette can be audited in CI rather than by eye. Contrast is the one
 * accessibility property that is fully decidable from the tokens alone — if it is
 * checked anywhere, it should be checked automatically.
 */

export type Rgb = { r: number; g: number; b: number };

/** `#rgb`, `#rrggbb`, or `#rrggbbaa` (alpha ignored — composite before measuring). */
export function parseHex(hex: string): Rgb {
  const clean = hex.trim().replace(/^#/, "");
  const full =
    clean.length === 3 || clean.length === 4
      ? clean
          .slice(0, 3)
          .split("")
          .map((c) => c + c)
          .join("")
      : clean.slice(0, 6);

  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Not a hex colour: ${hex}`);

  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

/** WCAG relative luminance: sRGB channels linearised, then weighted. */
export function luminance(color: Rgb | string): number {
  const { r, g, b } = typeof color === "string" ? parseHex(color) : color;
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Contrast ratio, 1 (identical) to 21 (black on white). Order-independent. */
export function contrastRatio(a: Rgb | string, b: Rgb | string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];
  return (light + 0.05) / (dark + 0.05);
}

/**
 * Composite a translucent colour over a background — `color-mix(… X%, transparent)`
 * and `/12` opacity utilities produce colours whose real contrast depends on what is
 * behind them, so they must be flattened before measuring.
 */
export function composite(foreground: Rgb | string, background: Rgb | string, alpha: number): Rgb {
  const fg = typeof foreground === "string" ? parseHex(foreground) : foreground;
  const bg = typeof background === "string" ? parseHex(background) : background;
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b) };
}

/** WCAG 2.1 AA thresholds. */
export const AA = {
  /** Body text below 18.66px regular / 24px bold. */
  normalText: 4.5,
  /** 18.66px+ regular or 24px+ bold. */
  largeText: 3,
  /** Borders, icons, focus rings, and any meaning-bearing graphic. */
  nonText: 3,
} as const;

/** Parse `--name: #hex;` declarations out of a CSS block. */
export function readTokens(css: string): Record<string, string> {
  const tokens: Record<string, string> = {};
  for (const match of css.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    tokens[`--${match[1]}`] = match[2]!;
  }
  return tokens;
}

/** Extract one top-level rule's body, e.g. `:root { … }`. */
export function extractBlock(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No ${selector} block found`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`Unterminated ${selector} block`);
}
