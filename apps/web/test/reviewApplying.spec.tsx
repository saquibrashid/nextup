/**
 * `T-UX-064` — `specs/ux-states.md` §6.12: *"Sticky bar shows 'Applying…'; all
 * controls disabled"* while the batch close is in flight.
 *
 * ⚠ **THE STATE DID NOT EXIST AND ITS COMPONENT HALF DID.**
 * `RemovalConfirmDialog` has carried a `submitting` prop — disabling both of
 * its buttons — since it was written, and nothing ever passed it;
 * `ReviewPage`'s **Apply changes** had no in-flight guard at all. So a
 * double-tap on the one irreversible transition this product has issued two
 * closes: the first applied the batch, the second landed on a batch no longer
 * `in-review` and came back 409 `BATCH_NOT_IN_REVIEW`. The owner saw their
 * changes applied and then an error, with no way to tell which had won.
 *
 * ⚠ **THESE CASES DRIVE `ReviewRoute`, NEVER `ReviewPage` DIRECTLY.** Handing
 * `<ReviewPage applying />` a flag would assert only that a component renders a
 * prop it is given — precisely the assertion that was already passing for
 * `RemovalConfirmDialog.submitting` for as long as the feature did not exist.
 * The in-flight window is produced here by a `closeBatch` that never settles.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { buildReviewResponse } from '@nextup/domain';

import { ReviewRoute } from '../src/containers/ReviewRoute';
import {
  REMOVAL_CONFIRM_LABEL,
  REVIEW_APPLYING,
  REVIEW_APPLY_LABEL,
  REVIEW_APPLY_FAILED,
  REVIEW_DISCARD_LABEL,
} from '../src/copy';
import { ApiError, type ApiClient, type CloseBatchResult } from '../src/lib/apiClient';

function candidate() {
  return {
    candidateId: 'cnd_1',
    rawExtractedText: 'Dune',
    normalisedText: 'dune',
    verdict: 'title' as const,
    confidence: 0.99,
    ocrSupport: 'corroborated' as const,
    cleanupVerdict: null,
    resolvedWorkIdentity: 'tmdb:movie:438631',
    match: {
      workIdentity: 'tmdb:movie:438631',
      mediaType: 'movie' as const,
      name: 'Dune',
      releaseYear: 2021,
      posterPath: null,
      score: 0.99,
      uncertain: false,
      ambiguous: false,
    },
    alternatives: [],
    sourceImageIds: ['img_1'],
    disposition: 'confirmed' as const,
    collapsedIntoCandidateId: null,
    classification: 'new' as const,
  };
}

/** No removals, so **Apply changes** issues the close with no dialog between
 *  the press and the request — which keeps a–c about the in-flight state. */
function reviewNoRemovals() {
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [candidate()],
    disappearedListings: [],
    imagesWithNoText: [],
  });
}

/** One removal, so §6.10's dialog stands between the press and the close and
 *  the dialog's own controls are part of "all controls disabled". */
function reviewWithRemoval() {
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [candidate()],
    disappearedListings: [
      {
        listingId: 'lst_1',
        titleId: 'ttl_1',
        name: 'Arrival',
        releaseYear: 2016,
        posterPath: null,
        service: 'netflix',
        dateAdded: '2024-01-02',
      },
    ],
    imagesWithNoText: [],
  });
}

function closeResult(): CloseBatchResult {
  return {
    batchId: 'bat_1',
    status: 'applied',
    summary: { listingsCreated: 1, listingsRemoved: 0, removalGroupId: null },
    serviceState: { service: 'netflix' },
    undoable: true,
  };
}

function stubClient(
  review: ReturnType<typeof reviewNoRemovals>,
  overrides: Record<string, (...args: unknown[]) => unknown> = {},
) {
  const calls: string[] = [];
  const record =
    <T,>(name: string, value: T) =>
    async () => {
      calls.push(name);
      return value;
    };
  const wrapped: Record<string, unknown> = {};
  for (const [name, impl] of Object.entries(overrides)) {
    wrapped[name] = (...args: unknown[]) => {
      calls.push(name);
      return impl(...args);
    };
  }

  const client = {
    getReview: record('getReview', review),
    closeBatch: record('closeBatch', closeResult()),
    discardBatch: record('discardBatch', {}),
    confirmAllCandidates: record('confirmAllCandidates', { section: 'additions', confirmed: 0 }),
    searchTmdb: record('searchTmdb', { items: [] }),
    addManualEntry: record('addManualEntry', {}),
    patchCandidate: record('patchCandidate', {}),
    ...wrapped,
  } as unknown as ApiClient;

  return { client, calls };
}

