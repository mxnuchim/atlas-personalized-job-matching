"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, DownloadIcon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { coverLetterAction, saveCoverLetterAction } from "@/app/(app)/resume/actions";
import { Button } from "@/components/ui/button";

import { useElapsed } from "./use-elapsed";

const linkButton =
  "border-border bg-card hover:bg-muted focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none";

/**
 * The cover letter: written only when asked, from the same facts as the resume. Anything
 * in it the master can't back is listed beside it — prose can't be reverted line by line
 * like bullets, so it's shown to you instead of silently rewritten. Fully editable; your
 * edits are yours and clear the warnings.
 */
export function CoverLetterPanel({
  id,
  letter,
  warnings,
}: {
  id: string;
  letter: string | null;
  warnings: string[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(letter ?? "");
  const [pending, startTransition] = useTransition();
  const timer = useElapsed();
  const dirty = letter !== null && draft !== letter;

  function write() {
    timer.start();
    startTransition(async () => {
      const result = await coverLetterAction({ id });
      timer.stop();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(letter ? "Cover letter rewritten." : "Cover letter written.");
      router.refresh();
    });
  }

  function save() {
    startTransition(async () => {
      const result = await saveCoverLetterAction({ id, letter: draft });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Cover letter saved.");
      router.refresh();
    });
  }

  if (letter === null) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center">
        <h3 className="font-display text-lg font-medium">Write a cover letter for this role</h3>
        <p className="text-muted-foreground mt-1.5 max-w-md text-sm text-balance">
          Built from the same facts as this resume — your real achievements and numbers, mapped to what the posting asks
          for. About a fifth of a cent.
        </p>
        <Button className="mt-5" onClick={write} disabled={pending} aria-busy={pending}>
          {pending ? <span className="tabular-nums">Writing… {timer.seconds}s</span> : "Write cover letter"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {warnings.length > 0 && !dirty ? (
        <ul className="bg-muted/50 space-y-1.5 rounded-lg p-3">
          {warnings.map((w) => (
            <li key={w} className="flex gap-2 text-sm">
              <AlertTriangleIcon className="text-tier-possible-ink mt-0.5 size-3.5 shrink-0" />
              <span className="text-pretty">{w} Check it before sending.</span>
            </li>
          ))}
        </ul>
      ) : null}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={18}
        aria-label="Cover letter"
        disabled={pending}
        className="border-input bg-card focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-xl border p-5 text-[15px] leading-relaxed transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:opacity-60"
      />

      <div className="flex flex-wrap items-center gap-2">
        {dirty ? (
          <>
            <Button size="sm" onClick={save} disabled={pending}>
              Save edits
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(letter)} disabled={pending}>
              Discard
            </Button>
          </>
        ) : (
          <>
            <a href={`/resume/${id}/download?doc=cover&format=pdf`} className={linkButton}>
              <DownloadIcon className="size-4" /> PDF
            </a>
            <a href={`/resume/${id}/download?doc=cover&format=docx`} className={linkButton}>
              <DownloadIcon className="size-4" /> Word
            </a>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={write} disabled={pending} className="ml-auto" aria-busy={pending}>
          <RefreshCwIcon className="size-4" />
          {pending && timer.running ? <span className="tabular-nums">Rewriting… {timer.seconds}s</span> : "Rewrite"}
        </Button>
      </div>
    </div>
  );
}
