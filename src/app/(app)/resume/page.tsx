import type { Metadata } from "next";
import Link from "next/link";
import { FileTextIcon } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/pagination";
import { ResumeGenerator } from "@/components/resume/resume-generator";
import { hasMasterResume, listTailored, resumeUsageLastDay } from "@/db/queries/resumes";
import { env } from "@/lib/env";
import { parsePageParams } from "@/lib/pagination";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Resume",
};

export const dynamic = "force-dynamic";

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Tailored resumes. Gated on a source resume: with none on file there is nothing to
 * tailor from, so the page says where to add one instead of offering a form that can't work.
 */
export default async function ResumePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string }>;
}) {
  const session = await requireSession();
  const userId = session.user.id;
  const { page, pageSize } = parsePageParams(await searchParams, { defaultPageSize: 20 });

  const [ready, list, usage] = await Promise.all([
    hasMasterResume(userId),
    listTailored(userId, { page, pageSize }),
    resumeUsageLastDay(userId),
  ]);

  if (!ready) {
    return (
      <div className="space-y-8">
        <PageHeader
          title="Resume"
          description="Tailor your resume to the roles you choose — their keywords, backed by your experience. Only when you ask."
        />
        <EmptyState
          icon={<FileTextIcon className="size-7" strokeWidth={1.5} />}
          title="Add your resume first"
          description="Tailoring starts from your own resume. Upload a PDF or Word file, or paste the text, in Profile — then come back and tailor it to any role."
          action={
            <Link
              href="/profile#resume"
              className="bg-primary text-primary-foreground focus-visible:ring-ring inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:outline-none"
            >
              Add your resume
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        title="Resume"
        description={
          list.total > 0
            ? `${list.total} tailored. Each one keeps your facts and speaks the role's language.`
            : "Tailor your resume to a role — its keywords, your experience."
        }
      />

      <ResumeGenerator />

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-semibold">Tailored</h2>
          {/* Spend you can see is spend you can control. */}
          <p className="text-muted-foreground text-xs tabular-nums">
            Last 24h: {usage.calls} of {env.RESUME_DAILY_LIMIT} generations · ${usage.costUsd.toFixed(3)}
          </p>
        </div>

        {list.total === 0 ? (
          <p className="text-muted-foreground rounded-xl border border-dashed px-5 py-10 text-center text-sm">
            Nothing tailored yet. Paste a posting above, or open any match and choose{" "}
            <span className="text-foreground font-medium">Tailor resume</span>.
          </p>
        ) : (
          <ul className="divide-border divide-y overflow-hidden rounded-xl border">
            {list.items.map((r) => {
              const { matched, total } = r.coverage.mustHave;
              return (
                <li key={r.id}>
                  <Link
                    href={`/resume/${r.id}`}
                    className="hover:bg-secondary/40 focus-visible:ring-ring flex flex-col gap-1 px-4 py-3.5 transition-colors focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.title}</p>
                      <p className="text-muted-foreground truncate text-sm">
                        {r.company ?? "Pasted posting"}
                        {r.jobId ? "" : " · pasted"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
                      {r.usedAt ? (
                        <span className="text-tier-strong-ink rounded-md px-1.5 py-0.5 ring-1 ring-current/30 ring-inset">
                          Applied
                        </span>
                      ) : null}
                      {r.hasCoverLetter ? (
                        <span className="text-muted-foreground rounded-md px-1.5 py-0.5 ring-1 ring-current/25 ring-inset">
                          Cover letter
                        </span>
                      ) : null}
                      <span className="text-muted-foreground tabular-nums" title="Must-have keywords on the page">
                        {total > 0 ? `${matched}/${total} keywords` : "—"}
                      </span>
                      <span className="text-muted-foreground tabular-nums">{DATE.format(r.updatedAt)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <Pagination page={list.page} totalPages={list.totalPages} total={list.total} from={list.from} to={list.to} />
      </section>
    </div>
  );
}
