"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from "lucide-react";

import { FitGauge } from "@/components/fit-gauge";
import { MatchDrawer } from "@/components/match-drawer";
import { TierChip } from "@/components/tier-chip";
import type { MatchRow } from "@/db/queries/matches";
import { cn } from "@/lib/utils";
import { type FitTier, TIER_LABELS } from "@/lib/scoring";

/**
 * The console table (PRD §10.3). Keyboard-first: `j`/`k` move, `enter` opens,
 * `/` jumps to the filter, `escape` clears it. Rows are anchored by the fit score.
 *
 * Follows the ARIA grid pattern with a roving tabindex — exactly one row is in the
 * tab order at a time, so Tab moves past the table rather than through 200 rows,
 * and `j`/`k` move focus within it.
 *
 * No motion here beyond focus: the score gauges are the only thing that animates,
 * and they do it once (§10.4/§10.5 — no fade-up on every row).
 */

type SortKey = "overall" | "title" | "company" | "location" | "postedAt";
type SortDir = "asc" | "desc";

const TIER_FILTERS: (FitTier | "all")[] = ["all", "strong", "possible", "stretch"];

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: "overall", label: "Fit", className: "w-[92px] pl-5" },
  { key: "title", label: "Role", className: "min-w-0" },
  { key: "company", label: "Company", className: "hidden w-[150px] md:table-cell" },
  { key: "location", label: "Location", className: "hidden w-[170px] lg:table-cell" },
  // When the role was posted, not when Atlas scored it: the scoring date is an
  // internal detail, while how long a req has been open changes how you treat it.
  // The scored date and model still show in the drawer footer.
  { key: "postedAt", label: "Posted", className: "hidden w-[92px] pr-5 sm:table-cell" },
];

/** A key cap. Sans, not monospace — monospace labels are an anti-pattern here. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-muted text-foreground rounded border-b px-1.5 py-0.5 font-sans text-[0.6875rem] leading-none font-medium">
      {children}
    </kbd>
  );
}

export function MatchesTable({
  matches,
  strengthLabels,
}: {
  matches: MatchRow[];
  strengthLabels: Record<string, string>;
}) {
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<FitTier | "all">("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: "overall",
    dir: "desc",
  });
  const [cursor, setCursor] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  /** Only move focus for keyboard navigation — never steal it on mount or filter. */
  const shouldFocusRow = useRef(false);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = matches.filter((m) => {
      if (tier !== "all" && m.tier !== tier) return false;
      if (!needle) return true;
      return (
        m.title.toLowerCase().includes(needle) ||
        m.company.toLowerCase().includes(needle) ||
        (m.location ?? "").toLowerCase().includes(needle)
      );
    });

    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "overall":
          return (a.overall - b.overall) * dir;
        case "postedAt":
          // Undated postings sort last in either direction rather than pretending
          // to be the oldest, which an empty string would do.
          if (!a.postedAt && !b.postedAt) return 0;
          if (!a.postedAt) return 1;
          if (!b.postedAt) return -1;
          return a.postedAt.localeCompare(b.postedAt) * dir;
        case "location":
          return (a.location ?? "").localeCompare(b.location ?? "") * dir;
        default:
          return a[sort.key].localeCompare(b[sort.key]) * dir;
      }
    });
  }, [matches, query, tier, sort]);

  // Derived, not stored: filtering can shrink the list under the cursor, and
  // clamping during render avoids the cascading re-render an effect would cause.
  const activeIndex = Math.min(cursor, Math.max(0, rows.length - 1));

  // Focus is genuinely external state, so this one belongs in an effect.
  useEffect(() => {
    if (!shouldFocusRow.current) return;
    shouldFocusRow.current = false;
    rowRefs.current[activeIndex]?.focus();
  }, [activeIndex]);

  const move = useCallback(
    (delta: number) => {
      shouldFocusRow.current = true;
      setCursor((i) => Math.max(0, Math.min(rows.length - 1, i + delta)));
    },
    [rows.length],
  );

  // Page-level shortcuts. Deliberately inert while the drawer is open (its own
  // focus trap owns the keyboard) or while typing in a field.
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
        setQuery("");
        searchRef.current?.blur();
        return;
      }
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        move(1);
      } else if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        move(-1);
      } else if (event.key === "Enter" && rows[activeIndex]) {
        event.preventDefault();
        setOpenId(rows[activeIndex].id);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [move, openId, rows, activeIndex]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : // Scores and dates are most useful highest-first; names A–Z.
          { key, dir: key === "overall" || key === "postedAt" ? "desc" : "asc" },
    );
  }

  const openMatch = rows.find((m) => m.id === openId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
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
              onClick={() => setTier(t)}
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
          Nothing matches that filter. Clear it to see all {matches.length} scored roles.
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
                      sort.key === col.key
                        ? sort.dir === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded transition-colors focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {col.label}
                      {sort.key === col.key ? (
                        sort.dir === "asc" ? (
                          <ArrowUpIcon className="size-3" />
                        ) : (
                          <ArrowDownIcon className="size-3" />
                        )
                      ) : null}
                    </button>
                  </th>
                ))}
                <th
                  scope="col"
                  className="hidden w-[104px] pr-5 text-left font-medium sm:table-cell"
                >
                  <span className="text-muted-foreground">Tier</span>
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
                  // Roving tabindex: exactly one row is in the tab order, so Tab
                  // steps past the table instead of through every row. Focus is the
                  // selection — `aria-selected` would be invalid on a plain table.
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
                  <td className="text-muted-foreground hidden py-2.5 pr-5 text-xs tabular-nums sm:table-cell">
                    {match.postedAgeLabel ?? "—"}
                    {match.evergreen && (
                      <span className="ml-1 opacity-60" title="Open for over six months">
                        ·
                      </span>
                    )}
                  </td>
                  <td className="hidden py-2.5 pr-5 sm:table-cell">
                    <TierChip tier={match.tier} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
