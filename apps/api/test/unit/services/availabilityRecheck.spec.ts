/**
 * US-068 AC-3 — the pure half of "Re-check everything": ordering, the cursor
 * and the progress counts. No I/O, no clock of its own.
 */

import { describe, expect, it } from 'vitest';

import {
  formatRecheckCursor,
  parseCheckBody,
  parseRecheckCursor,
  recheckProgress,
  selectForRecheckAll,
  type CheckCandidate,
} from '../../../src/services/availabilityReview.js';

const T0 = new Date('2026-10-10T12:00:00Z');
const at = (minutes: number): Date => new Date(T0.getTime() - minutes * 60_000);

const candidate = (
  id: string,
  checkedAt: Date | null,
  overrides: { tmdbId?: number | null } = {},
): CheckCandidate => ({
  kind: 'title',
  row: {
    id,
    workIdentity: id,
    tmdbId: overrides.tmdbId === undefined ? 1 : overrides.tmdbId,
    tmdbMediaType: 'movie',
    availabilityRegion: 'US',
    availabilityCheckedAt: checkedAt,
    availableOn: [],
    rentOn: [],
    streamingSince: null,
  },
});

const ids = (rows: readonly CheckCandidate[]): string[] => rows.map((row) => row.row.id);

describe('T-RECHECK-004 · US-068 AC-3 · the re-check walk is ordered, cursor-driven and finite', () => {
  it('T-RECHECK-004a: least recently checked first, never-checked first of all, ties by id', () => {
    const rows = [
      candidate('c', at(5)),
      candidate('b', at(5)),
      candidate('a', at(50)),
      candidate('never', null),
    ];
    expect(ids(selectForRecheckAll(rows, T0, null))).toEqual(['never', 'a', 'b', 'c']);
  });

  it('T-RECHECK-004b: ignores age; skips rows answered since the walk began and rows with no TMDB id', () => {
    const rows = [
      candidate('fresh', at(1)),
      candidate('done', at(-1)),
      candidate('nothing', null, { tmdbId: null }),
    ];
    expect(ids(selectForRecheckAll(rows, T0, null))).toEqual(['fresh']);
    expect(recheckProgress(rows, T0, null)).toEqual({ total: 2, remaining: 1 });
  });

  it('T-RECHECK-004c: the cursor moves strictly forward, so a failed row is not picked again', () => {
    const rows = [candidate('x', at(30)), candidate('y', at(20)), candidate('z', at(10))];
    const first = selectForRecheckAll(rows, T0, null, 2);
    expect(ids(first)).toEqual(['x', 'y']);
    // 'x' failed and kept its stamp; the cursor is the last row attempted.
    const after = parseRecheckCursor(
      formatRecheckCursor({ checkedAtMs: at(20).getTime(), id: 'y' }),
    );
    expect(after).toEqual({ checkedAtMs: at(20).getTime(), id: 'y' });
    expect(ids(selectForRecheckAll(rows, T0, after, 2))).toEqual(['z']);
    expect(recheckProgress(rows, T0, after)).toEqual({ total: 3, remaining: 1 });
  });

  it('T-RECHECK-004d: a cursor must be one this server issues', () => {
    expect(parseRecheckCursor('12:abc-1_x')).toEqual({ checkedAtMs: 12, id: 'abc-1_x' });
    for (const bad of ['', 'abc', '12:', ':abc', '12:a b', '-1:abc', '12:abc:def']) {
      expect(parseRecheckCursor(bad), bad).toBeNull();
    }
  });

  it('T-RECHECK-004e: the body defaults to the stale-only scope and validates the all scope', () => {
    expect(parseCheckBody(undefined, T0)).toEqual({ scope: 'stale' });
    expect(parseCheckBody({}, T0)).toEqual({ scope: 'stale' });
    expect(parseCheckBody({ scope: 'all' }, T0)).toEqual({
      scope: 'all',
      since: null,
      after: null,
    });
    const parsed = parseCheckBody({ scope: 'all', since: T0.toISOString(), cursor: '5:abc' }, T0);
    expect(parsed).toEqual({ scope: 'all', since: T0, after: { checkedAtMs: 5, id: 'abc' } });
    expect(() => parseCheckBody({ scope: 'all', since: 'soon' }, T0)).toThrow();
    expect(() => parseCheckBody({ scope: 'all', cursor: '5:abc' }, T0)).toThrow();
  });
});
