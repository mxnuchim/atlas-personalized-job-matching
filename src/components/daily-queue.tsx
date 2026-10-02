"use client";

import { useOptimistic, useState, useTransition } from "react";
import { CheckIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import {
  dismissMatchAction,
  markAppliedAction,
  type ActionResult,
} from "@/app/(app)/matches/actions";
import { FitGauge } from "@/components/fit-gauge";
import { MatchDrawer } from "@/components/match-drawer";
import { TierChip } from "@/components/tier-chip";
import type { MatchRow } from "@/db/queries/matches";

/**
 * The day's queue — a short list you are meant to finish.
 *
 * The whole point is that it empties. Acting on a role removes it here and moves it
 * in the tracker, so tomorrow's queue is new rather than the same four hundred rows
 * with the top four changed. A list nobody can finish gets skimmed and then ignored,
 * which is the failure this screen exists to avoid.
 */
export function DailyQueue({
  matches,
  strengthLabels,
  waiting,
  resumeReady = false,
}: {
  matches: MatchRow[];
  strengthLabels: Record<string, string>;
  /** Total unacted matches, so the queue can say what it is holding back. */
  waiting: number;
  /** Whether you have a resume on file — gates "Tailor resume" in the drawer. */
  resumeReady?: boolean;
}) {
  // One transition per click, but no shared pending flag: a role being marked must never
  // freeze the others. Each row disappears the moment it's acted on, so it can't be
  // submitted twice anyway.
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState<MatchRow | null>(null);
  // Removing on click keeps the queue feeling like a list you are clearing, rather
  // than one that reshuffles under you after a round trip.
  const [done, act] = useOptimistic<string[], string>([], (ids, id) => [...ids, id]);

  const visible = matches.filter((m) => !done.includes(m.id));

  function run(match: MatchRow, action: (i: unknown) => Promise<ActionResult>, verb: string) {
    startTransition(async () => {
      act(match.id);
      const result = await action({ matchId: match.id });
      if (result.ok) toast.success(result.message ?? `${verb}.`);
      else toast.error(result.error);
    });
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border px-5 py-8 text-center">
        <p className="font-medium">That&rsquo;s the queue cleared.</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {waiting > visible.length
            ? "More are waiting — they will be here tomorrow, or fetch now above."
            : "Nothing else is waiting. The next run brings more."}
        </p>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-border overflow-hidden rounded-xl border">
        {visible.map((match) => (
          <li key={match.id} className="flex items-start gap-4 border-b px-5 py-4 last:border-b-0">
            <button
              type="button"
              onClick={() => setOpen(match)}
              className="focus-visible:ring-ring shrink-0 rounded-full focus-visible:ring-2 focus-visible:outline-none"
              aria-label={`Open ${match.title}`}
            >
              <FitGauge value={match.overall} tier={match.tier} size="sm" />
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(match)}
                  className="focus-visible:ring-ring truncate rounded text-left text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                >
                  {match.title}
                </button>
                <TierChip tier={match.tier} />
              </div>
              <p className="text-muted-foreground mt-0.5 truncate text-xs">
                {match.company}
                {match.location ? ` · ${match.location}` : ""}
                {match.postedAgeLabel ? ` · ${match.postedAgeLabel}` : ""}
              </p>
              <p className="mt-1.5 line-clamp-2 text-sm text-pretty">{match.whyYou}</p>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <a
                href={match.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring rounded-md p-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                aria-label={`Open the ${match.title} posting`}
              >
                <ExternalLinkIcon className="size-4" />
              </a>
              <button
                type="button"
                onClick={() => run(match, markAppliedAction, "Tracked")}
                className="text-tier-strong-ink hover:bg-muted focus-visible:ring-ring rounded-md p-2 transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                aria-label={`Mark ${match.title} as applied`}
                title="I applied"
              >
                <CheckIcon className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => run(match, dismissMatchAction, "Closed")}
                className="text-muted-foreground hover:text-destructive hover:bg-muted focus-visible:ring-ring rounded-md p-2 transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                aria-label={`Dismiss ${match.title}`}
                title="Not interested"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      <MatchDrawer
        match={open}
        strengthLabels={strengthLabels}
        resumeReady={resumeReady}
        onOpenChange={(isOpen) => !isOpen && setOpen(null)}
        // Acting from the drawer is the same as acting from the row: close it, drop the role
        // from the queue at once, let the server catch up.
        onAction={(kind) => {
          if (!open) return;
          const match = open;
          setOpen(null);
          if (kind === "applied") run(match, markAppliedAction, "Tracked");
          else run(match, dismissMatchAction, "Closed");
        }}
      />
    </>
  );
}
