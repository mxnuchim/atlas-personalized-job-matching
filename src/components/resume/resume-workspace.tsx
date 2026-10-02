"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DownloadIcon, PencilIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { deleteResumeAction, regenerateAction } from "@/app/(app)/resume/actions";
import { Button } from "@/components/ui/button";
import type { KeywordReport, TailoredResume } from "@/lib/resume/types";
import { cn } from "@/lib/utils";

import { CoverLetterPanel } from "./cover-letter-panel";
import { KeywordPanel } from "./keyword-panel";
import { ResumeEditor } from "./resume-editor";
import { ResumePreview } from "./resume-preview";
import { useElapsed } from "./use-elapsed";

const linkButton =
  "border-border bg-card hover:bg-muted focus-visible:ring-ring inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none";

/**
 * One tailored resume: keyword coverage on the left, the document on the right, the
 * letter a tab away. Destructive or costly actions (regenerate overwrites edits; delete
 * is final) take a second click — armed for a few seconds, then they disarm themselves.
 */
export function ResumeWorkspace({
  id,
  resume,
  report,
  coverLetter,
  coverLetterWarnings,
  costLabel,
}: {
  id: string;
  resume: TailoredResume;
  report: KeywordReport;
  coverLetter: string | null;
  coverLetterWarnings: string[];
  costLabel: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"resume" | "letter">("resume");
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const timer = useElapsed();
  const [armed, setArmed] = useState<"regenerate" | "delete" | null>(null);

  // Disarm a pending confirmation after a moment, so a stray second click later can't fire it.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), 4000);
    return () => clearTimeout(timer);
  }, [armed]);

  function regenerate() {
    if (armed !== "regenerate") return setArmed("regenerate");
    setArmed(null);
    timer.start();
    startTransition(async () => {
      const result = await regenerateAction({ id });
      timer.stop();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Re-tailored against your current resume.");
      router.refresh();
    });
  }

  function remove() {
    if (armed !== "delete") return setArmed("delete");
    setArmed(null);
    startTransition(async () => {
      const result = await deleteResumeAction({ id });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Deleted.");
      router.push("/resume");
    });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <KeywordPanel id={id} report={report} costLabel={costLabel} />
      </aside>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="bg-muted/60 flex items-center gap-0.5 rounded-lg p-0.5" role="tablist" aria-label="Document">
            {(["resume", "letter"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "focus-visible:ring-ring rounded-md px-3 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                  tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t === "resume" ? "Resume" : "Cover letter"}
              </button>
            ))}
          </div>

          {tab === "resume" && !editing ? (
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <a href={`/resume/${id}/download?doc=resume&format=pdf`} className={linkButton}>
                <DownloadIcon className="size-4" /> PDF
              </a>
              <a href={`/resume/${id}/download?doc=resume&format=docx`} className={linkButton}>
                <DownloadIcon className="size-4" /> Word
              </a>
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)} disabled={pending}>
                <PencilIcon className="size-4" /> Edit
              </Button>
              <Button
                size="sm"
                variant={armed === "regenerate" ? "default" : "ghost"}
                onClick={regenerate}
                disabled={pending}
                aria-busy={pending}
                title="Re-tailor from your current resume — replaces any edits (~⅓¢)"
              >
                <RefreshCwIcon className={cn("size-4", pending && timer.running && "animate-spin motion-reduce:animate-none")} />
                {pending && timer.running ? (
                  <span className="tabular-nums">Re-tailoring… {timer.seconds}s</span>
                ) : armed === "regenerate" ? (
                  "Replace edits?"
                ) : (
                  "Regenerate"
                )}
              </Button>
            </div>
          ) : null}
        </div>

        <div role="tabpanel">
          {tab === "resume" ? (
            editing ? (
              <ResumeEditor id={id} resume={resume} onDone={() => setEditing(false)} />
            ) : (
              <div className={cn("transition-opacity", pending && timer.running && "opacity-50")}>
                <ResumePreview resume={resume} />
              </div>
            )
          ) : (
            <CoverLetterPanel key={coverLetter ?? "none"} id={id} letter={coverLetter} warnings={coverLetterWarnings} />
          )}
        </div>

        <div className="flex justify-end border-t pt-4">
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            className={cn(
              "focus-visible:ring-ring inline-flex items-center gap-1.5 rounded text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50",
              armed === "delete" ? "text-destructive font-medium" : "text-muted-foreground hover:text-destructive",
            )}
          >
            <Trash2Icon className="size-3.5" />
            {armed === "delete" ? "Click again to delete" : "Delete this resume"}
          </button>
        </div>
      </div>
    </div>
  );
}
