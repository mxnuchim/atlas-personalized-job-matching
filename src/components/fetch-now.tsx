"use client";

import { useTransition } from "react";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { fetchNowAction } from "@/app/(app)/today/actions";
import { cn } from "@/lib/utils";

/**
 * Run the pipeline now rather than waiting for tomorrow.
 *
 * Says how long it takes before you press it, because scoring is genuinely slow and a
 * button that looks instant and is not reads as broken.
 */
export function FetchNow({ nextRun }: { nextRun: string }) {
  const [pending, startTransition] = useTransition();

  function fetchNow() {
    startTransition(async () => {
      const result = await fetchNowAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.scored > 0
          ? `${result.scored} scored, ${result.strong} strong, ${result.newJobs} new postings.`
          : `${result.newJobs} new postings. Nothing new to score.`,
      );
    });
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={fetchNow}
        disabled={pending}
        className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
      >
        <RefreshCwIcon
          className={cn("size-4", pending && "animate-spin motion-reduce:animate-none")}
        />
        {pending ? "Fetching…" : "Fetch now"}
      </button>
      <span className="text-muted-foreground text-xs">
        {pending ? "A few minutes — scoring is the slow part." : `Next automatic run ${nextRun}`}
      </span>
    </div>
  );
}
