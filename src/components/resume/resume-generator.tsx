"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { generateFromTextAction } from "@/app/(app)/resume/actions";
import { Button } from "@/components/ui/button";

import { useElapsed } from "./use-elapsed";

const MIN_CHARS = 200;

/**
 * Tailor for a posting that isn't in Atlas — paste it in. Jobs Atlas already knows about
 * are better tailored from their match (the drawer's "Tailor resume"), which needs no
 * pasting and stays linked to "I applied".
 */
export function ResumeGenerator() {
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const timer = useElapsed();

  const trimmed = jd.trim();
  const ready = trimmed.length >= MIN_CHARS;

  function generate() {
    if (!ready) return;
    setError(null);
    timer.start();
    startTransition(async () => {
      const result = await generateFromTextAction({ jdText: trimmed });
      timer.stop();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Resume tailored.");
      router.push(`/resume/${result.value.id}`);
    });
  }

  return (
    <section className="bg-card space-y-3 rounded-xl border p-5">
      <div>
        <h2 className="font-display text-base font-semibold">Tailor for a posting</h2>
        <p className="text-muted-foreground mt-1 text-sm text-pretty">
          Paste the full job description. For roles already in Atlas, use{" "}
          <span className="text-foreground font-medium">Tailor resume</span> on the match instead — no pasting, and it
          stays linked to the role.
        </p>
      </div>
      <textarea
        value={jd}
        onChange={(e) => setJd(e.target.value)}
        rows={9}
        placeholder="Paste the job description — title, responsibilities, requirements."
        aria-label="Job description"
        disabled={pending}
        className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border p-3 text-sm leading-relaxed transition-colors focus-visible:ring-3 focus-visible:outline-none disabled:opacity-60"
      />
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={generate} disabled={!ready || pending} aria-busy={pending}>
          {pending ? <span className="tabular-nums">Tailoring… {timer.seconds}s</span> : "Tailor my resume"}
        </Button>
        <span className="text-muted-foreground text-xs tabular-nums">
          {trimmed.length > 0 && !ready
            ? `${MIN_CHARS - trimmed.length} more characters needed`
            : pending
              ? "Reading the posting, then rewriting — usually 20–40 seconds."
              : "About half a cent. Only keywords your experience backs."}
        </span>
      </div>
    </section>
  );
}
