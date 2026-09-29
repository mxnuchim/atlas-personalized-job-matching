import "server-only";

import { getUndraftedMatches, hasDraft, insertDraft } from "@/db/queries/drafts";
import { listMatchRows, type MatchRow } from "@/db/queries/matches";
import { openOutreach } from "@/db/queries/outreach";
import { getCurrentProfile, type ProfileWithStrengths } from "@/db/queries/profile";
import type { RunError } from "@/db/schema";
import {
  addUsage,
  emptyUsageTotals,
  generateStructured,
  isLlmError,
  LIMITS,
  mapWithConcurrency,
  MODELS,
} from "@/lib/llm";
import { log } from "@/lib/logger";
import type { FitTier } from "@/lib/scoring";

import { buildDraftPrompt, buildDraftSystem, type EvidenceOption } from "./prompt";
import { buildDraftGenerationSchema, draftGrounding, draftToRow } from "./schema";

/** Only strong matches get a draft by default (PRD §8 step 5). */
const DEFAULT_TIERS: FitTier[] = ["strong"];
const DEFAULT_LIMIT = 20;
/** A strength the role barely rewards is not worth arguing from. */
const MIN_REWARDED = 50;

export type DraftSummary = {
  drafted: number;
  failed: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number | null;
  errors: RunError[];
  skipped?: string;
  /**
   * The draft just written, for the single-match on-demand path — so the drawer can show
   * it inline and hand it to Gmail without a round trip to the review screen. Undefined in
   * the bulk scheduled run, which produces many and surfaces none.
   */
  draft?: { subject: string; body: string };
};

function empty(): DraftSummary {
  return {
    drafted: 0,
    failed: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokensCached: 0,
    costUsd: 0,
    errors: [],
  };
}

/**
 * Draft outreach for matches that qualify and do not have one yet (PRD §8 step 5).
 *
 * Never sends. Every draft is stored `pending` with `recipient` null — where an
 * address comes from, and verifying it, is M4's problem (PRD §11). Idempotent: a
 * match with a draft is never re-drafted, so a re-run only fills gaps.
 */
