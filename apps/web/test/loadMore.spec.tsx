/**
 * `T-UX-015` (continued) — the **load-more sentinel** of `specs/ux-states.md`
 * §2.6, specified in `specs/ui.md` §2.1 item 4: *"cursor pagination, an
 * IntersectionObserver auto-loading the next page, plus an explicit **'Load
 * more'** button as the keyboard/no-JS-observer path."*
 *
 * ⚠ THIS CLOSES A MEASURED DATA-REACHABILITY DEFECT, not a missing nicety.
 * The API has paged at 50 since TASK-052 and has always answered with a
 * `nextCursor`; `apiClient.ts` has always typed it. **Nothing in
 * `apps/web/src` ever read it.** A probe against the real `ListRoute` with a
 * live `nextCursor` made three requests, none carrying a cursor, and rendered
 * no "more" affordance of any kind — so an owner with 300 titles could reach
 * fifty of them and had no way to learn the rest existed. Documented in two
 * specs, typed in the client, enforced by nothing.
 *
 * ⚠ WHY THE APPEND IS ASSERTED SEPARATELY FROM THE REQUEST (`T-UX-015g`). The
 * obvious wrong implementation fetches page 2 correctly and REPLACES the rows
 * with it. Every "did it request the cursor?" assertion passes; the owner
 * watches the first fifty titles vanish. That is the US-019 AC-5 misreading,
 * caused by the fix rather than by the bug, so `g` asserts a row from page 1
 * is still on screen after page 2 lands.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AT_LEAST_PREFIX } from '../src/copy';
import { ListRoute, withCursor } from '../src/containers/ListRoute';

const PAGE_LIMIT = 50;
const CURSOR_2 = 'CURSOR_PAGE_2';
const CURSOR_3 = 'CURSOR_PAGE_3';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  /*
    ⚠ `SortControl` PERSISTS THE DIRECTION IN `sessionStorage`, which jsdom
    shares across every test in the file. `T-UX-015o` clicks it, and without
    this the NEXT test mounts with a remembered `dir=asc`, whose URL
    normalisation rewrites the query on mount — resetting the accumulated pages
    mid-test and failing an assertion that has nothing to do with sorting.
    `sortControl.spec.tsx` already clears it for the same reason.
  */
  sessionStorage.clear();
});

function wireTitle(n: number): Record<string, unknown> {
  return {
    titleId: `t${String(n)}`,
    name: `Title ${String(n)}`,
    workIdentity: `w${String(n)}`,
    mediaType: 'movie',
    releaseYear: 2020,
    genres: [],
    posterPath: null,
    badges: [{ service: 'netflix', listingId: `l${String(n)}`, dateAdded: '2026-01-01' }],
    dateAdded: '2026-01-01T00:00:00.000Z',
    state: 'active',
    metadataStale: false,
  };
}

interface Page {
  readonly from: number;
  readonly count: number;
  readonly nextCursor: string | null;
}

/**
 * Serves pages keyed on the `cursor` query parameter, and records every list
 * URL requested.
 *
 * ⚠ Stubs at `fetch`, not at the client. The defect was whether the cursor
 * ever reached the wire at all, and a hand-built client stub is a second
 * statement of the request shape that can agree with the test while
 * disagreeing with the server.
 */
function stubPages(pages: Readonly<Record<string, Page>>, failCursors: readonly string[] = []) {
  const listUrls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      const json = (body: unknown, status = 200): Promise<Response> =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' },
          }),
        );

      if (url.includes('/api/suppressions')) return json({ items: [] });
      if (url.includes('/api/removed')) return json({ items: [], nextCursor: null, limit: 50 });
      if (url.includes('/api/service-state')) return json({ services: [] });

      listUrls.push(url);
      const cursor = new URL(url, 'http://x').searchParams.get('cursor') ?? '';
      if (failCursors.includes(cursor)) {
        return json({ error: { code: 'INTERNAL', message: 'no', details: {} } }, 500);
      }
      const page = pages[cursor] ?? pages[''];
      if (page === undefined) return json({ items: [], nextCursor: null, limit: PAGE_LIMIT });
      return json({
        items: Array.from({ length: page.count }, (_, i) => wireTitle(page.from + i)),
        nextCursor: page.nextCursor,
        limit: PAGE_LIMIT,
      });
    }),
  );
  return listUrls;
}

async function mountList(entry = '/'): Promise<void> {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <ListRoute />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.getAllByTestId('title-name').length).toBeGreaterThan(0);
  });
}