function renderReview(client: ApiClient): void {
  render(
    <MemoryRouter initialEntries={['/batches/bat_1/review']}>
      <Routes>
        <Route path="/batches/:batchId/review" element={<ReviewRoute client={client} />} />
        <Route path="/" element={<p data-testid="list-screen">list screen</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** A close that never settles, so the in-flight window stays open for the
 *  length of the assertion instead of racing it. */
const never = (): Promise<never> => new Promise<never>(() => {});

const applyButton = (): HTMLElement =>
  screen.getByTestId('apply-changes-button') as unknown as HTMLElement;

describe('T-UX-064 — §6.12 the close is in flight', () => {
  it('T-UX-064a: the apply control states it is applying', async () => {
    const { client } = stubClient(reviewNoRemovals(), { closeBatch: never });
    renderReview(client);

    const apply = await screen.findByTestId('apply-changes-button');
    expect(apply).toHaveTextContent(REVIEW_APPLY_LABEL);

    fireEvent.click(apply);

    // ⚠ The label REPLACES "Apply changes". A disabled button still offering
    // to apply is indistinguishable from one that has stopped working.
    await waitFor(() => {
      expect(applyButton()).toHaveTextContent(REVIEW_APPLYING);
    });
    expect(applyButton()).toBeDisabled();
  });

  it('T-UX-064b: discard is disabled too, not just apply', async () => {
    const { client } = stubClient(reviewNoRemovals(), { closeBatch: never });
    renderReview(client);

    fireEvent.click(await screen.findByTestId('apply-changes-button'));

    // Not tidiness: a discard racing an in-flight close is a genuine contest
    // over which terminal state the batch ends in.
    await waitFor(() => {
      expect(screen.getByTestId('discard-batch-button')).toBeDisabled();
    });
    expect(screen.getByTestId('discard-batch-button')).toHaveTextContent(REVIEW_DISCARD_LABEL);
  });

  it('T-UX-064c: a second press issues no second close', async () => {
    const { client, calls } = stubClient(reviewNoRemovals(), { closeBatch: never });
    renderReview(client);

    const apply = await screen.findByTestId('apply-changes-button');
    fireEvent.click(apply);
    await waitFor(() => {
      expect(applyButton()).toBeDisabled();
    });

    fireEvent.click(applyButton());
    fireEvent.click(applyButton());

    // THE POINT OF THE WHOLE STATE. Two closes = one applied batch plus one
    // spurious 409 the owner cannot interpret.
    expect(calls.filter((name) => name === 'closeBatch')).toHaveLength(1);
  });

  it('T-UX-064d: a failed close re-enables the retry', async () => {
    // ⚠ THE INVERSE FAILURE, AND THE MORE DANGEROUS ONE. §6.16 makes **Apply
    // changes** itself the "Try again"; a guard that latched on would leave
    // the owner with a permanently dead button on the irreversible path.
    const { client } = stubClient(reviewNoRemovals(), {
      closeBatch: () => Promise.reject(new ApiError('INTERNAL', 500, 'boom', {})),
    });
    renderReview(client);

    fireEvent.click(await screen.findByTestId('apply-changes-button'));

    expect(await screen.findByTestId('review-apply-error')).toHaveTextContent(REVIEW_APPLY_FAILED);
    expect(applyButton()).toBeEnabled();
    expect(applyButton()).toHaveTextContent(REVIEW_APPLY_LABEL);
    expect(screen.getByTestId('discard-batch-button')).toBeEnabled();
  });

  it('T-UX-064e: the removal dialog survives its own confirm, with controls disabled', async () => {
    /*
     * ⚠ THE DIALOG USED TO UNMOUNT UNDER THE OWNER'S FINGER. `onConfirm` set
     * `confirming` false and called `onApply` in the same breath, so
     * `submitting` could never be observed and the screen went straight back
     * to an undisabled review while a close was in flight against it.
     */
    const { client } = stubClient(reviewWithRemoval(), { closeBatch: never });
    renderReview(client);

    fireEvent.click(await screen.findByTestId('apply-changes-button'));
    const dialog = await screen.findByTestId('removal-confirm');
    const buttons = dialog.querySelectorAll('button');
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: REMOVAL_CONFIRM_LABEL }));

    await waitFor(() => {
      expect(screen.getByTestId('removal-confirm')).toBeInTheDocument();
    });
    for (const button of screen.getByTestId('removal-confirm').querySelectorAll('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('T-UX-064f: a 409 REMOVALS_NOT_CONFIRMED re-opens the dialog ENABLED', async () => {
    /*
     * ⚠ THE EFFECT-ORDERING TRAP. §6.15 clears the in-flight flag and bumps
     * the re-open nonce in the SAME render. Closing the dialog from an effect
     * on `applying` would run after the §6.15 effect and shut the very dialog
     * the refusal exists to re-open — leaving the owner with no way to confirm
     * and therefore no way to close the batch at all.
     */
    const { client } = stubClient(reviewNoRemovals(), {
      closeBatch: () =>
        Promise.reject(new ApiError('REMOVALS_NOT_CONFIRMED', 409, 'confirm first', {})),
    });
    renderReview(client);

    fireEvent.click(await screen.findByTestId('apply-changes-button'));

    const dialog = await screen.findByTestId('removal-confirm');
    for (const button of dialog.querySelectorAll('button')) expect(button).toBeEnabled();
    expect(applyButton()).toBeEnabled();
  });
});
