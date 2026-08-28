/**
 * TASK-068 — the §6.8 unmatched card (`specs/ux-states.md` §6.8, US-008).
 *
 * `T-UX-063` — the **C** half. The domain half (`packages/domain/test/review.spec.ts`)
 * proves an unmatched candidate is ROUTED to the unmatched section; these
 * cases prove the section the owner actually sees renders the raw text, the
 * "Unidentified" chip and the three actions, and that a decided card reports
 * what was decided.
 *
 * `T-UNM-010` — US-008 AC-2: all three actions are available. ⚠ Asserted
 * against the MOUNTED page, not the component in isolation. `FixMatchDialog`
 * is the standing example of why: it is fully built, fully tested, and no
 * screen has ever rendered it, so every one of its cases passes while the
 * affordance does not exist.
 *
 * ⚠ **THE NEGATIVE CASES ARE THE POINT OF THIS FILE.** "Keeping is a
 * supported outcome" is only true if a keep is not silently dropped: the
 * refusal case asserts the card stays undecided and SAYS so, because a card
 * that claimed "kept" over a row the server still holds `pending` would send
 * the owner into a close that 409s naming a candidate they believe they dealt
 * with.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildReviewResponse, type ReviewDisposition } from '@nextup/domain';

import {
  UNMATCHED_ACTION_FAILED,
  UNMATCHED_CHIP,
  UNMATCHED_DISCARDED,
  UNMATCHED_KEPT,
  UNMATCHED_MATCHED,
} from '../src/copy';
import { ReviewPage } from '../src/pages/ReviewPage';
import type { TmdbSearchResult } from '../src/lib/apiClient';

const DUNE: TmdbSearchResult = {
  tmdbId: 438631,
  mediaType: 'movie',
  name: 'Dune',
  releaseYear: 2021,
  posterPath: null,
};

/**
 * ⚠ Built by the DOMAIN's own projection. The section a candidate lands in is
 * `sectionForCandidate`, server-side; hand-rolling the response here would let
 * this file assert that the page renders a section the server never sends.
 */
function reviewWithUnmatched(disposition: ReviewDisposition = 'pending') {
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
        resolvedWorkIdentity: 'unmatched:0123456789abcdef',
        match: null,
        alternatives: [],
        sourceImageIds: ['img_1'],
        disposition,
        collapsedIntoCandidateId: null,
        classification: null,
      },
      // ⚠ A SECOND null-match row in a DIFFERENT section. Without it the
      // "an addition does not carry the chip" case passes over an empty
      // section and asserts nothing.
      {
        candidateId: 'cnd_c',
        rawText: 'CONTINUE WATCHING',
        inferredTitle: null,
        basis: 'text',
        ocrSupport: 'corroborated',
        provider: 'llm',
        verdict: 'chrome-suspected',
        ocrConfidence: 0.95,
        resolvedWorkIdentity: null,
        match: null,
        alternatives: [],
        sourceImageIds: ['img_1'],
        disposition: 'pending',
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
    onSearchTmdb: vi.fn().mockResolvedValue([DUNE]),
    ...overrides,
  };
}

function unmatchedSection() {
  return within(screen.getByTestId('review-unmatched'));
}

describe('T-UX-063 · unmatched candidates render in their own section with raw text', () => {
  it('T-UX-063e: the raw extracted text is rendered inside the unmatched section', () => {
    render(<ReviewPage review={reviewWithUnmatched()} {...wired()} />);

    expect(unmatchedSection().getByTestId('candidate-raw-text')).toHaveTextContent(
      'THE HAUNTNG OF BLY MANR',
    );
  });

  it('T-UX-063f: and the row is NOT in the additions section', () => {
    render(<ReviewPage review={reviewWithUnmatched()} {...wired()} />);

    expect(
      within(screen.getByTestId('review-additions')).queryByTestId('candidate-cnd_u'),
    ).not.toBeInTheDocument();
  });

  it('T-UX-063g: the card carries the "Unidentified" chip', () => {
    render(<ReviewPage review={reviewWithUnmatched()} {...wired()} />);

    expect(unmatchedSection().getByText(UNMATCHED_CHIP)).toBeInTheDocument();
  });

  it('T-UX-063h: and a chrome-suspected row does NOT — the chip is not derived from a null match', () => {
    // ⚠ The guard against deriving the chip inside the card. `probablyNotTitles`
    // and `unreadableTiles` also carry a null match, so a derived chip would
    // claim TMDB had been asked about rows it was never asked about.
    render(<ReviewPage review={reviewWithUnmatched()} {...wired()} />);

    const chrome = within(screen.getByTestId('review-probably-not-titles'));
    expect(chrome.getByTestId('candidate-cnd_c')).toBeInTheDocument();
    expect(chrome.queryByText(UNMATCHED_CHIP)).not.toBeInTheDocument();
    expect(screen.getAllByText(UNMATCHED_CHIP)).toHaveLength(1);
  });
});

