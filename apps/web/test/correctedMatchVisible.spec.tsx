/**
 * REQ-109 (`A52`) — a corrected match is visibly reflected on the card that
 * was corrected. `T-UX-106`, `T-UX-107`, `T-UX-108`.
 *
 * **The defect these close.** The owner fixed a wrong match, the card kept
 * showing the identity they had just rejected, and they applied the batch on a
 * guess. The review screen is the owner's confirmation step — the entire
 * safety model of this product is that nothing changes the list until the
 * owner has seen what was read and agreed to it — so a screen that withholds
 * the effect of the owner's own correction has broken the contract it exists
 * to keep.
 *
 * ⚠ **`T-UX-107` IS THE LOAD-BEARING CASE, AND IT MUST RENDER FROM SERVER
 * STATE.** The original bug was invisible in the click path: immediately after
 * the click the component held the name in local state and said "Matched to
 * X." correctly. It was only on a re-render from the refetched payload that
 * the name became `null` and the copy fell back to a generic sentence. A test
 * that only clicks and asserts therefore passes over the entire defect. Every
 * case below that matters mounts the page with `disposition: 'corrected'`
 * ALREADY SET — i.e. exactly what the server returns after the PATCH — rather
 * than driving the UI.
 *
 * ⚠ **The corrected identity reaches the card through `match`, which the
 * SERVER now projects from the owner's correction** (`routes/batchReview.ts`).
 * These cases pin the client half; `apps/api/test/unit/batchReviewCorrected.spec.ts`
 * pins the projection itself, and `packages/domain/test/candidatePatch.spec.ts`
 * pins the request contract that carries it.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildReviewResponse, type ReviewDisposition, type ReviewMatch } from '@nextup/domain';

import { UNMATCHED_MATCHED, UNMATCHED_MATCHED_UNNAMED } from '../src/copy';
import { ReviewPage } from '../src/pages/ReviewPage';
import { TMDB_IMAGE_BASE } from '../src/components/TitleRow';
import type { TmdbSearchResult } from '../src/lib/apiClient';

/** What the owner picks in the search panel — the RIGHT answer. */
const BLY_MANOR: TmdbSearchResult = {
  tmdbId: 66732,
  mediaType: 'tv',
  name: 'The Haunting of Bly Manor',
  releaseYear: 2020,
  posterPath: '/bly.jpg',
};

/** What the extraction guessed — the WRONG answer the owner rejected. */
const WRONG_GUESS: ReviewMatch = {
  tmdbId: 949,
  mediaType: 'tv',
  name: 'The Haunting of Hill House',
  releaseYear: 2018,
  posterPath: '/hill.jpg',
  score: 0.62,
  uncertain: true,
  ambiguous: false,
};

/** What the server projects once the correction is stored (REQ-109). */
const CORRECTED: ReviewMatch = {
  tmdbId: BLY_MANOR.tmdbId,
  mediaType: 'tv',
  name: BLY_MANOR.name,
  releaseYear: BLY_MANOR.releaseYear,
  posterPath: BLY_MANOR.posterPath,
  score: 1,
  uncertain: false,
  ambiguous: false,
};

/**
 * ⚠ Built through the DOMAIN's own projection, like every other review test
 * here: hand-rolling the response would let this file assert that the page
 * renders a section the server never sends.
 *
 * `match` and `disposition` are the two axes REQ-109 is about — `match` is
 * what the server resolved, `disposition` is how it got there.
 */
