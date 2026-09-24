/**
 * `T-REV-016` — known titles are not actionable as additions (TASK-082,
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
 * Known matches can be acknowledged or corrected, never added or discarded.
 * Acknowledgements are optional and persist without changing list membership.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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

describe('T-REV-016 · US-013 AC-2 · known titles are not additions', () => {
  it('T-REV-016a: it offers match confirmation and correction, never addition/discard controls', () => {
    const mutation = vi.fn(async () => undefined);
    render(
      <ReviewPage
        review={review()}
        onKeepUnmatched={mutation}
        onDiscardUnmatched={mutation}
        onMatchUnmatched={mutation}
        onSearchTmdb={async () => []}
      />,
    );
    const section = knownSection();
    expect(within(section).getAllByRole('button', { name: 'Change match' })).toHaveLength(2);
    expect(within(section).getAllByRole('button', { name: 'Confirm match' })).toHaveLength(2);
    expect(
      within(section).queryByRole('button', { name: /^Confirm$|Discard|Keep/i }),
    ).not.toBeInTheDocument();
    expect(within(section).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(section).getAllByRole('link', { name: 'Open source screenshot' })).toHaveLength(
      2,
    );
    expect(mutation).not.toHaveBeenCalled();
  });

  it('T-REV-016b: without correction handlers, known cards remain inert', () => {
    // A control removed from the accessibility tree but left in the tab order
    // still fires on Enter. The `<summary>` is the one legitimate stop —
    // collapsing the section is not an action on its contents.
    render(<ReviewPage review={review()} />);

    const focusable = knownSection().querySelectorAll(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
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

  it('T-REV-016d: it is expanded by default so recognised known titles are obvious', () => {
    render(<ReviewPage review={review()} />);

    const details = knownSection().querySelector('details');
    expect(details).not.toBeNull();
    expect(details).toHaveAttribute('open');
  });

  it('T-REV-016e: the count stays visible while it is collapsed', () => {
    // ⚠ A COLLAPSED SECTION WITH NO VISIBLE COUNT IS INVARIANT 2 DEFEATED BY
    // PRESENTATION. The count is the owner's only check that the batch was
    // read fully, and it is useless in the state the section is normally in
    // unless it lives in the <summary>.
    render(<ReviewPage review={review()} />);

    const summary = within(knownSection()).getByText('Already in your library (2)');
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
    expect(details).toHaveAttribute('open');
    details?.removeAttribute('open');
    expect(within(knownSection()).getAllByTestId('candidate-name').length).toBeGreaterThan(0);
  });

  it('T-REV-016h: a refused match confirmation stays retryable and never claims it was saved', async () => {
    const keep = vi.fn(async () => {
      throw new Error('Request refused');
    });
    render(
      <ReviewPage
        controlled
        review={review()}
        onKeepUnmatched={keep}
        onDiscardUnmatched={async () => undefined}
        onMatchUnmatched={async () => undefined}
        onSearchTmdb={async () => []}
      />,
    );
    const card = within(screen.getByTestId('candidate-cand_1'));
    await userEvent.click(card.getByRole('button', { name: 'Confirm match' }));
    expect(keep).toHaveBeenCalledExactlyOnceWith('cand_1');
    expect(card.getByRole('alert')).toBeVisible();
    expect(card.getByRole('button', { name: 'Confirm match' })).toBeEnabled();
    expect(card.queryByTestId('known-outcome')).not.toBeInTheDocument();
  });

  it.each(['append-only', 'full-update'] as const)(
    'T-REV-016i: optional acknowledgements never block the %s summary or imply additions',
    async (mode) => {
      render(
        <ReviewPage
          controlled
          review={review({ mode })}
          onKeepUnmatched={async () => undefined}
          onDiscardUnmatched={async () => undefined}
          onMatchUnmatched={async () => undefined}
          onSearchTmdb={async () => []}
        />,
      );
      await userEvent.click(screen.getByTestId('apply-changes-button'));
      const dialog = await screen.findByRole('dialog');
      expect(dialog).not.toHaveTextContent('The Matrix');
      expect(dialog).not.toHaveTextContent('Severance');
      expect(screen.queryByTestId('review-pending-error')).not.toBeInTheDocument();
    },
  );
});
