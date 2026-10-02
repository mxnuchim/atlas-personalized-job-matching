import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { z } from "zod";

import { PageHeader } from "@/components/page-header";
import { ResumeWorkspace } from "@/components/resume/resume-workspace";
import { getOwnedTailored } from "@/db/queries/resumes";
import { coveragePercent } from "@/lib/resume/report";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Tailored resume",
};

export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function TailoredResumePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  // Scoped to you in the query: someone else's resume is indistinguishable from none.
  const row = await getOwnedTailored(id, session.user.id);
  if (!row) notFound();

  const pct = coveragePercent(row.report);
  const parts = [
    row.company ?? "Pasted posting",
    pct === null ? null : `${pct}% of must-have keywords`,
    `updated ${DATE.format(row.updatedAt)}`,
    row.usedAt ? `applied ${DATE.format(row.usedAt)}` : null,
  ].filter(Boolean);

  return (
    <div>
      <Link
        href="/resume"
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mb-4 inline-flex items-center gap-1.5 rounded text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <ArrowLeftIcon className="size-3.5" /> All resumes
      </Link>
      <PageHeader title={row.title} description={parts.join(" · ")} />
      <ResumeWorkspace
        id={row.id}
        resume={row.content}
        report={row.report}
        coverLetter={row.coverLetter}
        coverLetterWarnings={row.coverLetterWarnings}
        costLabel={`$${Number(row.costUsd).toFixed(4)}`}
      />
    </div>
  );
}
