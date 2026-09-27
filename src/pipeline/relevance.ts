/**
 * The pre-scoring relevance gate.
 *
 * Ingest pulls from dozens of boards, which is thousands of postings — and scoring is
 * one LLM call each. Sending the whole corpus to a model would cost more per run than
 * the tool is worth, and would bury the matches that matter under sales roles in
 * Singapore. So a deterministic, free, auditable filter runs first and only what
 * survives reaches the model.
 *
 * Two rules, in order, both biased toward keeping:
 *
 *   1. **Title.** Keep if the title reads as engineering work the profile targets, and
 *      no disqualifying term is present. This does most of the cutting.
 *   2. **Location.** Drop only when the posting clearly names a country the profile
 *      does not cover. An unknown or unstated location is kept — an unrecognised city
 *      is not evidence of a bad fit, and the model judges `location_fit` properly.
 *
 * Pure and domain-shaped, not vendor-shaped: criteria are derived from the stored
 * profile, so changing `target_roles` or `locations` changes the filter with no code
 * edit. Nothing here knows which board a posting came from.
 */

/** Canonical country tokens, with the aliases job boards actually write. */
const COUNTRIES: { code: string; aliases: string[] }[] = [
  { code: "NG", aliases: ["nigeria", "lagos", "abuja", "port harcourt"] },
  {
    code: "US",
    aliases: [
      "united states",
      "usa",
      "u s a",
      "us",
      "america",
      "new york",
      "nyc",
      "san francisco",
      "bay area",
      "seattle",
      "austin",
      "boston",
      "chicago",
      "denver",
      "atlanta",
      "los angeles",
      "california",
      "texas",
      "washington dc",
    ],
  },
  {
    code: "GB",
    aliases: [
      "united kingdom",
      "uk",
      "england",
      "scotland",
      "wales",
      "london",
      "manchester",
      "edinburgh",
      "cambridge",
    ],
  },
  { code: "CA", aliases: ["canada", "toronto", "vancouver", "montreal", "ottawa", "waterloo"] },
  { code: "IE", aliases: ["ireland", "dublin"] },
  {
    code: "DE",
    aliases: [
      "germany",
      "deutschland",
      "berlin",
      "munich",
      "münchen",
      "hamburg",
      "frankfurt",
      "cologne",
    ],
  },
  { code: "FR", aliases: ["france", "paris", "lyon"] },
  { code: "NL", aliases: ["netherlands", "amsterdam", "utrecht", "rotterdam"] },
  { code: "ES", aliases: ["spain", "madrid", "barcelona"] },
  { code: "PT", aliases: ["portugal", "lisbon", "lisboa", "porto"] },
  { code: "IT", aliases: ["italy", "milan", "rome", "roma"] },
  { code: "PL", aliases: ["poland", "warsaw", "krakow", "kraków", "wroclaw"] },
  { code: "SE", aliases: ["sweden", "stockholm"] },
  { code: "DK", aliases: ["denmark", "copenhagen"] },
  { code: "NO", aliases: ["norway", "oslo"] },
  { code: "FI", aliases: ["finland", "helsinki"] },
  { code: "BE", aliases: ["belgium", "brussels"] },
  { code: "AT", aliases: ["austria", "vienna"] },
  { code: "CH", aliases: ["switzerland", "zurich", "zürich", "geneva"] },
  { code: "CZ", aliases: ["czech", "czechia", "prague"] },
  { code: "RO", aliases: ["romania", "bucharest"] },
  { code: "GR", aliases: ["greece", "athens"] },
  { code: "EE", aliases: ["estonia", "tallinn"] },
  { code: "LT", aliases: ["lithuania", "vilnius"] },
  { code: "ZA", aliases: ["south africa", "cape town", "johannesburg"] },
  { code: "KE", aliases: ["kenya", "nairobi"] },
  { code: "GH", aliases: ["ghana", "accra"] },
  { code: "EG", aliases: ["egypt", "cairo"] },
  { code: "MA", aliases: ["morocco", "casablanca"] },
  // Recognised so they can be ruled *out* when the profile does not cover them.
  {
    code: "IN",
    aliases: [
      "india",
      "bangalore",
      "bengaluru",
      "hyderabad",
      "mumbai",
      "delhi",
      "pune",
      "chennai",
      "gurgaon",
      "noida",
    ],
  },
  { code: "SG", aliases: ["singapore"] },
  { code: "JP", aliases: ["japan", "tokyo"] },
  { code: "CN", aliases: ["china", "beijing", "shanghai", "shenzhen"] },
  { code: "HK", aliases: ["hong kong"] },
  { code: "KR", aliases: ["korea", "seoul"] },
  { code: "AU", aliases: ["australia", "sydney", "melbourne", "brisbane"] },
  { code: "NZ", aliases: ["new zealand", "auckland"] },
  { code: "BR", aliases: ["brazil", "brasil", "são paulo", "sao paulo", "rio de janeiro"] },
  { code: "MX", aliases: ["mexico", "méxico", "mexico city", "guadalajara"] },
  { code: "AR", aliases: ["argentina", "buenos aires"] },
  { code: "CL", aliases: ["chile", "santiago"] },
  { code: "CO", aliases: ["colombia", "bogota", "bogotá", "medellin", "medellín"] },
  { code: "AE", aliases: ["united arab emirates", "uae", "dubai", "abu dhabi"] },
  { code: "SA", aliases: ["saudi arabia", "riyadh"] },
  { code: "IL", aliases: ["israel", "tel aviv"] },
  { code: "TR", aliases: ["turkey", "türkiye", "istanbul"] },
  { code: "PH", aliases: ["philippines", "manila"] },
  { code: "ID", aliases: ["indonesia", "jakarta"] },
  { code: "VN", aliases: ["vietnam", "hanoi", "ho chi minh"] },
  { code: "MY", aliases: ["malaysia", "kuala lumpur"] },
  { code: "TH", aliases: ["thailand", "bangkok"] },
  { code: "PK", aliases: ["pakistan", "karachi", "lahore"] },
  { code: "UA", aliases: ["ukraine", "kyiv", "kiev"] },
];

