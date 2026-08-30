/**
 * `T-DATA-011` — the undo offered at the moment of the close (US-017 AC-1,
 * `specs/ux-states.md` §6.13, `specs/api.md` §6.22/§6.25/§6.26).
 *
 * ⚠ **THIS IS THE FIFTH INSTANCE OF "TWO GREEN SUITES, ONE DEAD FEATURE."**
 * `BatchAppliedNotice` was finished and carried twenty `T-UX-065` assertions;
 * `apiClient.undoBatch` and `apiClient.undoRemovalGroup` both existed and were
 * tested; `POST /api/batches/:batchId/undo` and
 * `POST /api/removal-groups/:groupId/undo` both existed and were tested. And
 * the notice never rendered once, because `ReviewRoute` closed the batch with
 * `.then(() => navigate('/'))` — discarding the only copy of the summary that
 * will ever exist — and `ListRoute` passed neither `applied` nor either undo
 * handler to `ListPage`. Every one of those suites was green.
 *
 * ⚠ **`T-INFRA-013b` COULD NOT SEE IT, AND SAID SO.** Its matcher is a bare
 * identifier over the SPA source, so the `undoBatch` / `undoRemovalGroup`
 * PROP DECLARATIONS in `ListPage` and `BatchAppliedNotice` counted as reaching
 * the client methods. `tests/infra/webReachability.spec.ts` records this
 * looseness deliberately. The lesson generalises: a reachability gate proves a
 * name is mentioned, never that a chain is connected. **Only a test that
 * drives the real containers end to end can prove that**, which is why
 * `T-DATA-011a` renders `ReviewRoute` and `ListRoute` together under one
 * router rather than asserting props in isolation.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { buildReviewResponse } from '@nextup/domain';

import {
  UNDO_BATCH_LABEL,
  UNDO_REMOVALS_LABEL,
  type AppliedBatch,
} from '../src/components/BatchAppliedNotice';
import { ListRoute, parseAppliedState } from '../src/containers/ListRoute';
import { ReviewRoute } from '../src/containers/ReviewRoute';
import { REVIEW_APPLY_LABEL } from '../src/copy';
import type { ApiClient, CloseBatchResult } from '../src/lib/apiClient';

/** The §6.22 body, shaped exactly as the server sends it. */
function closeResult(overrides: Partial<CloseBatchResult['summary']> = {}): CloseBatchResult {
  return {
    batchId: 'bat_1',
    status: 'applied',
    summary: {
      listingsCreated: 6,
      listingsRemoved: 0,
      removalGroupId: null,
      ...overrides,
    },
    // ⚠ `max`, deliberately, while the review under test is a Netflix batch:
    // the notice must name the service the CLOSE reported, and `netflix` is
    // what a mapping that reached for the wrong field would most likely find.
    serviceState: { service: 'max' },
    undoable: true,
  };
}

function emptyReview() {
  return buildReviewResponse({
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'agreed',
    candidates: [],
    disappearedListings: [],
    imagesWithNoText: [],
  });
}

function stubClient(overrides: Record<string, unknown> = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const record =
    <T,>(name: string, value: T) =>
    async (...args: unknown[]) => {
      calls.push({ name, args });
      return value;
    };

  const client = {
    getMe: record('getMe', {}),
    getTitles: record('getTitles', { items: [], nextCursor: null, limit: 50 }),
    getServiceState: record('getServiceState', { services: [] }),
    getSuppressions: record('getSuppressions', { items: [] }),
    // These containers render an EMPTY list, which is exactly the state in
    // which `ListRoute` reads the removed count for the US-019 AC-5 empty
    // state (`T-DATA-002j`/`k`). Without the stub the whole file fails with
    // "not a function", which reads as a broken undo rather than a missing
    // fixture.
    getRemoved: record('getRemoved', { items: [], nextCursor: null, limit: 50 }),
    getReview: record('getReview', emptyReview()),
    closeBatch: record('closeBatch', closeResult()),
    discardBatch: record('discardBatch', {}),
    undoBatch: record('undoBatch', {}),
    undoRemovalGroup: record('undoRemovalGroup', {}),
    suppressTitle: record('suppressTitle', {}),
    unsuppress: record('unsuppress', {}),
    searchTmdb: record('searchTmdb', { items: [] }),
    fixMatch: record('fixMatch', {}),
    lookupImdb: record('lookupImdb', null),
    ...overrides,
  } as unknown as ApiClient;

  return { client, calls };
}

