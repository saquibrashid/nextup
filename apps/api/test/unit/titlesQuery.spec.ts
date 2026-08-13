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
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  decodeCursor,
  encodeCursor,
  parseLimit,
} from '../../src/pagination.js';
import { DEFAULT_SORT_DIRECTION, parseTitleListQuery } from '../../src/routes/titlesQuery.js';

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
    expect(thrown(() => parseTitleListQuery({ sort: 'name' })).details['field']).toBe('sort');
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

  it('T-LIST-029f: type is single-valued; repeating it is a 400', () => {
    expect(parseTitleListQuery({ type: 'movie' }).mediaType).toBe('movie');
    // "movie OR tv" is the same as no filter — a request that looks like a
    // narrowing and is not.
    expect(thrown(() => parseTitleListQuery({ type: ['movie', 'tv'] })).details['field']).toBe(
      'type',
    );
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
