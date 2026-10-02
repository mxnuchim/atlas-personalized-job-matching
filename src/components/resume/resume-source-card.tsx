"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ClipboardPasteIcon, FileTextIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { importResumeAction } from "@/app/(app)/resume/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { useElapsed } from "./use-elapsed";

export type MasterSummary = {
  version: number;
  fileName: string | null;
  savedLabel: string;
  name: string;
  roles: { title: string; company: string; dates: string; bullets: number }[];
  skills: string[];
  confirmedSkills: string[];
  warnings: string[];
};

const MAX_BYTES = 4 * 1024 * 1024;
const MIN_CHARS = 300;
const ACCEPT = ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Your source resume, on the Profile page. Everything the Resume page makes starts here,
 * so this shows what Atlas actually read — roles, dates, skills — rather than just "saved".
 * A parse that missed a role should be caught here, not in a tailored resume.
 */
export function ResumeSourceCard({ master }: { master: MasterSummary | null }) {
  const [editing, setEditing] = useState(master === null);

  return (
    <section id="resume" className="bg-card scroll-mt-24 overflow-hidden rounded-xl border">
      <div className="flex items-start gap-3 border-b px-5 py-4">
        <FileTextIcon className="text-muted-foreground mt-0.5 size-5 shrink-0" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-base font-semibold">Your resume</h2>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">
            {master
              ? "Every tailored resume and cover letter starts from this. Replace it whenever your experience changes."
              : "Add it to unlock tailoring: a resume rewritten for each role, with the posting's keywords — only ones your experience backs."}
          </p>
        </div>
        {master && !editing ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Replace
          </Button>
        ) : null}
      </div>

      {master ? <MasterReadout master={master} /> : null}
      {editing ? (
        <SourceForm onCancel={master ? () => setEditing(false) : undefined} onSaved={() => setEditing(false)} />
      ) : null}
    </section>
  );
}

function MasterReadout({ master }: { master: MasterSummary }) {
  return (
    <div className="space-y-4 px-5 py-4">
      <p className="text-muted-foreground text-sm">
        <span className="text-foreground font-medium">{master.name || "No name found"}</span>
        {" · "}
        {master.roles.length} {master.roles.length === 1 ? "role" : "roles"} · {master.skills.length} skills
        {master.fileName ? ` · from ${master.fileName}` : " · pasted"} · saved {master.savedLabel}
      </p>

      {master.warnings.length > 0 ? (
        <ul className="space-y-1.5">
          {master.warnings.map((w) => (
            <li key={w} className="flex gap-2 text-sm">
              <AlertTriangleIcon className="text-tier-possible-ink mt-0.5 size-3.5 shrink-0" />
              <span className="text-pretty">{w}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <details className="group">
        <summary className="text-primary-ink focus-visible:ring-ring cursor-pointer rounded text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none">
          What Atlas read
        </summary>
        <div className="mt-3 space-y-4">
          <ul className="divide-border divide-y rounded-lg border">
            {master.roles.map((r, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{r.title}</span>
                  <span className="text-muted-foreground"> · {r.company}</span>
                </span>
                <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                  {r.dates} · {r.bullets} {r.bullets === 1 ? "line" : "lines"}
                </span>
              </li>
            ))}
          </ul>
          <ul className="flex flex-wrap gap-1.5">
            {master.skills.map((s) => (
              <li key={s} className="bg-muted rounded-md px-2 py-0.5 text-xs">
                {s}
              </li>
            ))}
            {master.confirmedSkills.map((s) => (
              <li
                key={`c-${s}`}
                title="Added by you from a job's keyword gaps"
                className="text-primary-ink rounded-md px-2 py-0.5 text-xs ring-1 ring-current/30 ring-inset"
              >
                {s}
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}

function SourceForm({ onCancel, onSaved }: { onCancel?: () => void; onSaved: () => void }) {
  const router = useRouter();
  const [mode, setMode] = useState<"upload" | "paste">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const timer = useElapsed();
  const inputRef = useRef<HTMLInputElement>(null);

  function pick(next: File | null) {
    setError(null);
    if (!next) return setFile(null);
    const name = next.name.toLowerCase();
    if (!name.endsWith(".pdf") && !name.endsWith(".docx")) {
      setFile(null);
      return setError("Upload a PDF or a Word (.docx) file.");
    }
    if (next.size > MAX_BYTES) {
      setFile(null);
      return setError("Files must be 4 MB or smaller.");
    }
    setFile(next);
  }

  const trimmed = text.trim();
  const canSubmit = mode === "upload" ? file !== null : trimmed.length >= MIN_CHARS;

  function submit() {
    if (!canSubmit) return;
    const form = new FormData();
    if (mode === "upload" && file) form.set("file", file);
    else form.set("text", trimmed);

    setError(null);
    timer.start();
    startTransition(async () => {
      const result = await importResumeAction(form);
      timer.stop();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(
        result.value.warnings.length > 0
          ? `Resume saved — check ${result.value.warnings.length} note${result.value.warnings.length === 1 ? "" : "s"} below.`
          : "Resume saved. Tailoring is unlocked.",
      );
      setFile(null);
      setText("");
      onSaved();
      router.refresh();
    });
  }

  return (
    <div className="space-y-4 border-t px-5 py-4 first:border-t-0">
      <div className="bg-muted/60 inline-flex items-center gap-0.5 rounded-lg p-0.5" role="group" aria-label="How to add your resume">
        {(["upload", "paste"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            aria-pressed={mode === m}
            className={cn(
              "focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
              mode === m ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "upload" ? <UploadIcon className="size-3.5" /> : <ClipboardPasteIcon className="size-3.5" />}
            {m === "upload" ? "Upload file" : "Paste text"}
          </button>
        ))}
      </div>

      {mode === "upload" ? (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files[0] ?? null);
          }}
          className="hover:bg-muted/40 focus-within:ring-ring flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed px-5 py-8 text-center transition-colors focus-within:ring-2"
        >
          <UploadIcon className="text-muted-foreground size-5" />
          {file ? (
            <span className="text-sm">
              <span className="font-medium">{file.name}</span>
              <span className="text-muted-foreground"> · {(file.size / 1024).toFixed(0)} KB</span>
            </span>
          ) : (
            <span className="text-sm">
              <span className="font-medium">Choose a file</span>
              <span className="text-muted-foreground"> or drop it here</span>
            </span>
          )}
          <span className="text-muted-foreground text-xs">PDF or Word (.docx), up to 4 MB. Scanned images can&rsquo;t be read — paste the text instead.</span>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
        </label>
      ) : (
        <div className="space-y-1.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder="Paste your whole resume — experience, skills, education."
            aria-label="Your resume"
            className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border p-3 text-sm leading-relaxed transition-colors focus-visible:ring-3 focus-visible:outline-none"
          />
          <p className="text-muted-foreground text-xs tabular-nums">
            {trimmed.length.toLocaleString()} characters
            {trimmed.length > 0 && trimmed.length < MIN_CHARS ? ` · at least ${MIN_CHARS} needed` : ""}
          </p>
        </div>
      )}

      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={submit} disabled={!canSubmit || pending} aria-busy={pending}>
          {pending ? <span className="tabular-nums">Reading your resume… {timer.seconds}s</span> : "Save resume"}
        </Button>
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        ) : null}
        <span className="text-muted-foreground text-xs">Read once, kept as text — the file itself isn&rsquo;t stored.</span>
      </div>
    </div>
  );
}
