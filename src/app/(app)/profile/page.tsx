import type { Metadata } from "next";
import { UserRoundIcon } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { ProfileImporter } from "@/components/profile-importer";
import { requireProfile } from "@/lib/session";

export const metadata: Metadata = {
  title: "Profile",
};

export const dynamic = "force-dynamic";

/**
 * Your positioning — what every score is measured against.
 *
 * This screen exists because the profile used to arrive from a JSON file on one
 * person's laptop, which meant a second user was impossible without a CLI. The data
 * shape was never the problem; having no way to create it was.
 */
export default async function ProfilePage() {
  const { profile } = await requireProfile();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Profile"
        description={
          profile
            ? `Version ${profile.version}. Every match is scored against this.`
            : "Set this up first — nothing can be scored until Atlas knows what you are."
        }
      />

      {profile ? (
        <section className="bg-card overflow-hidden rounded-xl border">
          <div className="flex items-start gap-3 border-b px-5 py-4">
            <UserRoundIcon
              className="text-muted-foreground mt-0.5 size-5 shrink-0"
              strokeWidth={1.75}
            />
            <div className="min-w-0">
              <p className="font-medium text-pretty">{profile.headline}</p>
              <p className="text-muted-foreground mt-1 text-sm">
                {profile.name ?? "No name set"}
                {profile.seniority ? ` · ${profile.seniority}` : ""}
                {profile.locations.length > 0 ? ` · ${profile.locations.join("; ")}` : ""}
              </p>
              {/* Named explicitly: `runDraft` refuses without both, and discovering
                  that at 06:00 from a skipped stage is a bad way to learn it. */}
              {(!profile.name || !profile.portfolioUrl) && (
                <p className="text-destructive mt-2 text-sm">
                  Drafting is blocked until your profile has
                  {!profile.name ? " a name" : ""}
                  {!profile.name && !profile.portfolioUrl ? " and" : ""}
                  {!profile.portfolioUrl ? " a portfolio link" : ""}.
                </p>
              )}
            </div>
          </div>

          <ul className="divide-border divide-y">
            {profile.strengths.map((strength) => (
              <li key={strength.id} className="flex items-baseline gap-3 px-5 py-2.5">
                <span className="min-w-0 flex-1 truncate text-sm">{strength.label}</span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {strength.kind} · weight {strength.weight} · {strength.evidence.length} evidence
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <ProfileImporter hasProfile={profile !== null} />
    </div>
  );
}
