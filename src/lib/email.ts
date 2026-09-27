/**
 * The daily email template.
 *
 * Pure and free of `server-only` so it can be unit-tested and rendered to a file for
 * visual review without sending anything. `notify.ts` owns delivery; this owns how it
 * looks.
 *
 * Email is not the web, and the constraints are unusual enough to be worth stating:
 *
 *   - **Tables, not divs.** Outlook 2016–2021 renders through Word, which has no
 *     flexbox, no grid, and unreliable `max-width` on block elements.
 *   - **Inline styles only.** Gmail strips `<style>` from forwarded mail and clips
 *     messages over ~102 KB, taking the stylesheet with it.
 *   - **No images.** Every client blocks remote images by default, so anything
 *     load-bearing has to survive without them — including the fit scores, which are
 *     drawn as styled table cells rather than SVG.
 *   - **Web fonts are a progressive enhancement.** Apple Mail and iOS honour the
 *     `@font-face`; Gmail and Outlook ignore it and get the fallback stack. The design
 *     has to hold either way, so nothing depends on Manrope's metrics.
 */

export type QueuePreview = {
  title: string;
  company: string;
  overall: number;
  tier?: "strong" | "possible" | "stretch";
};

export type DailyEmailInput = {
  newJobs: number;
  scored: number;
  strong: number;
  errors: number;
  sourcesOk: number;
  sourcesTotal: number;
  /** The capped queue length — never the raw backlog. */
  queued: number;
  top: QueuePreview[];
  costUsd: number | null;
  appUrl: string;
};

/** Straight from `globals.css`, so the email and the app cannot drift apart. */
const C = {
  page: "#f5f6f8",
  card: "#ffffff",
  ink: "#16181d",
  muted: "#5a6472",
  border: "#e3e6eb",
  primary: "#4c5bd4",
  strong: "#22734e",
  strongTint: "#e8f4ee",
  possible: "#8a5e1d",
  possibleTint: "#fdf4e7",
  stretch: "#606673",
  stretchTint: "#eef0f3",
  warnInk: "#8a5e1d",
  warnTint: "#fdf4e7",
} as const;

const FONT = `'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

function tierColors(tier: QueuePreview["tier"]) {
  if (tier === "strong") return { ink: C.strong, tint: C.strongTint };
  if (tier === "possible") return { ink: C.possible, tint: C.possibleTint };
  return { ink: C.stretch, tint: C.stretchTint };
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Coverage qualifies every count in the mail, so it is stated wherever counts are. */
export function shortfall(run: DailyEmailInput): string {
  return run.sourcesTotal > 0 && run.sourcesOk < run.sourcesTotal
    ? `Only ${run.sourcesOk} of ${run.sourcesTotal} sources answered, so today's list is drawn from an incomplete picture.`
    : "";
}

/**
 * The subject carries the decision — is there anything worth opening the app for.
 * A subject reading "run complete" spends the one line that is always read on the
 * least useful fact available.
 */
export function buildSubject(run: DailyEmailInput): string {
  if (run.queued === 0) return "Atlas: nothing new today";

  const noun = `role${run.queued === 1 ? "" : "s"}`;

  // When every queued role is strong, ", 20 strong" after "20 roles ready" is noise —
  // it restates the count it just gave. Fold it into the noun instead. Seen on real
  // data: the queue is capped at the top of the list, so a good day fills it entirely
  // with strong matches.
  if (run.strong >= run.queued) return `Atlas: ${run.queued} strong ${noun} ready`;

  const strong = run.strong > 0 ? `, ${run.strong} strong` : "";
  return `Atlas: ${run.queued} ${noun} ready${strong}`;
}

/**
 * The preview line clients show beside the subject. Left unset, they scrape the first
 * text in the body — usually a wordmark, which wastes it.
 */
