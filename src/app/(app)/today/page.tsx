import type { Metadata } from "next";
import { InboxIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatStrip } from "@/components/stat-strip";
import { env } from "@/lib/env";
import { nextRunLabel } from "@/lib/schedule";

export const metadata: Metadata = {
  title: "Today",
};

export default function TodayPage() {
  const nextRun = nextRunLabel(new Date(), env.TZ);

  return (
    <div className="space-y-8">
      <PageHeader title="Today" description="Your day's queue at a glance." />

      <StatStrip
        items={[
          { label: "New today", value: "0" },
          { label: "Strong matches", value: "0" },
          { label: "In pipeline", value: "0" },
        ]}
      />

      <EmptyState
        icon={<InboxIcon className="size-7" strokeWidth={1.5} />}
        title="Nothing to review right now"
        description={`The next run is at ${nextRun}. New matches and their drafts will appear here, ready to approve.`}
      />
    </div>
  );
}
