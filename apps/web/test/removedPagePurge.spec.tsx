/**
 * TASK-278 — permanent delete from the Removed view (US-067, REQ-133, A58,
 * ADR-0015). `T-PURGE-020`.
 *
 * Nothing is deleted until the owner confirms in a dialog that names what is
 * lost, says it cannot be undone and mentions the 7-day backup window.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RemovedPage } from '../src/pages/RemovedPage';
import { ApiError } from '../src/lib/apiClient';
import type { RemovedItem } from '../src/lib/apiClient';
import {
  PURGE_BACKUP_NOTE,
  PURGE_FAILED,
  PURGE_IRREVERSIBLE,
  PURGE_LABEL,
  PURGE_WORK_LABEL,
} from '../src/copy';

function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
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
    posterPath: null,
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

const TWO_OF_ONE_WORK: readonly RemovedItem[] = [
  removed({ listingId: 'lst_a', removalOrdinal: 2, removalTotalForWork: 2 }),
  removed({ listingId: 'lst_b', removalOrdinal: 1, removalTotalForWork: 2 }),
];

function renderPage(
  items: readonly RemovedItem[],
  handlers: {
    onPurgeListing?: (id: string) => Promise<unknown>;
    onPurgeWork?: (wi: string) => Promise<unknown>;
  },
): void {
  render(
    <RemovedPage
      items={items}
      onRestore={() => Promise.reject(new Error('unused'))}
      onUnsuppress={() => Promise.resolve()}
      {...handlers}
    />,
  );
}

describe('permanent delete from the Removed view — T-PURGE-020', () => {
  it('T-PURGE-020a: the controls render only when wired, and are labelled', () => {
    const { unmount } = render(
      <RemovedPage items={[removed()]} onRestore={() => Promise.reject(new Error('x'))} />,
    );
    expect(screen.queryByTestId('purge-button')).toBeNull();
    unmount();

    renderPage([removed()], {
      onPurgeListing: () => Promise.resolve({}),
      onPurgeWork: () => Promise.resolve({}),
    });
    expect(screen.getByTestId('purge-button').textContent).toBe(PURGE_LABEL);
    expect(screen.getByTestId('purge-work-button').textContent).toBe(PURGE_WORK_LABEL);
  });

  it('T-PURGE-020b: the dialog names what is lost, the irreversibility and the 7-day backup', async () => {
    renderPage([removed()], { onPurgeListing: () => Promise.resolve({}) });
    await userEvent.click(screen.getByTestId('purge-button'));

    const dialog = screen.getByTestId('purge-dialog');
    expect(within(dialog).getByTestId('purge-body').textContent).toContain('The Matrix');
    expect(within(dialog).getByTestId('purge-body').textContent).toContain('Netflix');
    const irreversible = within(dialog).getByTestId('purge-irreversible').textContent ?? '';
    expect(irreversible).toContain(PURGE_IRREVERSIBLE);
    expect(irreversible).toContain(PURGE_BACKUP_NOTE);
    expect(irreversible).toContain('7 days');
  });

  it('T-PURGE-020c: the dialog opens on Cancel; cancelling deletes nothing and returns focus', async () => {
    const onPurgeListing = vi.fn(() => Promise.resolve({}));
    renderPage([removed()], { onPurgeListing });
    const trigger = screen.getByTestId('purge-button');
    await userEvent.click(trigger);

    expect(document.activeElement).toBe(screen.getByTestId('purge-cancel'));
    await userEvent.click(screen.getByTestId('purge-cancel'));

    expect(onPurgeListing).not.toHaveBeenCalled();
    expect(screen.queryByTestId('purge-dialog')).toBeNull();
    expect(screen.getAllByTestId('removed-row')).toHaveLength(1);
    expect(document.activeElement).toBe(trigger);
  });

  it('T-PURGE-020d: confirming deletes ONE listing, drops that row only and announces it', async () => {
    const onPurgeListing = vi.fn(() => Promise.resolve({}));
    renderPage(TWO_OF_ONE_WORK, { onPurgeListing });
    const first = screen.getAllByTestId('removed-row')[0]!;
    await userEvent.click(within(first).getByTestId('purge-button'));
    await userEvent.click(screen.getByTestId('purge-confirm'));

    expect(onPurgeListing).toHaveBeenCalledWith('lst_a');
    expect(screen.getAllByTestId('removed-row')).toHaveLength(1);
    expect(screen.getByTestId('restore-success-announcement').textContent).toContain(
      'permanently deleted',
    );
  });

  it('T-PURGE-020e: delete-all-history removes every row of that work without a reload', async () => {
    const onPurgeWork = vi.fn(() => Promise.resolve({}));
    renderPage(
      [...TWO_OF_ONE_WORK, removed({ listingId: 'lst_z', workIdentity: 'tmdb:movie:1' })],
      {
        onPurgeWork,
      },
    );
    const first = screen.getAllByTestId('removed-row')[0]!;
    await userEvent.click(within(first).getByTestId('purge-work-button'));
    await userEvent.click(screen.getByTestId('purge-confirm'));

    expect(onPurgeWork).toHaveBeenCalledWith('tmdb:movie:603');
    expect(screen.getAllByTestId('removed-row')).toHaveLength(1);
  });

  it.each([
    ['LISTING_NOT_REMOVED', 'The Matrix'],
    ['WORK_HAS_ACTIVE_LISTING', 'The Matrix'],
  ])('T-PURGE-020f: a 409 %s keeps the row and says why', async (code, name) => {
    const onPurgeListing = vi.fn(() => Promise.reject(new ApiError(code, 409, 'refused', {})));
    renderPage([removed()], { onPurgeListing });
    await userEvent.click(screen.getByTestId('purge-button'));
    await userEvent.click(screen.getByTestId('purge-confirm'));

    expect(screen.getAllByTestId('removed-row')).toHaveLength(1);
    expect(screen.getByTestId('purge-failure').textContent).toContain(name);
    expect(screen.queryByTestId('purge-dialog')).toBeNull();
  });

  it('T-PURGE-020g: an unexpected failure says nothing was deleted and keeps the row', async () => {
    renderPage([removed()], { onPurgeListing: () => Promise.reject(new Error('boom')) });
    await userEvent.click(screen.getByTestId('purge-button'));
    await userEvent.click(screen.getByTestId('purge-confirm'));

    expect(screen.getByTestId('purge-failure').textContent).toBe(PURGE_FAILED);
    expect(screen.getAllByTestId('removed-row')).toHaveLength(1);
  });

  it('T-PURGE-020h: offline disables both controls', () => {
    renderPage([removed()], {
      onPurgeListing: () => Promise.resolve({}),
      onPurgeWork: () => Promise.resolve({}),
    });
    act(() => setNavigatorOnline(false));

    expect((screen.getByTestId('purge-button') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('purge-work-button') as HTMLButtonElement).disabled).toBe(true);
  });
});
