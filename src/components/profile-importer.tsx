"use client";

import { useState, useTransition } from "react";
import { AlertTriangleIcon, CheckIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";

import {
  previewProfileAction,
  saveProfileAction,
  type PreviewResult,
} from "@/app/(app)/profile/actions";
import { CopyButton } from "@/components/copy-button";
import { CV_PROMPT } from "@/lib/profile-document";

/**
 * Build a profile by pasting one in.
 *
 * Writing out your own strengths and the evidence for each is the slowest part of
 * getting started, and it is exactly what a model holding your CV is good at. So the
 * flow is: copy a prompt, paste it into ChatGPT with your CV, paste the answer back.
 *
 * Check before save, always. A save replaces every strength and every piece of
 * evidence, and a new version re-scores the whole corpus — both worth seeing coming.
 */
export function ProfileImporter({ hasProfile }: { hasProfile: boolean }) {
  const [raw, setRaw] = useState("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [newVersion, setNewVersion] = useState(false);
  const [pending, startTransition] = useTransition();

  function check() {
    startTransition(async () => setPreview(await previewProfileAction(raw)));
  }

  function save() {
    startTransition(async () => {
      const result = await saveProfileAction(raw, newVersion);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(
        result.rescored
          ? `Saved as version ${result.version}. The next run re-scores every posting against it.`
          : `Saved. Your existing matches are unaffected.`,
      );
      setRaw("");
      setPreview(null);
    });
  }

  return (
    <div className="space-y-6">
      <section className="bg-card space-y-3 rounded-xl border p-5">
        <div className="flex items-start gap-3">
          <SparklesIcon className="text-primary-ink mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-base font-semibold">Start from your CV</h2>
            <p className="text-muted-foreground mt-1 text-sm text-pretty">
              Copy this prompt, paste it into ChatGPT or Claude with your CV, and bring the answer
              back here. It asks for measured outcomes rather than adjectives, because that is what
              gets quoted in your outreach.
            </p>
          </div>
          <CopyButton value={CV_PROMPT} label="Copy prompt" copiedLabel="Copied" />
        </div>

        <details className="group">
          <summary className="text-muted-foreground hover:text-foreground focus-visible:ring-ring cursor-pointer rounded text-sm focus-visible:ring-2 focus-visible:outline-none">
            Show the prompt
          </summary>
          <pre className="bg-muted text-muted-foreground mt-3 max-h-64 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
            {CV_PROMPT}
          </pre>
        </details>
      </section>

      <section className="space-y-3">
        <label htmlFor="paste" className="block text-sm font-medium">
          Paste the JSON it gave you
        </label>
        <textarea
          id="paste"
          value={raw}
          onChange={(e) => {
            setRaw(e.target.value);
            setPreview(null);
          }}
          rows={10}
          spellCheck={false}
          placeholder={'{\n  "profile": { … },\n  "strengths": [ … ],\n  "evidence": [ … ]\n}'}
          className="border-input focus-visible:ring-ring w-full rounded-xl border bg-transparent p-3 font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={check}
            disabled={pending || raw.trim() === ""}
            className="bg-secondary focus-visible:ring-ring inline-flex h-9 items-center rounded-lg px-3 text-sm font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          >
            {pending ? "Checking…" : "Check it"}
          </button>
          {preview?.ok ? (
            <span className="text-tier-strong-ink inline-flex items-center gap-1.5 text-sm">
              <CheckIcon className="size-4" />
              {preview.summary}
            </span>
          ) : null}
        </div>
      </section>

      {preview && !preview.ok ? (
        <ul className="space-y-1.5 rounded-xl p-4 ring-1 ring-current/25 ring-inset" role="alert">
          {preview.errors.map((error) => (
            <li key={error} className="text-destructive flex gap-2 text-sm">
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" strokeWidth={2} />
              <span className="text-pretty">{error}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {preview?.ok ? (
        <section className="space-y-4">
          {preview.warnings.length > 0 ? (
            <ul
              className="space-y-1.5 rounded-xl p-4 ring-1 ring-inset"
              style={{
                color: "var(--tier-possible-ink)",
                backgroundColor: "color-mix(in oklab, var(--tier-possible) 10%, transparent)",
                // @ts-expect-error — custom property for the ring utility.
                "--tw-ring-color": "color-mix(in oklab, var(--tier-possible) 28%, transparent)",
              }}
            >
              {preview.warnings.map((warning) => (
                <li key={warning} className="text-sm text-pretty">
                  {warning}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="overflow-hidden rounded-xl border">
            <div className="border-b px-4 py-3">
              <p className="text-sm font-medium">{preview.document.profile.headline}</p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {preview.document.profile.target_roles.join(" · ") || "No target roles"}
              </p>
            </div>
            <ul className="divide-border divide-y">
              {preview.document.strengths.map((strength) => {
                const evidence = preview.document.evidence.filter(
                  (e) => e.strength_key === strength.key,
                );
                return (
                  <li key={strength.key} className="px-4 py-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium">{strength.label}</span>
                      <span className="text-muted-foreground text-xs">
                        {strength.kind} · weight {strength.weight} · {evidence.length} evidence
                      </span>
                    </div>
                    {evidence[0] ? (
                      <p className="text-muted-foreground mt-0.5 truncate text-xs">
                        {evidence[0].claim}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>

          {hasProfile ? (
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                checked={newVersion}
                onChange={(e) => setNewVersion(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-pretty">
                Save as a new version and re-score everything.
                <span className="text-muted-foreground block text-xs">
                  Only when your positioning genuinely changed — it re-scores every stored posting,
                  which costs roughly a cent per fifty.
                </span>
              </span>
            </label>
          ) : null}

          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
          >
            {pending ? "Saving…" : hasProfile ? "Replace my profile" : "Save my profile"}
          </button>
        </section>
      ) : null}
    </div>
  );
}