function reviewWith(disposition: ReviewDisposition, match: ReviewMatch | null) {
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'append-only',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [
      {
        candidateId: 'cnd_u',
        rawText: 'THE HAUNTNG OF BLY MANR',
        inferredTitle: null,
        basis: 'text',
        ocrSupport: 'corroborated',
        provider: 'llm',
        verdict: 'title-candidate',
        ocrConfidence: 0.71,
        resolvedWorkIdentity:
          match === null ? 'unmatched:0123456789abcdef' : `tmdb:${match.mediaType}:${match.tmdbId}`,
        match,
        // ⚠ THE EXTRACTION'S GUESS STAYS HERE AFTER THE CORRECTION, and that
        // is deliberate: `applyCorrection` never rewrites `matchCandidates`.
        // Its presence is what makes these cases meaningful — the wrong name
        // really is still in the payload, so a card showing the right one is
        // showing the owner's decision rather than an empty alternatives list.
        alternatives: [WRONG_GUESS],
        sourceImageIds: ['img_1'],
        disposition,
        collapsedIntoCandidateId: null,
        classification: null,
      },
    ],
    disappearedListings: [],
    imagesWithNoText: [],
  });
}

function wired(overrides: Record<string, unknown> = {}) {
  return {
    onKeepUnmatched: vi.fn().mockResolvedValue(undefined),
    onDiscardUnmatched: vi.fn().mockResolvedValue(undefined),
    onMatchUnmatched: vi.fn().mockResolvedValue(undefined),
    onSearchTmdb: vi.fn().mockResolvedValue([BLY_MANOR]),
    ...overrides,
  };
}

function card() {
  return within(screen.getByTestId('candidate-cnd_u'));
}

describe('T-UX-106 · the corrected card shows the identity the owner chose', () => {
  it('T-UX-106a: the card names the corrected title, not the extracted guess', () => {
    render(<ReviewPage review={reviewWith('corrected', CORRECTED)} {...wired()} />);

    expect(card().getByTestId('candidate-name')).toHaveTextContent('The Haunting of Bly Manor');
  });

  it('T-UX-106b: and the rejected name is gone from the card entirely', () => {
    // ⚠ The negative half, and the one that would have caught the defect.
    // Before REQ-109 the review read served `alternatives[0]`, so this card
    // displayed "The Haunting of Hill House" — the identity the owner had
    // just rejected — while reporting the correction as applied.
    render(<ReviewPage review={reviewWith('corrected', CORRECTED)} {...wired()} />);

    expect(card().queryByText('The Haunting of Hill House')).not.toBeInTheDocument();
  });

  it('T-UX-106c: the poster is the corrected one', () => {
    render(<ReviewPage review={reviewWith('corrected', CORRECTED)} {...wired()} />);

    expect(card().getByTestId('candidate-poster')).toHaveAttribute(
      'src',
      `${TMDB_IMAGE_BASE}/bly.jpg`,
    );
  });

  it('T-UX-106d: and NOT the rejected one', () => {
    render(<ReviewPage review={reviewWith('corrected', CORRECTED)} {...wired()} />);

    expect(card().getByTestId('candidate-poster')).not.toHaveAttribute(
      'src',
      `${TMDB_IMAGE_BASE}/hill.jpg`,
    );
  });

  it('T-UX-106e: the corrected year is shown', () => {
    render(<ReviewPage review={reviewWith('corrected', CORRECTED)} {...wired()} />);

    expect(card().getByTestId('candidate-meta')).toHaveTextContent('2020');
  });

  it('T-UX-106f: the raw extracted text is STILL visible beside it', () => {
    // ⚠ REQ-109 must not cost `T-REV-013`. The owner's only way to tell a good
    // match from a plausible wrong one is to see what was read off the
    // screenshot beside what nextup decided it meant — a corrected card is no
    // exception, and hiding the raw text here would remove the evidence that
    // makes the correction checkable.
    render(<ReviewPage review={reviewWith('corrected', CORRECTED)} {...wired()} />);

    expect(card().getByTestId('candidate-raw-text')).toHaveTextContent('THE HAUNTNG OF BLY MANR');
  });

  it('T-UX-106g: the correction is reported through the click path too', async () => {
    const user = userEvent.setup();
    const onMatchUnmatched = vi.fn().mockResolvedValue(undefined);
    render(<ReviewPage review={reviewWith('pending', null)} {...wired({ onMatchUnmatched })} />);

    await user.click(screen.getByTestId('unmatched-find'));
    await user.type(screen.getByLabelText(/search tmdb for this title/i), 'bly manor');
    await user.click(screen.getByRole('button', { name: /^find a match$/i }));
    await user.click(await screen.findByRole('button', { name: /use the haunting of bly manor/i }));

    // ⚠ The DISPLAY FIELDS must reach the handler. Without them the server has
    // no name to store, the review read falls back to `matchCandidates[0]`,
    // and the whole requirement silently reverts to the old behaviour while
    // every other case in this file still passes.
    await waitFor(() => {
      expect(onMatchUnmatched).toHaveBeenCalledWith(
        'cnd_u',
        expect.objectContaining({
          tmdbId: BLY_MANOR.tmdbId,
          mediaType: 'tv',
          name: BLY_MANOR.name,
          releaseYear: BLY_MANOR.releaseYear,
          posterPath: BLY_MANOR.posterPath,
        }),
      );
    });
  });
});

