/**
 * REQ-109 (`A52`) — `chosenReviewMatch`, the projection that decides which
 * identity a review card shows. `T-API-022`.
 *
 * **What this guards.** After the owner corrects a wrong match, the review
 * read used to serve `matchCandidates[0]` — the identity they had just
 * REJECTED — because `applyCorrection` deliberately never rewrites
 * `matchCandidates`. The owner saw the wrong title still sitting on the card
 * they had just fixed, could not tell whether their correction had taken, and
 * applied the batch on a guess.
 *
 * ⚠ **THE REJECTED ALTERNATIVE IS PRESENT IN EVERY CORRECTED CASE BELOW, ON
 * PURPOSE.** A fixture with an empty `alternatives` array would pass with the
 * corrected branch deleted, because there would be nothing wrong left to fall
 * back TO. The defect only exists when both facts are in the row at once, so
 * every case here puts them there.
 */

import { describe, expect, it } from 'vitest';
import { chosenReviewMatch, type ChosenMatchInput, type ReviewMatchRef } from '../src/review.js';

/** What the extraction guessed, and the owner rejected. */
const HILL_HOUSE: ReviewMatchRef = {
  tmdbId: 949,
  mediaType: 'tv',
  name: 'The Haunting of Hill House',
  releaseYear: 2018,
  posterPath: '/hill.jpg',
  score: 0.62,
};

const RUNNER_UP: ReviewMatchRef = {
  tmdbId: 1234,
  mediaType: 'tv',
  name: 'The Haunting',
  releaseYear: 1999,
  posterPath: null,
  score: 0.6,
};

function input(overrides: Partial<ChosenMatchInput> = {}): ChosenMatchInput {
  return {
    reviewDisposition: 'corrected',
    resolvedWorkIdentity: 'tmdb:tv:66732',
    correctedToTmdbId: 66732,
    correctedDisplayName: 'The Haunting of Bly Manor',
    correctedDisplayYear: 2020,
    correctedDisplayPoster: '/bly.jpg',
    alternatives: [HILL_HOUSE],
    ...overrides,
  };
}

describe('T-API-022 · the review read serves the owner\u2019s correction, not the rejected guess', () => {
  it('T-API-022a: a corrected candidate resolves to the corrected identity', () => {
    expect(chosenReviewMatch(input())).toMatchObject({
      tmdbId: 66732,
      mediaType: 'tv',
      name: 'The Haunting of Bly Manor',
      releaseYear: 2020,
      posterPath: '/bly.jpg',
    });
  });

  it('T-API-022b: and NOT to the extraction\u2019s top alternative', () => {
    // ⚠ The case that fails if the corrected branch is removed. `alternatives`
    // still holds the rejected guess and `resolvedWorkIdentity` still starts
    // with `tmdb:`, so the fallback path is live and would return it.
    const match = chosenReviewMatch(input());

    expect(match?.tmdbId).not.toBe(HILL_HOUSE.tmdbId);
    expect(match?.name).not.toBe(HILL_HOUSE.name);
  });

  it('T-API-022c: a hand-made correction is never chipped uncertain or ambiguous', () => {
    // The owner picked this identity themselves. Deriving these flags from the
    // ALTERNATIVES' scores would describe a different candidate and cast doubt
    // on the owner's own choice — here the alternatives are both low-scoring
    // and within 0.05 of each other, which is exactly what would produce a
    // false "uncertain"/"ambiguous" pair.
    const match = chosenReviewMatch(input({ alternatives: [HILL_HOUSE, RUNNER_UP] }));

    expect(match?.uncertain).toBe(false);
    expect(match?.ambiguous).toBe(false);
    expect(match?.score).toBe(1);
  });

  it('T-API-022d: the media type is READ from the identity, not assumed', () => {
    const match = chosenReviewMatch(
      input({ resolvedWorkIdentity: 'tmdb:movie:438631', correctedToTmdbId: 438631 }),
    );

    expect(match?.mediaType).toBe('movie');
  });

  it('T-API-022e: a corrected row with no stored display name falls back rather than inventing one', () => {
    // ⚠ Honest degradation, and the reason the unnamed copy survives in the
    // UI. A correction stored before these columns existed has no name; the
    // card says so instead of interpolating an empty string.
    const match = chosenReviewMatch(input({ correctedDisplayName: null }));

    expect(match?.tmdbId).toBe(HILL_HOUSE.tmdbId);
  });

  it('T-API-022f: an uncorrected candidate is unaffected', () => {
    const match = chosenReviewMatch(
      input({
        reviewDisposition: 'pending',
        resolvedWorkIdentity: 'tmdb:tv:949',
        correctedToTmdbId: null,
        correctedDisplayName: null,
        correctedDisplayYear: null,
        correctedDisplayPoster: null,
      }),
    );

    expect(match).toMatchObject({ tmdbId: HILL_HOUSE.tmdbId, uncertain: true });
  });

  it('T-API-022g: an unmatched identity still resolves to no match', () => {
    expect(
      chosenReviewMatch(
        input({
          reviewDisposition: 'pending',
          resolvedWorkIdentity: 'unmatched:0123456789abcdef',
          correctedToTmdbId: null,
          correctedDisplayName: null,
        }),
      ),
    ).toBeNull();
  });

  it('T-API-022h: a null year and poster are carried through as null, not dropped', () => {
    const match = chosenReviewMatch(
      input({ correctedDisplayYear: null, correctedDisplayPoster: null }),
    );

    expect(match?.name).toBe('The Haunting of Bly Manor');
    expect(match?.releaseYear).toBeNull();
    expect(match?.posterPath).toBeNull();
  });
});
