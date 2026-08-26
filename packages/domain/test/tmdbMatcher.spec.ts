/**
 * TASK-060 — deterministic TMDB match scoring (`specs/ai.md` §4).
 *
 * Test id: `T-TMDB-010` — "Matching queries TMDB with the normalised text;
 * deterministic scoring." The *queries* half is asserted against the client in
 * `apps/api/test/unit/clients/tmdbClient.spec.ts`; the **deterministic
 * scoring** half is asserted here, where it can be exercised without a network
 * fake.
 *
 * Also covers the unit-decidable half of `T-TMDB-012` (US-007 AC-4 —
 * "ambiguous match returns top-5 alternatives inline, flagged `ambiguous`").
 * The component half of that id, which renders the alternatives, belongs to
 * the review UI and is not claimed here.
 *
 * ⚠ EVERY EXPECTED SCORE BELOW WAS MEASURED against the repository's own
 * `jaroWinkler`, not estimated. A hand-guessed threshold fixture is worse than
 * no fixture: it passes, then silently stops describing the boundary it was
 * written to pin.
 */

import { describe, expect, it } from 'vitest';

import {
  MATCH_ALTERNATIVES_LIMIT,
  MATCH_AMBIGUITY_MARGIN,
  MATCH_AUTO_THRESHOLD,
  MATCH_REVIEW_FLOOR,
  matchCandidate,
  scoreTmdbResult,
  unmatchedOutcome,
  type TmdbSearchResult,
} from '../src/matching/tmdbMatcher.js';

function aResult(overrides: Partial<TmdbSearchResult> = {}): TmdbSearchResult {
  return {
    tmdbId: 438631,
    mediaType: 'movie',
    name: 'Dune',
    releaseYear: 2021,
    posterPath: '/poster.jpg',
    ...overrides,
  };
}

describe('T-TMDB-010 · deterministic scoring', () => {
  it('T-TMDB-010a: an exact normalised match scores 1', () => {
    const score = scoreTmdbResult(
      { normalisedText: 'dune', extractedYear: null },
      aResult({ releaseYear: null }),
    );
    expect(score).toBe(1);
  });

  it('T-TMDB-010b: both sides go through the SAME normalisation, so punctuation and articles cannot cause a miss', () => {
    // 'The Matrix' and 'the matrix' both normalise to 'matrix'.
    const score = scoreTmdbResult(
      { normalisedText: 'matrix', extractedYear: null },
      aResult({ name: 'The Matrix!', releaseYear: null }),
    );
    expect(score).toBe(1);
  });

  it('T-TMDB-010c: scoring is a pure function — identical inputs give identical output', () => {
    const candidate = { normalisedText: 'dune', extractedYear: 2021 };
    const result = aResult();
    const runs = Array.from({ length: 5 }, () => scoreTmdbResult(candidate, result));
    expect(new Set(runs).size).toBe(1);
  });

  it('T-TMDB-010d: a year within ±1 adds the bonus', () => {
    const candidate = { normalisedText: 'dune', extractedYear: 2024 };
    const base = scoreTmdbResult(
      { ...candidate, extractedYear: null },
      aResult({ name: 'Dune: Part Two', releaseYear: 2024 }),
    );
    const hinted = scoreTmdbResult(
      candidate,
      aResult({ name: 'Dune: Part Two', releaseYear: 2024 }),
    );

    expect(base).toBeCloseTo(0.861538, 6);
    expect(hinted).toBeCloseTo(base + 0.05, 6);
  });

  it('T-TMDB-010e: a year off by more than 1 subtracts the penalty', () => {
    const penalised = scoreTmdbResult(
      { normalisedText: 'dune', extractedYear: 1984 },
      aResult({ name: 'Dune: Part Two', releaseYear: 2024 }),
    );
    expect(penalised).toBeCloseTo(0.861538 - 0.15, 6);
  });

  it('T-TMDB-010f: the year hint is skipped when either side has no year', () => {
    const noCandidateYear = scoreTmdbResult(
      { normalisedText: 'dune', extractedYear: null },
      aResult({ name: 'Dune: Part Two', releaseYear: 2024 }),
    );
    const noTmdbYear = scoreTmdbResult(
      { normalisedText: 'dune', extractedYear: 2024 },
      aResult({ name: 'Dune: Part Two', releaseYear: null }),
    );
    expect(noCandidateYear).toBeCloseTo(0.861538, 6);
    expect(noTmdbYear).toBeCloseTo(0.861538, 6);
  });

  it('T-TMDB-010g: the score is clamped to 0..1', () => {
    const boosted = scoreTmdbResult(
      { normalisedText: 'dune', extractedYear: 2021 },
      aResult({ releaseYear: 2021 }),
    );
    expect(boosted).toBe(1);

    const floored = scoreTmdbResult(
      { normalisedText: 'zzzz', extractedYear: 1900 },
      aResult({ name: 'Arrival', releaseYear: 2016 }),
    );
    expect(floored).toBeGreaterThanOrEqual(0);
  });
});

