/**
 * TASK-033 — the `GET /api/titles` query contract, unit level.
 *
 * These are the paths that must be reachable WITHOUT a database. They are here
 * rather than in the integration suite for two reasons: coverage is measured on
 * the unit and web projects only (CI job 4 has no store), so an assertion that
 * lives only in `test/integration/` counts as zero; and a rejection that needs
 * a running SQL Server to prove is a rejection nobody will run locally.
 *
 * `T-API-017` is the load-bearing one. The tempting implementation of an
 * unreadable cursor is to shrug and return page 1, and that is the single
 * behaviour this product must not have — the owner paging through their list
 * would see the top of it again and reasonably conclude rows had vanished.
 */

import { describe, expect, it } from 'vitest';

import { AppError } from '../../src/errors/AppError.js';
import { RUNTIME_BUCKETS, SORT_NAME_MAX_LENGTH } from '@nextup/domain';
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  decodeCursor,
  decodeNameCursor,
  decodeRatingCursor,
  decodeReleaseYearCursor,
  decodeRuntimeCursor,
  encodeCursor,
  encodeNameCursor,
  encodeRatingCursor,
  encodeReleaseYearCursor,
  encodeRuntimeCursor,
  parseLimit,
} from '../../src/pagination.js';
import {
  DEFAULT_SORT_DIRECTION,
  TITLE_SORTS,
  defaultDirectionFor,
  parseTitleListQuery,
} from '../../src/routes/titlesQuery.js';

/** Runs `fn` and returns the AppError it threw, failing if it threw nothing. */
function thrown(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError, but nothing was thrown');
}

const VALID = { sortDateAdded: '2026-04-02', id: '01J8ZC000000000000000000' };

describe('T-API-030 library title search query', () => {
  it('T-API-030a trims search and treats absent or blank search as unfiltered', () => {
    expect(parseTitleListQuery({ q: '  The Matrix  ' }).q).toBe('The Matrix');
    for (const query of [{}, { q: '' }, { q: ' \t ' }]) {
      expect(parseTitleListQuery(query).q).toBeUndefined();
    }
  });

  it('T-API-030b bounds the trimmed string without truncating it', () => {
    expect(parseTitleListQuery({ q: ` ${'x'.repeat(500)} ` }).q).toHaveLength(500);
    const error = thrown(() => parseTitleListQuery({ q: 'x'.repeat(501) }));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(error.httpStatus).toBe(400);
    expect(error.details).toEqual({ field: 'q', maxLength: 500 });
  });

  it('T-API-030c refuses repeated or structured search, even identical repeats', () => {
    for (const q of [['Dune', 'Dune'], { text: 'Dune' }]) {
      expect(thrown(() => parseTitleListQuery({ q })).details.field).toBe('q');
    }
  });

  it('T-API-030d preserves literal punctuation and all other filter and cursor dimensions', () => {
    const query = {
      service: ['netflix', 'max'],
      type: 'movie',
      genre: 'Drama',
      runtime: 'under30',
      sort: 'dateAdded',
      dir: 'asc',
      limit: '1',
      cursor: encodeCursor(VALID),
    };
    expect(parseTitleListQuery({ ...query, q: "100%_[!] O'Brien" })).toEqual({
      ...parseTitleListQuery(query),
      q: "100%_[!] O'Brien",
    });
  });
});

