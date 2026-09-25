/**
 * Pull a contact address out of a job posting.
 *
 * Most postings have none — they route through an application form — so this returns
 * null far more often than not, and that is the honest answer. What it must never do is
 * surface a noreply address as if a human were behind it.
 */

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** Local parts that never reach a person. */
const NOREPLY =
  /^(no-?reply|do-?not-?reply|donotreply|bounce|mailer-daemon|postmaster|automated|notifications?|alerts?|support|help|billing|privacy|legal|security|abuse|info|webmaster|admin|sales|marketing)\b/i;

/**
 * Domain labels belonging to a platform rather than the employer. Matched per label,
 * not as a suffix: an applicant-tracking address is as likely to be
 * `hr@acme.myworkdaysite.com` as `jobs@boards.greenhouse.io`, and a suffix match
 * catches only the second.
 */
const PLATFORM_LABELS = new Set([
  "greenhouse",
  "lever",
  "ashbyhq",
  "workday",
  "myworkdaysite",
  "smartrecruiters",
  "jobvite",
  "icims",
  "taleo",
  "bamboohr",
  "workable",
  "breezy",
  "recruitee",
  "teamtailor",
  // Placeholder and boilerplate domains that appear in inline markup.
  "example",
  "sentry",
  "schema",
  "w3",
]);

function isPlatformDomain(domain: string): boolean {
  return domain.split(".").some((label) => PLATFORM_LABELS.has(label));
}

/** Image and asset names that the address regex picks up out of inline markup. */
const NOT_AN_ADDRESS = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;

export type Contact = {
  email: string;
  /** True when the local part looks like a named person rather than a role mailbox. */
  personal: boolean;
};

function isPlausible(email: string): boolean {
  const [local = "", domain = ""] = email.toLowerCase().split("@");
  if (!local || !domain) return false;
  if (NOT_AN_ADDRESS.test(email)) return false;
  if (NOREPLY.test(local)) return false;
  if (isPlatformDomain(domain)) return false;
  return true;
}

/** `firstname.lastname@` or `flast@` reads as a person; `careers@` does not. */
function looksPersonal(email: string): boolean {
  const local = (email.split("@")[0] ?? "").toLowerCase();
  if (
    /^(careers?|jobs?|hiring|recruit(ing|ment)?|talent|apply|hr|people|team|contact|hello|hey)\b/.test(
      local,
    )
  ) {
    return false;
  }
  return /^[a-z]+([._-][a-z]+)+$/.test(local) || /^[a-z]{4,}$/.test(local);
}

/**
 * The best contact in a posting, or null. Prefers an address that looks like a person
 * over a role mailbox — `maria.chen@` is worth more than `careers@`.
 */
export function extractContact(text: string | null | undefined): Contact | null {
  if (!text) return null;

  const seen = new Set<string>();
  const candidates: Contact[] = [];

  for (const match of text.matchAll(EMAIL)) {
    const email = match[0].toLowerCase().replace(/[.,;:)]+$/, "");
    if (seen.has(email) || !isPlausible(email)) continue;
    seen.add(email);
    candidates.push({ email, personal: looksPersonal(email) });
  }

  return candidates.find((c) => c.personal) ?? candidates[0] ?? null;
}
