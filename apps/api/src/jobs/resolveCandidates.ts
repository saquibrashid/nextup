/**
 * Stage 3 — collapse and identity resolution (`specs/ai.md` §4), run over a
 * batch's persisted candidates once stage 1/2 have finished.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 *
 * Every part of stage 3 was already built and unit-tested — `collapseOverlap`
 * (TASK-063), `matchCandidate` (TASK-060), `TmdbClient` (TASK-045) — and
 * **nothing called any of them**. `apps/api/src/jobs/startExtraction.ts` ran
 * stage 1, then stage 2 inside `recordItems`, and stopped. Every candidate
 * therefore reached the review pass with `resolvedWorkIdentity = null`, so the
 * product could not identify a single title, and the two stage-4/5 features
 * that key on identity — the suppression gate and classification, both already
 * implemented in `routes/batchReview.ts` — had nothing to key on. The gap was
 * invisible to the unit suites because each module passed its own tests in
 * isolation; it is exactly the failure mode `T-CI-008` describes one level up.
 *
 * ── The ports, and why they are ports ───────────────────────────────────────
 *
 * The orchestration is separated from the database and from HTTP so the
 * ordering rules can be asserted without either. That is not test convenience:
 * the two passes of `collapseOverlap` must run **in order, with matching
 * between them**, and the only way to prove pass B saw pass A's output is to
 * observe the calls.
 *
 * ── What this module must never do ──────────────────────────────────────────
 *
 * ⚠ **It must never fail the batch.** A batch that reached `in-review` has the
 * owner's screenshots read and staged; a TMDB outage, a slow row, or a bug in
 * here must leave those candidates reviewable as unidentified titles rather
 * than throwing the work away (US-007 AC-6, `T-AI-017`).
 *
 * ⚠ **It must never write a `Title` or a `ServiceListing`.** Stage 3 resolves
 * identity and nothing else; the human-in-the-loop contract (§6.2, `T-BATCH-003`)
 * is that only a batch close writes to the list.
 *
 * ⚠ **Losers are retained, never deleted** (REQ-012). `collapseOverlap` returns
 * them with `collapsedIntoCandidateId` set, and this module persists that
 * pointer. Deleting them would make a collapse indistinguishable from a failed
 * extraction.
 */

import {
  collapseOverlap,
  matchCandidate,
  unmatchedOutcome,
  type ExtractionCandidate,
  type MatchCandidate,
  type TmdbSearchResult,
} from '@nextup/domain';

/**
 * The persisted columns stage 3 reads and writes. Deliberately not the Prisma
 * row: this module has no opinion about `rawText`, `provider` or any of the
 * stage-1 evidence, and taking the whole row would let it acquire one.
 */
export interface ResolvableCandidate {
  id: string;
  normalisedText: string;
  extractedYear: number | null;
  sourceImageIds: string[];
  boundingBoxes: ExtractionCandidate['boundingBoxes'];
  ocrConfidence: number | null;
  collapsedIntoCandidateId: string | null;
  resolvedWorkIdentity: string | null;
}

/** What stage 3 decided about one candidate. Written back verbatim. */
export interface CandidateResolution {
  candidateId: string;
  resolvedWorkIdentity: string | null;
  matchCandidates: MatchCandidate[];
  collapsedIntoCandidateId: string | null;
}

export interface ResolveCandidatesPorts {
  /** Every candidate of the batch, in creation order. */
  listCandidates: () => Promise<ResolvableCandidate[]>;
  /**
   * One TMDB `search/multi` call. Throwing is expected and handled — see
   * `tmdbUnavailable` below.
   */
  searchTmdb: (query: string) => Promise<TmdbSearchResult[]>;
  /** Persist one candidate's resolution. Called once per candidate that changed. */
  persist: (resolution: CandidateResolution) => Promise<void>;
  log?: (event: string, fields: Record<string, unknown>) => void;
}

export interface ResolveCandidatesResult {
  /** Candidates marked as collapsed into another, across BOTH passes. */
  candidatesCollapsed: number;
  /** Surviving candidates that resolved to a `tmdb:` identity. */
  matched: number;
  /** Surviving candidates that resolved to an `unmatched:` identity. */
  unmatched: number;
  /** Auto-matched but with a runner-up inside the ambiguity margin (§4.3). */
  ambiguous: number;
  /** Resolved in `[MATCH_REVIEW_FLOOR, MATCH_AUTO_THRESHOLD)` (§4.3). */
  uncertain: number;
  /** Distinct TMDB searches actually issued — one per distinct normalised text. */
  tmdbQueries: number;
  /**
   * TMDB could not be reached, so **every** candidate resolved to
   * `unmatched:<hash>` and the batch still reaches `in-review` (US-007 AC-6).
   */
  tmdbUnavailable: boolean;
}

export interface ResolveCandidatesInput {
  /** The batch's images in capture order — the `imageIndex` of SD-02's key. */
  imageOrder: readonly string[];
  ports: ResolveCandidatesPorts;
}

/**
 * A full `ExtractionCandidate` built from the stage-3 subset.
 *
 * `collapseOverlap` takes the domain type because its ordering key reads
 * geometry and source images. The fields it never touches are filled with
 * inert values and are NEVER persisted from here — `persist` writes exactly
 * three columns — so a placeholder cannot reach the database.
 */