describe('T-API-017 an unreadable pagination cursor is a loud 400', () => {
  it('T-API-017a: a cursor this server issued round-trips exactly', () => {
    expect(decodeCursor(encodeCursor(VALID))).toEqual(VALID);
  });

  it('T-API-017b: a tampered cursor is INVALID_CURSOR, never a reset to page 1', () => {
    // The whole point: the response must not be the first page. A silent reset
    // is indistinguishable, from the owner's side, from rows disappearing.
    const tampered = `${encodeCursor(VALID)}X`;
    const error = thrown(() => decodeCursor(tampered));

    expect(error.code).toBe('INVALID_CURSOR');
    expect(error.httpStatus).toBe(400);
  });

  it('T-API-017c: base64url of something that is not JSON is refused', () => {
    const raw = Buffer.from('definitely not json', 'utf8').toString('base64url');
    expect(thrown(() => decodeCursor(raw)).code).toBe('INVALID_CURSOR');
  });

  it('T-API-017d: valid JSON of the wrong shape is refused', () => {
    for (const value of ['null', '[]', '"a string"', '42', '{}']) {
      const raw = Buffer.from(value, 'utf8').toString('base64url');
      expect(thrown(() => decodeCursor(raw)).code, value).toBe('INVALID_CURSOR');
    }
  });

  it('T-API-017e: an extra key is refused even when the two real keys are right', () => {
    // Accepting extras would make the cursor's shape a de-facto public contract
    // that clients are explicitly forbidden from parsing (specs/api.md §3).
    const raw = Buffer.from(JSON.stringify({ ...VALID, limit: 999 }), 'utf8').toString('base64url');
    expect(thrown(() => decodeCursor(raw)).code).toBe('INVALID_CURSOR');
  });

  it('T-API-017f: a malformed or non-string sort date is refused', () => {
    for (const sortDateAdded of ['2026-4-2', 'yesterday', '', 20260402]) {
      const raw = Buffer.from(JSON.stringify({ sortDateAdded, id: VALID.id }), 'utf8').toString(
        'base64url',
      );
      expect(thrown(() => decodeCursor(raw)).code, String(sortDateAdded)).toBe('INVALID_CURSOR');
    }
  });

  it('T-API-017g: an empty, over-long or non-string id is refused', () => {
    for (const id of ['', 'x'.repeat(201), 12345]) {
      const raw = Buffer.from(
        JSON.stringify({ sortDateAdded: VALID.sortDateAdded, id }),
        'utf8',
      ).toString('base64url');
      expect(thrown(() => decodeCursor(raw)).code, String(id)).toBe('INVALID_CURSOR');
    }
  });

  it('T-API-017h: an empty or absurdly long cursor is refused', () => {
    expect(thrown(() => decodeCursor('')).code).toBe('INVALID_CURSOR');
    expect(thrown(() => decodeCursor('a'.repeat(513))).code).toBe('INVALID_CURSOR');
  });

  it('T-API-017i: a non-canonical encoding of a VALID position is still refused', () => {
    // Re-ordered keys decode to the same object but are not a cursor we issued.
    // Without the re-encode comparison this passes, and "tampered" becomes
    // undetectable for every case that happens to parse.
    const raw = Buffer.from(
      JSON.stringify({ id: VALID.id, sortDateAdded: VALID.sortDateAdded }),
      'utf8',
    ).toString('base64url');
    expect(thrown(() => decodeCursor(raw)).code).toBe('INVALID_CURSOR');
  });

  it('T-API-017j: the error message never echoes the submitted cursor back', () => {
    const error = thrown(() => decodeCursor(`${encodeCursor(VALID)}<script>`));
    expect(`${error.message}${JSON.stringify(error.details)}`).not.toContain('script');
  });

  it('T-API-017k: a repeated cursor param is INVALID_CURSOR, not VALIDATION_FAILED', () => {
    // One situation, one code for the client to react to.
    const error = thrown(() => parseTitleListQuery({ cursor: ['a', 'b'] }));
    expect(error.code).toBe('INVALID_CURSOR');
  });
});

describe('T-API-018 limit is bounded and refused rather than clamped', () => {
  it('T-API-018a: absent limit is the documented default of 50', () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
    expect(DEFAULT_PAGE_LIMIT).toBe(50);
  });

  it('T-API-018b: the boundaries 1 and 200 are accepted', () => {
    expect(parseLimit('1')).toBe(1);
    expect(parseLimit(String(MAX_PAGE_LIMIT))).toBe(MAX_PAGE_LIMIT);
  });

  it('T-API-018c: out of range is a 400, NOT silently clamped', () => {
    // Clamping 5000 to 200 returns a page the caller did not ask for and gives
    // no hint why the rest is missing.
    for (const raw of ['0', '201', '5000']) {
      const error = thrown(() => parseLimit(raw));
      expect(error.code, raw).toBe('VALIDATION_FAILED');
      expect(error.details['field'], raw).toBe('limit');
    }
  });

  it('T-API-018d: a non-numeric limit is a 400', () => {
    for (const raw of ['abc', '1.5', '-1', '', '12345', ['1', '2']]) {
      expect(thrown(() => parseLimit(raw)).code, String(raw)).toBe('VALIDATION_FAILED');
    }
  });
});

