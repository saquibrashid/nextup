/**
 * #325 / #465 (PRD `A66`, US-074 / REQ-140) — the "Finished watching" routes,
 * with the repository and TMDB mocked.
 *
 * The properties that matter: recording a finish NEVER touches the Library,
 * only the confirmed `library-hidden` route does; a movie is finished whole, a
 * show per aired season; unfinishing keeps the date and rating; a foreign id
 * is a 404.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findTitle = vi.fn();
const listListedWorkIdentities = vi.fn();
const listWatchRecords = vi.fn();
const writeWatchRecord = vi.fn();
const listFinishedRecords = vi.fn();
const isLibraryHidden = vi.fn();
const setLibraryHidden = vi.fn();
const listHiddenIdentities = vi.fn();
const latestTitlesByIdentity = vi.fn();
const getSeasons = vi.fn();
const satisfyWaitingIntents = vi.fn();

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findTitle: (...args: unknown[]) => findTitle(...args) as unknown,
    listListedWorkIdentities: (...args: unknown[]) => listListedWorkIdentities(...args) as unknown,
  };
});

vi.mock('../../../src/repository/watchIntents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/watchIntents.js')>();
  return {
    ...actual,
    satisfyWaitingIntents: (...args: unknown[]) => satisfyWaitingIntents(...args) as unknown,
  };
});

vi.mock('../../../src/repository/watchRecords.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/watchRecords.js')>();
  return {
    ...actual,
    listWatchRecords: (...args: unknown[]) => listWatchRecords(...args) as unknown,
    writeWatchRecord: (...args: unknown[]) => writeWatchRecord(...args) as unknown,
    listFinishedRecords: (...args: unknown[]) => listFinishedRecords(...args) as unknown,
    isLibraryHidden: (...args: unknown[]) => isLibraryHidden(...args) as unknown,
    setLibraryHidden: (...args: unknown[]) => setLibraryHidden(...args) as unknown,
    listHiddenIdentities: (...args: unknown[]) => listHiddenIdentities(...args) as unknown,
    latestTitlesByIdentity: (...args: unknown[]) => latestTitlesByIdentity(...args) as unknown,
  };
});

vi.mock('../../../src/clients/tmdbClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/clients/tmdbClient.js')>();
  class StubTmdbClient extends actual.TmdbClient {
    override getSeasons(...args: unknown[]) {
      return getSeasons(...args) as ReturnType<
        InstanceType<typeof actual.TmdbClient>['getSeasons']
      >;
    }
  }
  return { ...actual, TmdbClient: StubTmdbClient };
});

const { createApp } = await import('../../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../../src/middleware/allowList.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-watched-unit';
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

const MOVIE = {
  id: 't-movie',
  workIdentity: 'tmdb:movie:603',
  state: 'active',
  tmdbId: 603,
  tmdbMediaType: 'movie',
  tmdbName: 'The Matrix',
  tmdbReleaseYear: 1999,
  tmdbPosterPath: '/m.jpg',
  normalisedText: null,
  rawExtractedText: null,
};
const SHOW = { ...MOVIE, id: 't-show', workIdentity: 'tmdb:tv:1', tmdbId: 1, tmdbMediaType: 'tv' };
const SEASONS = [
  { seasonNumber: 1, airDate: '2020-01-01' },
  { seasonNumber: 2, airDate: '2021-01-01' },
  { seasonNumber: 3, airDate: '2999-01-01' },
];
const RECORD = {
  workIdentity: 'tmdb:movie:603',
  seasonNumber: 0,
  finished: true,
  watchedOn: '2026-03-01',
  rating: 4,
  titleName: 'The Matrix',
  releaseYear: 1999,
  mediaType: 'movie',
  posterPath: '/m.jpg',
  updatedAt: new Date(),
};

let server: Server;
let origin: string;

const call = (method: string, path: string, body?: unknown): Promise<Response> =>
  fetch(`${origin}${path}`, {
    method,
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader, 'content-type': 'application/json' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
  });

beforeEach(async () => {
  vi.clearAllMocks();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'test-key';
  findTitle.mockResolvedValue(MOVIE);
  listListedWorkIdentities.mockResolvedValue(new Set([MOVIE.workIdentity, SHOW.workIdentity]));
  listWatchRecords.mockResolvedValue([]);
  writeWatchRecord.mockImplementation((_o, work: string, season: number) =>
    Promise.resolve({ ...RECORD, workIdentity: work, seasonNumber: season }),
  );
  listFinishedRecords.mockResolvedValue({ items: [RECORD], hasMore: false });
  isLibraryHidden.mockResolvedValue(false);
  setLibraryHidden.mockResolvedValue(undefined);
  satisfyWaitingIntents.mockResolvedValue({ count: 0 });
  listHiddenIdentities.mockResolvedValue(new Set());
  latestTitlesByIdentity.mockResolvedValue(new Map());
  getSeasons.mockResolvedValue(SEASONS);
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('T-VIEWED-040 · GET /api/titles/:titleId/watched', () => {
  it('T-VIEWED-040a · a foreign or unknown title is a 404', async () => {
    findTitle.mockResolvedValue(null);
    expect((await call('GET', '/api/titles/nope/watched')).status).toBe(404);
  });

  it('T-VIEWED-040b · a movie reports its whole-title record and is not per season', async () => {
    listWatchRecords.mockResolvedValue([RECORD]);
    const body = (await (await call('GET', '/api/titles/t-movie/watched')).json()) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      perSeason: false,
      inLibrary: true,
      hidden: false,
      seasons: [],
      whole: { finished: true, watchedOn: '2026-03-01', rating: 4 },
    });
    expect(getSeasons).not.toHaveBeenCalled();
  });

  it('T-VIEWED-040c · a show lists its aired and unaired seasons, and completeness ignores the unaired', async () => {
    findTitle.mockResolvedValue(SHOW);
    listWatchRecords.mockResolvedValue([
      { ...RECORD, workIdentity: SHOW.workIdentity, seasonNumber: 1 },
      { ...RECORD, workIdentity: SHOW.workIdentity, seasonNumber: 2, finished: false },
    ]);
    const body = (await (await call('GET', '/api/titles/t-show/watched')).json()) as {
      seasons: { seasonNumber: number; aired: boolean; finished: boolean }[];
      allAiredFinished: boolean;
    };
    expect(body.seasons.map((s) => [s.seasonNumber, s.aired, s.finished])).toEqual([
      [1, true, true],
      [2, true, false],
      [3, false, false],
    ]);
    expect(body.allAiredFinished).toBe(false);

    listWatchRecords.mockResolvedValue([1, 2].map((n) => ({ ...RECORD, seasonNumber: n })));
    const done = (await (await call('GET', '/api/titles/t-show/watched')).json()) as {
      allAiredFinished: boolean;
    };
    expect(done.allAiredFinished).toBe(true);
  });

  it('T-VIEWED-040d · a TMDB failure degrades to seasonsUnavailable, never an error', async () => {
    findTitle.mockResolvedValue(SHOW);
    getSeasons.mockRejectedValue(new Error('down'));
    const res = await call('GET', '/api/titles/t-show/watched');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ seasonsUnavailable: true, seasons: [] });
  });

  it('T-VIEWED-040e · a set-aside title is not in the Library', async () => {
    isLibraryHidden.mockResolvedValue(true);
    expect(await (await call('GET', '/api/titles/t-movie/watched')).json()).toMatchObject({
      inLibrary: false,
      hidden: true,
    });
  });
});

describe('T-VIEWED-041 · POST /api/titles/:titleId/finished', () => {
  it('T-VIEWED-041a · a movie is finished whole, with date and rating, and the Library is untouched', async () => {
    const res = await call('POST', '/api/titles/t-movie/finished', {
      seasons: [0],
      watchedOn: '2026-03-01',
      rating: 5,
    });
    expect(res.status).toBe(200);
    expect(writeWatchRecord).toHaveBeenCalledWith(
      expect.anything(),
      'tmdb:movie:603',
      0,
      { finished: true, watchedOn: '2026-03-01', rating: 5 },
      expect.objectContaining({ titleName: 'The Matrix' }),
    );
    expect(setLibraryHidden).not.toHaveBeenCalled();
  });

  it('T-VIEWED-041b · a movie cannot be finished by season, and bodies are validated', async () => {
    expect((await call('POST', '/api/titles/t-movie/finished', { seasons: [1] })).status).toBe(400);
    expect((await call('POST', '/api/titles/t-movie/finished', { seasons: [] })).status).toBe(400);
    expect(writeWatchRecord).not.toHaveBeenCalled();
  });

  it('T-VIEWED-041c · a show is finished per aired season; unaired and whole-show are refused', async () => {
    findTitle.mockResolvedValue(SHOW);
    expect(
      (await call('POST', '/api/titles/t-show/finished', { seasons: [1, 2], watchedOn: null }))
        .status,
    ).toBe(200);
    expect(writeWatchRecord).toHaveBeenCalledTimes(2);
    expect((await call('POST', '/api/titles/t-show/finished', { seasons: [3] })).status).toBe(400);
    expect((await call('POST', '/api/titles/t-show/finished', { seasons: [0] })).status).toBe(400);
    expect((await call('POST', '/api/titles/t-show/finished', { seasons: [9] })).status).toBe(400);
  });

  it('T-VIEWED-041d · when TMDB cannot answer, a numbered season is still recorded', async () => {
    findTitle.mockResolvedValue(SHOW);
    getSeasons.mockRejectedValue(new Error('down'));
    expect((await call('POST', '/api/titles/t-show/finished', { seasons: [2] })).status).toBe(200);
  });

  it('T-VIEWED-041e · an unknown title is a 404', async () => {
    findTitle.mockResolvedValue(null);
    expect((await call('POST', '/api/titles/x/finished', { seasons: [0] })).status).toBe(404);
  });
});

describe('T-VIEWED-042 · edit, unfinish and history', () => {
  it('T-VIEWED-042a · editing changes only the supplied fields; none stored is a 404', async () => {
    const id = encodeURIComponent('tmdb:movie:603');
    listWatchRecords.mockResolvedValue([RECORD]);
    expect((await call('PATCH', `/api/watched/${id}/0`, { rating: null })).status).toBe(200);
    expect(writeWatchRecord).toHaveBeenCalledWith(
      expect.anything(),
      'tmdb:movie:603',
      0,
      { rating: null },
      expect.anything(),
    );
    expect((await call('PATCH', `/api/watched/${id}/0`, { rating: 9 })).status).toBe(400);
    expect((await call('PATCH', `/api/watched/${id}/x`, { rating: 3 })).status).toBe(400);
    listWatchRecords.mockResolvedValue([]);
    expect((await call('PATCH', `/api/watched/${id}/0`, { rating: 3 })).status).toBe(404);
    // Existence is decided before validation, so a foreign key is never a 400.
    expect((await call('PATCH', `/api/watched/${id}/x`, {})).status).toBe(404);
  });

  it('T-VIEWED-042b · unfinishing clears only the flag, so the date and rating survive', async () => {
    const id = encodeURIComponent('tmdb:movie:603');
    listWatchRecords.mockResolvedValue([RECORD]);
    expect((await call('POST', `/api/watched/${id}/0/unfinish`)).status).toBe(200);
    expect(writeWatchRecord).toHaveBeenCalledWith(
      expect.anything(),
      'tmdb:movie:603',
      0,
      { finished: false },
      expect.anything(),
    );
    listWatchRecords.mockResolvedValue([]);
    expect((await call('POST', `/api/watched/${id}/0/unfinish`)).status).toBe(404);
  });

  it('T-VIEWED-042c · history pages by cursor and marks what left the Library', async () => {
    listFinishedRecords.mockResolvedValue({ items: [RECORD], hasMore: true });
    listHiddenIdentities.mockResolvedValue(new Set([RECORD.workIdentity]));
    latestTitlesByIdentity.mockResolvedValue(
      new Map([[RECORD.workIdentity, { titleId: 't-movie', imdbRatingTenths: 87 }]]),
    );
    const body = (await (await call('GET', '/api/watched?limit=1&cursor=2')).json()) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    expect(listFinishedRecords).toHaveBeenCalledWith(expect.anything(), { limit: 1, offset: 2 });
    expect(body.nextCursor).toBe('3');
    expect(body.items[0]).toMatchObject({
      titleName: 'The Matrix',
      rating: 4,
      titleId: 't-movie',
      imdbRatingTenths: 87,
      leftLibrary: true,
    });
  });

  it('T-VIEWED-042d · history falls back for a title row that no longer exists, and validates paging', async () => {
    listFinishedRecords.mockResolvedValue({
      items: [{ ...RECORD, titleName: null }],
      hasMore: false,
    });
    const body = (await (await call('GET', '/api/watched')).json()) as {
      items: Record<string, unknown>[];
      nextCursor: string | null;
    };
    expect(body.nextCursor).toBeNull();
    expect(body.items[0]).toMatchObject({
      titleName: 'tmdb:movie:603',
      titleId: null,
      imdbRatingTenths: null,
      leftLibrary: false,
    });
    expect((await call('GET', '/api/watched?limit=0')).status).toBe(400);
    expect((await call('GET', '/api/watched?cursor=-1')).status).toBe(400);
  });
});

describe('T-VIEWED-043 · POST /api/titles/:titleId/library-hidden', () => {
  it('T-VIEWED-043a · setting a listed title aside writes only the flag', async () => {
    const res = await call('POST', '/api/titles/t-movie/library-hidden', { hidden: true });
    expect(res.status).toBe(200);
    expect(setLibraryHidden).toHaveBeenCalledWith(expect.anything(), 'tmdb:movie:603', true);
    expect(listListedWorkIdentities).toHaveBeenCalledWith(expect.anything(), undefined, {
      visibleOnly: true,
    });
  });

  it('T-VIEWED-043b · a title that is not in the Library is a 409 and nothing is written', async () => {
    listListedWorkIdentities.mockResolvedValue(new Set());
    expect(
      (await call('POST', '/api/titles/t-movie/library-hidden', { hidden: true })).status,
    ).toBe(409);
    findTitle.mockResolvedValue({ ...MOVIE, state: 'removed' });
    listListedWorkIdentities.mockResolvedValue(new Set([MOVIE.workIdentity]));
    expect(
      (await call('POST', '/api/titles/t-movie/library-hidden', { hidden: false })).status,
    ).toBe(409);
    expect(setLibraryHidden).not.toHaveBeenCalled();
  });

  it('T-VIEWED-043c · returning a set-aside title is the same route with hidden false', async () => {
    const res = await call('POST', '/api/titles/t-movie/library-hidden', { hidden: false });
    expect(res.status).toBe(200);
    expect(setLibraryHidden).toHaveBeenCalledWith(expect.anything(), 'tmdb:movie:603', false);
    expect(listListedWorkIdentities).toHaveBeenCalledWith(expect.anything(), undefined, {
      visibleOnly: false,
    });
  });

  it('T-VIEWED-043d · a missing or non-boolean hidden is a 400; an unknown title a 404', async () => {
    expect((await call('POST', '/api/titles/t-movie/library-hidden', {})).status).toBe(400);
    expect(
      (await call('POST', '/api/titles/t-movie/library-hidden', { hidden: 'yes' })).status,
    ).toBe(400);
    findTitle.mockResolvedValue(null);
    expect((await call('POST', '/api/titles/x/library-hidden', { hidden: true })).status).toBe(404);
  });
});

describe('T-FTW-001 · returning a title ends its open Waiting entry (#468)', () => {
  it('T-FTW-001a · hidden false satisfies the work’s waiting intent, after the flag is cleared', async () => {
    const res = await call('POST', '/api/titles/t-movie/library-hidden', { hidden: false });
    expect(res.status).toBe(200);
    expect(satisfyWaitingIntents).toHaveBeenCalledWith(
      expect.anything(),
      ['tmdb:movie:603'],
      expect.any(Date),
    );
    expect(setLibraryHidden.mock.invocationCallOrder[0]).toBeLessThan(
      satisfyWaitingIntents.mock.invocationCallOrder[0] as number,
    );
  });

  it('T-FTW-001b · hidden true, and a refused return, never touch the Waiting entry', async () => {
    await call('POST', '/api/titles/t-movie/library-hidden', { hidden: true });
    listListedWorkIdentities.mockResolvedValue(new Set());
    await call('POST', '/api/titles/t-movie/library-hidden', { hidden: false });
    expect(satisfyWaitingIntents).not.toHaveBeenCalled();
  });
});
