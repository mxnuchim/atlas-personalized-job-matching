import { PageHeader } from "@/components/page-header";

/** Skeleton matching the queue's real geometry, so nothing shifts when drafts land. */
export default function ReviewLoading() {
  return (
    <div className="space-y-8">
      <PageHeader title="Review" description="Drafts wait here for your decision." />
      <div className="bg-muted h-[88px] animate-pulse rounded-xl" />
      <div className="space-y-4">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-4 rounded-xl border p-5">
            <div className="flex items-start gap-4">
              <div className="bg-muted size-12 shrink-0 animate-pulse rounded-full sm:size-16" />
              <div className="flex-1 space-y-2">
                <div className="bg-muted h-4 w-2/5 animate-pulse rounded" />
                <div className="bg-muted h-3 w-1/4 animate-pulse rounded" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="bg-muted h-3 w-full animate-pulse rounded" />
              <div className="bg-muted h-3 w-full animate-pulse rounded" />
              <div className="bg-muted h-3 w-3/5 animate-pulse rounded" />
            </div>
            <div className="bg-muted h-8 w-40 animate-pulse rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}
