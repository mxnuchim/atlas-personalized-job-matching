import type { Metadata } from "next";
import { TargetIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { MatchesTable } from "@/components/matches-table";
import { PageHeader } from "@/components/page-header";
import { getMatchCounts, listMatchRowsPage, type MatchSort } from "@/db/queries/matches";
import { parsePageParams } from "@/lib/pagination";
import type { FitTier } from "@/lib/scoring";
import { requireProfile } from "@/lib/session";

export const metadata: Metadata = {
  title: "Matches",
};

export const dynamic = "force-dynamic";

const MATCH_SORTS: MatchSort[] = ["overall", "title", "company", "location", "postedAt"];

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseTier(value: string | undefined): FitTier | undefined {
  return value === "strong" || value === "possible" || value === "stretch" ? value : undefined;
}

function parseSort(value: string | undefined): MatchSort {
  return MATCH_SORTS.includes(value as MatchSort) ? (value as MatchSort) : "overall";
}

function parseDir(value: string | undefined): "asc" | "desc" {
  return value === "asc" ? "asc" : "desc";
}

/**
 * Server-rendered shell. Tier, search, sort and page come from the URL and are resolved
 * in SQL (the list runs to thousands of rows), so a link is shareable and the back button
 * works. The table itself stays a client island for keyboard nav and the drawer.
 */
export default async function MatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile } = await requireProfile();

  const sp = await searchParams;
  const { page, pageSize } = parsePageParams(sp);
  const tier = parseTier(one(sp.tier));
  const q = (one(sp.q) ?? "").trim();
  const sort = parseSort(one(sp.sort));
  const dir = parseDir(one(sp.dir));

  const [pageData, counts] = profile
    ? await Promise.all([
        listMatchRowsPage(profile.id, { page, pageSize, tier, q: q || undefined, sort, dir }),
        getMatchCounts(profile.id),
      ])
    : [null, { total: 0, strong: 0, possible: 0, scoredToday: 0 }];

  const strengthLabels = Object.fromEntries(
    (profile?.strengths ?? []).map((s) => [s.key, s.label]),
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Matches"
        description={
          counts.total > 0
            ? `${counts.total} scored · ${counts.strong} strong, best fit first.`
            : "Every scored role, anchored by its fit."
        }
      />

      {!pageData || counts.total === 0 ? (
        <EmptyState
          icon={<TargetIcon className="size-7" strokeWidth={1.5} />}
          title="No matches yet"
          description="Once a run scores new postings against your strengths, they'll list here with their fit score and the strengths each role rewards."
        />
      ) : (
        <MatchesTable
          page={pageData}
          strengthLabels={strengthLabels}
          tier={tier ?? "all"}
          q={q}
          sort={sort}
          dir={dir}
        />
      )}
    </div>
  );
}
