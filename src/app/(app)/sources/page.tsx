import type { Metadata } from "next";
import { RadioTowerIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SourcesManager } from "@/components/sources-manager";
import { StatStrip } from "@/components/stat-strip";
import { listSourcesWithCounts } from "@/db/queries/sources";

export const metadata: Metadata = {
  title: "Sources",
};

export const dynamic = "force-dynamic";

/**
 * Where postings come from. This screen exists because output quality is bounded by
 * inputs: until it did, adding a board meant editing a catalogue file and re-seeding,
 * which is not a thing you do when you notice a gap on a Tuesday.
 */
export default async function SourcesPage() {
  const sources = await listSourcesWithCounts();

  const enabled = sources.filter((s) => s.enabled);
  const open = sources.reduce((total, s) => total + s.openCount, 0);
  // A board enabled but holding nothing is worth surfacing. The cause is genuinely
  // ambiguous from here — a wrong token, a board with no openings, or one whose
  // postings the relevance gate rejects — so the label says what is true and does not
  // guess which.
  const empty = enabled.filter((s) => s.jobCount === 0).length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sources"
        description="Every board Atlas reads. Company boards list only that company; aggregators are cross-company and mostly remote."
      />

      {sources.length === 0 ? (
        <EmptyState
          icon={<RadioTowerIcon className="size-7" strokeWidth={1.5} />}
          title="No sources yet"
          description="Add a board below, or run npm run db:seed:sources to load the verified catalogue."
        />
      ) : (
        <>
          <StatStrip
            items={[
              { label: "Enabled", value: `${enabled.length}/${sources.length}` },
              { label: "Open postings", value: String(open) },
              {
                label: "Holding nothing",
                value: String(empty),
                hint: empty > 0 ? "filtered out, or a wrong token" : undefined,
              },
            ]}
          />

          <SourcesManager sources={sources} />
        </>
      )}
    </div>
  );
}
