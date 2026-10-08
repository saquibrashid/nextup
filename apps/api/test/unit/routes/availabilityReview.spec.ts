/**
 * US-064 (PRD `A55`, `specs/api.md` §6.45–§6.48) — the "Availability changes"
 * routes with the repository mocked.
 *
 * The integration suite (`test/integration/availabilityReview.spec.ts`) proves
 * what the STORE does: one refused item leaves the others applied, and a check
 * writes metadata only. This one proves which reads, lookups and writes each
 * HANDLER issues, and carries the coverage `npm run coverage` measures.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findActiveSuppression = vi.fn();
const listActiveSuppressions = vi.fn();
const findTitle = vi.fn();
const findTitleByWorkIdentity = vi.fn();
const createTitle = vi.fn();
const createServiceListing = vi.fn();
const updateTitle = vi.fn();
const listListingsForTitle = vi.fn();
const softDeleteServiceListing = vi.fn();
const listWaitingWorkIdentities = vi.fn();
const createWatchIntent = vi.fn();
const findWaitingIntent = vi.fn();
const keepTitleAvailabilityChange = vi.fn();
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
    findTitleByWorkIdentity: fn(findTitleByWorkIdentity),
    createTitle: fn(createTitle),
    createServiceListing: fn(createServiceListing),
    updateTitle: fn(updateTitle),
    listListingsForTitle: fn(listListingsForTitle),
    softDeleteServiceListing: fn(softDeleteServiceListing),
    listWaitingWorkIdentities: fn(listWaitingWorkIdentities),
    createWatchIntent: fn(createWatchIntent),
    // A pass-through: under test is which writes are issued, not the grouping.
    runInTransaction: async (work: (tx: unknown) => Promise<unknown>) => work(undefined),
  };
});

vi.mock('../../../src/repository/watchIntents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/watchIntents.js')>();
  return {
    ...actual,
    findWaitingIntent: fn(findWaitingIntent),
    keepTitleAvailabilityChange: fn(keepTitleAvailabilityChange),
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
const SUBJECT = 'oid-owner-availability-review-unit';
const LEFT = 'left=netflix;joined=';
const NOW_MS = Date.now();
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

/** A stored Library title as `listLibraryAvailability` returns it. */
function libraryTitle(id: string, overrides: Json = {}): Json {
  return {
    id,
    workIdentity: `tmdb:movie:${id}`,
    tmdbId: 1100,
    tmdbMediaType: 'movie',
    tmdbName: `Name ${id}`,
    rawExtractedText: null,
    tmdbReleaseYear: 2025,
    tmdbPosterPath: '/p.jpg',
    availabilityCheckedAt: daysAgo(1),
    availableOn: '[]',
    rentOn: '[]',
    availabilityRegion: 'US',
    availabilityKeptSignature: null,
    listings: [{ listingId: `l-${id}`, service: 'netflix', dateAdded: daysAgo(100) }],
    ...overrides,
  };
}

/** A waiting intent as `listWaitingIntents` / `findWaitingIntent` return it. */
function intent(id: string, overrides: Json = {}, title: Json = {}): Json {
  return {
    id,
    titleId: `t-${id}`,
    workIdentity: `tmdb:movie:w${id}`,
    availableOn: '["Max"]',
    rentOn: '[]',
    streamingSince: daysAgo(1),
    availabilityCheckedAt: daysAgo(1),
    availabilityRegion: 'US',
    title: {
      id: `t-${id}`,
      tmdbId: 2200,
      tmdbMediaType: 'movie',
      tmdbName: `Waiting ${id}`,
      rawExtractedText: null,
      tmdbReleaseYear: 2024,
      tmdbPosterPath: null,
      tmdbRuntimeMinutes: 100,
      tmdbGenres: '[]',
      tmdbComedyShow: false,
      tmdbFetchedAt: daysAgo(30),
      imdbId: null,
      editionLabels: null,
      ...title,
    },
    ...overrides,
  };
}

/** A stored title as `findTitle` returns it. */
function storedTitle(id: string, overrides: Json = {}): Json {
  return {
    id,
    workIdentity: `tmdb:movie:${id}`,
    state: 'active',
    sortDateAdded: daysAgo(100),
    availableOn: '[]',
    rentOn: '[]',
    availabilityCheckedAt: daysAgo(1),
    availabilityRegion: 'US',
    availabilityKeptSignature: null,
    ...overrides,
  };
}

