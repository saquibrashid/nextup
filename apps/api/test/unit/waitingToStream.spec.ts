/**
 * #378 — Waiting to stream, the handler arm: access states, "your services"
 * versus the rest, and search-to-add. Over real HTTP with the repository and
 * the TMDB client mocked, like `waitingRoute.spec.ts`; the store-level half is
 * `integration/waitingToStream.spec.ts`.
 *
 * `T-AVAIL-013` — what one row says about where a title can be watched.
 * `T-WAIT-015`  — `POST /api/waiting`, and that it never touches the library.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listWaitingIntents = vi.fn();
const updateWatchIntentAvailability = vi.fn();
const listOwnerServices = vi.fn();
const getWatchOffers = vi.fn();
const getWork = vi.fn();

const findActiveSuppression = vi.fn();
const listListedWorkIdentities = vi.fn();
const listWaitingWorkIdentities = vi.fn();
const findTitleByWorkIdentity = vi.fn();
const createTitle = vi.fn();
const createWatchIntent = vi.fn();

vi.mock('../../src/repository/watchIntents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/watchIntents.js')>();
  return {
    ...actual,
    listWaitingIntents: (...args: unknown[]) => listWaitingIntents(...args) as unknown,
    updateWatchIntentAvailability: (...args: unknown[]) =>
      updateWatchIntentAvailability(...args) as unknown,
    listOwnerServices: (...args: unknown[]) => listOwnerServices(...args) as unknown,
  };
});

vi.mock('../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/ownerData.js')>();
  return {
    ...actual,
    findActiveSuppression: (...args: unknown[]) => findActiveSuppression(...args) as unknown,
    listListedWorkIdentities: (...args: unknown[]) => listListedWorkIdentities(...args) as unknown,
    listWaitingWorkIdentities: (...args: unknown[]) =>
      listWaitingWorkIdentities(...args) as unknown,
    findTitleByWorkIdentity: (...args: unknown[]) => findTitleByWorkIdentity(...args) as unknown,
    createTitle: (...args: unknown[]) => createTitle(...args) as unknown,
    createWatchIntent: (...args: unknown[]) => createWatchIntent(...args) as unknown,
    runInTransaction: <T>(work: (tx: unknown) => Promise<T>) => work({ tx: true }),
  };
});

vi.mock('../../src/clients/tmdbClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/clients/tmdbClient.js')>();
  class StubTmdbClient extends actual.TmdbClient {
    override getWatchOffers(...args: unknown[]) {
      return getWatchOffers(...args) as Promise<{ flatrate: string[]; rentOrBuy: string[] } | null>;
    }
    override getWork(...args: unknown[]) {
      return getWork(...args) as ReturnType<InstanceType<typeof actual.TmdbClient>['getWork']>;
    }
  }
  return { ...actual, TmdbClient: StubTmdbClient };
});

const { createApp } = await import('../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../src/middleware/allowList.js');
const { TmdbWorkNotFoundError } = await import('../../src/clients/tmdbClient.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-waiting-to-stream';
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

const MS_PER_DAY = 86_400_000;
const OLD = new Date(Date.now() - 90 * MS_PER_DAY);
const RECENT = new Date(Date.now() - 1 * MS_PER_DAY);

interface StoredOver {
  id?: string;
  checkedAt?: Date | null;
  availableOn?: string | null;
  rentOn?: string | null;
  streamingSince?: Date | null;
  discoverySource?: string;
}

function stored(over: StoredOver = {}): Record<string, unknown> {
  return {
    id: over.id ?? 'wi-1',
    titleId: 'title-1',
    workIdentity: 'tmdb:movie:438631',
    discoveredAt: new Date('2026-01-02T00:00:00.000Z'),
    discoverySource: over.discoverySource ?? 'apple-tv-store',
    availabilityRegion: 'US',
    availabilityCheckedAt: over.checkedAt === undefined ? OLD : over.checkedAt,
    availableOn: over.availableOn ?? null,
    rentOn: over.rentOn === undefined ? '[]' : over.rentOn,
    streamingSince: over.streamingSince ?? null,
    title: {
      id: 'title-1',
      tmdbId: 438_631,
      tmdbMediaType: 'movie',
      tmdbName: 'Dune',
      tmdbReleaseYear: 2021,
      tmdbPosterPath: '/p.jpg',
      rawExtractedText: null,
    },
  };
}

interface Item {
  flaggedOn: string[] | null;
  otherServicesOn: string[] | null;
  otherProvidersOn: string[] | null;
  rentOn: string[] | null;
  accessState: string;
  streamingSince: string | null;
  discoverySource: string;
}

let server: Server;
let app: Express;
let origin: string;

async function getItems(): Promise<Item[]> {
  const res = await fetch(`${origin}/api/waiting`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: Item[] }).items;
}

async function post(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${origin}/api/waiting`, {
    method: 'POST',
    headers: {
      [CLIENT_PRINCIPAL_HEADER]: principalHeader,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function lastWrite(): Record<string, unknown> {
  const call = updateWatchIntentAvailability.mock.calls.at(-1) as [unknown, string, object];
  return call[2] as Record<string, unknown>;
}

const DETAIL = {
  tmdbId: 438_631,
  mediaType: 'movie',
  name: 'Dune',
  releaseYear: 2021,
  runtimeMinutes: 155,
  genres: ['Science Fiction'],
  posterPath: '/p.jpg',
  imdbId: 'tt1160419',
  comedyShow: false,
};

beforeEach(async () => {
  vi.clearAllMocks();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'test-key';
  updateWatchIntentAvailability.mockResolvedValue({ count: 1 });
  listOwnerServices.mockResolvedValue(['netflix']);
  getWatchOffers.mockResolvedValue({ flatrate: [], rentOrBuy: [] });
  getWork.mockResolvedValue(DETAIL);
  findActiveSuppression.mockResolvedValue(null);
  listListedWorkIdentities.mockResolvedValue(new Set());
  listWaitingWorkIdentities.mockResolvedValue(new Set());
  findTitleByWorkIdentity.mockResolvedValue(null);
  createTitle.mockResolvedValue({});
  createWatchIntent.mockResolvedValue({});
  app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('T-AVAIL-013 · where a waiting title can be watched', () => {
  it('T-AVAIL-013a · streaming splits into the services you use and everything else', async () => {
    getWatchOffers.mockResolvedValue({
      flatrate: ['Netflix', 'Max', 'Hulu', 'hulu'],
      rentOrBuy: ['Apple TV'],
    });
    listWaitingIntents.mockResolvedValue([stored()]);

    const [item] = await getItems();
    expect(item).toMatchObject({
      accessState: 'streaming',
      flaggedOn: ['netflix'],
      otherServicesOn: ['max'],
      otherProvidersOn: ['Hulu'],
      rentOn: ['Apple TV'],
    });
  });

  it('T-AVAIL-013b · before any import, every supported service counts as yours', async () => {
    listOwnerServices.mockResolvedValue([]);
    listWaitingIntents.mockResolvedValue([
      stored({ checkedAt: RECENT, availableOn: JSON.stringify(['Max']) }),
    ]);

    const [item] = await getItems();
    expect(item?.flaggedOn).toEqual(['max']);
    expect(item?.otherServicesOn).toEqual([]);
  });

  it('T-AVAIL-013c · rent/buy offers alone are rent-only, recorded and never availability', async () => {
    getWatchOffers.mockResolvedValue({ flatrate: [], rentOrBuy: ['Apple TV', 'Amazon Video'] });
    listWaitingIntents.mockResolvedValue([stored()]);

    const [item] = await getItems();
    expect(item).toMatchObject({
      accessState: 'rent-only',
      flaggedOn: [],
      otherServicesOn: [],
      otherProvidersOn: [],
      rentOn: ['Apple TV', 'Amazon Video'],
      streamingSince: null,
    });
    expect(lastWrite()).toMatchObject({
      availableOn: '[]',
      rentOn: JSON.stringify(['Apple TV', 'Amazon Video']),
      streamingSince: null,
    });
  });

  it('T-AVAIL-013d · a title only on a free or ad-supported tier is not streaming', async () => {
    // `getWatchOffers` reads `flatrate`, `rent` and `buy` only; a free/ads
    // offer reaches the handler as nothing at all (owner decision 1).
    getWatchOffers.mockResolvedValue({ flatrate: [], rentOrBuy: [] });
    listWaitingIntents.mockResolvedValue([stored()]);

    const [item] = await getItems();
    expect(item?.accessState).toBe('not-seen');
    expect(item?.streamingSince).toBeNull();
  });

  it('T-AVAIL-013e · the first subscription sighting is kept, then cleared when it goes', async () => {
    getWatchOffers.mockResolvedValue({ flatrate: ['Hulu'], rentOrBuy: [] });
    listWaitingIntents.mockResolvedValue([stored()]);
    const [first] = await getItems();
    expect(first?.accessState).toBe('streaming');
    const since = lastWrite()['streamingSince'] as Date;
    expect(since).toBeInstanceOf(Date);
    expect(first?.streamingSince).toBe(since.toISOString());

    // Still streaming on the next refresh: the ORIGINAL date survives.
    const earlier = new Date('2026-03-01T00:00:00.000Z');
    listWaitingIntents.mockResolvedValue([
      stored({ availableOn: JSON.stringify(['Hulu']), streamingSince: earlier }),
    ]);
    const [second] = await getItems();
    expect(second?.streamingSince).toBe(earlier.toISOString());

    // Gone from every subscription: cleared, not kept as a stale highlight.
    getWatchOffers.mockResolvedValue({ flatrate: [], rentOrBuy: ['Apple TV'] });
    const [third] = await getItems();
    expect(third?.streamingSince).toBeNull();
    expect(third?.accessState).toBe('rent-only');
  });

  it('T-AVAIL-013f · a row answered before rent offers were recorded is asked once more', async () => {
    listWaitingIntents.mockResolvedValue([
      stored({ checkedAt: RECENT, availableOn: '[]', rentOn: null }),
    ]);
    await getItems();
    expect(getWatchOffers).toHaveBeenCalledTimes(1);

    // The discriminating half: a recent row that HAS rent data is not re-asked.
    getWatchOffers.mockClear();
    listWaitingIntents.mockResolvedValue([
      stored({ checkedAt: RECENT, availableOn: '[]', rentOn: '[]' }),
    ]);
    await getItems();
    expect(getWatchOffers).not.toHaveBeenCalled();
  });

  it('T-AVAIL-013g · never-checked and not-known answers stay distinct from not-seen', async () => {
    getWatchOffers.mockResolvedValue(null);
    listWaitingIntents.mockResolvedValue([
      stored({ id: 'wi-unknown' }),
      stored({ id: 'wi-never', checkedAt: null }),
    ]);
    getWatchOffers.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('down'));

    const items = await getItems();
    expect(items.map((item) => item.accessState)).toEqual(['unknown', 'not-checked']);
    expect(items.map((item) => item.otherServicesOn)).toEqual([null, null]);
  });
});

describe('T-WAIT-015 · POST /api/waiting — wait for one title found by search', () => {
  it('T-WAIT-015a · creates a batchless search intent on a removed, dateless title', async () => {
    const { status, body } = await post({ tmdbId: 438_631, mediaType: 'movie' });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      workIdentity: 'tmdb:movie:438631',
      name: 'Dune',
      discoverySource: 'search',
      titleWasCreated: true,
    });

    expect(createTitle).toHaveBeenCalledTimes(1);
    const title = (createTitle.mock.calls[0] as [unknown, Record<string, unknown>])[1];
    expect(title).not.toHaveProperty('sortDateAdded');
    expect(title).toMatchObject({
      state: 'removed',
      matchState: 'matched',
      createdByBatchId: null,
      tmdbId: 438_631,
      tmdbName: 'Dune',
    });

    const intent = (createWatchIntent.mock.calls[0] as [unknown, Record<string, unknown>])[1];
    expect(intent).toMatchObject({
      titleId: title['id'],
      workIdentity: 'tmdb:movie:438631',
      sourceBatchId: null,
      discoverySource: 'search',
      state: 'waiting',
    });
  });

  it('T-WAIT-015b · a suppressed work is refused before TMDB is asked', async () => {
    findActiveSuppression.mockResolvedValue({ id: 'sup-1' });
    const { status, body } = await post({ tmdbId: 438_631, mediaType: 'movie' });
    expect(status).toBe(409);
    expect((body['error'] as { code: string }).code).toBe('WORK_SUPPRESSED');
    expect(getWork).not.toHaveBeenCalled();
    expect(createWatchIntent).not.toHaveBeenCalled();
  });

  it('T-WAIT-015c · a work already in the library is refused and nothing is written', async () => {
    listListedWorkIdentities.mockResolvedValue(new Set(['tmdb:movie:438631']));
    const { status, body } = await post({ tmdbId: 438_631, mediaType: 'movie' });
    expect(status).toBe(409);
    expect(body['error']).toMatchObject({
      code: 'DUPLICATE_WORK_IDENTITY',
      details: { reason: 'already-listed' },
    });
    expect(createTitle).not.toHaveBeenCalled();
    expect(createWatchIntent).not.toHaveBeenCalled();
  });

  it('T-WAIT-015d · a work already waiting is refused, never doubled', async () => {
    listWaitingWorkIdentities.mockResolvedValue(new Set(['tmdb:movie:438631']));
    const { status, body } = await post({ tmdbId: 438_631, mediaType: 'movie' });
    expect(status).toBe(409);
    expect(body['error']).toMatchObject({ details: { reason: 'already-waiting' } });
    expect(createWatchIntent).not.toHaveBeenCalled();
  });

  it('T-WAIT-015e · two racing adds: the store index refusal is the same 409', async () => {
    createWatchIntent.mockRejectedValue(Object.assign(new Error('dup'), { number: 2601 }));
    const { status, body } = await post({ tmdbId: 438_631, mediaType: 'movie' });
    expect(status).toBe(409);
    expect(body['error']).toMatchObject({ details: { reason: 'already-waiting' } });
  });

  it('T-WAIT-015f · an existing removed title is reused as it stands', async () => {
    findTitleByWorkIdentity.mockResolvedValue({ id: 'title-old', state: 'removed' });
    const { status, body } = await post({ tmdbId: 438_631, mediaType: 'movie' });
    expect(status).toBe(201);
    expect(body['titleWasCreated']).toBe(false);
    expect(createTitle).not.toHaveBeenCalled();
    expect((createWatchIntent.mock.calls[0] as [unknown, { titleId: string }])[1].titleId).toBe(
      'title-old',
    );
  });

  it('T-WAIT-015g · bad bodies are 400 and an unknown TMDB work is 404', async () => {
    for (const bad of [
      null,
      [],
      { tmdbId: 0, mediaType: 'movie' },
      { tmdbId: 5, mediaType: 'x' },
    ]) {
      const { status } = await post(bad);
      expect(status, JSON.stringify(bad)).toBe(400);
    }
    getWork.mockRejectedValue(new TmdbWorkNotFoundError('movie', 5));
    const { status, body } = await post({ tmdbId: 5, mediaType: 'movie' });
    expect(status).toBe(404);
    expect((body['error'] as { code: string }).code).toBe('TMDB_WORK_NOT_FOUND');
    expect(createWatchIntent).not.toHaveBeenCalled();
  });
});
