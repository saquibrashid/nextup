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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RemovedPage, removalOrdinalLabel, formatDateShort } from '../src/pages/RemovedPage';
import type { RemovedItem, RestoreResponse } from '../src/lib/apiClient';
import { ApiError } from '../src/lib/apiClient';
import {
  OFFLINE_DISABLED_REASON,
  REMOVED_CLEAR_SEARCH_LABEL,
  REMOVED_EMPTY_BODY,
  REMOVED_EMPTY_TITLE,
  REMOVED_LOADING,
  REMOVED_LOAD_ERROR,
  REMOVED_VIEW_SUBTITLE,
  RESTORE_ALREADY_ACTIVE,
  RESTORE_DUPLICATE_BODY,
  RESTORE_DUPLICATE_KEEP_BOTH,
  RESTORE_LABEL,
  RESTORE_SUBMITTING_LABEL,
  RESTORE_SUPPRESSED_ACTION,
  RESTORE_SUPPRESSED_BODY,
  RETRY_LABEL,
} from '../src/copy';

function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
  fireEvent(window, new Event(online ? 'online' : 'offline'));
}

afterEach(() => {
  setNavigatorOnline(true);
});

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

  it('T-UI-009d: a work removed once still shows "Removal 1 of 1"', () => {
    // ⚠ THIS CASE USED TO ASSERT THE OPPOSITE, AND THAT IS THE FINDING. It
    // pinned `removalOrdinalLabel`'s null-at-one behaviour, which contradicts
    // `specs/testing.md` §5 step 7 (which names "Removal 1 of 1"), `ui.md`
    // ("each row: … an ordinal chip") and `ux-states.md` §7.5. A test written
    // to ratify the implementation instead of the spec makes the divergence
    // invisible: the suite stays green precisely because it agrees with the
    // defect.
    //
    // The singleton is the case the log framing matters MOST for — `/removed`
    // is a historical log, not a recycle bin (L1/A33), and "Removal 1 of 1" is
    // what says this row is one entry in a log that can hold more.
    render(<RemovedPage items={[removed()]} />);

    expect(screen.getByTestId('removed-ordinal').textContent).toBe('Removal 1 of 1');
    expect(removalOrdinalLabel({ removalOrdinal: 1, removalTotalForWork: 1 })).toBe(
      'Removal 1 of 1',
    );
    // A nonsensical total is a data fault, not a display choice, and is the
    // ONLY case that still renders no chip.
    expect(removalOrdinalLabel({ removalOrdinal: 0, removalTotalForWork: 0 })).toBeNull();
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

describe('loading state — T-UX-070', () => {
  it('T-UX-070a: the removed view renders row skeletons while loading', () => {
    render(<RemovedPage loading />);

    expect(screen.getByTestId('removed-loading')).toHaveAccessibleName(REMOVED_LOADING);
    expect(screen.getAllByTestId('removed-row-skeleton')).toHaveLength(3);
    expect(screen.queryByTestId('removed-empty')).toBeNull();
    expect(screen.queryByTestId('removed-row')).toBeNull();
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

// ── TASK-099: Restore controls (§7.5–7.10) ───────────────────────────────

function restoreResponse(overrides: Partial<RestoreResponse> = {}): RestoreResponse {
  return {
    listingId: 'lst_1',
    titleId: 'ttl_1',
    state: 'active',
    dateAdded: '2026-01-04',
    titleState: 'active',
    sortDateAdded: '2026-01-04',
    ...overrides,
  };
}

function apiError(code: string, message: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError(code, 409, message, details);
}

describe('the restore control — T-RES-016 / T-UI-009', () => {
  it('T-RES-016a: every row has a restore button', () => {
    render(
      <RemovedPage
        items={[removed(), removed({ listingId: 'lst_2' })]}
        onRestore={() => Promise.resolve(restoreResponse())}
        onUnsuppress={() => Promise.resolve()}
      />,
    );

    const buttons = screen.getAllByTestId('restore-button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveTextContent(RESTORE_LABEL);
  });
});

describe('submitting state — T-UX-074', () => {
  it('T-UX-074a: clicking Restore dims the row with a spinner', async () => {
    // The onRestore never resolves, so we stay in submitting state.
    const onRestore = vi.fn(
      () =>
        new Promise<RestoreResponse>(() => {
          /* never resolves */
        }),
    );
    render(
      <RemovedPage
        items={[removed()]}
        onRestore={onRestore}
        onUnsuppress={() => Promise.resolve()}
      />,
    );

    await userEvent.click(screen.getByTestId('restore-button'));

    expect(screen.getByTestId('restore-submitting')).toHaveTextContent(RESTORE_SUBMITTING_LABEL);
    expect(screen.getByTestId('restore-submitting')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByTestId('restore-button')).toBeNull();
  });
});

describe('success state — T-UX-075', () => {
  it('T-UX-075a: announces the original date on success', async () => {
    const onRestore = vi.fn(() => Promise.resolve(restoreResponse({ dateAdded: '2026-01-04' })));
    render(
      <RemovedPage
        items={[removed({ name: 'The Matrix', service: 'netflix', dateAdded: '2026-01-04' })]}
        onRestore={onRestore}
        onUnsuppress={() => Promise.resolve()}
      />,
    );

    await userEvent.click(screen.getByTestId('restore-button'));

    const status = await screen.findByTestId('restore-success-announcement');
    expect(status).toHaveAttribute('role', 'status');
    // ⚠ The original date must be named — US-025 AC-2.
    expect(status.textContent).toContain('4 Jan 2026');
    expect(status.textContent).toContain('The Matrix');
    expect(status.textContent).toContain('Netflix');
  });

  it('T-UX-075b: the row is dismissed after success', async () => {
    const onRestore = vi.fn(() => Promise.resolve(restoreResponse()));
    render(
      <RemovedPage
        items={[removed()]}
        onRestore={onRestore}
        onUnsuppress={() => Promise.resolve()}
      />,
    );

    expect(screen.getAllByTestId('removed-row')).toHaveLength(1);
    await userEvent.click(screen.getByTestId('restore-button'));

    expect(screen.queryByTestId('removed-row')).toBeNull();
  });

  it('T-UX-075c: formatDateShort converts YYYY-MM-DD to D Mon YYYY', () => {
    expect(formatDateShort('2026-01-04')).toBe('4 Jan 2026');
    expect(formatDateShort('2026-12-25')).toBe('25 Dec 2026');
  });
});

describe('409 DUPLICATE_WORK_IDENTITY dialog — T-UX-034', () => {
  it('T-UX-034a: shows the keep-both dialog on DUPLICATE_WORK_IDENTITY', async () => {
    const onRestore = vi
      .fn()
      .mockRejectedValueOnce(apiError('DUPLICATE_WORK_IDENTITY', 'Duplicate'))
      .mockResolvedValueOnce(restoreResponse());

    render(
      <RemovedPage
        items={[removed({ name: 'The Matrix' })]}
        onRestore={onRestore}
        onUnsuppress={() => Promise.resolve()}
      />,
    );

    await userEvent.click(screen.getByTestId('restore-button'));

    const dialog = await screen.findByTestId('restore-duplicate-dialog');
    expect(dialog.textContent).toContain(RESTORE_DUPLICATE_BODY.replace('{name}', 'The Matrix'));
    expect(screen.getByTestId('restore-keep-both')).toHaveTextContent(RESTORE_DUPLICATE_KEEP_BOTH);
  });

  it('T-UX-034b: Keep both retries with confirmDuplicate: true', async () => {
    const onRestore = vi
      .fn()
      .mockRejectedValueOnce(apiError('DUPLICATE_WORK_IDENTITY', 'Duplicate'))
      .mockResolvedValueOnce(restoreResponse());

    render(
      <RemovedPage
        items={[removed()]}
        onRestore={onRestore}
        onUnsuppress={() => Promise.resolve()}
      />,
    );

    await userEvent.click(screen.getByTestId('restore-button'));
    await screen.findByTestId('restore-duplicate-dialog');

    await userEvent.click(screen.getByTestId('restore-keep-both'));

    // The second call must have confirmDuplicate: true
    expect(onRestore).toHaveBeenCalledTimes(2);
    expect(onRestore.mock.calls[1]).toEqual(['lst_1', { confirmDuplicate: true }]);
  });

  it('T-UX-034c: Cancel returns to idle', async () => {
    const onRestore = vi.fn().mockRejectedValue(apiError('DUPLICATE_WORK_IDENTITY', 'Duplicate'));

    render(
      <RemovedPage
        items={[removed()]}
        onRestore={onRestore}
        onUnsuppress={() => Promise.resolve()}
      />,
    );

    await userEvent.click(screen.getByTestId('restore-button'));
    await screen.findByTestId('restore-duplicate-dialog');

    await userEvent.click(screen.getByTestId('restore-duplicate-cancel'));

    expect(screen.getByTestId('restore-button')).toBeInTheDocument();
    expect(screen.queryByTestId('restore-duplicate-dialog')).toBeNull();
  });
});

describe('409 WORK_SUPPRESSED dialog — T-UX-035', () => {
  it('T-UX-035a: shows the unsuppress dialog on WORK_SUPPRESSED', async () => {
    const onRestore = vi.fn().mockRejectedValue(
      apiError('WORK_SUPPRESSED', 'Suppressed', {
        unsuppressHref: '/api/suppressions/sup_99/unsuppress',
      }),
    );

    render(
      <RemovedPage
        items={[removed({ name: 'The Matrix' })]}
        onRestore={onRestore}
        onUnsuppress={() => Promise.resolve()}
      />,
    );

    await userEvent.click(screen.getByTestId('restore-button'));

    const dialog = await screen.findByTestId('restore-suppressed-dialog');
    expect(dialog.textContent).toContain(RESTORE_SUPPRESSED_BODY.replace('{name}', 'The Matrix'));
    expect(screen.getByTestId('restore-unsuppress-action')).toHaveTextContent(
      RESTORE_SUPPRESSED_ACTION,
    );
  });

  it('T-UX-035b: Stop ignoring calls unsuppress THEN retries restore', async () => {
    const callOrder: string[] = [];
    const onUnsuppress = vi.fn(() => {
      callOrder.push('unsuppress');
      return Promise.resolve();
    });
    const onRestore = vi
      .fn()
      .mockImplementationOnce(() => {
        callOrder.push('restore-1');
        return Promise.reject(
          apiError('WORK_SUPPRESSED', 'Suppressed', {
            unsuppressHref: '/api/suppressions/sup_99/unsuppress',
          }),
        );
      })
      .mockImplementationOnce(() => {
        callOrder.push('restore-2');
        return Promise.resolve(restoreResponse());
      });

    render(<RemovedPage items={[removed()]} onRestore={onRestore} onUnsuppress={onUnsuppress} />);

    await userEvent.click(screen.getByTestId('restore-button'));
    await screen.findByTestId('restore-suppressed-dialog');

    await userEvent.click(screen.getByTestId('restore-unsuppress-action'));

    // Wait for the success announcement — proof that the whole flow completed.
    await screen.findByTestId('restore-success-announcement');

    expect(onUnsuppress).toHaveBeenCalledWith('sup_99');
    expect(callOrder).toEqual(['restore-1', 'unsuppress', 'restore-2']);
  });

  it('T-UX-035c: Cancel returns to idle', async () => {
    const onRestore = vi.fn().mockRejectedValue(
      apiError('WORK_SUPPRESSED', 'Suppressed', {
        unsuppressHref: '/api/suppressions/sup_99/unsuppress',
      }),
    );

    render(
      <RemovedPage
        items={[removed()]}
        onRestore={onRestore}
        onUnsuppress={() => Promise.resolve()}
      />,
    );

    await userEvent.click(screen.getByTestId('restore-button'));
    await screen.findByTestId('restore-suppressed-dialog');

    await userEvent.click(screen.getByTestId('restore-suppressed-cancel'));

    expect(screen.getByTestId('restore-button')).toBeInTheDocument();
    expect(screen.queryByTestId('restore-suppressed-dialog')).toBeNull();
  });
});

describe('409 LISTING_NOT_REMOVED — T-UX-076', () => {
  it('T-UX-076a: shows already-active message and refresh', async () => {
    const onRestore = vi.fn().mockRejectedValue(apiError('LISTING_NOT_REMOVED', 'Already active'));

    render(
      <RemovedPage
        items={[removed({ name: 'The Matrix' })]}
        onRestore={onRestore}
        onUnsuppress={() => Promise.resolve()}
      />,
    );

    await userEvent.click(screen.getByTestId('restore-button'));

    const el = await screen.findByTestId('restore-already-active');
    expect(el.textContent).toContain(RESTORE_ALREADY_ACTIVE.replace('{name}', 'The Matrix'));
    expect(screen.getByTestId('restore-refresh')).toBeInTheDocument();
  });

  describe('offline state — T-UX-003 / §7.11', () => {
    it('T-UX-003h: restore is disabled offline with a visible reason, and rows remain readable', async () => {
      setNavigatorOnline(true);
      render(
        <RemovedPage
          items={[removed()]}
          onRestore={() => Promise.resolve(restoreResponse())}
          onUnsuppress={() => Promise.resolve()}
        />,
      );

      expect(screen.getByTestId('removed-name')).toHaveTextContent('The Matrix');
      expect(screen.getByTestId('restore-button')).toBeEnabled();

      setNavigatorOnline(false);

      await waitFor(() => {
        expect(screen.getByTestId('restore-button')).toBeDisabled();
      });
      expect(screen.getByText(OFFLINE_DISABLED_REASON)).toBeVisible();
      expect(screen.getByTestId('removed-name')).toHaveTextContent('The Matrix');

      setNavigatorOnline(true);

      await waitFor(() => {
        expect(screen.getByTestId('restore-button')).toBeEnabled();
      });
      expect(screen.queryByText(OFFLINE_DISABLED_REASON)).not.toBeInTheDocument();
    });

    it('T-UX-003i: Keep both is disabled if duplicate confirmation is already open when the network drops', async () => {
      setNavigatorOnline(true);
      const onRestore = vi.fn().mockRejectedValue(apiError('DUPLICATE_WORK_IDENTITY', 'Duplicate'));

      render(
        <RemovedPage
          items={[removed({ name: 'The Matrix' })]}
          onRestore={onRestore}
          onUnsuppress={() => Promise.resolve()}
        />,
      );

      await userEvent.click(screen.getByTestId('restore-button'));
      await screen.findByTestId('restore-duplicate-dialog');
      expect(screen.getByTestId('restore-keep-both')).toBeEnabled();

      setNavigatorOnline(false);

      await waitFor(() => {
        expect(screen.getByTestId('restore-keep-both')).toBeDisabled();
      });
      expect(screen.getByText(OFFLINE_DISABLED_REASON)).toBeVisible();
      expect(screen.getByTestId('restore-duplicate-cancel')).toBeEnabled();

      setNavigatorOnline(true);

      await waitFor(() => {
        expect(screen.getByTestId('restore-keep-both')).toBeEnabled();
      });
      expect(screen.queryByText(OFFLINE_DISABLED_REASON)).not.toBeInTheDocument();
    });

    it('T-UX-003j: Stop ignoring and continue is disabled if the suppressed dialog is already open when the network drops', async () => {
      setNavigatorOnline(true);
      const onRestore = vi.fn().mockRejectedValue(
        apiError('WORK_SUPPRESSED', 'Suppressed', {
          unsuppressHref: '/api/suppressions/sup_99/unsuppress',
        }),
      );

      render(
        <RemovedPage
          items={[removed({ name: 'The Matrix' })]}
          onRestore={onRestore}
          onUnsuppress={() => Promise.resolve()}
        />,
      );

      await userEvent.click(screen.getByTestId('restore-button'));
      await screen.findByTestId('restore-suppressed-dialog');
      expect(screen.getByTestId('restore-unsuppress-action')).toBeEnabled();

      setNavigatorOnline(false);

      await waitFor(() => {
        expect(screen.getByTestId('restore-unsuppress-action')).toBeDisabled();
      });
      expect(screen.getByText(OFFLINE_DISABLED_REASON)).toBeVisible();
      expect(screen.getByTestId('restore-suppressed-cancel')).toBeEnabled();

      setNavigatorOnline(true);

      await waitFor(() => {
        expect(screen.getByTestId('restore-unsuppress-action')).toBeEnabled();
      });
      expect(screen.queryByText(OFFLINE_DISABLED_REASON)).not.toBeInTheDocument();
    });

    it('T-UX-003k: an in-flight restore keeps its submitting state and shows no offline reason', async () => {
      setNavigatorOnline(true);
      const onRestore = vi.fn(
        () =>
          new Promise<RestoreResponse>(() => {
            /* keep the row in the submitting state */
          }),
      );

      render(
        <RemovedPage
          items={[removed()]}
          onRestore={onRestore}
          onUnsuppress={() => Promise.resolve()}
        />,
      );

      await userEvent.click(screen.getByTestId('restore-button'));
      expect(await screen.findByTestId('restore-submitting')).toHaveTextContent(
        RESTORE_SUBMITTING_LABEL,
      );

      setNavigatorOnline(false);

      expect(screen.getByTestId('restore-submitting')).toHaveTextContent(RESTORE_SUBMITTING_LABEL);
      expect(screen.queryByText(OFFLINE_DISABLED_REASON)).not.toBeInTheDocument();
    });

    it('T-UX-003l: Refresh is disabled offline because it would trigger a document reload', async () => {
      setNavigatorOnline(true);
      const onRestore = vi
        .fn()
        .mockRejectedValue(apiError('LISTING_NOT_REMOVED', 'Already active'));

      render(
        <RemovedPage
          items={[removed({ name: 'The Matrix' })]}
          onRestore={onRestore}
          onUnsuppress={() => Promise.resolve()}
        />,
      );

      await userEvent.click(screen.getByTestId('restore-button'));
      await screen.findByTestId('restore-already-active');
      expect(screen.getByTestId('restore-refresh')).toBeEnabled();

      setNavigatorOnline(false);

      await waitFor(() => {
        expect(screen.getByTestId('restore-refresh')).toBeDisabled();
      });
      expect(screen.getByText(OFFLINE_DISABLED_REASON)).toBeVisible();

      setNavigatorOnline(true);

      await waitFor(() => {
        expect(screen.getByTestId('restore-refresh')).toBeEnabled();
      });
    });
  });
});