function toDomainCandidate(row: ResolvableCandidate): ExtractionCandidate {
  return {
    id: row.id,
    type: 'extractionCandidate',
    ownerId: '',
    batchId: '',
    sourceImageIds: row.sourceImageIds,
    rawText: '',
    inferredTitle: null,
    basis: 'text',
    ocrSupport: 'none',
    provider: 'llm',
    normalisedText: row.normalisedText,
    extractedYear: row.extractedYear,
    boundingBoxes: row.boundingBoxes,
    boxSource: 'llm',
    ocrConfidence: row.ocrConfidence,
    cleanupVerdict: 'title-candidate',
    resolvedWorkIdentity: row.resolvedWorkIdentity,
    matchCandidates: [],
    classification: null,
    reviewDisposition: 'pending',
    correctedToTmdbId: null,
    collapsedIntoCandidateId: row.collapsedIntoCandidateId,
    createdAt: '',
  };
}

/**
 * Resolve one batch's candidates: collapse, match, collapse again.
 *
 * Never rejects. Every failure path degrades to "reviewable as unidentified".
 */
export async function resolveCandidates(
  input: ResolveCandidatesInput,
): Promise<ResolveCandidatesResult> {
  const { ports, imageOrder } = input;
  const log = ports.log ?? ((): void => undefined);

  const rows = await ports.listCandidates();
  const initial = rows.map(toDomainCandidate);

  // Pass A — collapse duplicate readings of the same caption, keyed on
  // `normalisedText`. Runs BEFORE matching so a title read twice costs one
  // TMDB call rather than two, and so the two readings cannot resolve
  // differently and then fail to collapse in pass B.
  const passA = collapseOverlap(initial, { pass: 'pre-match', imageOrder });

  const cache = new Map<string, TmdbSearchResult[]>();
  let tmdbUnavailable = false;
  let tmdbQueries = 0;
  let ambiguous = 0;
  let uncertain = 0;

  const outcomes = new Map<string, MatchCandidate[]>();
  const matched = passA.candidates.map((candidate) => candidate);

  for (let index = 0; index < matched.length; index += 1) {
    const candidate = matched[index];
    if (candidate === undefined) continue;
    // Losers carry the survivor's identity by construction — resolving them
    // separately could give two rows of the same tile two identities.
    if (candidate.collapsedIntoCandidateId !== null) continue;
    // An unreadable tile. `matchCandidate` on an empty string would score
    // against every TMDB result identically, which is a coin toss dressed as a
    // match; leaving it null keeps it in the review pass as unidentified.
    if (candidate.normalisedText.length === 0) continue;

    let results: TmdbSearchResult[] = [];
    if (!tmdbUnavailable) {
      const cached = cache.get(candidate.normalisedText);
      if (cached !== undefined) {
        results = cached;
      } else {
        try {
          results = await ports.searchTmdb(candidate.normalisedText);
          tmdbQueries += 1;
          cache.set(candidate.normalisedText, results);
        } catch (error) {
          // ⚠ The outage is latched, not retried per candidate. §4.1 allows two
          // retries INSIDE one search; retrying it once per candidate would turn
          // a TMDB outage into a batch that hangs for minutes.
          tmdbUnavailable = true;
          results = [];
          log('extraction.tmdb_unavailable', { error: String(error) });
        }
      }
    }

    const outcome = tmdbUnavailable
      ? unmatchedOutcome(candidate)
      : matchCandidate(candidate, results);

    if (outcome.ambiguous) ambiguous += 1;
    if (outcome.uncertain) uncertain += 1;

    matched[index] = { ...candidate, resolvedWorkIdentity: outcome.resolvedWorkIdentity };
    outcomes.set(candidate.id, outcome.matchCandidates);
  }

  // Pass B — collapse candidates that resolved to the SAME work despite being
  // read as different text (a truncated caption and its full form). Keyed on
  // the identity pass A could not have known.
  const passB = collapseOverlap(matched, { pass: 'post-match', imageOrder });

  let matchedCount = 0;
  let unmatchedCount = 0;
  let collapsed = 0;

  for (const candidate of passB.candidates) {
    if (candidate.collapsedIntoCandidateId !== null) {
      collapsed += 1;
    } else if (candidate.resolvedWorkIdentity?.startsWith('tmdb:') === true) {
      matchedCount += 1;
    } else if (candidate.resolvedWorkIdentity?.startsWith('unmatched:') === true) {
      unmatchedCount += 1;
    }

    const before = rows.find((row) => row.id === candidate.id);
    const changed =
      before === undefined ||
      before.resolvedWorkIdentity !== candidate.resolvedWorkIdentity ||
      before.collapsedIntoCandidateId !== candidate.collapsedIntoCandidateId ||
      outcomes.has(candidate.id);
    if (!changed) continue;

    try {
      // Serial, not `Promise.all`: 5-DTU Basic database, 0.25-vCPU container.
      await ports.persist({
        candidateId: candidate.id,
        resolvedWorkIdentity: candidate.resolvedWorkIdentity,
        matchCandidates: outcomes.get(candidate.id) ?? [],
        collapsedIntoCandidateId: candidate.collapsedIntoCandidateId,
      });
    } catch (error) {
      // One row's write failing must not cost the batch the other 60
      // resolutions, and must not fail the batch at all.
      log('extraction.resolution_write_failed', {
        candidateId: candidate.id,
        error: String(error),
      });
    }
  }

  return {
    candidatesCollapsed: collapsed,
    matched: matchedCount,
    unmatched: unmatchedCount,
    ambiguous,
    uncertain,
    tmdbQueries,
    tmdbUnavailable,
  };
}
