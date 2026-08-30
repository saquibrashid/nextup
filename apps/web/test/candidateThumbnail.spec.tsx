/**
 * `T-AI-041` — the cropped tile thumbnail is rendered beside an
 * `inferred-unverified` (and `unreadable-tile`) candidate (`specs/testing.md`
 * §9 R2, `specs/ui.md` §5.3a, `specs/ai.md` §574 step 7b).
 *
 * ⚠ THIS IS THE REVIEW-SIDE HALF OF THE RSK-028 (fabrication) MITIGATION.
 * `inferred-unverified` means the title came from the model with NO
 * corroborating OCR text; §5.3a requires the tile beside it so verification is
 * "a glance, not an act of faith". `unreadable-tile` has no readable text at
 * all, so the tile is the ONLY evidence it carries and is "never dropped".
 *
 * ⚠ THE TEST MUST NOT SUPPLY `thumbnailUrl` ITSELF. `CandidateCard` accepts a
 * `thumbnailUrl` prop, and for a long time NOBODY passed it — it defaulted to
 * `null`, the render condition was always false, and the thumbnail never once
 * appeared in the running product. A component test that hand-writes the prop
 * would step over exactly that dead wiring and assert nothing about the
 * product. So this file mounts the real container, `ReviewPage`, drives it with
 * a `buildReviewResponse` fixture, and asserts the derivation `ReviewPage`
 * performs from `sourceImageIds` — the seam the defect lived in.
 *
 * ⚠ FIXTURES GO THROUGH `buildReviewResponse`, never a hand-written literal
 * reached with `as ReviewResponse` — see `reviewPage.spec.tsx` for why. The
 * compiler checks the fixture against the real contract, and the server's
 * section routing (`sectionForCandidate`) decides which section each verdict
 * lands in, exactly as in production.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  buildReviewResponse,
  type BuildReviewInput,
  type ReviewCandidate,
  type ReviewMatch,
} from '@nextup/domain';

import { ReviewPage } from '../src/pages/ReviewPage';

function match(overrides: Partial<ReviewMatch> = {}): ReviewMatch {
  return {
    tmdbId: 603,
    mediaType: 'movie',
    name: 'The Matrix',
    releaseYear: 1999,
    posterPath: '/matrix.jpg',
    score: 0.98,
    uncertain: false,
    ambiguous: false,
    ...overrides,
  };
}

function candidate(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    candidateId: 'cand_1',
    rawText: 'THE MATRIX',
    inferredTitle: 'The Matrix',
    basis: 'text',
    ocrSupport: 'corroborated',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 0.94,
    resolvedWorkIdentity: 'tmdb:movie:603',
    match: match(),
    alternatives: [],
    sourceImageIds: ['img_1'],
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    classification: 'new',
    ...overrides,
  };
}

function review(candidates: ReviewCandidate[], overrides: Partial<BuildReviewInput> = {}) {
  return buildReviewResponse({
    batchId: '01J0000000000000000000BTCH',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates,
    disappearedListings: [],
    imagesWithNoText: [],
    ...overrides,
  });
}

/* -------------------------------------------------------------------------- */

describe('T-AI-041 · specs/testing.md §9 R2 · the tile thumbnail is rendered beside an unverified candidate', () => {
  it('T-AI-041a: an inferred-unverified addition renders its tile from GET /api/images', () => {
    // ⚠ Lands in the ADDITIONS section (default render path). The card gets
    // NO `thumbnailUrl` from this test — `ReviewPage` derives it from the
    // candidate's `sourceImageIds`, which is the wiring under test.
    render(
      <ReviewPage
        review={review([
          candidate({ verdict: 'inferred-unverified', sourceImageIds: ['img_abc'] }),
        ])}
      />,
    );

    const thumb = within(screen.getByTestId('review-additions')).getByTestId('candidate-thumb');
    expect(thumb.tagName).toBe('IMG');
    expect(thumb).toHaveAttribute('src', '/api/images/img_abc');
  });

  it('T-AI-041b: an unreadable-tile candidate renders its tile — it is the only evidence it carries', () => {
    // `unreadable-tile` is routed to `unreadableTiles` server-side; `rawText`
    // and `match` are legitimately empty, so the tile is all there is.
    render(
      <ReviewPage
        review={review([
          candidate({
            candidateId: 'cand_unreadable',
            verdict: 'unreadable-tile',
            rawText: '',
            inferredTitle: null,
            match: null,
            resolvedWorkIdentity: null,
            classification: null,
            sourceImageIds: ['img_tile'],
          }),
        ])}
      />,
    );

    const thumb = within(screen.getByTestId('review-unreadable-tiles')).getByTestId(
      'candidate-thumb',
    );
    expect(thumb).toHaveAttribute('src', '/api/images/img_tile');
  });

  it('T-AI-041c: an inferred-unverified candidate in the UNMATCHED section also renders its tile', () => {
    // ⚠ Covers the SECOND render site — the §6.8 unmatched treatment uses a
    // `renderCard` override, a separate `<CandidateCard>` that must also
    // receive the derived URL. A candidate with a null work identity is routed
    // to `unmatched`.
    render(
      <ReviewPage
        review={review([
          candidate({
            candidateId: 'cand_unmatched',
            verdict: 'inferred-unverified',
            match: null,
            resolvedWorkIdentity: null,
            classification: null,
            sourceImageIds: ['img_unm'],
          }),
        ])}
      />,
    );

    const thumb = within(screen.getByTestId('review-unmatched')).getByTestId('candidate-thumb');
    expect(thumb).toHaveAttribute('src', '/api/images/img_unm');
  });

  it('T-AI-041d: an inferred-unverified candidate with NO source image renders no broken image', () => {
    // ⚠ `noUncheckedIndexedAccess`: `sourceImageIds[0]` is `undefined`, so the
    // derived URL is `null` and the card must NOT emit an `<img>` with an empty
    // `src`. A card that always passes a URL would render a broken tile here.
    render(
      <ReviewPage
        review={review([
          candidate({
            verdict: 'inferred-unverified',
            sourceImageIds: [],
            match: match({ posterPath: null }),
          }),
        ])}
      />,
    );

    expect(screen.queryByTestId('candidate-thumb')).not.toBeInTheDocument();
    // and no stray <img> with an empty source anywhere on the card.
    for (const img of screen.queryAllByRole('img')) {
      expect(img).not.toHaveAttribute('src', '');
    }
  });

  it('T-AI-041e: an ordinary title-candidate renders NO tile thumbnail', () => {
    // Otherwise a card that always shows the tile would satisfy T-AI-041a while
    // putting a raw screenshot beside every corroborated match.
    render(<ReviewPage review={review([candidate()])} />);

    expect(screen.queryByTestId('candidate-thumb')).not.toBeInTheDocument();
    // The corroborated match keeps its TMDB poster instead.
    expect(screen.getByTestId('candidate-poster')).toBeInTheDocument();
  });
});
