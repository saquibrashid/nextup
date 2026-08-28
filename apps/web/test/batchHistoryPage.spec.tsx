/**
 * TASK-076 — `/batches` history and the batch-detail provenance view
 * (`specs/ux-states.md` §9.1–§9.5).
 *
 * `specs/testing.md`:
 *   `T-UX-090` — loading is skeletons, NOT the empty sentence
 *   `T-UX-091` — the empty state, verbatim
 *   `T-UX-092` — one card per batch with the count triple
 *   `T-UX-093` — the detail view lists created/modified/removed IN FULL,
 *                each entry linking to its title
 *   `T-UX-094` — "This upload didn't change anything." is SAID, not implied
 *
 * ⚠ The load-bearing pair is `T-UX-090` and `T-UX-091`. An empty list and an
 * unloaded list are the same pixels and opposite facts; for an owner whose
 * entire library came from uploads, showing the empty sentence during a load
 * reads as data loss.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { BatchHistoryPage, countsLine } from '../src/pages/BatchHistoryPage';
import { BatchStatusPage, showsProvenance } from '../src/pages/BatchStatusPage';
import { BATCHES_EMPTY, BATCH_CHANGED_NOTHING } from '../src/copy';
import type { BatchHistoryItem, BatchStatus } from '../src/lib/apiClient';

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

function appliedBatch(overrides: Partial<BatchStatus> = {}): BatchStatus {
  return {
    batchId: 'bat_1',
    service: 'netflix',
    mode: 'full-update',
    status: 'applied',
    derivedFromBatchId: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    submittedAt: '2026-08-01T10:01:00.000Z',
    completedAt: '2026-08-01T10:09:00.000Z',
    images: [],
    extractionError: null,
    lowYield: false,
    provenance: { created: [], modified: [], removed: [] },
    changedNothing: true,
    titles: [],
    ...overrides,
  };
}

function renderRouted(ui: React.ReactElement): void {
  render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('T-UX-090 — §9.1 loading', () => {
  it('T-UX-090a: a load in flight shows a loading status, never the empty sentence', () => {
    renderRouted(<BatchHistoryPage loading />);
    expect(screen.getByTestId('batches-loading')).toBeInTheDocument();
    // ⚠ THE ASSERTION THAT MATTERS. "You haven't uploaded anything yet." shown
    // over a pending request tells this owner their history is gone.
    expect(screen.queryByText(BATCHES_EMPTY)).not.toBeInTheDocument();
    expect(screen.queryByTestId('batches-list')).not.toBeInTheDocument();
  });

  it('T-UX-090b: a failed load is an alert with a retry, not an empty list', () => {
    renderRouted(<BatchHistoryPage loadFailed onRetry={() => {}} />);
    expect(screen.getByTestId('batches-load-error')).toHaveAttribute('role', 'alert');
    expect(screen.queryByText(BATCHES_EMPTY)).not.toBeInTheDocument();
  });
});

describe('T-UX-091 — §9.2 empty', () => {
  it('T-UX-091a: renders the §9.2 sentence and a route to /upload', () => {
    renderRouted(<BatchHistoryPage items={[]} />);
    expect(screen.getByText(BATCHES_EMPTY)).toBeInTheDocument();
    expect(screen.getByTestId('batches-empty-action')).toHaveAttribute('href', '/upload');
  });
});

describe('T-UX-092 — §9.3 populated', () => {
  it('T-UX-092a: one card per batch, each linking to its detail view', () => {
    renderRouted(
      <BatchHistoryPage
        items={[historyItem(), historyItem({ batchId: 'bat_2', service: 'max' })]}
      />,
    );
    const cards = screen.getAllByTestId('batch-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByTestId('batch-card-link')).toHaveAttribute(
      'href',
      '/batches/bat_1',
    );
    expect(within(cards[1]!).getByTestId('batch-card-service')).toHaveTextContent('Max');
  });

  it('T-UX-092b: the card carries the §9.3 count triple verbatim', () => {
    renderRouted(<BatchHistoryPage items={[historyItem()]} />);
    expect(screen.getByTestId('batch-card-counts')).toHaveTextContent(
      'Created 6 · Modified 0 · Removed 3',
    );
  });

  it('T-UX-092c: countsLine renders zeros rather than dropping a term', () => {
    // A card that omitted "Removed 0" would be indistinguishable from one where
    // the removal count was never computed — the fear US-031 exists to answer.
    expect(countsLine({ created: 0, modified: 0, removed: 0 })).toBe(
      'Created 0 · Modified 0 · Removed 0',
    );
  });

  it('T-UX-092d: an undone batch reads as undone, whatever its stored status', () => {
    renderRouted(
      <BatchHistoryPage items={[historyItem({ undoneAt: '2026-08-02T09:00:00.000Z' })]} />,
    );
    expect(screen.getByTestId('batch-card-status')).toHaveTextContent('undone');
  });
});

describe('T-UX-093 — §9.4 detail provenance', () => {
  const provenance = {
    created: [
      { titleId: 'ttl_1', listingId: 'lst_1', titleWasCreated: true },
      { titleId: 'ttl_2', listingId: 'lst_2', titleWasCreated: false },
    ],
    modified: [{ titleId: 'ttl_2', attr: 'tmdbId', before: null, after: 603 }],
    removed: [
      { titleId: 'ttl_3', listingId: 'lst_3', beforeState: 'active', groupId: 'grp_1' } as const,
    ],
  };
  const titles = [
    { titleId: 'ttl_1', name: 'The Matrix', year: 1999, state: 'active' },
    { titleId: 'ttl_2', name: 'Arrival', year: 2016, state: 'active' },
    { titleId: 'ttl_3', name: 'Dune', year: 2021, state: 'removed' },
  ];

  it('T-UX-093a: every entry in all three arrays is rendered — nothing is summarised away', () => {
    renderRouted(
      <BatchStatusPage batch={appliedBatch({ provenance, changedNothing: false, titles })} />,
    );
    expect(within(screen.getByTestId('provenance-created')).getAllByRole('listitem')).toHaveLength(
      2,
    );
    expect(within(screen.getByTestId('provenance-modified')).getAllByRole('listitem')).toHaveLength(
      1,
    );
    expect(within(screen.getByTestId('provenance-removed')).getAllByRole('listitem')).toHaveLength(
      1,
    );
  });

  it('T-UX-093b: each entry NAMES its title and links to it — a ULID is not a name', () => {
    renderRouted(
      <BatchStatusPage batch={appliedBatch({ provenance, changedNothing: false, titles })} />,
    );
    const links = screen.getAllByTestId('provenance-title-link');
    expect(links.map((link) => link.textContent)).toEqual([
      'The Matrix (1999)',
      'Arrival (2016)',
      'Arrival (2016)',
      'Dune (2021)removed',
    ]);
    // ⚠ The list anchor, NOT `/titles/:titleId` — there is no such route, so
    // that href would silently render the 404 page.
    expect(links[0]).toHaveAttribute('href', '/#title-ttl_1');
  });

  it('T-UX-093c: a title since removed carries its CURRENT state (US-033 AC-6)', () => {
    renderRouted(
      <BatchStatusPage batch={appliedBatch({ provenance, changedNothing: false, titles })} />,
    );
    expect(screen.getByTestId('provenance-title-state')).toHaveTextContent('removed');
  });

  it('T-UX-093d: an entry whose title is missing from the lookup still renders', () => {
    renderRouted(
      <BatchStatusPage batch={appliedBatch({ provenance, changedNothing: false, titles: [] })} />,
    );
    expect(screen.getAllByTestId('provenance-title-link')).toHaveLength(4);
  });

  it('T-UX-093e: an extracting batch shows NO provenance panel at all', () => {
    // Provenance rows are written at close (§3.10), so an in-flight batch has
    // three legitimately empty arrays — and §9.5's sentence over one would
    // announce an outcome for work that has not happened.
    renderRouted(
      <BatchStatusPage batch={appliedBatch({ status: 'extracting', completedAt: null })} />,
    );
    expect(screen.queryByTestId('batch-provenance')).not.toBeInTheDocument();
    expect(screen.queryByText(BATCH_CHANGED_NOTHING)).not.toBeInTheDocument();
    expect(showsProvenance(appliedBatch({ status: 'extracting' }))).toBe(false);
    expect(showsProvenance(appliedBatch())).toBe(true);
  });
});

describe('T-UX-094 — §9.5 a batch that changed nothing', () => {
  it('T-UX-094a: says so explicitly rather than rendering three empty panels', () => {
    renderRouted(<BatchStatusPage batch={appliedBatch()} />);
    expect(screen.getByTestId('batch-changed-nothing')).toHaveTextContent(BATCH_CHANGED_NOTHING);
    // Empty panels are indistinguishable from a failed load.
    expect(screen.queryByTestId('provenance-created')).not.toBeInTheDocument();
  });

  it('T-UX-094b: a batch that only MODIFIED something is never told it changed nothing', () => {
    renderRouted(
      <BatchStatusPage
        batch={appliedBatch({
          changedNothing: false,
          provenance: {
            created: [],
            modified: [{ titleId: 'ttl_9', attr: 'tmdbId', before: null, after: 42 }],
            removed: [],
          },
          titles: [{ titleId: 'ttl_9', name: 'Heat', year: 1995, state: 'active' }],
        })}
      />,
    );
    expect(screen.queryByTestId('batch-changed-nothing')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('provenance-modified')).getAllByRole('listitem')).toHaveLength(
      1,
    );
  });
});
