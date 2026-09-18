/**
 * `T-UX-151` — a card the owner is asked to decide must SHOW what it is
 * asking about (`specs/ui.md` §5.3/§5.3a, REQ-122).
 *
 * Reported by the owner from a phone, of a row in "Couldn't identify these":
 * *"one with no title and no image — what am I confirming?"*. The screenshot
 * shows the contradiction exactly: the heading **"No title read from this
 * tile"** printed directly above `GOOD LUCK VRACH FRANKENSHTEYN`, the text the
 * reader had in fact read, beside an empty grey square.
 *
 * Two independent causes, both in `CandidateCard`:
 *
 * 1. The heading was chosen on `displayName === null`, where `displayName` is
 *    `match?.name ?? inferredTitle`. **An unmatched row has neither by
 *    definition** — that is what "unmatched" means — so the card claimed the
 *    reader had read nothing, in the very rows whose whole purpose is to show
 *    the owner what the reader read. "No title read from this tile" is a claim
 *    about the READER, and it is false whenever the tile produced text.
 *
 * 2. The thumbnail was rendered only for the two fabrication-adjacent verdicts
 *    (§5.3a). That is a FLOOR, not a ceiling: a card with no TMDB match has no
 *    poster either, so every other no-match row fell straight through to the
 *    grey placeholder while its screenshot sat one fetch away.
 *
 * ⚠ **THE UNREADABLE CASE IS THE LIMIT, AND IT IS WHY `c` EXISTS.** The fix
 * must not delete the "No title read from this tile" line — for a genuine
 * `unreadable-tile` (`rawText: ''`, `inferredTitle: null`) it is the truth, and
 * replacing it with an empty heading would be a worse version of the same
 * defect.
 *
 * ⚠ Fixtures go through `buildReviewResponse`, never a hand-written literal:
 * section routing is `sectionForCandidate`, server-side, so a hand-rolled
 * response could assert the page renders a section the server never sends.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildReviewResponse, type ReviewCandidate } from '@nextup/domain';

import { CANDIDATE_UNREADABLE_NO_TITLE } from '../src/copy';
import { ReviewPage } from '../src/pages/ReviewPage';

/** The owner's actual row, minus the conflation that produced its text. */
function unmatchedCandidate(overrides: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    candidateId: 'cnd_u',
    rawText: 'GOOD LUCK VRACH FRANKENSHTEYN',
    inferredTitle: null,
    basis: 'text',
    ocrSupport: 'corroborated',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 0.7,
    resolvedWorkIdentity: 'unmatched:0123456789abcdef',
    match: null,
    alternatives: [],
    sourceImageIds: ['img_1'],
    tileCrop: null,
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    classification: null,
    ...overrides,
  };
}

function review(candidates: readonly ReviewCandidate[]) {
  return buildReviewResponse({
    batchId: '01J0000000000000000000BTCH',
    service: 'disney-plus',
    mode: 'append-only',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [...candidates],
    disappearedListings: [],
    imagesWithNoText: [],
  });
}

describe('T-UX-151 · a decidable card shows what it is asking about', () => {
  it('T-UX-151a: an unmatched row is headed by the text that was read, not by "No title read from this tile"', () => {
    render(<ReviewPage review={review([unmatchedCandidate()])} />);

    const section = within(screen.getByTestId('review-unmatched'));

    expect(section.queryByTestId('candidate-no-title')).not.toBeInTheDocument();
    expect(section.queryByText(CANDIDATE_UNREADABLE_NO_TITLE)).not.toBeInTheDocument();
    expect(section.getByTestId('candidate-name')).toHaveTextContent(
      'GOOD LUCK VRACH FRANKENSHTEYN',
    );
    // ...and exactly ONCE. Before the fix the text appeared only as the
    // evidence line; promoting it to the heading without suppressing that line
    // would read as two separate findings about the same tile.
    expect(section.getAllByText('GOOD LUCK VRACH FRANKENSHTEYN')).toHaveLength(1);
  });

  it('T-UX-151b: and it renders the source tile rather than an empty placeholder', () => {
    render(<ReviewPage review={review([unmatchedCandidate()])} />);

    const section = within(screen.getByTestId('review-unmatched'));

    expect(section.queryByTestId('candidate-poster-placeholder')).not.toBeInTheDocument();
    expect(section.getByTestId('candidate-thumb')).toHaveAttribute('src', '/api/images/img_1');
  });

  it('T-UX-151c: a genuinely unreadable tile still says so — the fix does not delete the line', () => {
    render(
      <ReviewPage
        review={review([
          unmatchedCandidate({
            candidateId: 'cnd_blank',
            rawText: '',
            inferredTitle: null,
            basis: 'unknown',
            ocrSupport: 'none',
            verdict: 'unreadable-tile',
            resolvedWorkIdentity: null,
          }),
        ])}
      />,
    );

    const card = within(screen.getByTestId('candidate-cnd_blank'));

    expect(card.getByTestId('candidate-no-title')).toHaveTextContent(CANDIDATE_UNREADABLE_NO_TITLE);
    // The tile is the ONLY evidence it carries and is never dropped (§5.3a).
    expect(card.getByTestId('candidate-thumb')).toBeInTheDocument();
  });
});
