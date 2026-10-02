"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckIcon,
  ExternalLinkIcon,
  MailIcon,
  PenLineIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { Dialog } from "radix-ui";
import { toast } from "sonner";

import {
  dismissMatchAction,
  draftMatchAction,
  markAppliedAction,
} from "@/app/(app)/matches/actions";

import { CopyButton } from "@/components/copy-button";
import { TailorResumeButton } from "@/components/resume/tailor-button";
import { FitGauge } from "@/components/fit-gauge";
import { TierChip } from "@/components/tier-chip";
import type { MatchRow } from "@/db/queries/matches";
import { gmailComposeUrl, mailtoUrl } from "@/lib/gmail";
import { cn } from "@/lib/utils";

/**
 * The match drawer (PRD §10.3). Everything the score is made of, in the order you
 * actually read it: the gauge, why you, the strengths this role rewards, the
 * five-dimension breakdown, the reasoning, the red flags, then the posting.
 *
 * This is the one place in the app that carries a real shadow (§10.1) — earned,
 * because it floats above the console rather than sitting in it.
 */

const DIMENSIONS: { key: keyof MatchRow["dimensions"]; label: string }[] = [
  { key: "role_fit", label: "Role" },
  { key: "seniority_fit", label: "Seniority" },
  { key: "tech_fit", label: "Tech" },
  { key: "location_fit", label: "Location" },
  { key: "company_fit", label: "Company" },
];

