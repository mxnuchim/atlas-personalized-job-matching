/**
 * Parsing a stage limit, in one place.
 *
 * There were three near-copies of this — the CLI reading an env string, the route
 * handler reading JSON, and `run.ts` deciding whether to pass anything on — and all
 * three treated `0` as "not supplied". That made "run this stage on nothing"
 * unexpressible, and worse, it silently substituted the stage *default*: asking for
 * zero drafts produced twenty. Caught by a verification run doing work it had been
 * told to skip.
 */

/** Ceiling for a caller-supplied limit, so a stray value cannot start a huge run. */
export const MAX_LIMIT = 1000;

/**
 * `undefined` means "use the stage default"; `0` means "do nothing". An empty string
 * is how an unset GitHub Actions input arrives, so it maps to the former.
 */
export function parseLimit(value: unknown, max: number = MAX_LIMIT): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    if (value.trim() === "") return undefined;
    return parseLimit(Number(value), max);
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Math.floor(value), max);
}
