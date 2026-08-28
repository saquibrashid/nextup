/**
 * `T-REV-016` — "Already on your list" is a READ-ONLY section (TASK-082,
 * US-013 AC-2, `specs/ui.md` §5.2).
 *
 * ⚠ **THE BACKLOG CITED `T-UI-014` FOR THIS TASK AND THAT ID BELONGS TO
 * SOMETHING ELSE.** `T-UI-014` is *"all three ingest affordances present,
 * labelled and keyboard-reachable"* — TASK-162, `pasteCapture.spec.tsx`,
 * suffixes `a`–`e`, all shipped. Building this task under that id would have
 * "satisfied" it with tests that were already green, leaving US-013 AC-2 with
 * no coverage at all while the ledger showed two tasks passing. The id that
 * actually names this AC is `T-REV-016`, and it had no implementation.
 * Reported as a finding; the epic row is corrected in place.
 *
 * ⚠ **READ-ONLY IS A SAFETY PROPERTY, NOT A STYLING CHOICE.** These titles are
 * already on the owner's list. Every control this section could offer is
 * either a no-op (confirm what is already confirmed) or destructive (discard a
 * title the owner never asked to lose) — and an addition affordance here would
 * let one tap re-add a work that is already present, which is the
 * duplicate-identity path `T-REV-014` exists to refuse server-side. The
 * section's entire job is to be **seen**: it is the visible proof that a
 * failed extraction of a known title is not a removal (product invariant 2).
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildReviewResponse, type BuildReviewInput, type ReviewCandidate } from '@nextup/domain';

import { ReviewPage } from '../src/pages/ReviewPage';

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
    match: {
      tmdbId: 603,
      mediaType: 'movie',
      name: 'The Matrix',
      releaseYear: 1999,
      posterPath: '/matrix.jpg',
      score: 0.98,
      uncertain: false,
      ambiguous: false,
    },
    alternatives: [],
    sourceImageIds: ['img_1'],
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    classification: 'already-present-for-this-service',
    ...overrides,
  };
}

function review(overrides: Partial<BuildReviewInput> = {}) {
  return buildReviewResponse({
    batchId: '01J0000000000000000000BTCH',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [
      candidate(),
      candidate({
        candidateId: 'cand_2',
        rawText: 'SEVERANCE',
        inferredTitle: 'Severance',
        resolvedWorkIdentity: 'tmdb:tv:95396',
        match: {
          tmdbId: 95396,
          mediaType: 'tv',
          name: 'Severance',
          releaseYear: 2022,
          posterPath: null,
          score: 0.97,
          uncertain: false,
          ambiguous: false,
        },
      }),
    ],
    disappearedListings: [],
    imagesWithNoText: [],
    ...overrides,
  });
}

const knownSection = () => screen.getByTestId('review-already-on-list');

/* -------------------------------------------------------------------------- */

describe('T-REV-016 · US-013 AC-2 · the known-titles section is read-only', () => {
  it('T-REV-016a: it offers no control of any kind', () => {
    // ⚠ EVERY CONTROL HERE IS EITHER A NO-OP OR DESTRUCTIVE. Asserted across
    // all three interactive roles rather than "no buttons", because the
    // cheapest way to reintroduce an action is a link or a checkbox, and a
    // button-only check would pass on both.
    render(<ReviewPage review={review()} />);

    const section = knownSection();
    expect(within(section).queryAllByRole('button')).toHaveLength(0);
    expect(within(section).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(section).queryAllByRole('link')).toHaveLength(0);
  });

  it('T-REV-016b: nothing in it is focusable, so it cannot be actioned by keyboard either', () => {
    // A control removed from the accessibility tree but left in the tab order
    // still fires on Enter. The `<summary>` is the one legitimate stop —
    // collapsing the section is not an action on its contents.
    render(<ReviewPage review={review()} />);

    const focusable = knownSection().querySelectorAll(
      'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])',
    );
    expect(focusable).toHaveLength(0);
  });

  it('T-REV-016c: the additions section, by contrast, is where actions will live', () => {
    // ⚠ THE CONTRAST IS THE POINT. Without it, a page that rendered no
    // controls anywhere — including the ones TASK-091 must add — would pass
    // every assertion above and look correct until the review became
    // unusable.
    render(<ReviewPage review={review({ candidates: [candidate({ classification: 'new' })] })} />);

    expect(
      within(screen.getByTestId('review-additions')).getAllByTestId('candidate-name'),
    ).toHaveLength(1);
    expect(screen.getByTestId('review-action-bar')).toBeInTheDocument();
  });

  it('T-REV-016d: it is collapsed by default', () => {
    // SD-11b. The owner is reviewing what is NEW; the known titles are proof
    // that nothing was silently dropped, and proof does not need to be
    // scrolled past.
    render(<ReviewPage review={review()} />);

    const details = knownSection().querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
  });

  it('T-REV-016e: the count stays visible while it is collapsed', () => {
    // ⚠ A COLLAPSED SECTION WITH NO VISIBLE COUNT IS INVARIANT 2 DEFEATED BY
    // PRESENTATION. The count is the owner's only check that the batch was
    // read fully, and it is useless in the state the section is normally in
    // unless it lives in the <summary>.
    render(<ReviewPage review={review()} />);

    const summary = within(knownSection()).getByText('Already on your list (2)');
    expect(summary.tagName).toBe('SUMMARY');
  });

  it('T-REV-016f: every known title is listed by name, not merely counted', () => {
    // A count alone cannot be checked against anything. The section exists so
    // the owner can see that a title they know is on their list was read from
    // the screenshot - which requires the title.
    render(<ReviewPage review={review()} />);

    const section = knownSection();
    expect(within(section).getAllByTestId('candidate-name')).toHaveLength(2);
    expect(section).toHaveTextContent('The Matrix');
    expect(section).toHaveTextContent('Severance');
  });

  it('T-REV-016g: the items are in the DOM while collapsed, not fetched on expand', () => {
    // ⚠ `<details>` KEEPS ITS CHILDREN IN THE DOM. That is deliberate: a
    // section that rendered its contents only on expand would make invariant
    // 2 depend on the owner opening it, and an expand that failed would be
    // indistinguishable from a batch that read nothing.
    render(<ReviewPage review={review()} />);

    const details = knownSection().querySelector('details');
    expect(details).not.toHaveAttribute('open');
    expect(within(knownSection()).getAllByTestId('candidate-name').length).toBeGreaterThan(0);
  });
});
