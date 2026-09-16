/**
 * TASK-216 — the new sort keys and the REQ-041 synchronous rating sweep
 * (`A53`, ADR-0011 Revision 1, `specs/api.md` §6.2a).
 *
 * Over real HTTP with the repository and the refresh mocked. The store-level
 * ordering belongs to the integration suite and is asserted there against a
 * real SQL Server; what is proven HERE is what the HANDLER does — which cursor
 * it issues, which scope it sweeps, and, above all, WHEN it sweeps.
 *
 * ⚠ It also carries the coverage. `npm run coverage` excludes the integration
 * project, so a route proven only there scores zero.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listTitlePage = vi.fn();
const listTitleRatingRows = vi.fn();
const countRuntimeUnknown = vi.fn();

/** Every event, in the order the handler produced it. */
let trace: string[] = [];

const runRatingRefresh = vi.fn(async () => {
  trace.push('sweep');
  return 0;
});
const beginRatingRefresh = vi.fn(() => {
  trace.push('lazy');
});

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    listTitlePage: (...args: unknown[]) => {
      trace.push('order-by');
      return listTitlePage(...args) as unknown;
    },
    listTitleRatingRows: (...args: unknown[]) => listTitleRatingRows(...args) as unknown,
    countRuntimeUnknown: (...args: unknown[]) => countRuntimeUnknown(...args) as unknown,
  };
});

vi.mock('../../src/jobs/refreshRatings.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/jobs/refreshRatings.js')>();
  return {
    ...actual,
    runRatingRefresh: (...args: unknown[]) => runRatingRefresh(...(args as [])) as unknown,
    beginRatingRefresh: (...args: unknown[]) => beginRatingRefresh(...(args as [])) as unknown,
  };
});

const { createApp } = await import('../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../src/middleware/allowList.js');
const { decodeNameCursor, decodeRatingCursor, decodeReleaseYearCursor } =
  await import('../../src/pagination.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-titles-sort';

const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
      { typ: OID, val: SUBJECT },
      { typ: 'preferred_username', val: 'owner@example.com' },
    ],
  }),
  'utf8',
).toString('base64');

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 't-1',
    workIdentity: 'tmdb:movie:438631',
    matchState: 'matched',
    rawExtractedText: null,
    sortDateAdded: new Date('2026-04-02T00:00:00.000Z'),
    tmdbMediaType: 'movie',
    tmdbName: 'Dune',
    tmdbReleaseYear: 2021,
    tmdbRuntimeMinutes: 155,
    tmdbGenres: JSON.stringify(['Science Fiction']),
    tmdbPosterPath: '/poster.jpg',
    tmdbRefreshedAt: new Date(),
    imdbId: 'tt1160419',
    imdbRatingTenths: 84,
    imdbRatingFetchedAt: new Date(),
    listings: [
      { listingId: 'l-1', service: 'netflix', dateAdded: new Date('2026-04-02T00:00:00.000Z') },
    ],
    ...overrides,
  };
}

interface ListBody {
  items: unknown[];
  nextCursor: string | null;
}

interface ErrorBody {
  error: { code: string; message: string };
}

let server: Server;
let app: Express;
let origin: string;

const get = (qs: string): Promise<Response> =>
  fetch(`${origin}/api/titles${qs}`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });

beforeEach(async () => {
  vi.clearAllMocks();
  trace = [];
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;

  listTitlePage.mockResolvedValue({ rows: [row()], hasMore: false });
  listTitleRatingRows.mockResolvedValue([]);
  countRuntimeUnknown.mockResolvedValue(0);

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('T-API-023 · `sort=rating` reaches the store as a rating ordering', () => {
  it('T-API-030e forwards the same trimmed search to paging, rating scope and hidden count', async () => {
    const res = await get('?q=%20Dune%20&sort=rating&runtime=under30&genre=Drama&service=max');
    expect(res.status).toBe(200);
    for (const read of [listTitlePage, listTitleRatingRows, countRuntimeUnknown]) {
      expect(read.mock.calls[0]?.[1]).toMatchObject({
        q: 'Dune',
        genres: ['Drama'],
        services: ['max'],
      });
    }
    expect(trace.indexOf('sweep')).toBeLessThan(trace.indexOf('order-by'));
  });

  it('T-API-030f rejects malformed search before any library or refresh lookup', async () => {
    const res = await get('?q=Dune&q=Arrival');
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    expect(listTitlePage).not.toHaveBeenCalled();
    expect(listTitleRatingRows).not.toHaveBeenCalled();
    expect(countRuntimeUnknown).not.toHaveBeenCalled();
    expect(runRatingRefresh).not.toHaveBeenCalled();
  });

  it('T-API-023a · the sort is forwarded, not silently dropped', async () => {
    const res = await get('?sort=rating&dir=desc');
    expect(res.status).toBe(200);
    expect(listTitlePage.mock.calls[0]?.[1]).toMatchObject({ sort: 'rating', dir: 'desc' });
  });

  it('T-API-023b · the next cursor carries TENTHS, and `null` is a real position', async () => {
    // ⚠ The stored integer, never the displayed 8.4. A float here compares
    // unpredictably against an integer column and the boundary row vanishes —
    // a page that is quietly one row short, which no status code reports.
    listTitlePage.mockResolvedValue({ rows: [row({ id: 't-9' })], hasMore: true });
    const first = (await (await get('?sort=rating')).json()) as ListBody;
    expect(decodeRatingCursor(first.nextCursor as string)).toEqual({
      ratingTenths: 84,
      id: 't-9',
    });

    // ⚠ An UNRATED last row still yields a cursor. Refusing to encode `null`
    // would truncate every rating-sorted list at the first unrated title —
    // silently, and exactly where the owner is least able to notice.
    listTitlePage.mockResolvedValue({
      rows: [row({ id: 't-0', imdbRatingTenths: null })],
      hasMore: true,
    });
    const second = (await (await get('?sort=rating')).json()) as ListBody;
    expect(decodeRatingCursor(second.nextCursor as string)).toEqual({
      ratingTenths: null,
      id: 't-0',
    });
  });
});

describe('T-API-024 · REQ-041 · the sweep runs before the ordering, never after the response', () => {
  it('T-API-024a · the sweep is awaited BEFORE the ordered read', async () => {
    // ⚠ THE MOST IMPORTANT ASSERTION IN THIS EPIC. The rating is the only
    // MUTABLE sort key. If the refresh stays where every other sort leaves it
    // — after `res.json` — then a write outside the request reorders a list
    // the owner is already looking at, which product invariant 5 forbids. The
    // symptom is not an error: the list simply comes back in a different order
    // next time, and "move the await out of the hot path" reads like a
    // performance fix.
    const res = await get('?sort=rating');
    expect(res.status).toBe(200);
    expect(trace.indexOf('sweep')).toBeGreaterThan(-1);
    expect(trace.indexOf('sweep')).toBeLessThan(trace.indexOf('order-by'));
    expect(runRatingRefresh).toHaveBeenCalledTimes(1);
  });

  it('T-API-024b · the sweep scope is the FILTERED SET, not the page', async () => {
    // ⚠ Sweeping the page renders fresh values into an order computed from
    // stale ones — an 8.4 sitting below a 7.1. The scope query carries every
    // active filter and NO cursor and NO limit, which is what makes it the
    // sortable set rather than a slice of it.
    await get('?sort=rating&service=netflix&genre=Action&runtime=under30');
    const scope = listTitleRatingRows.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(scope).toMatchObject({ services: ['netflix'], genres: ['Action'] });
    expect(scope).not.toHaveProperty('cursor');
    expect(scope).not.toHaveProperty('limit');
  });

  it('T-API-024c · under every OTHER sort the sweep does not run at all', async () => {
    // The synchronous cost is paid only where it buys correctness. A date- or
    // runtime-ordered list cannot be reordered by a rating write, so it keeps
    // the lazy after-the-response refresh.
    await get('?sort=dateAdded');
    expect(runRatingRefresh).not.toHaveBeenCalled();
    expect(trace).toEqual(['order-by', 'lazy']);
  });
});

describe('T-API-025 · an exhausted sweep is still a 200', () => {
  it('T-API-025a · a sweep that throws does not fail the list', async () => {
    // The list is the subject of the page; the rating is decoration on it.
    // Unrefreshed rows keep their cached-or-absent value and are ordered on
    // it, which is honest — it is the same number the row displays.
    runRatingRefresh.mockRejectedValueOnce(new Error('budget exhausted'));
    const res = await get('?sort=rating');
    expect(res.status).toBe(200);
    expect(((await res.json()) as ListBody).items).toHaveLength(1);
  });
});

describe('T-API-026 · an unrecognised sort is a 400, never a silent default', () => {
  it('T-API-026a · a mistyped key is rejected', async () => {
    const res = await get('?sort=ratings');
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    expect(listTitlePage).not.toHaveBeenCalled();
  });
});

describe('T-API-029 · `sort=name` reaches the store and pages on the stored key', () => {
  it('T-API-029x · `sort=name` reaches the store as itself', async () => {
    // ⚠ THIS REPLACES A DEFERRAL ASSERTION AND KEEPS ITS POINT. The old test
    // asserted `sort=name` was a 400 because, under `Latin1_General_100_BIN2`,
    // an unqualified `ORDER BY tmdb_name` is BINARY order — `apple` after
    // `Zebra` — and on a title-cased fixture it still LOOKS alphabetical.
    // TASK-219 removed that hazard by storing a `sort_name` column with an
    // explicit `Latin1_General_100_CI_AI` override, so the key is now real.
    // What must never change is the other half: `name` must arrive at the
    // repository AS `name`. A silent fall back to `dateAdded` would be a sort
    // that appears to work and does nothing.
    await get('?sort=name&dir=asc');
    expect(listTitlePage.mock.calls[0]?.[1]).toMatchObject({ sort: 'name', dir: 'asc' });
    await get('?sort=name&dir=desc');
    expect(listTitlePage.mock.calls[1]?.[1]).toMatchObject({ sort: 'name', dir: 'desc' });
  });

  it('T-API-029y · the name cursor carries the STORED key, not the displayed title', async () => {
    // ⚠ THEY DIFFER WHENEVER AN ARTICLE WAS STRIPPED. `The Matrix` occupies
    // the position `Matrix`; a cursor built from the display name would name a
    // position further down the alphabet and skip every row between.
    listTitlePage.mockResolvedValue({
      rows: [row({ id: 't-9', tmdbName: 'The Matrix', sortName: 'Matrix' })],
      hasMore: true,
    });
    const res = await get('?sort=name&dir=asc&limit=1');
    const { nextCursor } = (await res.json()) as ListBody;
    expect(nextCursor).not.toBeNull();
    expect(decodeNameCursor(nextCursor ?? '')).toEqual({ sortName: 'Matrix', id: 't-9' });
  });
});

describe('T-API-027 · `sort=releaseYear` reaches the store and pages on the year', () => {
  it('T-API-027a · the sort is forwarded in both directions', async () => {
    await get('?sort=releaseYear&dir=asc');
    expect(listTitlePage.mock.calls[0]?.[1]).toMatchObject({ sort: 'releaseYear', dir: 'asc' });
    await get('?sort=releaseYear&dir=desc');
    expect(listTitlePage.mock.calls[1]?.[1]).toMatchObject({ sort: 'releaseYear', dir: 'desc' });
  });

  it('T-API-027b · the cursor is a YEAR position, and `null` is encodable', async () => {
    listTitlePage.mockResolvedValue({ rows: [row({ id: 't-7' })], hasMore: true });
    const body = (await (await get('?sort=releaseYear')).json()) as ListBody;
    expect(decodeReleaseYearCursor(body.nextCursor as string)).toEqual({
      releaseYear: 2021,
      id: 't-7',
    });

    listTitlePage.mockResolvedValue({
      rows: [row({ id: 't-8', tmdbReleaseYear: null })],
      hasMore: true,
    });
    const undated = (await (await get('?sort=releaseYear')).json()) as ListBody;
    expect(decodeReleaseYearCursor(undated.nextCursor as string)).toEqual({
      releaseYear: null,
      id: 't-8',
    });
  });

  it('T-API-027c · a cursor from ANOTHER sort is a loud 400, not a wrong page', async () => {
    // A keyset that does not mirror its own `ORDER BY` skips or repeats rows
    // at every boundary — indistinguishable from data loss, and invisible to
    // any test that never asks for a second page.
    listTitlePage.mockResolvedValue({ rows: [row({ id: 't-7' })], hasMore: true });
    const runtimeCursor = ((await (await get('?sort=runtime')).json()) as ListBody)
      .nextCursor as string;

    const res = await get(`?sort=releaseYear&cursor=${encodeURIComponent(runtimeCursor)}`);
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('INVALID_CURSOR');
  });
});
