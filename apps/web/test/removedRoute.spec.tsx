/**
 * `T-DATA-002v`–`ac` — the removed view reads its data from the API.
 *
 * ⚠ **THE DEFECT THIS FILE EXISTS FOR: THREE FINISHED PIECES JOINED BY
 * NOTHING.** `GET /api/removed` was built and registered, `RemovedPage` was
 * built (398 lines, including TASK-099's `RestoreControl`), and `routes.tsx`
 * mounted the page **bare**. `items` defaulted to `[]`, so `/removed` told
 * every owner that nothing had ever been removed — against a working API — and
 * `onRestore` was `undefined` on every row, so the restore control could not
 * be reached at all. Twelve `removedPage.spec.tsx` cases stayed green
 * throughout: every one of them injects `items` by hand, which measures
 * rendering and says nothing about whether anything ever fetches.
 *
 * ⚠ **EVERY CASE DRIVES THE CONTAINER, AND `T-DATA-002ac` DRIVES THE ROUTE
 * TABLE ITSELF.** Asserting the container's behaviour alone would not catch a
 * one-line revert of `Component:` back to the bare page — which is exactly the
 * form the bug took.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { RemovedRoute } from '../src/containers/RemovedRoute';
import { REMOVED_EMPTY_TITLE, REMOVED_NO_MATCHES, RETRY_LABEL } from '../src/copy';
import { RefusedError, type ApiClient, type RemovedItem } from '../src/lib/apiClient';

function removed(over: Partial<RemovedItem> = {}): RemovedItem {
  return {
    listingId: 'lst_1',
    titleId: 'ttl_1',
    workIdentity: 'tmdb:movie:603',
    matchState: 'matched',
    name: 'The Matrix',
    mediaType: 'movie',
    releaseYear: 1999,
    posterPath: null,
    service: 'netflix',
    dateAdded: '2026-01-04',
    removedAt: '2026-05-01T10:00:00.000Z',
    removedByBatchId: 'bat_1',
    removedByGroupId: 'grp_1',
    removalOrdinal: 1,
    removalTotalForWork: 1,
    restorable: true,
    suppressed: false,
    ...over,
  };
}

function stubClient(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const record =
    <T,>(name: string, value: T) =>
    async () => {
      calls.push(name);
      return value;
    };

  const client = {
    getRemoved: record('getRemoved', { items: [removed()], nextCursor: null }),
    restoreListing: record('restoreListing', {
      listingId: 'lst_1',
      titleId: 'ttl_1',
      dateAdded: '2026-01-04',
      alreadyActive: false,
    }),
    unsuppress: record('unsuppress', {
      suppressionId: 'sup_1',
      active: false,
      restoredAnything: false,
    }),
    getTitles: record('getTitles', { items: [], nextCursor: null, limit: 50 }),
    getMe: record('getMe', {}),
    ...overrides,
  } as unknown as ApiClient;

  return { client, calls };
}

function renderRoute(client: ApiClient, entry = '/removed', strict = false) {
  const tree = (
    <MemoryRouter initialEntries={[entry]}>
      <RemovedRoute client={client} />
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
}

describe('T-DATA-002 — the removed view reads its data from the API', () => {
  it('T-DATA-002v: mounting the removed route requests the removals', async () => {
    // ⚠ The assertion that would have failed on the shipped code: nothing
    // fetched, and the screen rendered an empty log.
    const { client, calls } = stubClient();
    renderRoute(client);

    await waitFor(() => {
      expect(calls).toContain('getRemoved');
    });
    expect(await screen.findByText('The Matrix')).toBeInTheDocument();
  });

  it('T-DATA-002w: a FAILED read renders the failure state, never an empty log', async () => {
    // ⚠ THE MOST IMPORTANT CASE IN THIS FILE. The removed view is a historical
    // LOG (product invariant 7) and is how the owner sees that a full-update
    // lost nothing (REQ-028). "Nothing has been removed yet" is the one
    // sentence it must never say falsely: to an owner who has removed things,
    // it is indistinguishable from the log having been erased.
    const { client } = stubClient({
      getRemoved: async () => {
        throw new Error('network');
      },
    });
    renderRoute(client);

    await waitFor(() => {
      expect(screen.queryByText(REMOVED_EMPTY_TITLE)).not.toBeInTheDocument();
    });
    expect(await screen.findByRole('button', { name: RETRY_LABEL })).toBeInTheDocument();
  });

  it('T-DATA-002x: retrying re-reads the API', async () => {
    const user = userEvent.setup();
    let fail = true;
    const calls: string[] = [];
    const client = {
      getRemoved: async () => {
        calls.push('getRemoved');
        if (fail) throw new Error('network');
        return { items: [removed()], nextCursor: null };
      },
    } as unknown as ApiClient;
    renderRoute(client);

    const retry = await screen.findByRole('button', { name: RETRY_LABEL });
    fail = false;
    await user.click(retry);

    expect(await screen.findByText('The Matrix')).toBeInTheDocument();
    expect(calls.length).toBeGreaterThan(1);
  });

  it('T-DATA-002y: a 403 is the whole screen, not the failure state', async () => {
    // The owner is authenticated, so the retry the failure state offers could
    // never succeed; merging the two would offer it anyway.
    const { client } = stubClient({
      getRemoved: async () => {
        throw new RefusedError('not allowed');
      },
    });
    renderRoute(client);

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: RETRY_LABEL })).not.toBeInTheDocument();
    });
    expect(screen.queryByText('The Matrix')).not.toBeInTheDocument();
  });

  it('T-DATA-002z: RESTORE reaches the API from a row', async () => {
    // ⚠ TASK-099 shipped this control and marked itself `done`; `onRestore`
    // was `undefined` on every row, so no press could ever reach the server.
    const user = userEvent.setup();
    const { client, calls } = stubClient();
    renderRoute(client);

    await screen.findByText('The Matrix');
    await user.click(screen.getByTestId('restore-button'));

    await waitFor(() => {
      expect(calls).toContain('restoreListing');
    });
  });

  it('T-DATA-002aa: restore is NOT fired by rendering, only by pressing', async () => {
    // REQ-102 / product invariant 7: restore is an explicit user action. React
    // 19 double-invokes effects under StrictMode, so the same call placed in
    // one would restore a listing the owner never asked to restore — the worst
    // available bug on a screen whose whole job is that nothing changes
    // without being asked.
    const { client, calls } = stubClient();
    renderRoute(client, '/removed', true);

    await screen.findByText('The Matrix');
    expect(calls).not.toContain('restoreListing');
  });

  it('T-DATA-002ab: the APPLIED search term is read back from the URL', async () => {
    // `RemovedPage` renders no search box: `query` feeds only the "no matches
    // for {q}" empty state, so a value that was not actually applied to the
    // results would name the wrong term.
    const { client } = stubClient({
      getRemoved: async () => ({ items: [], nextCursor: null }),
    });
    renderRoute(client, '/removed?q=matrix');

    expect(
      await screen.findByText(REMOVED_NO_MATCHES.replace('{q}', 'matrix')),
    ).toBeInTheDocument();
    // ⚠ Not the generic empty state: "nothing has been removed yet" and "no
    // removals match your search" are different facts (§7.3).
    expect(screen.queryByText(REMOVED_EMPTY_TITLE)).not.toBeInTheDocument();
  });

  it('T-DATA-002ac: the route table mounts the CONTAINER, not the bare page', async () => {
    // ⚠ The defect was one line here. A container that behaves perfectly while
    // `routes.tsx` still points at the bare page is exactly the state this
    // repository shipped, so the route table is asserted directly.
    const { ROUTES } = await import('../src/routes');
    const route = ROUTES.find((candidate) => candidate.path === '/removed');

    expect(route).toBeDefined();
    expect(route?.Component).toBe(RemovedRoute);
  });
});
