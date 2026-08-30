/**
 * The §9.6/§9.7/§9.10 undo OUTCOMES on `/batches` (`specs/ux-states.md` §9.6,
 * §9.7, §9.10, US-032). The §8.4 enumeration refusal (§9.8/§9.9) is covered by
 * `undoRefusalPanel.spec.tsx`; this file owns the other three outcomes plus the
 * mandatory unclassified-failure path.
 *
 * ⚠ Before these existed the container swallowed every non-refusal outcome, so
 * the owner tapped *Undo this batch* and nothing happened — the dead-button
 * failure §4.15 forbids. Each test below is a killing test for one silent
 * outcome coming back.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BatchHistoryRoute } from '../src/containers/BatchHistoryRoute';
import { ApiError, type ApiClient, type BatchHistoryItem } from '../src/lib/apiClient';
import { formatUndoneSummary, isBatchAlreadyUndone, parseUndoResult } from '../src/lib/undoResult';
import {
  BATCHES_ALREADY_UNDONE,
  BATCHES_UNDO_FAILED,
  BATCHES_UNDO_FAILED_RETRY_LABEL,
  BATCHES_UNDO_LABEL,
  BATCHES_UNDO_SUBMITTING,
} from '../src/copy';

afterEach(cleanup);

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
      reversed: { titlesDeleted: 0, listingsRemoved: 0 },
      serviceState: { service: 'netflix', lastCompletedBatchAt: null },
    })),
    suppressTitle: vi.fn(async () => ({
      suppressionId: 's',
      workIdentity: 'w',
      alreadySuppressed: false,
    })),
    unsuppress: vi.fn(async () => ({})),
    searchTmdb: vi.fn(async () => ({ items: [] })),
    fixMatch: vi.fn(async () => ({})),
    restoreListing: vi.fn(async () => ({})),
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

// ── §9.6 Submitting (undo) — T-UX-095 ───────────────────────────────────────

describe('T-UX-095 — §9.6 the card shows "Undoing…" while the undo is in flight', () => {
  it('T-UX-095a: the initiating card shows "Undoing…", is disabled, and others stay actionable', async () => {
    // A never-settling undo keeps the submitting state on screen to assert it.
    const undoBatch = vi.fn(() => new Promise<never>(() => {}));
    const client = stubBatchClient({ undoBatch: undoBatch as unknown as ApiClient['undoBatch'] });
    renderRoute(client);
    await screen.findByTestId('batches-list');

    const cards = screen.getAllByTestId('batch-card');
    const first = within(cards[0]!).getByTestId('batch-card-undo');
    const second = within(cards[1]!).getByTestId('batch-card-undo');
    expect(first).toHaveTextContent(BATCHES_UNDO_LABEL);
    expect(first).not.toBeDisabled();

    fireEvent.click(first);

    // The killing assertion for "remove the in-flight guard": the initiating
    // card relabels to "Undoing…" AND is disabled against a second submit.
    await waitFor(() => expect(first).toHaveTextContent(BATCHES_UNDO_SUBMITTING));
    expect(first).toBeDisabled();
    // Only that card: the sibling is untouched and still actionable.
    expect(second).toHaveTextContent(BATCHES_UNDO_LABEL);
    expect(second).not.toBeDisabled();
  });

  it('T-UX-095b: a second click on the in-flight card does not fire a second undo', async () => {
    const undoBatch = vi.fn(() => new Promise<never>(() => {}));
    const client = stubBatchClient({ undoBatch: undoBatch as unknown as ApiClient['undoBatch'] });
    renderRoute(client);
    await screen.findByTestId('batches-list');
    const first = within(screen.getAllByTestId('batch-card')[0]!).getByTestId('batch-card-undo');

    fireEvent.click(first);
    await waitFor(() => expect(first).toBeDisabled());
    fireEvent.click(first);
    fireEvent.click(first);

    expect(undoBatch).toHaveBeenCalledTimes(1);
  });
});

// ── §9.7 Success (undo) — T-UX-096 ──────────────────────────────────────────

describe('T-UX-096 — §9.7 "Undone. N titles and M service entries were removed." + a link to /', () => {
  it('T-UX-096a: renders the counts FROM THE RESPONSE and a link to /', async () => {
    // ⚠ 4 and 7 are deliberately not the spec's example 6/9: a hard-coded
    // "6 titles and 9 service entries" would pass against 6/9 and fail here.
    const client = stubBatchClient({
      undoBatch: vi.fn(async () => ({
        batchId: 'a',
        reversed: { titlesDeleted: 4, listingsRemoved: 7 },
        serviceState: { service: 'netflix', lastCompletedBatchAt: null },
      })) as unknown as ApiClient['undoBatch'],
    });
    renderRoute(client);
    await screen.findByTestId('batches-list');
    fireEvent.click(within(screen.getAllByTestId('batch-card')[0]!).getByTestId('batch-card-undo'));

    const success = await screen.findByTestId('undo-success');
    expect(success).toHaveTextContent('Undone. 4 titles and 7 service entries were removed.');
    // A link the owner MAY follow — not an automatic navigation.
    const home = within(success).getByTestId('undo-success-home');
    expect(home).toHaveAttribute('href', '/');
    // The success view replaces the history; it is not an overlay on it.
    expect(screen.queryByTestId('batches-list')).not.toBeInTheDocument();
  });

  it('T-UX-096b: the count nouns pluralise honestly for a count of one', async () => {
    const client = stubBatchClient({
      undoBatch: vi.fn(async () => ({
        batchId: 'a',
        reversed: { titlesDeleted: 1, listingsRemoved: 1 },
        serviceState: { service: 'netflix', lastCompletedBatchAt: null },
      })) as unknown as ApiClient['undoBatch'],
    });
    renderRoute(client);
    await screen.findByTestId('batches-list');
    fireEvent.click(within(screen.getAllByTestId('batch-card')[0]!).getByTestId('batch-card-undo'));

    const success = await screen.findByTestId('undo-success');
    expect(success).toHaveTextContent('Undone. 1 title and 1 service entry were removed.');
  });

  it('T-UX-096c: parseUndoResult reads reversed.titlesDeleted/listingsRemoved defensively', () => {
    expect(parseUndoResult({ reversed: { titlesDeleted: 4, listingsRemoved: 7 } })).toEqual({
      titlesRemoved: 4,
      entriesRemoved: 7,
    });
    // A missing field degrades to 0, never `undefined` rendered as a number.
    expect(parseUndoResult({})).toEqual({ titlesRemoved: 0, entriesRemoved: 0 });
    expect(parseUndoResult(null)).toEqual({ titlesRemoved: 0, entriesRemoved: 0 });
  });

  it('T-UX-096d: formatUndoneSummary is the single rule for the sentence', () => {
    expect(formatUndoneSummary({ titlesRemoved: 4, entriesRemoved: 7 })).toBe(
      'Undone. 4 titles and 7 service entries were removed.',
    );
    expect(formatUndoneSummary({ titlesRemoved: 1, entriesRemoved: 2 })).toBe(
      'Undone. 1 title and 2 service entries were removed.',
    );
  });
});

// ── §9.10 Error — already undone — and the unclassified fault — T-UX-098 ─────

describe('T-UX-098 — §9.10 "This upload was already undone." + refresh, kept distinct', () => {
  it('T-UX-098a: a 409 BATCH_ALREADY_UNDONE shows the settled-fact message, not the panel', async () => {
    const client = stubBatchClient({
      undoBatch: vi.fn(async () => {
        throw new ApiError('BATCH_ALREADY_UNDONE', 409, 'Already undone.', { batchId: 'a' });
      }) as unknown as ApiClient['undoBatch'],
    });
    renderRoute(client);
    await screen.findByTestId('batches-list');
    fireEvent.click(within(screen.getAllByTestId('batch-card')[0]!).getByTestId('batch-card-undo'));

    const notice = await screen.findByTestId('undo-already-undone');
    expect(notice).toHaveTextContent(BATCHES_ALREADY_UNDONE);
    // ⚠ Killing assertion for "route already-undone into the §9.8 panel": the
    // settled fact is NOT the enumeration, and NOT a retryable fault.
    expect(screen.queryByTestId('undo-refusal-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('undo-failed')).not.toBeInTheDocument();
  });

  it('T-UX-098b: the refresh control reloads the history', async () => {
    const client = stubBatchClient({
      undoBatch: vi.fn(async () => {
        throw new ApiError('BATCH_ALREADY_UNDONE', 409, 'Already undone.', { batchId: 'a' });
      }) as unknown as ApiClient['undoBatch'],
    });
    renderRoute(client);
    await screen.findByTestId('batches-list');
    fireEvent.click(within(screen.getAllByTestId('batch-card')[0]!).getByTestId('batch-card-undo'));
    await screen.findByTestId('undo-already-undone');

    const before = (client.listBatches as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(screen.getByTestId('undo-already-undone-refresh'));
    await waitFor(() =>
      expect((client.listBatches as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1),
    );
  });

  it('T-UX-098c: isBatchAlreadyUndone recognises only the 409 BATCH_ALREADY_UNDONE', () => {
    expect(isBatchAlreadyUndone(new ApiError('BATCH_ALREADY_UNDONE', 409, 'x', {}))).toBe(true);
    expect(isBatchAlreadyUndone(new ApiError('BATCH_NOT_CREATES_ONLY', 409, 'x', {}))).toBe(false);
    expect(isBatchAlreadyUndone(new ApiError('BATCH_ALREADY_UNDONE', 500, 'x', {}))).toBe(false);
    expect(isBatchAlreadyUndone(new Error('x'))).toBe(false);
  });

  it('T-UX-098d: an unclassified failure is surfaced and the batch stays retryable', async () => {
    const client = stubBatchClient({
      undoBatch: vi.fn(async () => {
        throw new ApiError('INTERNAL_ERROR', 500, 'Boom.', {});
      }) as unknown as ApiClient['undoBatch'],
    });
    renderRoute(client);
    await screen.findByTestId('batches-list');
    fireEvent.click(within(screen.getAllByTestId('batch-card')[0]!).getByTestId('batch-card-undo'));

    // ⚠ Killing assertion for "restore the silent-swallow handler": a swallowed
    // error shows nothing at all. It must surface, distinct from §9.10.
    const failure = await screen.findByTestId('undo-failed');
    expect(failure).toHaveTextContent(BATCHES_UNDO_FAILED);
    expect(screen.queryByTestId('undo-already-undone')).not.toBeInTheDocument();
    expect(screen.queryByTestId('undo-refusal-panel')).not.toBeInTheDocument();
    // Retryable: the list and its undo control are still there, re-enabled.
    const undo = within(screen.getAllByTestId('batch-card')[0]!).getByTestId('batch-card-undo');
    expect(undo).not.toBeDisabled();
  });

  it('T-UX-098e: a non-ApiError network fault also routes to the retryable failure', async () => {
    const client = stubBatchClient({
      undoBatch: vi.fn(async () => {
        throw new Error('network down');
      }) as unknown as ApiClient['undoBatch'],
    });
    renderRoute(client);
    await screen.findByTestId('batches-list');
    fireEvent.click(within(screen.getAllByTestId('batch-card')[0]!).getByTestId('batch-card-undo'));

    await screen.findByTestId('undo-failed');
    expect(screen.queryByTestId('undo-already-undone')).not.toBeInTheDocument();
  });
});

// ── The unclassified-failure RETRY is a working control — T-UX-098 ───────────

describe('T-UX-098 — the failure banner offers a WORKING retry for the batch that failed', () => {
  it('T-UX-098f: the retry affordance is a real button, not inert text', async () => {
    const client = stubBatchClient({
      undoBatch: vi.fn(async () => {
        throw new ApiError('INTERNAL_ERROR', 500, 'Boom.', {});
      }) as unknown as ApiClient['undoBatch'],
    });
    renderRoute(client);
    await screen.findByTestId('batches-list');
    fireEvent.click(within(screen.getAllByTestId('batch-card')[0]!).getByTestId('batch-card-undo'));

    const failure = await screen.findByTestId('undo-failed');
    // ⚠ Killing assertion for "render the retry as a <span> again": the retry
    // MUST be an operable button, not a label the owner taps to no effect.
    const retry = within(failure).getByRole('button', { name: BATCHES_UNDO_FAILED_RETRY_LABEL });
    expect(retry.tagName).toBe('BUTTON');
  });

  it('T-UX-098g: retry re-issues undo with the SAME batch id that failed (2-batch history)', async () => {
    // The failure comes from the SECOND card ('b'). A retry hard-coded to the
    // first batch would call undo with 'a' and this assertion would fail.
    let calls = 0;
    const undoBatch = vi.fn(async (id: string) => {
      calls += 1;
      if (calls === 1) throw new ApiError('INTERNAL_ERROR', 500, 'Boom.', {});
      return {
        batchId: id,
        reversed: { titlesDeleted: 2, listingsRemoved: 3 },
        serviceState: { service: 'netflix', lastCompletedBatchAt: null },
      };
    });
    const client = stubBatchClient({
      undoBatch: undoBatch as unknown as ApiClient['undoBatch'],
    });
    renderRoute(client);
    await screen.findByTestId('batches-list');
    const secondCard = screen.getAllByTestId('batch-card')[1]!;
    fireEvent.click(within(secondCard).getByTestId('batch-card-undo'));

    const failure = await screen.findByTestId('undo-failed');
    fireEvent.click(within(failure).getByRole('button', { name: BATCHES_UNDO_FAILED_RETRY_LABEL }));

    await screen.findByTestId('undo-success');
    expect(undoBatch).toHaveBeenCalledTimes(2);
    expect(undoBatch.mock.calls[0]![0]).toBe('b');
    expect(undoBatch.mock.calls[1]![0]).toBe('b');
  });

  it('T-UX-098h: a retry that succeeds lands in §9.7 with the server counts', async () => {
    let calls = 0;
    const client = stubBatchClient({
      undoBatch: vi.fn(async (id: string) => {
        calls += 1;
        if (calls === 1) throw new ApiError('INTERNAL_ERROR', 500, 'Boom.', {});
        return {
          batchId: id,
          reversed: { titlesDeleted: 5, listingsRemoved: 8 },
          serviceState: { service: 'netflix', lastCompletedBatchAt: null },
        };
      }) as unknown as ApiClient['undoBatch'],
    });
    renderRoute(client);
    await screen.findByTestId('batches-list');
    fireEvent.click(within(screen.getAllByTestId('batch-card')[0]!).getByTestId('batch-card-undo'));

    const failure = await screen.findByTestId('undo-failed');
    fireEvent.click(within(failure).getByRole('button', { name: BATCHES_UNDO_FAILED_RETRY_LABEL }));

    const success = await screen.findByTestId('undo-success');
    expect(success).toHaveTextContent('Undone. 5 titles and 8 service entries were removed.');
    expect(screen.queryByTestId('undo-failed')).not.toBeInTheDocument();
  });
});
