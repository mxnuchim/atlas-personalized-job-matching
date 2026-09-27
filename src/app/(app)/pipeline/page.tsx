import type { Metadata } from "next";
import { GitBranchIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PipelineTracker } from "@/components/pipeline-tracker";
import { getFunnelCounts, listPipeline } from "@/db/queries/outreach";
import { FUNNEL_ORDER, STAGE_LABEL, STAGE_TOKEN } from "@/lib/outreach";

export const metadata: Metadata = {
  title: "Pipeline",
};

export const dynamic = "force-dynamic";

/** Server-rendered shell; the rows are a client island because they change stage. */
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
          description="Roles appear here once a draft is written. Replies move them along — and stop Atlas chasing."
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

          <PipelineTracker rows={rows} />
        </>
      )}
    </div>
  );
}
