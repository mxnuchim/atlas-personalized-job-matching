import type { ReactNode } from "react";

/** Empty state as direction (PRD §10.3 / §10.6) — invites the next action, never apologizes. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-16 text-center">
      {icon ? (
        <div className="text-muted-foreground mb-4" aria-hidden>
          {icon}
        </div>
      ) : null}
      <h2 className="font-display text-lg font-medium">{title}</h2>
      <p className="text-muted-foreground mt-1.5 max-w-md text-sm text-balance">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