const TWO_PAGES: Readonly<Record<string, Page>> = {
  '': { from: 0, count: PAGE_LIMIT, nextCursor: CURSOR_2 },
  [CURSOR_2]: { from: PAGE_LIMIT, count: 10, nextCursor: null },
};

/**
 * A minimal `IntersectionObserver`, because jsdom has none.
 *
 * ⚠ WITHOUT THIS, THE AUTO-LOADER IS UNTESTED AND THE FEATURE-DETECT HIDES
 * THAT FACT. `LoadMoreSentinel` skips the observer entirely when the global is
 * absent, so every case above passes against a build in which the observer
 * half of §2.1 item 4 was never written — the button carries them all. The
 * observer is half of the requirement, and it is the half the owner actually
 * uses while scrolling.
 */
class FakeObserver {
  static instances: FakeObserver[] = [];
  disconnected = false;
  /**
   * ⚠ RECORDED, AND `fire()` REFUSES WITHOUT IT. The first version of this
   * fake fired its callback whether or not `observe()` had ever been called,
   * so removing the `observer.observe(element)` line from the component —
   * which stops the auto-loader firing in every real browser — left both
   * observer cases green.
   */
  readonly observed: unknown[] = [];
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeObserver.instances.push(this);
  }
  observe(element: unknown): void {
    this.observed.push(element);
  }
  disconnect(): void {
    this.disconnected = true;
  }
  unobserve(): void {
    /* unused */
  }
  fire(): void {
    if (this.observed.length === 0) throw new Error('fired an observer that observes nothing');
    this.callback(
      [{ isIntersecting: true } as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  /** Attached AND actually watching something. */
  static live(): FakeObserver | undefined {
    return FakeObserver.instances.filter((o) => !o.disconnected && o.observed.length > 0).at(-1);
  }
}

function stubObserver(): void {
  FakeObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeObserver);
}

describe('T-UX-015 the load-more sentinel reaches the rest of the list', () => {
  it('T-UX-015f: a live next cursor renders an explicit Load more control', async () => {
    // ⚠ The BUTTON, not merely the observer. `specs/ui.md` §2.1 item 4 asks
    // for both, and the button is the only one a keyboard-only owner can
    // reach: tabbing through rows never scrolls a sentinel into view, so an
    // observer-only build ends their list at row 50 exactly as before.
    stubPages(TWO_PAGES);
    await mountList();

    expect(screen.getByTestId('load-more')).toBeInTheDocument();
  });

  it('T-UX-015g: loading more APPENDS the next page, keeping the rows already read', async () => {
    const listUrls = stubPages(TWO_PAGES);
    await mountList();
    expect(screen.getAllByTestId('title-name')).toHaveLength(PAGE_LIMIT);

    await userEvent.click(screen.getByTestId('load-more'));

    await waitFor(() => {
      expect(screen.getAllByTestId('title-name')).toHaveLength(PAGE_LIMIT + 10);
    });
    // The first page's first row is still there: page 2 was appended, not
    // swapped in. Without this, a replace-implementation passes every other
    // case in this file while deleting fifty titles from the screen.
    expect(screen.getByText('Title 0')).toBeInTheDocument();
    expect(screen.getByText('Title 50')).toBeInTheDocument();
    expect(listUrls.some((url) => url.includes(`cursor=${CURSOR_2}`))).toBe(true);
  });

  it('T-UX-015h: the next page keeps the filters and sort the cursor was cut from', async () => {
    // A cursor is a position within one particular ordering and filtering. Sent
    // bare, it pages through the DEFAULT list from a position in a filtered
    // one — two lists silently interleaved, which reads as rows appearing and
    // disappearing rather than as an error.
    const listUrls = stubPages(TWO_PAGES);
    await mountList('/?services=netflix&sort=date&dir=asc');

    await userEvent.click(screen.getByTestId('load-more'));

    await waitFor(() => {
      expect(listUrls.some((url) => url.includes('cursor='))).toBe(true);
    });
    const paged = listUrls.find((url) => url.includes('cursor='));
    expect(paged).toContain('services=netflix');
    expect(paged).toContain('sort=date');
    expect(paged).toContain('dir=asc');
  });

  it('T-UX-015i: reaching the last page retires both the control and the "at least"', async () => {
    // The count and the sentinel are two faces of the same fact. Leaving the
    // hedge on a demonstrably complete list is the mirror of the original
    // defect: a number that misdescribes what the owner can see.
    stubPages(TWO_PAGES);
    await mountList();
    expect(screen.getByTestId('filter-count').textContent).toContain(AT_LEAST_PREFIX);

    await userEvent.click(screen.getByTestId('load-more'));

    await waitFor(() => {
      expect(screen.queryByTestId('load-more')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('filter-count').textContent).toBe('Showing 60 of 60');
  });

  it('T-UX-015j: a complete first page shows no control at all', async () => {
    // The counterweight to `f`. A sentinel rendered unconditionally claims
    // there is more to see on a list that is whole, and does nothing when
    // clicked.
    stubPages({ '': { from: 0, count: 3, nextCursor: null } });
    await mountList();

    expect(screen.queryByTestId('load-more')).not.toBeInTheDocument();
    expect(screen.queryByTestId('load-more-sentinel')).not.toBeInTheDocument();
  });

  it('T-UX-015k: a failed next page keeps every row on screen and says so', async () => {
    // ⚠ A FAILED "load more" IS NOT A FAILED LIST. Promoting it to the page
    // error state would blank a list that loaded perfectly because its next
    // page did not — losing fifty visible rows to report that ten more could
    // not be fetched.
    stubPages(TWO_PAGES, [CURSOR_2]);
    await mountList();

    await userEvent.click(screen.getByTestId('load-more'));

    await waitFor(() => {
      expect(screen.getByTestId('load-more-error')).toBeInTheDocument();
    });
    expect(screen.getAllByTestId('title-name')).toHaveLength(PAGE_LIMIT);
    expect(screen.queryByTestId('list-load-error')).not.toBeInTheDocument();
    // The retry is offered, and it is the same control — not a dead end.
    expect(screen.getByTestId('load-more')).toBeInTheDocument();
  });

  it('T-UX-015l: a server that repeats a spent cursor is reported, not looped on', async () => {
    /*
      ⚠ THE AUTO-LOADER MAKES THIS DANGEROUS RATHER THAN MERELY WRONG. The
      sentinel stays in view while the list is short, so a response echoing the
      cursor it was handed would drive an unbounded request loop against a
      single 0.25 vCPU replica as fast as the browser could dispatch it. The
      guard refuses a cursor already spent and surfaces it, because a sentinel
      that silently stalled would hide rows all over again.
    */
    const listUrls = stubPages({
      '': { from: 0, count: PAGE_LIMIT, nextCursor: CURSOR_2 },
      [CURSOR_2]: { from: PAGE_LIMIT, count: 5, nextCursor: CURSOR_2 },
    });
    await mountList();

    await userEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => {
      expect(screen.getAllByTestId('title-name')).toHaveLength(PAGE_LIMIT + 5);
    });
    await userEvent.click(screen.getByTestId('load-more'));

    await waitFor(() => {
      expect(screen.getByTestId('load-more-error')).toBeInTheDocument();
    });
    expect(listUrls.filter((url) => url.includes(`cursor=${CURSOR_2}`))).toHaveLength(1);
  });

  it('T-UX-015n: a failure on page 3 keeps the pages already loaded', async () => {
    /*
      ⚠ THIS EXISTS BECAUSE `T-UX-015k` SURVIVED THE MUTATION IT WAS WRITTEN TO
      KILL. Clearing the accumulated pages in the failure handler changed
      nothing there: `k` fails on the FIRST "load more", when nothing has
      accumulated yet and the rows on screen still come from page 1, which the
      hook never discards. The claim in `k`'s comment — that a failure keeps
      every row — was therefore untested in the only case where it can be
      broken. The damage is real: a failure on page 3 would silently delete the
      fifty rows of page 2 from a list the owner was reading.
    */
    stubPages(
      {
        '': { from: 0, count: PAGE_LIMIT, nextCursor: CURSOR_2 },
        [CURSOR_2]: { from: PAGE_LIMIT, count: PAGE_LIMIT, nextCursor: CURSOR_3 },
      },
      [CURSOR_3],
    );
    await mountList();

    await userEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => {
      expect(screen.getAllByTestId('title-name')).toHaveLength(PAGE_LIMIT * 2);
    });

    await userEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => {
      expect(screen.getByTestId('load-more-error')).toBeInTheDocument();
    });

    expect(screen.getAllByTestId('title-name')).toHaveLength(PAGE_LIMIT * 2);
    expect(screen.getByText('Title 50')).toBeInTheDocument();
  });

  it('T-UX-015o: changing the query discards the pages fetched under the old one', async () => {
    /*
      ⚠ PAGES 2..n DO NOT BELONG UNDER A NEW PAGE 1. A cursor is a position
      within one ordering; re-sorting the list re-fetches page 1 but leaves the
      accumulated rows untouched unless they are explicitly discarded. The
      result is a list whose first 50 rows obey the sort control and whose
      remaining rows obey the previous one — rows apparently duplicated and
      out of order, contradicting the control the owner just used. This is the
      silent desynchronisation REQ-101 exists to prevent, reached from the
      other direction: the URL is still the request, but the rendered rows are
      no longer only the URL's answer.
    */
    stubPages(TWO_PAGES);
    await mountList();
    await userEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => {
      expect(screen.getAllByTestId('title-name')).toHaveLength(PAGE_LIMIT + 10);
    });

    await userEvent.click(screen.getByTestId('sort-control'));

    await waitFor(() => {
      expect(screen.getAllByTestId('title-name')).toHaveLength(PAGE_LIMIT);
    });
  });

  it('T-UX-015p: the reconnect refetch discards pages fetched before it', async () => {
    /*
      ⚠ THE CASE THE QUERY KEY CANNOT SEE. `T-UX-015o` changes the sort, so the
      query string changes and a reset keyed on it alone is enough. A retry
      (`T-UX-018`) and the reconnect refetch (`T-UX-024`) both hand back a
      FRESH page 1 under the SAME query — and pages 2..n were fetched against
      the old one, from cursors cut out of a list that may have changed while
      the owner was offline. Left in place they render beneath rows they no
      longer follow.

      ⚠ This test exists because the mutation that removes `firstPage` from the
      reset's dependencies SURVIVED the rest of this file. The property was
      asserted in a comment in `useCursorPages` and enforced by nothing —
      exactly the shape of defect this suite keeps finding.
    */
    stubPages(TWO_PAGES);
    await mountList();
    await userEvent.click(screen.getByTestId('load-more'));
    await waitFor(() => {
      expect(screen.getAllByTestId('title-name')).toHaveLength(PAGE_LIMIT + 10);
    });

    // The real event `useOnline` listens for; there is no injection seam by
    // design (see `useOnline`'s header).
    await act(async () => {
      window.dispatchEvent(new Event('online'));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('title-name')).toHaveLength(PAGE_LIMIT);
    });
  });

  it('T-UX-015q: scrolling the sentinel into view loads the next page with no click', async () => {
    // The other half of §2.1 item 4. Every case above is carried by the
    // button, so without this the observer could be missing entirely and the
    // id would still be green.
    stubPages(TWO_PAGES);
    stubObserver();
    await mountList();

    const observer = FakeObserver.live();
    expect(observer).toBeDefined();
    await act(async () => {
      observer?.fire();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getAllByTestId('title-name')).toHaveLength(PAGE_LIMIT + 10);
    });
  });

  it('T-UX-015r: after a failure the observer stops, so a stuck sentinel cannot loop', async () => {
    /*
      ⚠ THE FAILURE MODE IS A DENIAL OF SERVICE AGAINST THE OWNER'S OWN APP.
      The sentinel remains in view once the list stops growing, so an observer
      left attached across a failure re-fires on every scroll and re-requests
      a failing page forever — against a single 0.25 vCPU replica
      (`minReplicas = 1`, ADR-0003), with no control that stops it. After a
      failure the retry must be the owner's explicit click.
    */
    stubPages(TWO_PAGES, [CURSOR_2]);
    stubObserver();
    await mountList();

    await act(async () => {
      FakeObserver.live()?.fire();
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('load-more-error')).toBeInTheDocument();
    });

    expect(FakeObserver.live()).toBeUndefined();
  });

  it('T-UX-015m: the cursor REPLACES any cursor already in the query', async () => {
    /*
      ⚠ `URLSearchParams.append` would build `?cursor=A&cursor=B`. Express reads
      a repeated parameter as an ARRAY, and the API's `decodeCursor` rejects a
      non-string outright — so page 3 would fail with `INVALID_CURSOR` every
      time, on precisely the lists long enough to have a page 3. Page 2 works,
      which is what makes it survive a manual test.
    */
    expect(withCursor('sort=date&cursor=A', 'B')).toBe('sort=date&cursor=B');
    expect(withCursor('', 'B')).toBe('cursor=B');
    expect(withCursor('services=netflix', 'B')).toBe('services=netflix&cursor=B');
  });
});
