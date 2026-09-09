/**
 * TASK-200 — the §5.3 per-card controls on the ADDITIONS section.
 *
 * `T-UNM-013`. `specs/ui.md` §5.3 requires every review card to carry three
 * controls — Confirm, Change match, Discard — and PRD §158 describes the owner
 * "confirming, correcting mismatches, discarding junk". The additions section
 * shipped with none of them: its only control was the bulk "Confirm all {n}".
 *
 * ⚠ **THIS WAS FOUND IN USE, NOT IN REVIEW.** The owner uploaded a real
 * Netflix list, and the two-line title treatment on `SOL LEVANTE` was read as
 * both `SOL LEVANTE` and a separate `LEVANTE`. Nine rows were right, one was a
 * fragment, and there was no way to reject the fragment without abandoning the
 * batch — the fragment's only alternative was to accept it into the list.
 * Extraction accuracy work (TASK-199) reduces how often that happens; it can
 * never make it never happen, which is exactly why the per-card escape hatch
 * is a `must` and not a refinement.
 *
 * ⚠ **ASSERTED AGAINST THE MOUNTED PAGE.** The component was already capable
 * of this — `CandidateCard` has accepted an `actions` node all along, and the
 * defect was purely that `ReviewPage` passed `renderCard` for `unmatched` and
 * not for `additions`. A test that rendered `UnmatchedActions` directly would
 * have passed throughout the entire period the control did not exist.
 *
 * ⚠ **THE WORDS ARE PART OF THE ASSERTION.** An addition already carries a
 * resolved TMDB match, so reusing the unmatched section's "Keep as
 * unidentified" would tell the owner a correctly identified title was
 * unidentified. `T-UNM-013c` fails if the copy is shared.
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildReviewResponse, type ReviewDisposition } from '@nextup/domain';

import {
  ADDITION_CHANGE_MATCH_LABEL,
  ADDITION_CONFIRM_LABEL,
  ADDITION_CONFIRMED,
  ADDITION_DISCARD_LABEL,
  ADDITION_DISCARDED,
  UNMATCHED_ACTION_FAILED,
  UNMATCHED_KEEP_LABEL,
} from '../src/copy';
import { ReviewPage } from '../src/pages/ReviewPage';

/**
 * ⚠ Built by the DOMAIN's own projection, like the unmatched fixtures: the
 * section a candidate lands in is `sectionForCandidate`, server-side. A
 * hand-rolled response would let this file assert the page renders a section
 * the server never sends.
 *
 * The shape mirrors the live defect — a good row and a fragment of it.
 */
