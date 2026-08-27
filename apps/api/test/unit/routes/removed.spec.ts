/**
 * TASK-095 — the store-free half of `GET /api/removed` (`specs/api.md` §6.9).
 *
 * Every rejection path here is reachable without a database, which is what
 * lets CI job 4 — where coverage is measured and no SQL Server exists — assert
 * it. The integration suite proves the store-level properties; this one proves
 * the parsing, the cursor codec, the ranking and the projection.
 *
 * ⚠ `rankRemovals` is tested against DELIBERATELY UNSORTED input. It is called
 * with rows a SQL `ORDER BY` has already sorted, so a version that just walked
 * the array would pass every integration test — and would then silently
 * misnumber history the day the query, an index hint or a parallel plan
 * returned them in another order. A pure function that depends on its caller's
 * ordering without saying so is a trap, so the sort is asserted here.
 */

import { describe, expect, it } from 'vitest';

import { AppError } from '../../../src/errors/AppError.js';
import { rankRemovals, toRemovedItem, type RemovalRank } from '../../../src/routes/removed.js';
import {
  decodeRemovedCursor,
  encodeRemovedCursor,
  parseRemovedListQuery,
  MAX_Q_LENGTH,
} from '../../../src/routes/removedQuery.js';
import type { RemovedViewRow, WorkRemovalRow } from '../../../src/repository/ownerData.js';

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return error instanceof AppError ? error.code : 'NOT-AN-APP-ERROR';
  }
  return 'NO-ERROR';
};

const removal = (work: string, listingId: string, removedAt: string): WorkRemovalRow => ({
  work_identity: work,
  listing_id: listingId,
  removed_at: new Date(removedAt),
});

const row = (overrides: Partial<RemovedViewRow> = {}): RemovedViewRow => ({
  listing_id: 'l-1',
  title_id: 't-1',
  service: 'netflix',
  removed_at: new Date('2026-07-14T09:31:02.117Z'),
  date_added: new Date('2026-04-02T00:00:00.000Z'),
  removed_by_batch_id: 'b-1',
  removed_by_group_id: null,
  work_identity: 'tmdb:movie:438631',
  match_state: 'matched',
  tmdb_name: 'Dune',
  tmdb_media_type: 'movie',
  tmdb_release_year: 2021,
  tmdb_poster_path: '/d5NXS.jpg',
  raw_extracted_text: null,
  ...overrides,
});

const rank: RemovalRank = { ordinal: 2, total: 3 };