/** Group tokens a board may write instead of a country. */
const EU = [
  "IE",
  "DE",
  "FR",
  "NL",
  "ES",
  "PT",
  "IT",
  "PL",
  "SE",
  "DK",
  "FI",
  "BE",
  "AT",
  "CZ",
  "RO",
  "GR",
  "EE",
  "LT",
];
const GROUPS: Record<string, string[]> = {
  eu: EU,
  "european union": EU,
  europe: [...EU, "GB", "CH", "NO"],
  emea: [...EU, "GB", "CH", "NO", "ZA", "KE", "GH", "EG", "MA", "AE", "IL", "TR"],
  africa: ["NG", "ZA", "KE", "GH", "EG", "MA"],
  "north america": ["US", "CA"],
  latam: ["BR", "MX", "AR", "CL", "CO"],
  apac: ["SG", "JP", "CN", "HK", "KR", "AU", "NZ", "IN", "PH", "ID", "VN", "MY", "TH"],
};

/** Location wording that places no restriction at all. */
const UNRESTRICTED = [
  "remote",
  "worldwide",
  "anywhere",
  "global",
  "fully remote",
  "remote - global",
  "distributed",
  "any location",
  "multiple locations",
];

/**
 * Titles that read as engineering. `engineer`/`developer` do the work; the rest catch
 * the titles that describe the job without either word.
 */
const ENGINEERING_TERMS = [
  "engineer",
  "engineering",
  "developer",
  "programmer",
  "architect",
  "swe",
  "sre",
  "devops",
  "backend",
  "back end",
  "back-end",
  "frontend",
  "front end",
  "front-end",
  "full stack",
  "full-stack",
  "fullstack",
  "software",
  "data scientist",
  "machine learning",
  // Never bare "ai" or "ml". As standalone words they are marketing vocabulary now,
  // and they admitted "Go-to-Market Champion (GPU & AI)" and "Product Manager,
  // Performance AI" — both real results from a live run.
  "mlops",
  "ai engineer",
  "ai ml",
  "ml engineer",
  "ai researcher",
  "research engineer",
  "applied scientist",
  "technical lead",
  "tech lead",
  "solutions architect",
];

/**
 * Present in the title, these disqualify even when an engineering term is too. Mostly
 * roles that borrow "engineer" for non-engineering work.
 */
