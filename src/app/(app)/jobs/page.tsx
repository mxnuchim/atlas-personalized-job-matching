import type { Metadata } from "next";
import Link from "next/link";
import { InboxIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import {
  countJobsByFreshness,
  FRESHNESS_WINDOWS,
  listJobsPage,
  parseFreshness,
  type FreshnessKey,
} from "@/db/queries/jobs";
import { isStale, relativeAge } from "@/lib/age";
import { parsePageParams } from "@/lib/pagination";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Jobs",
};

// Always reflect the current table — a pipeline run should show up on refresh.
export const dynamic = "force-dynamic";

const WINDOW_KEYS = Object.keys(FRESHNESS_WINDOWS) as FreshnessKey[];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string; page?: string; pageSize?: string }>;
}) {
  const sp = await searchParams;
  const window = parseFreshness(sp.window);
  const { page, pageSize } = parsePageParams(sp);
  const [jobsPage, counts] = await Promise.all([
    listJobsPage(window, { page, pageSize }),
    countJobsByFreshness(),
  ]);
  const jobs = jobsPage.items;

  const now = new Date();
  const label = FRESHNESS_WINDOWS[window].label.toLowerCase();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Jobs"
        description={
          // A board returns every open requisition, not new ones, so the count only
          // means something once the window it covers is stated alongside it. The pager
          // below carries the "X–Y of N" detail, so the header just frames the window.
          counts[window] === 0
            ? `Every posting Atlas has ingested, before scoring.`
            : window === "all"
              ? `${counts.all} ingested, newest posting first.`
              : `${counts[window]} posted in the last ${label}, newest first.`
        }
      />

      <nav aria-label="Posting age" className="flex flex-wrap gap-1.5">
        {WINDOW_KEYS.map((key) => {
          const active = key === window;
          return (
            <Link
              key={key}
              href={`/jobs?window=${key}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none",
                active
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              {FRESHNESS_WINDOWS[key].label}
              <span className={cn("tabular-nums", active ? "opacity-80" : "opacity-60")}>
                {counts[key]}
              </span>
            </Link>
          );
        })}
      </nav>

      {jobs.length === 0 ? (
        <EmptyState
          icon={<InboxIcon className="size-7" strokeWidth={1.5} />}
          title={`Nothing posted in the last ${label}`}
          description={
            counts.all > 0
              ? "Widen the window above, or trigger a pipeline run to pull the latest postings."
              : "Trigger the pipeline to pull postings from your enabled sources. They'll land here, then flow on to scoring."
          }
        />
      ) : (
        <ul className="divide-border divide-y overflow-hidden rounded-xl border">
          {jobs.map((job) => {
            const age = relativeAge(job.postedAt, now);
            const evergreen = isStale(job.postedAt, 180, now);

            return (
              <li
                key={job.id}
                className="hover:bg-secondary/40 flex flex-col gap-1 px-4 py-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="min-w-0">
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="focus-visible:ring-ring rounded font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                  >
                    {job.title}
                  </a>
                  <div className="text-muted-foreground truncate text-sm">
                    {job.company}
                    {job.location ? ` · ${job.location}` : ""}
                    {job.remote ? " · Remote" : ""}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {/* An always-open requisition is not an opportunity that appeared. */}
                  {evergreen && (
                    <span className="text-muted-foreground rounded-md px-1.5 py-0.5 text-[0.6875rem] ring-1 ring-current/25 ring-inset">
                      Long open
                    </span>
                  )}
                  {job.postedAt ? (
                    <time
                      dateTime={job.postedAt.toISOString()}
                      className="text-muted-foreground text-xs tabular-nums"
                    >
                      {age}
                    </time>
                  ) : (
                    <span className="text-muted-foreground text-xs">No date</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        page={jobsPage.page}
        totalPages={jobsPage.totalPages}
        total={jobsPage.total}
        from={jobsPage.from}
        to={jobsPage.to}
      />
    </div>
  );
}