describe('T-TMDB-010 · thresholds and outcomes (specs/ai.md §4.3)', () => {
  it('T-TMDB-010h: at or above the auto threshold with a clear runner-up → resolved, not ambiguous, not uncertain', () => {
    const outcome = matchCandidate({ normalisedText: 'fallout', extractedYear: null }, [
      aResult({ tmdbId: 106379, name: 'Fallout', releaseYear: null }),
      aResult({ tmdbId: 200000, name: 'Fallout Boy', releaseYear: null }),
    ]);

    expect(outcome.resolvedWorkIdentity).toBe('tmdb:movie:106379');
    expect(outcome.unmatched).toBe(false);
    expect(outcome.uncertain).toBe(false);
    expect(outcome.ambiguous).toBe(false);
    expect(outcome.matchCandidates[0]!.score).toBe(1);
    expect(outcome.matchCandidates[1]!.score).toBeCloseTo(0.927273, 6);
  });

  it('T-TMDB-010i: a remake — two equally-scoring works — resolves to the top and is flagged ambiguous', () => {
    const outcome = matchCandidate({ normalisedText: 'dune', extractedYear: null }, [
      aResult({ tmdbId: 841, name: 'Dune', releaseYear: 1984 }),
      aResult({ tmdbId: 438631, name: 'Dune', releaseYear: 2021 }),
    ]);

    expect(outcome.ambiguous).toBe(true);
    expect(outcome.unmatched).toBe(false);
    // Tie on score → lower tmdbId wins, because it is stable forever.
    expect(outcome.resolvedWorkIdentity).toBe('tmdb:movie:841');
  });

  it('T-TMDB-010j: the year hint disambiguates the remake, and the flag clears', () => {
    const outcome = matchCandidate({ normalisedText: 'dune', extractedYear: 2021 }, [
      aResult({ tmdbId: 841, name: 'Dune', releaseYear: 1984 }),
      aResult({ tmdbId: 438631, name: 'Dune', releaseYear: 2021 }),
    ]);

    expect(outcome.resolvedWorkIdentity).toBe('tmdb:movie:438631');
    expect(outcome.ambiguous).toBe(false);
  });

  it('T-TMDB-010k: between the review floor and the auto threshold → resolved but uncertain', () => {
    const outcome = matchCandidate({ normalisedText: 'dune', extractedYear: null }, [
      aResult({ tmdbId: 693134, name: 'Dune: Part Two', releaseYear: null }),
    ]);

    const top = outcome.matchCandidates[0]!.score;
    expect(top).toBeGreaterThanOrEqual(MATCH_REVIEW_FLOOR);
    expect(top).toBeLessThan(MATCH_AUTO_THRESHOLD);
    expect(outcome.uncertain).toBe(true);
    expect(outcome.unmatched).toBe(false);
    expect(outcome.resolvedWorkIdentity).toBe('tmdb:movie:693134');
  });

  it('T-TMDB-010l: below the review floor → unmatched identity, and the alternatives are STILL returned', () => {
    const outcome = matchCandidate({ normalisedText: 'arrival', extractedYear: null }, [
      aResult({ tmdbId: 1396, mediaType: 'tv', name: 'Breaking Bad', releaseYear: null }),
    ]);

    expect(outcome.unmatched).toBe(true);
    expect(outcome.resolvedWorkIdentity).toMatch(/^unmatched:[0-9a-f]{16}$/);
    // US-008: never silently discarded — the near-misses stay visible.
    expect(outcome.matchCandidates).toHaveLength(1);
  });

  it('T-TMDB-010m: no TMDB results → unmatched identity and an empty alternatives list', () => {
    const outcome = matchCandidate({ normalisedText: 'dune', extractedYear: null }, []);

    expect(outcome.unmatched).toBe(true);
    expect(outcome.matchCandidates).toEqual([]);
    expect(outcome.resolvedWorkIdentity).toMatch(/^unmatched:[0-9a-f]{16}$/);
  });

  it('T-TMDB-010n: TMDB unreachable produces exactly the same shape as no results (US-007 AC-6)', () => {
    const candidate = { normalisedText: 'dune', extractedYear: null };
    expect(unmatchedOutcome(candidate)).toEqual(matchCandidate(candidate, []));
  });

  it('T-TMDB-010o: the same normalised text always yields the same unmatched identity', () => {
    const a = matchCandidate({ normalisedText: 'the expanse', extractedYear: 2015 }, []);
    // SD-05: the year is a match hint and must NOT enter identity.
    const b = matchCandidate({ normalisedText: 'the expanse', extractedYear: 2019 }, []);
    expect(a.resolvedWorkIdentity).toBe(b.resolvedWorkIdentity);
  });
});

