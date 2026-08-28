/**
 * TASK-086's deferred web half — the removal confirmation dialog
 * (`T-UI-008` component leg, `T-REV-007` component leg, `ux-states.md` §6.10
 * and §6.11).
 *
 * ⚠ **WHY THIS SUITE EXISTS AT ALL.** TASK-086's ledger row shipped the server
 * gate and said in as many words that `components/RemovalConfirmDialog.tsx`
 * "remains unbuilt web work". The gate refuses a close without
 * `confirmRemovals: true`, so with no dialog the owner had **no way to send
 * it** — a full-update close could only ever 409. `T-UI-008a`/`b` are
 * integration cases that pass regardless, because the API cannot see whether
 * anything on screen can produce the flag.
 *
 * ⚠ **THE DIALOG'S JOB IS THE NAMES, NOT THE COUNT.** It is the only
 * confirmation in the product (REQ-020, `T-UI-008c` — there is no per-row
 * remove affordance), so it carries the whole decision; a count alone is
 * unfalsifiable to the owner reading it, and the failure this screen exists to
 * catch is a title they meant to rescue that is still ticked.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  buildReviewResponse,
  type BuildReviewInput,
  type ReviewCandidate,
  type ReviewRemovalItem,
} from '@nextup/domain';

import { ReviewPage } from '../src/pages/ReviewPage';
import { RemovalConfirmDialog } from '../src/components/RemovalConfirmDialog';
import {
  REMOVAL_CANCEL_LABEL,
  REMOVAL_CONFIRM_LABEL,
  REMOVAL_CONFIRM_NONE,
  REMOVAL_CONFIRM_REASSURANCE,
  REVIEW_APPLY_LABEL,
} from '../src/copy';

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
    classification: 'new-for-this-service',
    ...overrides,
  };
}

function disappeared(id: string, name: string): Omit<ReviewRemovalItem, 'ticked'> {
  return {
    listingId: id,
    titleId: `title_${id}`,
    name,
    releaseYear: 2019,
    posterPath: null,
    service: 'netflix',
    dateAdded: '2026-01-04',
  };
}

const DISAPPEARED = [
  disappeared('lst_1', 'The Irishman'),
  disappeared('lst_2', 'Marriage Story'),
  disappeared('lst_3', 'Roma'),
];

/** ⚠ Always through the real builder — never a hand-written literal + cast. */
function review(overrides: Partial<BuildReviewInput> = {}) {
  return buildReviewResponse({
    batchId: '01J0000000000000000000BTCH',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [candidate()],
    disappearedListings: DISAPPEARED,
    imagesWithNoText: [],
    ...overrides,
  });
}

async function openDialog(onApply = vi.fn()) {
  render(<ReviewPage review={review()} onApply={onApply} />);
  await userEvent.click(screen.getByTestId('apply-changes-button'));
  return onApply;
}