describe('T-LIST-029 the list query contract', () => {
  it('T-LIST-029a: an empty query is newest-first, default page size, no filters', () => {
    const query = parseTitleListQuery({});

    // ⚠ Newest-first is the CONFIRMED default (REQ-038, owner decision A44).
    expect(query.dir).toBe('desc');
    expect(DEFAULT_SORT_DIRECTION).toBe('desc');
    expect(query.sort).toBe('dateAdded');
    expect(query.limit).toBe(DEFAULT_PAGE_LIMIT);
    expect(query.services).toEqual([]);
    expect(query.mediaType).toBeUndefined();
    expect(query.genres).toEqual([]);
    expect(query.cursor).toBeUndefined();
  });

  it('T-LIST-029b: dir=asc is accepted — the oldest-first control is a must', () => {
    // Product invariant 6: this is the sole escape hatch for the accepted
    // newest-first vs SUC-003 trade-off. It is not optional scope.
    expect(parseTitleListQuery({ dir: 'asc' }).dir).toBe('asc');
  });

  it('T-LIST-029c: an unknown sort or dir is a 400', () => {
    expect(thrown(() => parseTitleListQuery({ sort: 'title' })).details['field']).toBe('sort');
    expect(thrown(() => parseTitleListQuery({ dir: 'sideways' })).details['field']).toBe('dir');
  });

  it('T-LIST-029d: service accepts one value or several, de-duplicated', () => {
    expect(parseTitleListQuery({ service: 'netflix' }).services).toEqual(['netflix']);
    expect(parseTitleListQuery({ service: ['netflix', 'max'] }).services).toEqual([
      'netflix',
      'max',
    ]);
    expect(parseTitleListQuery({ service: ['max', 'max'] }).services).toEqual(['max']);
  });

  it('T-LIST-029e: an unsupported service is a 400 that does not echo the value', () => {
    const error = thrown(() => parseTitleListQuery({ service: '<img src=x onerror=1>' }));
    expect(error.code).toBe('VALIDATION_FAILED');
    expect(`${error.message}${JSON.stringify(error.details)}`).not.toContain('onerror');
  });

  it('T-LIST-029f: types OR together, duplicates retain their restriction and invalid values fail', () => {
    expect(parseTitleListQuery({ type: 'movie' }).mediaType).toBe('movie');
    expect(parseTitleListQuery({ type: 'tv' }).mediaType).toBe('tv');
    expect(parseTitleListQuery({ type: ['movie', 'movie'] }).mediaType).toBe('movie');
    expect(parseTitleListQuery({ type: ['movie', 'tv'] }).mediaType).toBeUndefined();
    expect(parseTitleListQuery({ type: ['tv', 'movie'] }).mediaType).toBeUndefined();
    expect(thrown(() => parseTitleListQuery({ type: 'documentary' })).code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('T-LIST-029g: genres are trimmed, and blank or over-long ones are refused', () => {
    expect(parseTitleListQuery({ genre: ['  Drama  ', 'Comedy'] }).genres).toEqual([
      'Drama',
      'Comedy',
    ]);
    expect(thrown(() => parseTitleListQuery({ genre: '   ' })).details['field']).toBe('genre');
    expect(thrown(() => parseTitleListQuery({ genre: 'x'.repeat(61) })).code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('T-LIST-029h: a repeatable filter cannot be repeated without bound', () => {
    const many = Array.from({ length: 21 }, (_, i) => `g${String(i)}`);
    expect(thrown(() => parseTitleListQuery({ genre: many })).code).toBe('VALIDATION_FAILED');
  });

  it("T-LIST-029i: Express's nested-object query form is refused, not coerced", () => {
    // `?service[x]=y` arrives as an object. Coercing it yields "[object
    // Object]" as a filter value and a silently empty list.
    expect(thrown(() => parseTitleListQuery({ service: { x: 'netflix' } })).code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('T-LIST-029j: a valid cursor is decoded into a position', () => {
    expect(parseTitleListQuery({ cursor: encodeCursor(VALID) }).cursor).toEqual(VALID);
  });

  it('T-LIST-029k: the query parser never reads an owner id from the query string', () => {
    // ⚠ T-SEC-006. A caller who can name the owner can read any owner's list.
    const query = parseTitleListQuery({ ownerId: 'someone-else', owner: 'someone-else' });
    expect(Object.values(query as unknown as Record<string, unknown>)).not.toContain(
      'someone-else',
    );
    expect(Object.keys(query)).not.toContain('ownerId');
  });
});

describe('REQ-035 / REQ-037 - the runtime filter and sort query (`specs/ui-refresh.md` §5a)', () => {
  it('T-API-021a an unrecognised runtime bucket is a 400, not a silently ignored filter', () => {
    // The §3 enum rule. Dropping the token instead would answer an unfiltered
    // list to a request that explicitly asked for a filter - the owner sees
    // more titles than they asked for and nothing says why.
    const error = thrown(() => parseTitleListQuery({ runtime: '90min' }));
    expect(error.httpStatus).toBe(400);
    expect(error.code).toBe('VALIDATION_FAILED');
  });

  it('T-API-021b every bucket the domain defines is accepted', () => {
    // Pinned against the domain constant rather than a copied list: a bucket
    // added there and forgotten here would be a 400 on a token the UI renders.
    for (const bucket of RUNTIME_BUCKETS) {
      expect(parseTitleListQuery({ runtime: bucket }).runtimes).toEqual([bucket]);
    }
  });

  it('T-API-021c repeated buckets are OR-ed within the dimension', () => {
    expect(parseTitleListQuery({ runtime: ['under30', 'over120'] }).runtimes).toEqual([
      'under30',
      'over120',
    ]);
  });

  it('T-API-021d absent means no runtime filter, never a default bucket', () => {
    expect(parseTitleListQuery({}).runtimes).toEqual([]);
  });

  it('T-API-021g legacy runtime expands both canonical halves and deduplicates mixed repeats', () => {
    expect(parseTitleListQuery({ runtime: '60-120' }).runtimes).toEqual(['60-90', '90-120']);
    expect(
      parseTitleListQuery({
        runtime: ['under30', '90-120', '60-120', '60-90', '60-120', 'over120'],
      }).runtimes,
    ).toEqual(['under30', '90-120', '60-90', 'over120']);
  });

  it('T-API-021h runtime repetition is capped before alias expansion and deduplication', () => {
    const atLimit = Array.from({ length: 20 }, () => '60-120');
    expect(parseTitleListQuery({ runtime: atLimit }).runtimes).toEqual(['60-90', '90-120']);
    for (const value of ['60-120', '60-90']) {
      const error = thrown(() =>
        parseTitleListQuery({ runtime: Array.from({ length: 21 }, () => value) }),
      );
      expect(error.httpStatus).toBe(400);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details).toEqual({ field: 'runtime', max: 20 });
    }
  });

  it('T-API-021i unknown or structured runtime tokens remain a 400 beside valid aliases', () => {
    for (const runtime of [
      ['60-120', '90min'],
      ['60-90', ''],
      ['60-120', { nested: '90-120' }],
      { nested: '60-120' },
    ]) {
      const error = thrown(() => parseTitleListQuery({ runtime }));
      expect(error.httpStatus).toBe(400);
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.details.field).toBe('runtime');
    }
  });

  it('T-API-021e: an unrecognised sort key is a 400', () => {
    // ⚠ INCLUDING `imdbRating` - REQ-095 / `A51`. The rating is display-only;
    // a sort key for it must not exist on either side.
    expect(thrown(() => parseTitleListQuery({ sort: 'imdbRating' })).httpStatus).toBe(400);
    // ⚠ `name` USED TO BE THE SECOND EXAMPLE HERE and is now a real key
    // (TASK-219). `title` replaces it as the plausible-but-absent one — the
    // assertion is about unrecognised keys, not about `name` specifically.
    expect(thrown(() => parseTitleListQuery({ sort: 'title' })).httpStatus).toBe(400);
  });

  it('T-API-021f: the sort key defaults to dateAdded when absent', () => {
    expect(parseTitleListQuery({}).sort).toBe('dateAdded');
    expect(parseTitleListQuery({ sort: 'runtime' }).sort).toBe('runtime');
  });
});

describe('the cursor is SORT-AWARE (`specs/api.md` §3)', () => {
  const RUNTIME_POSITION = { runtimeMinutes: 115, id: '01J8ZC000000000000000000' };

  it('T-API-019n: a runtime cursor round-trips exactly', () => {
    expect(decodeRuntimeCursor(encodeRuntimeCursor(RUNTIME_POSITION))).toEqual(RUNTIME_POSITION);
  });

  it('T-API-019o: a NULL runtime is a legitimate, encodable position', () => {
    // ⚠ NOT A DEFENSIVE CASE. Runtime sorts nulls LAST, so the tail of every
    // runtime-ordered list is the unknown block. Refusing to encode it would
    // truncate the list at the first unknown runtime - silently, and exactly
    // where the owner is least able to notice.
    const atNull = { runtimeMinutes: null, id: '01J8ZC000000000000000000' };
    expect(decodeRuntimeCursor(encodeRuntimeCursor(atNull))).toEqual(atNull);
  });

  it('T-API-019p: a DATE cursor handed to the runtime decoder is a loud 400, not a wrong page', () => {
    // ⚠ THIS IS WHY THE TWO SHAPES ARE DISCRIMINATED BY THEIR KEY SET rather
    // than by a `sort` field inside the envelope. With a `sort` field the two
    // would be structurally identical and a cursor cut from one ordering would
    // be accepted by the other - producing a keyset predicate that does not
    // mirror its own ORDER BY, which skips and repeats rows at every page
    // boundary. That is indistinguishable from data loss and invisible to any
    // test that never asks for a second page.
    const error = thrown(() => decodeRuntimeCursor(encodeCursor(VALID)));
    expect(error.httpStatus).toBe(400);
    expect(error.code).toBe('INVALID_CURSOR');
  });

  it('T-API-019q: a RUNTIME cursor handed to the date decoder is a loud 400 too', () => {
    // The same property in the other direction - this is the one the owner
    // actually hits, by switching the sort while a page is loaded.
    const error = thrown(() => decodeCursor(encodeRuntimeCursor(RUNTIME_POSITION)));
    expect(error.httpStatus).toBe(400);
    expect(error.code).toBe('INVALID_CURSOR');
  });

  it('T-API-019r: the query parser decodes the cursor belonging to the ACTIVE sort', () => {
    expect(
      parseTitleListQuery({ sort: 'runtime', cursor: encodeRuntimeCursor(RUNTIME_POSITION) })
        .cursor,
    ).toEqual(RUNTIME_POSITION);
    expect(parseTitleListQuery({ cursor: encodeCursor(VALID) }).cursor).toEqual(VALID);
  });

  it('T-API-019s: mixing a cursor with the other sort is rejected by the parser, not by the database', () => {
    expect(
      thrown(() => parseTitleListQuery({ sort: 'runtime', cursor: encodeCursor(VALID) })).code,
    ).toBe('INVALID_CURSOR');
    expect(
      thrown(() => parseTitleListQuery({ cursor: encodeRuntimeCursor(RUNTIME_POSITION) })).code,
    ).toBe('INVALID_CURSOR');
  });
});

describe('the two NEW sort cursors are distinct shapes, not one nullable-int shape (`A53`)', () => {
  const YEAR = { releaseYear: 1999, id: '01J8ZC000000000000000000' };
  const RATING = { ratingTenths: 84, id: '01J8ZC000000000000000000' };

  it('T-API-027l: a year cursor round-trips, and `null` is a legitimate position', () => {
    expect(decodeReleaseYearCursor(encodeReleaseYearCursor(YEAR))).toEqual(YEAR);
    const atNull = { releaseYear: null, id: '01J8ZC000000000000000000' };
    expect(decodeReleaseYearCursor(encodeReleaseYearCursor(atNull))).toEqual(atNull);
  });

  it('T-API-023l: a rating cursor round-trips, and `null` is a legitimate position', () => {
    expect(decodeRatingCursor(encodeRatingCursor(RATING))).toEqual(RATING);
    const atNull = { ratingTenths: null, id: '01J8ZC000000000000000000' };
    expect(decodeRatingCursor(encodeRatingCursor(atNull))).toEqual(atNull);
  });

  it('T-API-023m: the YEAR and RATING cursors are NOT interchangeable', () => {
    // ⚠ THE REASON THE KEY NAMES DIFFER. Both are `{ nullable int, id }`. Had
    // they shared a key name they would be structurally identical, and a
    // cursor cut from a year-ordered list would be silently accepted by a
    // rating-ordered one — a keyset that does not mirror its own ORDER BY,
    // skipping and repeating rows at every boundary. Discrimination by key set
    // is what makes that a loud 400 instead.
    expect(thrown(() => decodeRatingCursor(encodeReleaseYearCursor(YEAR))).code).toBe(
      'INVALID_CURSOR',
    );
    expect(thrown(() => decodeReleaseYearCursor(encodeRatingCursor(RATING))).code).toBe(
      'INVALID_CURSOR',
    );
  });

  it('T-API-023n: a FLOAT rating is refused — the column is tenths', () => {
    // ⚠ 8.4 rather than 84. A float compares unpredictably against an integer
    // column, so the boundary row vanishes and the page is quietly one row
    // short. Nothing reports that, which is why it is refused at the door.
    const float = Buffer.from(JSON.stringify({ ratingTenths: 8.4, id: 'x' }), 'utf8').toString(
      'base64url',
    );
    expect(thrown(() => decodeRatingCursor(float)).code).toBe('INVALID_CURSOR');
  });

  it('T-API-027m: the parser routes each sort to its OWN decoder', () => {
    expect(
      parseTitleListQuery({ sort: 'releaseYear', cursor: encodeReleaseYearCursor(YEAR) }).cursor,
    ).toEqual(YEAR);
    expect(
      parseTitleListQuery({ sort: 'rating', cursor: encodeRatingCursor(RATING) }).cursor,
    ).toEqual(RATING);
    expect(
      thrown(() => parseTitleListQuery({ sort: 'rating', cursor: encodeReleaseYearCursor(YEAR) }))
        .code,
    ).toBe('INVALID_CURSOR');
  });

  it('T-API-029ad: `sort=name` is a supported key and routes to the NAME decoder', () => {
    // ⚠ THIS TEST REPLACES A DEFERRAL ASSERTION, AND ITS ORIGINAL INTENT
    // SURVIVES INTACT: a `name` key that silently fell back to `dateAdded`
    // would be a sort that appears to work and does nothing. What changed at
    // TASK-219 is that `name` is now REAL — backed by a stored `sort_name`
    // column with an explicit `Latin1_General_100_CI_AI` override — so the
    // assertion is now that it is accepted AND decoded as itself.
    expect(TITLE_SORTS as readonly string[]).toContain('name');

    const cursor = { sortName: 'matrix', id: 't-1' };
    expect(parseTitleListQuery({ sort: 'name', cursor: encodeNameCursor(cursor) }).cursor).toEqual(
      cursor,
    );

    // A cursor from another sort must not be quietly reinterpreted.
    expect(
      thrown(() => parseTitleListQuery({ sort: 'name', cursor: encodeReleaseYearCursor(YEAR) }))
        .code,
    ).toBe('INVALID_CURSOR');
    expect(
      thrown(() => parseTitleListQuery({ sort: 'rating', cursor: encodeNameCursor(cursor) })).code,
    ).toBe('INVALID_CURSOR');
  });

  it('T-API-029f: a bare `?sort=name` opens at A, not at Z', () => {
    // ⚠ INVISIBLE TO EVERY UI TEST. The client always sends an explicit `dir`,
    // so only a bookmark or a hand-typed URL reaches this path — and the
    // global default is `desc`, which is right for "newest first" and exactly
    // backwards for an alphabetical list.
    expect(parseTitleListQuery({ sort: 'name' }).dir).toBe('asc');
    expect(defaultDirectionFor('name')).toBe('asc');
    expect(defaultDirectionFor('dateAdded')).toBe(DEFAULT_SORT_DIRECTION);
    expect(parseTitleListQuery({ sort: 'name', dir: 'desc' }).dir).toBe('desc');
  });

  it('T-API-029ae: the name cursor round-trips, including the nameless position', () => {
    for (const cursor of [
      { sortName: 'matrix', id: 't-1' },
      { sortName: null, id: 't-2' },
      { sortName: 'misérables, les'.slice(0, 20), id: 't-3' },
    ]) {
      expect(decodeNameCursor(encodeNameCursor(cursor))).toEqual(cursor);
    }
  });

  it('T-API-029af: a name cursor longer than the COLUMN is refused', () => {
    // A value that cannot exist in `NVARCHAR(500)` names no row, so the keyset
    // boundary would match nothing and the page would come back empty — which
    // reads as "the rest of my list is gone" rather than as an error.
    const over = Buffer.from(
      JSON.stringify({ sortName: 'x'.repeat(SORT_NAME_MAX_LENGTH + 1), id: 't-1' }),
      'utf8',
    ).toString('base64url');
    expect(thrown(() => decodeNameCursor(over)).code).toBe('INVALID_CURSOR');

    const extra = Buffer.from(
      JSON.stringify({ sortName: 'a', id: 't-1', dir: 'asc' }),
      'utf8',
    ).toString('base64url');
    expect(thrown(() => decodeNameCursor(extra)).code).toBe('INVALID_CURSOR');
  });

  it('T-API-029ag: a hand-edited name cursor is refused rather than honoured', () => {
    // ⚠ THE CANONICAL RE-ENCODE IS THE GUARD. Two different byte strings can
    // decode to the same object — reordered keys, padded base64, whitespace in
    // the JSON — and accepting them would make a cursor a mutable, forgeable
    // handle on someone's page position rather than an opaque token.
    const reordered = Buffer.from(JSON.stringify({ id: 't-1', sortName: 'a' }), 'utf8').toString(
      'base64url',
    );
    expect(thrown(() => decodeNameCursor(reordered)).code).toBe('INVALID_CURSOR');

    const padded = Buffer.from(
      JSON.stringify({ sortName: 'a', id: 't-1' }, null, 1),
      'utf8',
    ).toString('base64url');
    expect(thrown(() => decodeNameCursor(padded)).code).toBe('INVALID_CURSOR');
  });

  it('T-API-029ah: a name cursor with no usable id is refused', () => {
    // The `id` is the tie-break, and ties are COMMON under CI_AI — `Amelie`
    // and `Amélie` compare equal. Without a usable id the keyset is not total
    // and a page boundary landing on a tie drops or repeats a row.
    for (const id of [null, '', 42]) {
      const bad = Buffer.from(JSON.stringify({ sortName: 'a', id }), 'utf8').toString('base64url');
      expect(thrown(() => decodeNameCursor(bad)).code).toBe('INVALID_CURSOR');
    }
  });
});

describe('T-WATCH-002i · the `status` filter parameter', () => {
  it('T-WATCH-002i: repeats OR together, de-duplicate, collapse to no filter when all chosen, and refuse unknowns', () => {
    expect(parseTitleListQuery({}).statuses).toEqual([]);
    expect(parseTitleListQuery({ status: 'watching' }).statuses).toEqual(['watching']);
    expect(parseTitleListQuery({ status: ['up-next', 'watching', 'up-next'] }).statuses).toEqual([
      'up-next',
      'watching',
    ]);
    expect(
      parseTitleListQuery({ status: ['watching', 'up-next', 'normal', 'someday'] }).statuses,
    ).toEqual([]);
    expect(thrown(() => parseTitleListQuery({ status: 'paused' })).details.field).toBe('status');
    expect(thrown(() => parseTitleListQuery({ status: { a: 'watching' } })).details.field).toBe(
      'status',
    );
  });
});
