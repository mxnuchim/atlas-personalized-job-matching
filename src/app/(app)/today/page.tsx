import type { Metadata } from "next";
import Link from "next/link";
import { InboxIcon } from "lucide-react";

import { CoverageBanner } from "@/components/coverage-banner";
import { EmptyState } from "@/components/empty-state";
import { MatchCard } from "@/components/match-card";
import { PageHeader } from "@/components/page-header";
import { StatStrip } from "@/components/stat-strip";
import { getMatchCounts, listMatchRows } from "@/db/queries/matches";
import { countJobs } from "@/db/queries/jobs";
import { getCurrentProfile } from "@/db/queries/profile";
import { getLastFinishedRun } from "@/db/queries/runs";
import { env } from "@/lib/env";
import { nextRunLabel } from "@/lib/schedule";

export const metadata: Metadata = {
  title: "Today",
};

export const dynamic = "force-dynamic";

/** How many top matches the day's shortlist shows before sending you to the table. */
const SHORTLIST = 4;

export default async function TodayPage() {
  const [counts, top, jobCount, profile, lastRun] = await Promise.all([
    getMatchCounts(),
    listMatchRows(SHORTLIST),
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
          { label: "Scored today", value: String(counts.scoredToday) },
          { label: "Strong matches", value: String(counts.strong) },
          { label: "Postings tracked", value: String(jobCount) },
        ]}
      />

      {top.length === 0 ? (
        <EmptyState
          icon={<InboxIcon className="size-7" strokeWidth={1.5} />}
          title="Nothing to review right now"
          description={`The next run is at ${nextRun}. New matches and their drafts will appear here, ready to approve.`}
        />
      ) : (
        <section className="space-y-4">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-display text-base font-semibold">Best fits</h2>
            <Link
              href="/matches"
              className="text-primary-ink focus-visible:ring-ring rounded text-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
            >
              All {counts.total} matches
            </Link>
          </div>

          {top.map((match, index) => (
            <MatchCard key={match.id} match={match} strengthLabels={strengthLabels} index={index} />
          ))}
        </section>
      )}
    </div>
  );
}
