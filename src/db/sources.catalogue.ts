import type { NewSource } from "./schema";

/**
 * The starting set of job sources (PRD §7).
 *
 * Every board here was verified live before being written down — each one answered
 * with a non-empty posting list. That matters because the failure modes are quiet:
 * Greenhouse and Ashby 404 an unknown board, but Lever answers HTTP 200 with
 * `{"ok":false}`, so a wrong token looks like an empty company rather than a typo.
 *
 * `region` and `sector` are documentation, not columns — they exist so a human
 * reading this file can see the spread, and so gaps are obvious. The `sources` table
 * stores only name, kind, config and enabled.
 *
 * Three kinds of source, and the difference is the whole reason breadth is work:
 *
 *   - **ATS boards** (`greenhouse` / `lever` / `ashby`) are per-company. There is no
 *     search, no geography parameter — you see exactly the employers you name, so
 *     coverage costs one row each.
 *   - **Aggregators** (`api`) are cross-company and mostly remote-global. For a
 *     Nigeria-based candidate these are the highest-yield entries in the file: remote
 *     work is reachable without a visa, which relocation roles are not.
 *   - **`rss`** has no fetcher yet.
 *
 * A note on Africa, because it is the gap this file cannot close by trying harder:
 * engineering roles on public African ATS boards are genuinely scarce. Moniepoint is
 * the real find — 161 roles, a third of them in or remote-from Nigeria. Jumia posts
 * steadily but is almost entirely operations and account management. The honest route
 * to work from Port Harcourt is the remote-global aggregators, not Nigeria-located
 * listings.
 */
export type CatalogueEntry = NewSource & { region: string; sector: string };

const gh = (board: string, company: string, region: string, sector: string): CatalogueEntry => ({
  name: company,
  kind: "greenhouse",
  config: { board, company },
  enabled: true,
  region,
  sector,
});

const lv = (board: string, company: string, region: string, sector: string): CatalogueEntry => ({
  name: company,
  kind: "lever",
  config: { board, company },
  enabled: true,
  region,
  sector,
});

const as = (board: string, company: string, region: string, sector: string): CatalogueEntry => ({
  name: company,
  kind: "ashby",
  config: { board, company },
  enabled: true,
  region,
  sector,
});

const api = (adapter: string, name: string, region: string, limit = 200): CatalogueEntry => ({
  name,
  kind: "api",
  config: { adapter, limit },
  enabled: true,
  region,
  sector: "Aggregator",
});

export const SOURCE_CATALOGUE: CatalogueEntry[] = [
  // ── Cross-company aggregators — remote-global, no visa required ───────────────
  api("remotive", "Remotive", "Remote (global)"),
  api("himalayas", "Himalayas", "Remote (global)"),
  api("jobicy", "Jobicy", "Remote (global)"),
  api("arbeitnow", "Arbeitnow", "Europe / remote"),

  // ── Africa ───────────────────────────────────────────────────────────────────
  gh("moniepoint", "Moniepoint", "Nigeria / remote", "Fintech"),
  gh("jumia", "Jumia", "Africa", "E-commerce"),
  gh("luno", "Luno", "South Africa / UK", "Crypto"),
  lv("tala", "Tala", "Kenya / Nigeria / Mexico", "Fintech"),

  // ── Remote-first employers that hire globally ────────────────────────────────
  gh("gitlab", "GitLab", "Remote (global)", "DevTools"),
  gh("canonical", "Canonical", "Remote (global)", "Open source"),
  gh("remotecom", "Remote.com", "Remote (global)", "HR tech"),
  gh("turing", "Turing", "Remote (global)", "Talent"),

  // ── United States ────────────────────────────────────────────────────────────
  gh("stripe", "Stripe", "US", "Fintech"),
  gh("databricks", "Databricks", "US", "Data"),
  gh("anthropic", "Anthropic", "US", "AI"),
  gh("cloudflare", "Cloudflare", "US", "Infrastructure"),
  gh("datadog", "Datadog", "US", "Observability"),
  gh("coinbase", "Coinbase", "US", "Crypto"),
  gh("airbnb", "Airbnb", "US", "Marketplace"),
  gh("figma", "Figma", "US", "Design tools"),
  gh("brex", "Brex", "US", "Fintech"),
  gh("affirm", "Affirm", "US", "Fintech"),
  gh("samsara", "Samsara", "US", "IoT"),
  gh("lyft", "Lyft", "US", "Mobility"),
  gh("reddit", "Reddit", "US", "Social"),
  gh("pinterest", "Pinterest", "US", "Social"),
  gh("discord", "Discord", "US", "Social"),
  gh("dropbox", "Dropbox", "US", "Productivity"),
  gh("asana", "Asana", "US", "Productivity"),
  gh("carta", "Carta", "US", "Fintech"),
  gh("gusto", "Gusto", "US", "HR tech"),
  gh("faire", "Faire", "US", "Marketplace"),
  gh("vercel", "Vercel", "US", "DevTools"),
  gh("mongodb", "MongoDB", "US", "Databases"),
  gh("elastic", "Elastic", "US / remote", "Search"),
  gh("grafanalabs", "Grafana Labs", "US / remote", "Observability"),
  gh("cockroachlabs", "Cockroach Labs", "US", "Databases"),
  gh("formlabs", "Formlabs", "US", "Hardware"),
  as("openai", "OpenAI", "US", "AI"),
  as("ramp", "Ramp", "US", "Fintech"),
  as("notion", "Notion", "US", "Productivity"),
  as("linear", "Linear", "US / remote", "DevTools"),
  as("vanta", "Vanta", "US", "Security"),
  as("supabase", "Supabase", "Remote (global)", "DevTools"),
  as("railway", "Railway", "Remote (global)", "Infrastructure"),
  as("temporal", "Temporal", "US / remote", "Infrastructure"),
  as("deepgram", "Deepgram", "US / remote", "AI"),
  lv("palantir", "Palantir", "US / UK", "Data"),

  // ── United Kingdom ───────────────────────────────────────────────────────────
  gh("monzo", "Monzo", "UK", "Fintech"),
  gh("wise", "Wise", "UK", "Fintech"),
  gh("gocardless", "GoCardless", "UK", "Fintech"),
  gh("deliveroo", "Deliveroo", "UK", "Logistics"),

  // ── European Union ───────────────────────────────────────────────────────────
  gh("n26", "N26", "Germany", "Fintech"),
  gh("celonis", "Celonis", "Germany", "Process mining"),
  gh("hellofresh", "HelloFresh", "Germany", "E-commerce"),
  gh("sumup", "SumUp", "Germany / UK", "Fintech"),
  gh("contentful", "Contentful", "Germany", "DevTools"),
  gh("trivago", "trivago", "Germany", "Travel"),
  gh("adyen", "Adyen", "Netherlands", "Fintech"),
  gh("doctolib", "Doctolib", "France", "Health tech"),
  gh("wolt", "Wolt", "Finland", "Logistics"),
  as("n8n", "n8n", "Germany / remote", "Automation"),
  lv("spotify", "Spotify", "Sweden / global", "Media"),

  // ── Canada ───────────────────────────────────────────────────────────────────
  as("cohere", "Cohere", "Canada", "AI"),
  as("1password", "1Password", "Canada / remote", "Security"),
  gh("hootsuite", "Hootsuite", "Canada", "Social"),
];