describe('parseRemovedListQuery', () => {
  it('T-REM-021e: accepts a bare request and applies the §6.9 defaults', () => {
    expect(parseRemovedListQuery({})).toEqual({
      q: undefined,
      service: undefined,
      limit: 50,
      cursor: undefined,
    });
  });

  it('T-REM-021f: trims the search term', () => {
    expect(parseRemovedListQuery({ q: '  dune  ' }).q).toBe('dune');
  });

  it('T-REM-021g: an empty or whitespace-only q is NO SEARCH, not "match nothing"', () => {
    // Refusing it would make a cleared search box an error; honouring it would
    // return zero rows and read as an empty removed log.
    expect(parseRemovedListQuery({ q: '' }).q).toBeUndefined();
    expect(parseRemovedListQuery({ q: '   ' }).q).toBeUndefined();
  });

  it('T-REM-021h: refuses a term longer than the §6.9 ceiling', () => {
    expect(parseRemovedListQuery({ q: 'a'.repeat(MAX_Q_LENGTH) }).q).toHaveLength(MAX_Q_LENGTH);
    expect(codeOf(() => parseRemovedListQuery({ q: 'a'.repeat(MAX_Q_LENGTH + 1) }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('T-REM-021i: refuses a repeated q rather than coercing the array', () => {
    expect(codeOf(() => parseRemovedListQuery({ q: ['a', 'b'] }))).toBe('VALIDATION_FAILED');
  });

  it('T-REM-022d: accepts a known service', () => {
    expect(parseRemovedListQuery({ service: 'max' }).service).toBe('max');
  });

  it('T-REM-022e: refuses an unknown service and does not echo it back', () => {
    let thrown: AppError | undefined;
    try {
      parseRemovedListQuery({ service: 'hulu' });
    } catch (error) {
      thrown = error as AppError;
    }
    expect(thrown?.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(thrown?.details ?? {})).not.toContain('hulu');
  });

  it('T-REM-022f: refuses a repeated service', () => {
    expect(codeOf(() => parseRemovedListQuery({ service: ['netflix', 'max'] }))).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('T-API-017c: a non-string cursor is INVALID_CURSOR, not VALIDATION_FAILED', () => {
    // One code for one situation: a client that cannot read its own cursor has
    // exactly one thing to react to.
    expect(codeOf(() => parseRemovedListQuery({ cursor: ['a', 'b'] }))).toBe('INVALID_CURSOR');
  });

  it('T-API-017d: a well-formed cursor round-trips through the query parser', () => {
    const cursor = { removedAt: '2026-07-14T09:31:02.117Z', listingId: 'l-1' };
    const parsed = parseRemovedListQuery({ cursor: encodeRemovedCursor(cursor) });
    expect(parsed.cursor).toEqual(cursor);
  });

  it('T-REM-020f: honours limit and refuses one out of range', () => {
    expect(parseRemovedListQuery({ limit: '10' }).limit).toBe(10);
    expect(codeOf(() => parseRemovedListQuery({ limit: '5000' }))).toBe('VALIDATION_FAILED');
  });
});

describe('decodeRemovedCursor', () => {
  it('T-API-017e: refuses a cursor whose key is a DATE rather than an instant', () => {
    // The removed view orders by `datetime2`. A whole full-update close shares
    // one instant, so a date-precision key is ambiguous across every removal
    // that day — and a keyset predicate over an ambiguous key SKIPS rows, which
    // the owner reads as the log having lost their history.
    const raw = Buffer.from(
      JSON.stringify({ removedAt: '2026-07-14', listingId: 'l-1' }),
      'utf8',
    ).toString('base64url');
    expect(codeOf(() => decodeRemovedCursor(raw))).toBe('INVALID_CURSOR');
  });

  it('T-API-017f: refuses junk, wrong shapes and extra keys', () => {
    const b64 = (value: unknown): string =>
      Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

    expect(codeOf(() => decodeRemovedCursor(''))).toBe('INVALID_CURSOR');
    expect(codeOf(() => decodeRemovedCursor('x'.repeat(513)))).toBe('INVALID_CURSOR');
    expect(codeOf(() => decodeRemovedCursor('!!!not-base64!!!'))).toBe('INVALID_CURSOR');
    expect(codeOf(() => decodeRemovedCursor(b64([1, 2])))).toBe('INVALID_CURSOR');
    expect(codeOf(() => decodeRemovedCursor(b64(null)))).toBe('INVALID_CURSOR');
    expect(
      codeOf(() =>
        decodeRemovedCursor(b64({ removedAt: '2026-07-14T09:31:02.117Z', listingId: 'l', x: 1 })),
      ),
    ).toBe('INVALID_CURSOR');
    expect(
      codeOf(() =>
        decodeRemovedCursor(b64({ removedAt: '2026-07-14T09:31:02.117Z', listingId: '' })),
      ),
    ).toBe('INVALID_CURSOR');
    expect(
      codeOf(() =>
        decodeRemovedCursor(
          b64({ removedAt: '2026-07-14T09:31:02.117Z', listingId: 'x'.repeat(201) }),
        ),
      ),
    ).toBe('INVALID_CURSOR');
  });

  it('T-API-017g: refuses a non-canonical encoding of an otherwise valid cursor', () => {
    // Node's base64 decoder is lenient enough that a tampered cursor often
    // decodes to the same bytes; re-encoding and comparing is what makes
    // tampering detectable at all without a signature.
    const canonical = encodeRemovedCursor({
      removedAt: '2026-07-14T09:31:02.117Z',
      listingId: 'l-1',
    });
    const reordered = Buffer.from(
      JSON.stringify({ listingId: 'l-1', removedAt: '2026-07-14T09:31:02.117Z' }),
      'utf8',
    ).toString('base64url');

    expect(decodeRemovedCursor(canonical)).toEqual({
      removedAt: '2026-07-14T09:31:02.117Z',
      listingId: 'l-1',
    });
    expect(codeOf(() => decodeRemovedCursor(reordered))).toBe('INVALID_CURSOR');
  });
});

describe('rankRemovals', () => {
  it('T-REM-006d: numbers a work\u2019s removals oldest-first regardless of input order', () => {
    const ranks = rankRemovals([
      removal('w1', 'c', '2026-07-01T00:00:00.000Z'),
      removal('w1', 'a', '2026-05-01T00:00:00.000Z'),
      removal('w1', 'b', '2026-06-01T00:00:00.000Z'),
    ]);

    expect(ranks.get('a')).toEqual({ ordinal: 1, total: 3 });
    expect(ranks.get('b')).toEqual({ ordinal: 2, total: 3 });
    expect(ranks.get('c')).toEqual({ ordinal: 3, total: 3 });
  });

  it('T-REM-006e: breaks a removal-instant tie by listing id ascending', () => {
    const shared = '2026-07-14T09:31:02.117Z';
    const ranks = rankRemovals([removal('w1', 'z', shared), removal('w1', 'a', shared)]);

    expect(ranks.get('a')?.ordinal).toBe(1);
    expect(ranks.get('z')?.ordinal).toBe(2);
  });

  it('T-REM-006f: keeps works independent \u2014 it never numbers across them', () => {
    const ranks = rankRemovals([
      removal('w1', 'a', '2026-05-01T00:00:00.000Z'),
      removal('w2', 'b', '2026-06-01T00:00:00.000Z'),
      removal('w1', 'c', '2026-07-01T00:00:00.000Z'),
    ]);

    expect(ranks.get('a')).toEqual({ ordinal: 1, total: 2 });
    expect(ranks.get('c')).toEqual({ ordinal: 2, total: 2 });
    expect(ranks.get('b')).toEqual({ ordinal: 1, total: 1 });
  });

  it('T-REM-006g: an empty history ranks nothing rather than throwing', () => {
    expect(rankRemovals([]).size).toBe(0);
  });
});

describe('toRemovedItem', () => {
  it('T-REM-020g: renders the §6.9 item, dates as a date and removals as an instant', () => {
    expect(toRemovedItem(row(), rank, false)).toEqual({
      listingId: 'l-1',
      titleId: 't-1',
      workIdentity: 'tmdb:movie:438631',
      matchState: 'matched',
      name: 'Dune',
      mediaType: 'movie',
      releaseYear: 2021,
      posterPath: '/d5NXS.jpg',
      service: 'netflix',
      dateAdded: '2026-04-02',
      removedAt: '2026-07-14T09:31:02.117Z',
      removedByBatchId: 'b-1',
      removedByGroupId: null,
      removalOrdinal: 2,
      removalTotalForWork: 3,
      restorable: true,
      suppressed: false,
    });
  });

  it('T-REM-021j: falls back to the raw extracted text for an UNMATCHED row', () => {
    const item = toRemovedItem(
      row({ tmdb_name: null, raw_extracted_text: 'Bladerunner 2049', match_state: 'unmatched' }),
      rank,
      false,
    );
    expect(item['name']).toBe('Bladerunner 2049');
  });

  it('T-REM-021k: a row with neither name renders empty, never a placeholder', () => {
    // Inventing a placeholder would hide from the owner that the title never
    // matched, which is the state fix-match exists to resolve.
    const item = toRemovedItem(row({ tmdb_name: null, raw_extracted_text: null }), rank, false);
    expect(item['name']).toBe('');
  });

  it('T-REM-020h: a suppressed work is not restorable', () => {
    expect(toRemovedItem(row(), rank, true)).toMatchObject({
      suppressed: true,
      restorable: false,
    });
  });
});
