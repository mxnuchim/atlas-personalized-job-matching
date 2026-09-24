import type { Metadata } from "next";
import { ActivityIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Runs",
};

export default function RunsPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Runs" description="Every pipeline run — counts, cost, and errors." />

      <EmptyState
        icon={<ActivityIcon className="size-7" strokeWidth={1.5} />}
        title="No runs recorded yet"
        description="Each scheduled run logs what it saw, scored, and drafted, along with tokens and cost — your audit trail once the pipeline is live."
      />
    </div>
  );
}