/** Review at `/batches/bat_1/review`, with the REAL list mounted at `/`. */
function renderReviewThenList(client: ApiClient): void {
  render(
    <MemoryRouter initialEntries={['/batches/bat_1/review']}>
      <Routes>
        <Route path="/batches/:batchId/review" element={<ReviewRoute client={client} />} />
        <Route path="/" element={<ListRoute client={client} />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** The list alone, arrived at with whatever history state the case needs. */
function renderListWithState(client: ApiClient, state: unknown): void {
  render(
    <MemoryRouter initialEntries={[{ pathname: '/', state }]}>
      <ListRoute client={client} />
    </MemoryRouter>,
  );
}

function appliedState(applied: AppliedBatch): { applied: AppliedBatch } {
  return { applied };
}

// ---------------------------------------------------------------------------
// The chain, end to end
// ---------------------------------------------------------------------------

describe('T-DATA-011 — the close carries its summary to the list', () => {
  it('T-DATA-011a: applying a batch lands on the list WITH the undo notice', async () => {
    const { client, calls } = stubClient();
    renderReviewThenList(client);

    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));

    // The notice is the assertion, not the navigation: arriving at `/` was
    // never the broken part. The SENTENCE is asserted, not just the box: a
    // notice that rendered with the wrong counts or the wrong service would
    // still satisfy a `findByTestId`.
    expect(await screen.findByTestId('applied-notice')).toBeInTheDocument();
    expect(screen.getByText('Added 6 titles from Max.')).toBeInTheDocument();
    expect(calls.some((c) => c.name === 'closeBatch')).toBe(true);
  });

  it('T-DATA-011b: an ordinary visit to the list shows no applied notice', async () => {
    const { client } = stubClient();
    renderListWithState(client, null);

    await waitFor(() => {
      expect(screen.queryByTestId('applied-notice')).not.toBeInTheDocument();
    });
  });

  it('T-DATA-011c: a failed close does NOT navigate to the list', async () => {
    const { client } = stubClient({
      closeBatch: () => Promise.reject(new Error('boom')),
    });
    renderReviewThenList(client);

    fireEvent.click(await screen.findByRole('button', { name: REVIEW_APPLY_LABEL }));

    // Still on the review screen. Landing on an unchanged list would read as a
    // successful close that changed nothing.
    await waitFor(() => {
      expect(screen.queryByTestId('applied-notice')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: REVIEW_APPLY_LABEL })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The undo buttons reach the client — the half `T-INFRA-013b` cannot see
// ---------------------------------------------------------------------------

describe('T-DATA-011 — the notice’s undo reaches the API', () => {
  it('T-DATA-011d: undoing a removal calls undoRemovalGroup with the group id', async () => {
    const { client, calls } = stubClient();
    renderListWithState(
      client,
      appliedState({
        batchId: 'bat_1',
        service: 'netflix',
        summary: { listingsCreated: 0, listingsRemoved: 3, removalGroupId: 'grp_7' },
        undoable: false,
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: UNDO_REMOVALS_LABEL }));

    await waitFor(() => {
      expect(calls.find((c) => c.name === 'undoRemovalGroup')?.args).toEqual(['grp_7']);
    });
    // ⚠ The two undos are NOT interchangeable: a batch that removed anything
    // is never `undoable`, so the batch undo here could only ever 409.
    expect(calls.some((c) => c.name === 'undoBatch')).toBe(false);
  });

  it('T-DATA-011e: undoing a creates-only batch calls undoBatch with the batch id', async () => {
    const { client, calls } = stubClient();
    renderListWithState(
      client,
      appliedState({
        batchId: 'bat_9',
        service: 'max',
        summary: { listingsCreated: 6, listingsRemoved: 0, removalGroupId: null },
        undoable: true,
      }),
    );

    fireEvent.click(await screen.findByRole('button', { name: UNDO_BATCH_LABEL }));

    await waitFor(() => {
      expect(calls.find((c) => c.name === 'undoBatch')?.args).toEqual(['bat_9']);
    });
    expect(calls.some((c) => c.name === 'undoRemovalGroup')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// History state is untrusted input
// ---------------------------------------------------------------------------

describe('T-DATA-011 — malformed history state is refused, not rendered', () => {
  it('T-DATA-011f: a state from an older build renders no notice and does not throw', async () => {
    const { client } = stubClient();
    // Shaped like the close response of a build that had no `summary`. A cast
    // would reach `undefined.listingsRemoved` inside the notice's copy and
    // blank the list with a render error.
    renderListWithState(client, { applied: { batchId: 'bat_1', service: 'netflix' } });

    await waitFor(() => {
      expect(screen.queryByTestId('applied-notice')).not.toBeInTheDocument();
    });
  });

  it('T-DATA-011g: every required field is checked, not just the presence of `applied`', () => {
    const good: AppliedBatch = {
      batchId: 'bat_1',
      service: 'netflix',
      summary: { listingsCreated: 1, listingsRemoved: 0, removalGroupId: null },
      undoable: true,
    };
    expect(parseAppliedState({ applied: good })).toEqual(good);

    // Each of these differs from `good` in exactly one field, so a guard that
    // checked only some of them would still pass the case above.
    expect(parseAppliedState(null)).toBeUndefined();
    expect(parseAppliedState({})).toBeUndefined();
    expect(parseAppliedState({ applied: { ...good, batchId: '' } })).toBeUndefined();
    expect(parseAppliedState({ applied: { ...good, service: 'hulu' } })).toBeUndefined();
    expect(parseAppliedState({ applied: { ...good, undoable: 'yes' } })).toBeUndefined();
    expect(parseAppliedState({ applied: { ...good, summary: null } })).toBeUndefined();
    expect(
      parseAppliedState({
        applied: { ...good, summary: { ...good.summary, listingsCreated: '1' } },
      }),
    ).toBeUndefined();
    expect(
      parseAppliedState({
        applied: { ...good, summary: { ...good.summary, listingsRemoved: null } },
      }),
    ).toBeUndefined();
    expect(
      parseAppliedState({ applied: { ...good, summary: { ...good.summary, removalGroupId: 7 } } }),
    ).toBeUndefined();
  });
});
