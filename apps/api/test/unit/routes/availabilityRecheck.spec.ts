/**
 * US-068 (PRD `A59`, `specs/api.md` §6.47, §6.52, §6.53) — the owner's "Check
 * now" and "Re-check everything", with the repository mocked.
 *
 * Both ignore the stored answer's age; the integration suite
 * (`test/integration/availabilityRecheck.spec.ts`) proves what the STORE ends
 * up holding. This one proves which lookups and writes each HANDLER issues.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findActiveSuppression = vi.fn();
const listActiveSuppressions = vi.fn();
const findTitle = vi.fn();
const updateTitle = vi.fn();
const createServiceListing = vi.fn();
const softDeleteServiceListing = vi.fn();
const listListingsForTitle = vi.fn();
const findWaitingIntent = vi.fn();
const satisfyWaitingIntents = vi.fn();
const listOwnerServices = vi.fn();
const listWaitingIntents = vi.fn();
const updateTitleAvailability = vi.fn();
const updateWatchIntentAvailability = vi.fn();
const listLibraryAvailability = vi.fn();
const getWatchOffers = vi.fn();

const fn =
  (mock: (...args: unknown[]) => unknown) =>
  (...args: unknown[]) =>
    mock(...args);

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findActiveSuppression: fn(findActiveSuppression),
    listActiveSuppressions: fn(listActiveSuppressions),
    findTitle: fn(findTitle),
    updateTitle: fn(updateTitle),
    createServiceListing: fn(createServiceListing),
    softDeleteServiceListing: fn(softDeleteServiceListing),
    listListingsForTitle: fn(listListingsForTitle),
  };
});

vi.mock('../../../src/repository/watchIntents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/watchIntents.js')>();
  return {
    ...actual,
    findWaitingIntent: fn(findWaitingIntent),
    satisfyWaitingIntents: fn(satisfyWaitingIntents),
    listOwnerServices: fn(listOwnerServices),
    listWaitingIntents: fn(listWaitingIntents),
    updateTitleAvailability: fn(updateTitleAvailability),
    updateWatchIntentAvailability: fn(updateWatchIntentAvailability),
  };
});

vi.mock('../../../src/repository/availabilityReview.js', () => ({
  listLibraryAvailability: fn(listLibraryAvailability),
}));

vi.mock('../../../src/clients/tmdbClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/clients/tmdbClient.js')>();
  class StubTmdbClient extends actual.TmdbClient {
    override getWatchOffers(
      ...args: unknown[]
    ): Promise<{ flatrate: string[]; rentOrBuy: string[] } | null> {
      return getWatchOffers(...args) as Promise<{ flatrate: string[]; rentOrBuy: string[] } | null>;
    }
  }
  return { ...actual, TmdbClient: StubTmdbClient };
});

const { createApp } = await import('../../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../../src/middleware/allowList.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-availability-recheck-unit';
const NOW_MS = Date.now();
const minutesAgo = (minutes: number): Date => new Date(NOW_MS - minutes * 60_000);
const daysAgo = (days: number): Date => new Date(NOW_MS - days * 86_400_000);

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

let server: Server;
let app: Express;
let origin: string;

const call = (method: string, path: string, body?: unknown): Promise<Response> =>
  fetch(`${origin}${path}`, {
    method,
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

type Json = Record<string, unknown>;
const json = async (response: Response): Promise<Json> => (await response.json()) as Json;

function libraryTitle(id: string, overrides: Json = {}): Json {
  return {
    id,
    workIdentity: `tmdb:movie:${id}`,
    state: 'active',
    tmdbId: 1100,
    tmdbMediaType: 'movie',
    tmdbName: `Name ${id}`,
    rawExtractedText: null,
    tmdbReleaseYear: 2025,
    tmdbPosterPath: null,
    availabilityCheckedAt: minutesAgo(1),
    availableOn: '["Starz"]',
    rentOn: '[]',
    availabilityRegion: 'US',
    availabilityKeptSignature: null,
    listings: [{ listingId: `l-${id}`, service: 'starz', dateAdded: daysAgo(100) }],
    ...overrides,
  };
}

function intent(id: string, overrides: Json = {}, title: Json = {}): Json {
  return {
    id,
    titleId: `t-${id}`,
    workIdentity: `tmdb:movie:w${id}`,
    availableOn: '[]',
    rentOn: '[]',
    streamingSince: null,
    availabilityCheckedAt: minutesAgo(1),
    availabilityRegion: 'US',
    title: {
      id: `t-${id}`,
      tmdbId: 2200,
      tmdbMediaType: 'movie',
      tmdbName: `Waiting ${id}`,
      rawExtractedText: null,
      tmdbReleaseYear: 2024,
      tmdbPosterPath: null,
      editionLabels: null,
      ...title,
    },
    ...overrides,
  };
}

const activeListing = (id: string): Json => ({
  listingId: `l-${id}`,
  service: 'starz',
  state: 'active',
  dateAdded: daysAgo(100),
});

beforeEach(async () => {
  vi.clearAllMocks();
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;

  findActiveSuppression.mockResolvedValue(null);
  listActiveSuppressions.mockResolvedValue([]);
  findTitle.mockImplementation((_owner: unknown, id: string) => Promise.resolve(libraryTitle(id)));
  listListingsForTitle.mockImplementation((_owner: unknown, id: string) =>
    Promise.resolve([activeListing(id)]),
  );
  findWaitingIntent.mockImplementation((_owner: unknown, id: string) =>
    Promise.resolve(intent(id)),
  );
  listOwnerServices.mockResolvedValue(['starz', 'max']);
  listWaitingIntents.mockResolvedValue([]);
  listLibraryAvailability.mockResolvedValue([]);
  updateTitleAvailability.mockResolvedValue({ count: 1 });
  updateWatchIntentAvailability.mockResolvedValue({ count: 1 });
  getWatchOffers.mockResolvedValue({ flatrate: ['HBO Max'], rentOrBuy: [] });

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
  vi.restoreAllMocks();
});

const expectNoListState = (): void => {
  expect(softDeleteServiceListing).not.toHaveBeenCalled();
  expect(createServiceListing).not.toHaveBeenCalled();
  expect(updateTitle).not.toHaveBeenCalled();
  expect(satisfyWaitingIntents).not.toHaveBeenCalled();
};

describe('T-RECHECK-001 · US-068 AC-1 · POST /api/titles/:id/availability/check forces one lookup', () => {
  it('T-RECHECK-001a: re-asks TMDB although the answer is a minute old, writing availability columns only', async () => {
    const response = await call('POST', '/api/titles/a/availability/check');
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      id: 'a',
      region: 'US',
      availableOn: ['HBO Max'],
      rentOn: [],
      accessState: 'streaming',
      checkedAt: expect.any(String) as string,
    });
    expect(getWatchOffers).toHaveBeenCalledExactlyOnceWith('movie', 1100, 'US');
    expect(updateTitleAvailability).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'a', {
      availableOn: '["HBO Max"]',
      rentOn: '[]',
      availabilityCheckedAt: expect.any(Date) as Date,
      availabilityRegion: 'US',
    });
    expect(updateWatchIntentAvailability).not.toHaveBeenCalled();
    expectNoListState();
  });

  it('T-RECHECK-001b: a failed lookup keeps the stored answer and answers 502 TMDB_UNAVAILABLE', async () => {
    getWatchOffers.mockRejectedValue(new Error('TMDB down'));
    const response = await call('POST', '/api/titles/a/availability/check');
    expect(response.status).toBe(502);
    expect(await json(response)).toMatchObject({ error: { code: 'TMDB_UNAVAILABLE' } });
    expect(updateTitleAvailability).not.toHaveBeenCalled();
  });

  it('T-RECHECK-001c: a title with no TMDB id is refused 404 TMDB_WORK_NOT_FOUND without a lookup', async () => {
    findTitle.mockResolvedValue(libraryTitle('a', { tmdbId: null, tmdbMediaType: null }));
    const response = await call('POST', '/api/titles/a/availability/check');
    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({ error: { code: 'TMDB_WORK_NOT_FOUND' } });
    expect(getWatchOffers).not.toHaveBeenCalled();
    expect(updateTitleAvailability).not.toHaveBeenCalled();
  });

  it("T-RECHECK-001d: another owner's (or a missing) title id is a 404 NOT_FOUND, never looked up", async () => {
    findTitle.mockResolvedValue(null);
    const response = await call('POST', '/api/titles/not-mine/availability/check');
    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(findTitle.mock.calls[0]?.[1]).toBe('not-mine');
    expect(getWatchOffers).not.toHaveBeenCalled();
  });

  it('T-RECHECK-001e: a title with no active badge is refused 409 TITLE_NOT_ACTIVE', async () => {
    listListingsForTitle.mockResolvedValue([{ ...activeListing('a'), state: 'removed' }]);
    const response = await call('POST', '/api/titles/a/availability/check');
    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ error: { code: 'TITLE_NOT_ACTIVE' } });
    expect(getWatchOffers).not.toHaveBeenCalled();
  });

  it('T-RECHECK-001f: an answer of NOT KNOWN is written as not known, not as a failure', async () => {
    getWatchOffers.mockResolvedValue(null);
    const response = await call('POST', '/api/titles/a/availability/check');
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ availableOn: null, accessState: 'unknown' });
    expect(updateTitleAvailability.mock.calls[0]?.[2]).toMatchObject({
      availableOn: null,
      rentOn: null,
    });
  });
});

describe('T-RECHECK-002 · US-068 AC-2 · POST /api/waiting/:id/availability/check forces one lookup', () => {
  it('T-RECHECK-002a: re-asks TMDB for a waiting title, writing availability columns only', async () => {
    getWatchOffers.mockResolvedValue({ flatrate: ['Max'], rentOrBuy: ['Apple TV'] });
    const response = await call('POST', '/api/waiting/w1/availability/check');
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({
      id: 'w1',
      availableOn: ['Max'],
      rentOn: ['Apple TV'],
      accessState: 'streaming',
    });
    expect(getWatchOffers).toHaveBeenCalledExactlyOnceWith('movie', 2200, 'US');
    expect(updateWatchIntentAvailability).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'w1', {
      availableOn: '["Max"]',
      rentOn: '["Apple TV"]',
      streamingSince: expect.any(Date) as Date,
      availabilityCheckedAt: expect.any(Date) as Date,
      availabilityRegion: 'US',
    });
    expect(updateTitleAvailability).not.toHaveBeenCalled();
    expectNoListState();
  });

  it('T-RECHECK-002b: a missing or foreign waiting id is 404, and a failure is 502 with nothing written', async () => {
    findWaitingIntent.mockResolvedValueOnce(null);
    const missing = await call('POST', '/api/waiting/nope/availability/check');
    expect(missing.status).toBe(404);
    expect(await json(missing)).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(getWatchOffers).not.toHaveBeenCalled();

    getWatchOffers.mockRejectedValue(new Error('TMDB down'));
    const failed = await call('POST', '/api/waiting/w1/availability/check');
    expect(failed.status).toBe(502);
    expect(updateWatchIntentAvailability).not.toHaveBeenCalled();
  });

  it('T-RECHECK-002c: a waiting title with no TMDB id is refused 404 TMDB_WORK_NOT_FOUND', async () => {
    findWaitingIntent.mockResolvedValue(intent('w1', {}, { tmdbId: null, tmdbMediaType: null }));
    const response = await call('POST', '/api/waiting/w1/availability/check');
    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({ error: { code: 'TMDB_WORK_NOT_FOUND' } });
    expect(getWatchOffers).not.toHaveBeenCalled();
  });
});

/** A store that remembers writes, so successive taps see each other's work. */
function stateful(titles: Json[]): Map<string, Json> {
  const store = new Map(titles.map((row) => [row['id'] as string, row]));
  listLibraryAvailability.mockImplementation(() => Promise.resolve([...store.values()]));
  updateTitleAvailability.mockImplementation(
    (_owner: unknown, id: string, data: Json): Promise<unknown> => {
      store.set(id, { ...(store.get(id) as Json), ...data });
      return Promise.resolve({ count: 1 });
    },
  );
  return store;
}

