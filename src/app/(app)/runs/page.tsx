import type { Metadata } from "next";
import { ActivityIcon, AlertTriangleIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { listRuns } from "@/db/queries/runs";
import { env } from "@/lib/env";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Runs",
};

export const dynamic = "force-dynamic";

/** Statuses carry the tier palette's semantics: green good, amber caveat, grey inert. */
const STATUS_TOKEN = {
  ok: "--tier-strong",
  partial: "--tier-possible",
  failed: "--destructive",
} as const;

export default async function RunsPage() {
  const runs = await listRuns();

  const timeFormat = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: env.APP_TZ,
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Runs"
        description={
          runs.length > 0
            ? `${runs.length} recorded. Counts, tokens, cost and every error.`
            : "Every pipeline run, with what it cost and what went wrong."
        }
      />

      {runs.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon className="size-7" strokeWidth={1.5} />}
          title="No runs yet"
          description="Each pipeline run records what it saw, scored, drafted and spent — and any job that failed along the way."
        />
      ) : (
        <ul className="divide-border overflow-hidden rounded-xl border">
          {runs.map((run) => {
            // An open row means the run never finished — a crash or a timeout. That is
            // exactly why the row is written before the work starts.
            const unfinished = run.finishedAt === null;
            const cost = Number(run.costUsd);

            return (
              <li key={run.id} className="space-y-3 border-b p-5 last:border-b-0">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span
                    className="inline-flex items-center gap-1.5 text-sm font-medium"
                    style={{
                      color: `var(${unfinished ? "--tier-possible" : STATUS_TOKEN[run.status]})`,
                    }}
                  >
                    <span
                      aria-hidden
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: "currentColor" }}
                    />
                    {unfinished ? "Unfinished" : run.status}
                  </span>
                  <time
                    dateTime={run.startedAt.toISOString()}
                    className="text-muted-foreground text-sm tabular-nums"
                  >
                    {timeFormat.format(run.startedAt)}
                  </time>
                  {run.finishedAt && (
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {Math.round((run.finishedAt.getTime() - run.startedAt.getTime()) / 1000)}s
                    </span>
                  )}
                </div>

                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-7">
                  {/* First, because every other number on this row is bounded by it:
                      a run that reached half its boards saw half the market. */}
                  <Stat
                    label="Sources"
                    value={run.sourcesTotal > 0 ? `${run.sourcesOk}/${run.sourcesTotal}` : "—"}
                    alert={run.sourcesTotal > 0 && run.sourcesOk < run.sourcesTotal}
                  />
                  <Stat label="Seen" value={run.jobsSeen} />
                  <Stat label="New" value={run.newJobs} />
                  <Stat label="Scored" value={run.scored} />
                  <Stat label="Drafted" value={run.drafted} />
                  <Stat label="Tokens" value={run.tokensIn + run.tokensOut} />
                  <Stat
                    label="Cost"
                    value={cost > 0 ? `$${cost.toFixed(4)}` : cost === 0 ? "$0" : "—"}
                  />
                </dl>

                {run.errors.length > 0 && (
                  <ul className="space-y-1">
                    {run.errors.map((error, i) => (
                      <li
                        key={`${error.stage}-${i}`}
                        className="text-muted-foreground flex gap-2 text-xs"
                      >
                        <AlertTriangleIcon className="text-destructive mt-0.5 size-3 shrink-0" />
                        <span className="text-pretty">
                          <span className="text-foreground">{error.stage}</span> — {error.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: number | string;
  /** Colours the figure when it is the thing that went wrong, not just a number. */
  alert?: boolean;
}) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn("text-sm tabular-nums", alert && "text-destructive font-medium")}>
        {value}
      </dd>
    </div>
  );
}
