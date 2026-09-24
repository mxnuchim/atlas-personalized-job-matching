import { cn } from "@/lib/utils";

/** Atlas mark — a four-point signal star. Uses currentColor so it inherits intent. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("size-5", className)}
      fill="none"
      aria-hidden="true"
      role="img"
    >
      <path d="M12 1.5 14.4 9.6 22.5 12 14.4 14.4 12 22.5 9.6 14.4 1.5 12 9.6 9.6Z" fill="currentColor" />
    </svg>
  );
}
