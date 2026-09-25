"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckIcon, ExternalLinkIcon, QuoteIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { FitGauge } from "@/components/fit-gauge";
import { TierChip } from "@/components/tier-chip";
import { Button } from "@/components/ui/button";
import type { DraftRow } from "@/db/queries/drafts";
import {
  approveDraftAction,
  saveDraftEditAction,
  skipDraftAction,
} from "@/app/(app)/review/actions";
import { cn } from "@/lib/utils";

/**
 * The review queue (PRD §10.3 #4). Drafts awaiting a decision, with inline edit and
 * approve/skip.
 *
 * Decisions are optimistic with rollback (§10.4): the card leaves immediately, and on
 * failure it comes back with a toast saying why. The row slide-out is the confirmation
 * — there is no separate success animation, because the disappearance *is* the signal.
 *
 * Nothing here sends. The guardrail readout says what would still block a send, so the
 * gap is visible rather than discovered in M4.
 */
export function ReviewQueue({
  drafts,
  strengthLabels,
  dailyCap,
}: {
  drafts: DraftRow[];
  strengthLabels: Record<string, string>;
  dailyCap: number;
}) {
  // Optimistically removed ids. The server is the source of truth; this only hides a
  // card while its action is in flight, and React restores it if the action fails.
  const [decided, decide] = useOptimistic<string[], string>([], (current, draftId) => [
    ...current,
    draftId,
  ]);
  const [, startTransition] = useTransition();
  const visible = drafts.filter((d) => !decided.includes(d.id));

  function runDecision(draft: DraftRow, action: typeof approveDraftAction, verb: string) {
    startTransition(async () => {
      decide(draft.id);
      const result = await action({ draftId: draft.id });
      if (!result.ok) {
        // The optimistic removal unwinds when the transition ends; say why it came back.
        toast.error(result.error);
        return;
      }
      toast.success(`${verb} — ${draft.company}`);
    });
  }

  if (visible.length === 0) {
    return (
      <p className="text-muted-foreground rounded-xl border border-dashed px-5 py-10 text-center text-sm">
        Nothing left to review. New drafts appear here after the next run.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      <AnimatePresence initial={false} mode="popLayout">
        {visible.map((draft) => (
          <DraftCard
            key={draft.id}
            draft={draft}
            strengthLabels={strengthLabels}
            dailyCap={dailyCap}
            onApprove={() => runDecision(draft, approveDraftAction, "Approved")}
            onSkip={() => runDecision(draft, skipDraftAction, "Skipped")}
          />
        ))}
      </AnimatePresence>
    </ul>
  );
}

function DraftCard({
  draft,
  strengthLabels,
  dailyCap,
  onApprove,
  onSkip,
}: {
  draft: DraftRow;
  strengthLabels: Record<string, string>;
  dailyCap: number;
  onApprove: () => void;
  onSkip: () => void;
}) {
  const reduced = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.editedBody ?? draft.body);
  const [saving, startSaving] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const edited = draft.editedBody !== null;

  function save() {
    startSaving(async () => {
      const result = await saveDraftEditAction({ draftId: draft.id, editedBody: body });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setEditing(false);
      toast.success("Edit saved");
    });
  }

  function cancel() {
    setBody(draft.editedBody ?? draft.body);
    setEditing(false);
  }

  return (
    <motion.li
      layout={!reduced}
      exit={reduced ? undefined : { opacity: 0, x: 24, transition: { duration: 0.18 } }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="bg-card rounded-xl border p-5"
    >
      <div className="flex items-start gap-4">
        <FitGauge value={draft.overall} tier={draft.tier} size="md" />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <a
                href={draft.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-display focus-visible:ring-ring rounded text-base leading-tight font-semibold text-balance hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                {draft.title}
              </a>
              <p className="text-muted-foreground mt-1 text-sm">
                {draft.company}
                {draft.location ? ` · ${draft.location}` : ""}
              </p>
            </div>
            <TierChip tier={draft.tier} className="shrink-0" />
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <Label>Subject</Label>
          <p className="mt-1 text-sm font-medium">{draft.subject}</p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <Label>
              Body{" "}
              {edited && !editing && (
                <span className="text-muted-foreground font-normal">· edited</span>
              )}
            </Label>
            {!editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  // Focus after the textarea exists, so editing starts where you look.
                  requestAnimationFrame(() => textareaRef.current?.focus());
                }}
                className="text-primary focus-visible:ring-ring rounded text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                Edit
              </button>
            )}
          </div>

          {editing ? (
            <div className="mt-1.5 space-y-2">
              <textarea
                ref={textareaRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                aria-label={`Edit the draft for ${draft.title}`}
                className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-lg border p-3 text-sm leading-relaxed transition-colors focus-visible:ring-3 focus-visible:outline-none"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={saving || body.trim().length === 0}>
                  {saving ? "Saving…" : "Save edit"}
                </Button>
                <Button size="sm" variant="ghost" onClick={cancel} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line">{body}</p>
          )}
        </div>

        {draft.evidence ? (
          <div className="bg-muted/50 rounded-lg p-3">
            <Label>Cites</Label>
            <p className="mt-1 flex gap-2 text-sm">
              <QuoteIcon className="text-muted-foreground mt-1 size-3 shrink-0" />
              <span className="text-pretty">
                {draft.evidence.claim}
                {draft.evidence.context ? ` — ${draft.evidence.context}` : ""}
                {draft.evidence.metric ? (
                  <span className="text-muted-foreground"> ({draft.evidence.metric})</span>
                ) : null}
              </span>
            </p>
            {draft.strengthKeys.length > 0 && (
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {draft.strengthKeys.map((key) => (
                  <li
                    key={key}
                    className="bg-card text-muted-foreground rounded-md px-2 py-0.5 text-xs"
                  >
                    {strengthLabels[key] ?? key}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-destructive text-sm">
            This draft cites no evidence from your record. Read it closely before approving — it is
            the generic outreach Atlas exists to avoid.
          </p>
        )}

        <Guardrails recipient={draft.recipient} dailyCap={dailyCap} />

        <div className="flex gap-2">
          <Button size="sm" onClick={onApprove}>
            <CheckIcon className="size-4" />
            Approve
          </Button>
          <Button size="sm" variant="ghost" onClick={onSkip}>
            <XIcon className="size-4" />
            Skip
          </Button>
          <a
            href={draft.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring ml-auto inline-flex items-center gap-1.5 self-center rounded text-xs focus-visible:ring-2 focus-visible:outline-none"
          >
            Open posting
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>
      </div>
    </motion.li>
  );
}

/**
 * What still stands between this draft and a send (PRD §10.3 #4). Shown now, while
 * sending does not exist, so the gap is visible rather than discovered in M4.
 */
function Guardrails({ recipient, dailyCap }: { recipient: string | null; dailyCap: number }) {
  const checks = [
    {
      ok: recipient !== null,
      label: recipient ? `Recipient: ${recipient}` : "No recipient yet — sending lands in M4",
    },
    { ok: true, label: `Daily cap ${dailyCap}` },
    { ok: true, label: "Auto-send off" },
  ];

  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {checks.map((check) => (
        <li
          key={check.label}
          className={cn(
            "flex items-center gap-1.5 text-xs",
            check.ok ? "text-muted-foreground" : "text-foreground",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-1.5 rounded-full",
              check.ok ? "bg-tier-strong" : "bg-tier-possible",
            )}
          />
          {check.label}
        </li>
      ))}
    </ul>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground text-xs font-medium">{children}</span>;
}
