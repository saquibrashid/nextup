/**
 * `GET /api/waiting` — the handler arm, over real HTTP with the repository and
 * the TMDB client mocked (TASK-187, US-042, `specs/api.md`).
 *
 * The store-level properties — that no `Title`, `ServiceListing` or
 * `Suppression` is written, that the intent stays `waiting`, that the combined
 * list is unchanged — belong to `integration/waitingAvailability.spec.ts` and
 * are asserted there against a real SQL Server. What is proven HERE is what the
 * handler does with what it is given: that it refreshes only the stale rows,
 * shapes each item field by field, keeps NOT KNOWN distinct from
 * ASKED-AND-NOBODY, and never turns a TMDB failure into an error page.
 *
 * It also carries the coverage: `npm run coverage` excludes the integration
 * project, so without this file the route would be uncovered while looking
 * thoroughly tested.
 */

import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import type { Express } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const listWaitingIntents = vi.fn();
const updateWatchIntentAvailability = vi.fn();
const getWatchProviders = vi.fn();

vi.mock('../../src/repository/watchIntents.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repository/watchIntents.js')>();
  return {
    ...actual,
    listWaitingIntents: (...args: unknown[]) => listWaitingIntents(...args) as unknown,
    updateWatchIntentAvailability: (...args: unknown[]) =>
      updateWatchIntentAvailability(...args) as unknown,
  };
});

vi.mock('../../src/clients/tmdbClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/clients/tmdbClient.js')>();
  class StubTmdbClient extends actual.TmdbClient {
    override getWatchProviders(...args: unknown[]): Promise<string[] | null> {
      return getWatchProviders(...args) as Promise<string[] | null>;
    }
  }
  return { ...actual, TmdbClient: StubTmdbClient };
});

const { createApp } = await import('../../src/app.js');
const { CLIENT_PRINCIPAL_HEADER } = await import('../../src/auth/principal.js');
const { resetAllowListWarning } = await import('../../src/middleware/allowList.js');

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-waiting-route';

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
  region?: string;
  tmdbId?: number | null;
  tmdbName?: string | null;
  rawExtractedText?: string | null;
}

function stored(over: StoredOver = {}): Record<string, unknown> {
  return {
    id: over.id ?? 'wi-1',
    workIdentity: 'tmdb:movie:438631',
    discoveredAt: new Date('2026-01-02T00:00:00.000Z'),
    discoverySource: 'fandango-at-home',
    availabilityRegion: over.region ?? 'US',
    availabilityCheckedAt: over.checkedAt === undefined ? OLD : over.checkedAt,
    availableOn: over.availableOn ?? null,
    title: {
      id: 'title-1',
      tmdbId: over.tmdbId === undefined ? 438_631 : over.tmdbId,
      tmdbMediaType: over.tmdbId === null ? null : 'movie',
      tmdbName: over.tmdbName === undefined ? 'Dune' : over.tmdbName,
      tmdbReleaseYear: 2021,
      tmdbPosterPath: '/p.jpg',
      rawExtractedText: over.rawExtractedText === undefined ? 'dune raw' : over.rawExtractedText,
    },
  };
}

let server: Server;
let app: Express;
let origin: string;

interface Body {
  count: number;
  items: {
    intentId: string;
    name: string;
    discoveredAt: string;
    discoverySource: string;
    availableOn: string[] | null;
    flaggedOn: string[] | null;
    availabilityCheckedAt: string | null;
    availabilityRegion: string;
  }[];
}

const get = async (): Promise<{ status: number; body: Body }> => {
  const res = await fetch(`${origin}/api/waiting`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });
  return { status: res.status, body: (await res.json()) as Body };
};

