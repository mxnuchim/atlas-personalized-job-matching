"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon, ExternalLinkIcon, SearchIcon } from "lucide-react";

import { FitGauge } from "@/components/fit-gauge";
import { MatchDrawer } from "@/components/match-drawer";
import { Pagination } from "@/components/pagination";
import { TierChip } from "@/components/tier-chip";
import type { MatchRow, MatchSort } from "@/db/queries/matches";
import type { Paginated } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import { type FitTier, TIER_LABELS } from "@/lib/scoring";

/**
 * The console table (PRD §10.3), now URL-driven so it scales past one screen.
 *
 * Tier, search, sort and page all live in the query string and are resolved in SQL —
 * the list runs to thousands of rows, so it can't come to the client to be sliced.
 * Keyboard-first within a page: `j`/`k` move, `enter` opens the drawer, `/` jumps to
 * the filter, `escape` clears it. Each row also carries a direct Apply, so a strong
 * match is one click from its posting — the point of the page is to apply, fast.
 *
 * Follows the ARIA grid pattern with a roving tabindex — exactly one row is in the tab
 * order at a time, so Tab moves past the table rather than through every row.
 */

type SortDir = "asc" | "desc";

const TIER_FILTERS: (FitTier | "all")[] = ["all", "strong", "possible", "stretch"];

const COLUMNS: { key: MatchSort; label: string; className: string }[] = [
  { key: "overall", label: "Fit", className: "w-[84px] pl-5" },
  { key: "title", label: "Role", className: "min-w-0" },
  { key: "company", label: "Company", className: "hidden w-[150px] md:table-cell" },
  { key: "location", label: "Location", className: "hidden w-[160px] lg:table-cell" },
  // When the role was posted, not when Atlas scored it: the scoring date is an internal
  // detail, while how long a req has been open changes how you treat it.
  { key: "postedAt", label: "Posted", className: "hidden w-[88px] sm:table-cell" },
];

/** A key cap. Sans, not monospace — monospace labels are an anti-pattern here. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-muted text-foreground rounded border-b px-1.5 py-0.5 font-sans text-[0.6875rem] leading-none font-medium">
      {children}
    </kbd>
  );
}

/**
 * Keyword coverage for one row — free, from the lexicon, no model call. Neutral ink on
 * purpose: tier colours belong to fit, and this is a different question.
 */
function KeywordCell({ keywords }: { keywords: MatchRow["keywords"] }) {
  if (keywords === undefined) return null;
  if (keywords === null) {
    return (
      <span className="text-muted-foreground" title="Add your resume in Profile to see keyword coverage">
        —
      </span>
    );
  }
  if (keywords.total === 0) {
    return (
      <span className="text-muted-foreground" title="This posting names no technologies Atlas tracks">
        —
      </span>
    );
  }
  const strong = keywords.matched / keywords.total >= 0.8;
  return (
    <span
      className={strong ? "text-foreground font-medium" : "text-muted-foreground"}
      title={keywords.missing.length > 0 ? `Not on your resume: ${keywords.missing.join(", ")}` : "Your resume covers all of them"}
    >
      {keywords.matched}/{keywords.total}
    </span>
  );
}

