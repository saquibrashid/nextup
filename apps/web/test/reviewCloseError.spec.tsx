/**
 * `T-UX-067` — `specs/ux-states.md` §6.16: a 5xx (or network) failure on the
 * batch CLOSE.
 *
 * ⚠ **THIS STATE HAD AN ID AND NO ASSERTION AT ALL.** `T-UX-067` lived only in
 * `ux-states.md`: `check-test-ids.mjs` walks backlog → `specs/testing.md`, and
 * `check-orphan-tests.mjs` walks the other way from implemented tests, so an id
 * cited by no task and defined by no spec row is seen by NEITHER gate. Every
 * gate was green and the state did not exist — the purest form of this repo's
 * dominant defect: a criterion with no measurement behind its name.
 *
 * ⚠ **THE REVIEW STAYS ON SCREEN.** §6.16 ends *"your review is still here"*.
 * `ReviewRoute`'s rejection handler was empty — correct not to navigate, but
 * the owner got no feedback whatsoever, indistinguishable from a dead button
 * on the irreversible full-update path. `T-UX-067c` is the case that fails if
 * anyone "simplifies" this into the load-failure state, which swaps the review
 * body out for an error.
 *
 * Retry design: the existing **Apply changes** control is the "Try again". The
 * §6.12 in-flight state (`T-UX-064`) disables it only WHILE a close is in
 * flight and clears the flag on every failure arm, so by the time this
 * message is on screen the button is re-pressable again — `T-UX-064d` is the
 * case that fails if that guard ever latches on. Re-pressing it re-runs the
 * EXACT same flow — re-opening the §6.10 removal dialog whenever there are
 * removals — so `confirmRemovals` can never be silently re-applied without the
 * owner. A distinct control remembering `confirmRemovals` would risk exactly
 * that.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { buildReviewResponse } from '@nextup/domain';

import { ReviewRoute } from '../src/containers/ReviewRoute';
import { REVIEW_APPLY_FAILED, REVIEW_APPLY_LABEL } from '../src/copy';
import { ApiError, type ApiClient, type CloseBatchResult } from '../src/lib/apiClient';

/** A full-update review with one addition and NO removals, so the close sends
 *  `confirmRemovals: false` and no §6.10 dialog stands between the press and
 *  the request — which keeps `T-UX-067d` asserting the retry, not the dialog. */
function reviewWithOneAddition() {
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [
      {
        candidateId: 'cnd_1',
        rawExtractedText: 'Dune',
        normalisedText: 'dune',
        verdict: 'title',
        confidence: 0.99,
        ocrSupport: 'corroborated',
        cleanupVerdict: null,
        resolvedWorkIdentity: 'tmdb:movie:438631',
        match: {
          workIdentity: 'tmdb:movie:438631',
          mediaType: 'movie',
          name: 'Dune',
          releaseYear: 2021,
          posterPath: null,
          score: 0.99,
          uncertain: false,
          ambiguous: false,
        },
        alternatives: [],
        sourceImageIds: ['img_1'],
        disposition: 'pending',
        collapsedIntoCandidateId: null,
        classification: 'new',
      },
    ],
    disappearedListings: [],
    imagesWithNoText: [],
  });
}

