/**
 * §9.11 offline on `/batches` (`specs/ux-states.md` §9.11, shared id
 * `T-UX-003`). The global banner is `AppShell`'s; this surface owes the
 * per-control half: the *Undo this batch* mutation — a real, irreversible
 * `POST` — is disabled offline with the reason as VISIBLE TEXT, while reading
 * the history stays available (§9.11's "Browse").
 *
 * ⚠ These drive the real container through `navigator.onLine` (flipped by the
 * `offline`/`online` window events, exactly as Playwright's `context.setOffline`
 * does), never `<BatchHistoryPage offline />`: rendering the page with the flag
 * pre-set would prove only that a component can render a prop it is handed —
 * the `BASELINE_UNSUPPLIED` anti-pattern this repo polices. The discriminator
 * is `T-UX-003e`: a control disabled UNCONDITIONALLY passes every "disabled
 * offline" case and fails only when we prove it re-enables online.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BatchHistoryRoute } from '../src/containers/BatchHistoryRoute';
import { ApiError, type ApiClient, type BatchHistoryItem } from '../src/lib/apiClient';
import { OFFLINE_DISABLED_REASON } from '../src/copy';

afterEach(() => {
  cleanup();
  // Leave the shared connection state as it found it: online.
  act(() => {
    window.dispatchEvent(new Event('online'));
  });
});

function historyItem(overrides: Partial<BatchHistoryItem> = {}): BatchHistoryItem {
  return {
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'full-update',
    status: 'applied',
    createdAt: '2026-08-01T10:00:00.000Z',
    submittedAt: '2026-08-01T10:01:00.000Z',
    completedAt: '2026-08-01T10:09:00.000Z',
    undoneAt: null,
    counts: { created: 6, modified: 0, removed: 3 },
    ...overrides,
  };
}

function stubBatchClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const base = {
    listBatches: vi.fn(async () => ({
      batches: [historyItem({ batchId: 'a' }), historyItem({ batchId: 'b' })],
    })),
    undoBatch: vi.fn(async () => ({
      batchId: 'a',
      reversed: { titlesDeleted: 1, listingsRemoved: 1 },
      serviceState: { service: 'netflix', lastCompletedBatchAt: null },
    })),
  };
  return { ...base, ...overrides } as unknown as ApiClient;
}

function renderRoute(client: ApiClient): void {
  render(
    <MemoryRouter>
      <BatchHistoryRoute client={client} />
    </MemoryRouter>,
  );
}

const goOffline = (): void =>
  act(() => {
    window.dispatchEvent(new Event('offline'));
  });
const goOnline = (): void =>
  act(() => {
    window.dispatchEvent(new Event('online'));
  });

describe('T-UX-003 — §9.11 offline on /batches: undo disabled with a visible reason, browse stays', () => {
  it('T-UX-003a: every "Undo this batch" button is disabled offline', async () => {
    renderRoute(stubBatchClient());
    await screen.findByTestId('batches-list');
    const undos = screen.getAllByTestId('batch-card-undo');
    undos.forEach((b) => expect(b).not.toBeDisabled());

    goOffline();

    await waitFor(() =>
      screen.getAllByTestId('batch-card-undo').forEach((b) => expect(b).toBeDisabled()),
    );
  });

  it('T-UX-003b: the disabling reason is rendered as VISIBLE TEXT, not a title/aria-label', async () => {
    renderRoute(stubBatchClient());
    await screen.findByTestId('batches-list');
    expect(screen.queryAllByTestId('batch-card-offline-reason')).toHaveLength(0);

    goOffline();

    const reasons = await screen.findAllByTestId('batch-card-offline-reason');
    expect(reasons.length).toBeGreaterThan(0);
    // ⚠ Killing assertion for "reason via title= instead of text": the reason
    // must be readable in the DOM text, not tucked into an attribute.
    reasons.forEach((r) => expect(r).toHaveTextContent(OFFLINE_DISABLED_REASON));
  });

  it('T-UX-003c: the history keeps rendering its cards offline — browse is not blocked', async () => {
    renderRoute(stubBatchClient());
    await screen.findByTestId('batches-list');

    goOffline();

    await waitFor(() => expect(screen.getAllByTestId('batch-card')).toHaveLength(2));
    expect(screen.getByTestId('batches-list')).toBeInTheDocument();
  });

  it('T-UX-003d: the unclassified-failure retry button is disabled offline, with the reason', async () => {
    const client = stubBatchClient({
      undoBatch: vi.fn(async () => {
        throw new ApiError('INTERNAL_ERROR', 500, 'Boom.', {});
      }) as unknown as ApiClient['undoBatch'],
    });
    renderRoute(client);
    await screen.findByTestId('batches-list');
    fireEvent.click(within(screen.getAllByTestId('batch-card')[0]!).getByTestId('batch-card-undo'));
    const retry = await screen.findByTestId('undo-failed-retry');
    expect(retry).not.toBeDisabled();

    goOffline();

    await waitFor(() => expect(screen.getByTestId('undo-failed-retry')).toBeDisabled());
    expect(screen.getByTestId('undo-failed-offline-reason')).toHaveTextContent(
      OFFLINE_DISABLED_REASON,
    );
  });

  it('T-UX-003e: every disabled control is enabled AGAIN when the connection returns', async () => {
    renderRoute(stubBatchClient());
    await screen.findByTestId('batches-list');

    goOffline();
    await waitFor(() =>
      screen.getAllByTestId('batch-card-undo').forEach((b) => expect(b).toBeDisabled()),
    );

    goOnline();

    // ⚠ Killing assertion for "disable unconditionally, ignore useOnline": the
    // control must come back, and the visible reason must clear.
    await waitFor(() =>
      screen.getAllByTestId('batch-card-undo').forEach((b) => expect(b).not.toBeDisabled()),
    );
    expect(screen.queryAllByTestId('batch-card-offline-reason')).toHaveLength(0);
  });
});
