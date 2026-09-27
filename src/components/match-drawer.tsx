"use client";

import { AlertTriangleIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { Dialog } from "radix-ui";

import { FitGauge } from "@/components/fit-gauge";
import { TierChip } from "@/components/tier-chip";
import type { MatchRow } from "@/db/queries/matches";
import { cn } from "@/lib/utils";

/**
 * The match drawer (PRD §10.3). Everything the score is made of, in the order you
 * actually read it: the gauge, why you, the strengths this role rewards, the
 * five-dimension breakdown, the reasoning, the red flags, then the posting.
 *
 * This is the one place in the app that carries a real shadow (§10.1) — earned,
 * because it floats above the console rather than sitting in it.
 */

const DIMENSIONS: { key: keyof MatchRow["dimensions"]; label: string }[] = [
  { key: "role_fit", label: "Role" },
  { key: "seniority_fit", label: "Seniority" },
  { key: "tech_fit", label: "Tech" },
  { key: "location_fit", label: "Location" },
  { key: "company_fit", label: "Company" },
];

export function MatchDrawer({
  match,
  strengthLabels,
  onOpenChange,
  onCloseFocus,
}: {
  match: MatchRow | null;
  strengthLabels: Record<string, string>;
  onOpenChange: (open: boolean) => void;
  /**
   * Where focus should land on close. The drawer is opened programmatically rather
   * than from a Radix trigger, so Radix has nothing to restore focus to and drops it
   * on `<body>` — which silently kills `j`/`k` for anyone working by keyboard.
   */
  onCloseFocus?: () => void;
}) {
  return (
    <Dialog.Root open={match !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px] motion-reduce:animate-none dark:bg-black/50" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onCloseFocus?.();
          }}
          className={cn(
            "bg-card fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col shadow-2xl outline-none",
            "data-[state=closed]:animate-out data-[state=open]:animate-in border-l",
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            "duration-200 motion-reduce:animate-none motion-reduce:duration-0",
          )}
        >
          {match ? <DrawerBody match={match} strengthLabels={strengthLabels} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DrawerBody({
  match,
  strengthLabels,
}: {
  match: MatchRow;
  strengthLabels: Record<string, string>;
}) {
  const rewarded = [...match.strengthMatches].sort((a, b) => b.rewarded - a.rewarded);
  const location = match.location ?? (match.remote ? "Remote" : "Location not stated");

  return (
    <>
      <header className="flex items-start gap-4 border-b px-6 py-5">
        {/* Keyed by id so re-opening a different match replays the sweep, and
            re-rendering the same one does not. */}
        <FitGauge key={match.id} value={match.overall} tier={match.tier} size="md" />

        <div className="min-w-0 flex-1">
          <Dialog.Title className="font-display text-lg leading-tight font-semibold text-balance">
            {match.title}
          </Dialog.Title>
          <Dialog.Description className="text-muted-foreground mt-1 text-sm">
            {match.company} · {location}
            {match.remote && match.location ? " · Remote" : ""}
          </Dialog.Description>
          <div className="mt-2.5">
            <TierChip tier={match.tier} />
          </div>
        </div>

        <Dialog.Close
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -mt-1 -mr-2 rounded-md p-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          aria-label="Close"
        >
          <XIcon className="size-4" />
        </Dialog.Close>
      </header>

      <div className="flex-1 space-y-7 overflow-y-auto px-6 py-6">
        <section>
          <SectionLabel>Why you</SectionLabel>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-pretty">{match.whyYou}</p>
        </section>

        {rewarded.length > 0 && (
          <section>
            <SectionLabel>Strengths this role rewards</SectionLabel>
            <ul className="mt-3 space-y-2.5">
              {rewarded.map((s) => (
                <li key={s.strength_key} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm text-pretty">
                    {strengthLabels[s.strength_key] ?? s.strength_key}
                  </span>
                  <Meter value={s.rewarded} className="w-20 shrink-0 sm:w-24" />
                  <span className="text-muted-foreground w-7 shrink-0 text-right text-xs tabular-nums">
                    {s.rewarded}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <SectionLabel>Fit breakdown</SectionLabel>
          <dl className="mt-3 space-y-2.5">
            {DIMENSIONS.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-3">
                <dt className="text-muted-foreground w-20 shrink-0 text-sm">{label}</dt>
                <dd className="flex flex-1 items-center gap-3">
                  <Meter value={match.dimensions[key]} className="flex-1" />
                  <span className="text-muted-foreground w-7 shrink-0 text-right text-xs tabular-nums">
                    {match.dimensions[key]}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <SectionLabel>Reasoning</SectionLabel>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">
            {match.reasoning}
          </p>
        </section>

        {match.redFlags.length > 0 && (
          <section>
            <SectionLabel>Red flags</SectionLabel>
            <ul className="mt-2 space-y-1.5">
              {match.redFlags.map((flag) => (
                <li key={flag} className="flex gap-2 text-sm">
                  <AlertTriangleIcon
                    className="text-destructive mt-0.5 size-3.5 shrink-0"
                    strokeWidth={2}
                  />
                  <span className="text-pretty">{flag}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <SectionLabel>The posting</SectionLabel>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed whitespace-pre-line">
            {match.description || "No description was provided by the source."}
          </p>
          {match.descriptionTruncated && (
            <p className="text-muted-foreground mt-2 text-xs">
              Shortened — open the original for the full posting.
            </p>
          )}
        </section>
      </div>

      <footer className="flex items-center justify-between gap-4 border-t px-6 py-4">
        <span className="text-muted-foreground text-xs">
          Scored {match.scoredAtLabel} · {match.model}
        </span>
        <a
          href={match.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-ink focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Open original
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </footer>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-muted-foreground text-sm font-medium">{children}</h3>;
}

/** A quiet bar. Uses the accent, not a tier colour — this is magnitude, not verdict. */
function Meter({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("bg-muted h-1 overflow-hidden rounded-full", className)}>
      <span
        className="bg-primary/70 block h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  );
}
