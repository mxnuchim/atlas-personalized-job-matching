import { cn } from "@/lib/utils";
import { type FitTier, TIER_LABELS } from "@/lib/scoring";

/**
 * The tier read-out. Colour comes from the semantic `--tier-*` tokens, which are
 * the only place a tier colour is defined and are already tuned for both themes —
 * never a raw palette class.
 *
 * `color-mix` gives the tint and ring from that one token, so a tier can be
 * re-coloured in `globals.css` alone.
 *
 * The label uses the `-ink` variant: this is small text sitting on a 12% tint of its
 * own colour, which needs 4.5:1. The vivid token measured 2.6–3.0:1 there — legible
 * enough to look fine and not actually accessible. The tint and ring stay vivid; they
 * are graphics, judged at 3:1.
 */
export function TierChip({ tier, className }: { tier: FitTier; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
        className,
      )}
      style={{
        color: `var(--tier-${tier}-ink)`,
        backgroundColor: `color-mix(in oklab, var(--tier-${tier}) 12%, transparent)`,
        // @ts-expect-error — custom property for the Tailwind ring utility.
        "--tw-ring-color": `color-mix(in oklab, var(--tier-${tier}) 28%, transparent)`,
      }}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}
