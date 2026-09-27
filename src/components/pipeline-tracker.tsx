"use client";

import { useState, useTransition } from "react";
import { ChevronDownIcon, HandIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { toast } from "sonner";

import { setOutreachStatusAction } from "@/app/(app)/pipeline/actions";
import { FitGauge } from "@/components/fit-gauge";
import { TierChip } from "@/components/tier-chip";
import type { PipelineRow } from "@/db/queries/outreach";
import { allowedTransitions, STAGE_LABEL, STAGE_TOKEN } from "@/lib/outreach";

/**
 * The funnel, and the control that moves a role through it.
 *
 * Until this existed the tracker was a read-only mirror of a state machine with one
 * transition: `recordSend` wrote `sent` and nothing could write anything else, so six
 * of the eight stages were unreachable and the §11 reply guard could never fire.
 *
 * The menu offers only legal moves, from the same `allowedTransitions` the server
 * enforces — so the UI cannot suggest something the action will refuse.
 */

export function PipelineTracker({ rows }: { rows: PipelineRow[] }) {
  return (
    <ul className="divide-border overflow-hidden rounded-xl border">
      {rows.map((row) => (
        <Row key={row.id} row={row} />
      ))}
    </ul>
  );
}

function Row({ row }: { row: PipelineRow }) {
  const [pending, startTransition] = useTransition();
  // Optimistic locally so the chip changes the instant you choose, and reverts loudly
  // if the server refuses.
  const [status, setStatus] = useState(row.status);
  const moves = allowedTransitions(status);

  // §11 made visible: once they reply, Atlas stops chasing.
  const halted = status === "replied";

  function move(to: PipelineRow["status"]) {
    const previous = status;
    setStatus(to);
    startTransition(async () => {
      const result = await setOutreachStatusAction({ outreachId: row.id, status: to });
      if (!result.ok) {
        setStatus(previous);
        toast.error(result.error);
      }
    });
  }

  return (
    <li className="flex items-center gap-4 border-b px-5 py-3 last:border-b-0">
      <FitGauge value={row.overall} tier={row.tier} size="sm" />

      <div className="min-w-0 flex-1">
        <a
          href={row.url}
          target="_blank"
          rel="noopener noreferrer"
          className="focus-visible:ring-ring block truncate rounded text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
        >
          {row.title}
        </a>
        <p className="text-muted-foreground truncate text-xs">
          {row.company}
          {row.recipient ? ` · ${row.recipient}` : ""}
        </p>
      </div>

      {halted && (
        <span className="text-tier-strong hidden items-center gap-1.5 text-xs sm:flex">
          <HandIcon className="size-3.5" />
          Chasing stopped
        </span>
      )}

      <span className="text-muted-foreground hidden text-xs tabular-nums md:block">
        {row.repliedAtLabel ?? row.sentAtLabel ?? "—"}
      </span>

      {moves.length === 0 ? (
        <StageChip status={status} />
      ) : (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            disabled={pending}
            className="focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
            aria-label={`Change stage from ${STAGE_LABEL[status]}`}
          >
            <StageChip status={status} withChevron />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="bg-card z-50 min-w-36 overflow-hidden rounded-lg border p-1 shadow-lg"
            >
              {moves.map((to) => (
                <DropdownMenu.Item
                  key={to}
                  onSelect={() => move(to)}
                  className="data-[highlighted]:bg-muted flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none"
                >
                  <span
                    aria-hidden
                    className="size-1.5 rounded-full"
                    style={{ backgroundColor: `var(${STAGE_TOKEN[to]})` }}
                  />
                  {STAGE_LABEL[to]}
                </DropdownMenu.Item>
              ))}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}

      <TierChip tier={row.tier} className="hidden lg:inline-flex" />
    </li>
  );
}

function StageChip({
  status,
  withChevron = false,
}: {
  status: PipelineRow["status"];
  withChevron?: boolean;
}) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
      style={{
        color: `var(${STAGE_TOKEN[status]})`,
        backgroundColor: `color-mix(in oklab, var(${STAGE_TOKEN[status]}) 12%, transparent)`,
        // @ts-expect-error — custom property for the ring utility.
        "--tw-ring-color": `color-mix(in oklab, var(${STAGE_TOKEN[status]}) 28%, transparent)`,
      }}
    >
      {STAGE_LABEL[status]}
      {withChevron && <ChevronDownIcon className="size-3 opacity-70" />}
    </span>
  );
}
