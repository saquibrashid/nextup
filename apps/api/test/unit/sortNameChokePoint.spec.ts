/**
 * `T-API-029` — the `sortName` choke point in the repository (TASK-219).
 *
 * `withSortName` is what stops a derived column from being maintained at five
 * separate call sites. These are the two behaviours that are easy to get wrong
 * and invisible when wrong:
 *
 *  - a patch that does not mention a name must not touch the key, or a rating
 *    refresh would silently null the sort position of every row it touches;
 *  - Prisma's `{ set: value }` form must be REFUSED rather than stringified,
 *    because `[object Object]` is a plausible-looking wrong answer.
 */

import { deriveSortName } from '@nextup/domain';
import { describe, expect, it } from 'vitest';

import { withSortName } from '../../src/repository/ownerData.js';

describe('T-API-029 · withSortName', () => {
  it('T-API-029z · a patch with no name field is returned untouched', () => {
    // ⚠ THE FAILURE THIS PREVENTS IS SILENT. The lazy rating refresh patches
    // `imdbRatingTenths` alone; if the helper derived unconditionally it would
    // read `undefined` for both name fields, write `sortName: null`, and drop
    // that row to the bottom of the alphabet with no error anywhere.
    const patch: { imdbRatingTenths: number; tmdbName?: string | null } = {
      imdbRatingTenths: 82,
    };
    const result = withSortName(patch);
    expect(result).toEqual(patch);
    expect('sortName' in result).toBe(false);
  });

  it('T-API-029aa · a name patch derives the key through the domain rule', () => {
    expect(withSortName({ tmdbName: 'The Matrix' })).toEqual({
      tmdbName: 'The Matrix',
      sortName: deriveSortName({ tmdbName: 'The Matrix', rawExtractedText: null }),
    });
    expect(withSortName({ rawExtractedText: 'les misérables' })).toEqual({
      rawExtractedText: 'les misérables',
      sortName: deriveSortName({ tmdbName: null, rawExtractedText: 'les misérables' }),
    });
  });

  it('T-API-029ab · an explicit null name clears the key rather than skipping it', () => {
    // A confirmed match whose name TMDB does not carry is a real row state —
    // `tmdbFieldsFor` writes `known?.name ?? null`. It must reach the column
    // as `NULL`, not leave a stale key from the previous name behind.
    expect(withSortName({ tmdbName: null })).toEqual({ tmdbName: null, sortName: null });
  });

  it('T-API-029ac · Prisma\u2019s `{ set: … }` form is refused, not stringified', () => {
    expect(() => withSortName({ tmdbName: { set: 'Dune' } })).toThrow(/plain string/);
    expect(() => withSortName({ rawExtractedText: { set: null } })).toThrow(/plain string/);
  });
});
