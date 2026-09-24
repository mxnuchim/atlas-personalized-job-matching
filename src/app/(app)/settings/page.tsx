import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { env } from "@/lib/env";
import { RUN_HOURS } from "@/lib/schedule";

export const metadata: Metadata = {
  title: "Settings",
};

const schedule = RUN_HOURS.map((h) => `${String(h).padStart(2, "0")}:00`).join(" and ");

const rows: { label: string; value: string }[] = [
  { label: "Sign-in", value: "Email & password" },
  { label: "Sending", value: "Manual approval only — auto-send is off" },
  { label: "Daily send cap", value: `${env.DAILY_SEND_CAP} / day` },
  { label: "Schedule", value: `${schedule} (${env.TZ})` },
  { label: "Scoring model", value: env.MODEL_SCORING },
  { label: "Drafting model", value: env.MODEL_DRAFTING },
];

export default function SettingsPage() {
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
        These come from environment configuration for now. In-app editing of sources, your
        profile, and your strengths arrives in later milestones.
      </p>
    </div>
  );
}
