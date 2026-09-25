/**
 * #380 — the streaming forecast through the real wiring: `GET /api/waiting`
 * reads release facts and the announced feed lazily, persists the FACTS on
 * `watch_intent`, and renders the forecast computed from them (T-FORECAST-006).
 *
 * ⚠ The stubs are installed on the CLIENT MODULES, not injected into the
 * route, so these cases observe `routes/index.ts` reaching the refresh — the
 * same reason `waitingAvailability.spec.ts` gives.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const MS_PER_DAY = 86_400_000;
const isoDaysFromNow = (n: number): string =>
  new Date(Date.now() + n * MS_PER_DAY).toISOString().slice(0, 10);

const factsCalls: number[] = [];
let flatrate: string[] = [];
let facts: { companyIds: number[]; theatricalOn: string | null; digitalOn: string | null } = {
  companyIds: [33],
  theatricalOn: null,
  digitalOn: null,
};
let feed: { tmdbId: number; mediaType: 'movie' | 'tv'; service: 'peacock'; on: string }[] = [];
let feedThrows = false;
let feedCalls = 0;

vi.mock('../../src/clients/tmdbClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/clients/tmdbClient.js')>();
  class StubTmdbClient extends actual.TmdbClient {
    override getWatchOffers(): Promise<{ flatrate: string[]; rentOrBuy: string[] }> {
      return Promise.resolve({ flatrate, rentOrBuy: ['Apple TV'] });
    }
    override getReleaseFacts(tmdbId: number): Promise<typeof facts> {
      factsCalls.push(tmdbId);
      return Promise.resolve(facts);
    }
  }
  return { ...actual, TmdbClient: StubTmdbClient };
});

vi.mock('../../src/clients/watchmodeClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/clients/watchmodeClient.js')>();
  class StubWatchmodeClient extends actual.WatchmodeClient {
    override get configured(): boolean {
      return true;
    }
    override listAnnouncedReleases(): Promise<typeof feed> {
      feedCalls += 1;
      return feedThrows ? Promise.reject(new Error('quota')) : Promise.resolve(feed);
    }
  }
  return { ...actual, WatchmodeClient: StubWatchmodeClient };
});

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-f380';
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
const authed = { [CLIENT_PRINCIPAL_HEADER]: principalHeader };

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

interface Forecast {
  kind: string;
  service: string;
  on?: string;
  month?: string;
  yours: boolean;
}

const waiting = async () => {
  const res = await fetch(`${origin}/api/waiting`, { headers: authed });
  expect(res.status).toBe(200);
  return (await res.json()) as { items: { intentId: string; forecast: Forecast | null }[] };
};

async function makeWaitingIntent(tmdbId: number): Promise<string> {
  await testPrisma().uploadBatch.create({
    data: {
      id: 'batch-f380',
      ownerId,
      service: null,
      discoverySource: 'fandango-at-home',
      mode: 'append-only',
      status: 'applied',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });
  await testPrisma().title.create({
    data: {
      id: 'title-f380',
      ownerId,
      workIdentity: `tmdb:movie:${tmdbId}`,
      state: 'removed',
      matchState: 'matched',
      tmdbId,
      tmdbMediaType: 'movie',
      tmdbName: 'Wicked: For Good',
      tmdbReleaseYear: 2026,
    },
  });
  await testPrisma().watchIntent.create({
    data: {
      id: 'wi-f380',
      ownerId,
      titleId: 'title-f380',
      workIdentity: `tmdb:movie:${tmdbId}`,
      state: 'waiting',
      sourceBatchId: 'batch-f380',
      discoverySource: 'fandango-at-home',
      discoveredAt: new Date(),
      availabilityRegion: 'US',
    },
  });
  return 'wi-f380';
}

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  factsCalls.length = 0;
  flatrate = [];
  facts = { companyIds: [33], theatricalOn: null, digitalOn: isoDaysFromNow(-10) };
  feed = [];
  feedThrows = false;
  feedCalls = 0;
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'test-key';
  app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const res = await fetch(`${origin}/api/me`, { headers: authed });
  ownerId = ((await res.json()) as { ownerId: string }).ownerId;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-FORECAST-006 · the forecast is read lazily, stored as facts, and rendered', () => {
  it('T-FORECAST-006a · a studio estimate is rendered, its facts persisted, and a fresh row asks nothing', async () => {
    const intentId = await makeWaitingIntent(967_941);

    const first = await waiting();
    const expectedMonth = isoDaysFromNow(-10 + 75).slice(0, 7);
    expect(first.items[0]?.forecast).toEqual({
      kind: 'estimate',
      service: 'peacock',
      month: expectedMonth,
      yours: true,
    });
    expect(factsCalls).toEqual([967_941]);

    const stored = await testPrisma().watchIntent.findUniqueOrThrow({ where: { id: intentId } });
    expect(stored.studioCompanyIds).toBe('[33]');
    expect(stored.digitalReleaseOn?.toISOString().slice(0, 10)).toBe(isoDaysFromNow(-10));
    expect(stored.forecastCheckedAt).not.toBeNull();
    expect(stored.announcedService).toBeNull();

    // Fresh for a week: rendered from the store, TMDB and Watchmode not asked.
    const second = await waiting();
    expect(second.items[0]?.forecast).toEqual(first.items[0]?.forecast);
    expect(factsCalls).toHaveLength(1);
    expect(feedCalls).toBe(1);
  });

  it('T-FORECAST-006b · an announced date wins, and a failed feed keeps it', async () => {
    const intentId = await makeWaitingIntent(967_941);
    const on = isoDaysFromNow(20);
    feed = [{ tmdbId: 967_941, mediaType: 'movie', service: 'peacock', on }];

    expect((await waiting()).items[0]?.forecast).toEqual({
      kind: 'announced',
      service: 'peacock',
      on,
      yours: true,
    });
    const stored = await testPrisma().watchIntent.findUniqueOrThrow({ where: { id: intentId } });
    expect(stored.announcedService).toBe('peacock');

    // A week later the feed is down: the announcement is kept, not dropped.
    await testPrisma().watchIntent.update({
      where: { id: intentId },
      data: { forecastCheckedAt: new Date(Date.now() - 8 * MS_PER_DAY) },
    });
    feedThrows = true;
    expect((await waiting()).items[0]?.forecast?.kind).toBe('announced');
    expect(
      (await testPrisma().watchIntent.findUniqueOrThrow({ where: { id: intentId } }))
        .announcedService,
    ).toBe('peacock');
  });

  it('T-FORECAST-006c · a work already streaming on a service is not forecast, and nothing is asked', async () => {
    await makeWaitingIntent(967_941);
    flatrate = ['Peacock Premium'];

    expect((await waiting()).items[0]?.forecast).toBeNull();
    expect(factsCalls).toEqual([]);
    expect(feedCalls).toBe(0);
  });

  it('T-FORECAST-006d · the refresh is metadata-only: no list state moves', async () => {
    const intentId = await makeWaitingIntent(967_941);
    const counts = async () => ({
      titles: await testPrisma().title.count(),
      listings: await testPrisma().serviceListing.count(),
      suppressions: await testPrisma().suppression.count(),
    });
    const before = await counts();
    const title = await testPrisma().title.findUniqueOrThrow({ where: { id: 'title-f380' } });

    await waiting();

    expect(await counts()).toEqual(before);
    expect(await testPrisma().title.findUniqueOrThrow({ where: { id: 'title-f380' } })).toEqual(
      title,
    );
    const intent = await testPrisma().watchIntent.findUniqueOrThrow({ where: { id: intentId } });
    expect(intent.state).toBe('waiting');
  });
});
