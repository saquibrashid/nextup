/**
 * TASK-036 — the list ordering rule (US-020), unit level.
 *
 * `T-LIST-014` / `T-LIST-015` are the sort-KEY assertions (`sortDateAdded` is
 * the earliest date across non-removed listings, and it moves when the
 * earliest listing is removed). `T-LIST-016` is the tie-breaker and
 * `T-LIST-017` the null placement.
 *
 * ⚠ `T-INV-010` (`derive.spec.ts`) already asserts `deriveSortDateAdded`'s
 * behaviour and is NOT superseded by anything here — `specs/testing.md` §9
 * records that the sweep briefly re-pointed TASK-016 at these ids and would
 * have discarded eight passing assertions. What these cases add is the
 * ORDERING that key feeds: a correct key ordered by a comparator that flips
 * its tie-break with direction still produces a list that reshuffles when the
 * owner reverses it.
 */

import { describe, expect, it } from 'vitest';

import {
  compareTitlesForList,
  deriveSortDateAdded,
  sortTitlesForList,
  type OrderableTitle,
} from '../src/index.js';

const row = (id: string, sortDateAdded: string | null): OrderableTitle => ({ id, sortDateAdded });

const listing = (dateAdded: string, state: 'active' | 'removed' = 'active') => ({
  dateAdded,
  state,
});

describe('T-LIST-014 sortDateAdded is the earliest date across non-removed listings', () => {
  it('T-LIST-014a: the EARLIEST date wins, not the latest and not the first seen', () => {
    expect(
      deriveSortDateAdded([listing('2026-04-09'), listing('2026-04-02'), listing('2026-04-20')]),
    ).toBe('2026-04-02');
  });

  it('T-LIST-014b: adding a LATER listing does not move the row (US-020 AC-4)', () => {
    const before = deriveSortDateAdded([listing('2026-04-02')]);
    const after = deriveSortDateAdded([listing('2026-04-02'), listing('2026-09-30')]);
    expect(after).toBe(before);

    // The point of AC-4 stated as ORDER, not just as a value: a row that keeps
    // its key keeps its position relative to a neighbour.
    const neighbour = row('t-b', '2026-06-01');
    expect(compareTitlesForList(row('t-a', before), neighbour, 'desc')).toBe(
      compareTitlesForList(row('t-a', after), neighbour, 'desc'),
    );
  });

  it('T-LIST-014c: a removed listing is ignored even when it is the earliest', () => {
    expect(deriveSortDateAdded([listing('2026-01-01', 'removed'), listing('2026-04-02')])).toBe(
      '2026-04-02',
    );
  });

  it('T-LIST-014d: dates compare as text, so no host timezone can shift a day', () => {
    // 2026-01-01 in a UTC-5 zone is 2025-12-31 locally. A Date-based min would
    // pick differently depending on where the container runs.
    expect(deriveSortDateAdded([listing('2026-01-01'), listing('2025-12-31')])).toBe('2025-12-31');
  });
});

describe('T-LIST-015 removing the earliest listing recomputes the key and may move the row', () => {
  it('T-LIST-015a: removing the earliest listing advances the key (US-020 AC-5)', () => {
    const before = deriveSortDateAdded([listing('2026-04-02'), listing('2026-09-30')]);
    const after = deriveSortDateAdded([listing('2026-04-02', 'removed'), listing('2026-09-30')]);
    expect(before).toBe('2026-04-02');
    expect(after).toBe('2026-09-30');
  });

  it('T-LIST-015b: and the row MOVES — the recomputation is observable as order', () => {
    const neighbour = row('t-b', '2026-06-01');
    // Newest-first: 2026-04-02 sits after the neighbour, 2026-09-30 before it.
    expect(compareTitlesForList(row('t-a', '2026-04-02'), neighbour, 'desc')).toBeGreaterThan(0);
    expect(compareTitlesForList(row('t-a', '2026-09-30'), neighbour, 'desc')).toBeLessThan(0);
  });

  it('T-LIST-015c: removing EVERY listing gives a null key, not the last known date', () => {
    expect(
      deriveSortDateAdded([listing('2026-04-02', 'removed'), listing('2026-09-30', 'removed')]),
    ).toBeNull();
  });
});

