"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheckIcon } from "lucide-react";
import { toast } from "sonner";

import { confirmSkillsAction } from "@/app/(app)/resume/actions";
import { Button } from "@/components/ui/button";
import type { KeywordReport, KeywordResult } from "@/lib/resume/types";
import { cn } from "@/lib/utils";

import { CoverageMeter } from "./coverage-meter";
import { useElapsed } from "./use-elapsed";

/**
 * Where the resume stands against the posting, and the honest way to close gaps.
 *
 * Status dots reuse the guardrail-readout vocabulary (INTERFACE §10a): satisfied is
 * --tier-strong, caveat is --tier-possible. A missing keyword is never added for you —
 * you tick the ones you genuinely have, and they go to your resume's skills (never into
 * a role's bullets, which would claim where you used them).
 */
export function KeywordPanel({ id, report, costLabel }: { id: string; report: KeywordReport; costLabel: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const timer = useElapsed();

  function toggle(term: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });
  }

  function confirm() {
    if (selected.size === 0) return;
    timer.start();
    startTransition(async () => {
      const result = await confirmSkillsAction({ id, terms: [...selected] });
      timer.stop();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`Added ${selected.size} to your resume and re-tailored.`);
      setSelected(new Set());
      router.refresh();
    });
  }

  const missing = [...report.mustHave, ...report.niceToHave].filter((k) => k.status === "missing");

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <CoverageMeter matched={report.coverage.mustHave.matched} total={report.coverage.mustHave.total} />
        <CoverageMeter
          matched={report.coverage.niceToHave.matched}
          total={report.coverage.niceToHave.total}
          label="Nice-to-have"
        />
      </div>

      <KeywordGroup title="Must-have" items={report.mustHave} selected={selected} onToggle={toggle} disabled={pending} />
      <KeywordGroup title="Nice-to-have" items={report.niceToHave} selected={selected} onToggle={toggle} disabled={pending} />

      {missing.length > 0 ? (
        <div className="bg-muted/50 space-y-2.5 rounded-lg p-3">
          <p className="text-sm text-pretty">
            Tick only what you&rsquo;ve genuinely done. It&rsquo;s added to your resume&rsquo;s skills — never written
            into a job you held.
          </p>
          <Button size="sm" onClick={confirm} disabled={selected.size === 0 || pending} aria-busy={pending}>
            {pending ? (
              <span className="tabular-nums">Re-tailoring… {timer.seconds}s</span>
            ) : selected.size > 0 ? (
              `I have ${selected.size === 1 ? "this" : `these ${selected.size}`} — re-tailor`
            ) : (
              "Tick what you have"
            )}
          </Button>
        </div>
      ) : null}

      {report.reverted > 0 ? (
        <p className="text-muted-foreground flex gap-2 text-xs text-pretty">
          <ShieldCheckIcon className="text-tier-strong-ink mt-0.5 size-3.5 shrink-0" />
          Kept your original wording on {report.reverted} {report.reverted === 1 ? "line" : "lines"} where a rewrite
          claimed something your resume doesn&rsquo;t say.
        </p>
      ) : null}

      <p className="text-muted-foreground text-xs tabular-nums">Spent on this resume: {costLabel}</p>
    </div>
  );
}

const DOT: Record<KeywordResult["status"], string> = {
  covered: "bg-tier-strong",
  unused: "bg-tier-possible",
  missing: "ring-1 ring-current/40 ring-inset",
};

const STATUS_HINT: Record<KeywordResult["status"], string> = {
  covered: "On the page",
  unused: "In your resume, not used here — regenerate to bring it in",
  missing: "Not in your resume",
};

function KeywordGroup({
  title,
  items,
  selected,
  onToggle,
  disabled,
}: {
  title: string;
  items: KeywordResult[];
  selected: Set<string>;
  onToggle: (term: string) => void;
  disabled: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-muted-foreground mb-2 text-xs font-medium">{title}</h3>
      <ul className="flex flex-wrap gap-1.5">
        {items.map((k) => {
          const isMissing = k.status === "missing";
          const chip = (
            <>
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[k.status])} />
              <span className={cn(isMissing && "text-muted-foreground")}>{k.term}</span>
              {k.confirmed ? <span className="text-muted-foreground text-[10px]">· you</span> : null}
            </>
          );
          return (
            <li key={k.term}>
              {isMissing ? (
                <label
                  title={STATUS_HINT[k.status]}
                  className={cn(
                    "focus-within:ring-ring inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors focus-within:ring-2",
                    selected.has(k.term) ? "border-primary bg-primary/10" : "border-dashed hover:bg-muted",
                  )}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={selected.has(k.term)}
                    onChange={() => onToggle(k.term)}
                    disabled={disabled}
                  />
                  {chip}
                </label>
              ) : (
                <span title={STATUS_HINT[k.status]} className="bg-muted/60 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs">
                  {chip}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
