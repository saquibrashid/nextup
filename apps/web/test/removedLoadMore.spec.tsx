/**
 * `T-UX-073` — `specs/ux-states.md` §7.4 **Partial**: *"Page 1 + load-more
 * sentinel"*, per `specs/ui.md` §2.1 item 4.
 *
 * ⚠ THE REMOVAL LOG IS THE LIST MOST CERTAIN TO OUTGROW ONE PAGE, AND THE ONE
 * WHOSE TRUNCATION IS MOST EASILY MISREAD. By product invariant 7 a
 * reappearing title becomes a brand-new row, so the log only ever grows and
 * legitimately holds several entries for the same work. Capped silently at
 * fifty it stops at the most recent removals — and the older ones, which are
 * exactly what an owner opens this screen to find, are simply not there. On a
 * screen whose entire purpose is to prove that nothing was lost, that is the
 * US-019 AC-5 misreading delivered by the reassurance itself.
 *
 * ⚠ THE SENTINEL SURVIVES THE "no matches" STATE HERE (`T-UX-073d`), unlike
 * on the list. The removed view filters server-side by `q`, so a search that
 * matches nothing on page 1 may still match on page 2; hiding the control in
 * that branch strands the owner on an empty screen that is not empty.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RemovedRoute } from '../src/containers/RemovedRoute';
import { RemovedPage } from '../src/pages/RemovedPage';
import type { RemovedItem } from '../src/lib/apiClient';

const PAGE_LIMIT = 50;
const CURSOR_2 = 'REMOVED_PAGE_2';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function wireRemoval(n: number): Record<string, unknown> {
  // ⚠ Copied field-for-field from `RemovedItem` in `apps/web/src/lib/
  // apiClient.ts`, including `dateAdded` as `YYYY-MM-DD` and `removedAt` as a
  // full timestamp. An invented shape here is a second statement of the wire
  // contract that can agree with the test and disagree with the server.
  return {
    listingId: `l${String(n)}`,
    titleId: `t${String(n)}`,
    workIdentity: `w${String(n)}`,
    matchState: 'matched',
    name: `Removed ${String(n)}`,
    mediaType: 'movie',
    releaseYear: 2020,
    posterPath: null,
    service: 'netflix',
    dateAdded: '2026-01-01',
    removedAt: '2026-02-01T00:00:00.000Z',
    removedByBatchId: null,
    removedByGroupId: null,
    removalOrdinal: 1,
    removalTotalForWork: 1,
    restorable: true,
    suppressed: false,
  };
}

interface Page {
  readonly from: number;
  readonly count: number;
  readonly nextCursor: string | null;
}

function stubRemoved(pages: Readonly<Record<string, Page>>): string[] {
  const urls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      const json = (body: unknown): Promise<Response> =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      if (!url.includes('/api/removed')) return json({ items: [], services: [] });

      urls.push(url);
      const cursor = new URL(url, 'http://x').searchParams.get('cursor') ?? '';
      const page = pages[cursor] ?? pages[''];
      if (page === undefined) return json({ items: [], nextCursor: null, limit: PAGE_LIMIT });
      return json({
        items: Array.from({ length: page.count }, (_, i) => wireRemoval(page.from + i)),
        nextCursor: page.nextCursor,
        limit: PAGE_LIMIT,
      });
    }),
  );
  return urls;
}

async function mountRemoved(entry = '/removed'): Promise<void> {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <RemovedRoute />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
  });
}

const TWO_PAGES: Readonly<Record<string, Page>> = {
  '': { from: 0, count: PAGE_LIMIT, nextCursor: CURSOR_2 },
  [CURSOR_2]: { from: PAGE_LIMIT, count: 7, nextCursor: null },
};

describe('T-UX-073 the removed view pages beyond the first fifty removals', () => {
  it('T-UX-073a: a live next cursor renders the load-more control', async () => {
    stubRemoved(TWO_PAGES);
    await mountRemoved();

    await waitFor(() => {
      expect(screen.getAllByTestId('removed-row')).toHaveLength(PAGE_LIMIT);
    });
    expect(screen.getByTestId('load-more')).toBeInTheDocument();
  });

  it('T-UX-073b: loading more APPENDS, so older removals join the newer ones', async () => {
    // ⚠ Append, not replace. Replacing would make the log show removals 51-57
    // and nothing else — on the screen whose job is to prove nothing was lost.
    const urls = stubRemoved(TWO_PAGES);
    await mountRemoved();
    await waitFor(() => {
      expect(screen.getAllByTestId('removed-row')).toHaveLength(PAGE_LIMIT);
    });

    await userEvent.click(screen.getByTestId('load-more'));

    await waitFor(() => {
      expect(screen.getAllByTestId('removed-row')).toHaveLength(PAGE_LIMIT + 7);
    });
    expect(screen.getByText('Removed 0')).toBeInTheDocument();
    expect(urls.some((url) => url.includes(`cursor=${CURSOR_2}`))).toBe(true);
  });

  it('T-UX-073c: a complete first page shows no control', async () => {
    stubRemoved({ '': { from: 0, count: 2, nextCursor: null } });
    await mountRemoved();

    await waitFor(() => {
      expect(screen.getAllByTestId('removed-row')).toHaveLength(2);
    });
    expect(screen.queryByTestId('load-more')).not.toBeInTheDocument();
  });

  it('T-UX-073d: a search matching nothing on page 1 can still be continued', async () => {
    /*
      ⚠ THE CONTROL MUST SURVIVE "no matches". The filter is applied by the
      SERVER, so page 1 of a search legitimately returns nothing while page 2
      matches. Rendering the sentinel only alongside the results list — the
      obvious placement — tells the owner their search found nothing while the
      row they are looking for sits one page away, unreachable and
      unmentioned.
    */
    stubRemoved({
      '': { from: 0, count: 0, nextCursor: CURSOR_2 },
      [CURSOR_2]: { from: 90, count: 1, nextCursor: null },
    });
    await mountRemoved('/removed?q=dune');

    await waitFor(() => {
      expect(screen.getByTestId('removed-no-matches')).toBeInTheDocument();
    });
    expect(screen.getByTestId('load-more')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('load-more'));

    await waitFor(() => {
      expect(screen.getByText('Removed 90')).toBeInTheDocument();
    });
  });

  it('T-UX-073e: the control is absent while page 1 is still loading', async () => {
    // A "Load more" over a skeleton offers page 2 of a list whose page 1 has
    // not arrived — and `hasMore` is false then anyway, so a control appearing
    // here would mean the flag was being derived from something else.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    );
    render(
      <MemoryRouter initialEntries={['/removed']}>
        <RemovedRoute />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('removed-loading-skeletons')).toBeInTheDocument();
    expect(screen.queryByTestId('load-more')).not.toBeInTheDocument();
  });

  it('T-UX-073f: a stale `hasMore` cannot leak a control over a skeleton', async () => {
    /*
      ⚠ THIS TEST EXISTS BECAUSE `T-UX-073e` DID NOT KILL A MUTATION THAT
      DELETED THE `!loading` GUARD. Through the route, `hasMore` happens to be
      false whenever page 1 is in flight, so `e` passes on that coincidence
      rather than on the guard — it proves the observable outcome, not the
      protection. The guard's real job is the case the route reaches on a
      REFETCH: pages are already accumulated, `hasMore` is still true from the
      previous query, and a new page 1 is in flight. Offering "Load more" there
      pages a cursor belonging to the query the owner just left, appending
      other-search rows to a list that is about to be replaced.

      Driving `RemovedPage` directly is deliberate: this is the guard's
      contract, and the contradictory prop combination is precisely what the
      route must never render.
    */
    render(
      <MemoryRouter initialEntries={['/removed']}>
        <RemovedPage
          items={[wireRemoval(1) as unknown as RemovedItem]}
          loading
          hasMore
          loadingMore={false}
          loadMoreFailed={false}
          onLoadMore={() => undefined}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId('load-more')).not.toBeInTheDocument();
  });
});