describe('T-LIST-016 ties break by id ascending, in both directions', () => {
  const tied = [row('t-c', '2026-04-02'), row('t-a', '2026-04-02'), row('t-b', '2026-04-02')];

  it('T-LIST-016a: tied rows order by id ascending under the desc default', () => {
    expect(sortTitlesForList(tied, 'desc').map((r) => r.id)).toEqual(['t-a', 't-b', 't-c']);
  });

  it('T-LIST-016b: ⚠ the tie order is UNCHANGED under asc — it does not flip', () => {
    // This is the assertion the original `orderBy: [{ date: dir }, { id: dir }]`
    // failed. It reads as symmetric and is not: reversing the sort silently
    // reshuffled every group of rows sharing a date.
    expect(sortTitlesForList(tied, 'asc').map((r) => r.id)).toEqual(['t-a', 't-b', 't-c']);
  });

  it('T-LIST-016c: repeated sorts of a shuffled input give an IDENTICAL sequence', () => {
    const shuffles = [
      [tied[0], tied[1], tied[2]],
      [tied[2], tied[0], tied[1]],
      [tied[1], tied[2], tied[0]],
    ] as OrderableTitle[][];
    const sequences = shuffles.map((s) =>
      sortTitlesForList(s, 'desc')
        .map((r) => r.id)
        .join(','),
    );
    expect(new Set(sequences).size).toBe(1);
  });

  it('T-LIST-016d: the tie-breaker only applies to EQUAL dates', () => {
    // Non-vacuity: if the comparator ignored the date and sorted by id alone,
    // 016a–c would still pass. A later date must beat a smaller id under desc.
    expect(sortTitlesForList([row('t-a', '2026-04-02'), row('t-z', '2026-09-30')], 'desc')).toEqual(
      [row('t-z', '2026-09-30'), row('t-a', '2026-04-02')],
    );
  });

  it('T-LIST-016e: the comparator is a total order — equal rows compare 0', () => {
    expect(compareTitlesForList(row('t-a', '2026-04-02'), row('t-a', '2026-04-02'), 'desc')).toBe(
      0,
    );
    expect(compareTitlesForList(row('t-a', '2026-04-02'), row('t-a', '2026-04-02'), 'asc')).toBe(0);
  });

  it('T-LIST-016f: it is antisymmetric — swapping the arguments flips the sign', () => {
    const a = row('t-a', '2026-04-02');
    const b = row('t-b', '2026-09-30');
    for (const dir of ['asc', 'desc'] as const) {
      expect(Math.sign(compareTitlesForList(a, b, dir))).toBe(
        -Math.sign(compareTitlesForList(b, a, dir)),
      );
    }
  });
});

describe('T-LIST-017 a null sortDateAdded sorts LAST and never crashes the comparator', () => {
  it('T-LIST-017a: a dateless row sorts last under the desc default', () => {
    const sorted = sortTitlesForList([row('t-null', null), row('t-a', '2026-04-02')], 'desc');
    expect(sorted.map((r) => r.id)).toEqual(['t-a', 't-null']);
  });

  it('T-LIST-017b: ⚠ and STILL last under asc — nulls-last is absolute, not a default', () => {
    // Under `asc` a naive comparator (or SQL Server's own default) puts nulls
    // FIRST, so a dateless row would head the list the moment the owner used
    // the oldest-first control. That control is `must` (product invariant 6).
    const sorted = sortTitlesForList([row('t-null', null), row('t-a', '2026-04-02')], 'asc');
    expect(sorted.map((r) => r.id)).toEqual(['t-a', 't-null']);
  });

  it('T-LIST-017c: two dateless rows still order deterministically, by id ascending', () => {
    const sorted = sortTitlesForList([row('t-z', null), row('t-a', null)], 'desc');
    expect(sorted.map((r) => r.id)).toEqual(['t-a', 't-z']);
  });

  it('T-LIST-017d: a null never throws, in either argument position or direction', () => {
    const n = row('t-null', null);
    const d = row('t-a', '2026-04-02');
    for (const dir of ['asc', 'desc'] as const) {
      expect(() => compareTitlesForList(n, d, dir)).not.toThrow();
      expect(() => compareTitlesForList(d, n, dir)).not.toThrow();
      expect(() => compareTitlesForList(n, n, dir)).not.toThrow();
    }
  });

  it('T-LIST-017e: nulls stay last even when they outnumber the dated rows', () => {
    // Guards a comparator that is correct pairwise but not a consistent total
    // order — Array#sort with an inconsistent comparator produces an
    // engine-dependent result that passes small cases and fails larger ones.
    const rows = [
      row('t-n1', null),
      row('t-n2', null),
      row('t-a', '2026-04-02'),
      row('t-n3', null),
      row('t-n4', null),
    ];
    for (const dir of ['asc', 'desc'] as const) {
      expect(sortTitlesForList(rows, dir).map((r) => r.id)).toEqual([
        't-a',
        't-n1',
        't-n2',
        't-n3',
        't-n4',
      ]);
    }
  });

  it('T-LIST-017f: sorting does not mutate the caller\u2019s array', () => {
    const rows = [row('t-b', '2026-01-01'), row('t-a', '2026-09-30')];
    const snapshot = rows.map((r) => r.id);
    sortTitlesForList(rows, 'desc');
    expect(rows.map((r) => r.id)).toEqual(snapshot);
  });
});
