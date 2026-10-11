import type { Metadata } from "next";
import Link from "next/link";
import { InboxIcon } from "lucide-react";

import { CoverageBanner } from "@/components/coverage-banner";
import { DailyQueue } from "@/components/daily-queue";
import { FetchNow } from "@/components/fetch-now";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatStrip } from "@/components/stat-strip";
import { todaysLanes } from "@/db/queries/daily";
import { getMatchCounts } from "@/db/queries/matches";
import { attachResumeInfo } from "@/db/queries/resumes";
import { countJobs } from "@/db/queries/jobs";
import { getLastFinishedRun } from "@/db/queries/runs";
import { env } from "@/lib/env";
import { LANE_LABELS, LANES, parseLane, type Lane } from "@/lib/lanes";
import { nextRunLabel } from "@/lib/schedule";
import { requireProfile } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Today",
};

export const dynamic = "force-dynamic";

/**
 * Today: two fixed lists, chosen once each morning — Nigeria and Global. They never
 * refill; finishing a role is progress, and when a lane is done it says so until the
 * next run brings a new set (see `daily_picks`).
 */
export default async function TodayPage({
  searchParams,
}: {
  searchParams: Promise<{ lane?: string }>;
}) {
  // Everything on this page is scoped to the signed-in user's profile. A new account
  // has none until it is seeded, which is an empty state rather than an error.
  const { session, profile } = await requireProfile();
  const requested = parseLane((await searchParams).lane);

  const [counts, lanes, jobCount, lastRun] = await Promise.all([
    profile ? getMatchCounts(profile.id) : { total: 0, strong: 0, possible: 0, scoredToday: 0 },
    profile ? todaysLanes(profile.id) : null,
    countJobs(),
    getLastFinishedRun(),
  ]);

  const nextRun = nextRunLabel(new Date(), env.APP_TZ);
  const strengthLabels = Object.fromEntries((profile?.strengths ?? []).map((s) => [s.key, s.label]));

  // Open on Nigeria while it has work left; otherwise Global. A ?lane= link always wins.
  const lane: Lane = requested ?? (lanes && lanes.nigeria.remaining.length > 0 ? "nigeria" : "global");
  const view = lanes?.[lane] ?? null;
  // Resume state for the lane's handful of roles — powers "Tailor resume" in the drawer.
  const resume = view ? await attachResumeInfo(view.remaining, session.user.id) : null;

  const left = (l: Lane) => lanes?.[l].remaining.length ?? 0;
  const of = (l: Lane) => lanes?.[l].total ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader title="Today" description="Today's picks — a fixed set, the best you have. No refills." />

      {/* Before the numbers, not after: a caveat that arrives below the figures it
          qualifies has already been missed. */}
      <CoverageBanner sourcesOk={lastRun?.sourcesOk ?? 0} sourcesTotal={lastRun?.sourcesTotal ?? 0} />

      <StatStrip
        items={[
          { label: "Nigeria left today", value: `${left("nigeria")} of ${of("nigeria")}` },
          { label: "Global left today", value: `${left("global")} of ${of("global")}` },
          { label: "Postings tracked", value: String(jobCount) },
        ]}
      />

      <FetchNow nextRun={nextRun} />

      {!view ? (
        <EmptyState
          icon={<InboxIcon className="size-7" strokeWidth={1.5} />}
          title="Nothing to review right now"
          description={`The next run is at ${nextRun}. New matches will appear here, best fit first.`}
        />
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <nav className="bg-muted/60 flex items-center gap-0.5 rounded-lg p-0.5" aria-label="Today's lists">
              {LANES.map((l) => (
                <Link
                  key={l}
                  href={`/today?lane=${l}`}
                  aria-current={l === lane ? "page" : undefined}
                  className={cn(
                    "focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                    l === lane ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {LANE_LABELS[l]}
                  <span className="text-muted-foreground text-xs tabular-nums">{left(l)} left</span>
                </Link>
              ))}
            </nav>
            <Link
              href="/matches"
              className="text-primary-ink focus-visible:ring-ring rounded text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              All {counts.total} matches
            </Link>
          </div>

          {view.total === 0 ? (
            <EmptyState
              icon={<InboxIcon className="size-7" strokeWidth={1.5} />}
              title={lane === "nigeria" ? "No Nigerian role cleared the bar today" : "Nothing cleared the bar today"}
              description={
                lane === "nigeria"
                  ? "Only strong and possible fits make the list, and Atlas reads few Nigerian employers' boards yet. Nothing is padded in to fill the slots."
                  : `The next run is at ${nextRun}. New matches will appear here, best fit first.`
              }
            />
          ) : (
            <DailyQueue
              // Remount per lane so optimistic progress never leaks between tabs.
              key={lane}
              matches={resume?.rows ?? view.remaining}
              strengthLabels={strengthLabels}
              lane={lane}
              done={view.done}
              total={view.total}
              nextRun={nextRun}
              resumeReady={resume?.ready ?? false}
            />
          )}
        </section>
      )}
    </div>
  );
}
