import type { Metadata } from "next";
import Link from "next/link";
import { InboxIcon } from "lucide-react";

import { CoverageBanner } from "@/components/coverage-banner";
import { DailyQueue } from "@/components/daily-queue";
import { FetchNow } from "@/components/fetch-now";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatStrip } from "@/components/stat-strip";
import { todaysPicks } from "@/db/queries/daily";
import { getMatchCounts } from "@/db/queries/matches";
import { attachResumeInfo } from "@/db/queries/resumes";
import { countJobs } from "@/db/queries/jobs";
import { getLastFinishedRun } from "@/db/queries/runs";
import { env } from "@/lib/env";
import { nextRunLabel } from "@/lib/schedule";
import { requireProfile } from "@/lib/session";

export const metadata: Metadata = {
  title: "Today",
};

export const dynamic = "force-dynamic";

/**
 * Today: one fixed list, chosen once each morning. It never refills; finishing a role is
 * progress, and when the list is done it says so until the next run brings a new set
 * (see `daily_picks`).
 */
export default async function TodayPage() {
  // Everything on this page is scoped to the signed-in user's profile. A new account
  // has none until it is seeded, which is an empty state rather than an error.
  const { session, profile } = await requireProfile();

  const [counts, view, jobCount, lastRun] = await Promise.all([
    profile ? getMatchCounts(profile.id) : { total: 0, strong: 0, possible: 0, scoredToday: 0 },
    profile ? todaysPicks(profile.id) : null,
    countJobs(),
    getLastFinishedRun(),
  ]);

  const nextRun = nextRunLabel(new Date(), env.APP_TZ);
  const strengthLabels = Object.fromEntries((profile?.strengths ?? []).map((s) => [s.key, s.label]));

  // Resume state for the day's handful of roles — powers "Tailor resume" in the drawer.
  const resume = view ? await attachResumeInfo(view.remaining, session.user.id) : null;
  const left = view?.remaining.length ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader title="Today" description="Today's picks — a fixed set, the best you have. No refills." />

      {/* Before the numbers, not after: a caveat that arrives below the figures it
          qualifies has already been missed. */}
      <CoverageBanner sourcesOk={lastRun?.sourcesOk ?? 0} sourcesTotal={lastRun?.sourcesTotal ?? 0} />

      <StatStrip
        items={[
          { label: "Left today", value: `${left} of ${view?.total ?? 0}` },
          { label: "Strong matches", value: String(counts.strong) },
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
            <h2 className="text-sm font-medium">Today&rsquo;s picks</h2>
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
              title="Nothing cleared the bar today"
              description={`Only roles you can realistically get make the list — strong or possible fits that also clear role, seniority and location fit. The next run is at ${nextRun}.`}
            />
          ) : (
            <DailyQueue
              matches={resume?.rows ?? view.remaining}
              strengthLabels={strengthLabels}
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