function preheader(run: DailyEmailInput): string {
  if (run.queued === 0) return `Nothing new — ${run.newJobs} postings seen, none worth your time.`;
  const names = run.top
    .slice(0, 2)
    .map((r) => r.company)
    .join(", ");
  return names ? `${names} and more, best fit first.` : "Your queue is ready.";
}

/** Plain text alternative — the accessible fallback, and what text-only clients show. */
export function buildText(run: DailyEmailInput): string {
  const lines: string[] = [];

  lines.push(
    run.queued === 0
      ? "Nothing new to review today."
      : `${run.queued} role${run.queued === 1 ? "" : "s"} waiting in today's queue.`,
  );

  if (run.top.length > 0) {
    lines.push("");
    for (const role of run.top) {
      lines.push(`  ${String(role.overall).padStart(3)}  ${role.title} — ${role.company}`);
    }
    if (run.queued > run.top.length) {
      lines.push(`  ...and ${run.queued - run.top.length} more.`);
    }
  }

  const caveat = shortfall(run);
  if (caveat) lines.push("", caveat);

  lines.push("", `Open the queue: ${run.appUrl}/today`);

  const tail = [`${run.newJobs} new postings`, `${run.scored} scored`];
  if (run.errors > 0) tail.push(`${run.errors} error${run.errors === 1 ? "" : "s"}`);
  if (run.costUsd !== null && run.costUsd > 0) tail.push(`$${run.costUsd.toFixed(3)}`);
  lines.push("", tail.join(" · "));

  return lines.join("\n");
}

function roleRow(role: QueuePreview, isLast: boolean): string {
  const { ink, tint } = tierColors(role.tier);
  const border = isLast ? "none" : `1px solid ${C.border}`;

  return `
              <tr>
                <td class="hairline" style="padding:14px 0;border-bottom:${border};" valign="top">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td width="46" valign="top" style="width:46px;padding-right:14px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                          <tr>
                            <td align="center" style="width:46px;height:34px;background:${tint};border-radius:8px;font-family:${FONT};font-size:15px;font-weight:700;color:${ink};mso-line-height-rule:exactly;line-height:34px;">${role.overall}</td>
                          </tr>
                        </table>
                      </td>
                      <td valign="top">
                        <div class="ink" style="font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;color:${C.ink};mso-line-height-rule:exactly;">${escapeHtml(role.title)}</div>
                        <div class="muted" style="font-family:${FONT};font-size:13px;font-weight:500;line-height:18px;color:${C.muted};padding-top:2px;mso-line-height-rule:exactly;">${escapeHtml(role.company)}</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>`;
}