describe('RemovalConfirmDialog — T-UI-008 (component leg)', () => {
  it('T-UI-008d: Apply opens the confirmation instead of closing the batch', async () => {
    const onApply = await openDialog();

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // ⚠ THE WHOLE POINT. If Apply both opened the dialog and closed the batch,
    // every assertion below would still pass while the confirmation was
    // decorative.
    expect(onApply).not.toHaveBeenCalled();
  });

  it('T-UI-008e: every ticked title is named, not merely counted', async () => {
    await openDialog();

    const list = screen.getByTestId('removal-confirm-list');
    for (const name of ['The Irishman', 'Marriage Story', 'Roma']) {
      expect(within(list).getByText(name)).toBeInTheDocument();
    }
    expect(within(screen.getByRole('dialog')).getByRole('heading')).toHaveTextContent(
      'Remove 3 titles from Netflix?',
    );
    expect(screen.getByText(REMOVAL_CONFIRM_REASSURANCE)).toBeInTheDocument();
  });

  it('T-UI-008f: a rescued title is neither named nor counted', async () => {
    // ⚠ REQ-021's rescue path. Naming it would tell the owner it is about to
    // go when the close will not touch it — which invites cancelling a correct
    // batch — and counting it would make the heading disagree with the list.
    render(
      <ReviewPage review={review({ untickedListingIds: new Set(['lst_2']) })} onApply={vi.fn()} />,
    );
    await userEvent.click(screen.getByTestId('apply-changes-button'));

    const list = screen.getByTestId('removal-confirm-list');
    expect(within(list).queryByText('Marriage Story')).toBeNull();
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(screen.getByRole('dialog')).getByRole('heading')).toHaveTextContent(
      'Remove 2 titles from Netflix?',
    );
  });

  it('T-UI-008g: Confirm closes the batch once, with confirmRemovals true', async () => {
    const onApply = await openDialog();

    await userEvent.click(screen.getByRole('button', { name: REMOVAL_CONFIRM_LABEL }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('T-UI-008h: Cancel closes nothing and leaves the review intact', async () => {
    const onApply = await openDialog();

    await userEvent.click(screen.getByRole('button', { name: REMOVAL_CANCEL_LABEL }));

    // ⚠ A cancelled confirmation that still closed the batch is the worst
    // outcome this screen has, and it is invisible without this case.
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('review-removals')).toBeInTheDocument();
  });

  it('T-UI-008i: with nothing proposed there is nothing to confirm, and the close goes straight through', async () => {
    const onApply = vi.fn();
    render(<ReviewPage review={review({ mode: 'append-only' })} onApply={onApply} />);

    await userEvent.click(screen.getByTestId('apply-changes-button'));

    expect(screen.queryByRole('dialog')).toBeNull();
    // ⚠ `false`, explicitly. A page that always sent `true` would make REQ-020
    // a formality on the one request that enforces it.
    expect(onApply).toHaveBeenCalledWith(false);
  });

  it('T-UI-008j: a WITHHELD removals section raises no confirmation', async () => {
    // The owner was shown nothing, so there is nothing to confirm; requiring
    // it would make a low-yield full update unclosable.
    const onApply = vi.fn();
    render(<ReviewPage review={review({ lowYield: true })} onApply={onApply} />);

    await userEvent.click(screen.getByTestId('apply-changes-button'));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onApply).toHaveBeenCalledWith(false);
  });

  it('T-UI-008k: it is a modal dialog named by its own question', async () => {
    await openDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Remove 3 titles from Netflix?');
  });

  it('T-UI-008l: the dialog offers no per-title control of its own', async () => {
    // ⚠ The same property `T-UI-008c` asserts for the review body. A checkbox
    // or link here would be a second, unconfirmed path to a destructive
    // outcome — inside the very screen that exists to prevent one.
    await openDialog();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('button')).toHaveLength(2);
    expect(within(dialog).queryAllByRole('checkbox')).toHaveLength(0);
    expect(within(dialog).queryAllByRole('link')).toHaveLength(0);
  });

  it('T-UI-008m: while the close is in flight both controls are disabled', () => {
    render(
      <RemovalConfirmDialog
        service="netflix"
        items={review().sections.removals.items}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
        submitting
      />,
    );

    expect(screen.getByRole('button', { name: REMOVAL_CONFIRM_LABEL })).toBeDisabled();
    expect(screen.getByRole('button', { name: REMOVAL_CANCEL_LABEL })).toBeDisabled();
  });

  it('T-UI-008n: one title reads as one title', async () => {
    render(
      <ReviewPage
        review={review({ untickedListingIds: new Set(['lst_2', 'lst_3']) })}
        onApply={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId('apply-changes-button'));

    expect(within(screen.getByRole('dialog')).getByRole('heading')).toHaveTextContent(
      'Remove 1 title from Netflix?',
    );
  });
});

describe('the zero-ticked confirmation — T-REV-007 (component leg), §6.11', () => {
  async function openWithNoneTicked(onApply = vi.fn()) {
    render(
      <ReviewPage
        review={review({ untickedListingIds: new Set(['lst_1', 'lst_2', 'lst_3']) })}
        onApply={onApply}
      />,
    );
    await userEvent.click(screen.getByTestId('apply-changes-button'));
    return onApply;
  }

  it('T-REV-007d: unticking everything still raises the confirmation, and it says nothing will be removed', async () => {
    await openWithNoneTicked();

    expect(screen.getByRole('dialog')).toHaveTextContent(REMOVAL_CONFIRM_NONE);
    // ⚠ Nothing is being kept anywhere, so the "kept in Removal history"
    // promise must not appear — it would describe an action that is not
    // happening.
    expect(screen.queryByText(REMOVAL_CONFIRM_REASSURANCE)).toBeNull();
    expect(screen.queryByTestId('removal-confirm-list')).toBeNull();
  });

  it('T-REV-007e: the close still proceeds — a fully rescued batch is not unclosable', async () => {
    // US-015 AC-5. Disabling Confirm here would force the owner to DISCARD a
    // batch they had just finished reviewing in order to escape it.
    const onApply = await openWithNoneTicked();

    const confirm = screen.getByRole('button', { name: REMOVAL_CONFIRM_LABEL });
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    expect(onApply).toHaveBeenCalledWith(true);
  });
});

describe('the Apply control still exists for every mode', () => {
  it('T-UI-008o: the confirmation never replaces the action bar', async () => {
    // ⚠ Contrast case. A dialog rendered INSTEAD of the review would pass most
    // of the assertions above while destroying the owner's ability to go back
    // and change a tick.
    await openDialog();

    expect(screen.getByTestId('review-action-bar')).toBeInTheDocument();
    expect(screen.getByText(REVIEW_APPLY_LABEL)).toBeInTheDocument();
  });
});
