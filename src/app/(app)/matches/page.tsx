import type { Metadata } from "next";
import { TargetIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = {
  title: "Matches",
};

export default function MatchesPage() {
  return (
    <div className="space-y-8">
      <PageHeader title="Matches" description="Every scored role, anchored by its fit." />

      <EmptyState
        icon={<TargetIcon className="size-7" strokeWidth={1.5} />}
        title="No matches yet"
        description="Once a run scores new postings against your strengths, they'll list here with their fit score and the strengths each role rewards."
      />
    </div>
  );
}