export function MatchDrawer({
  match,
  strengthLabels,
  resumeReady = false,
  onOpenChange,
  onCloseFocus,
}: {
  match: MatchRow | null;
  strengthLabels: Record<string, string>;
  onOpenChange: (open: boolean) => void;
  /**
   * Where focus should land on close. The drawer is opened programmatically rather
   * than from a Radix trigger, so Radix has nothing to restore focus to and drops it
   * on `<body>` — which silently kills `j`/`k` for anyone working by keyboard.
   */
  onCloseFocus?: () => void;
  /** Whether you have a resume on file — without one, "Tailor resume" links to Profile instead. */
  resumeReady?: boolean;
}) {
  return (
    <Dialog.Root open={match !== null} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px] motion-reduce:animate-none dark:bg-black/50" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            onCloseFocus?.();
          }}
          className={cn(
            "bg-card fixed inset-y-0 right-0 z-50 flex w-full max-w-xl flex-col shadow-2xl outline-none",
            "data-[state=closed]:animate-out data-[state=open]:animate-in border-l",
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
            "duration-200 motion-reduce:animate-none motion-reduce:duration-0",
          )}
        >
          {/* Keyed by id so a different match remounts the body — resetting any inline
              draft state to that role, never carrying the previous one over. */}
          {match ? (
            <DrawerBody key={match.id} match={match} strengthLabels={strengthLabels} resumeReady={resumeReady} />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DrawerBody({
  match,
  strengthLabels,
  resumeReady,
}: {
  match: MatchRow;
  strengthLabels: Record<string, string>;
  resumeReady: boolean;
}) {
  const rewarded = [...match.strengthMatches].sort((a, b) => b.rewarded - a.rewarded);
  const location = match.location ?? (match.remote ? "Remote" : "Location not stated");

  // The draft the drawer just generated, shown inline. Reset when a different match opens
  // because `MatchDrawer` keys the body on the match, so this mounts fresh each time.
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);

  return (
    <>
      <header className="flex items-start gap-4 border-b px-6 py-5">
        {/* Keyed by id so re-opening a different match replays the sweep, and
            re-rendering the same one does not. */}
        <FitGauge key={match.id} value={match.overall} tier={match.tier} size="md" />

        <div className="min-w-0 flex-1">
          <Dialog.Title className="font-display text-lg leading-tight font-semibold text-balance">
            {match.title}
          </Dialog.Title>
          <Dialog.Description className="text-muted-foreground mt-1 text-sm">
            {match.company} · {location}
            {match.remote && match.location ? " · Remote" : ""}
            {match.postedAgeLabel ? ` · Posted ${match.postedAgeLabel}` : ""}
          </Dialog.Description>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <TierChip tier={match.tier} />
            {/* Closed outranks everything: a role that is gone should not be judged on
                how long it was open. */}
            {match.closed ? (
              <span className="text-destructive rounded-md px-2 py-0.5 text-xs ring-1 ring-current/30 ring-inset">
                No longer listed
              </span>
            ) : (
              /* A requisition that has sat open for months is a different prospect from
                 one that opened this week, and the fit score cannot tell you which. */
              match.evergreen && (
                <span className="text-muted-foreground rounded-md px-2 py-0.5 text-xs ring-1 ring-current/25 ring-inset">
                  Long open
                </span>
              )
            )}
          </div>
        </div>

        <Dialog.Close
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring -mt-1 -mr-2 rounded-md p-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          aria-label="Close"
        >
          <XIcon className="size-4" />
        </Dialog.Close>
      </header>

      {draft ? (
        <DraftReady
          match={match}
          subject={draft.subject}
          body={draft.body}
          onBack={() => setDraft(null)}
        />
      ) : (
        <>
          <div className="flex-1 space-y-7 overflow-y-auto px-6 py-6">
            <section>
              <SectionLabel>Why you</SectionLabel>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-pretty">{match.whyYou}</p>
            </section>

        {rewarded.length > 0 && (
          <section>
            <SectionLabel>Strengths this role rewards</SectionLabel>
            <ul className="mt-3 space-y-2.5">
              {rewarded.map((s) => (
                <li key={s.strength_key} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-sm text-pretty">
                    {strengthLabels[s.strength_key] ?? s.strength_key}
                  </span>
                  <Meter value={s.rewarded} className="w-20 shrink-0 sm:w-24" />
                  <span className="text-muted-foreground w-7 shrink-0 text-right text-xs tabular-nums">
                    {s.rewarded}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <SectionLabel>Fit breakdown</SectionLabel>
          <dl className="mt-3 space-y-2.5">
            {DIMENSIONS.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-3">
                <dt className="text-muted-foreground w-20 shrink-0 text-sm">{label}</dt>
                <dd className="flex flex-1 items-center gap-3">
                  <Meter value={match.dimensions[key]} className="flex-1" />
                  <span className="text-muted-foreground w-7 shrink-0 text-right text-xs tabular-nums">
                    {match.dimensions[key]}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section>
          <SectionLabel>Reasoning</SectionLabel>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed text-pretty">
            {match.reasoning}
          </p>
        </section>

        {match.redFlags.length > 0 && (
          <section>
            <SectionLabel>Red flags</SectionLabel>
            <ul className="mt-2 space-y-1.5">
              {match.redFlags.map((flag) => (
                <li key={flag} className="flex gap-2 text-sm">
                  <AlertTriangleIcon
                    className="text-destructive mt-0.5 size-3.5 shrink-0"
                    strokeWidth={2}
                  />
                  <span className="text-pretty">{flag}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <SectionLabel>The posting</SectionLabel>
          <p className="text-muted-foreground mt-2 text-sm leading-relaxed whitespace-pre-line">
            {match.description || "No description was provided by the source."}
          </p>
          {match.descriptionTruncated && (
            <p className="text-muted-foreground mt-2 text-xs">
              Shortened — open the original for the full posting.
            </p>
          )}
            </section>
          </div>

          <footer className="space-y-3 border-t px-6 py-4">
            <DrawerActions
              matchId={match.id}
              url={match.url}
              contactEmail={match.contactEmail}
              closed={match.closed}
              onDrafted={setDraft}
              jobId={match.jobId}
              resumeId={match.resumeId ?? null}
              resumeReady={resumeReady}
            />

            <p className="text-muted-foreground text-xs">
              Scored {match.scoredAtLabel} · {match.model}
            </p>
          </footer>
        </>
      )}
    </>
  );
}

/**
 * The draft, shown the moment it is generated — subject, who it goes to, and the body —
 * with one button to open it in Gmail ready to send. It is also saved to Review; this is
 * so you never have to leave the match to see what Atlas wrote.
 */
function DraftReady({
  match,
  subject,
  body,
  onBack,
}: {
  match: MatchRow;
  subject: string;
  body: string;
  onBack: () => void;
}) {
  const to = match.contactEmail;
  const gmail = gmailComposeUrl({ to, subject, body });

  return (
    <>
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6">
        <div className="flex items-center gap-2">
          <span className="bg-tier-strong/15 text-tier-strong inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium">
            <MailIcon className="size-3.5" />
            Draft ready
          </span>
          <button
            type="button"
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring ml-auto inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <ArrowLeftIcon className="size-3.5" />
            Back to match
          </button>
        </div>

        <div>
          <SectionLabel>To</SectionLabel>
          {to ? (
            <p className="mt-1 text-sm font-medium break-all">{to}</p>
          ) : (
            <p className="text-muted-foreground mt-1 text-sm">
              No address in the posting — apply through the link instead.
            </p>
          )}
        </div>

        <div>
          <SectionLabel>Subject</SectionLabel>
          <p className="mt-1 text-sm font-medium text-pretty">{subject}</p>
        </div>

        <div>
          <SectionLabel>Body</SectionLabel>
          <p className="mt-1 text-[0.9375rem] leading-relaxed whitespace-pre-line">{body}</p>
        </div>
      </div>

      <footer className="space-y-3 border-t px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* Primary: open Gmail compose, pre-filled. Atlas never sends — you read it and
              hit send yourself. */}
          <a
            href={gmail}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none"
          >
            <MailIcon className="size-4" />
            Open in Gmail
          </a>

          <CopyButton value={`${subject}\n\n${body}`} label="Copy email" copiedLabel="Copied" />

          <a
            href="/review"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring ml-auto inline-flex items-center gap-1.5 self-center rounded text-xs focus-visible:ring-2 focus-visible:outline-none"
          >
            Edit in Review
            <ExternalLinkIcon className="size-3" />
          </a>
        </div>

        <p className="text-muted-foreground text-xs">
          Saved to Review · or{" "}
          <a href={mailtoUrl({ to, subject, body })} className="hover:text-foreground underline">
            use your default mail app
          </a>
        </p>
      </footer>
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <h3 className="text-muted-foreground text-sm font-medium">{children}</h3>;
}

/** A quiet bar. Uses the accent, not a tier colour — this is magnitude, not verdict. */
function Meter({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("bg-muted h-1 overflow-hidden rounded-full", className)}>
      <span
        className="bg-primary/70 block h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  );
}

/**
 * What you can do about a match you have just read.
 *
 * Almost every role applies through its posting — an ATS form on Ashby, Greenhouse,
 * Lever — so **Apply** (opening that link) is the primary action. A draft is only useful
 * when the posting exposes a real address to write to, so "Draft email" appears only
 * then; link-apply roles are never auto-drafted either (see `runDraft`). A closed role
 * can still be read but neither applied to nor drafted for.
 */
function DrawerActions({
  matchId,
  url,
  contactEmail,
  closed,
  onDrafted,
  jobId,
  resumeId,
  resumeReady,
}: {
  matchId: string;
  url: string;
  contactEmail: string | null;
  closed: boolean;
  /** Hand a freshly generated draft up so the drawer can show it inline. */
  onDrafted: (draft: { subject: string; body: string }) => void;
  jobId: string;
  resumeId: string | null;
  resumeReady: boolean;
}) {
  const [pending, startTransition] = useTransition();

  function run(action: typeof dismissMatchAction, working: string) {
    startTransition(async () => {
      const id = toast.loading(working);
      const result = await action({ matchId });
      toast.dismiss(id);
      if (result.ok) toast.success(result.message ?? "Done.");
      else toast.error(result.error);
    });
  }

  function draftNow() {
    startTransition(async () => {
      const id = toast.loading("Writing a draft…");
      const result = await draftMatchAction({ matchId });
      toast.dismiss(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // Show it inline. `draft` is populated on the single-match path; if it's ever
      // missing, fall back to the toast that points at Review rather than swallowing it.
      if (result.draft) onDrafted(result.draft);
      else toast.success(result.message ?? "Draft ready in Review.");
    });
  }

  if (closed) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <XCircleIcon className="size-4 shrink-0" />
        This role has closed.
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary-ink focus-visible:ring-ring ml-auto inline-flex items-center gap-1.5 rounded-md font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          View posting
          <ExternalLinkIcon className="size-3.5" />
        </a>
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* The application link is the action for almost every role — the loudest control. */}
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none"
      >
        <ExternalLinkIcon className="size-4" />
        Apply
      </a>

      {/* Tailor before you apply: the posting's keywords, your experience. */}
      <TailorResumeButton jobId={jobId} resumeId={resumeId} ready={resumeReady} />

      {/* Only when the posting gives you someone to email. */}
      {contactEmail && (
        <button
          type="button"
          disabled={pending}
          onClick={draftNow}
          className="border-border bg-card text-foreground hover:bg-muted focus-visible:ring-ring inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
        >
          <PenLineIcon className="size-4" />
          Draft email
        </button>
      )}

      {/* Track that you applied — works whether or not a draft exists, since it opens
          the outreach row if needed (same as the Today queue). */}
      <button
        type="button"
        disabled={pending}
        onClick={() => run(markAppliedAction, "Tracking…")}
        className="border-border bg-card text-tier-strong-ink hover:bg-muted focus-visible:ring-ring inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
      >
        <CheckIcon className="size-4" />
        I applied
      </button>

      <button
        type="button"
        disabled={pending}
        onClick={() => run(dismissMatchAction, "Closing…")}
        className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring ml-auto inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
      >
        <XCircleIcon className="size-4" />
        Not interested
      </button>
    </div>
  );
}
