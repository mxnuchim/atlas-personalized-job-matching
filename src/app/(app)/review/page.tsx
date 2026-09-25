import type { Metadata } from "next";
import { MailCheckIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ReviewQueue } from "@/components/review-queue";
import { StatStrip } from "@/components/stat-strip";
import { countDraftsByStatus, listDrafts } from "@/db/queries/drafts";
import { getCurrentProfile } from "@/db/queries/profile";
import { env } from "@/lib/env";

export const metadata: Metadata = {
  title: "Review",
};

export const dynamic = "force-dynamic";

/** Server-rendered shell; the queue is a client island because it edits and decides. */
export default async function ReviewPage() {
  const [drafts, counts, profile] = await Promise.all([
    listDrafts("pending"),
    countDraftsByStatus(),
    getCurrentProfile(),
  ]);

  const strengthLabels = Object.fromEntries(
    (profile?.strengths ?? []).map((s) => [s.key, s.label]),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Review"
        description={
          drafts.length > 0
            ? `${drafts.length} awaiting your decision. Nothing sends without it.`
            : "Drafts wait here for your decision."
        }
      />

      <StatStrip
        items={[
          { label: "Pending", value: String(counts.pending) },
          { label: "Approved", value: String(counts.approved), hint: "not yet sent" },
          { label: "Skipped", value: String(counts.skipped) },
        ]}
      />

      {drafts.length === 0 ? (
        <EmptyState
          icon={<MailCheckIcon className="size-7" strokeWidth={1.5} />}
          title="Nothing to review"
          description="Strong matches get a draft on the next run. Each one builds on the strengths that role rewards and cites something real you've done."
        />
      ) : (
        <ReviewQueue
          drafts={drafts}
          strengthLabels={strengthLabels}
          dailyCap={env.DAILY_SEND_CAP}
        />
      )}
    </div>
  );
}
