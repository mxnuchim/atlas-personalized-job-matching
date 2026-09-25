"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckIcon, ExternalLinkIcon, MailIcon, QuoteIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import {
  approveDraftAction,
  markSentAction,
  saveDraftEditAction,
  skipDraftAction,
} from "@/app/(app)/review/actions";
import { CopyButton } from "@/components/copy-button";
import { FitGauge } from "@/components/fit-gauge";
import { TierChip } from "@/components/tier-chip";
import { Button } from "@/components/ui/button";
import type { DraftRow } from "@/db/queries/drafts";

/**
 * The review queue (PRD §10.3 #4). Atlas drafts; you copy and send it yourself.
 *
 * That is the whole interaction, so the copy controls are the loudest thing on the
 * card — subject and body copy separately, because a mail client wants them in
 * different fields, and the contact address copies on its own too.
 *
 * Decisions are optimistic with rollback (§10.4): the card leaves immediately and comes
 * back with a toast if the action fails. The disappearance *is* the confirmation.
 */
export function ReviewQueue({
  drafts,
  strengthLabels,
}: {
  drafts: DraftRow[];
  strengthLabels: Record<string, string>;
}) {
  const [decided, decide] = useOptimistic<string[], string>([], (current, draftId) => [
    ...current,
    draftId,
  ]);
  const [, startTransition] = useTransition();
  const visible = drafts.filter((d) => !decided.includes(d.id));

  function run(draft: DraftRow, action: typeof approveDraftAction, verb: string) {
    startTransition(async () => {
      decide(draft.id);
      const result = await action({ draftId: draft.id });
      if (!result.ok) {
        // The optimistic removal unwinds when the transition ends; say why it returned.
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
            onApprove={() => run(draft, approveDraftAction, "Approved")}
            onSkip={() => run(draft, skipDraftAction, "Skipped")}
            onMarkSent={() => run(draft, markSentAction, "Marked sent")}
          />
        ))}
      </AnimatePresence>
    </ul>
  );
}

function DraftCard({
  draft,
  strengthLabels,
  onApprove,
  onSkip,
  onMarkSent,
}: {
  draft: DraftRow;
  strengthLabels: Record<string, string>;
  onApprove: () => void;
  onSkip: () => void;
  onMarkSent: () => void;
}) {
  const reduced = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.editedBody ?? draft.body);
  const [saving, startSaving] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const edited = draft.editedBody !== null;
  const wordCount = body.trim().split(/\s+/).filter(Boolean).length;

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
        <Contact draft={draft} />

        <div>
          <div className="flex items-center justify-between gap-3">
            <Label>Subject</Label>
            <CopyButton
              value={draft.subject}
              label="Copy"
              variant="ghost"
              className="-mr-2 h-7 px-2 text-xs"
            />
          </div>
          <p className="text-sm font-medium">{draft.subject}</p>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3">
            <Label>
              Body{" "}
              <span className="text-muted-foreground font-normal tabular-nums">
                · {wordCount} words{edited && !editing ? " · edited" : ""}
              </span>
            </Label>
            {!editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(true);
                  // Focus once the textarea exists, so editing starts where you look.
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
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setBody(draft.editedBody ?? draft.body);
                    setEditing(false);
                  }}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-sm leading-relaxed whitespace-pre-line">{body}</p>
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
            This draft cites no evidence from your record. Read it closely before sending — it is
            the generic outreach Atlas exists to avoid.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          {/* The primary action: the whole point is that this is ready to paste. */}
          <CopyButton
            value={`${draft.subject}\n\n${body}`}
            label="Copy email"
            copiedLabel="Copied"
          />

          {draft.status === "approved" ? (
            <Button size="sm" variant="secondary" onClick={onMarkSent}>
              <CheckIcon className="size-4" />
              Mark sent
            </Button>
          ) : (
            <Button size="sm" variant="secondary" onClick={onApprove}>
              <CheckIcon className="size-4" />
              Approve
            </Button>
          )}

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
 * The contact, when the posting carried one. Most do not — they route through a form —
 * and saying so plainly is more useful than an empty field that looks broken.
 */
function Contact({ draft }: { draft: DraftRow }) {
  if (!draft.contactEmail) {
    return (
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <MailIcon className="size-3.5 shrink-0" />
        No address in the posting — apply through the link.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className="flex min-w-0 items-center gap-1.5 text-sm">
        <MailIcon className="text-muted-foreground size-3.5 shrink-0" />
        <a
          href={`mailto:${draft.contactEmail}?subject=${encodeURIComponent(draft.subject)}`}
          className="focus-visible:ring-ring truncate rounded font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          {draft.contactEmail}
        </a>
        {!draft.contactIsPersonal && (
          <span className="text-muted-foreground shrink-0 text-xs">· team inbox</span>
        )}
      </p>
      <CopyButton
        value={draft.contactEmail}
        label="Copy address"
        variant="ghost"
        className="h-7 px-2 text-xs"
      />
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground text-xs font-medium">{children}</span>;
}
