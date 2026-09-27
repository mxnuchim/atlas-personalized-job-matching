/**
 * Closure detection: noticing that a posting has come off its board.
 *
 * A role that is filled or withdrawn simply stops appearing in the fetch. Without
 * this, `jobs` only ever grows, and Atlas will happily score — and draft outreach for
 * — a role that closed weeks ago.
 *
 * The inference is "stored, but absent from this fetch", which is only sound when the
 * fetch returns the source's **complete** set. That is true of the per-company ATS
 * boards and false of the aggregators, which return a capped page of a rolling feed:
 * a job absent from today's page there has almost always just been pushed off by
 * newer ones. Running this on them would mark thousands of live roles closed.
 *
 * Everything below is deliberately conservative. A stale open job costs one wasted
 * scoring call; a wrongly closed one silently removes a real opportunity, and nothing
 * in the UI would explain why. When in doubt, close nothing.
 */

/** Source kinds whose fetch returns every open posting, not a page of them. */
const COMPLETE_SET_KINDS = new Set(["greenhouse", "lever", "ashby"]);

/**
 * Refuse to close more than this share of a source's stored jobs in one run. A board
 * really can lose half its openings at once, but a truncated or partially-served
 * response looks exactly the same — and the two are told apart by how much damage
 * being wrong does.
 */
const MAX_CLOSE_RATIO = 0.5;

export type ClosureDecision =
  { act: true; closed: string[]; reopened: string[] } | { act: false; reason: string };

export function supportsClosureDetection(kind: string): boolean {
  return COMPLETE_SET_KINDS.has(kind);
}

/**
 * Decide what to close and what to reopen for one source.
 *
 * `storedOpen` / `storedClosed` are the external ids already held for this source;
 * `seen` is every id the fetch returned **before** the age filter and relevance gate.
 * Diffing against the filtered set would read "aged past the window" as "closed".
 */
export function decideClosure(params: {
  kind: string;
  fetchFailed: boolean;
  seen: string[];
  storedOpen: string[];
  storedClosed: string[];
}): ClosureDecision {
  const { kind, fetchFailed, seen, storedOpen, storedClosed } = params;

  if (!supportsClosureDetection(kind)) {
    return { act: false, reason: `${kind} returns a page, not a complete set` };
  }
  if (fetchFailed) {
    return { act: false, reason: "fetch failed" };
  }
  if (seen.length === 0 && storedOpen.length > 0) {
    // An outage and a board with genuinely nothing open are indistinguishable here.
    return { act: false, reason: "empty response" };
  }

  const present = new Set(seen);
  const closed = storedOpen.filter((id) => !present.has(id));
  // A posting that comes back was never really gone — a board can drop an entry for a
  // run and restore it. Without this, one blip closes a live role permanently.
  const reopened = storedClosed.filter((id) => present.has(id));

  if (storedOpen.length > 0 && closed.length / storedOpen.length > MAX_CLOSE_RATIO) {
    return {
      act: false,
      reason: `would close ${closed.length}/${storedOpen.length} — looks like a partial response`,
    };
  }

  return { act: true, closed, reopened };
}
