/**
 * `T-NAV-001` — one set of names across the navigation, the page headings and
 * the owner-facing copy (issue 369, TASK-250, `specs/ui-refresh.md` §6b).
 *
 * ⚠ **A RENAME THAT STOPS AT THE NAV IS WORSE THAN NONE.** "Library" in the
 * menu and "Your list" as the heading it opens, or "Review" in the menu and
 * "Batch history" on the page, tells the owner there are two places. These
 * cases pin the names the owner chose and fail on any retired one.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { App } from '../src/App';
import * as copy from '../src/copy';
import type { BatchHistoryItem } from '../src/lib/apiClient';
import { BatchHistoryPage, needsReview } from '../src/pages/BatchHistoryPage';
import { ROUTES } from '../src/routes';

afterEach(cleanup);

const OWNER_NAMES = {
  '/': 'Library',
  '/upload': 'Import',
  '/batches': 'Review',
  '/rating': 'Rating lookup',
} as const;

const RETIRED = /^(List|Upload|Batches|Batch history|Check a rating|More)$/;

function item(overrides: Partial<BatchHistoryItem>): BatchHistoryItem {
  return {
    batchId: 'b_1',
    service: 'netflix',
    mode: 'append-only',
    status: 'applied',
    createdAt: '2026-08-01T10:00:00.000Z',
    submittedAt: '2026-08-01T10:01:00.000Z',
    completedAt: '2026-08-01T10:05:00.000Z',
    undoneAt: null,
    counts: { created: 1, modified: 0, removed: 0 },
    ...overrides,
  };
}

describe('T-NAV-001 — consistent destination names', () => {
  it('T-NAV-001a: the route table carries the owner-approved names and no retired one', () => {
    for (const [path, name] of Object.entries(OWNER_NAMES)) {
      expect(ROUTES.find((route) => route.path === path)?.navLabel, path).toBe(name);
    }
    for (const route of ROUTES) {
      if (route.navLabel !== null) expect(route.navLabel).not.toMatch(RETIRED);
    }
  });

  it('T-NAV-001b: each renamed destination opens on a heading that uses its name', async () => {
    // `/upload` opens on its capture checkpoint until the server answers; its
    // "Import screenshots" heading is asserted in a browser by the e2e suite.
    const expected: Record<string, RegExp> = {
      '/': /^Library$/,
      '/batches': /^Review$/,
      '/rating': /^Rating lookup$/,
    };
    for (const [path, heading] of Object.entries(expected)) {
      render(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>,
      );
      const h1 = await screen.findByRole('heading', { level: 1 });
      expect(h1.textContent, path).toMatch(heading);
      cleanup();
    }
  });

  it('T-NAV-001c: no owner-facing copy constant uses the retired wording', () => {
    const retiredPhrases = /\byour list\b|\bthis batch\b|\bBatch history\b|\bCheck a rating\b/i;
    const offenders = Object.entries(copy)
      .filter(([, value]) => typeof value === 'string' && retiredPhrases.test(value))
      .map(([key]) => key);
    expect(offenders).toStrictEqual([]);
  });
});

describe('T-NAV-001 — the Review page separates work from history', () => {
  const items = [
    item({ batchId: 'b_review', status: 'in-review', completedAt: null }),
    item({ batchId: 'b_draft', status: 'draft', completedAt: null }),
    item({ batchId: 'b_applied', status: 'applied' }),
    item({ batchId: 'b_undone', status: 'applied', undoneAt: '2026-08-02T00:00:00.000Z' }),
    item({ batchId: 'b_discarded', status: 'discarded', completedAt: null }),
  ];

  it('T-NAV-001d: only imports with a next step are under "Needs review"', () => {
    expect(items.filter(needsReview).map((entry) => entry.batchId)).toStrictEqual([
      'b_review',
      'b_draft',
    ]);

    render(
      <MemoryRouter>
        <BatchHistoryPage items={items} />
      </MemoryRouter>,
    );
    const pending = screen.getByRole('region', { name: copy.BATCHES_NEEDS_REVIEW_TITLE });
    const history = screen.getByRole('region', { name: copy.BATCHES_HISTORY_TITLE });

    expect(within(pending).getAllByTestId('batch-card')).toHaveLength(2);
    expect(within(history).getAllByTestId('batch-card')).toHaveLength(3);
  });

  it('T-NAV-001e: with nothing pending there is no "Needs review" section at all', () => {
    // ⚠ An empty "Needs review" heading over finished imports implies work
    // the owner has already done is still waiting on them.
    render(
      <MemoryRouter>
        <BatchHistoryPage items={[items[2]!, items[3]!]} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('heading', { name: copy.BATCHES_NEEDS_REVIEW_TITLE })).toBeNull();
    expect(screen.getByRole('heading', { name: copy.BATCHES_HISTORY_TITLE })).toBeInTheDocument();
  });
});