/** The §6.22 body, shaped exactly as the server sends it. */
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
function stubClient(overrides: Record<string, (...args: unknown[]) => unknown> = {}) {
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
    getReview: record('getReview', reviewWithOneAddition()),
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

/** Renders the review with a `/` route that surfaces the navigation target
 *  AND any `applied` history state it was handed, so both "did we navigate"
 *  and "with what state" are directly observable without mounting `ListRoute`. */
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

const fail = () => Promise.reject(new ApiError('INTERNAL', 500, 'boom', {}));

describe('T-UX-067 — §6.16 5xx on close', () => {
  it('T-UX-067a: a failed close renders the exact §6.16 message', async () => {
    const { client } = stubClient({ closeBatch: fail });
    renderReview(client);

    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));

    const alert = await screen.findByTestId('review-apply-error');
    // ⚠ Asserted against the exported constant, never a substring literal, so
    // the em dash in the copy is part of the contract this test defends.
    expect(alert).toHaveTextContent(REVIEW_APPLY_FAILED);
    expect(alert).toHaveAttribute('role', 'alert');
  });

  it('T-UX-067b: a failed close does NOT navigate', async () => {
    const { client } = stubClient({ closeBatch: fail });
    renderReview(client);

    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));
    await screen.findByTestId('review-apply-error');

    // Still on the review. Landing on an unchanged list would read as a
    // successful close that changed nothing.
    expect(screen.queryByTestId('list-screen')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: REVIEW_APPLY_LABEL })).toBeInTheDocument();
  });

  it('T-UX-067c: the review is still rendered underneath the error', async () => {
    const { client } = stubClient({ closeBatch: fail });
    renderReview(client);

    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));
    await screen.findByTestId('review-apply-error');

    // The sections and the owner's candidate are still on screen — this is the
    // assertion that fails if §6.16 is collapsed into the load-failure state,
    // which replaces the whole page body.
    expect(screen.getByTestId('review-additions')).toBeInTheDocument();
    expect(screen.getByText('Dune')).toBeInTheDocument();
    expect(screen.getByTestId('review-action-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('review-load-error')).not.toBeInTheDocument();
  });

  it('T-UX-067d: retry re-presses Apply and closes again with the SAME confirmRemovals', async () => {
    let attempts = 0;
    const { client, calls } = stubClient({
      closeBatch: () => {
        attempts += 1;
        // Fail the first attempt, succeed the second, so a real retry is what
        // clears the error rather than the flag never having been set.
        return attempts === 1 ? fail() : Promise.resolve(closeResult());
      },
    });
    renderReview(client);

    const apply = await screen.findByRole('button', { name: REVIEW_APPLY_LABEL });
    fireEvent.click(apply);
    await screen.findByTestId('review-apply-error');

    // The control is enabled again — the owner is not stuck.
    expect(screen.getByRole('button', { name: REVIEW_APPLY_LABEL })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: REVIEW_APPLY_LABEL }));

    const closes = () => calls.filter((c) => c.name === 'closeBatch');
    await waitFor(() => expect(closes()).toHaveLength(2));
    // No removals in the fixture, so both attempts carry `false` — the retry
    // must not silently re-derive or flip `confirmRemovals`.
    expect(closes()[0]?.args).toEqual(['bat_1', false]);
    expect(closes()[1]?.args).toEqual(['bat_1', false]);
  });

  it('T-UX-067e: a successful retry clears the error and navigates with the applied state', async () => {
    // A deferred success on the SECOND attempt, so the error must be cleared
    // by the container the moment the retry starts — while the close is still
    // in flight and the review has NOT yet unmounted. A clean one-shot success
    // would pass even if the flag were never cleared, because navigation
    // discards the component. This asserts the clear itself.
    let resolveSecond: ((value: CloseBatchResult) => void) | undefined;
    let attempts = 0;
    const { client } = stubClient({
      closeBatch: () => {
        attempts += 1;
        if (attempts === 1) return fail();
        return new Promise<CloseBatchResult>((resolve) => {
          resolveSecond = resolve;
        });
      },
    });
    renderReview(client);

    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));
    await screen.findByTestId('review-apply-error');

    // Retry: the error clears immediately, before the in-flight close resolves.
    fireEvent.click(screen.getByRole('button', { name: REVIEW_APPLY_LABEL }));
    await waitFor(() => expect(screen.queryByTestId('review-apply-error')).not.toBeInTheDocument());
    // Still on the review — the second close has not resolved yet.
    expect(screen.queryByTestId('list-screen')).not.toBeInTheDocument();

    resolveSecond?.(closeResult());
    // Now it navigates, carrying the close summary, and with no stale error.
    expect(await screen.findByTestId('list-screen')).toHaveTextContent('list screen: bat_1');
    expect(screen.queryByTestId('review-apply-error')).not.toBeInTheDocument();
  });

  it('T-UX-067f: a 409 does NOT render §6.16 — it is a distinct state, scoped out', async () => {
    // §6.14/§6.15 own the 409s with their own affordances; §6.16's "nothing
    // was changed, try again" wording is wrong for them. This pins the 5xx
    // scoping so a widened guard cannot silently reclaim a 409 as §6.16. (The
    // 409s are now handled — see reviewCloseErrorSiblings.spec.tsx; this case
    // only guards that §6.16 is NOT what fires for them.)
    const { client } = stubClient({
      closeBatch: () => Promise.reject(new ApiError('PENDING_ADDITIONS', 409, 'decide first', {})),
    });
    renderReview(client);

    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));

    // Give any rejected promise time to settle, then assert §6.16 never fired
    // and the review is intact and un-navigated.
    await waitFor(() => expect(screen.getByTestId('review-additions')).toBeInTheDocument());
    expect(screen.queryByTestId('review-apply-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('list-screen')).not.toBeInTheDocument();
  });
});
