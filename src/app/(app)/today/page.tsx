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
import { countJobs } from "@/db/queries/jobs";
import { getCurrentProfile } from "@/db/queries/profile";
import { getLastFinishedRun } from "@/db/queries/runs";
import { env } from "@/lib/env";
import { nextRunLabel } from "@/lib/schedule";

export const metadata: Metadata = {
  title: "Today",
};

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const [counts, queue, waiting, jobCount, profile, lastRun] = await Promise.all([
    getMatchCounts(),
    listDailyQueue(env.DAILY_QUEUE_SIZE, env.MAX_PER_COMPANY),
    countDailyQueue(),
    countJobs(),
    getCurrentProfile(),
    getLastFinishedRun(),
  ]);

  const nextRun = nextRunLabel(new Date(), env.TZ);
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

          <DailyQueue matches={queue} strengthLabels={strengthLabels} waiting={waiting} />
        </section>
      )}
    </div>
  );
}
