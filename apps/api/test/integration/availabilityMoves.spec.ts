/**
 * US-063 (#397/#410, PRD `A54`) — availability moves against a REAL SQL
 * Server: the widened lazy refresh writes Library availability and nothing
 * else, and each owner move leaves the store in the state the specs promise
 * (soft delete, restorable, one waiting intent, intent satisfied in the same
 * request).
 *
 * ⚠ `T-MOVE-014a` IS THE INVARIANT-5 ASSERTION for the widening: the Library
 * refresh counts listings, title states and intents before and after, rather
 * than trusting the writer's shape.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { findWaitingIntent } from '../../src/repository/watchIntents.js';
import type { OwnerId } from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const providerCalls: number[] = [];
let offers: { flatrate: string[]; rentOrBuy: string[] } | null = {
  flatrate: [],
  rentOrBuy: ['Apple TV'],
};

vi.mock('../../src/clients/tmdbClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/clients/tmdbClient.js')>();
  class StubTmdbClient extends actual.TmdbClient {
    override getWatchOffers(
      _mediaType: 'movie' | 'tv',
      tmdbId: number,
    ): Promise<{ flatrate: string[]; rentOrBuy: string[] } | null> {
      providerCalls.push(tmdbId);
      return Promise.resolve(offers);
    }
    override getReleaseFacts(): Promise<null> {
      return Promise.resolve(null);
    }
  }
  return { ...actual, TmdbClient: StubTmdbClient };
});

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-moves';
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
let ownerId: string;

const call = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = await fetch(`${origin}/api${path}`, {
    method,
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

async function seedLibraryTitle(id: string, services: string[], tmdbId = 1100) {
  await testPrisma().title.create({
    data: {
      id,
      ownerId,
      workIdentity: `tmdb:movie:${String(tmdbId)}`,
      state: 'active',
      matchState: 'matched',
      tmdbId,
      tmdbMediaType: 'movie',
      tmdbName: 'The Housemaid',
      tmdbReleaseYear: 2025,
      tmdbGenres: '[]',
      sortDateAdded: new Date('2026-01-05T00:00:00.000Z'),
    },
  });
  for (const service of services) {
    await testPrisma().serviceListing.create({
      data: {
        listingId: `l-${id}-${service}`,
        ownerId,
        titleId: id,
        service,
        state: 'active',
        dateAdded: new Date('2026-01-05T00:00:00.000Z'),
      },
    });
  }
}

async function counts() {
  const p = testPrisma();
  return {
    listings: await p.serviceListing.count({ where: { ownerId, state: 'active' } }),
    titles: await p.title.count({ where: { ownerId, state: 'active' } }),
    intents: await p.watchIntent.count({ where: { ownerId } }),
    suppressions: await p.suppression.count({ where: { ownerId } }),
  };
}

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  providerCalls.length = 0;
  offers = { flatrate: [], rentOrBuy: ['Apple TV'] };
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

describe('T-MOVE-014 — the Library refresh is lazy, on access and metadata-only (US-063 AC-1)', () => {
  it('T-MOVE-014a: opening the Library writes availability and changes no list state', async () => {
    await seedLibraryTitle('t-1', ['starz']);
    const before = await counts();

    const { status, body } = await call('GET', '/titles');
    expect(status).toBe(200);
    expect(providerCalls).toEqual([1100]);
    const item = (body['items'] as Record<string, unknown>[])[0];
    expect(item?.['availability']).toMatchObject({
      left: ['starz'],
      accessState: 'rent-only',
      signature: 'left=starz;joined=',
      canMoveToWaiting: true,
    });

    const stored = await testPrisma().title.findUniqueOrThrow({ where: { id: 't-1' } });
    expect(stored.rentOn).toBe('["Apple TV"]');
    expect(stored.availabilityCheckedAt).not.toBeNull();
    expect(stored.state).toBe('active');
    expect(await counts()).toEqual(before);

    // Fresh now: a second render asks nothing.
    await call('GET', '/titles');
    expect(providerCalls).toHaveLength(1);
  });

  it('T-MOVE-014b: the details view runs the same pass, and Keep hides exactly that change', async () => {
    await seedLibraryTitle('t-1', ['starz']);
    const first = await call('GET', '/titles/t-1');
    expect(first.body['availability']).toMatchObject({ kept: false });

    const kept = await call('POST', '/titles/t-1/availability/keep', {
      signature: 'left=starz;joined=',
    });
    expect(kept.status).toBe(200);
    const after = await call('GET', '/titles/t-1');
    expect(after.body['availability']).toMatchObject({ kept: true });
    expect(await counts()).toMatchObject({ listings: 1, titles: 1 });
  });
});

describe('T-MOVE-015 — the owner moves against the store (US-063 AC-3..AC-7)', () => {
  it('T-MOVE-015a: remove one badge keeps the title, and the existing restore puts it back', async () => {
    await seedLibraryTitle('t-1', ['starz', 'netflix']);
    const removed = await call('DELETE', '/listings/l-t-1-starz');
    expect(removed.status).toBe(200);
    expect(removed.body['titleState']).toBe('active');
    const row = await testPrisma().serviceListing.findUniqueOrThrow({
      where: { listingId: 'l-t-1-starz' },
    });
    expect(row.state).toBe('removed');
    expect(row.removedByBatchId).toBeNull();

    const restored = await call('POST', '/listings/l-t-1-starz/restore', {});
    expect(restored.status).toBe(200);
    expect(await counts()).toMatchObject({ listings: 2, titles: 1 });
  });

  it('T-MOVE-015b: move to Waiting soft-removes every badge and opens ONE waiting intent', async () => {
    await seedLibraryTitle('t-1', ['starz']);
    const moved = await call('POST', '/titles/t-1/move-to-waiting');
    expect(moved.status).toBe(200);
    expect(moved.body['removedListingIds']).toEqual(['l-t-1-starz']);

    const title = await testPrisma().title.findUniqueOrThrow({ where: { id: 't-1' } });
    expect(title.state).toBe('removed');
    const intents = await testPrisma().watchIntent.findMany({ where: { ownerId } });
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({ state: 'waiting', discoverySource: 'search' });
    expect(intents[0]?.movedFromLibraryAt).not.toBeNull();

    const waiting = await call('GET', '/waiting');
    const items = waiting.body['items'] as Record<string, unknown>[];
    expect(items[0]?.['movedFromLibraryAt']).toEqual(expect.any(String));

    // The removed log shows it, and nothing was suppressed.
    expect((await counts()).suppressions).toBe(0);
    expect((await call('POST', '/titles/t-1/move-to-waiting')).status).toBe(409);
  });

  it('T-MOVE-015c: Add to Library creates a new row dated today and satisfies the intent in one request', async () => {
    await seedLibraryTitle('t-1', ['starz']);
    const moved = await call('POST', '/titles/t-1/move-to-waiting');
    const intentId = moved.body['intentId'] as string;

    const promoted = await call('POST', `/waiting/${intentId}/promote`, { service: 'netflix' });
    expect(promoted.status).toBe(201);
    expect(promoted.body['titleWasCreated']).toBe(true);
    const newTitleId = promoted.body['titleId'] as string;
    expect(newTitleId).not.toBe('t-1');

    const today = new Date().toISOString().slice(0, 10);
    expect(promoted.body['dateAdded']).toBe(today);
    const intent = await testPrisma().watchIntent.findUniqueOrThrow({ where: { id: intentId } });
    expect(intent.state).toBe('satisfied');
    expect(await findWaitingIntent(ownerId as OwnerId, intentId)).toBeNull();
    expect(await counts()).toMatchObject({ listings: 1, titles: 1 });

    // A second promote of the now-satisfied intent is a 404, not a second row.
    expect(
      (await call('POST', `/waiting/${intentId}/promote`, { service: 'netflix' })).status,
    ).toBe(404);
  });

  it('T-MOVE-015d: Add badge dates the listing today but keeps the earliest sort date', async () => {
    await seedLibraryTitle('t-1', ['starz']);
    const added = await call('POST', '/titles/t-1/badges', { service: 'netflix' });
    expect(added.status).toBe(201);
    const title = await testPrisma().title.findUniqueOrThrow({ where: { id: 't-1' } });
    expect(title.sortDateAdded?.toISOString().slice(0, 10)).toBe('2026-01-05');

    const dup = await call('POST', '/titles/t-1/badges', { service: 'netflix' });
    expect(dup.status).toBe(409);
    expect((dup.body['error'] as Record<string, unknown>)['code']).toBe('DUPLICATE_WORK_IDENTITY');
  });
});
