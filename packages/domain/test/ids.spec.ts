import { describe, expect, it } from 'vitest';

import {
  ULID_LEN,
  ULID_MAX_TIME,
  ULID_RE,
  deterministicId,
  monotonicUlidFactory,
  ulid,
} from '../src/index.js';

// TASK-013 — `specs/data-model.md` §1.

describe('T-DM-004 ids', () => {
  it('T-DM-004a: a ULID is 26 Crockford base32 characters', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(ulid()).toMatch(ULID_RE);
    }
    expect(ulid()).toHaveLength(ULID_LEN);
  });

  it('T-DM-004b: the alphabet excludes I, L, O and U', () => {
    // Crockford drops them because they misread as 1, 1, 0 and an obscenity.
    // The owner reads these ids in URLs and support output.
    const generated = Array.from({ length: 300 }, () => ulid()).join('');
    expect(generated).not.toMatch(/[ILOU]/);
  });

  it('T-DM-004c: ULIDs are lexicographically ordered by time', () => {
    const early = ulid(1_000_000_000_000);
    const late = ulid(1_700_000_000_000);
    expect(early < late).toBe(true);
    // Sorting the strings must reproduce the chronological order.
    const times = [5, 1, 4, 2, 3].map((n) => n * 1_000_000_000);
    const ids = times.map((t) => ulid(t));
    expect([...ids].sort()).toEqual(
      times
        .slice()
        .sort((a, b) => a - b)
        .map((t) => ids[times.indexOf(t)]),
    );
  });

  it('T-DM-004d: distinct ULIDs within the same millisecond', () => {
    const at = 1_700_000_000_000;
    const ids = new Set(Array.from({ length: 1000 }, () => ulid(at)));
    expect(ids.size).toBe(1000);
  });

  it('T-DM-004e: an out-of-range timestamp throws rather than truncating', () => {
    expect(() => ulid(ULID_MAX_TIME + 1)).toThrow(RangeError);
    expect(() => ulid(-1)).toThrow(RangeError);
    expect(() => ulid(1.5)).toThrow(RangeError);
    expect(ulid(ULID_MAX_TIME)).toMatch(ULID_RE);
    expect(ulid(0)).toMatch(ULID_RE);
  });

  it('T-DM-004f: deterministicId is stable for the same seed', () => {
    // REQ-005/REQ-006: this is what makes a retry after a crash mid-apply
    // OVERWRITE the rows the first attempt wrote instead of duplicating them.
    const seed = '01J9ZQ0000000000000000BAT1:cand:7';
    expect(deterministicId(seed)).toBe(deterministicId(seed));
    expect(deterministicId(seed)).toMatch(ULID_RE);
  });

  it('T-DM-004g: deterministicId does not depend on the clock', () => {
    // A clock-derived prefix would make the id depend on WHEN the retry ran,
    // which is exactly the variable that must not matter.
    const seed = 'batch:candidate';
    const first = deterministicId(seed);
    const before = ulid();
    expect(deterministicId(seed)).toBe(first);
    expect(first.slice(0, 10)).not.toBe(before.slice(0, 10));
  });

  it('T-DM-004h: different seeds give different ids', () => {
    const ids = new Set(Array.from({ length: 500 }, (_, i) => deterministicId(`seed:${i}`)));
    expect(ids.size).toBe(500);
    // A one-character difference must not collide.
    expect(deterministicId('batch:1')).not.toBe(deterministicId('batch:2'));
  });

  it('T-DM-004i: an empty seed throws', () => {
    // Silently hashing "" would give every caller with a missing id the SAME
    // id — a duplicate-overwrite bug that looks like data loss.
    expect(() => deterministicId('')).toThrow(RangeError);
  });

  it('T-DM-004j: the monotonic factory is strictly increasing and reproducible', () => {
    const at = 1_700_000_000_000;
    const next = monotonicUlidFactory();
    const run = Array.from({ length: 50 }, () => next(at));
    expect([...run].sort()).toEqual(run);
    expect(new Set(run).size).toBe(50);
    for (const id of run) expect(id).toMatch(ULID_RE);

    // Same seed, same sequence — a test that fails must fail the same way twice.
    const again = monotonicUlidFactory();
    expect(Array.from({ length: 50 }, () => again(at))).toEqual(run);
  });

  it('T-DM-004k: the monotonic factory stays ordered across a millisecond boundary', () => {
    const next = monotonicUlidFactory();
    const ids = [next(1_700_000_000_000), next(1_700_000_000_000), next(1_700_000_000_001)];
    expect([...ids].sort()).toEqual(ids);
  });
});
