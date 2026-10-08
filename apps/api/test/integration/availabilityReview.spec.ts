/**
 * US-064 (PRD `A55`, `specs/api.md` §6.45–§6.48) — the "Availability changes"
 * review against a REAL SQL Server.
 *
 * ⚠ `T-AVREV-007a` IS THE PER-ITEM ISOLATION ASSERTION: a bulk answer with a
 * refused item in the middle leaves every other item applied, and the refused
 * one untouched — each item is its own transaction, never one for the batch.
 *
 * ⚠ `T-AVREV-008a` IS THE INVARIANT-5 ASSERTION for "Check more titles": the
 * owner's tap writes the availability columns and NOTHING else — listings,
 * title states and intents are counted before and after.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { listLibraryAvailability } from '../../src/repository/availabilityReview.js';
import type { OwnerId } from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const providerCalls: number[] = [];
let offers: { flatrate: string[]; rentOrBuy: string[] } | null = {
  flatrate: [],
  rentOrBuy: [],
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
const SUBJECT = 'oid-owner-availability-review';
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

const LEFT_NETFLIX = 'left=netflix;joined=';

let server: Server;
let app: Express;
let origin: string;
let ownerId: string;

type Json = Record<string, unknown>;

const call = async (
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Json }> => {
  const res = await fetch(`${origin}/api${path}`, {
    method,
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Json };
};

/**
 * A Library title on Netflix. `availableOn` is the stored answer: `[]` with a
 * recent check is "left Netflix"; `null` with no check is never checked.
 */
async function seedTitle(
  id: string,
  tmdbId: number,
  availability: { availableOn: string | null; checkedAt: Date | null },
) {
  await testPrisma().title.create({
    data: {
      id,
      ownerId,
      workIdentity: `tmdb:movie:${String(tmdbId)}`,
      state: 'active',
      matchState: 'matched',
      tmdbId,
      tmdbMediaType: 'movie',
      tmdbName: `Title ${id}`,
      tmdbReleaseYear: 2025,
      tmdbGenres: '[]',
      sortDateAdded: new Date('2026-01-05T00:00:00.000Z'),
      availableOn: availability.availableOn,
      rentOn: availability.availableOn === null ? null : '[]',
      availabilityCheckedAt: availability.checkedAt,
    },
  });
  await testPrisma().serviceListing.create({
    data: {
      listingId: `l-${id}`,
      ownerId,
      titleId: id,
      service: 'netflix',
      state: 'active',
      dateAdded: new Date('2026-01-05T00:00:00.000Z'),
    },
  });
}

async function counts() {
  const p = testPrisma();
  return {
    listings: await p.serviceListing.count({ where: { ownerId } }),
    activeListings: await p.serviceListing.count({ where: { ownerId, state: 'active' } }),
    titles: await p.title.count({ where: { ownerId } }),
    activeTitles: await p.title.count({ where: { ownerId, state: 'active' } }),
    intents: await p.watchIntent.count({ where: { ownerId } }),
    suppressions: await p.suppression.count({ where: { ownerId } }),
  };
}

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  providerCalls.length = 0;
  offers = { flatrate: [], rentOrBuy: [] };
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