export async function runDraft({
  userId,
  tiers = DEFAULT_TIERS,
  limit = DEFAULT_LIMIT,
  matchId,
}: {
  userId: string;
  tiers?: FitTier[];
  limit?: number;
  matchId?: string;
}): Promise<DraftSummary> {
  const logger = log("draft");

  const profile = await getCurrentProfile(userId);
  if (!profile) return { ...empty(), skipped: "No profile seeded — run db:seed:profile" };

  // A single match drafts on demand, ignoring the tier gate: the scheduled run only
  // drafts `strong`, so a `possible` role you personally rate would otherwise never
  // get one. The no-double-draft rule still holds.
  const queue = matchId
    ? (await hasDraft(matchId))
      ? []
      : [{ matchId }]
    : await getUndraftedMatches(tiers, limit);
  if (queue.length === 0) {
    return matchId ? { ...empty(), skipped: "That match already has a draft." } : empty();
  }

  // One fetch for the whole queue rather than a round trip per draft.
  const queued = new Set(queue.map((q) => q.matchId));
  const allMatches = await listMatchRows(profile.id);
  const targets = allMatches.filter((m) => queued.has(m.id));

  // Draft only for roles you apply to by email — a real address in the posting. Almost
  // every role applies through its link (an ATS form), where a drafted email has no
  // recipient; drafting one anyway is wasted spend and clutter in the review queue.
  const draftable = targets.filter((m) => m.contactEmail);
  if (draftable.length === 0) {
    return matchId
      ? { ...empty(), skipped: "This role applies through its link — there's no address to email." }
      : empty();
  }

  // An email signed "the candidate" is worse than no email, so this refuses rather
  // than guessing a name out of the CV prose.
  if (!profile.name) {
    return {
      ...empty(),
      skipped: "Profile has no name — set `name` in the seed document and re-run db:seed:profile",
    };
  }

  const system = buildDraftSystem(profile, {
    name: profile.name,
    portfolioUrl: profile.portfolioUrl,
  });

  const summary = empty();
  let totals = emptyUsageTotals();

  const outcomes = await mapWithConcurrency(draftable, LIMITS.maxConcurrency, async (match) => {
    try {
      return { ok: true as const, ...(await draftForMatch({ match, profile, system })) };
    } catch (error) {
      const message = isLlmError(error)
        ? `${error.kind}: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error);
      logger.error({ matchId: match.id, title: match.title, error: message }, "drafting failed");
      return { ok: false as const, matchId: match.id, message };
    }
  });

  for (const outcome of outcomes) {
    if (outcome.ok) {
      summary.drafted += 1;
      totals = addUsage(totals, outcome.usage);
      if (outcome.ungrounded) summary.errors.push(outcome.ungrounded);
      // Single-match on-demand: hand the content back so the drawer shows it at once.
      if (matchId) summary.draft = { subject: outcome.subject, body: outcome.body };
    } else {
      summary.failed += 1;
      summary.errors.push({
        stage: "draft",
        job_id: outcome.matchId,
        message: outcome.message,
      });
    }
  }

  summary.tokensIn = totals.inputTokens;
  summary.tokensOut = totals.outputTokens;
  summary.tokensCached = totals.cachedInputTokens;
  summary.costUsd = totals.costUsd;

  logger.info(
    { drafted: summary.drafted, failed: summary.failed, costUsd: summary.costUsd },
    "drafting complete",
  );
  return summary;
}

async function draftForMatch(params: {
  match: MatchRow;
  profile: ProfileWithStrengths;
  system: string;
}) {
  const { match, profile, system } = params;

  const evidenceOptions = evidenceFor(match, profile);
  if (evidenceOptions.length === 0) {
    // Refusing beats fabricating: a draft with nothing real to cite is the generic
    // blurb this product exists to avoid.
    throw new Error(
      "No evidence backs the strengths this role rewards — add evidence before drafting it",
    );
  }

  const strengthKeys = [...new Set(evidenceOptions.map((e) => e.strengthKey))];
  const schema = buildDraftGenerationSchema({ evidenceOptions, strengthKeys });

  const { data, usage } = await generateStructured({
    schema,
    system,
    prompt: buildDraftPrompt({ match, evidenceOptions }),
    model: MODELS.drafting,
  });

  const row = draftToRow({
    matchId: match.id,
    output: data,
    validEvidenceIds: new Set(evidenceOptions.map((e) => e.id)),
    validStrengthKeys: new Set(strengthKeys),
  });

  await insertDraft(row);
  // A role enters the funnel when a draft exists, not when it is sent — otherwise the
  // tracker's first column is structurally always zero and the drawer has nothing to
  // act on until after you have already sent.
  await openOutreach(row.matchId);

  const grounding = draftGrounding(row);
  return {
    usage,
    subject: row.subject,
    body: row.body,
    ungrounded: grounding.grounded
      ? undefined
      : ({
          stage: "draft",
          job_id: match.id,
          message: `Draft stored but ${grounding.reason} — review before sending`,
        } satisfies RunError),
  };
}

/**
 * Only the evidence backing strengths this role actually rewards. Narrowing here is
 * what keeps the draft on-argument: the model cannot cite something irrelevant if it
 * was never offered it.
 */
function evidenceFor(match: MatchRow, profile: ProfileWithStrengths): EvidenceOption[] {
  const rewarded = new Map(
    match.strengthMatches
      .filter((s) => s.rewarded >= MIN_REWARDED)
      .map((s) => [s.strength_key, s.rewarded]),
  );

  return profile.strengths
    .filter((s) => rewarded.has(s.key))
    .sort((a, b) => (rewarded.get(b.key) ?? 0) - (rewarded.get(a.key) ?? 0))
    .flatMap((s) =>
      s.evidence.map((e) => ({
        id: e.id,
        strengthKey: s.key,
        strengthLabel: s.label,
        claim: e.claim,
        context: e.context,
        metric: e.metric,
      })),
    );
}