describe('T-UNM-010 · all three actions are available on the mounted review', () => {
  it('T-UNM-010c: keep, find-a-match and discard are all rendered', () => {
    render(<ReviewPage review={reviewWithUnmatched()} {...wired()} />);

    const section = unmatchedSection();
    expect(section.getByTestId('unmatched-keep')).toBeInTheDocument();
    expect(section.getByTestId('unmatched-find')).toBeInTheDocument();
    expect(section.getByTestId('unmatched-discard')).toBeInTheDocument();
  });

  it('T-UNM-010d: keeping sends the §6.18 confirm and the card says it was kept', async () => {
    const props = wired();
    render(<ReviewPage review={reviewWithUnmatched()} {...props} />);

    await userEvent.click(unmatchedSection().getByTestId('unmatched-keep'));

    expect(props.onKeepUnmatched).toHaveBeenCalledWith('cnd_u');
    await waitFor(() => {
      expect(screen.getByTestId('unmatched-outcome')).toHaveTextContent(UNMATCHED_KEPT);
    });
  });

  it('T-UNM-010e: discarding sends the discard and says what was lost', async () => {
    const props = wired();
    render(<ReviewPage review={reviewWithUnmatched()} {...props} />);

    await userEvent.click(unmatchedSection().getByTestId('unmatched-discard'));

    expect(props.onDiscardUnmatched).toHaveBeenCalledWith('cnd_u');
    await waitFor(() => {
      expect(screen.getByTestId('unmatched-outcome')).toHaveTextContent(UNMATCHED_DISCARDED);
    });
  });

  it('T-UNM-010f: find-a-match searches and matches on an explicit press', async () => {
    const props = wired();
    render(<ReviewPage review={reviewWithUnmatched()} {...props} />);

    await userEvent.click(unmatchedSection().getByTestId('unmatched-find'));
    await userEvent.type(screen.getByLabelText(/search tmdb for this title/i), 'bly manor');
    await userEvent.click(screen.getByRole('button', { name: /^find a match$/i }));

    const useIt = await screen.findByRole('button', { name: /use dune/i });
    // ⚠ NOT matched yet. The search alone must change nothing (REQ-014): for an
    // unmatched row the text is by definition text TMDB did not recognise, so
    // the top hit is more often wrong than right.
    expect(props.onMatchUnmatched).not.toHaveBeenCalled();

    await userEvent.click(useIt);

    expect(props.onMatchUnmatched).toHaveBeenCalledWith('cnd_u', DUNE);
    await waitFor(() => {
      expect(screen.getByTestId('unmatched-outcome')).toHaveTextContent(
        UNMATCHED_MATCHED.replace('{name}', 'Dune'),
      );
    });
  });

  it('T-UNM-010g: a REFUSED keep leaves the card undecided and says so', async () => {
    const props = wired({ onKeepUnmatched: vi.fn().mockRejectedValue(new Error('nope')) });
    render(<ReviewPage review={reviewWithUnmatched()} {...props} />);

    await userEvent.click(unmatchedSection().getByTestId('unmatched-keep'));

    expect(await screen.findByTestId('unmatched-failure')).toHaveTextContent(
      UNMATCHED_ACTION_FAILED,
    );
    // The actions are still there: the decision has NOT been made.
    expect(screen.getByTestId('unmatched-keep')).toBeInTheDocument();
    expect(screen.queryByTestId('unmatched-outcome')).not.toBeInTheDocument();
  });

  it('T-UNM-010h: a card the SERVER already holds confirmed reports it, with no actions', () => {
    render(<ReviewPage review={reviewWithUnmatched('confirmed')} {...wired()} />);

    expect(screen.getByTestId('unmatched-outcome')).toHaveTextContent(UNMATCHED_KEPT);
    expect(screen.queryByTestId('unmatched-actions')).not.toBeInTheDocument();
  });

  it('T-UNM-010i: the actions are ABSENT when the page is only half-wired', () => {
    // ⚠ The mount gate. A "keep" button with no producer behind it is a
    // control that silently does nothing, which on this screen reads to the
    // owner as a decision they have already made.
    render(<ReviewPage review={reviewWithUnmatched()} onSearchTmdb={vi.fn()} />);

    expect(screen.getByTestId('review-unmatched')).toBeInTheDocument();
    expect(screen.queryByTestId('unmatched-actions')).not.toBeInTheDocument();
  });
});