type Recheck = {
  since: string;
  cursor: string | null;
  total: number;
  remaining: number;
  processed: number;
  done: boolean;
};

describe('T-RECHECK-003 · US-068 AC-3 · POST /api/availability/check {scope:"all"} walks every title', () => {
  const fifty = (): Json[] =>
    Array.from({ length: 50 }, (_, i) =>
      libraryTitle(`t${String(i).padStart(2, '0')}`, { availabilityCheckedAt: minutesAgo(60 - i) }),
    );

  it('T-RECHECK-003a: repeated taps progress through the list without repeating a title', async () => {
    const store = stateful(fifty());
    const seen: string[] = [];
    const write = updateTitleAvailability.getMockImplementation() as (...a: unknown[]) => unknown;
    updateTitleAvailability.mockImplementation((...args: unknown[]) => {
      seen.push(args[1] as string);
      return write(...args);
    });
    getWatchOffers.mockResolvedValue({ flatrate: [], rentOrBuy: [] });
    expect(store.size).toBe(50);

    let body: Json = { scope: 'all' };
    const progress: Recheck[] = [];
    for (let tap = 0; tap < 10; tap += 1) {
      const response = await call('POST', '/api/availability/check', body);
      expect(response.status).toBe(200);
      const result = await json(response);
      const recheck = result['recheck'] as Recheck;
      progress.push(recheck);
      if (recheck.done) break;
      body = { scope: 'all', since: recheck.since, cursor: recheck.cursor };
    }
    expect(progress.map((p) => p.processed)).toEqual([20, 40, 50]);
    expect(progress.map((p) => p.remaining)).toEqual([30, 10, 0]);
    expect(progress.every((p) => p.total === 50)).toBe(true);
    expect(progress.every((p) => p.since === progress[0]?.since)).toBe(true);
    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
    // Least recently checked first: the oldest stamp was t00's.
    expect(seen[0]).toBe('t00');
    expect(seen.slice(0, 3)).toEqual(['t00', 't01', 't02']);
    expect(getWatchOffers).toHaveBeenCalledTimes(50);
  });

  it('T-RECHECK-003b: ignores age — a title checked a minute ago is re-asked — and covers waiting titles', async () => {
    stateful([libraryTitle('a')]);
    listWaitingIntents.mockResolvedValue([intent('w1')]);
    const result = await json(await call('POST', '/api/availability/check', { scope: 'all' }));
    expect(getWatchOffers).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ lookedUp: 2, failed: 0 });
    expect(result['recheck']).toMatchObject({ total: 2, remaining: 0, processed: 2, done: true });
    expect(updateWatchIntentAvailability).toHaveBeenCalledTimes(1);
    expectNoListState();
  });

  it('T-RECHECK-003c: a title whose lookup fails keeps its answer and does not starve later taps', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      libraryTitle(`f${String(i).padStart(2, '0')}`, { availabilityCheckedAt: minutesAgo(60 - i) }),
    );
    const store = stateful(rows);
    // The two oldest always fail.
    getWatchOffers.mockRejectedValueOnce(new Error('down'));
    getWatchOffers.mockRejectedValueOnce(new Error('down'));
    getWatchOffers.mockResolvedValue({ flatrate: [], rentOrBuy: [] });

    const first = (await json(await call('POST', '/api/availability/check', { scope: 'all' })))[
      'recheck'
    ] as Recheck;
    expect(first).toMatchObject({ total: 25, processed: 20, remaining: 5, done: false });
    const second = (
      await json(
        await call('POST', '/api/availability/check', {
          scope: 'all',
          since: first.since,
          cursor: first.cursor,
        }),
      )
    )['recheck'] as Recheck;
    expect(second).toMatchObject({ processed: 25, remaining: 0, done: true });
    // The failures were attempted once, never retried this walk, and kept their stamps.
    expect(getWatchOffers).toHaveBeenCalledTimes(25);
    expect(store.get('f00')?.['availabilityCheckedAt']).toEqual(minutesAgo(60));
    expect(store.get('f02')?.['availabilityCheckedAt']).not.toEqual(minutesAgo(58));
  });

  it('T-RECHECK-003d: refuses a malformed scope, cursor or since with 400 and looks up nothing', async () => {
    const bad: unknown[] = [
      { scope: 'everything' },
      { scope: 'stale', since: new Date().toISOString() },
      { scope: 'all', cursor: '123:abc' },
      { scope: 'all', since: 'yesterday' },
      { scope: 'all', since: new Date().toISOString(), cursor: 'not a cursor' },
      { scope: 'all', since: new Date(NOW_MS + 3_600_000).toISOString() },
      { scope: 'all', since: 42 },
    ];
    for (const body of bad) {
      const response = await call('POST', '/api/availability/check', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(await json(response)).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    }
    expect(getWatchOffers).not.toHaveBeenCalled();
  });

  it('T-RECHECK-003e: the default scope is still stale-only — a fresh answer is not re-asked', async () => {
    stateful([libraryTitle('fresh')]);
    const result = await json(await call('POST', '/api/availability/check', {}));
    expect(getWatchOffers).not.toHaveBeenCalled();
    expect(result).toEqual({ lookedUp: 0, failed: 0, checked: 1, notCheckedRecently: 0 });
  });
});
