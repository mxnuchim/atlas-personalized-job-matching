import type { Metadata } from "next";
import Link from "next/link";
import { InboxIcon } from "lucide-react";

import { CoverageBanner } from "@/components/coverage-banner";
import { DailyQueue } from "@/components/daily-queue";
import { FetchNow } from "@/components/fetch-now";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatStrip } from "@/components/stat-strip";
import { countDailyQueue, getMatchCounts, listDailyQueue } from "@/db/queries/matches";
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

export default async function TodayPage() {
  // Everything on this page is scoped to the signed-in user's profile. A new account
  // has none until it is seeded, which is an empty state rather than an error.
  const { session, profile } = await requireProfile();

  const [counts, queue, waiting, jobCount, lastRun] = await Promise.all([
    profile ? getMatchCounts(profile.id) : { total: 0, strong: 0, possible: 0, scoredToday: 0 },
    profile ? listDailyQueue(profile.id, env.DAILY_QUEUE_SIZE, env.MAX_PER_COMPANY) : [],
    profile ? countDailyQueue(profile.id) : 0,
    countJobs(),
    getLastFinishedRun(),
  ]);

  // Resume state for the queue's handful of roles — powers "Tailor resume" in the drawer.
  const resume = await attachResumeInfo(queue, session.user.id);

  const nextRun = nextRunLabel(new Date(), env.APP_TZ);
  const strengthLabels = Object.fromEntries(
    (profile?.strengths ?? []).map((s) => [s.key, s.label]),
  );

  return (
    <div className="space-y-8">
      <PageHeader title="Today" description="Your day's queue at a glance." />

      {/* Before the numbers, not after: a caveat that arrives below the figures it
          qualifies has already been missed. */}
      <CoverageBanner
        sourcesOk={lastRun?.sourcesOk ?? 0}
        sourcesTotal={lastRun?.sourcesTotal ?? 0}
      />

      <StatStrip
        items={[
          { label: "In today's queue", value: String(queue.length) },
          { label: "Waiting behind it", value: String(Math.max(0, waiting - queue.length)) },
          { label: "Postings tracked", value: String(jobCount) },
        ]}
      />

      <FetchNow nextRun={nextRun} />

      {waiting === 0 && queue.length === 0 ? (
        <EmptyState
          icon={<InboxIcon className="size-7" strokeWidth={1.5} />}
          title="Nothing to review right now"
          description={`The next run is at ${nextRun}. New matches will appear here, best fit first.`}
        />
      ) : (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-base font-semibold">Today&rsquo;s queue</h2>
            <Link
              href="/matches"
              className="text-primary-ink focus-visible:ring-ring rounded text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              All {counts.total} matches
            </Link>
          </div>

          <DailyQueue
            matches={resume.rows}
            strengthLabels={strengthLabels}
            waiting={waiting}
            resumeReady={resume.ready}
          />
        </section>
      )}
    </div>
  );
}