const activeListing = (id: string, service = 'netflix'): Json => ({
  listingId: `l-${id}-${service}`,
  service,
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
  findTitle.mockImplementation((_owner: unknown, id: string) => Promise.resolve(storedTitle(id)));
  findTitleByWorkIdentity.mockResolvedValue(null);
  createTitle.mockResolvedValue(undefined);
  createServiceListing.mockResolvedValue(undefined);
  updateTitle.mockResolvedValue({ count: 1 });
  softDeleteServiceListing.mockResolvedValue(undefined);
  listListingsForTitle.mockImplementation((_owner: unknown, id: string) =>
    Promise.resolve([activeListing(id)]),
  );
  listWaitingWorkIdentities.mockResolvedValue(new Set());
  createWatchIntent.mockResolvedValue(undefined);
  findWaitingIntent.mockImplementation((_owner: unknown, id: string) =>
    Promise.resolve(intent(id)),
  );
  keepTitleAvailabilityChange.mockResolvedValue({ count: 1 });
  satisfyWaitingIntents.mockResolvedValue({ count: 1 });
  listOwnerServices.mockResolvedValue(['netflix', 'max']);
  listWaitingIntents.mockResolvedValue([]);
  updateTitleAvailability.mockResolvedValue({ count: 1 });
  updateWatchIntentAvailability.mockResolvedValue({ count: 1 });
  listLibraryAvailability.mockResolvedValue([]);
  getWatchOffers.mockResolvedValue({ flatrate: [], rentOrBuy: [] });

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

describe('T-AVREV-004 · US-064 AC-1/AC-2 · GET /api/availability/review reads stored data only', () => {
  it('T-AVREV-004a: lists un-kept Library changes and waiting titles now streaming, by name', async () => {
    listLibraryAvailability.mockResolvedValue([
      // Left Netflix — a change.
      libraryTitle('b'),
      // Still on Netflix — no change.
      libraryTitle('quiet', { availableOn: '["Netflix"]' }),
      // The same change, already kept — answered.
      libraryTitle('kept', { availabilityKeptSignature: LEFT }),
      // Never checked — nothing known, no change.
      libraryTitle('never', { availabilityCheckedAt: null }),
      // No active badge — not in the Library.
      libraryTitle('gone', { listings: [] }),
      // Joined Max — a change; raw text names a match-less title.
      libraryTitle('a', {
        availableOn: '["Netflix","Max"]',
        tmdbName: null,
        rawExtractedText: 'Aa',
      }),
      libraryTitle('nameless', { tmdbName: null }),
    ]);
    listWaitingIntents.mockResolvedValue([
      intent('w1'),
      intent('w2', { availableOn: '["Hulu"]' }),
      intent('w3', { availableOn: null, availabilityCheckedAt: null }),
      intent('w4', {}, { tmdbName: null, rawExtractedText: 'Raw four' }),
      intent('w5', { availabilityCheckedAt: null }, { tmdbName: null }),
    ]);
    const response = await call('GET', '/api/availability/review');
    expect(response.status).toBe(200);
    const body = await json(response);
    const library = body['library'] as Json[];
    expect(library.map((row) => row['name'])).toEqual(['', 'Aa', 'Name b']);
    expect(library[1]).toMatchObject({
      titleId: 'a',
      badges: [{ service: 'netflix', listingId: 'l-a' }],
      availability: { joined: ['max'], left: [], signature: 'left=;joined=max' },
    });
    expect(library[2]?.['availability']).toMatchObject({ left: ['netflix'], signature: LEFT });
    const waiting = body['nowStreaming'] as Json[];
    expect(waiting.map((row) => row['intentId'])).toEqual(['w5', 'w4', 'w1']);
    expect(waiting[0]).toMatchObject({ name: '', availabilityCheckedAt: null });
    expect(waiting[2]).toMatchObject({
      flaggedOn: ['max'],
      service: 'max',
      availabilityRegion: 'US',
    });
    expect(body['check']).toEqual({ checked: 8, notCheckedRecently: 3 });
    // ⚠ A read asks TMDB nothing and writes nothing.
    expect(getWatchOffers).not.toHaveBeenCalled();
    expect(updateTitleAvailability).not.toHaveBeenCalled();
    expect(updateWatchIntentAvailability).not.toHaveBeenCalled();
  });

  it('T-AVREV-004b: a suppressed work is not listed — suppression is keyed on work identity', async () => {
    listLibraryAvailability.mockResolvedValue([libraryTitle('s'), libraryTitle('k')]);
    listActiveSuppressions.mockResolvedValue([{ id: 'sup-1', workIdentity: 'tmdb:movie:s' }]);
    const body = await json(await call('GET', '/api/availability/review'));
    expect((body['library'] as Json[]).map((row) => row['titleId'])).toEqual(['k']);
  });

  it('T-AVREV-004c: the summary counts both sections from the same stored read', async () => {
    listLibraryAvailability.mockResolvedValue([
      libraryTitle('a'),
      libraryTitle('quiet', { availableOn: '["Netflix"]' }),
    ]);
    listWaitingIntents.mockResolvedValue([intent('w1')]);
    const response = await call('GET', '/api/availability/review/summary');
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ count: 2 });
    expect(getWatchOffers).not.toHaveBeenCalled();
  });
});

