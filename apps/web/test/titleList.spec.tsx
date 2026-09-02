/**
 * TASK-038 — the combined list itself (`specs/ui.md` §2.1,
 * `specs/ux-states.md` §2.7 Populated).
 *
 * Tests: `T-UX-016`.
 *
 * ⚠ WHY THIS FILE EXISTS AT ALL. `TitleList.tsx` opens with a load-bearing
 * instruction — *"THIS COMPONENT DOES NOT SORT, GROUP OR DEDUPE. Ordering is
 * the server's and the work-level collapse is `GET /api/titles`'. A
 * client-side `sort()` here would silently disagree with the cursor the API
 * pages on, so page 2 would interleave wrongly with page 1 and the owner would
 * see rows apparently jump position."* — and until now **no test imported
 * `TitleList` or queried `title-list` at all**. The rule was documented,
 * justified, and enforced by nothing.
 *
 * That is the failure mode this repository keeps producing, and the reason
 * `T-UX-016` is worth more than a smoke test: every assertion below is about
 * something the component must NOT do. A client-side reorder or collapse is
 * invisible on one screenful of test data and only misbehaves at the page
 * boundary, against a cursor, on the owner's real list.
 *
 * Product invariant 6 is what it protects: title-level date order is the
 * EARLIEST date-added across the title's listings, computed server-side in
 * `packages/domain/src/ordering.ts`. A component that re-sorts by anything it
 * can see locally — `sortDateAdded`, `name`, a badge date — produces an order
 * that looks plausible and is wrong.
 */

import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { TitleList } from '../src/components/TitleList';
import type { TitleListItem } from '../src/components/TitleRow';

const BASE: TitleListItem = {
  titleId: '01J8ZC',
  workIdentity: 'tmdb:movie:438631',
  matchState: 'matched',
  name: 'Dune',
  mediaType: 'movie',
  releaseYear: 2021,
  genres: ['Science Fiction'],
  runtimeMinutes: 155,
  posterPath: null,
  badges: [{ service: 'netflix', listingId: '01J8ZD', dateAdded: '2026-04-02' }],
  sortDateAdded: '2026-04-02',
  dateAddedLabel: 'Added to nextup 2 Apr 2026',
};

function item(overrides: Partial<TitleListItem>): TitleListItem {
  return { ...BASE, ...overrides };
}

function renderList(items: readonly TitleListItem[]): HTMLElement {
  render(<TitleList items={items} />, { wrapper: MemoryRouter });
  return screen.getByTestId('title-list');
}

/** The rendered order, read off the DOM rather than off the input. */
function renderedIds(list: HTMLElement): string[] {
  return [...list.querySelectorAll('[data-testid^="title-row-"]')].map(
    (row) => row.getAttribute('data-testid')?.replace('title-row-', '') ?? '',
  );
}

describe('T-UX-016 - the populated list renders server order, one row per title, and collapses nothing', () => {
  it('T-UX-016a renders every item, in the exact order received', () => {
    /**
     * Deliberately adversarial: the ids, the names and the dates each imply a
     * DIFFERENT order from the one the server sent. A client-side sort by any
     * locally visible field therefore produces a distinguishable sequence, and
     * a list that happens to arrive pre-sorted cannot make this pass by luck.
     */
    const items = [
      item({ titleId: 'c', name: 'Arrival', sortDateAdded: '2026-01-01' }),
      item({ titleId: 'a', name: 'Zodiac', sortDateAdded: '2026-12-31' }),
      item({ titleId: 'b', name: 'Micmacs', sortDateAdded: '2026-06-15' }),
    ];

    expect(renderedIds(renderList(items))).toEqual(['c', 'a', 'b']);
  });

  it('T-UX-016b renders ONE row per title however many services carry it', () => {
    /**
     * The product's headline promise is one row per title with a badge per
     * service. Rendering per LISTING instead would duplicate exactly the rows
     * the deduplication exists to merge - and would look correct for every
     * single-service title, which is most of them.
     */
    const list = renderList([
      item({
        titleId: 'both',
        badges: [
          { service: 'netflix', listingId: 'L1', dateAdded: '2026-04-02' },
          { service: 'max', listingId: 'L2', dateAdded: '2026-06-11' },
        ],
      }),
    ]);

    expect(renderedIds(list)).toEqual(['both']);
    const row = within(list).getByTestId('title-row-both');
    expect(within(row).getByTestId('badge-netflix')).toBeInTheDocument();
    expect(within(row).getByTestId('badge-max')).toBeInTheDocument();
  });

  it('T-UX-016c never collapses two distinct titles that happen to share a name', () => {
    /**
     * The collapse is the SERVER's, keyed on canonical work identity (product
     * invariant 1 and 7). A remake and its original are two works with one
     * name; a client-side dedupe by name would silently delete a row the owner
     * really has, and the list gives them no way to notice.
     */
    const list = renderList([
      item({ titleId: 'orig', workIdentity: 'tmdb:movie:1', name: 'Dune', releaseYear: 1984 }),
      item({ titleId: 'remake', workIdentity: 'tmdb:movie:2', name: 'Dune', releaseYear: 2021 }),
    ]);

    expect(renderedIds(list)).toEqual(['orig', 'remake']);
  });

  it('T-UX-016d renders an empty list as an empty list, not as a missing one', () => {
    /**
     * The empty STATE is `ListPage`'s (§2.4/§2.5) and is asserted there. What
     * matters here is that the container still renders, so the page can put its
     * own message beside a list that is genuinely empty rather than having to
     * distinguish "no rows" from "no list".
     */
    const list = renderList([]);

    expect(list).toBeInTheDocument();
    expect(renderedIds(list)).toEqual([]);
  });
});
