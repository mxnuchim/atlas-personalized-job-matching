"use client";

import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import type { FitTier } from "@/lib/scoring";

/**
 * The fit score is the product's characteristic object, so it is the hero and the
 * only place the design spends any boldness (PRD §10.2). A considered dial, not a
 * plain number: a 260° arc whose sweep length *is* the score, so the value reads
 * pre-attentively before you parse the digits.
 *
 * Motion is deliberately minimal — the arc sweeps 0 → value exactly once on mount
 * and never again (§10.4). `prefers-reduced-motion` collapses it to instant, not
 * merely slower.
 */

const SIZES = {
  sm: { box: 44, stroke: 3.5, text: "text-[0.8125rem]" },
  md: { box: 64, stroke: 4.5, text: "text-lg" },
  lg: { box: 104, stroke: 6, text: "text-3xl" },
} as const;

/**
 * 260° of a circle, leaving a 100° gap centred on due south — open at the bottom,
 * which reads as an instrument dial rather than a progress ring. The SVG is rotated
 * -220° so the sweep starts at the lower-left tip of that gap.
 */
const SWEEP = 260 / 360;

/**
 * The arc geometry, pure so it can be tested: a gauge that draws the wrong fill for a
 * value is a lie about the single number this product exists to communicate.
 */
export function gaugeArc(value: number, box: number, stroke: number) {
  const radius = (box - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const trackLength = circumference * SWEEP;
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

  return {
    radius,
    circumference,
    trackLength,
    clamped,
    /** Full track hidden at 0, nothing hidden at 100. */
    emptyOffset: trackLength,
    filledOffset: trackLength * (1 - clamped / 100),
  };
}

type FitGaugeProps = {
  /** 0–100. */
  value: number;
  tier: FitTier;
  size?: keyof typeof SIZES;
  /** Stagger offset, in seconds, for Today's one orchestrated reveal. */
  delay?: number;
  className?: string;
};

export function FitGauge({ value, tier, size = "sm", delay = 0, className }: FitGaugeProps) {
  const reduced = useReducedMotion();
  const { box, stroke, text } = SIZES[size];

  // The arc is drawn as one dash of `trackLength`, and the score is revealed by
  // retracting the offset. Animating `strokeDashoffset` keeps the whole thing on
  // one path — no layout, no repaint of anything around it.
  const { radius, circumference, trackLength, clamped, emptyOffset, filledOffset } = gaugeArc(
    value,
    box,
    stroke,
  );

  return (
    <div
      className={cn("relative shrink-0", className)}
      style={{ width: box, height: box }}
      // The number below is the accessible value; the arc is decoration for it.
      role="img"
      aria-label={`Fit ${clamped} out of 100, ${tier}`}
    >
      <svg
        width={box}
        height={box}
        viewBox={`0 0 ${box} ${box}`}
        className="block -rotate-[220deg]"
        aria-hidden="true"
      >
        <circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${trackLength} ${circumference}`}
          className="text-border"
        />
        <motion.circle
          cx={box / 2}
          cy={box / 2}
          r={radius}
          fill="none"
          stroke={`var(--tier-${tier})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${trackLength} ${circumference}`}
          initial={{ strokeDashoffset: reduced ? filledOffset : emptyOffset }}
          animate={{ strokeDashoffset: filledOffset }}
          transition={
            reduced
              ? { duration: 0 }
              : // Spring, not easing: the needle settles rather than stopping dead.
                { type: "spring", stiffness: 90, damping: 20, mass: 0.9, delay }
          }
        />
      </svg>

      <span
        className={cn(
          "font-display absolute inset-0 flex items-center justify-center tabular-nums",
          text,
        )}
        style={{ color: `var(--tier-${tier})` }}
      >
        {clamped}
      </span>
    </div>
  );
}

/** Matching skeleton so the table never shifts when real scores arrive. */
export function FitGaugeSkeleton({ size = "sm" }: { size?: keyof typeof SIZES }) {
  const { box } = SIZES[size];
  return (
    <div
      className="bg-muted shrink-0 animate-pulse rounded-full"
      style={{ width: box, height: box }}
    />
  );
}
