/**
 * How the day's queue is chosen.
 *
 * Sorting purely by fit is the obvious rule and the wrong one: it let four consecutive
 * SumUp roles take a third of a fifteen-slot queue. All four were genuinely strong, so
 * nothing was mis-scored — but fifteen roles at eleven companies is a better day's work
 * than fifteen at four, because applying to a second role at the same employer has a
 * fraction of the value of the first.
 *
 * Pure and free of `server-only` so the rule can be tested directly.
 */

/** The minimum a row needs for the cap to apply. */
export type Capped = { company: string };

/**
 * Take the best rows, allowing at most `maxPerCompany` from any one employer.
 *
 * Input must already be in the order you want (best first). Rows beyond an employer's
 * cap are dropped rather than deferred — the queue refills tomorrow, and holding a
 * position for a company you have already seen four times is not worth the slot.
 */
export function capPerCompany<T extends Capped>(
  rows: T[],
  limit: number,
  maxPerCompany: number,
): T[] {
  const seen = new Map<string, number>();
  const chosen: T[] = [];

  for (const row of rows) {
    if (chosen.length >= limit) break;

    // Case and surrounding space vary between boards for the same employer.
    const key = row.company.trim().toLowerCase();
    const count = seen.get(key) ?? 0;
    if (count >= maxPerCompany) continue;

    seen.set(key, count + 1);
    chosen.push(row);
  }

  return chosen;
}
