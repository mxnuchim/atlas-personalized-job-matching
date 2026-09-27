"use client";

import { useState, useTransition } from "react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  createSourceAction,
  deleteSourceAction,
  toggleSourceAction,
} from "@/app/(app)/sources/actions";
import type { SourceRow } from "@/db/queries/sources";
import { relativeAge } from "@/lib/age";
import { shouldSkip } from "@/pipeline/source-health";
import { cn } from "@/lib/utils";

/**
 * The sources screen's interactive half (§9: client islands inside a server shell).
 *
 * Disabling is the reversible control and is one click. Deleting cascades into jobs,
 * matches and drafts, so it asks first and says what it will destroy — the cascade is
 * invisible from the button, and that is exactly when a confirmation earns its place.
 */

const ADAPTERS = ["remotive", "arbeitnow", "himalayas", "jobicy"] as const;
const BOARD_KINDS = ["greenhouse", "lever", "ashby"] as const;

type Kind = (typeof BOARD_KINDS)[number] | "api";

function configSummary(source: SourceRow): string {
  const config = source.config as Record<string, unknown>;
  if (source.kind === "api") {
    return `${String(config.adapter ?? "?")} · limit ${String(config.limit ?? "?")}`;
  }
  return String(config.board ?? "?");
}

export function SourcesManager({ sources, isOwner }: { sources: SourceRow[]; isOwner: boolean }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);

  function toggle(source: SourceRow) {
    startTransition(async () => {
      const result = await toggleSourceAction({ id: source.id, enabled: !source.enabled });
      if (!result.ok) toast.error(result.error);
    });
  }

  function remove(source: SourceRow) {
    startTransition(async () => {
      const result = await deleteSourceAction({ id: source.id, expectedJobs: source.jobCount });
      if (result.ok) toast.success(`Removed ${source.name}.`);
      else toast.error(result.error);
      setConfirming(null);
    });
  }

  return (
    <div className="space-y-6">
      <AddSourceForm pending={pending} startTransition={startTransition} />

      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="text-muted-foreground border-b text-xs">
            <tr>
              <th className="px-4 py-2.5 text-left font-medium">Source</th>
              <th className="hidden px-4 py-2.5 text-left font-medium sm:table-cell">Kind</th>
              <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell">Config</th>
              <th className="hidden px-4 py-2.5 text-left font-medium md:table-cell">Health</th>
              <th className="px-4 py-2.5 text-right font-medium">Open</th>
              <th className="px-4 py-2.5 text-right font-medium">Status</th>
              <th className="w-10 px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {sources.map((source) => (
              <tr key={source.id} className={cn(!source.enabled && "opacity-55")}>
                <td className="px-4 py-2.5 font-medium">{source.name}</td>
                <td className="text-muted-foreground hidden px-4 py-2.5 sm:table-cell">
                  {source.kind}
                </td>
                <td className="text-muted-foreground hidden truncate px-4 py-2.5 md:table-cell">
                  {configSummary(source)}
                </td>
                <td className="text-muted-foreground hidden px-4 py-2.5 text-xs md:table-cell">
                  <Health source={source} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {source.openCount}
                  {source.jobCount !== source.openCount && (
                    <span className="text-muted-foreground text-xs"> / {source.jobCount}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => toggle(source)}
                    disabled={pending || (source.enabled && !isOwner)}
                    title={
                      source.enabled && !isOwner
                        ? "Only the owner can turn a source off — it changes everyone's corpus"
                        : undefined
                    }
                    aria-pressed={source.enabled}
                    className="focus-visible:ring-ring rounded-md px-2 py-0.5 text-xs ring-1 transition-colors ring-inset focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
                    style={{
                      color: `var(${source.enabled ? "--tier-strong-ink" : "--muted-foreground"})`,
                      // @ts-expect-error — custom property for the ring utility.
                      "--tw-ring-color": `color-mix(in oklab, currentColor 30%, transparent)`,
                    }}
                  >
                    {source.enabled ? "Enabled" : "Disabled"}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {confirming === source.id ? (
                    <span className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => remove(source)}
                        disabled={pending}
                        className="text-destructive focus-visible:ring-ring rounded text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        Delete {source.jobCount} postings
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirming(null)}
                        className="text-muted-foreground focus-visible:ring-ring rounded text-xs hover:underline focus-visible:ring-2 focus-visible:outline-none"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirming(source.id)}
                      className="text-muted-foreground hover:text-destructive focus-visible:ring-ring rounded p-1 transition-colors focus-visible:ring-2 focus-visible:outline-none"
                      aria-label={`Remove ${source.name}`}
                    >
                      <Trash2Icon className="size-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddSourceForm({
  pending,
  startTransition,
}: {
  pending: boolean;
  startTransition: (fn: () => void) => void;
}) {
  const [kind, setKind] = useState<Kind>("greenhouse");
  const [board, setBoard] = useState("");
  const [company, setCompany] = useState("");
  const [adapter, setAdapter] = useState<(typeof ADAPTERS)[number]>("remotive");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const input =
      kind === "api"
        ? { kind, config: { adapter, limit: 200 } }
        : { kind, config: { board, company } };

    startTransition(async () => {
      const result = await createSourceAction(input);
      if (result.ok) {
        toast.success("Source added. It will be read on the next run.");
        setBoard("");
        setCompany("");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      className="bg-card flex flex-wrap items-end gap-3 rounded-xl border p-4"
    >
      <Field label="Kind">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as Kind)}
          className="border-input focus-visible:ring-ring h-9 rounded-lg border bg-transparent px-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          {BOARD_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
          <option value="api">aggregator</option>
        </select>
      </Field>

      {kind === "api" ? (
        <Field label="Aggregator">
          <select
            value={adapter}
            onChange={(e) => setAdapter(e.target.value as (typeof ADAPTERS)[number])}
            className="border-input focus-visible:ring-ring h-9 rounded-lg border bg-transparent px-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            {ADAPTERS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <>
          <Field label="Board token" hint="e.g. stripe">
            <input
              value={board}
              onChange={(e) => setBoard(e.target.value)}
              required
              className="border-input focus-visible:ring-ring h-9 w-40 rounded-lg border bg-transparent px-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
          </Field>
          <Field label="Company" hint="shown in the UI">
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              required
              className="border-input focus-visible:ring-ring h-9 w-40 rounded-lg border bg-transparent px-2.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
          </Field>
        </>
      )}

      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50"
      >
        <PlusIcon className="size-4" />
        Add source
      </button>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground text-xs">
        {label}
        {hint ? <span className="opacity-70"> · {hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

/**
 * What is actually happening with this board.
 *
 * Three different facts used to hide behind one switch: whether anyone wants it,
 * whether it works, and who decided. Saying them separately is the whole point — a
 * board that is off because Anwuri turned it off on Tuesday is a different situation
 * from one that has failed twelve runs in a row, and "Disabled" described both.
 */
function Health({ source }: { source: SourceRow }) {
  if (!source.enabled) {
    return (
      <span>
        Off
        {source.disabledByName ? ` · by ${source.disabledByName}` : ""}
        {source.disabledAt ? ` · ${relativeAge(new Date(source.disabledAt))}` : ""}
      </span>
    );
  }

  const rest = shouldSkip({
    consecutiveFailures: source.consecutiveFailures,
    lastErrorAt: source.lastErrorAt ? new Date(source.lastErrorAt) : null,
  });

  if (rest.skip) {
    return (
      <span className="text-destructive" title={source.lastError ?? undefined}>
        Resting · {source.consecutiveFailures} failures
      </span>
    );
  }

  if (source.consecutiveFailures > 0) {
    return (
      <span style={{ color: "var(--tier-possible-ink)" }} title={source.lastError ?? undefined}>
        {source.consecutiveFailures} recent{" "}
        {source.consecutiveFailures === 1 ? "failure" : "failures"}
      </span>
    );
  }

  // Never fetched is not the same as healthy, and an em dash says so without inventing
  // a status the row has not earned.
  return <span>{source.lastOkAt ? `OK · ${relativeAge(new Date(source.lastOkAt))}` : "—"}</span>;
}
