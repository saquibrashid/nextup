import { describe, expect, it } from 'vitest';

import {
  WORK_IDENTITY_RE,
  normaliseTitleText,
  workIdentityForTmdb,
  workIdentityForUnmatched,
} from '../src/index.js';

// TASK-015 — `specs/data-model.md` §2. The table below is MANDATORY: §2.2
// names it as a required table test, and every row is a case that has a
// different reason to exist.

const CASES: ReadonlyArray<readonly [input: string, expected: string, why: string]> = [
  ['Dune', 'dune', 'the trivial case'],
  ['The Batman', 'batman', 'leading "the" is stripped'],
  ['A Quiet Place', 'quiet place', 'leading "a" is stripped'],
  ['An American Tail', 'american tail', 'leading "an" is stripped'],
  ['Amélie', 'amelie', 'NFKD decomposition then combining marks removed'],
  ['Spider-Man: No Way Home', 'spider man no way home', 'punctuation becomes whitespace'],
  ['WALL·E', 'wall e', 'a non-ASCII separator is still just punctuation'],
  ['9-1-1', '9 1 1', 'digits survive; hyphens do not'],
  ['  Dune   (2021) ', 'dune 2021', 'whitespace collapsed, trimmed, year kept as text'],
  ['Andor', 'andor', 'a title that merely STARTS with "an" is not truncated'],
  ['THE the', 'the', 'exactly ONE leading article is stripped, not all of them'],
  ['', '', 'empty in, empty out — never a throw'],
];

describe('T-DM-001 normaliseTitleText', () => {
  it.each(CASES)('T-DM-001 · %j → %j (%s)', (input, expected) => {
    expect(normaliseTitleText(input)).toBe(expected);
  });

  it('T-DM-001a: normalisation is idempotent', () => {
    // Callers normalise at several points in the pipeline; a second pass that
    // changed the value would make identity depend on how many times a string
    // happened to travel through.
    for (const [input] of CASES) {
      const once = normaliseTitleText(input);
      expect(normaliseTitleText(once)).toBe(once);
    }
  });

  it('T-DM-001b: whitespace-only input normalises to empty, not to a space', () => {
    for (const input of ['   ', '\t\n', '---', '...']) {
      expect(normaliseTitleText(input)).toBe('');
    }
  });

  it('T-DM-001c: an article-only title is not emptied', () => {
    // Stripping the sole token would erase the title entirely.
    expect(normaliseTitleText('The')).toBe('the');
    expect(normaliseTitleText('A')).toBe('a');
  });

  it('T-DM-001d: no year is appended (SD-05)', () => {
    // A year appears on some captures of a tile and not on others, so folding
    // it into the identity splits one work in two — invisibly, as a bypassed
    // suppression. Kept as `extractedYear`, used only as a match hint.
    expect(normaliseTitleText('Dune')).toBe('dune');
    expect(normaliseTitleText('Dune')).not.toContain('2021');
  });
});

describe('T-DM-002 work identity', () => {
  it('T-DM-002a: a TMDB identity has the documented shape', () => {
    expect(workIdentityForTmdb('movie', 438631)).toBe('tmdb:movie:438631');
    expect(workIdentityForTmdb('tv', 66732)).toBe('tmdb:tv:66732');
    expect(workIdentityForTmdb('movie', 438631)).toMatch(WORK_IDENTITY_RE);
    expect(workIdentityForTmdb('tv', 66732)).toMatch(WORK_IDENTITY_RE);
  });

  it('T-DM-002b: a non-positive or non-integer TMDB id throws', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => workIdentityForTmdb('movie', bad)).toThrow(RangeError);
    }
  });

  it('T-DM-002c: an unmatched identity is 16 lowercase hex characters', () => {
    const id = workIdentityForUnmatched('Some Unknown Film');
    expect(id).toMatch(/^unmatched:[0-9a-f]{16}$/);
    expect(id).toMatch(WORK_IDENTITY_RE);
  });

  it('T-DM-002d: the unmatched identity is derived from the NORMALISED text', () => {
    // Everything the normaliser folds away must fold away here too, or two
    // captures of one tile become two works.
    const canonical = workIdentityForUnmatched('The Batman');
    for (const variant of ['the batman', 'THE BATMAN', '  The   Batman  ', 'The Batman!']) {
      expect(workIdentityForUnmatched(variant)).toBe(canonical);
    }
  });

  it('T-DM-002e: the year is NOT part of the unmatched identity input (SD-05)', () => {
    // Different text still means a different identity — this asserts that the
    // FUNCTION does not inject a year, not that years are ignored.
    expect(workIdentityForUnmatched('Dune')).not.toBe(workIdentityForUnmatched('Dune 2021'));
    expect(workIdentityForUnmatched('Dune')).toBe(workIdentityForUnmatched('dune'));
  });

  it('T-DM-002f: different works get different identities', () => {
    const ids = new Set(
      ['Dune', 'Andor', 'Severance', 'Arrival', 'Chernobyl'].map(workIdentityForUnmatched),
    );
    expect(ids.size).toBe(5);
  });

  it('T-DM-002g: the identity is stable across runs', () => {
    // A pinned digest: if the hash, the slice or the normaliser ever changes,
    // EVERY stored unmatched identity and every suppression keyed on one is
    // silently orphaned. That must be a deliberate, migrated decision — so it
    // must break this test first. Independently verified against Node's
    // `crypto.createHash('sha256').update('dune')`.
    expect(workIdentityForUnmatched('Dune')).toBe('unmatched:ab906be12ca6d9f2');
  });

  it('T-DM-002h: WORK_IDENTITY_RE rejects near-miss forms', () => {
    for (const bad of [
      'tmdb:movie:0',
      'tmdb:film:438631',
      'tmdb:movie:',
      'unmatched:B73BFFF2E78A9E01',
      'unmatched:b73bfff2',
      'unmatched:b73bfff2e78a9e011',
      ' tmdb:movie:438631',
      'tmdb:movie:438631\n',
      '',
    ]) {
      expect(WORK_IDENTITY_RE.test(bad)).toBe(false);
    }
  });
});
