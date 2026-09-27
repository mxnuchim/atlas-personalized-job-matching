/**
 * One JSON fetch for every source fetcher. Each board previously carried its own copy
 * of "timeout, check status, parse" — which is how one of them ends up without a
 * timeout. A stalled board must not stall the run.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

export async function fetchJson(
  url: string,
  label: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<unknown> {
  const response = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  return response.json();
}
