import Link from "next/link";
import { AlertTriangleIcon } from "lucide-react";

/**
 * Says when a run did not see the whole market.
 *
 * This exists because of the failure it prevents: a run that loses a third of its
 * boards to network errors produces fewer matches, and fewer matches is exactly what
 * a genuinely quiet day looks like. Without this the two are indistinguishable, and
 * the wrong one is silent.
 *
 * Renders nothing when coverage was complete — a banner that is always there stops
 * being read.
 */
export function CoverageBanner({
  sourcesOk,
  sourcesTotal,
}: {
  sourcesOk: number;
  sourcesTotal: number;
}) {
  // No run has recorded coverage yet; absence of data is not a warning.
  if (sourcesTotal === 0) return null;
  if (sourcesOk >= sourcesTotal) return null;

  const failed = sourcesTotal - sourcesOk;
  const total = sourcesOk === 0;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl px-4 py-3 ring-1 ring-inset"
      style={{
        color: `var(${total ? "--destructive" : "--tier-possible-ink"})`,
        backgroundColor: `color-mix(in oklab, var(${total ? "--destructive" : "--tier-possible"}) 10%, transparent)`,
        // @ts-expect-error — custom property for the ring utility.
        "--tw-ring-color": `color-mix(in oklab, var(${total ? "--destructive" : "--tier-possible"}) 28%, transparent)`,
      }}
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
      <div className="min-w-0 text-sm">
        <p className="font-medium">
          {total
            ? "The last run reached none of your sources."
            : `The last run reached ${sourcesOk} of ${sourcesTotal} sources.`}
        </p>
        <p className="mt-0.5 opacity-90">
          {failed} {failed === 1 ? "board" : "boards"} did not answer, so today&rsquo;s matches are
          drawn from an incomplete picture.{" "}
          <Link href="/runs" className="underline underline-offset-2">
            See which
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
