/**
 * US-063 (#397/#410, PRD `A54`, `specs/api.md` §6.40–§6.44) — the five
 * owner-initiated availability moves, with the repository mocked, plus the
 * Library availability pass that feeds them.
 *
 * The integration suite (`test/integration/availabilityMoves.spec.ts`) proves
 * what the STORE does with these writes. This one proves what each HANDLER
 * issues at the seams a real database cannot be made to take on demand, and
 * carries the coverage `npm run coverage` measures (the integration project
 * is not in it — see `manualListEdits.spec.ts`).
 *
 * ⚠ `isUniqueViolation` stays REAL: the tests throw a genuine SQL Server
 * `number: 2627` so the duplicate-vs-500 fork is actually exercised.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findServiceListingWithWork = vi.fn();
const findActiveSuppression = vi.fn();
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
const updateTitleAvailability = vi.fn();

vi.mock('../../../src/repository/ownerData.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/repository/ownerData.js')>();
  const fn =
    (mock: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      mock(...args);
  return {
    ...actual,
    findServiceListingWithWork: fn(findServiceListingWithWork),
    findActiveSuppression: fn(findActiveSuppression),
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
  const fn =
    (mock: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      mock(...args);
  return {
    ...actual,
    findWaitingIntent: fn(findWaitingIntent),
    keepTitleAvailabilityChange: fn(keepTitleAvailabilityChange),
    satisfyWaitingIntents: fn(satisfyWaitingIntents),
    listOwnerServices: fn(listOwnerServices),
    updateTitleAvailability: fn(updateTitleAvailability),
  };
});

const { createApp } = await import('../../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../../src/middleware/allowList.js');
const { parseServiceBody } = await import('../../../src/routes/availabilityMoves.js');
const { libraryAvailabilityPass, toAvailabilityRow, toListItem, applyAvailability } =
  await import('../../../src/routes/titles.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-availability-moves-unit';
const WORK = 'tmdb:movie:1100';

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

interface ErrorBody {
  error: { code: string; details: Record<string, unknown> };
}

let server: Server;
let app: Express;
let origin: string;

const call = (method: string, path: string, body?: unknown): Promise<Response> =>
  fetch(`${origin}${path}`, {
    method,
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const uniqueViolation = (): Error =>
  Object.assign(new Error('Violation of index.'), { number: 2627 });

const ACTIVE_TITLE = {
  id: 't-1',
  workIdentity: WORK,
  state: 'active',
  sortDateAdded: new Date('2026-01-05T00:00:00.000Z'),
  availableOn: '[]',
  rentOn: '["Apple TV"]',
  availabilityCheckedAt: new Date('2026-09-20T00:00:00.000Z'),
  availabilityRegion: 'US',
};

const WAITING_INTENT = {
  id: 'i-1',
  workIdentity: WORK,
  availableOn: '["Netflix"]',
  rentOn: '[]',
  availabilityCheckedAt: new Date('2026-09-20T00:00:00.000Z'),
  availabilityRegion: 'US',
  title: {
    tmdbId: 1100,
    tmdbMediaType: 'movie',
    tmdbName: 'The Housemaid',
    tmdbReleaseYear: 2025,
    tmdbRuntimeMinutes: 131,
    tmdbGenres: '["Thriller"]',
    tmdbComedyShow: false,
    tmdbPosterPath: '/h.jpg',
    tmdbFetchedAt: new Date('2026-09-01T00:00:00.000Z'),
    imdbId: 'tt1',
    editionLabels: null,
  },
};

beforeEach(async () => {
  vi.clearAllMocks();
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;

  findActiveSuppression.mockResolvedValue(null);
  findServiceListingWithWork.mockResolvedValue({
    listingId: 'l-1',
    titleId: 't-1',
    service: 'starz',
    state: 'active',
    title: { workIdentity: WORK },
  });
  findTitle.mockResolvedValue(ACTIVE_TITLE);
  findTitleByWorkIdentity.mockResolvedValue(null);
  createTitle.mockResolvedValue(undefined);
  createServiceListing.mockResolvedValue(undefined);
  updateTitle.mockResolvedValue({ count: 1 });
  softDeleteServiceListing.mockResolvedValue(undefined);
  listListingsForTitle.mockResolvedValue([
    {
      listingId: 'l-1',
      service: 'starz',
      state: 'active',
      dateAdded: new Date('2026-01-05T00:00:00.000Z'),
    },
  ]);
  listWaitingWorkIdentities.mockResolvedValue(new Set());
  createWatchIntent.mockResolvedValue(undefined);
  findWaitingIntent.mockResolvedValue(WAITING_INTENT);
  keepTitleAvailabilityChange.mockResolvedValue({ count: 1 });
  satisfyWaitingIntents.mockResolvedValue({ count: 1 });
  listOwnerServices.mockResolvedValue(['starz', 'netflix']);
  updateTitleAvailability.mockResolvedValue({ count: 1 });

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

describe('parseServiceBody', () => {
  it('T-MOVE-003a: accepts a supported service and refuses anything else', () => {
    expect(parseServiceBody({ service: 'netflix' })).toBe('netflix');
    for (const body of [null, [], 'x', {}, { service: 'hulu' }, { service: 7 }]) {
      expect(() => parseServiceBody(body)).toThrow();
    }
  });
});

describe('DELETE /api/listings/:listingId — §6.40 remove one badge', () => {
  it('T-MOVE-004a: soft-removes exactly that listing as "Removed by you" and rederives the title', async () => {
    listListingsForTitle.mockResolvedValue([
      {
        listingId: 'l-1',
        service: 'starz',
        state: 'removed',
        dateAdded: new Date('2026-01-05T00:00:00.000Z'),
      },
      {
        listingId: 'l-2',
        service: 'netflix',
        state: 'active',
        dateAdded: new Date('2026-03-01T00:00:00.000Z'),
      },
    ]);
    const response = await call('DELETE', '/api/listings/l-1');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ listingId: 'l-1', titleId: 't-1', service: 'starz' });
    expect(body['titleState']).toBe('active');
    const [, id, removal] = softDeleteServiceListing.mock.calls[0] as [
      unknown,
      string,
      Record<string, unknown>,
    ];
    expect(id).toBe('l-1');
    expect(removal['removedByBatchId']).toBeNull();
    expect(removal['removedByGroupId']).toBeNull();
    const [, , update] = updateTitle.mock.calls[0] as [unknown, string, Record<string, unknown>];
    expect(update['sortDateAdded']).toEqual(new Date('2026-03-01T00:00:00.000Z'));
  });

  it('T-MOVE-004b: removing the last badge leaves the title removed — a whole-title remove', async () => {
    listListingsForTitle.mockResolvedValue([
      {
        listingId: 'l-1',
        service: 'starz',
        state: 'removed',
        dateAdded: new Date('2026-01-05T00:00:00.000Z'),
      },
    ]);
    const response = await call('DELETE', '/api/listings/l-1');
    expect(((await response.json()) as Record<string, unknown>)['titleState']).toBe('removed');
    const [, , update] = updateTitle.mock.calls[0] as [unknown, string, Record<string, unknown>];
    expect(update).toEqual({ state: 'removed', sortDateAdded: null });
  });

  it('T-MOVE-004c: unknown, suppressed and already-removed listings are refused without a write', async () => {
    findServiceListingWithWork.mockResolvedValueOnce(null);
    expect((await call('DELETE', '/api/listings/nope')).status).toBe(404);

    findActiveSuppression.mockResolvedValueOnce({ id: 'sup-1' });
    const suppressed = await call('DELETE', '/api/listings/l-1');
    expect(suppressed.status).toBe(409);
    expect(((await suppressed.json()) as ErrorBody).error.code).toBe('WORK_SUPPRESSED');

    findServiceListingWithWork.mockResolvedValueOnce({
      listingId: 'l-1',
      titleId: 't-1',
      service: 'starz',
      state: 'removed',
      title: { workIdentity: WORK },
    });
    const removed = await call('DELETE', '/api/listings/l-1');
    expect(((await removed.json()) as ErrorBody).error.code).toBe('TITLE_NOT_ACTIVE');
    expect(softDeleteServiceListing).not.toHaveBeenCalled();
  });
});

describe('POST /api/titles/:titleId/badges — §6.44 add badge', () => {
  it('T-MOVE-005a: adds a manual listing dated today and keeps the earliest sort date', async () => {
    const response = await call('POST', '/api/titles/t-1/badges', { service: 'netflix' });
    expect(response.status).toBe(201);
    const [, listing] = createServiceListing.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(listing).toMatchObject({ titleId: 't-1', service: 'netflix', createdByBatchId: null });
    expect(updateTitle).not.toHaveBeenCalled();
  });

  it('T-MOVE-005b: a title with no earlier date takes today', async () => {
    findTitle.mockResolvedValueOnce({ ...ACTIVE_TITLE, sortDateAdded: null });
    expect((await call('POST', '/api/titles/t-1/badges', { service: 'netflix' })).status).toBe(201);
    expect(updateTitle).toHaveBeenCalledTimes(1);
  });

  it('T-MOVE-005c: duplicate, suppressed, inactive, unknown and malformed adds are refused', async () => {
    createServiceListing.mockRejectedValueOnce(uniqueViolation());
    const dup = await call('POST', '/api/titles/t-1/badges', { service: 'starz' });
    expect(((await dup.json()) as ErrorBody).error.code).toBe('DUPLICATE_WORK_IDENTITY');

    createServiceListing.mockRejectedValueOnce(new Error('boom'));
    expect((await call('POST', '/api/titles/t-1/badges', { service: 'starz' })).status).toBe(500);

    findActiveSuppression.mockResolvedValueOnce({ id: 'sup-1' });
    expect((await call('POST', '/api/titles/t-1/badges', { service: 'starz' })).status).toBe(409);

    findTitle.mockResolvedValueOnce({ ...ACTIVE_TITLE, state: 'removed' });
    const inactive = await call('POST', '/api/titles/t-1/badges', { service: 'starz' });
    expect(((await inactive.json()) as ErrorBody).error.code).toBe('TITLE_NOT_ACTIVE');

    findTitle.mockResolvedValueOnce(null);
    expect((await call('POST', '/api/titles/t-9/badges', { service: 'starz' })).status).toBe(404);

    expect((await call('POST', '/api/titles/t-1/badges', { service: 'hulu' })).status).toBe(400);
  });
});

describe('POST /api/waiting/:intentId/promote — §6.41 add to Library', () => {
  it('T-MOVE-006a: creates a new active title and listing dated today and satisfies the intent', async () => {
    const response = await call('POST', '/api/waiting/i-1/promote', { service: 'netflix' });
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['titleWasCreated']).toBe(true);
    const [, title] = createTitle.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(title).toMatchObject({
      workIdentity: WORK,
      state: 'active',
      tmdbName: 'The Housemaid',
      createdByBatchId: null,
      availableOn: '["Netflix"]',
    });
    const [, works] = satisfyWaitingIntents.mock.calls[0] as [unknown, string[]];
    expect(works).toEqual([WORK]);
  });

  it('T-MOVE-006b: an already-active title gains the listing, keeping its earliest date', async () => {
    findTitleByWorkIdentity.mockResolvedValueOnce({
      id: 't-1',
      state: 'active',
      sortDateAdded: new Date('2026-01-05T00:00:00.000Z'),
    });
    const body = (await (
      await call('POST', '/api/waiting/i-1/promote', { service: 'netflix' })
    ).json()) as Record<string, unknown>;
    expect(body['titleWasCreated']).toBe(false);
    expect(createTitle).not.toHaveBeenCalled();
    expect(updateTitle).not.toHaveBeenCalled();

    findTitleByWorkIdentity.mockResolvedValueOnce({
      id: 't-1',
      state: 'active',
      sortDateAdded: null,
    });
    await call('POST', '/api/waiting/i-1/promote', { service: 'netflix' });
    expect(updateTitle).toHaveBeenCalledTimes(1);
  });

  it('T-MOVE-006c: unknown, suppressed and duplicate promotions are refused and satisfy nothing', async () => {
    findWaitingIntent.mockResolvedValueOnce(null);
    expect((await call('POST', '/api/waiting/i-9/promote', { service: 'netflix' })).status).toBe(
      404,
    );
    findActiveSuppression.mockResolvedValueOnce({ id: 'sup-1' });
    expect((await call('POST', '/api/waiting/i-1/promote', { service: 'netflix' })).status).toBe(
      409,
    );
    createServiceListing.mockRejectedValueOnce(uniqueViolation());
    const dup = await call('POST', '/api/waiting/i-1/promote', { service: 'netflix' });
    expect(((await dup.json()) as ErrorBody).error.code).toBe('DUPLICATE_WORK_IDENTITY');
    expect(satisfyWaitingIntents).not.toHaveBeenCalled();
  });
});

describe('POST /api/titles/:titleId/move-to-waiting — §6.42', () => {
  it('T-MOVE-007a: soft-removes every active listing and opens a moved-from-library waiting intent', async () => {
    listListingsForTitle
      .mockResolvedValueOnce([
        { listingId: 'l-1', service: 'starz', state: 'active' },
        { listingId: 'l-0', service: 'max', state: 'removed' },
      ])
      .mockResolvedValue([
        {
          listingId: 'l-1',
          service: 'starz',
          state: 'removed',
          dateAdded: new Date('2026-01-05T00:00:00.000Z'),
        },
      ]);
    const response = await call('POST', '/api/titles/t-1/move-to-waiting');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body['removedListingIds']).toEqual(['l-1']);
    expect(typeof body['intentId']).toBe('string');
    expect(softDeleteServiceListing).toHaveBeenCalledTimes(1);
    const [, intent] = createWatchIntent.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(intent).toMatchObject({
      titleId: 't-1',
      workIdentity: WORK,
      state: 'waiting',
      discoverySource: 'search',
      sourceBatchId: null,
      rentOn: '["Apple TV"]',
    });
    expect(intent['movedFromLibraryAt']).toBeInstanceOf(Date);
  });

  it('T-MOVE-007b: a work already waiting keeps its one intent', async () => {
    listWaitingWorkIdentities.mockResolvedValueOnce(new Set([WORK]));
    const body = (await (await call('POST', '/api/titles/t-1/move-to-waiting')).json()) as Record<
      string,
      unknown
    >;
    expect(body['intentId']).toBeNull();
    expect(createWatchIntent).not.toHaveBeenCalled();
  });

  it('T-MOVE-007c: unknown, suppressed and not-in-library titles are refused without a write', async () => {
    findTitle.mockResolvedValueOnce(null);
    expect((await call('POST', '/api/titles/t-9/move-to-waiting')).status).toBe(404);
    findActiveSuppression.mockResolvedValueOnce({ id: 'sup-1' });
    expect((await call('POST', '/api/titles/t-1/move-to-waiting')).status).toBe(409);
    listListingsForTitle.mockResolvedValueOnce([]);
    const none = await call('POST', '/api/titles/t-1/move-to-waiting');
    expect(((await none.json()) as ErrorBody).error.code).toBe('TITLE_NOT_ACTIVE');
    expect(softDeleteServiceListing).not.toHaveBeenCalled();
  });
});

describe('POST /api/titles/:titleId/availability/keep — §6.43', () => {
  it('T-MOVE-008a: records exactly the kept signature and nothing else', async () => {
    const response = await call('POST', '/api/titles/t-1/availability/keep', {
      signature: 'left=starz;joined=',
    });
    expect(response.status).toBe(200);
    expect(keepTitleAvailabilityChange).toHaveBeenCalledWith(
      expect.anything(),
      't-1',
      'left=starz;joined=',
    );
    expect(updateTitle).not.toHaveBeenCalled();
    expect(softDeleteServiceListing).not.toHaveBeenCalled();
  });

  it('T-MOVE-008b: a malformed signature or unknown title is refused', async () => {
    for (const body of [{ signature: 'drop table' }, [], null]) {
      expect((await call('POST', '/api/titles/t-1/availability/keep', body)).status).toBe(400);
    }
    findTitle.mockResolvedValueOnce(null);
    expect(
      (await call('POST', '/api/titles/t-9/availability/keep', { signature: 'left=starz;joined=' }))
        .status,
    ).toBe(404);
    expect(keepTitleAvailabilityChange).not.toHaveBeenCalled();
  });
});

describe('libraryAvailabilityPass — PRD §7.4 process 4 widened (US-063 AC-1)', () => {
  const NOW = new Date('2026-09-29T12:00:00.000Z');
  const row = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    workIdentity: `tmdb:movie:${id}`,
    tmdbId: 1100,
    tmdbMediaType: 'movie',
    availabilityRegion: 'US',
    availabilityCheckedAt: null,
    availableOn: null,
    rentOn: null,
    listings: [{ service: 'starz', listingId: `l-${id}`, dateAdded: new Date('2026-01-05') }],
    ...extra,
  });

  it('T-MOVE-009a: refreshes at most eight due page rows, serially, writing only availability', async () => {
    const getWatchOffers = vi.fn().mockResolvedValue({ flatrate: [], rentOrBuy: ['Apple TV'] });
    const rows = Array.from({ length: 12 }, (_, i) => row(`r${String(i)}`));
    const result = await libraryAvailabilityPass(
      'owner' as never,
      rows as never,
      () => ({ getWatchOffers }),
      NOW,
    );
    expect(getWatchOffers).toHaveBeenCalledTimes(8);
    expect(getWatchOffers).toHaveBeenCalledWith('movie', 1100, 'US');
    expect(updateTitleAvailability).toHaveBeenCalledTimes(8);
    const [, , data] = updateTitleAvailability.mock.calls[0] as [
      unknown,
      string,
      Record<string, unknown>,
    ];
    expect(Object.keys(data).sort()).toEqual([
      'availabilityCheckedAt',
      'availabilityRegion',
      'availableOn',
      'rentOn',
    ]);
    expect(data['rentOn']).toBe('["Apple TV"]');
    expect(result.yours).toEqual(['netflix', 'starz']);
    expect(result.written.size).toBe(8);
  });

  it('T-MOVE-009b: a failed lookup writes nothing and the last-known answer is kept', async () => {
    const getWatchOffers = vi.fn().mockRejectedValue(new Error('TMDB down'));
    const result = await libraryAvailabilityPass(
      'owner' as never,
      [row('r1')] as never,
      () => ({ getWatchOffers }),
      NOW,
    );
    expect(updateTitleAvailability).not.toHaveBeenCalled();
    expect(result.yours).not.toBeNull();

    const nullOffers = vi.fn().mockResolvedValue(null);
    await libraryAvailabilityPass(
      'owner' as never,
      [row('r2')] as never,
      () => ({
        getWatchOffers: nullOffers,
      }),
      NOW,
    );
    const [, , data] = updateTitleAvailability.mock.calls[0] as [
      unknown,
      string,
      Record<string, unknown>,
    ];
    expect(data['availableOn']).toBeNull();
    expect(data['rentOn']).toBeNull();
  });

  it('T-MOVE-009c: a fresh page asks nothing; a store failure never fails the list', async () => {
    const getWatchOffers = vi.fn();
    await libraryAvailabilityPass(
      'owner' as never,
      [row('r1', { availabilityCheckedAt: NOW })] as never,
      () => ({ getWatchOffers }),
      NOW,
    );
    expect(getWatchOffers).not.toHaveBeenCalled();

    listOwnerServices.mockRejectedValueOnce(new Error('db down'));
    const failed = await libraryAvailabilityPass(
      'owner' as never,
      [row('r1')] as never,
      () => ({ getWatchOffers }),
      NOW,
    );
    expect(failed.yours).toBeNull();

    const noRegion = await libraryAvailabilityPass(
      'owner' as never,
      [{ ...row('r1'), availabilityRegion: undefined }] as never,
      () => ({ getWatchOffers }),
      NOW,
    );
    expect(noRegion.yours).toBeNull();
    expect(listOwnerServices).toHaveBeenCalledTimes(2);
  });

  it('T-MOVE-009d: the served item carries availability only when the owner services resolved', () => {
    const base = {
      ...row('r1'),
      state: 'active',
      matchState: 'matched',
      tmdbName: 'The Housemaid',
      sortDateAdded: new Date('2026-01-05'),
      availableOn: '[]',
      rentOn: '["Apple TV"]',
      availabilityCheckedAt: new Date('2026-09-20T00:00:00.000Z'),
      availabilityKeptSignature: null,
    };
    const withYours = toListItem(base as never, false, ['starz']);
    expect(withYours['availability']).toMatchObject({
      left: ['starz'],
      signature: 'left=starz;joined=',
      canMoveToWaiting: true,
    });
    expect(toListItem(base as never, false, null)['availability']).toBeUndefined();
    expect(toAvailabilityRow({ ...base, listings: [] } as never)).toBeNull();

    const written = new Map([
      [
        'r1',
        {
          id: 'r1',
          availableOn: ['Starz'],
          rentOn: null,
          streamingSince: null,
          availabilityCheckedAt: NOW,
          availabilityRegion: 'US',
        },
      ],
    ]);
    const applied = applyAvailability(base as never, written) as unknown as Record<string, unknown>;
    expect(applied['availableOn']).toBe('["Starz"]');
    expect(applied['rentOn']).toBeNull();
    expect(applyAvailability(base as never, new Map())).toBe(base);
  });
});