const EXCLUDED_TERMS = [
  "sales",
  "account executive",
  "account manager",
  "business development",
  "recruiter",
  "recruiting",
  "talent acquisition",
  "marketing",
  "customer success",
  "customer support",
  "technical support",
  "support engineer",
  "solutions consultant",
  "accountant",
  "accounting",
  "finance manager",
  "legal counsel",
  "paralegal",
  "human resources",
  "hr generalist",
  "office manager",
  "executive assistant",
  "nurse",
  "physician",
  "therapist",
  "driver",
  "warehouse",
  "janitor",
  "security guard",
  "teacher",
  "tutor",
  "copywriter",
  "content writer",
  "social media",
  "civil engineer",
  "mechanical engineer",
  "electrical engineer",
  "chemical engineer",
  "structural engineer",
  "industrial engineer",
  "field engineer",
  "process engineer",
  "hardware engineer",
  "manufacturing engineer",
  "sales engineer",
  "pre-sales",
  // Seniority the profile has long passed. The model would score these low anyway;
  // excluding them here means not paying a token to find that out.
  "product manager",
  "product owner",
  "go to market",
  "gtm",
  "intern",
  "internship",
  "junior",
  "new grad",
  "new graduate",
  "graduate program",
  "apprentice",
  "working student",
  "student assistant",
];

export type RelevanceCriteria = {
  /** Country codes the profile covers. Empty means "no geographic restriction". */
  countries: string[];
  titleTerms: string[];
  excludedTerms: string[];
};

export type Candidate = {
  title: string;
  location: string | null;
};

export type Verdict = { keep: true } | { keep: false; reason: "title" | "location" };

function normalize(value: string): string {
  return ` ${value
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/**
 * Whole-word/phrase containment. Both sides are space-padded by `normalize`, so a
 * plain `includes` of the padded term is a word-boundary match — "ai" does not fire
 * on "maintain", and multi-word terms like "account executive" match as a phrase.
 */
function containsTerm(haystack: string, term: string): boolean {
  return haystack.includes(` ${term.trim()} `);
}

/** Country codes named anywhere in a free-text location or profile string. */
export function countriesIn(text: string): string[] {
  const hay = normalize(text);
  const found = new Set<string>();

  for (const [token, codes] of Object.entries(GROUPS)) {
    if (containsTerm(hay, token)) codes.forEach((code) => found.add(code));
  }
  for (const { code, aliases } of COUNTRIES) {
    if (aliases.some((alias) => containsTerm(hay, alias))) found.add(code);
  }
  return [...found];
}

/** True when the wording names no place at all ("Remote", "Worldwide"). */
export function isUnrestricted(location: string): boolean {
  const hay = normalize(location);
  return UNRESTRICTED.some((term) => containsTerm(hay, term));
}

/**
 * Derive the filter from the stored profile. `target_roles` supplies extra title terms
 * on top of the shared engineering vocabulary, and `locations` supplies the geography —
 * so the gate follows the profile rather than a constant in this file.
 */
export function buildCriteria(profile: {
  targetRoles: string[];
  locations: string[];
}): RelevanceCriteria {
  // The whole role as a phrase, never its individual words. Tokenizing put "full"
  // (from "Full-Stack Engineer") into the vocabulary, where it matched every
  // "(Full Time)" posting, and "systems" (from "AI-Systems Engineer"), where it
  // matched "Business Systems Administrator". The shared vocabulary below already
  // covers the general case; a role phrase is a safety net, not the main gate.
  const fromRoles = profile.targetRoles.map((role) => normalize(role).trim()).filter(Boolean);

  return {
    countries: countriesIn(profile.locations.join(" ; ")),
    titleTerms: [...new Set([...ENGINEERING_TERMS, ...fromRoles])],
    excludedTerms: EXCLUDED_TERMS,
  };
}

/**
 * The gate itself. Ordered so the cheap, high-yield title test runs first, and so a
 * drop always carries the reason that produced it — ingest logs the split, which is
 * what makes an over-tight filter visible instead of silently starving the queue.
 */
export function isRelevant(job: Candidate, criteria: RelevanceCriteria): Verdict {
  const title = normalize(job.title);

  if (criteria.excludedTerms.some((term) => containsTerm(title, term))) {
    return { keep: false, reason: "title" };
  }
  if (!criteria.titleTerms.some((term) => containsTerm(title, term))) {
    return { keep: false, reason: "title" };
  }

  // No stated location, or no geographic restriction on the profile: nothing to test.
  const location = job.location?.trim();
  if (!location || criteria.countries.length === 0) return { keep: true };
  if (isUnrestricted(location)) return { keep: true };

  const named = countriesIn(location);
  // An unrecognised place is not evidence against the job — let the model judge it.
  if (named.length === 0) return { keep: true };
  if (named.some((code) => criteria.countries.includes(code))) return { keep: true };

  return { keep: false, reason: "location" };
}
