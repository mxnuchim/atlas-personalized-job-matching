/**
 * Bounded-concurrency map, preserving input order in the results. Kept domain-agnostic
 * so any stage can bound its own fan-out without importing another one to get it.
 *
 * Rejections are not swallowed — callers wrap each item's work in its own try/catch so
 * one failure records an error and the run continues (PRD §12).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const width = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: width }, run));
  return results;
}