beforeEach(async () => {
  vi.clearAllMocks();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'test-key';
  updateWatchIntentAvailability.mockResolvedValue({ count: 1 });
  getWatchProviders.mockResolvedValue(['Netflix']);
  app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('T-AVAIL-011 · GET /api/waiting without a store', () => {
  it('T-AVAIL-011a · a stale intent is refreshed, persisted and rendered', async () => {
    listWaitingIntents.mockResolvedValue([stored()]);

    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.count).toBe(1);
    expect(getWatchProviders).toHaveBeenCalledWith('movie', 438_631, 'US');

    // The write is the narrow three-column one, and the freshly-fetched answer
    // is what the response renders — not the stale row it replaced.
    expect(updateWatchIntentAvailability).toHaveBeenCalledTimes(1);
    const [, id, data] = updateWatchIntentAvailability.mock.calls[0] as [
      unknown,
      string,
      { availableOn: string | null; availabilityRegion: string },
    ];
    expect(id).toBe('wi-1');
    expect(data.availableOn).toBe(JSON.stringify(['Netflix']));
    expect(data.availabilityRegion).toBe('US');

    expect(body.items[0]).toMatchObject({
      intentId: 'wi-1',
      name: 'Dune',
      discoveredAt: '2026-01-02',
      discoverySource: 'fandango-at-home',
      availableOn: ['Netflix'],
      flaggedOn: ['netflix'],
      availabilityRegion: 'US',
    });
    expect(body.items[0]?.availabilityCheckedAt).not.toBeNull();
  });

  it('T-AVAIL-011b · a fresh intent is rendered from the store and asks TMDB nothing', async () => {
    // ⚠ The discriminating case at the handler level: without it every other
    // assertion here passes against a route that re-asks on every render.
    listWaitingIntents.mockResolvedValue([
      stored({ checkedAt: RECENT, availableOn: JSON.stringify(['Max']) }),
    ]);

    const { body } = await get();
    expect(getWatchProviders).not.toHaveBeenCalled();
    expect(updateWatchIntentAvailability).not.toHaveBeenCalled();
    expect(body.items[0]?.availableOn).toEqual(['Max']);
    expect(body.items[0]?.flaggedOn).toEqual(['max']);
    expect(body.items[0]?.availabilityCheckedAt).toBe(RECENT.toISOString());
  });

  it('T-AVAIL-011c · malformed stored JSON degrades to NOT KNOWN, never a 500', async () => {
    // ⚠ `available_on` is NVARCHAR(MAX) holding JSON. One bad row must not take
    // the whole waiting view down — and the safe reading of a value we cannot
    // parse is "not known", never "not streaming anywhere".
    listWaitingIntents.mockResolvedValue([
      stored({ id: 'wi-bad', checkedAt: RECENT, availableOn: '{not json' }),
      stored({ id: 'wi-obj', checkedAt: RECENT, availableOn: '{"a":1}' }),
      stored({ id: 'wi-mixed', checkedAt: RECENT, availableOn: '["Netflix",7,null]' }),
    ]);

    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.items.map((i) => i.availableOn)).toEqual([null, null, ['Netflix']]);
    expect(body.items.map((i) => i.flaggedOn)).toEqual([null, null, ['netflix']]);
  });

  it('T-AVAIL-011d · a TMDB failure is a 200 with the last-known answer, not an error page', async () => {
    getWatchProviders.mockRejectedValue(new Error('tmdb down'));
    listWaitingIntents.mockResolvedValue([stored({ availableOn: JSON.stringify(['Max']) })]);

    const { status, body } = await get();
    expect(status).toBe(200);
    // Nothing was written, and the previous answer survived intact. Writing a
    // null here would erase it and downgrade the row to "not known".
    expect(updateWatchIntentAvailability).not.toHaveBeenCalled();
    expect(body.items[0]?.availableOn).toEqual(['Max']);
    expect(body.items[0]?.availabilityCheckedAt).toBe(OLD.toISOString());
  });

  it('T-AVAIL-011e · an unmatched work is listed but never asked about', async () => {
    // No TMDB id, so there is no question to ask; spending the per-request
    // budget on it would buy a guaranteed 404. It still appears in the view,
    // falling back to the raw extracted text for its name.
    listWaitingIntents.mockResolvedValue([
      stored({ id: 'wi-unmatched', tmdbId: null, tmdbName: null }),
    ]);

    const { body } = await get();
    expect(getWatchProviders).not.toHaveBeenCalled();
    expect(body.items[0]?.name).toBe('dune raw');
    expect(body.items[0]?.availableOn).toBeNull();
  });

  it('T-AVAIL-011f · an empty waiting list is a 200 with no lookups', async () => {
    listWaitingIntents.mockResolvedValue([]);

    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body).toEqual({ items: [], count: 0 });
    expect(getWatchProviders).not.toHaveBeenCalled();
  });

  it('T-AVAIL-011g · the region is taken from each row, not from a call-site default', async () => {
    listWaitingIntents.mockResolvedValue([
      stored({ id: 'wi-us', region: 'US' }),
      stored({ id: 'wi-gb', region: 'GB', tmdbId: 949 }),
    ]);

    await get();
    expect(getWatchProviders.mock.calls.map((c) => c[2])).toEqual(['US', 'GB']);
  });

  it('T-AVAIL-011h · a title with neither a TMDB name nor raw text renders an empty name, never undefined', async () => {
    listWaitingIntents.mockResolvedValue([
      stored({ checkedAt: RECENT, tmdbName: null, rawExtractedText: null }),
    ]);

    const { body } = await get();
    expect(body.items[0]?.name).toBe('');
  });
});
