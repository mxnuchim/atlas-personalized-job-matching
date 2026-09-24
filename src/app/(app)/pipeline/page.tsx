import type { Metadata } from "next";
import { GitBranchIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Pipeline",
};

export default function PipelinePage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Pipeline" description="Roles you've reached out to, tracked to outcome." />

      <EmptyState
        icon={<GitBranchIcon className="size-7" strokeWidth={1.5} />}
        title="Nothing in the pipeline"
        description="Approved outreach moves through drafted → sent → replied → interview here. Replies visibly halt any further chasing."
      />
    </div>
  );
}
