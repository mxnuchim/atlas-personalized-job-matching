"use client";

import { AlertTriangleIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { FitGauge } from "@/components/fit-gauge";
import { TierChip } from "@/components/tier-chip";
import type { MatchRow } from "@/db/queries/matches";
import { REVEAL, STAGGER_STEP, TRANSITION } from "@/lib/motion";

/**
 * A top match on Today. Cards here, a table on Matches: Today is a short, considered
 * shortlist you read, not a list you work through.
 *
 * This is the only component that participates in the product's one orchestrated
 * motion moment (PRD §10.2/§10.4) — the day's matches reveal once on load, each
 * gauge sweeping in behind its card. Nowhere else does a card fade up (§10.5).
 */
export function MatchCard({
  match,
  strengthLabels,
  index = 0,
}: {
  match: MatchRow;
  strengthLabels: Record<string, string>;
  /** Position in the reveal; drives the stagger. */
  index?: number;
}) {
  const reduced = useReducedMotion();
  const delay = reduced ? 0 : index * STAGGER_STEP;

  const topStrengths = [...match.strengthMatches]
    .sort((a, b) => b.rewarded - a.rewarded)
    .slice(0, 4);

  return (
    <motion.article
      initial={reduced ? false : REVEAL.initial}
      animate={REVEAL.animate}
      transition={reduced ? { duration: 0 } : { ...TRANSITION.enter, delay }}
      className="bg-card rounded-xl border p-5"
    >
      <div className="flex items-start gap-5">
        <FitGauge
          value={match.overall}
          tier={match.tier}
          size="md"
          delay={delay + (reduced ? 0 : 0.12)}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <a
                href={match.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-display focus-visible:ring-ring rounded text-base leading-tight font-semibold text-balance hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                {match.title}
              </a>
              <p className="text-muted-foreground mt-1 text-sm">
                {match.company}
                {match.location ? ` · ${match.location}` : ""}
                {match.remote ? " · Remote" : ""}
              </p>
            </div>
            <TierChip tier={match.tier} className="shrink-0" />
          </div>

          <p className="mt-3 text-sm leading-relaxed text-pretty">{match.whyYou}</p>

          {topStrengths.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {topStrengths.map((s) => (
                <li
                  key={s.strength_key}
                  className="bg-muted text-muted-foreground rounded-md px-2 py-0.5 text-xs"
                >
                  {strengthLabels[s.strength_key] ?? s.strength_key}
                  <span className="ml-1.5 tabular-nums opacity-60">{s.rewarded}</span>
                </li>
              ))}
            </ul>
          )}

          {match.redFlags.length > 0 && (
            <ul className="mt-3 space-y-1">
              {match.redFlags.slice(0, 2).map((flag) => (
                <li className="text-muted-foreground flex gap-2 text-xs" key={flag}>
                  <AlertTriangleIcon className="text-destructive mt-0.5 size-3 shrink-0" />
                  <span className="text-pretty">{flag}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </motion.article>
  );
}
