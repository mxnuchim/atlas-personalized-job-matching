import type { Metadata } from "next";
import { GitBranchIcon, HandIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { FitGauge } from "@/components/fit-gauge";
import { PageHeader } from "@/components/page-header";
import { TierChip } from "@/components/tier-chip";
import { FUNNEL_ORDER, getFunnelCounts, listPipeline } from "@/db/queries/outreach";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pipeline",
};

export const dynamic = "force-dynamic";

/** Where each stage sits: progress, a stop, or an ending. */
const STAGE_TOKEN: Record<(typeof FUNNEL_ORDER)[number], string> = {
  drafted: "--tier-stretch",
  sent: "--primary",
  bounced: "--destructive",
  replied: "--tier-strong",
  interview: "--tier-strong",
  offer: "--tier-strong",
  rejected: "--tier-stretch",
  closed: "--tier-stretch",
};

const STAGE_LABEL: Record<(typeof FUNNEL_ORDER)[number], string> = {
  drafted: "Drafted",
  sent: "Sent",
  bounced: "Bounced",
  replied: "Replied",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  closed: "Closed",
};

export default async function PipelinePage() {
  const [rows, counts] = await Promise.all([listPipeline(), getFunnelCounts()]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Pipeline"
        description={
          total > 0
            ? `${total} roles in flight. A reply stops all further contact.`
            : "Every role you've reached out to, and where it stands."
        }
      />

      {total === 0 ? (
        <EmptyState
          icon={<GitBranchIcon className="size-7" strokeWidth={1.5} />}
          title="Nothing in the pipeline yet"
          description="Roles appear here once outreach is sent. Replies move them along — and stop Atlas chasing."
        />
      ) : (
        <>
          <ol className="divide-border grid grid-cols-2 overflow-hidden rounded-xl border sm:grid-cols-4 lg:grid-cols-8">
            {FUNNEL_ORDER.map((stage) => (
              <li key={stage} className="border-r border-b px-4 py-3 last:border-r-0">
                <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: `var(${STAGE_TOKEN[stage]})` }}
                  />
                  {STAGE_LABEL[stage]}
                </span>
                <span className="font-display mt-0.5 block text-xl tabular-nums">
                  {counts[stage]}
                </span>
              </li>
            ))}
          </ol>

          <ul className="divide-border overflow-hidden rounded-xl border">
            {rows.map((row) => {
              // §11 made visible: once they reply, Atlas stops.
              const halted = row.status === "replied";

              return (
                <li
                  key={row.id}
                  className="flex items-center gap-4 border-b px-5 py-3 last:border-b-0"
                >
                  <FitGauge value={row.overall} tier={row.tier} size="sm" />

                  <div className="min-w-0 flex-1">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="focus-visible:ring-ring block truncate rounded text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {row.title}
                    </a>
                    <p className="text-muted-foreground truncate text-xs">
                      {row.company}
                      {row.recipient ? ` · ${row.recipient}` : ""}
                    </p>
                  </div>

                  {halted && (
                    <span className="text-tier-strong hidden items-center gap-1.5 text-xs sm:flex">
                      <HandIcon className="size-3.5" />
                      Chasing stopped
                    </span>
                  )}

                  <span className="text-muted-foreground hidden text-xs tabular-nums md:block">
                    {row.repliedAtLabel ?? row.sentAtLabel ?? "—"}
                  </span>

                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                    )}
                    style={{
                      color: `var(${STAGE_TOKEN[row.status]})`,
                      backgroundColor: `color-mix(in oklab, var(${STAGE_TOKEN[row.status]}) 12%, transparent)`,
                      // @ts-expect-error — custom property for the ring utility.
                      "--tw-ring-color": `color-mix(in oklab, var(${STAGE_TOKEN[row.status]}) 28%, transparent)`,
                    }}
                  >
                    {STAGE_LABEL[row.status]}
                  </span>

                  <TierChip tier={row.tier} className="hidden lg:inline-flex" />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
