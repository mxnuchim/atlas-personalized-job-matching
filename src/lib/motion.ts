import type { Transition } from "motion/react";

/**
 * The single source of motion truth (INTERFACE §5). Every animated component imports
 * from here — no magic easings or durations inline — so the whole app moves as one
 * system. Values are tuned for a calm, physical feel: fast, spring-settled, GPU-only
 * (animate `transform` / `opacity`, never layout properties).
 *
 * `prefers-reduced-motion` is honored at the call site via `useReducedMotion()`, which
 * collapses these to `{ duration: 0 }` — instant, not merely slower. The CSS mirror of
 * these tokens (`--ease-*`, `--duration-*` in globals.css) drives non-JS transitions and
 * is globally neutralized under reduced-motion there.
 */

/** A cubic-bezier control tuple, in the shape `motion` expects for `ease`. */
type Bezier = [number, number, number, number];

/** Cubic-bezier curves, mirrored as `--ease-*` in globals.css. */
export const EASE: Record<"emphasized" | "standard" | "exit", Bezier> = {
  /** House curve: a decisive decelerate. Enters and settles. */
  emphasized: [0.22, 1, 0.36, 1],
  /** Symmetric in/out for hover, tint and small opacity changes. */
  standard: [0.4, 0, 0.2, 1],
  /** Accelerate — for things leaving the screen. */
  exit: [0.4, 0, 1, 1],
};

/** Durations in **seconds** (motion/react). Short by design — premium reads as responsive. */
export const DURATION = {
  instant: 0.1,
  fast: 0.15,
  base: 0.22,
  slow: 0.32,
} as const;

/** Spring presets. Reused verbatim so every spring in the app shares a physical family. */
export const SPRING = {
  /** The gauge needle: settles without fussy overshoot. */
  gauge: { type: "spring", stiffness: 90, damping: 20, mass: 0.9 },
  /** Snappy UI — drawer, sheets, layout shifts. A little life, no visible bounce. */
  snappy: { type: "spring", stiffness: 380, damping: 34, mass: 0.9 },
  /** Press feedback — quick and tight, springs straight back. */
  press: { type: "spring", stiffness: 600, damping: 30, mass: 0.7 },
  /** Soft — gentle content settles and neighbor reflow. */
  soft: { type: "spring", stiffness: 260, damping: 30 },
} as const satisfies Record<string, Transition>;

/** Named tween transitions for enter / exit / cross-fade. */
export const TRANSITION = {
  fade: { duration: DURATION.base, ease: EASE.standard },
  enter: { duration: DURATION.slow, ease: EASE.emphasized },
  exit: { duration: DURATION.fast, ease: EASE.exit },
} as const satisfies Record<string, Transition>;

/** Seconds between siblings in a staggered reveal. */
export const STAGGER_STEP = 0.07;

/** The one orchestrated entrance (Today): rise + fade. Pair with `TRANSITION.enter`. */
export const REVEAL = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
} as const;

/**
 * Press/hover props for a `motion` interactive element. Spread onto buttons, rows and
 * chips for the tactile feel; the spring returns it home the instant the pointer lifts.
 */
export const PRESSABLE = {
  whileTap: { scale: 0.97 },
  transition: SPRING.press,
} as const;
