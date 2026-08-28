/**
 * TASK-096 — the removal history page (`T-UI-009`, `T-UI-011`, `T-UX-071`,
 * `T-UX-072`, US-024, `ux-states.md` §7).
 *
 * ⚠ **THE CENTRAL CASE IS `T-UI-009a`: THE LOG IS NEVER DE-DUPLICATED.**
 * Every other list in this product collapses to one row per work, so a
 * `RemovedPage` that did the same would look consistent, pass a naive
 * "renders the removed titles" test, and quietly destroy the earlier removals
 * of a title that has come and gone more than once (product invariant 7).
 *
 * ⚠ **AND `T-UX-072a`: A FAILED LOAD IS NOT AN EMPTY LOG.** Rendering
 * "Nothing has been removed yet." because a fetch failed makes the product
 * assert something false about the owner's data in the exact place they came
 * to verify nothing was lost (US-024 AC-8).
 *
 * ⚠ **FINDING — a spec collision, reported not silently resolved.**
 * `specs/testing.md` US-024 AC-8 assigns `T-UX-072` to *"load failure renders
 * an error, not an empty view"*, while `ux-states.md` §7.3 assigns the same id
 * to the *no-search-results* empty state — and §7's state table has **no
 * load-failure row at all**. `specs/testing.md` carries the authoritative
 * AC→test mapping (NFR-003), so `T-UX-072` is the load failure here and the
 * no-search-results state is asserted under `T-UX-071`, whose own wording
 * (*"distinct from a no-search-results state"*) requires that comparison
 * anyway. `ux-states.md` §7 needs a load-failure row adding; that is a spec
 * change, not a code change, and is left to the owner.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RemovedPage, removalOrdinalLabel } from '../src/pages/RemovedPage';
import type { RemovedItem } from '../src/lib/apiClient';
import {
  REMOVED_CLEAR_SEARCH_LABEL,
  REMOVED_EMPTY_BODY,
  REMOVED_EMPTY_TITLE,
  REMOVED_LOAD_ERROR,
  REMOVED_VIEW_SUBTITLE,
  RETRY_LABEL,
} from '../src/copy';

function removed(overrides: Partial<RemovedItem> = {}): RemovedItem {
  return {
    listingId: 'lst_1',
    titleId: 'ttl_1',
    workIdentity: 'tmdb:movie:603',
    matchState: 'matched',
    name: 'The Matrix',
    mediaType: 'movie',
    releaseYear: 1999,
    posterPath: '/matrix.jpg',
    service: 'netflix',
    dateAdded: '2026-01-04',
    removedAt: '2026-03-11T09:30:00.000Z',
    removedByBatchId: '01J0000000000000000000BTCH',
    removedByGroupId: '01J0000000000000000000GRP1',
    removalOrdinal: 1,
    removalTotalForWork: 1,
    restorable: true,
    suppressed: false,
    ...overrides,
  };
}

/**
 * One work, removed three times — the shape US-024 AC-6 names explicitly, and
 * the shape every other view in this product would collapse.
 */
const THRICE_REMOVED: readonly RemovedItem[] = [
  removed({
    listingId: 'lst_a',
    removalOrdinal: 3,
    removalTotalForWork: 3,
    dateAdded: '2026-03-01',
    removedAt: '2026-03-11T09:30:00.000Z',
  }),
  removed({
    listingId: 'lst_b',
    removalOrdinal: 2,
    removalTotalForWork: 3,
    dateAdded: '2026-02-01',
    removedAt: '2026-02-14T09:30:00.000Z',
  }),
  removed({
    listingId: 'lst_c',
    removalOrdinal: 1,
    removalTotalForWork: 3,
    dateAdded: '2026-01-04',
    removedAt: '2026-01-20T09:30:00.000Z',
  }),
];

