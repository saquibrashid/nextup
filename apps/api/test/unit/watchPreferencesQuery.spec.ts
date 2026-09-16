import { describe, expect, it } from 'vitest';

import {
  decodeWatchPriorityCursor,
  encodeCursor,
  encodeWatchPriorityCursor,
} from '../../src/pagination.js';
import { parseTitleListQuery, TITLE_SORTS } from '../../src/routes/titlesQuery.js';

describe('T-WATCH-002 watch filters and strict sort-specific cursors', () => {
  it('T-WATCH-002a accepts bounded OR priorities and single watching without changing date defaults', () => {
    expect(TITLE_SORTS).toContain('watchPriority');
    expect(parseTitleListQuery({})).toMatchObject({
      watching: undefined,
      priorities: [],
      sort: 'dateAdded',
      dir: 'desc',
    });
    expect(
      parseTitleListQuery({
        sort: 'watchPriority',
        watching: 'false',
        priority: ['normal', 'up-next', 'normal'],
      }),
    ).toMatchObject({
      sort: 'watchPriority',
      dir: 'asc',
      watching: false,
      priorities: ['normal', 'up-next'],
    });
    expect(parseTitleListQuery({ watching: 'true', priority: 'someday' })).toMatchObject({
      watching: true,
      priorities: ['someday'],
    });
    for (const watching of ['1', 'True', '', ['true'], ['false', 'true'], { a: 'true' }]) {
      expect(() => parseTitleListQuery({ watching })).toThrow();
    }
    for (const priority of [
      '',
      'Normal',
      'upNext',
      Array<string>(21).fill('normal'),
      { a: 'normal' },
    ]) {
      expect(() => parseTitleListQuery({ priority })).toThrow();
    }
  });

  it('T-WATCH-002b round trips all ranks and rejects wrong sorts, shape, bounds, IDs, and encoding', () => {
    for (const watchPriorityRank of [0, 1, 2, 3]) {
      const cursor = { watchPriorityRank, id: 'watch-title' };
      const raw = encodeWatchPriorityCursor(cursor);
      expect(decodeWatchPriorityCursor(raw)).toEqual(cursor);
      expect(parseTitleListQuery({ sort: 'watchPriority', cursor: raw }).cursor).toEqual(cursor);
      for (const sort of TITLE_SORTS.filter((sort) => sort !== 'watchPriority')) {
        expect(() => parseTitleListQuery({ sort, cursor: raw })).toThrow();
      }
      expect(() => decodeWatchPriorityCursor(`${raw}=`)).toThrow();
    }
    const raw = (body: unknown) => Buffer.from(JSON.stringify(body)).toString('base64url');
    for (const body of [
      null,
      [],
      {},
      { watchPriorityRank: 0, id: 'x', extra: 1 },
      ...[-1, 4, 0.5, null, '0'].map((watchPriorityRank) => ({ watchPriorityRank, id: 'x' })),
      ...['', 'x'.repeat(201), 1].map((id) => ({ watchPriorityRank: 0, id })),
      { id: 'x', watchPriorityRank: 0 },
    ]) {
      expect(() => decodeWatchPriorityCursor(raw(body))).toThrow();
    }
    expect(() => decodeWatchPriorityCursor('bad')).toThrow();
    expect(() =>
      parseTitleListQuery({
        sort: 'watchPriority',
        cursor: encodeCursor({ sortDateAdded: '2026-01-01', id: 'x' }),
      }),
    ).toThrow();
  });
});
