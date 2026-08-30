/**
 * TASK-116 — the §9.8/§9.9 undo-refusal repair panel (`specs/ux-states.md`
 * §9.8, §9.9, US-033, `T-UX-097`).
 *
 * The panel is the CLIENT half of the §8.4 refusal contract: when
 * `POST /api/batches/:batchId/undo` answers 409 `BATCH_NOT_CREATES_ONLY`, the
 * owner is shown — full-screen, never as a toast — every created/modified/
 * removed title the undo would have touched, each with a working remedy, with
 * nothing summarised away (US-033 AC-5) and a state chip on anything since
 * removed or suppressed (US-033 AC-6).
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  UndoRefusalCreatedEntry,
  UndoRefusalDetails,
  UndoRefusalModifiedEntry,
  UndoRefusalRemovedEntry,
} from '@nextup/domain';

import {
  PAGE_SIZE,
  UndoRefusalPanel,
  type UndoRefusalPanelProps,
} from '../src/components/UndoRefusalPanel';
import { BatchHistoryRoute } from '../src/containers/BatchHistoryRoute';
import { BatchHistoryPage } from '../src/pages/BatchHistoryPage';
import { ApiError, type ApiClient, type BatchHistoryItem } from '../src/lib/apiClient';
import { isUndoRefusal, parseUndoRefusalDetails } from '../src/lib/undoRefusal';
import {
  UNDO_REFUSAL_BODY,
  UNDO_REFUSAL_GROUP_ADDED,
  UNDO_REFUSAL_GROUP_CHANGED,
  UNDO_REFUSAL_GROUP_REMOVED,
  UNDO_REFUSAL_PROVENANCE_UNAVAILABLE_BODY,
  UNDO_REFUSAL_SHOW_ALL_LABEL,
  UNDO_REFUSAL_TITLE,
} from '../src/copy';

afterEach(cleanup);

// ── Fixtures ──────────────────────────────────────────────────────────────

function created(overrides: Partial<UndoRefusalCreatedEntry> = {}): UndoRefusalCreatedEntry {
  return {
    titleId: 'ttl_c',
    name: 'The Matrix',
    releaseYear: 1999,
    posterPath: null,
    currentState: 'active',
    remedy: 'not-interested',
    remedyHref: '/api/titles/ttl_c/suppress',
    ...overrides,
  };
}

function modified(overrides: Partial<UndoRefusalModifiedEntry> = {}): UndoRefusalModifiedEntry {
  return {
    titleId: 'ttl_m',
    name: 'Arrival',
    releaseYear: 2016,
    posterPath: '/arrival.jpg',
    attr: 'tmdbId',
    before: null,
    currentState: 'active',
    remedy: 'fix-match',
    remedyHref: '/api/titles/ttl_m/fix-match',
    ...overrides,
  };
}

function removed(overrides: Partial<UndoRefusalRemovedEntry> = {}): UndoRefusalRemovedEntry {
  return {
    titleId: 'ttl_r',
    listingId: 'lst_r',
    name: 'Dune',
    releaseYear: 2021,
    posterPath: null,
    currentState: 'removed',
    remedy: 'restore',
    remedyHref: '/api/listings/lst_r/restore',
    ...overrides,
  };
}

function details(overrides: Partial<UndoRefusalDetails> = {}): UndoRefusalDetails {
  return {
    batchId: 'bat_1',
    reason: 'modified-or-removed',
    created: [],
    modified: [],
    removed: [],
    truncated: false,
    ...overrides,
  };
}

function renderPanel(overrides: Partial<UndoRefusalPanelProps> = {}): {
  suppress: ReturnType<typeof vi.fn>;
  unsuppress: ReturnType<typeof vi.fn>;
  searchTmdb: ReturnType<typeof vi.fn>;
  fixMatch: ReturnType<typeof vi.fn>;
  restore: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  const fakes = {
    suppress: vi.fn(async () => ({
      suppressionId: 'supp_1',
      workIdentity: 'w',
      alreadySuppressed: false,
    })),
    unsuppress: vi.fn(async () => ({})),
    searchTmdb: vi.fn(async () => ({ items: [] })),
    fixMatch: vi.fn(async () => ({
      titleId: 'ttl_m',
      workIdentity: 'w',
      preserved: { listingIds: [], dateAdded: {}, sortDateAdded: null },
      suppressionMigrated: null,
    })),
    restore: vi.fn(async () => ({
      listingId: 'lst_r',
      titleId: 'ttl_r',
      state: 'active',
      dateAdded: '2026-01-04',
      titleState: 'active',
      sortDateAdded: '2026-01-04',
    })),
    onClose: vi.fn(),
  };
  render(
    <UndoRefusalPanel
      details={details()}
      onClose={fakes.onClose}
      suppress={fakes.suppress}
      unsuppress={fakes.unsuppress}
      searchTmdb={fakes.searchTmdb}
      fixMatch={fakes.fixMatch}
      restore={fakes.restore}
      {...overrides}
    />,
  );
  return fakes;
}

// ── §9.8 — the panel itself ─────────────────────────────────────────────────

describe('T-UX-097 — §9.8 the undo-refusal panel', () => {
  it('T-UX-097a: renders a full-screen PANEL, not a toast', () => {
    renderPanel({ details: details({ created: [created()] }) });
    // The mutant "render a toast instead of the panel" removes this container.
    const panel = screen.getByTestId('undo-refusal-panel');
    expect(panel).toHaveClass('undo-refusal');
    // A panel has a landmark heading and an alert region; a toast has neither.
    expect(within(panel).getByRole('heading', { level: 1 })).toHaveTextContent(UNDO_REFUSAL_TITLE);
    expect(within(panel).getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('undo-refusal-body')).toHaveTextContent(UNDO_REFUSAL_BODY);
  });

  it('T-UX-097b: the copy is the shared UNDO_REFUSAL_* register, not inlined strings', () => {
    // Killing test for "remove one UNDO_REFUSAL_* constant and inline it": the
    // import below breaks and these assertions fall over.
    renderPanel({
      details: details({ created: [created()], modified: [modified()], removed: [removed()] }),
    });
    expect(screen.getByText(UNDO_REFUSAL_TITLE)).toBeInTheDocument();
    expect(screen.getByText(UNDO_REFUSAL_BODY)).toBeInTheDocument();
    expect(screen.getByTestId('undo-refusal-group-added').querySelector('h2')).toHaveTextContent(
      `${UNDO_REFUSAL_GROUP_ADDED} (1)`,
    );
    expect(screen.getByTestId('undo-refusal-group-changed').querySelector('h2')).toHaveTextContent(
      `${UNDO_REFUSAL_GROUP_CHANGED} (1)`,
    );
    expect(screen.getByTestId('undo-refusal-group-removed').querySelector('h2')).toHaveTextContent(
      `${UNDO_REFUSAL_GROUP_REMOVED} (1)`,
    );
  });

  it('T-UX-097c: every entry in all three groups is rendered — nothing summarised away', () => {
    renderPanel({
      details: details({
        created: [created({ titleId: 'a' }), created({ titleId: 'b' }), created({ titleId: 'c' })],
        modified: [modified({ titleId: 'd' }), modified({ titleId: 'e' })],
        removed: [removed({ listingId: 'f' })],
      }),
    });
    expect(
      within(screen.getByTestId('undo-refusal-list-added')).getAllByTestId('undo-refusal-entry'),
    ).toHaveLength(3);
    expect(
      within(screen.getByTestId('undo-refusal-list-changed')).getAllByTestId('undo-refusal-entry'),
    ).toHaveLength(2);
    expect(
      within(screen.getByTestId('undo-refusal-list-removed')).getAllByTestId('undo-refusal-entry'),
    ).toHaveLength(1);
  });

  it('T-UX-097d: an empty group is not rendered at all', () => {
    renderPanel({ details: details({ created: [created()] }) });
    expect(screen.getByTestId('undo-refusal-group-added')).toBeInTheDocument();
    expect(screen.queryByTestId('undo-refusal-group-changed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('undo-refusal-group-removed')).not.toBeInTheDocument();
  });

  it('T-UX-097e: a group over 50 paginates client-side with Show all, then reveals the rest', () => {
    const many = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => created({ titleId: `c${i}` }));
    renderPanel({ details: details({ created: many }) });

    const list = () =>
      within(screen.getByTestId('undo-refusal-list-added')).getAllByTestId('undo-refusal-entry');
    // Killing test for "truncate a group to the first 50 with no Show all".
    expect(list()).toHaveLength(PAGE_SIZE);
    const showAll = screen.getByTestId('undo-refusal-show-all-added');
    expect(showAll).toHaveTextContent(`${UNDO_REFUSAL_SHOW_ALL_LABEL} (${PAGE_SIZE + 1})`);

    fireEvent.click(showAll);
    // Nothing is summarised away: every entry is reachable without a network call.
    expect(list()).toHaveLength(PAGE_SIZE + 1);
    expect(screen.queryByTestId('undo-refusal-show-all-added')).not.toBeInTheDocument();
  });

  it('T-UX-097f: a title since removed carries a state chip (US-033 AC-6)', () => {
    renderPanel({ details: details({ removed: [removed({ currentState: 'removed' })] }) });
    // Killing test for "drop the state chip on a since-removed title".
    const entry = within(screen.getByTestId('undo-refusal-list-removed')).getByTestId(
      'undo-refusal-entry',
    );
    expect(within(entry).getByTestId('undo-refusal-state-chip')).toBeInTheDocument();
  });

  it('T-UX-097g: a title since suppressed carries a state chip (US-033 AC-6)', () => {
    renderPanel({ details: details({ created: [created({ currentState: 'suppressed' })] }) });
    const entry = within(screen.getByTestId('undo-refusal-list-added')).getByTestId(
      'undo-refusal-entry',
    );
    expect(within(entry).getByTestId('undo-refusal-state-chip')).toBeInTheDocument();
  });

  it('T-UX-097h: an active title carries NO chip', () => {
    renderPanel({ details: details({ created: [created({ currentState: 'active' })] }) });
    expect(screen.queryByTestId('undo-refusal-state-chip')).not.toBeInTheDocument();
  });

  it('T-UX-097i: the "Not interested" action opens a working suppress dialog', async () => {
    const fakes = renderPanel({ details: details({ created: [created({ titleId: 'ttl_c' })] }) });
    fireEvent.click(screen.getByTestId('undo-refusal-not-interested'));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not interested' }));
    await waitFor(() => expect(fakes.suppress).toHaveBeenCalledWith('ttl_c'));
  });

  it('T-UX-097j: the "Fix match" action opens a working fix-match dialog', () => {
    renderPanel({ details: details({ modified: [modified({ titleId: 'ttl_m' })] }) });
    fireEvent.click(screen.getByTestId('undo-refusal-fix-match'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('tmdb-search-input')).toBeInTheDocument();
  });

  it('T-UX-097k: the "Restore" action drives the §6.10 restore path', async () => {
    const fakes = renderPanel({ details: details({ removed: [removed({ listingId: 'lst_r' })] }) });
    fireEvent.click(screen.getByTestId('undo-refusal-restore'));
    await waitFor(() => expect(fakes.restore).toHaveBeenCalledWith('lst_r'));
  });

  it('T-UX-097l: close returns the owner to their batch history', () => {
    const fakes = renderPanel({ details: details({ created: [created()] }) });
    fireEvent.click(screen.getByTestId('undo-refusal-close'));
    expect(fakes.onClose).toHaveBeenCalledTimes(1);
  });
});

// ── §9.9 — provenance-unavailable ───────────────────────────────────────────

describe('T-UX-097 — §9.9 provenance-unavailable refusal', () => {
  it('T-UX-097m: renders the §9.9 body and no groups when provenance is unavailable', () => {
    renderPanel({ details: details({ reason: 'provenance-unavailable' }) });
    expect(screen.getByTestId('undo-refusal-panel')).toHaveAttribute(
      'data-reason',
      'provenance-unavailable',
    );
    expect(screen.getByTestId('undo-refusal-body')).toHaveTextContent(
      UNDO_REFUSAL_PROVENANCE_UNAVAILABLE_BODY,
    );
    expect(screen.queryByTestId('undo-refusal-group-added')).not.toBeInTheDocument();
  });
});

// ── The parser and the caller that produces a refusal ───────────────────────

describe('T-UX-097 — parsing and routing the 409', () => {
  it('T-UX-097n: isUndoRefusal recognises only the 409 BATCH_NOT_CREATES_ONLY', () => {
    const refusal = new ApiError('BATCH_NOT_CREATES_ONLY', 409, 'no', {});
    const lifecycle = new ApiError('BATCH_ALREADY_UNDONE', 409, 'no', {});
    const other = new ApiError('INTERNAL_ERROR', 500, 'no', {});
    expect(isUndoRefusal(refusal)).toBe(true);
    expect(isUndoRefusal(lifecycle)).toBe(false);
    expect(isUndoRefusal(other)).toBe(false);
    expect(isUndoRefusal(new Error('x'))).toBe(false);
  });

  it('T-UX-097o: parseUndoRefusalDetails coerces the envelope and pins truncated false', () => {
    const parsed = parseUndoRefusalDetails({
      batchId: 'bat_9',
      reason: 'modified-or-removed',
      created: [
        { titleId: 'a', name: 'A', releaseYear: 2001, posterPath: null, currentState: 'active' },
      ],
      modified: 'not-an-array',
      removed: [{ titleId: 'b', listingId: 'l', name: 'B', currentState: 'removed' }],
    });
    expect(parsed.batchId).toBe('bat_9');
    expect(parsed.created).toHaveLength(1);
    expect(parsed.created[0]?.name).toBe('A');
    // A malformed group degrades to empty rather than throwing.
    expect(parsed.modified).toEqual([]);
    expect(parsed.removed[0]?.listingId).toBe('l');
    expect(parsed.truncated).toBe(false);
  });

  it('T-UX-097p: the batch card offers undo only for an applied, not-yet-undone batch', () => {
    const onUndo = vi.fn();
    render(
      <MemoryRouter>
        <BatchHistoryPage
          items={[
            historyItem({ batchId: 'a', status: 'applied', undoneAt: null }),
            historyItem({ batchId: 'b', status: 'applied', undoneAt: '2026-08-02T00:00:00.000Z' }),
          ]}
          onUndo={onUndo}
        />
      </MemoryRouter>,
    );
    const undos = screen.getAllByTestId('batch-card-undo');
    expect(undos).toHaveLength(1);
    fireEvent.click(undos[0]!);
    expect(onUndo).toHaveBeenCalledWith('a');
  });

  it('T-UX-097q: a refused undo opens the full-screen panel, replacing the history', async () => {
    const client = stubBatchClient({
      undoBatch: vi.fn(async () => {
        throw new ApiError('BATCH_NOT_CREATES_ONLY', 409, 'This batch cannot be undone.', {
          batchId: 'a',
          reason: 'modified-or-removed',
          created: [
            {
              titleId: 'a',
              name: 'The Matrix',
              releaseYear: 1999,
              posterPath: null,
              currentState: 'active',
            },
          ],
          modified: [],
          removed: [],
          truncated: false,
        });
      }),
    });
    render(
      <MemoryRouter>
        <BatchHistoryRoute client={client} />
      </MemoryRouter>,
    );
    await screen.findByTestId('batches-list');
    fireEvent.click(screen.getByTestId('batch-card-undo'));

    await screen.findByTestId('undo-refusal-panel');
    // The history is gone: the panel is a replacement, not an overlay.
    expect(screen.queryByTestId('batches-list')).not.toBeInTheDocument();
    expect(screen.getByText('The Matrix')).toBeInTheDocument();
  });

  it('T-UX-097r: a lifecycle 409 does NOT open the enumeration panel', async () => {
    const client = stubBatchClient({
      undoBatch: vi.fn(async () => {
        throw new ApiError('BATCH_ALREADY_UNDONE', 409, 'Already undone.', { batchId: 'a' });
      }),
    });
    render(
      <MemoryRouter>
        <BatchHistoryRoute client={client} />
      </MemoryRouter>,
    );
    await screen.findByTestId('batches-list');
    fireEvent.click(screen.getByTestId('batch-card-undo'));
    // The §9.10 outcome is rendered (covered in full by undoOutcomes.spec);
    // here we only assert it is NOT forced into the §8.4 enumeration panel.
    await screen.findByTestId('undo-already-undone');
    expect(screen.queryByTestId('undo-refusal-panel')).not.toBeInTheDocument();
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
    listBatches: vi.fn(async () => ({ batches: [historyItem({ batchId: 'a' })] })),
    undoBatch: vi.fn(async () => ({})),
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
