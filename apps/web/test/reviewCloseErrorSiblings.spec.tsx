/**
 * The two 409 close-error states that sit beside §6.16 (`T-UX-067`):
 *
 *   - `T-UX-066` — `specs/ux-states.md` §6.14, 409 `PENDING_ADDITIONS`.
 *   - `T-REV-005` (client half) — `specs/ux-states.md` §6.15, 409
 *     `REMOVALS_NOT_CONFIRMED`. The server half is `apps/api/test/integration/
 *     batchCloseRemovals.spec.ts` (`T-REV-005a`–`f`); this file owns the piece
 *     the finding on PR #127 flagged as unwired: what the browser does when the
 *     server sends that 409.
 *
 * ⚠ BOTH STATES WERE UNHANDLED. `ReviewRoute`'s rejection handler returned
 * early on every 4xx, so a 409 produced NO feedback at all — the same dead-
 * button defect §6.16 was built to remove, one state over. `T-UX-066` lived
 * only in `ux-states.md`, seen by neither `check-test-ids` nor
 * `check-orphan-tests`; `T-REV-005` was asserted only on the server.
 *
 * ⚠ THE FOUR CLOSE-ERROR STATES ARE DISTINCT AND MUST NOT COLLAPSE. §6.14 names
 * the pending cards; §6.15 re-opens the removal dialog; §6.16 says "nothing was
 * changed, try again"; §6.18 (401) redirects. Routing a 409 to §6.16's wording
 * is a defect, not a simplification — `d` and the §6.16 file's `T-UX-067f` pin
 * the scoping from both sides.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildReviewResponse } from '@nextup/domain';

import { ReviewRoute } from '../src/containers/ReviewRoute';
import { REVIEW_APPLY_LABEL, REMOVAL_CONFIRM_LABEL, reviewPendingAdditions } from '../src/copy';
import { reviewCandidateDomId } from '../src/components/CandidateCard';
import { ApiError, type ApiClient, type CloseBatchResult } from '../src/lib/apiClient';

/** A candidate, in the shape `buildReviewResponse` consumes. */
function candidate(id: string, name: string, disposition: 'pending' | 'confirmed') {
  return {
    candidateId: id,
    rawExtractedText: name,
    normalisedText: name.toLowerCase(),
    verdict: 'title' as const,
    confidence: 0.99,
    ocrSupport: 'corroborated' as const,
    cleanupVerdict: null,
    resolvedWorkIdentity: `tmdb:movie:${id}`,
    match: {
      workIdentity: `tmdb:movie:${id}`,
      mediaType: 'movie' as const,
      name,
      releaseYear: 2021,
      posterPath: null,
      score: 0.99,
      uncertain: false,
      ambiguous: false,
    },
    alternatives: [],
    sourceImageIds: ['img_1'],
    disposition,
    collapsedIntoCandidateId: null,
    classification: 'new' as const,
  };
}

/** A full-update review with TWO pending additions and NO removals, so a close
 *  goes straight through (`confirmRemovals: false`, no §6.10 dialog) and the
 *  only thing that can open the removal dialog is the §6.15 reconfirm path. */
function reviewWithTwoPending() {
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [candidate('cnd_1', 'Dune', 'pending'), candidate('cnd_2', 'Arrival', 'pending')],
    disappearedListings: [],
    imagesWithNoText: [],
  });
}

/** A full-update review whose only addition is already CONFIRMED and with NO
 *  removals — so `needsConfirmation` is false and `Apply` sends `false` with no
 *  dialog. Used for §6.15: nothing but the reconfirm signal can open it. */
