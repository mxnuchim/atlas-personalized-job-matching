/**
 * Today's two lanes: roles you can do from Nigeria, and everything else.
 *
 * A role is Nigerian when its location names Nigeria or a Nigerian city — including
 * multi-country remote roles that list Nigeria among them ("Remote, Kenya; Remote, Lagos,
 * Nigeria; …"), since those you can do from home. "EMEA" or "Remote — Africa" is not
 * Nigeria: it might be, but the posting hasn't said so.
 *
 * Unicode-aware word boundaries, not substring or `\b`: "Jos" (the city) must not match
 * inside "São José dos Campos", which is exactly what a first, naive filter did.
 *
 * Pure and client-safe so the rule is tested directly and shared by the page and the run.
 */

export type Lane = "nigeria" | "global";

/** Nigeria first — the order the tabs appear in. */
export const LANES: readonly Lane[] = ["nigeria", "global"];

export const LANE_LABELS: Record<Lane, string> = {
  nigeria: "Nigeria",
  global: "Global",
};

const NIGERIAN_PLACES = [
  "nigeria",
  "lagos",
  "abuja",
  "ikeja",
  "lekki",
  "victoria island",
  "yaba",
  "port harcourt",
  "ibadan",
  "kano",
  "enugu",
  "benin city",
  "kaduna",
  "abeokuta",
  "uyo",
  "calabar",
  "owerri",
  "ilorin",
  "jos",
  "warri",
  "akure",
  "asaba",
  "onitsha",
];

const NIGERIA = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${NIGERIAN_PLACES.map((p) => p.replace(/\s+/g, "\\s+")).join("|")})(?![\\p{L}\\p{N}])`,
  "iu",
);

export function laneOf(location: string | null | undefined): Lane {
  return location && NIGERIA.test(location) ? "nigeria" : "global";
}

export function parseLane(value: unknown): Lane | null {
  return value === "nigeria" || value === "global" ? value : null;
}
