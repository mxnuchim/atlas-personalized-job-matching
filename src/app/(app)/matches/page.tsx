import type { Metadata } from "next";
import { TargetIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { MatchesTable } from "@/components/matches-table";
import { PageHeader } from "@/components/page-header";
import { listMatchRows } from "@/db/queries/matches";
import { requireProfile } from "@/lib/session";

export const metadata: Metadata = {
  title: "Matches",
};

export const dynamic = "force-dynamic";

/**
 * Server-rendered shell; the table itself is a client island because it is
 * keyboard-navigable and holds sort/filter/selection state (PRD §6).
 */
export default async function MatchesPage() {
  const { profile } = await requireProfile();
  const matches = profile ? await listMatchRows(profile.id) : [];

  const strengthLabels = Object.fromEntries(
    (profile?.strengths ?? []).map((s) => [s.key, s.label]),
  );
  const strong = matches.filter((m) => m.tier === "strong").length;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Matches"
        description={
          matches.length > 0
            ? `${matches.length} scored · ${strong} strong, best fit first.`
            : "Every scored role, anchored by its fit."
        }
      />

      {matches.length === 0 ? (
        <EmptyState
          icon={<TargetIcon className="size-7" strokeWidth={1.5} />}
          title="No matches yet"
          description="Once a run scores new postings against your strengths, they'll list here with their fit score and the strengths each role rewards."
        />
      ) : (
        <MatchesTable matches={matches} strengthLabels={strengthLabels} />
      )}
    </div>
  );
}
