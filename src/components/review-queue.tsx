"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CheckIcon, ExternalLinkIcon, QuoteIcon, SendIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { FitGauge } from "@/components/fit-gauge";
import { TierChip } from "@/components/tier-chip";
import { Button } from "@/components/ui/button";
import type { DraftRow } from "@/db/queries/drafts";
import type { SendDecision } from "@/lib/sending/guardrails";
import {
  approveDraftAction,
  saveDraftEditAction,
  sendDraftAction,
  setRecipientAction,
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
  decisions,
}: {
  drafts: DraftRow[];
  strengthLabels: Record<string, string>;
  /** Server-evaluated guardrails, keyed by draft id. Rendered, never re-derived. */
  decisions: Record<string, SendDecision>;
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
            decision={decisions[draft.id]}
            onApprove={() => runDecision(draft, approveDraftAction, "Approved")}
            onSkip={() => runDecision(draft, skipDraftAction, "Skipped")}
            onSent={() => decide(draft.id)}
          />
        ))}
      </AnimatePresence>
    </ul>
  );
}

function DraftCard({
  draft,
  strengthLabels,
  decision,
  onApprove,
  onSkip,
  onSent,
}: {
  draft: DraftRow;
  strengthLabels: Record<string, string>;
  decision: SendDecision | undefined;
  onApprove: () => void;
  onSkip: () => void;
  onSent: () => void;
}) {
  const reduced = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft.editedBody ?? draft.body);
  const [saving, startSaving] = useTransition();
  const [sending, startSending] = useTransition();
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

  function send() {
    startSending(async () => {
      const result = await sendDraftAction({ draftId: draft.id });
      if (!result.ok) {
        // Name every blocking guardrail, not just "cannot send" — the whole point of
        // the readout is that you can tell *which* rule stopped it.
        toast.error(result.error, {
          description: result.blockedBy?.join(" · "),
          duration: 8000,
        });
        return;
      }
      toast.success(
        result.dryRun ? `Dry run — nothing left the mailbox` : `Sent to ${draft.company}`,
      );
      onSent();
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

        <RecipientField draft={draft} />

        <Guardrails decision={decision} />

        <div className="flex flex-wrap gap-2">
          {draft.status === "approved" ? (
            <Button size="sm" onClick={send} disabled={sending || decision?.allowed === false}>
              <SendIcon className="size-4" />
              {sending ? "Sending…" : "Send"}
            </Button>
          ) : (
            <Button size="sm" onClick={onApprove}>
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
 * Manual recipient entry. A job posting never carries a human's address, and guessing
 * one bounces — §11 caps bounce at 2% because bounces cost sender reputation. Blank is
 * an honest "not known yet"; the send button stays disabled until it is filled.
 */
function RecipientField({ draft }: { draft: DraftRow }) {
  const [value, setValue] = useState(draft.recipient ?? "");
  const [saving, startSaving] = useTransition();
  const dirty = value.trim() !== (draft.recipient ?? "");

  function save() {
    startSaving(async () => {
      const result = await setRecipientAction({ draftId: draft.id, recipient: value });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(value.trim() ? "Recipient saved" : "Recipient cleared");
    });
  }

  return (
    <div>
      <Label>Recipient</Label>
      <div className="mt-1.5 flex flex-wrap gap-2">
        <input
          type="email"
          inputMode="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) {
              e.preventDefault();
              save();
            }
          }}
          placeholder="name@company.com"
          aria-label={`Recipient for ${draft.title}`}
          className="border-input bg-background focus-visible:border-ring focus-visible:ring-ring/50 h-9 min-w-0 flex-1 rounded-lg border px-3 text-sm transition-colors focus-visible:ring-3 focus-visible:outline-none sm:max-w-xs"
        />
        {dirty && (
          <Button size="sm" variant="secondary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * What stands between this draft and a send (PRD §10.3 #4). These are the guardrails
 * the server evaluated, rendered verbatim — not a second opinion computed here. An
 * earlier version re-derived the cap in the browser and confidently displayed 30 while
 * the warm-up ramp was enforcing 5.
 */
function Guardrails({ decision }: { decision: SendDecision | undefined }) {
  if (!decision) return null;

  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {decision.guardrails.map((check) => (
        <li
          key={check.id}
          className={cn(
            "flex items-center gap-1.5 text-xs",
            check.status === "fail" ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <span
            aria-hidden
            className="size-1.5 rounded-full"
            style={{
              backgroundColor:
                check.status === "pass"
                  ? "var(--tier-strong)"
                  : check.status === "fail"
                    ? "var(--tier-possible)"
                    : "var(--tier-stretch)",
            }}
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