function reviewReadyToClose() {
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [candidate('cnd_1', 'Dune', 'confirmed')],
    disappearedListings: [],
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

/** A recording client whose every call captures its name AND its args. */
function stubClient(
  review: unknown,
  overrides: Record<string, (...args: unknown[]) => unknown> = {},
) {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    <T,>(name: string, value: T) =>
    async (...args: unknown[]) => {
      calls.push({ name, args });
      return value;
    };
  const wrap = (name: string, impl: (...a: unknown[]) => unknown) => {
    return (...args: unknown[]) => {
      calls.push({ name, args });
      return impl(...args);
    };
  };

  const wrapped: Record<string, unknown> = {};
  for (const [name, impl] of Object.entries(overrides)) wrapped[name] = wrap(name, impl);

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

function LocationProbe(): JSX.Element {
  const location = useLocation();
  const applied = (location.state as { applied?: { batchId?: string } } | null)?.applied;
  return <p data-testid="list-screen">list screen: {applied?.batchId ?? 'no-state'}</p>;
}

function renderReview(client: ApiClient) {
  return render(
    <MemoryRouter initialEntries={['/batches/bat_1/review']}>
      <Routes>
        <Route path="/batches/:batchId/review" element={<ReviewRoute client={client} />} />
        <Route path="/" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

const pendingAdditions = (ids: string[]) =>
  Promise.reject(
    new ApiError('PENDING_ADDITIONS', 409, 'decide first', { pendingCandidateIds: ids }),
  );

const removalsNotConfirmed = () =>
  Promise.reject(new ApiError('REMOVALS_NOT_CONFIRMED', 409, 'confirm first', {}));

// jsdom implements no `scrollIntoView`; install a spy so §6.14 can both call it
// and assert it, and restore it so no other suite inherits a stray global.
beforeEach(() => {
  (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = vi.fn();
});
afterEach(() => {
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe('T-UX-066 — §6.14 409 PENDING_ADDITIONS', () => {
  it('T-UX-066a: renders the exact §6.14 count message, asserted against the copy helper', async () => {
    const { client } = stubClient(reviewWithTwoPending(), {
      closeBatch: () => pendingAdditions(['cnd_1', 'cnd_2']),
    });
    renderReview(client);

    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));

    const alert = await screen.findByTestId('review-pending-error');
    // Against the exported helper, never a substring literal, so the noun/verb
    // inflection ("2 titles still need") is part of the contract.
    expect(alert).toHaveTextContent(reviewPendingAdditions(2));
    expect(alert).toHaveAttribute('role', 'alert');
  });

  it('T-UX-066b: nothing was applied — it does NOT navigate and the review stays', async () => {
    const { client } = stubClient(reviewWithTwoPending(), {
      closeBatch: () => pendingAdditions(['cnd_1', 'cnd_2']),
    });
    renderReview(client);

    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));
    await screen.findByTestId('review-pending-error');

    expect(screen.queryByTestId('list-screen')).not.toBeInTheDocument();
    expect(screen.getByTestId('review-additions')).toBeInTheDocument();
    expect(screen.getByText('Dune')).toBeInTheDocument();
    // Not the load-failure state, and not §6.16 — those are different errors.
    expect(screen.queryByTestId('review-load-error')).not.toBeInTheDocument();
  });

  it('T-UX-066c: focus and scroll move to the FIRST pending card', async () => {
    const scrollSpy = vi.fn();
    (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = scrollSpy;
    const { client } = stubClient(reviewWithTwoPending(), {
      closeBatch: () => pendingAdditions(['cnd_1', 'cnd_2']),
    });
    renderReview(client);

    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));
    await screen.findByTestId('review-pending-error');

    const firstCard = document.getElementById(reviewCandidateDomId('cnd_1'));
    expect(firstCard).not.toBeNull();
    // The owner is put ON the first thing they must act on, not merely told a
    // number they then have to hunt for in a 200-card list.
    //
    // ⚠ `waitFor`, not a bare assertion. `findByTestId('review-pending-error')`
    // resolves as soon as the banner is in the DOM, but the focus move lives in
    // a PASSIVE effect that React flushes after that commit, so sampling
    // `activeElement` immediately is a race: it read `<body>` on a loaded CI
    // runner while passing every local run. This does not weaken the check —
    // `waitFor` still fails if focus never lands on the card, or lands
    // elsewhere and stays there.
    await waitFor(() => expect(document.activeElement).toBe(firstCard));
    expect(scrollSpy).toHaveBeenCalled();
  });

  it('T-UX-066d: a 409 PENDING_ADDITIONS does NOT render §6.16 — the states are distinct', async () => {
    const { client } = stubClient(reviewWithTwoPending(), {
      closeBatch: () => pendingAdditions(['cnd_1', 'cnd_2']),
    });
    renderReview(client);

    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));
    await screen.findByTestId('review-pending-error');

    // §6.16's "nothing was changed" wording is wrong here — the owner has work
    // to do, not a server to retry.
    expect(screen.queryByTestId('review-apply-error')).not.toBeInTheDocument();
  });

  it('T-UX-066e: retry clears the pending error before the in-flight close resolves, then navigates', async () => {
    // A DEFERRED success on the second attempt, so the clear is observable
    // while the retry is in flight and the review has not yet unmounted. A
    // one-shot success would navigate immediately and pass even if the flag
    // were never cleared, because navigation discards the component.
    let resolveSecond: ((value: CloseBatchResult) => void) | undefined;
    let attempts = 0;
    const { client, calls } = stubClient(reviewWithTwoPending(), {
      closeBatch: () => {
        attempts += 1;
        if (attempts === 1) return pendingAdditions(['cnd_1', 'cnd_2']);
        return new Promise<CloseBatchResult>((resolve) => {
          resolveSecond = resolve;
        });
      },
    });
    renderReview(client);

    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));
    await screen.findByTestId('review-pending-error');

    // The owner is not stuck — Apply is still pressable (the retry).
    expect(screen.getByRole('button', { name: REVIEW_APPLY_LABEL })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: REVIEW_APPLY_LABEL }));

    // Cleared immediately, before the in-flight close resolves.
    await waitFor(() =>
      expect(screen.queryByTestId('review-pending-error')).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId('list-screen')).not.toBeInTheDocument();

    resolveSecond?.(closeResult());
    expect(await screen.findByTestId('list-screen')).toHaveTextContent('list screen: bat_1');
    const closes = calls.filter((c) => c.name === 'closeBatch');
    expect(closes[0]?.args).toEqual(['bat_1', false]);
  });
});

