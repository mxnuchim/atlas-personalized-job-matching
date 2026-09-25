import type { Metadata } from "next";
import { TargetIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { MatchCard } from "@/components/match-card";
import { PageHeader } from "@/components/page-header";
import { getCurrentProfile } from "@/db/queries/profile";
import { listMatches } from "@/db/queries/matches";

export const metadata: Metadata = {
  title: "Matches",
};

export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const [matches, profile] = await Promise.all([listMatches(), getCurrentProfile()]);
  const strengthLabels = Object.fromEntries(
    (profile?.strengths ?? []).map((s) => [s.key, s.label]),
  );

  const strong = matches.filter((m) => m.tier === "strong").length;
  const description =
    matches.length > 0
      ? `${matches.length} scored · ${strong} strong, best fit first.`
      : "Every scored role, anchored by its fit.";

  return (
    <div className="space-y-8">
      <PageHeader title="Matches" description={description} />

      {matches.length === 0 ? (
        <EmptyState
          icon={<TargetIcon className="size-7" strokeWidth={1.5} />}
          title="No matches yet"
          description="Once a run scores new postings against your strengths, they'll list here with their fit score and the strengths each role rewards."
        />
      ) : (
        <div className="space-y-4">
          {matches.map((match) => (
            <MatchCard key={match.id} match={match} strengthLabels={strengthLabels} />
          ))}
        </div>
      )}
    </div>
  );
}
