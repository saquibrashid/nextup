/**
 * Stage 3 — deterministic TMDB match scoring (`specs/ai.md` §4, TASK-060).
 *
 * **No ML, no AI call, no network.** This module is pure arithmetic over
 * strings that Stage 2 already produced. That is Rule A (`specs/ai.md` §0):
 * the model reads pixels, and nothing else in the pipeline is allowed to ask
 * it a question.
 *
 * ⚠ PATH DEVIATION FROM `specs/ai.md`, REPORTED NOT SMUGGLED. §4 heads the
 * section `apps/api/src/matching/tmdbMatcher.ts`; `docs/backlog.md` TASK-060 —
 * the work order — names `packages/domain/src/matching/tmdbMatcher.ts`, and
 * that is what this is. The split is real and both documents describe part of
 * it:
 *
 *   - **Scoring and threshold arithmetic are pure**, so they belong in
 *     `packages/domain` where they can be tested without a network fake, and
 *     where `apps/web` can import the same thresholds the API applied.
 *   - **TMDB I/O is not pure** — the endpoints, the API key, the 4-concurrent
 *     rate limit and the per-batch cache described in §4.1 stay in
 *     `apps/api` (`clients/tmdbClient.ts`, already built by TASK-045).
 *
 * §4.4's structural rule is unaffected: it forbids `matching` importing
 * `extraction`, and this file imports no extraction logic — only `identity.js`
 * and the shared `jaroWinkler` primitive. Recorded as a spec finding rather
 * than resolved by quietly picking one path.
 *
 * ⚠ THE SIMILARITY FUNCTION IS THE SHARED ONE. `jaroWinkler` comes from
 * `../extraction/jaroWinkler.js` — the same implementation the cross-check
 * scores with. `specs/ai.md` §3.2 step 6 states the principle for
 * normalisation and it applies identically here: a second implementation
 * drifts, and when it does, two subsystems disagree about whether two strings
 * name the same work. That surfaces as a duplicate row or a bypassed
 * suppression, never as an error.
 */

import type { MediaType } from '../enums.js';
import { jaroWinkler } from '../extraction/jaroWinkler.js';
import { normaliseTitleText, workIdentityForTmdb, workIdentityForUnmatched } from '../identity.js';
import type { MatchCandidate } from '../types.js';

/** `>=` → resolved to that TMDB work (`specs/ai.md` §4.3). */
export const MATCH_AUTO_THRESHOLD = 0.92;

/** `[floor, auto)` → resolved, but flagged `uncertain`. Below → unmatched. */
export const MATCH_REVIEW_FLOOR = 0.7;

/**
 * A runner-up within this margin of an auto-matched top makes the result
 * `ambiguous` — the remake case (`specs/ai.md` §4.3).
 */
export const MATCH_AMBIGUITY_MARGIN = 0.05;

/** Added when TMDB's year is within ±1 of the extracted year (§4.2 step 3). */
export const YEAR_HINT_BONUS = 0.05;

/** Subtracted when TMDB's year differs by more than 1 (§4.2 step 3). */
export const YEAR_HINT_PENALTY = 0.15;

/** Tolerance, in years, for "the same work" (§4.2 step 3). */
export const YEAR_HINT_TOLERANCE = 1;

/** Alternatives are always returned, never hidden (US-007 AC-4). */
export const MATCH_ALTERNATIVES_LIMIT = 5;

/**
 * One TMDB search hit, already reduced to the fields nextup is allowed to
 * store (REQ-029; `T-TMDB-013` rejects anything outside this set).
 */
export interface TmdbSearchResult {
  tmdbId: number;
  mediaType: MediaType;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
}

/** The scoring inputs a candidate contributes. Deliberately not the whole candidate. */
export interface MatchableCandidate {
  /** `normaliseTitleText(inferredTitle ?? rawText)` — `specs/ai.md` §3.1a. */
  normalisedText: string;
  /** MATCH HINT ONLY — never enters identity (SD-05). */
  extractedYear: number | null;
}

