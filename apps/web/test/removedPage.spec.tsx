/**
 * TASK-096 / TASK-099 — RemovedPage component tests.
 *
 * T-UI-009: Three removals of one work → three rows with ordinals.
 * T-UI-011: REMOVED_VIEW_SUBTITLE is rendered.
 * T-RES-016: Each removed row has a Restore control; suppressed work drives
 *             the un-suppress-first flow, not a bare error.
 *
 * These are COMPONENT tests. They do not call the real API. Every test
 * injects props; the assertions are about rendering and interaction only.
 *
 * Restore stays an EXPLICIT user action (product invariant 7). No test here
 * asserts automatic restore; every restore assertion starts with a button press.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { RemovedPage } from '../src/pages/RemovedPage';
import type { RemovedItem } from '../src/lib/apiClient';
import { ApiError } from '../src/lib/apiClient';
import { REMOVED_VIEW_SUBTITLE } from '../src/copy';

function makeItem(overrides?: Partial<RemovedItem>): RemovedItem {
  return {
    listingId: 'listing-001',
    titleId: 'title-001',
    workIdentity: 'tmdb:movie:123',
    matchState: 'matched',
    name: 'The Test Movie',
    mediaType: 'movie',
    releaseYear: 2023,
    posterPath: null,
    service: 'netflix',
    dateAdded: '2024-01-01',
    removedAt: '2024-06-01T00:00:00.000Z',
    removedByBatchId: 'batch-001',
    removedByGroupId: null,
    removalOrdinal: 1,
    removalTotalForWork: 1,
    suppressed: false,
    restorable: true,
    ...overrides,
  };
}

describe('T-UI-011 — REMOVED_VIEW_SUBTITLE', () => {
  it('T-UI-011a: renders REMOVED_VIEW_SUBTITLE verbatim', () => {
    render(<RemovedPage />);
    expect(screen.getByTestId('removed-subtitle').textContent).toBe(REMOVED_VIEW_SUBTITLE);
  });
});

describe('T-UI-009 — three removals of one work are three rows with ordinals', () => {
  it('T-UI-009a: renders three rows for three removals of the same work', () => {
    const items = [
      makeItem({ listingId: 'l1', removalOrdinal: 1, removalTotalForWork: 3 }),
      makeItem({ listingId: 'l2', removalOrdinal: 2, removalTotalForWork: 3 }),
      makeItem({ listingId: 'l3', removalOrdinal: 3, removalTotalForWork: 3 }),
    ];
    render(<RemovedPage items={items} />);
    expect(screen.getAllByTestId('removed-row')).toHaveLength(3);
  });

  it('T-UI-009b: each row shows its ordinal and total', () => {
    const items = [
      makeItem({ listingId: 'l1', removalOrdinal: 1, removalTotalForWork: 3 }),
      makeItem({ listingId: 'l2', removalOrdinal: 2, removalTotalForWork: 3 }),
      makeItem({ listingId: 'l3', removalOrdinal: 3, removalTotalForWork: 3 }),
    ];
    render(<RemovedPage items={items} />);
    const ordinals = screen.getAllByTestId('removed-ordinal').map((el) => el.textContent);
    expect(ordinals).toEqual(['Removal 1 of 3', 'Removal 2 of 3', 'Removal 3 of 3']);
  });
});

describe('T-RES-016 — restore control per row, suppressed-work un-suppress-first flow', () => {
  it('T-RES-016a: each row has a Restore button', () => {
    const items = [makeItem({ listingId: 'l1' }), makeItem({ listingId: 'l2' })];
    render(<RemovedPage items={items} />);
    expect(screen.getAllByTestId('restore-button')).toHaveLength(2);
  });

  it('T-RES-016b: pressing Restore calls onRestore with the listing id', async () => {
    const onRestore = vi.fn().mockResolvedValue(undefined);
    render(<RemovedPage items={[makeItem({ listingId: 'list-abc' })]} onRestore={onRestore} />);
    fireEvent.click(screen.getByTestId('restore-button'));
    await waitFor(() =>
      expect(onRestore).toHaveBeenCalledWith('list-abc', { confirmDuplicate: false }),
    );
  });

  it('T-RES-016c: WORK_SUPPRESSED 409 shows un-suppress-first, not a bare error', async () => {
    const suppError = new ApiError('WORK_SUPPRESSED', 409, 'suppressed', {
      unsuppressHref: '/api/suppressions/sup-1/unsuppress',
    });
    const onRestore = vi.fn().mockRejectedValue(suppError);
    render(<RemovedPage items={[makeItem()]} onRestore={onRestore} />);
    fireEvent.click(screen.getByTestId('restore-button'));
    await waitFor(() => expect(screen.getByTestId('unsuppress-first')).toBeInTheDocument());
    expect(screen.queryByTestId('restore-error')).not.toBeInTheDocument();
  });

  it('T-RES-016d: un-suppress-first button calls onUnsuppress with the href', async () => {
    const suppError = new ApiError('WORK_SUPPRESSED', 409, 'suppressed', {
      unsuppressHref: '/api/suppressions/sup-1/unsuppress',
    });
    const onRestore = vi.fn().mockRejectedValue(suppError);
    const onUnsuppress = vi.fn().mockResolvedValue(undefined);
    render(<RemovedPage items={[makeItem()]} onRestore={onRestore} onUnsuppress={onUnsuppress} />);
    fireEvent.click(screen.getByTestId('restore-button'));
    await waitFor(() => screen.getByTestId('unsuppress-first'));
    fireEvent.click(screen.getByTestId('unsuppress-first-button'));
    await waitFor(() =>
      expect(onUnsuppress).toHaveBeenCalledWith('/api/suppressions/sup-1/unsuppress'),
    );
    // Returns to idle after successful unsuppress
    await waitFor(() => expect(screen.getByTestId('restore-button')).toBeInTheDocument());
  });
});
