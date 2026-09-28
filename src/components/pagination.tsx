"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A URL-driven pager. Reads/writes `?page=` while preserving every other query param
 * (filters, sort, search), so it composes with any list. Links are real `<a>`s, so Next
 * prefetches the neighbouring pages and navigation feels instant.
 */
export function Pagination({
  page,
  totalPages,
  total,
  from,
  to,
  className,
}: {
  page: number;
  totalPages: number;
  total: number;
  from: number;
  to: number;
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (total === 0) return null;

  const hrefFor = (target: number) => {
    const sp = new URLSearchParams(searchParams);
    if (target <= 1) sp.delete("page");
    else sp.set("page", String(target));
    const qs = sp.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex flex-wrap items-center justify-between gap-3", className)}
    >
      <p className="text-muted-foreground text-xs tabular-nums">
        {from}–{to} of {total}
      </p>

      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <Step href={hrefFor(page - 1)} disabled={page <= 1} label="Previous page">
            <ChevronLeftIcon className="size-4" />
          </Step>

          {pageWindow(page, totalPages).map((entry, i) =>
            entry === "gap" ? (
              <span key={`gap-${i}`} className="text-muted-foreground px-1 text-xs" aria-hidden>
                …
              </span>
            ) : (
              <PageNumber key={entry} href={hrefFor(entry)} value={entry} current={entry === page} />
            ),
          )}

          <Step href={hrefFor(page + 1)} disabled={page >= totalPages} label="Next page">
            <ChevronRightIcon className="size-4" />
          </Step>
        </div>
      )}
    </nav>
  );
}

const baseCell =
  "inline-flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm font-medium tabular-nums transition-colors duration-(--duration-fast) ease-(--ease-standard) focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none active:scale-[0.96]";

function PageNumber({ href, value, current }: { href: string; value: number; current: boolean }) {
  return (
    <Link
      href={href}
      aria-label={`Page ${value}`}
      aria-current={current ? "page" : undefined}
      className={cn(
        baseCell,
        current
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary",
      )}
    >
      {value}
    </Link>
  );
}

function Step({
  href,
  disabled,
  label,
  children,
}: {
  href: string;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span aria-hidden className={cn(baseCell, "text-muted-foreground/40")}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(baseCell, "text-muted-foreground hover:text-foreground hover:bg-secondary")}
    >
      {children}
    </Link>
  );
}

/** First, last, current ±1, with gaps — a compact window that never jumps width much. */
function pageWindow(current: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const keep = new Set([1, total, current, current - 1, current + 1]);
  const shown = [...keep].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);

  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const p of shown) {
    if (p - prev > 1) out.push("gap");
    out.push(p);
    prev = p;
  }
  return out;
}
