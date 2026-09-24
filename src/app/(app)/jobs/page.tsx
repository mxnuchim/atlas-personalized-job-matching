import type { Metadata } from "next";
import { InboxIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { listJobs } from "@/db/queries/jobs";

export const metadata: Metadata = {
  title: "Jobs",
};

// Always reflect the current table — a pipeline run should show up on refresh.
export const dynamic = "force-dynamic";

const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

export default async function JobsPage() {
  const jobs = await listJobs();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Jobs"
        description={
          jobs.length > 0
            ? `Every posting Atlas has ingested — ${jobs.length} shown, newest first.`
            : "Every posting Atlas has ingested, before scoring."
        }
      />

      {jobs.length === 0 ? (
        <EmptyState
          icon={<InboxIcon className="size-7" strokeWidth={1.5} />}
          title="No jobs ingested yet"
          description="Trigger the pipeline to pull postings from your enabled sources. They'll land here, then flow on to scoring."
        />
      ) : (
        <ul className="divide-border divide-y overflow-hidden rounded-xl border">
          {jobs.map((job) => (
            <li
              key={job.id}
              className="hover:bg-secondary/40 flex flex-col gap-1 px-4 py-3.5 transition-colors sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <a
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium hover:underline"
                >
                  {job.title}
                </a>
                <div className="text-muted-foreground truncate text-sm">
                  {job.company}
                  {job.location ? ` · ${job.location}` : ""}
                  {job.remote ? " · Remote" : ""}
                </div>
              </div>
              <time
                dateTime={job.firstSeenAt.toISOString()}
                className="text-muted-foreground shrink-0 text-xs tabular-nums"
              >
                {dateFormat.format(job.firstSeenAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