describe('T-REV-005 (client half) — §6.15 409 REMOVALS_NOT_CONFIRMED', () => {
  it('T-REV-005g: the server 409 re-opens the removal confirmation dialog', async () => {
    // The client's review shows NO removals, so `Apply` sends `confirmRemovals:
    // false` with no dialog — the client and server views of "are there
    // removals" have diverged. The ONLY thing that can open the dialog here is
    // the §6.15 reconfirm path, which makes its appearance a non-vacuous proof.
    const { client } = stubClient(reviewReadyToClose(), {
      closeBatch: () => removalsNotConfirmed(),
    });
    renderReview(client);

    expect(screen.queryByTestId('removal-confirm')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));

    // The dialog appears only because the 409 was routed to §6.15.
    expect(await screen.findByTestId('removal-confirm')).toBeInTheDocument();
    // Not §6.16, and no navigation — nothing was applied.
    expect(screen.queryByTestId('review-apply-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-screen')).not.toBeInTheDocument();
  });

  it('T-REV-005h: confirming the re-opened dialog retries the close with confirmRemovals TRUE', async () => {
    let attempts = 0;
    const { client, calls } = stubClient(reviewReadyToClose(), {
      closeBatch: () => {
        attempts += 1;
        return attempts === 1 ? removalsNotConfirmed() : Promise.resolve(closeResult());
      },
    });
    renderReview(client);

    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));
    fireEvent.click(await screen.findByRole('button', { name: REMOVAL_CONFIRM_LABEL }));

    expect(await screen.findByTestId('list-screen')).toHaveTextContent('list screen: bat_1');
    const closes = calls.filter((c) => c.name === 'closeBatch');
    await waitFor(() => expect(closes).toHaveLength(2));
    // First send was `false` (the divergence); the retry through the dialog is
    // `true`. The client must not have silently sent `true` the first time.
    expect(closes[0]?.args).toEqual(['bat_1', false]);
    expect(closes[1]?.args).toEqual(['bat_1', true]);
  });
});
