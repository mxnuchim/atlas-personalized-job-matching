import { AlertTriangleIcon } from "lucide-react";

import type { MatchWithJob } from "@/db/queries/matches";
import { cn } from "@/lib/utils";
import { type FitTier, TIER_LABELS } from "@/lib/scoring";

const TIER_STYLES: Record<FitTier, string> = {
  strong: "bg-emerald-500/12 text-emerald-700 ring-emerald-500/25 dark:text-emerald-400",
  possible: "bg-primary/12 text-primary ring-primary/25",
  stretch: "bg-amber-500/12 text-amber-700 ring-amber-500/25 dark:text-amber-400",
};

const DIMENSIONS: { key: keyof MatchWithJob["dimensions"]; label: string }[] = [
  { key: "role_fit", label: "Role" },
  { key: "seniority_fit", label: "Seniority" },
  { key: "tech_fit", label: "Tech" },
  { key: "location_fit", label: "Location" },
  { key: "company_fit", label: "Company" },
];

export function MatchCard({
  match,
  strengthLabels,
}: {
  match: MatchWithJob;
  strengthLabels: Record<string, string>;
}) {
  const tier = match.tier as FitTier;
  const topStrengths = [...match.strengthMatches]
    .sort((a, b) => b.rewarded - a.rewarded)
    .slice(0, 4);

  return (
    <article className="bg-card rounded-xl border p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <a
            href={match.job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-display text-base font-semibold tracking-tight hover:underline"
          >
            {match.job.title}
          </a>
          <div className="text-muted-foreground mt-0.5 truncate text-sm">
            {match.job.company}
            {match.job.location ? ` · ${match.job.location}` : ""}
            {match.job.remote ? " · Remote" : ""}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="font-display text-2xl leading-none font-semibold tabular-nums">
            {match.overall}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
              TIER_STYLES[tier],
            )}
          >
            {TIER_LABELS[tier]}
          </span>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-pretty">{match.whyYou}</p>

      {topStrengths.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {topStrengths.map((s) => (
            <span
              key={s.strength_key}
              className="bg-secondary text-secondary-foreground rounded-md px-2 py-0.5 text-xs"
            >
              {strengthLabels[s.strength_key] ?? s.strength_key}
            </span>
          ))}
        </div>
      ) : null}

      <dl className="text-muted-foreground mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs">
        {DIMENSIONS.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-1.5">
            <dt>{label}</dt>
            <dd className="text-foreground tabular-nums">{match.dimensions[key]}</dd>
          </div>
        ))}
      </dl>

      {match.redFlags.length > 0 ? (
        <div className="text-muted-foreground mt-4 flex gap-2 border-t pt-3 text-xs">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <ul className="space-y-0.5">
            {match.redFlags.map((flag, i) => (
              <li key={i}>{flag}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
