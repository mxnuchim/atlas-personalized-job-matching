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
 *
 * `fill`: when the cap would leave slots empty, top them up with the best rows it
 * skipped. Diversity is a preference, not a reason to show fewer roles than exist — the
 * Nigeria lane is almost all one employer, and a hard cap of 4 would show 4 of its 10.
 */
export function capPerCompany<T extends Capped>(
  rows: T[],
  limit: number,
  maxPerCompany: number,
  { fill = false }: { fill?: boolean } = {},
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

  if (fill && chosen.length < limit) {
    const taken = new Set(chosen);
    // Back into rank order, so a topped-up row sits where its score puts it.
    const extra = rows.filter((r) => !taken.has(r)).slice(0, limit - chosen.length);
    const keep = new Set([...chosen, ...extra]);
    return rows.filter((r) => keep.has(r));
  }

  return chosen;
}
