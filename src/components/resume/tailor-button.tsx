"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileCheckIcon, FileTextIcon, FileWarningIcon } from "lucide-react";
import { toast } from "sonner";

import { generateForJobAction } from "@/app/(app)/resume/actions";
import { cn } from "@/lib/utils";

import { useElapsed } from "./use-elapsed";

const base =
  "focus-visible:ring-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60";

/**
 * Tailor a resume to one job — from the match drawer and the Jobs list.
 *
 * Three states, so the button never offers something it can't do:
 *  - already tailored → open it (no model call, no cost);
 *  - no resume on file → a link to add one, not a button that fails (the server refuses
 *    too, but the UI shouldn't make you find that out);
 *  - otherwise → tailor, then open the result.
 */
export function TailorResumeButton({
  jobId,
  resumeId,
  ready,
  compact = false,
  className,
}: {
  jobId: string;
  resumeId: string | null;
  ready: boolean;
  /** Icon-only, for dense rows. */
  compact?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const timer = useElapsed();

  if (resumeId) {
    return (
      <Link
        href={`/resume/${resumeId}`}
        title="Open the resume tailored for this role"
        className={cn(base, "border-border bg-card hover:bg-muted border", compact && "px-2", className)}
      >
        <FileCheckIcon className="text-tier-strong-ink size-4" />
        {compact ? <span className="sr-only">Open tailored resume</span> : "Resume"}
      </Link>
    );
  }

  if (!ready) {
    return (
      <Link
        href="/profile#resume"
        title="Add your resume in Profile to tailor one for this role"
        className={cn(base, "text-muted-foreground hover:text-foreground border border-dashed", compact && "px-2", className)}
      >
        <FileWarningIcon className="size-4" />
        {compact ? <span className="sr-only">Add your resume first</span> : "Add resume first"}
      </Link>
    );
  }

  function tailor() {
    timer.start();
    startTransition(async () => {
      const result = await generateForJobAction({ jobId });
      timer.stop();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.value.created ? "Resume tailored to this role." : "Opening your tailored resume.");
      router.push(`/resume/${result.value.id}`);
    });
  }

  return (
    <button
      type="button"
      onClick={tailor}
      disabled={pending}
      aria-busy={pending}
      title="Tailor your resume to this role (~½¢)"
      className={cn(base, "border-border bg-card hover:bg-muted border", compact && "px-2", className)}
    >
      <FileTextIcon className="size-4" />
      {compact ? (
        <span className="sr-only">{pending ? "Tailoring…" : "Tailor resume"}</span>
      ) : pending ? (
        <span className="tabular-nums">Tailoring… {timer.seconds}s</span>
      ) : (
        "Tailor resume"
      )}
    </button>
  );
}