export function buildHtml(run: DailyEmailInput): string {
  const caveat = shortfall(run);
  const headline =
    run.queued === 0
      ? "Nothing new today"
      : `${run.queued} role${run.queued === 1 ? "" : "s"} ready`;

  const stats = [
    `${run.newJobs} new posting${run.newJobs === 1 ? "" : "s"}`,
    `${run.scored} scored`,
    ...(run.strong > 0 ? [`${run.strong} strong`] : []),
  ].join(" &middot; ");

  const rows = run.top.map((r, i) => roleRow(r, i === run.top.length - 1)).join("");

  const more =
    run.queued > run.top.length
      ? `<div class="muted" style="font-family:${FONT};font-size:13px;font-weight:500;line-height:18px;color:${C.muted};padding-top:14px;">and ${run.queued - run.top.length} more in the queue.</div>`
      : "";

  const cta = `${run.appUrl}/today`;

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${escapeHtml(buildSubject(run))}</title>
<!--[if mso]>
<noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
<![endif]-->
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&amp;display=swap" rel="stylesheet" />
<style>
  /* Ignored by Gmail and Outlook; honoured by Apple Mail and iOS, which is where it
     is worth having. Everything load-bearing is inlined below. */
  @media (prefers-color-scheme: dark) {
    .page { background:#101216 !important; }
    .card { background:#181b21 !important; }
    .ink { color:#eef1f5 !important; }
    .muted { color:#9aa4b2 !important; }
    .hairline { border-color:#262b33 !important; }
    /* The score badges keep their light tint in dark mode on purpose: a dark number
       on a pale chip stays legible either way, and inverting them would lose the
       tier colour that makes the list scannable. */
  }
  @media only screen and (max-width:620px) {
    .wrap { width:100% !important; }
    .pad { padding-left:20px !important; padding-right:20px !important; }
    .h1 { font-size:22px !important; line-height:28px !important; }
  }
  a { text-decoration:none; }
</style>
</head>
<body class="page" style="margin:0;padding:0;background:${C.page};-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:${C.page};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader(run))}</div>
<div style="display:none;max-height:0;overflow:hidden;">&#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847; &#8199;&#65279;&#847;</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.page};">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" class="wrap" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;">

        <tr>
          <td class="pad" style="padding:0 8px 14px;">
            <span style="font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:${C.muted};">Atlas</span>
          </td>
        </tr>

        <tr>
          <td class="card hairline" style="background:${C.card};border:1px solid ${C.border};border-radius:14px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">

              <tr>
                <td class="pad" style="padding:30px 30px 0;">
                  <h1 class="h1 ink" style="margin:0;font-family:${FONT};font-size:25px;line-height:31px;font-weight:800;color:${C.ink};letter-spacing:-0.02em;mso-line-height-rule:exactly;">${escapeHtml(headline)}</h1>
                  <div class="muted" style="font-family:${FONT};font-size:14px;font-weight:500;line-height:20px;color:${C.muted};padding-top:6px;">${stats}</div>
                </td>
              </tr>

              ${
                rows
                  ? `<tr><td class="pad" style="padding:22px 30px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">${rows}</table>
                ${more}
              </td></tr>`
                  : ""
              }

              ${
                caveat
                  ? `<tr><td class="pad" style="padding:22px 30px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.warnTint};border-radius:10px;">
                  <tr><td style="padding:12px 14px;font-family:${FONT};font-size:13px;font-weight:500;line-height:19px;color:${C.warnInk};">${escapeHtml(caveat)}</td></tr>
                </table>
              </td></tr>`
                  : ""
              }

              <tr>
                <td class="pad" style="padding:26px 30px 30px;">
                  <!--[if mso]>
                  <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${cta}" style="height:46px;v-text-anchor:middle;width:220px;" arcsize="18%" stroke="f" fillcolor="${C.primary}">
                    <w:anchorlock/>
                    <center style="color:#ffffff;font-family:Segoe UI,Arial,sans-serif;font-size:15px;font-weight:bold;">Open today&rsquo;s queue</center>
                  </v:roundrect>
                  <![endif]-->
                  <!--[if !mso]><!-- -->
                  <a href="${cta}" style="display:inline-block;background:${C.primary};color:#ffffff;font-family:${FONT};font-size:15px;font-weight:700;line-height:46px;height:46px;padding:0 26px;border-radius:10px;mso-line-height-rule:exactly;">Open today&rsquo;s queue</a>
                  <!--<![endif]-->
                </td>
              </tr>

            </table>
          </td>
        </tr>

        <tr>
          <td class="pad" style="padding:16px 8px 0;">
            <div class="muted" style="font-family:${FONT};font-size:12px;font-weight:500;line-height:18px;color:${C.muted};">
              ${run.errors > 0 ? `${run.errors} error${run.errors === 1 ? "" : "s"} this run &middot; ` : ""}${run.costUsd !== null && run.costUsd > 0 ? `$${run.costUsd.toFixed(3)} spent &middot; ` : ""}You are receiving this because Atlas runs once a day.
            </div>
          </td>
        </tr>

      </table>
      <!--[if mso]></td></tr></table><![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;
}

/** Everything the sender needs, in one call. */
export function renderDailyEmail(run: DailyEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  return { subject: buildSubject(run), html: buildHtml(run), text: buildText(run) };
}