describe('T-AVREV-005 · US-064 AC-3 · POST /api/availability/check is one owner-initiated batch', () => {
  it('T-AVREV-005a: looks up the oldest stale rows, serially, writing availability columns only', async () => {
    listLibraryAvailability.mockResolvedValue([
      libraryTitle('fresh'),
      libraryTitle('old', { availabilityCheckedAt: daysAgo(30) }),
      libraryTitle('none', { availabilityCheckedAt: null, availableOn: null, rentOn: null }),
      libraryTitle('unbadged', { availabilityCheckedAt: null, listings: [] }),
    ]);
    listWaitingIntents.mockResolvedValue([intent('w1', { availabilityCheckedAt: daysAgo(10) })]);
    getWatchOffers
      .mockResolvedValueOnce({ flatrate: ['Netflix'], rentOrBuy: ['Apple TV'] })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ flatrate: ['Max'], rentOrBuy: [] });
    const response = await call('POST', '/api/availability/check');
    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({
      lookedUp: 3,
      failed: 0,
      checked: 4,
      notCheckedRecently: 0,
    });
    expect(getWatchOffers).toHaveBeenCalledTimes(3);
    expect(updateTitleAvailability).toHaveBeenCalledTimes(2);
    const [, firstId, first] = updateTitleAvailability.mock.calls[0] as [unknown, string, Json];
    expect(firstId).toBe('none');
    expect(first).toEqual({
      availableOn: '["Netflix"]',
      rentOn: '["Apple TV"]',
      availabilityCheckedAt: expect.any(Date) as Date,
      availabilityRegion: 'US',
    });
    const [, , unknownAnswer] = updateTitleAvailability.mock.calls[1] as [unknown, string, Json];
    expect(unknownAnswer).toMatchObject({ availableOn: null, rentOn: null });
    const [, intentId, intentWrite] = updateWatchIntentAvailability.mock.calls[0] as [
      unknown,
      string,
      Json,
    ];
    expect(intentId).toBe('w1');
    expect(intentWrite).toMatchObject({ availableOn: '["Max"]', availabilityRegion: 'US' });
    // ⚠ Metadata only: no membership, badge or order write.
    expect(softDeleteServiceListing).not.toHaveBeenCalled();
    expect(createServiceListing).not.toHaveBeenCalled();
    expect(updateTitle).not.toHaveBeenCalled();
    expect(satisfyWaitingIntents).not.toHaveBeenCalled();
  });

  it('T-AVREV-005b: a failed lookup writes nothing and stays not-checked-recently', async () => {
    listLibraryAvailability.mockResolvedValue([
      libraryTitle('x', { availabilityCheckedAt: null }),
      libraryTitle('y', { availabilityCheckedAt: null }),
    ]);
    getWatchOffers
      .mockRejectedValueOnce(new Error('TMDB down'))
      .mockResolvedValueOnce({ flatrate: [], rentOrBuy: [] });
    const body = await json(await call('POST', '/api/availability/check'));
    expect(body).toEqual({ lookedUp: 1, failed: 1, checked: 1, notCheckedRecently: 1 });
    expect(updateTitleAvailability).toHaveBeenCalledTimes(1);
    expect((updateTitleAvailability.mock.calls[0] as [unknown, string])[1]).toBe('y');
  });

  it('T-AVREV-005c: with nothing stale, a tap asks TMDB nothing', async () => {
    listLibraryAvailability.mockResolvedValue([libraryTitle('fresh')]);
    const body = await json(await call('POST', '/api/availability/check'));
    expect(body).toEqual({ lookedUp: 0, failed: 0, checked: 1, notCheckedRecently: 0 });
    expect(getWatchOffers).not.toHaveBeenCalled();
  });

  it('T-AVREV-005d: at most twenty lookups per tap', async () => {
    listLibraryAvailability.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) =>
        libraryTitle(`r${String(i)}`, { availabilityCheckedAt: null }),
      ),
    );
    const body = await json(await call('POST', '/api/availability/check'));
    expect(getWatchOffers).toHaveBeenCalledTimes(20);
    expect(body).toMatchObject({ lookedUp: 20, notCheckedRecently: 5 });
  });
});

