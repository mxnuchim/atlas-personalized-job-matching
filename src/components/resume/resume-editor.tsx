"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { saveResumeEditsAction } from "@/app/(app)/resume/actions";
import { Button } from "@/components/ui/button";
import type { TailoredResume } from "@/lib/resume/types";

/**
 * Edit the wording before you send it. Only wording: companies, titles and dates are
 * shown but not editable, and the server merges edits onto the stored facts anyway, so
 * no request can change them. You're the author here, so no guards — the keyword report
 * is recomputed against whatever you write.
 */

const field =
  "border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border px-3 py-2 text-sm leading-relaxed transition-colors focus-visible:ring-3 focus-visible:outline-none";

function rowsFor(text: string): number {
  return Math.min(6, Math.max(2, Math.ceil(text.length / 90)));
}

export function ResumeEditor({ id, resume, onDone }: { id: string; resume: TailoredResume; onDone: () => void }) {
  const router = useRouter();
  const [headline, setHeadline] = useState(resume.headline ?? "");
  const [summary, setSummary] = useState(resume.summary ?? "");
  const [roles, setRoles] = useState(() => resume.roles.map((r) => ({ id: r.id, bullets: r.bullets.map((b) => b.text) })));
  const [skills, setSkills] = useState(resume.skills.join(", "));
  const [pending, startTransition] = useTransition();

  function setBullet(roleIndex: number, bulletIndex: number, text: string | null) {
    setRoles((prev) =>
      prev.map((r, i) => {
        if (i !== roleIndex) return r;
        const bullets = [...r.bullets];
        if (text === null) bullets.splice(bulletIndex, 1);
        else bullets[bulletIndex] = text;
        return { ...r, bullets };
      }),
    );
  }

  function addBullet(roleIndex: number) {
    setRoles((prev) => prev.map((r, i) => (i === roleIndex ? { ...r, bullets: [...r.bullets, ""] } : r)));
  }

  function save() {
    startTransition(async () => {
      const result = await saveResumeEditsAction({
        id,
        edits: {
          headline: headline.trim() || null,
          summary: summary.trim() || null,
          roles: roles.map((r) => ({ id: r.id, bullets: r.bullets.map((b) => b.trim()).filter(Boolean) })),
          skills: skills.split(",").map((s) => s.trim()).filter(Boolean),
        },
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Edits saved. Keyword coverage updated.");
      onDone();
      router.refresh();
    });
  }

  return (
    <div className="bg-card space-y-6 rounded-xl border p-5">
      <label className="block space-y-1.5">
        <span className="text-muted-foreground text-xs font-medium">Headline</span>
        <input value={headline} onChange={(e) => setHeadline(e.target.value)} className={field} />
      </label>

      <label className="block space-y-1.5">
        <span className="text-muted-foreground text-xs font-medium">Summary</span>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} className={field} />
      </label>

      {resume.roles.map((role, roleIndex) => (
        <fieldset key={role.id} className="space-y-2">
          <legend className="text-sm">
            <span className="font-medium">{role.title}</span>
            <span className="text-muted-foreground">
              {" "}
              · {role.company} · {[role.start, role.current ? "Present" : role.end].filter(Boolean).join(" – ")}
            </span>
          </legend>
          {roles[roleIndex]!.bullets.map((text, bulletIndex) => (
            <div key={bulletIndex} className="flex items-start gap-2">
              <textarea
                value={text}
                onChange={(e) => setBullet(roleIndex, bulletIndex, e.target.value)}
                rows={rowsFor(text)}
                aria-label={`${role.title} at ${role.company}, line ${bulletIndex + 1}`}
                className={field}
              />
              <button
                type="button"
                onClick={() => setBullet(roleIndex, bulletIndex, null)}
                aria-label="Remove this line"
                className="text-muted-foreground hover:text-destructive hover:bg-muted focus-visible:ring-ring mt-1 rounded-md p-1.5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => addBullet(roleIndex)}
            className="text-primary-ink focus-visible:ring-ring inline-flex items-center gap-1 rounded text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            <PlusIcon className="size-3.5" /> Add a line
          </button>
        </fieldset>
      ))}

      <label className="block space-y-1.5">
        <span className="text-muted-foreground text-xs font-medium">Skills — comma separated, most relevant first</span>
        <textarea value={skills} onChange={(e) => setSkills(e.target.value)} rows={3} className={field} />
      </label>

      <div className="flex flex-wrap gap-2 border-t pt-4">
        <Button onClick={save} disabled={pending} aria-busy={pending}>
          {pending ? "Saving…" : "Save edits"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