describe('T-AVREV-007 — a bulk answer applies item by item (US-064 AC-4/AC-5)', () => {
  it('T-AVREV-007a: one refused item neither rolls back nor blocks the others', async () => {
    const recently = new Date();
    await seedTitle('t-a', 3001, { availableOn: '[]', checkedAt: recently });
    await seedTitle('t-b', 3002, { availableOn: '[]', checkedAt: recently });
    await seedTitle('t-c', 3003, { availableOn: '[]', checkedAt: recently });

    const review = await call('GET', '/availability/review');
    expect((review.body['library'] as Json[]).map((row) => row['titleId'])).toEqual([
      't-a',
      't-b',
      't-c',
    ]);

    const { status, body } = await call('POST', '/availability/review/apply', {
      action: 'remove-left-badges',
      items: [
        { id: 't-a', signature: LEFT_NETFLIX },
        // Answered against a change that is no longer the stored one.
        { id: 't-b', signature: 'left=;joined=max' },
        { id: 't-c', signature: LEFT_NETFLIX },
      ],
    });
    expect(status).toBe(200);
    expect(body).toMatchObject({ done: 2, refused: 1 });
    expect((body['results'] as Json[])[1]).toMatchObject({
      id: 't-b',
      outcome: 'refused',
      code: 'AVAILABILITY_CHANGED',
    });

    const listings = await testPrisma().serviceListing.findMany({
      where: { ownerId },
      orderBy: { listingId: 'asc' },
      select: { listingId: true, state: true, removedByBatchId: true, removedByGroupId: true },
    });
    // ⚠ Soft delete: the rows are still there, "Removed by you".
    expect(listings).toEqual([
      { listingId: 'l-t-a', state: 'removed', removedByBatchId: null, removedByGroupId: null },
      { listingId: 'l-t-b', state: 'active', removedByBatchId: null, removedByGroupId: null },
      { listingId: 'l-t-c', state: 'removed', removedByBatchId: null, removedByGroupId: null },
    ]);
    const titles = await testPrisma().title.findMany({
      where: { ownerId },
      orderBy: { id: 'asc' },
      select: { id: true, state: true },
    });
    expect(titles).toEqual([
      { id: 't-a', state: 'removed' },
      { id: 't-b', state: 'active' },
      { id: 't-c', state: 'removed' },
    ]);
    // The refused row is still waiting for an answer.
    const after = await call('GET', '/availability/review');
    expect((after.body['library'] as Json[]).map((row) => row['titleId'])).toEqual(['t-b']);
  });

  it('T-AVREV-007b: Keep records the signature, so the row leaves the review', async () => {
    await seedTitle('t-k', 3010, { availableOn: '[]', checkedAt: new Date() });
    const before = await counts();
    const { body } = await call('POST', '/availability/review/apply', {
      action: 'keep',
      items: [{ id: 't-k', signature: LEFT_NETFLIX }],
    });
    expect(body).toMatchObject({ done: 1, refused: 0 });
    const stored = await testPrisma().title.findUniqueOrThrow({ where: { id: 't-k' } });
    expect(stored.availabilityKeptSignature).toBe(LEFT_NETFLIX);
    expect(await counts()).toEqual(before);
    expect((await call('GET', '/availability/review/summary')).body).toEqual({ count: 0 });
  });

  it('T-AVREV-007c: Move to Waiting then Add to Library round-trips through the waiting view', async () => {
    await seedTitle('t-m', 3020, { availableOn: '[]', checkedAt: new Date() });
    const moved = await call('POST', '/availability/review/apply', {
      action: 'move-to-waiting',
      items: [{ id: 't-m', signature: LEFT_NETFLIX }],
    });
    expect(moved.body).toMatchObject({ done: 1, refused: 0 });
    const intent = await testPrisma().watchIntent.findFirstOrThrow({ where: { ownerId } });
    expect(intent.state).toBe('waiting');

    // Later the work streams on Netflix again: the waiting row is listed.
    await testPrisma().watchIntent.update({
      where: { id: intent.id },
      data: { availableOn: '["Netflix"]', availabilityCheckedAt: new Date() },
    });
    const review = await call('GET', '/availability/review');
    expect(review.body['nowStreaming']).toEqual([
      expect.objectContaining({ intentId: intent.id, flaggedOn: ['netflix'], service: 'netflix' }),
    ]);

    const added = await call('POST', '/availability/review/apply', {
      action: 'add-to-library',
      items: [{ id: intent.id }, { id: 'no-such-intent' }],
    });
    expect(added.body).toMatchObject({ done: 1, refused: 1 });
    // Reappearance is a brand-new row (invariant 7); the old one stays removed.
    const titles = await testPrisma().title.findMany({
      where: { ownerId, workIdentity: 'tmdb:movie:3020' },
      select: { id: true, state: true },
    });
    expect(titles.filter((row) => row.state === 'active')).toHaveLength(1);
    expect(titles.find((row) => row.id === 't-m')?.state).toBe('removed');
    const satisfied = await testPrisma().watchIntent.findUniqueOrThrow({
      where: { id: intent.id },
    });
    expect(satisfied.state).not.toBe('waiting');
  });
});

describe('T-AVREV-008 — "Check more titles" writes metadata only (US-064 AC-3, invariant 5)', () => {
  it('T-AVREV-008a: one tap looks up at most twenty, oldest first, and changes no list state', async () => {
    for (let i = 0; i < 25; i += 1) {
      await seedTitle(`t-${String(i).padStart(2, '0')}`, 4000 + i, {
        availableOn: null,
        checkedAt: null,
      });
    }
    const before = await counts();
    const first = await call('GET', '/availability/review');
    expect(first.body['check']).toEqual({ checked: 0, notCheckedRecently: 25 });
    // ⚠ Opening the screen asks nothing.
    expect(providerCalls).toEqual([]);

    const { status, body } = await call('POST', '/availability/check');
    expect(status).toBe(200);
    expect(body).toEqual({ lookedUp: 20, failed: 0, checked: 20, notCheckedRecently: 5 });
    expect(providerCalls).toHaveLength(20);
    expect(await counts()).toEqual(before);

    const stored = await listLibraryAvailability(ownerId as OwnerId);
    const checked = stored.filter((row) => row.availabilityCheckedAt !== null);
    expect(checked).toHaveLength(20);
    for (const row of checked) {
      expect(row.availableOn).toBe('[]');
      expect(row.availabilityRegion).toBe('US');
      expect(row.listings).toHaveLength(1);
    }

    // The next tap reaches the rest — never the same twenty again.
    providerCalls.length = 0;
    const second = await call('POST', '/availability/check');
    expect(second.body).toEqual({ lookedUp: 5, failed: 0, checked: 25, notCheckedRecently: 0 });
    expect(providerCalls).toEqual([4020, 4021, 4022, 4023, 4024]);
    expect(await counts()).toEqual(before);
  });
});