export function MatchesTable({
  page,
  strengthLabels,
  tier,
  q,
  sort,
  dir,
  resumeReady = false,
}: {
  page: Paginated<MatchRow>;
  strengthLabels: Record<string, string>;
  /** Whether you have a resume on file — gates "Tailor resume" in the drawer. */
  resumeReady?: boolean;
  tier: FitTier | "all";
  q: string;
  sort: MatchSort;
  dir: SortDir;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rows = page.items;
  const [cursor, setCursor] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  /** Only move focus for keyboard navigation — never steal it on mount or when a page lands. */
  const shouldFocusRow = useRef(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived, not stored: a filter change can shrink the list under the cursor, and
  // clamping during render avoids the cascading re-render an effect would cause.
  const activeIndex = Math.min(cursor, Math.max(0, rows.length - 1));

  const pushParams = useCallback(
    (updates: Record<string, string | null>, resetPage = true) => {
      const sp = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(updates)) {
        if (!value) sp.delete(key);
        else sp.set(key, value);
      }
      // Any filter/sort/search change invalidates the page number — start over at 1.
      if (resetPage) sp.delete("page");
      const qs = sp.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  // Focus is genuinely external state, so this belongs in an effect — but only fires
  // when a keypress asked for it, never on mount or on a fresh page of results.
  useEffect(() => {
    if (!shouldFocusRow.current) return;
    shouldFocusRow.current = false;
    rowRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  // Page-level shortcuts. Deliberately inert while the drawer is open (its own focus
  // trap owns the keyboard) or while typing in a field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (openId) return;
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable;

      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape" && typing) {
        if (searchRef.current) searchRef.current.value = "";
        pushParams({ q: null });
        searchRef.current?.blur();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        shouldFocusRow.current = true;
        setCursor(Math.min(rows.length - 1, activeIndex + 1));
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        shouldFocusRow.current = true;
        setCursor(Math.max(0, activeIndex - 1));
      } else if (event.key === "Enter" && rows[activeIndex]) {
        event.preventDefault();
        setOpenId(rows[activeIndex].id);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openId, rows, activeIndex, pushParams]);

  // Debounce typing into the URL so every keystroke isn't a navigation.
  function onSearchChange(value: string) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => pushParams({ q: value.trim() || null }), 300);
  }

  function toggleSort(key: MatchSort) {
    const nextDir: SortDir =
      key === sort
        ? dir === "asc"
          ? "desc"
          : "asc"
        : // Scores and dates are most useful highest-first; names A–Z.
          key === "overall" || key === "postedAt"
          ? "desc"
          : "asc";
    pushParams({ sort: key, dir: nextDir });
  }

  const openMatch = rows.find((m) => m.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            // Remount when the URL's q changes (e.g. back button) so the field stays in
            // sync without a state-syncing effect.
            key={q}
            ref={searchRef}
            type="search"
            defaultValue={q}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Filter by role, company or location"
            aria-label="Filter matches"
            className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 h-9 w-full rounded-lg border py-2 pr-3 pl-9 text-sm transition-colors focus-visible:ring-3 focus-visible:outline-none"
          />
        </div>

        <div
          className="bg-muted/60 flex items-center gap-0.5 rounded-lg p-0.5"
          role="group"
          aria-label="Filter by tier"
        >
          {TIER_FILTERS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => pushParams({ tier: t === "all" ? null : t })}
              aria-pressed={tier === t}
              className={cn(
                "focus-visible:ring-ring rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                tier === t
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "all" ? "All" : TIER_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-xl border border-dashed px-5 py-10 text-center text-sm">
          Nothing matches those filters. Clear them to see all {page.total} scored roles.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full table-fixed border-collapse text-sm">
            <caption className="sr-only">
              Scored matches. Use j and k to move between rows, Enter to open one.
            </caption>
            <thead>
              <tr className="bg-muted/40 border-b">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={cn("py-2.5 text-left font-medium", col.className)}
                    aria-sort={
                      sort === col.key ? (dir === "asc" ? "ascending" : "descending") : "none"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {col.label}
                      {sort === col.key ? (
                        dir === "asc" ? (
                          <ArrowUpIcon className="size-3" />
                        ) : (
                          <ArrowDownIcon className="size-3" />
                        )
                      ) : null}
                    </button>
                  </th>
                ))}
                <th scope="col" className="hidden w-[84px] text-left font-medium xl:table-cell">
                  <span
                    className="text-muted-foreground"
                    title="Of the technologies this posting names, how many your resume can claim"
                  >
                    Keywords
                  </span>
                </th>
                <th scope="col" className="hidden w-[92px] text-left font-medium sm:table-cell">
                  <span className="text-muted-foreground">Tier</span>
                </th>
                <th scope="col" className="w-[52px] pr-4">
                  <span className="sr-only">Apply</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((match, index) => (
                <tr
                  key={match.id}
                  ref={(el) => {
                    rowRefs.current[index] = el;
                  }}
                  // Roving tabindex: exactly one row is in the tab order, so Tab steps
                  // past the table instead of through every row.
                  tabIndex={index === activeIndex ? 0 : -1}
                  onClick={() => {
                    setCursor(index);
                    setOpenId(match.id);
                  }}
                  onFocus={() => setCursor(index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOpenId(match.id);
                    }
                  }}
                  className={cn(
                    "focus-visible:ring-ring cursor-pointer border-b transition-colors last:border-b-0 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset",
                    "hover:bg-muted/40",
                    index === activeIndex && "bg-muted/30",
                  )}
                >
                  <td className="py-2.5 pl-5">
                    <FitGauge value={match.overall} tier={match.tier} size="sm" />
                  </td>
                  <td className="min-w-0 py-2.5 pr-3">
                    <span className="block truncate font-medium">{match.title}</span>
                    <span className="text-muted-foreground block truncate text-xs md:hidden">
                      {match.company}
                    </span>
                  </td>
                  <td className="hidden truncate py-2.5 pr-3 md:table-cell">{match.company}</td>
                  <td className="text-muted-foreground hidden truncate py-2.5 pr-3 lg:table-cell">
                    {match.location ?? (match.remote ? "Remote" : "—")}
                  </td>
                  <td className="text-muted-foreground hidden py-2.5 text-xs tabular-nums sm:table-cell">
                    {match.closed ? (
                      <span className="text-destructive">Closed</span>
                    ) : (
                      (match.postedAgeLabel ?? "—")
                    )}
                    {!match.closed && match.evergreen && (
                      <span className="ml-1 opacity-60" title="Open for over six months">
                        ·
                      </span>
                    )}
                  </td>
                  <td className="hidden py-2.5 text-xs tabular-nums xl:table-cell">
                    <KeywordCell keywords={match.keywords} />
                  </td>
                  <td className="hidden py-2.5 sm:table-cell">
                    <TierChip tier={match.tier} />
                  </td>
                  <td className="py-2.5 pr-4 text-right">
                    <a
                      href={match.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Apply to ${match.title} (opens the posting)`}
                      title="Apply — open the posting"
                      className="text-muted-foreground hover:text-primary-ink hover:bg-secondary focus-visible:ring-ring inline-flex rounded-md p-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <ExternalLinkIcon className="size-4" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        page={page.page}
        totalPages={page.totalPages}
        total={page.total}
        from={page.from}
        to={page.to}
      />

      <p className="text-muted-foreground flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
        <Key>j</Key>
        <Key>k</Key>
        <span>move</span>
        <span aria-hidden className="opacity-40">
          ·
        </span>
        <Key>enter</Key>
        <span>open</span>
        <span aria-hidden className="opacity-40">
          ·
        </span>
        <Key>/</Key>
        <span>filter</span>
      </p>

      <MatchDrawer
        match={openMatch}
        strengthLabels={strengthLabels}
        resumeReady={resumeReady}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        // Radix owns focus on close, so the restore has to happen in its own hook —
        // calling focus() from onOpenChange runs too early and Radix overwrites it.
        onCloseFocus={() => rowRefs.current[activeIndex]?.focus()}
      />
    </div>
  );
}
