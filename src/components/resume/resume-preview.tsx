import type { TailoredResume } from "@/lib/resume/types";

/**
 * The resume as the PDF will lay it out — same order, same type, same greys — on a white
 * sheet in both themes. A document is paper; showing it on navy would preview something
 * you'll never download. The one deliberate exception to theme tokens in the app.
 */

function dateRange(start: string | null, end: string | null, current: boolean): string {
  return [start, current ? "Present" : end].filter(Boolean).join(" – ");
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-5 mb-2 border-b border-[#999999] pb-0.5 text-[11px] font-bold tracking-[0.06em] uppercase">
      {children}
    </h3>
  );
}

export function ResumePreview({ resume }: { resume: TailoredResume }) {
  const { contact } = resume;
  const contactLine = [contact.location, contact.email, contact.phone, ...contact.links.map((l) => l.url)]
    .filter(Boolean)
    .join("  |  ");

  return (
    <article
      aria-label="Resume preview"
      className="mx-auto w-full max-w-[794px] rounded-sm bg-white px-6 py-7 text-[13px] leading-[1.45] text-[#111111] shadow-sm ring-1 ring-black/10 sm:px-12 sm:py-10"
      style={{ fontFamily: "Helvetica, Arial, sans-serif" }}
    >
      <h2 className="text-[24px] leading-tight font-bold">{contact.name}</h2>
      {resume.headline ? <p className="mt-1 text-[14px]">{resume.headline}</p> : null}
      <p className="mt-1.5 text-[11.5px] break-words text-[#555555]">{contactLine}</p>

      {resume.summary ? (
        <>
          <Heading>Summary</Heading>
          <p>{resume.summary}</p>
        </>
      ) : null}

      {resume.roles.length > 0 ? (
        <>
          <Heading>Experience</Heading>
          <div className="space-y-3">
            {resume.roles.map((role) => (
              <div key={role.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <p className="font-bold">
                    {role.title}, {role.company}
                  </p>
                  <p className="text-[#555555]">{dateRange(role.start, role.end, role.current)}</p>
                </div>
                {role.location ? <p className="text-[12px] text-[#555555]">{role.location}</p> : null}
                <ul className="mt-1 space-y-0.5">
                  {role.bullets.map((b, i) => (
                    <li key={`${b.sourceId}-${i}`} className="flex gap-2">
                      <span aria-hidden>•</span>
                      <span>{b.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {resume.projects.length > 0 ? (
        <>
          <Heading>Projects</Heading>
          <div className="space-y-3">
            {resume.projects.map((p) => (
              <div key={p.id}>
                <p className="font-bold">{p.name}</p>
                {p.description ? <p className="text-[12px] text-[#555555]">{p.description}</p> : null}
                <ul className="mt-1 space-y-0.5">
                  {p.bullets.map((b, i) => (
                    <li key={`${b.sourceId}-${i}`} className="flex gap-2">
                      <span aria-hidden>•</span>
                      <span>{b.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {resume.skills.length > 0 ? (
        <>
          <Heading>Skills</Heading>
          <p>{resume.skills.join(", ")}</p>
        </>
      ) : null}

      {resume.education.length > 0 ? (
        <>
          <Heading>Education</Heading>
          {resume.education.map((e, i) => (
            <div key={i} className="flex flex-wrap items-baseline justify-between gap-x-4">
              <p className="font-bold">
                {[[e.degree, e.field].filter(Boolean).join(" "), e.school].filter(Boolean).join(", ")}
              </p>
              <p className="text-[#555555]">{[e.start, e.end].filter(Boolean).join(" – ")}</p>
            </div>
          ))}
        </>
      ) : null}

      {resume.certifications.length > 0 ? (
        <>
          <Heading>Certifications</Heading>
          {resume.certifications.map((c, i) => (
            <p key={i}>{[c.name, c.issuer, c.year].filter(Boolean).join(", ")}</p>
          ))}
        </>
      ) : null}
    </article>
  );
}
