import { PageHeader } from "@/components/page-header";

/**
 * Skeleton, not a spinner (PRD §10.4), matching the table's real geometry so the
 * page does not shift when the rows land.
 */
export default function MatchesLoading() {
  return (
    <div className="space-y-8">
      <PageHeader title="Matches" description="Every scored role, anchored by its fit." />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-muted h-9 w-full animate-pulse rounded-lg sm:max-w-xs" />
          <div className="bg-muted h-9 w-56 animate-pulse rounded-lg" />
        </div>

        <div className="overflow-hidden rounded-xl border">
          <div className="bg-muted/40 h-10 border-b" />
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b px-5 py-2.5 last:border-b-0">
              <div className="bg-muted size-11 shrink-0 animate-pulse rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="bg-muted h-3.5 w-1/2 animate-pulse rounded" />
                <div className="bg-muted h-3 w-1/4 animate-pulse rounded md:hidden" />
              </div>
              <div className="bg-muted hidden h-3.5 w-24 animate-pulse rounded md:block" />
              <div className="bg-muted hidden h-5 w-16 animate-pulse rounded-md sm:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