function reviewWithAdditions(disposition: ReviewDisposition = 'pending') {
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'append-only',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [
      {
        candidateId: 'cnd_sol',
        rawText: 'SOL LEVANTE',
        inferredTitle: null,
        basis: 'text',
        ocrSupport: 'corroborated',
        provider: 'llm',
        verdict: 'title-candidate',
        ocrConfidence: 0.94,
        resolvedWorkIdentity: 'tmdb:movie:704264',
        match: {
          workIdentity: 'tmdb:movie:704264',
          mediaType: 'movie',
          name: 'Sol Levante',
          releaseYear: 2020,
          posterPath: null,
          score: 0.99,
          uncertain: false,
          ambiguous: false,
        },
        alternatives: [],
        sourceImageIds: ['img_1'],
        disposition,
        collapsedIntoCandidateId: null,
        classification: null,
      },
      {
        candidateId: 'cnd_lev',
        rawText: 'LEVANTE',
        inferredTitle: null,
        basis: 'text',
        ocrSupport: 'corroborated',
        provider: 'llm',
        verdict: 'title-candidate',
        ocrConfidence: 0.88,
        resolvedWorkIdentity: 'tmdb:movie:704264',
        match: {
          workIdentity: 'tmdb:movie:704264',
          mediaType: 'movie',
          name: 'Sol Levante',
          releaseYear: 2020,
          posterPath: null,
          score: 0.81,
          uncertain: false,
          ambiguous: false,
        },
        alternatives: [],
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
    onSearchTmdb: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function additionsSection() {
  return within(screen.getByTestId('review-additions'));
}

function cardFor(candidateId: string) {
  return within(additionsSection().getByTestId(`candidate-${candidateId}`));
}

describe('T-UNM-013 · the §5.3 controls exist on every addition card', () => {
  it('T-UNM-013a: confirm, change-match and discard are rendered on EACH addition', () => {
    render(<ReviewPage review={reviewWithAdditions()} {...wired()} />);

    // ⚠ Per card, not per section. The bulk "Confirm all" already existed; the
    // defect was that a single row could not be treated differently from the
    // rest, so asserting one control somewhere in the section would pass over
    // the exact shape that was broken.
    for (const id of ['cnd_sol', 'cnd_lev']) {
      const card = cardFor(id);
      expect(card.getByTestId('addition-keep')).toBeInTheDocument();
      expect(card.getByTestId('addition-find')).toBeInTheDocument();
      expect(card.getByTestId('addition-discard')).toBeInTheDocument();
    }
  });

  it('T-UNM-013b: discarding one addition patches ONLY that candidate', async () => {
    const props = wired();
    render(<ReviewPage review={reviewWithAdditions()} {...props} />);

    await userEvent.click(cardFor('cnd_lev').getByTestId('addition-discard'));

    expect(props.onDiscardUnmatched).toHaveBeenCalledWith('cnd_lev');
    expect(props.onDiscardUnmatched).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(cardFor('cnd_lev').getByTestId('addition-outcome')).toHaveTextContent(
        ADDITION_DISCARDED,
      );
    });
    // ⚠ The good row is UNTOUCHED and still decidable. Rejecting the fragment
    // must not cost the owner the title it was a fragment of.
    expect(cardFor('cnd_sol').getByTestId('addition-keep')).toBeInTheDocument();
  });

  it('T-UNM-013c: the labels are the §5.3 addition words, not the unmatched ones', () => {
    render(<ReviewPage review={reviewWithAdditions()} {...wired()} />);

    const card = cardFor('cnd_sol');
    expect(card.getByTestId('addition-keep')).toHaveTextContent(ADDITION_CONFIRM_LABEL);
    expect(card.getByTestId('addition-find')).toHaveTextContent(ADDITION_CHANGE_MATCH_LABEL);
    expect(card.getByTestId('addition-discard')).toHaveTextContent(ADDITION_DISCARD_LABEL);
    // An addition is matched, so it must never be described as unidentified.
    expect(additionsSection().queryByText(UNMATCHED_KEEP_LABEL)).not.toBeInTheDocument();
  });

  it('T-UNM-013d: confirming one addition sends the §6.18 confirm and says so', async () => {
    const props = wired();
    render(<ReviewPage review={reviewWithAdditions()} {...props} />);

    await userEvent.click(cardFor('cnd_sol').getByTestId('addition-keep'));

    expect(props.onKeepUnmatched).toHaveBeenCalledWith('cnd_sol');
    await waitFor(() => {
      expect(cardFor('cnd_sol').getByTestId('addition-outcome')).toHaveTextContent(
        ADDITION_CONFIRMED,
      );
    });
  });

  it('T-UNM-013e: a REFUSED discard leaves the card pending and says nothing changed', async () => {
    // ⚠ The negative case is the point. A card that claimed "discarded" over a
    // row the server still holds `pending` would send the owner into a close
    // that 409s on `PENDING_ADDITIONS`, naming a candidate they believe they
    // already dealt with.
    const props = wired({ onDiscardUnmatched: vi.fn().mockRejectedValue(new Error('nope')) });
    render(<ReviewPage review={reviewWithAdditions()} {...props} />);

    await userEvent.click(cardFor('cnd_lev').getByTestId('addition-discard'));

    await waitFor(() => {
      expect(cardFor('cnd_lev').getByTestId('addition-failure')).toHaveTextContent(
        UNMATCHED_ACTION_FAILED,
      );
    });
    expect(cardFor('cnd_lev').queryByTestId('addition-outcome')).not.toBeInTheDocument();
    expect(cardFor('cnd_lev').getByTestId('addition-discard')).toBeInTheDocument();
  });

  it('T-UNM-013f: an already-decided addition reports the decision instead of offering it again', () => {
    render(<ReviewPage review={reviewWithAdditions('discarded')} {...wired()} />);

    const card = cardFor('cnd_lev');
    expect(card.getByTestId('addition-outcome')).toHaveTextContent(ADDITION_DISCARDED);
    expect(card.queryByTestId('addition-discard')).not.toBeInTheDocument();
  });
});
