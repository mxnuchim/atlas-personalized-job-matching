import { cn } from "@/lib/utils";

/**
 * Keyword coverage as a quiet bar — the same treatment as the drawer's strength meters,
 * because this is magnitude, not a verdict. Tier colours stay reserved for fit.
 */
export function CoverageMeter({
  matched,
  total,
  label,
  className,
}: {
  matched: number;
  total: number;
  label?: string;
  className?: string;
}) {
  const pct = total === 0 ? 0 : Math.round((matched / total) * 100);
  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label ?? "Must-have keywords"}</span>
        <span className="font-medium tabular-nums">
          {matched}/{total}
          <span className="text-muted-foreground ml-1.5 font-normal">{total === 0 ? "" : `${pct}%`}</span>
        </span>
      </div>
      <div
        className="bg-muted h-1.5 overflow-hidden rounded-full"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={matched}
        aria-label={label ?? "Must-have keywords covered"}
      >
        <div
          className="bg-primary/70 h-full rounded-full transition-[width] duration-(--duration-slow) ease-(--ease-emphasized)"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