const apply = (action: string, items: Json[]): Promise<Response> =>
  call('POST', '/api/availability/review/apply', { action, items });

describe('T-AVREV-006 · US-064 AC-4/AC-5 · POST /api/availability/review/apply answers per item', () => {
  it('T-AVREV-006a: refuses a malformed body whole with 400 and writes nothing', async () => {
    const response = await apply('explode', [{ id: 'a', signature: LEFT }]);
    expect(response.status).toBe(400);
    expect(keepTitleAvailabilityChange).not.toHaveBeenCalled();
  });

  it('T-AVREV-006b: keep records each signature; a changed or inactive row is refused alone', async () => {
    listListingsForTitle.mockImplementation((_owner: unknown, id: string) =>
      Promise.resolve(id === 'empty' ? [] : [activeListing(id)]),
    );
    findTitle.mockImplementation((_owner: unknown, id: string) =>
      Promise.resolve(id === 'missing' ? null : storedTitle(id)),
    );
    const response = await apply('keep', [
      { id: 'a', signature: LEFT },
      { id: 'stale', signature: 'left=;joined=max' },
      { id: 'empty', signature: LEFT },
      { id: 'missing', signature: LEFT },
      { id: 'b', signature: LEFT },
    ]);
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body).toMatchObject({ action: 'keep', done: 2, refused: 3 });
    expect(body['results']).toEqual([
      { id: 'a', outcome: 'done', titleId: 'a', keptSignature: LEFT },
      expect.objectContaining({ id: 'stale', outcome: 'refused', code: 'AVAILABILITY_CHANGED' }),
      expect.objectContaining({ id: 'empty', outcome: 'refused', code: 'TITLE_NOT_ACTIVE' }),
      expect.objectContaining({ id: 'missing', outcome: 'refused', code: 'NOT_FOUND' }),
      { id: 'b', outcome: 'done', titleId: 'b', keptSignature: LEFT },
    ]);
    expect(keepTitleAvailabilityChange.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      'a',
      'b',
    ]);
  });

  it('T-AVREV-006c: remove-left-badges soft-removes only the badges that left', async () => {
    listListingsForTitle.mockImplementation((_owner: unknown, id: string) =>
      Promise.resolve([activeListing(id, 'netflix'), activeListing(id, 'max')]),
    );
    findTitle.mockImplementation((_owner: unknown, id: string) =>
      Promise.resolve(storedTitle(id, { availableOn: '["Max"]' })),
    );
    const body = await json(await apply('remove-left-badges', [{ id: 'a', signature: LEFT }]));
    expect(body).toMatchObject({ done: 1, refused: 0 });
    expect((body['results'] as Json[])[0]).toMatchObject({
      id: 'a',
      outcome: 'done',
      removedListingIds: ['l-a-netflix'],
      titleState: 'active',
    });
    expect(softDeleteServiceListing).toHaveBeenCalledTimes(1);
    const [, listingId, removal] = softDeleteServiceListing.mock.calls[0] as [
      unknown,
      string,
      Json,
    ];
    expect(listingId).toBe('l-a-netflix');
    expect(removal).toMatchObject({ removedByBatchId: null, removedByGroupId: null });
  });

  it('T-AVREV-006d: remove-left-badges refuses suppressed, inactive, changed and join-only rows', async () => {
    findActiveSuppression.mockImplementation((_owner: unknown, work: string) =>
      Promise.resolve(work === 'tmdb:movie:sup' ? { id: 'sup-1' } : null),
    );
    listListingsForTitle.mockImplementation((_owner: unknown, id: string) =>
      Promise.resolve(id === 'empty' ? [] : [activeListing(id)]),
    );
    findTitle.mockImplementation((_owner: unknown, id: string) =>
      Promise.resolve(storedTitle(id, id === 'joined' ? { availableOn: '["Netflix","Max"]' } : {})),
    );
    const body = await json(
      await apply('remove-left-badges', [
        { id: 'sup', signature: LEFT },
        { id: 'empty', signature: LEFT },
        { id: 'changed', signature: 'left=;joined=max' },
        { id: 'joined', signature: 'left=;joined=max' },
      ]),
    );
    expect(body).toMatchObject({ done: 0, refused: 4 });
    expect((body['results'] as Json[]).map((row) => row['code'])).toEqual([
      'WORK_SUPPRESSED',
      'TITLE_NOT_ACTIVE',
      'AVAILABILITY_CHANGED',
      'AVAILABILITY_CHANGED',
    ]);
    expect(softDeleteServiceListing).not.toHaveBeenCalled();
  });

  it('T-AVREV-006e: move-to-waiting moves only rows that still qualify', async () => {
    findTitle.mockImplementation((_owner: unknown, id: string) =>
      Promise.resolve(storedTitle(id, id === 'streams' ? { availableOn: '["Max"]' } : {})),
    );
    const body = await json(
      await apply('move-to-waiting', [
        { id: 'a', signature: LEFT },
        { id: 'changed', signature: 'left=;joined=max' },
        // Left Netflix but now on Max, an owner service — Move is not offered.
        { id: 'streams', signature: 'left=netflix;joined=max' },
      ]),
    );
    expect(body).toMatchObject({ done: 1, refused: 2 });
    expect((body['results'] as Json[])[0]).toMatchObject({
      id: 'a',
      outcome: 'done',
      removedListingIds: ['l-a-netflix'],
    });
    expect(createWatchIntent).toHaveBeenCalledTimes(1);
    expect(softDeleteServiceListing).toHaveBeenCalledTimes(1);
  });

  it('T-AVREV-006f: add-to-library promotes on the first owner service, refusing the rest alone', async () => {
    findWaitingIntent.mockImplementation((_owner: unknown, id: string) =>
      Promise.resolve(
        id === 'gone'
          ? null
          : id === 'nowhere'
            ? intent(id, { availableOn: '["Hulu"]' })
            : intent(id, { availableOn: '["Max","Netflix"]' }),
      ),
    );
    const body = await json(
      await apply('add-to-library', [{ id: 'w1' }, { id: 'gone' }, { id: 'nowhere' }]),
    );
    expect(body).toMatchObject({ action: 'add-to-library', done: 1, refused: 2 });
    const results = body['results'] as Json[];
    expect(results[0]).toMatchObject({ id: 'w1', outcome: 'done', service: 'netflix' });
    expect(results.slice(1).map((row) => row['code'])).toEqual([
      'NOT_FOUND',
      'AVAILABILITY_CHANGED',
    ]);
    expect(createServiceListing).toHaveBeenCalledTimes(1);
    expect(satisfyWaitingIntents).toHaveBeenCalledTimes(1);
  });

  it('T-AVREV-006g: an unexpected failure refuses that item only, without leaking the error', async () => {
    keepTitleAvailabilityChange
      .mockRejectedValueOnce(new Error('deadlock victim'))
      .mockResolvedValue({ count: 1 });
    const body = await json(
      await apply('keep', [
        { id: 'a', signature: LEFT },
        { id: 'b', signature: LEFT },
      ]),
    );
    expect(body).toMatchObject({ done: 1, refused: 1 });
    expect((body['results'] as Json[])[0]).toEqual({
      id: 'a',
      outcome: 'refused',
      code: 'INTERNAL_ERROR',
      message: "Couldn't make that change. Nothing was changed.",
    });
    expect(JSON.stringify(body)).not.toContain('deadlock');
  });
});
