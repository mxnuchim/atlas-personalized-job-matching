/**
 * One-click handoff to Gmail's web compose, pre-filled.
 *
 * Atlas never sends — it hands you a finished draft and gets out of the way. The fastest
 * path from "draft ready" to "sent" is Gmail's compose URL, which opens a new message in
 * whatever account the browser is already signed into, with recipient, subject and body
 * filled. You read it, then send.
 *
 * `view=cm&fs=1` is Gmail's "compose, full-screen" mode. Params are URL-encoded via
 * `URLSearchParams` (space → `+`, newline → `%0A`), both of which Gmail decodes correctly.
 * Empty fields are omitted so the URL never carries `su=` with nothing after it.
 */
export function gmailComposeUrl(opts: {
  to?: string | null;
  subject?: string | null;
  body?: string | null;
  cc?: string | null;
  bcc?: string | null;
}): string {
  const params = new URLSearchParams({ view: "cm", fs: "1" });
  if (opts.to) params.set("to", opts.to);
  if (opts.subject) params.set("su", opts.subject);
  if (opts.body) params.set("body", opts.body);
  if (opts.cc) params.set("cc", opts.cc);
  if (opts.bcc) params.set("bcc", opts.bcc);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * A `mailto:` fallback for whoever doesn't live in Gmail — opens their default mail client
 * with the same fields. Kept alongside the Gmail link, never instead of it.
 */
export function mailtoUrl(opts: {
  to?: string | null;
  subject?: string | null;
  body?: string | null;
}): string {
  const params = new URLSearchParams();
  if (opts.subject) params.set("subject", opts.subject);
  if (opts.body) params.set("body", opts.body);
  const query = params.toString();
  return `mailto:${opts.to ?? ""}${query ? `?${query}` : ""}`;
}