describe('the removal log is never de-duplicated — T-UI-009', () => {
  it('T-UI-009a: three removals of ONE work render as three rows', () => {
    render(<RemovedPage items={THRICE_REMOVED} />);

    const rows = screen.getAllByTestId('removed-row');
    expect(rows).toHaveLength(3);
    // ⚠ All three carry the SAME name and the same workIdentity — that is
    // exactly what makes de-duplication tempting and wrong.
    expect(screen.getAllByTestId('removed-name').map((el) => el.textContent)).toEqual([
      'The Matrix',
      'The Matrix',
      'The Matrix',
    ]);
  });

  it('T-UI-009b: each of those rows carries its own ordinal', () => {
    render(<RemovedPage items={THRICE_REMOVED} />);

    expect(screen.getAllByTestId('removed-ordinal').map((el) => el.textContent)).toEqual([
      'Removal 3 of 3',
      'Removal 2 of 3',
      'Removal 1 of 3',
    ]);
  });

  it('T-UI-009c: each row carries its OWN dates, not the newest removal\u2019s', () => {
    // ⚠ A de-duplicating render that kept three rows but read the dates from
    // one item would pass T-UI-009a and T-UI-009b and still lose the history.
    render(<RemovedPage items={THRICE_REMOVED} />);

    expect(screen.getAllByTestId('removed-date-removed').map((el) => el.textContent)).toEqual([
      'Removed 11 Mar 2026',
      'Removed 14 Feb 2026',
      'Removed 20 Jan 2026',
    ]);
    expect(screen.getAllByTestId('removed-date-added').map((el) => el.textContent)).toEqual([
      'Added to nextup 1 Mar 2026',
      'Added to nextup 1 Feb 2026',
      'Added to nextup 4 Jan 2026',
    ]);
  });

  it('T-UI-009d: a work removed once shows no ordinal chip', () => {
    render(<RemovedPage items={[removed()]} />);

    expect(screen.queryByTestId('removed-ordinal')).toBeNull();
    expect(removalOrdinalLabel({ removalOrdinal: 1, removalTotalForWork: 1 })).toBeNull();
  });

  it('T-UI-009e: the service is named on every row', () => {
    // Two removals of the SAME work from DIFFERENT services is the case a
    // work-keyed render loses entirely, and the owner cannot act on
    // "removed twice" without knowing from where.
    render(
      <RemovedPage
        items={[removed({ listingId: 'lst_n' }), removed({ listingId: 'lst_m', service: 'max' })]}
      />,
    );

    expect(screen.getAllByTestId('removed-service').map((el) => el.textContent)).toEqual([
      'Netflix',
      'Max',
    ]);
  });

  it('T-UI-009g: each row has its own REACT identity, not just its own content', () => {
    // ⚠ A survivor caught this. Keying the list on `workIdentity` still
    // renders three correct-looking rows today — content is prop-driven — so
    // every assertion above passes while all three share one React identity.
    // That is latent, not harmless: TASK-099 gives each row its own restore
    // state, and duplicate keys make React carry that state to the wrong row
    // when the list changes. The duplicate-key error is the only observable
    // symptom before then, so it is what this asserts.
    const errors: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args);
    });

    try {
      render(<RemovedPage items={THRICE_REMOVED} />);
    } finally {
      spy.mockRestore();
    }

    expect(errors.map((args) => String(args[0])).join('\n')).not.toMatch(/same key/i);
  });

  it('T-UI-009f: an unmatched removal still renders, with a poster placeholder', () => {
    // `name` is resolved server-side from the raw extracted text, so the row
    // must not depend on TMDB metadata being present.
    render(
      <RemovedPage
        items={[removed({ name: 'SOME UNREADABLE THING', posterPath: null, releaseYear: null })]}
      />,
    );

    const row = screen.getByTestId('removed-row');
    expect(within(row).getByTestId('removed-name')).toHaveTextContent('SOME UNREADABLE THING');
    expect(within(row).getByTestId('removed-poster-placeholder')).toBeInTheDocument();
    expect(within(row).queryByTestId('removed-year')).toBeNull();
  });
});