describe('T-UX-107 · the correction survives a re-render from server state', () => {
  it('T-UX-107a: a card mounted as already-corrected NAMES what it was corrected to', () => {
    // ⚠ NO CLICK. This is the regression: the click path always looked right,
    // and the name was lost only on a render driven by the refetched payload.
    render(<ReviewPage review={reviewWith('corrected', CORRECTED)} {...wired()} />);

    expect(card().getByTestId('addition-outcome')).toHaveTextContent(
      UNMATCHED_MATCHED.replace('{name}', 'The Haunting of Bly Manor'),
    );
  });

  it('T-UX-107b: and does not fall back to the unnamed copy', () => {
    render(<ReviewPage review={reviewWith('corrected', CORRECTED)} {...wired()} />);

    expect(card().queryByText(UNMATCHED_MATCHED_UNNAMED)).not.toBeInTheDocument();
  });

  it('T-UX-107c: a re-render with the same server state keeps naming it', async () => {
    const { rerender } = render(
      <ReviewPage review={reviewWith('corrected', CORRECTED)} {...wired()} />,
    );
    rerender(<ReviewPage review={reviewWith('corrected', CORRECTED)} {...wired()} />);

    await waitFor(() => {
      expect(card().getByTestId('addition-outcome')).toHaveTextContent('The Haunting of Bly Manor');
    });
  });

  it('T-UX-107d: a correction the server has no name for still reports honestly', () => {
    // ⚠ The unnamed copy is KEPT, not deleted. A correction stored before the
    // display fields existed has no name on the server, and none is invented:
    // "Matched to ." would read as a bug in the match rather than as a card
    // that cannot name it. The requirement is that the screen never MISNAMES
    // the correction, not that it always has a name.
    render(<ReviewPage review={reviewWith('corrected', null)} {...wired()} />);

    expect(card().getByTestId('unmatched-outcome')).toHaveTextContent(UNMATCHED_MATCHED_UNNAMED);
  });
});

describe('T-UX-108 · the correction is announced', () => {
  it('T-UX-108a: the outcome sits in a live region', () => {
    render(<ReviewPage review={reviewWith('corrected', CORRECTED)} {...wired()} />);

    expect(card().getByTestId('addition-outcome')).toHaveAttribute('role', 'status');
  });

  it('T-UX-108b: and the announcement names the corrected title', () => {
    // ⚠ A live region that says "Matched to the title you chose." announces
    // that SOMETHING happened without saying what — which for a screen-reader
    // user is the same defect sighted owners hit, with no poster to fall back
    // on.
    render(<ReviewPage review={reviewWith('corrected', CORRECTED)} {...wired()} />);

    const live = card().getByTestId('addition-outcome');
    expect(live).toHaveAttribute('role', 'status');
    expect(live).toHaveTextContent('The Haunting of Bly Manor');
  });
});