export interface MatchOutcome {
  /**
   * Always a work identity, never `null`: a candidate TMDB could not identify
   * resolves to `unmatched:<hash>` (`specs/data-model.md` §2) so that dedup,
   * suppression and reappearance all keep working for unidentified titles.
   */
  resolvedWorkIdentity: string;
  /** Top 5, highest first. May be empty when TMDB returned nothing. */
  matchCandidates: MatchCandidate[];
  /** Top scored at or above the auto threshold, but a runner-up is within the margin. */
  ambiguous: boolean;
  /** Top scored in `[MATCH_REVIEW_FLOOR, MATCH_AUTO_THRESHOLD)`. */
  uncertain: boolean;
  /** `true` when the top score fell below the review floor, or there were no results. */
  unmatched: boolean;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Score one candidate against one TMDB result, `0..1` (`specs/ai.md` §4.2).
 *
 * ⚠ Popularity is deliberately NOT an input. It changes daily, which would
 * make the same batch score differently on two runs and every golden fixture
 * untestable. Ties are broken by lower `tmdbId`, which is stable forever —
 * that tie-break lives in {@link matchCandidate}'s sort, because it is an
 * ordering rule rather than a property of a single pair.
 */
export function scoreTmdbResult(candidate: MatchableCandidate, result: TmdbSearchResult): number {
  const a = candidate.normalisedText;
  // The SAME normalisation on both sides — §4.2 step 1.
  const b = normaliseTitleText(result.name);

  const base = a === b ? 1 : jaroWinkler(a, b);

  const extractedYear = candidate.extractedYear;
  const tmdbYear = result.releaseYear;
  if (extractedYear === null || tmdbYear === null) return clamp01(base);

  const drift = Math.abs(extractedYear - tmdbYear);
  return clamp01(drift <= YEAR_HINT_TOLERANCE ? base + YEAR_HINT_BONUS : base - YEAR_HINT_PENALTY);
}

/**
 * Rank TMDB results for a candidate and decide its identity (`specs/ai.md` §4.3).
 *
 * ⚠ Alternatives are returned in EVERY outcome, including an auto-match and
 * including an unmatched result. US-007 AC-4 makes the one-tap correction
 * always available in review; hiding the alternates because the top score
 * looked confident is precisely the silent-wrong-match failure the review pass
 * exists to catch.
 */
export function matchCandidate(
  candidate: MatchableCandidate,
  results: readonly TmdbSearchResult[],
): MatchOutcome {
  const scored: MatchCandidate[] = results
    .map((result) => ({
      tmdbId: result.tmdbId,
      mediaType: result.mediaType,
      name: result.name,
      releaseYear: result.releaseYear,
      posterPath: result.posterPath,
      score: scoreTmdbResult(candidate, result),
    }))
    .sort((x, y) => (y.score !== x.score ? y.score - x.score : x.tmdbId - y.tmdbId));

  const matchCandidates = scored.slice(0, MATCH_ALTERNATIVES_LIMIT);
  const top = matchCandidates[0];

  if (top === undefined || top.score < MATCH_REVIEW_FLOOR) {
    return {
      resolvedWorkIdentity: workIdentityForUnmatched(candidate.normalisedText),
      matchCandidates,
      ambiguous: false,
      uncertain: false,
      unmatched: true,
    };
  }

  const resolvedWorkIdentity = workIdentityForTmdb(top.mediaType, top.tmdbId);

  if (top.score < MATCH_AUTO_THRESHOLD) {
    return {
      resolvedWorkIdentity,
      matchCandidates,
      ambiguous: false,
      uncertain: true,
      unmatched: false,
    };
  }

  const runnerUp = matchCandidates[1];
  const ambiguous = runnerUp !== undefined && top.score - runnerUp.score < MATCH_AMBIGUITY_MARGIN;

  return { resolvedWorkIdentity, matchCandidates, ambiguous, uncertain: false, unmatched: false };
}

/**
 * TMDB unreachable → every candidate resolves to `unmatched:<hash>`, the batch
 * still reaches `in-review`, and extraction does NOT fail (US-007 AC-6,
 * `T-AI-017`).
 *
 * Exported as its own function so the unreachable path cannot drift from the
 * no-results path: both must produce an identical shape, or a TMDB outage
 * would render differently in review from a genuine miss.
 */
export function unmatchedOutcome(candidate: MatchableCandidate): MatchOutcome {
  return matchCandidate(candidate, []);
}
