import { cn } from "@/lib/utils";

/**
 * Atlas mark — a two-summit range, for the mountains the product is named after. A solid
 * silhouette in `currentColor`, so it inherits intent (indigo in the brand, muted in the
 * footer). Deliberately not a star or sparkle.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-5", className)}
      fill="none"
      aria-hidden="true"
      role="img"
    >
      <path
        d="M2.6 19.2 8.3 7.4a1 1 0 0 1 1.77-.05l3.13 5.3 1.6-2.62a1 1 0 0 1 1.72.02l4.88 9.15a.6.6 0 0 1-.53.88H3.14a.6.6 0 0 1-.54-.86Z"
        fill="currentColor"
      />
    </svg>
  );
}
