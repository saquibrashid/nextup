import { describe, expect, it } from 'vitest';

import {
  WATCH_PRIORITIES,
  isWatchPriority,
  parseWatchPreferencesPatch,
  watchPriorityRank,
} from '../src/watchPreferences.js';

describe('T-WATCH-001 owner preference grammar', () => {
  it('T-WATCH-001a keeps watching independent of all three priorities', () => {
    expect(WATCH_PRIORITIES).toEqual(['up-next', 'normal', 'someday']);
    for (const priority of WATCH_PRIORITIES) {
      for (const watching of [false, true]) {
        expect(parseWatchPreferencesPatch({ watching, priority })).toEqual({
          ok: true,
          value: { watching, priority },
        });
      }
      expect(parseWatchPreferencesPatch({ priority })).toEqual({ ok: true, value: { priority } });
    }
    expect(parseWatchPreferencesPatch({ watching: false })).toEqual({
      ok: true,
      value: { watching: false },
    });
  });

  it('T-WATCH-001b rejects empty, extra, coerced, and invalid fields', () => {
    for (const body of [
      undefined,
      null,
      [],
      1,
      'normal',
      {},
      { watching: 'true' },
      { watching: 1 },
      { watching: null },
      { watching: undefined },
      { priority: null },
      { priority: undefined },
      { priority: 'NORMAL' },
      { priority: 'normal ' },
      { priority: 'next' },
      { priority: ['normal'] },
      { watching: false, ownerId: 'someone' },
      { watching: false, priority: 'bad' },
      { watching: 'false', priority: 'normal' },
    ]) {
      expect(parseWatchPreferencesPatch(body), JSON.stringify(body)).toMatchObject({ ok: false });
    }
    expect(isWatchPriority('normal')).toBe(true);
    expect(isWatchPriority('Normal')).toBe(false);
  });

  it('T-WATCH-001c ranks watching ahead of every non-watching choice', () => {
    for (const priority of WATCH_PRIORITIES) {
      expect(watchPriorityRank({ watching: true, priority })).toBe(0);
    }
    expect(
      WATCH_PRIORITIES.map((priority) => watchPriorityRank({ watching: false, priority })),
    ).toEqual([1, 2, 3]);
  });
});
