/**
 * `T-UX-015` — `specs/ux-states.md` §2.6 **Partial**: the count reads
 * *"Showing 50 of at least 50"* and **no total is fabricated** (there is no
 * count query — NFR-018).
 *
 * ⚠ THIS ASSERTS A LIE THE PRODUCT WAS TELLING, not a missing nicety. Probed
 * against the real `ListRoute` with a full page and a live
 * `nextCursor`, the bar rendered **"Showing 50 of 50"** — a fabricated total,
 * in the one place §2.6 forbids it in bold. An owner with 300 titles was told
 * they had 50. That is the data-loss misreading US-019 AC-5 exists to prevent,
 * reached by arithmetic rather than by an empty state, and it is worse than an
 * empty state because it looks like a fact rather than like a message.
 *
 * ⚠ SCOPE. §2.6 also specifies the load-more sentinel, which is NOT built:
 * `nextCursor` is read here for the first time, and no code advances it. That
 * is `specs/ui.md` §2.1 item 4 and is separate work. This file deliberately
 * asserts only the half that can be true today — telling the truth about the
 * number — because the alternative was leaving the falsehood on screen until
 * pagination ships. A test that demanded the sentinel too would have to be
 * skipped, and a skipped test guards nothing.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AT_LEAST_PREFIX } from '../src/copy';
import { FilterBar } from '../src/components/FilterBar';
import { ListRoute } from '../src/containers/ListRoute';

const PAGE_LIMIT = 50;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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
    badges: [
      {
        service: 'netflix',
        listingId: `l${String(n)}`,
        dateAdded: '2026-01-01T00:00:00.000Z',
      },
    ],
    dateAdded: '2026-01-01T00:00:00.000Z',
    state: 'active',
    metadataStale: false,
  };
}

/**
 * Stubs the network at `fetch` rather than at the client.
 *
 * ⚠ Deliberate: the defect lived in whether `nextCursor` was READ at all, and
 * a hand-built client stub is a second statement of the wire shape that can
 * agree with the test while disagreeing with the server.
 */
function stubTitles(count: number, nextCursor: string | null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: unknown) => {
      const url = String(input);
      let body: unknown = {};
      if (url.includes('/api/titles')) {
        body = {
          items: Array.from({ length: count }, (_, i) => wireTitle(i)),
          nextCursor,
          limit: PAGE_LIMIT,
        };
      } else if (url.includes('/api/suppressions')) body = { items: [] };
      else if (url.includes('/api/removed')) body = { items: [], nextCursor: null, limit: 50 };
      else if (url.includes('/api/service-state')) body = { services: [] };
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }),
  );
}

async function mountList(): Promise<void> {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ListRoute />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(screen.getAllByTestId('title-name').length).toBeGreaterThan(0);
  });
}

describe('T-UX-015 the list count never fabricates a total', () => {
  it('T-UX-015a: a full page with a next cursor is reported as a LOWER BOUND', async () => {
    stubTitles(PAGE_LIMIT, 'CURSOR_PAGE_2');
    await mountList();

    expect(screen.getByTestId('filter-count')).toHaveTextContent(
      `Showing ${String(PAGE_LIMIT)} of ${AT_LEAST_PREFIX}${String(PAGE_LIMIT)}`,
    );
  });

  it('T-UX-015b: the exact fabricated string the product used to render is gone', async () => {
    // Named literally, because "of 50" is what an owner with 300 titles read.
    // Asserting only the presence of "at least" would still pass if the bar
    // rendered both numbers, which is the likeliest half-fix.
    stubTitles(PAGE_LIMIT, 'CURSOR_PAGE_2');
    await mountList();

    expect(screen.getByTestId('filter-count').textContent).not.toBe(
      `Showing ${String(PAGE_LIMIT)} of ${String(PAGE_LIMIT)}`,
    );
  });

  it('T-UX-015c: a SHORT page with no cursor still states a flat total', async () => {
    // The counterweight. A fix that qualified every count would be no more
    // truthful than the bug — it would hedge about a number the SPA does know,
    // and "at least 3" on a three-item list reads as a defect.
    stubTitles(3, null);
    await mountList();

    expect(screen.getByTestId('filter-count')).toHaveTextContent('Showing 3 of 3');
    expect(screen.getByTestId('filter-count').textContent).not.toContain(AT_LEAST_PREFIX);
  });

  it('T-UX-015d: the qualifier joins the number with a space', async () => {
    // The trailing space lives in the constant and is interpolated directly
    // before the digits, so losing it yields "at least50" — a defect that
    // survives review because the constant reads correctly on its own line.
    render(
      <MemoryRouter>
        <FilterBar shown={50} total={50} totalIsLowerBound />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('filter-count').textContent).toBe('Showing 50 of at least 50');
  });

  it('T-UX-015e: the bound defaults to off, so an uninformed caller cannot hedge', async () => {
    // `FilterBar` is rendered by more than one caller. A default of `true`
    // would spread the hedge to every screen that had not been updated.
    render(
      <MemoryRouter>
        <FilterBar shown={7} total={7} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('filter-count').textContent).toBe('Showing 7 of 7');
  });
});