describe('T-TMDB-012 · alternatives are ranked, capped and never hidden', () => {
  it('T-TMDB-012a: at most five alternatives are returned, highest score first', () => {
    const results = Array.from({ length: 8 }, (_, i) =>
      aResult({ tmdbId: 1000 + i, name: `Dune ${'x'.repeat(i)}`, releaseYear: null }),
    );

    const outcome = matchCandidate({ normalisedText: 'dune', extractedYear: null }, results);

    expect(outcome.matchCandidates).toHaveLength(MATCH_ALTERNATIVES_LIMIT);
    const scores = outcome.matchCandidates.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it('T-TMDB-012b: equal scores are broken by the LOWER tmdbId, which is stable forever', () => {
    const outcome = matchCandidate({ normalisedText: 'dune', extractedYear: null }, [
      aResult({ tmdbId: 999, name: 'Dune', releaseYear: null }),
      aResult({ tmdbId: 12, name: 'Dune', releaseYear: null }),
      aResult({ tmdbId: 500, name: 'Dune', releaseYear: null }),
    ]);

    expect(outcome.matchCandidates.map((c) => c.tmdbId)).toEqual([12, 500, 999]);
  });

  it('T-TMDB-012c: an auto-matched candidate still carries its alternatives (US-007 AC-4)', () => {
    const outcome = matchCandidate({ normalisedText: 'dune', extractedYear: null }, [
      aResult({ tmdbId: 438631, name: 'Dune', releaseYear: null }),
      aResult({ tmdbId: 693134, name: 'Dune: Part Two', releaseYear: null }),
    ]);

    expect(outcome.unmatched).toBe(false);
    expect(outcome.matchCandidates.length).toBeGreaterThan(1);
  });

  it('T-TMDB-012d: nothing outside the stored allow-list survives into an alternative', () => {
    const outcome = matchCandidate({ normalisedText: 'dune', extractedYear: null }, [
      aResult({ releaseYear: null }),
    ]);

    expect(Object.keys(outcome.matchCandidates[0]!).sort()).toEqual([
      'mediaType',
      'name',
      'posterPath',
      'releaseYear',
      'score',
      'tmdbId',
    ]);
  });

  it('T-TMDB-012e: the thresholds are the values specs/ai.md §4.3 fixes', () => {
    expect(MATCH_AUTO_THRESHOLD).toBe(0.92);
    expect(MATCH_REVIEW_FLOOR).toBe(0.7);
    expect(MATCH_AMBIGUITY_MARGIN).toBe(0.05);
    expect(MATCH_ALTERNATIVES_LIMIT).toBe(5);
  });
});
