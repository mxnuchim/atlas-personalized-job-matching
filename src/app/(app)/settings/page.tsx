import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { MODELS, PROVIDER } from "@/lib/llm";
import { RUN_HOURS } from "@/lib/schedule";

export const metadata: Metadata = {
  title: "Settings",
};

// Config is read per request; without this the page is prerendered and the values
// below would be whatever env held at build time.
export const dynamic = "force-dynamic";

const schedule = RUN_HOURS.map((h) => `${String(h).padStart(2, "0")}:00`).join(" and ");

// Built per request, not at module scope — module-scope values freeze at build time,
// so a deploy-time env change would not show here.
function configRows(): { label: string; value: string }[] {
  return [
    { label: "Sign-in", value: "Email & password" },
    { label: "Sending", value: "You send. Atlas drafts and tracks." },
    { label: "Schedule", value: `${schedule} (${env.TZ})` },
    { label: "Model provider", value: PROVIDER },
    { label: "Scoring model", value: MODELS.scoring },
    { label: "Drafting model", value: MODELS.drafting },
  ];
}

export default function SettingsPage() {
  const rows = configRows();
  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="How Atlas is configured for you." />

      <dl className="divide-border overflow-hidden rounded-xl border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="divide-border grid grid-cols-1 gap-1 border-b px-5 py-4 last:border-b-0 sm:grid-cols-[200px_1fr] sm:gap-4"
          >
            <dt className="text-muted-foreground text-sm">{row.label}</dt>
            <dd className="text-sm tabular-nums">{row.value}</dd>
          </div>
        ))}
      </dl>

      <p className="text-muted-foreground text-sm">
        These come from environment configuration for now. In-app editing of sources, your profile,
        and your strengths arrives in later milestones.
      </p>
    </div>
  );
}