describe('the historical-log framing — T-UI-011', () => {
  it('T-UI-011a: the subtitle is rendered verbatim', () => {
    render(<RemovedPage items={[removed()]} />);

    expect(screen.getByTestId('removed-subtitle')).toHaveTextContent(REMOVED_VIEW_SUBTITLE);
  });

  it('T-UI-011b: it is present in the EMPTY and FAILED states too', () => {
    // ⚠ The framing matters most when there is nothing to see: without it an
    // empty log reads as loss rather than as a permanent record.
    const { rerender } = render(<RemovedPage items={[]} />);
    expect(screen.getByTestId('removed-subtitle')).toBeInTheDocument();

    rerender(<RemovedPage loadFailed />);
    expect(screen.getByTestId('removed-subtitle')).toBeInTheDocument();

    rerender(<RemovedPage loading />);
    expect(screen.getByTestId('removed-subtitle')).toBeInTheDocument();
  });
});

describe('the two empty states are distinct — T-UX-071', () => {
  it('T-UX-071a: never removed anything', () => {
    render(<RemovedPage items={[]} />);

    expect(screen.getByTestId('removed-empty')).toHaveTextContent(REMOVED_EMPTY_TITLE);
    expect(screen.getByTestId('removed-empty')).toHaveTextContent(REMOVED_EMPTY_BODY);
    expect(screen.queryByTestId('removed-no-matches')).toBeNull();
  });

  it('T-UX-071b: a search that matched nothing says so, and quotes the search', () => {
    // ⚠ THE DISCRIMINATING CASE. Same empty `items`; only the applied query
    // differs. A page that keyed the empty state on `items.length` alone would
    // tell an owner who mistyped that their removal history is empty — the one
    // thing REQ-028 promises can never be true.
    render(<RemovedPage items={[]} query="matrx" />);

    expect(screen.getByTestId('removed-no-matches')).toHaveTextContent(
      'No removals match \u201cmatrx\u201d.',
    );
    expect(screen.queryByTestId('removed-empty')).toBeNull();
  });

  it('T-UX-071c: the no-results state offers a way back out of the search', async () => {
    const onClearSearch = vi.fn();
    render(<RemovedPage items={[]} query="matrx" onClearSearch={onClearSearch} />);

    await userEvent.click(screen.getByRole('button', { name: REMOVED_CLEAR_SEARCH_LABEL }));
    expect(onClearSearch).toHaveBeenCalledTimes(1);
  });

  it('T-UX-071d: whitespace is not a search', () => {
    render(<RemovedPage items={[]} query="   " />);

    expect(screen.getByTestId('removed-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('removed-no-matches')).toBeNull();
  });
});

describe('a failed load is an error, not an empty log — T-UX-072', () => {
  it('T-UX-072a: the failure renders an alert and NO empty state', () => {
    render(<RemovedPage loadFailed />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(REMOVED_LOAD_ERROR);
    expect(screen.queryByTestId('removed-empty')).toBeNull();
    expect(screen.queryByTestId('removed-list')).toBeNull();
  });

  it('T-UX-072b: the failure wins even when rows are already held', () => {
    // ⚠ A stale-but-rendered list under a failed refresh is a list the owner
    // cannot tell is stale. The error must not be a state the data can mask.
    render(<RemovedPage items={THRICE_REMOVED} loadFailed />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('removed-row')).toBeNull();
  });

  it('T-UX-072c: retry is offered and calls back', async () => {
    const onRetry = vi.fn();
    render(<RemovedPage loadFailed onRetry={onRetry} />);

    await userEvent.click(screen.getByRole('button', { name: RETRY_LABEL }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('T-UX-072d: loading is a status, and is not the empty state either', () => {
    render(<RemovedPage loading />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('removed-empty')).toBeNull();
  });
});
