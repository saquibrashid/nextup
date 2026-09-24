/**
 * #378 — waiting to stream, against the real store.
 *
 * `T-WAIT-016` — search-to-add records a waiting intent and changes nothing on
 * the combined list; a duplicate is refused rather than doubled; migration
 * 0017's coherence CHECK holds a search intent and a storefront intent to
 * their shapes; and the three new storefronts are accepted as batch sources.
 *
 * ⚠ **`T-WAIT-016c` IS THE STORE-LEVEL GUARD.** The route never writes a
 * search intent with a batch, but "the route doesn't" is not "the store
 * can't". If the CHECK were missing, a storefront intent could lose its
 * batch and nothing would notice until undo tried to find it.
 *
 * Integration level: the claims are about rows and constraints, which a
 * mocked store cannot have.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

vi.mock('../../src/clients/tmdbClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/clients/tmdbClient.js')>();
  class StubTmdbClient extends actual.TmdbClient {
    override getWork(
      mediaType: 'movie' | 'tv',
      tmdbId: number,
    ): ReturnType<InstanceType<typeof actual.TmdbClient>['getWork']> {
      return Promise.resolve({
        tmdbId,
        mediaType,
        name: `Work ${String(tmdbId)}`,
        releaseYear: 2026,
        posterPath: null,
        runtimeMinutes: 120,
        genres: [],
        imdbId: null,
      });
    }
    override getWatchOffers(): Promise<{ flatrate: string[]; rentOrBuy: string[] } | null> {
      return Promise.resolve({ flatrate: [], rentOrBuy: ['Apple TV'] });
    }
  }
  return { ...actual, TmdbClient: StubTmdbClient };
});

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const ISSUER = 'https://sts.windows.net/tenant/';
const SUBJECT = 'oid-owner-w378';

const principalHeader = Buffer.from(
  JSON.stringify({
    claims: [
      { typ: 'iss', val: ISSUER },
      { typ: OID, val: SUBJECT },
      { typ: 'preferred_username', val: 'owner@example.com' },
    ],
  }),
  'utf8',
).toString('base64');

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

const searchAdd = (body: unknown): Promise<Response> =>
  fetch(`${origin}/api/waiting`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [CLIENT_PRINCIPAL_HEADER]: principalHeader },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'test-key';
  app = createApp();
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
  });
  ownerId = ((await res.json()) as { ownerId: string }).ownerId;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterAll(async () => {
  await closeTestPrisma();
});

async function storefrontBatch(id: string, discoverySource: string): Promise<void> {
  await testPrisma().uploadBatch.create({
    data: {
      id,
      ownerId,
      service: null,
      discoverySource,
      mode: 'append-only',
      status: 'applied',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
    },
  });
}

describe('T-WAIT-016 · #378 · search-to-add and the 0017 shapes, in the store', () => {
  it('T-WAIT-016a · search-add records a waiting intent and leaves the combined list untouched', async () => {
    const res = await searchAdd({ tmdbId: 1001, mediaType: 'movie' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      intentId: string;
      titleId: string;
      titleWasCreated: boolean;
    };
    expect(body.titleWasCreated).toBe(true);

    const intent = await testPrisma().watchIntent.findUniqueOrThrow({
      where: { id: body.intentId },
    });
    expect(intent.discoverySource).toBe('search');
    expect(intent.sourceBatchId).toBeNull();
    expect(intent.state).toBe('waiting');

    // Invariant 5 / US-042 AC-3: no active title, no listing.
    const title = await testPrisma().title.findUniqueOrThrow({ where: { id: body.titleId } });
    expect(title.state).toBe('removed');
    expect(title.sortDateAdded).toBeNull();
    expect(await testPrisma().serviceListing.count({ where: { ownerId } })).toBe(0);

    const waiting = await fetch(`${origin}/api/waiting`, {
      headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader },
    });
    const list = (await waiting.json()) as {
      items: { intentId: string; discoverySource: string; accessState: string; rentOn: string[] }[];
    };
    const row = list.items.find((item) => item.intentId === body.intentId);
    expect(row?.discoverySource).toBe('search');
    expect(row?.accessState).toBe('rent-only');
    expect(row?.rentOn).toEqual(['Apple TV']);
  });

  it('T-WAIT-016b · adding the same work twice is refused, never doubled', async () => {
    expect((await searchAdd({ tmdbId: 1002, mediaType: 'movie' })).status).toBe(201);
    const again = await searchAdd({ tmdbId: 1002, mediaType: 'movie' });
    expect(again.status).toBe(409);
    const envelope = (await again.json()) as {
      error: { code: string; details: { reason: string } };
    };
    expect(envelope.error.code).toBe('DUPLICATE_WORK_IDENTITY');
    expect(envelope.error.details.reason).toBe('already-waiting');
    expect(await testPrisma().watchIntent.count({ where: { ownerId } })).toBe(1);
  });

  it('T-WAIT-016c · the store refuses a search intent with a batch and a storefront intent without one', async () => {
    await storefrontBatch('batch-w378-a', 'fandango-at-home');
    await testPrisma().title.create({
      data: {
        id: 'title-w378',
        ownerId,
        workIdentity: 'tmdb:movie:1003',
        state: 'removed',
        matchState: 'matched',
        tmdbId: 1003,
        tmdbMediaType: 'movie',
      },
    });
    const base = {
      ownerId,
      titleId: 'title-w378',
      workIdentity: 'tmdb:movie:1003',
      state: 'waiting',
    };

    await expect(
      testPrisma().watchIntent.create({
        data: { ...base, id: 'wi-bad-1', discoverySource: 'search', sourceBatchId: 'batch-w378-a' },
      }),
    ).rejects.toThrow();
    await expect(
      testPrisma().watchIntent.create({
        data: { ...base, id: 'wi-bad-2', discoverySource: 'fandango-at-home', sourceBatchId: null },
      }),
    ).rejects.toThrow();
    // ck_intent_rent_on_coherent: rent offers without an as-of date.
    await expect(
      testPrisma().watchIntent.create({
        data: {
          ...base,
          id: 'wi-bad-3',
          discoverySource: 'search',
          sourceBatchId: null,
          rentOn: JSON.stringify(['Apple TV']),
          availabilityCheckedAt: null,
        },
      }),
    ).rejects.toThrow();
    expect(await testPrisma().watchIntent.count({ where: { ownerId } })).toBe(0);
  });

  it('T-WAIT-016d · the new storefronts are accepted as batch sources, and a service name is not', async () => {
    for (const source of ['apple-tv-store', 'prime-video-store', 'google-tv-store']) {
      await storefrontBatch(`batch-${source}`, source);
    }
    expect(
      await testPrisma().uploadBatch.count({ where: { ownerId, discoverySource: { not: null } } }),
    ).toBe(3);
    // D-1: `prime-video` is a SERVICE and must never be a discovery source.
    await expect(storefrontBatch('batch-bad', 'prime-video')).rejects.toThrow();
  });
});
