/**
 * US-068 (PRD `A59`, `specs/api.md` §6.47, §6.52, §6.53) — "Check now" and
 * "Re-check everything" against a REAL SQL Server.
 *
 * ⚠ `T-RECHECK-005a` IS THE INVARIANT-5 ASSERTION for the owner's forced
 * check: it ignores the answer's age, writes the availability columns and
 * NOTHING else — listings, title states, the kept signature and intents are
 * compared before and after. The moves it reveals stay the owner's to make.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const providerCalls: number[] = [];
let offers: { flatrate: string[]; rentOrBuy: string[] } | null = null;

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
const SUBJECT = 'oid-owner-availability-recheck';
const OTHER_SUBJECT = 'oid-other-availability-recheck';
const header = (subject: string): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: 'https://sts.windows.net/tenant/' },
        { typ: OID, val: subject },
        { typ: 'preferred_username', val: 'owner@example.com' },
      ],
    }),
    'utf8',
  ).toString('base64');

let server: Server;
let origin: string;
let ownerId: string;

type Json = Record<string, unknown>;

const call = async (
  method: string,
  path: string,
  body?: unknown,
  subject = SUBJECT,
): Promise<{ status: number; body: Json }> => {
  const res = await fetch(`${origin}/api${path}`, {
    method,
    headers: { [CLIENT_PRINCIPAL_HEADER]: header(subject), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as Json };
};

const minutesAgo = (minutes: number): Date => new Date(Date.now() - minutes * 60_000);

/** A Library title on Starz, answered `checkedAt` with `availableOn`. */
async function seedTitle(
  id: string,
  tmdbId: number | null,
  checkedAt: Date | null,
  availableOn: string | null = '["Starz"]',
): Promise<void> {
  await testPrisma().title.create({
    data: {
      id,
      ownerId,
      workIdentity: tmdbId === null ? `raw:${id}` : `tmdb:movie:${String(tmdbId)}`,
      state: 'active',
      matchState: tmdbId === null ? 'unmatched' : 'matched',
      tmdbId,
      tmdbMediaType: tmdbId === null ? null : 'movie',
      tmdbName: tmdbId === null ? null : `Title ${id}`,
      rawExtractedText: tmdbId === null ? `Raw ${id}` : null,
      tmdbReleaseYear: tmdbId === null ? null : 2025,
      tmdbGenres: '[]',
      sortDateAdded: new Date('2026-01-05T00:00:00.000Z'),
      availableOn,
      rentOn: availableOn === null ? null : '[]',
      availabilityCheckedAt: checkedAt,
    },
  });
  await testPrisma().serviceListing.create({
    data: {
      listingId: `l-${id}`,
      ownerId,
      titleId: id,
      service: 'starz',
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
  offers = { flatrate: ['Starz', 'HBO Max'], rentOrBuy: [] };
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = `${SUBJECT},${OTHER_SUBJECT}`;
  process.env['TMDB_API_KEY'] = 'test-key';
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: header(SUBJECT) },
  });
  ownerId = ((await res.json()) as { ownerId: string }).ownerId;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-RECHECK-005 — "Check now" writes metadata only (US-068 AC-1/AC-2, invariant 5)', () => {
  it('T-RECHECK-005a: a title checked a minute ago is re-asked; only the availability columns change', async () => {
    // Stored: only Starz, a minute old. TMDB now says Starz and HBO Max.
    await seedTitle('t-hm', 5001, minutesAgo(1));
    // The owner also uses Max (a Max badge elsewhere), so joining it is a change.
    await seedTitle('t-max', 5009, minutesAgo(1), '["Max"]');
    await testPrisma().serviceListing.updateMany({
      where: { titleId: 't-max' },
      data: { service: 'max' },
    });
    const before = await counts();
    const row = await testPrisma().title.findUniqueOrThrow({ where: { id: 't-hm' } });

    const { status, body } = await call('POST', '/titles/t-hm/availability/check');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: 't-hm',
      availableOn: ['Starz', 'HBO Max'],
      accessState: 'streaming',
    });
    expect(providerCalls).toEqual([5001]);
    expect(await counts()).toEqual(before);

    const after = await testPrisma().title.findUniqueOrThrow({ where: { id: 't-hm' } });
    expect(after.availableOn).toBe('["Starz","HBO Max"]');
    expect(after.availabilityCheckedAt?.getTime()).toBeGreaterThan(
      row.availabilityCheckedAt?.getTime() ?? 0,
    );
    // Everything that is not an availability column is untouched.
    const nonAvailability = (title: Record<string, unknown>): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(title).filter(
          ([key]) =>
            !['availableOn', 'rentOn', 'availabilityCheckedAt', 'availabilityRegion'].includes(key),
        ),
      );
    expect(nonAvailability(after)).toEqual(nonAvailability(row));

    // The revealed move is the owner's to make: the Add badge is now on offer.
    const review = await call('GET', '/availability/review');
    expect(review.body['library']).toEqual([
      expect.objectContaining({
        titleId: 't-hm',
        availability: expect.objectContaining({ joined: ['max'] }) as unknown,
      }),
    ]);
  });

  it('T-RECHECK-005b: a waiting title is re-asked too, and satisfied by nothing', async () => {
    await seedTitle('t-w', 5002, minutesAgo(1));
    await testPrisma().serviceListing.updateMany({
      where: { titleId: 't-w' },
      data: { state: 'removed', removedAt: new Date() },
    });
    await testPrisma().watchIntent.create({
      data: {
        id: 'i-w',
        ownerId,
        titleId: 't-w',
        workIdentity: 'tmdb:movie:5002',
        discoverySource: 'search',
        state: 'waiting',
        availabilityCheckedAt: minutesAgo(1),
        availableOn: '[]',
        rentOn: '[]',
      },
    });
    offers = { flatrate: ['Max'], rentOrBuy: [] };
    const { status, body } = await call('POST', '/waiting/i-w/availability/check');
    expect(status).toBe(200);
    expect(body).toMatchObject({ id: 'i-w', availableOn: ['Max'], accessState: 'streaming' });
    const intent = await testPrisma().watchIntent.findUniqueOrThrow({ where: { id: 'i-w' } });
    expect(intent.state).toBe('waiting');
    expect(intent.availableOn).toBe('["Max"]');
    expect(intent.streamingSince).not.toBeNull();
  });

  it("T-RECHECK-005c: another owner's title and intent ids are 404, and TMDB is never asked", async () => {
    await seedTitle('t-mine', 5003, minutesAgo(1));
    const foreign = await call(
      'POST',
      '/titles/t-mine/availability/check',
      undefined,
      OTHER_SUBJECT,
    );
    expect(foreign.status).toBe(404);
    expect(foreign.body).toMatchObject({ error: { code: 'NOT_FOUND' } });
    const foreignIntent = await call(
      'POST',
      '/waiting/i-none/availability/check',
      undefined,
      OTHER_SUBJECT,
    );
    expect(foreignIntent.status).toBe(404);
    expect(providerCalls).toEqual([]);
    const stored = await testPrisma().title.findUniqueOrThrow({ where: { id: 't-mine' } });
    expect(stored.availableOn).toBe('["Starz"]');
  });

  it('T-RECHECK-005d: a title with no TMDB id is refused and left as it was', async () => {
    await seedTitle('t-raw', null, null, null);
    const { status, body } = await call('POST', '/titles/t-raw/availability/check');
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: { code: 'TMDB_WORK_NOT_FOUND' } });
    expect(providerCalls).toEqual([]);
  });
});

describe('T-RECHECK-006 — "Re-check everything" walks the whole list (US-068 AC-3)', () => {
  it('T-RECHECK-006a: taps progress through every title, once each, changing no list state', async () => {
    for (let i = 0; i < 25; i += 1) {
      await seedTitle(`t-${String(i).padStart(2, '0')}`, 6000 + i, minutesAgo(100 - i));
    }
    const before = await counts();

    const first = await call('POST', '/availability/check', { scope: 'all' });
    expect(first.status).toBe(200);
    const one = first.body['recheck'] as Record<string, unknown>;
    expect(one).toMatchObject({ total: 25, processed: 20, remaining: 5, done: false });
    expect(providerCalls).toHaveLength(20);
    // Least recently checked first: the title stamped 100 minutes ago.
    expect(providerCalls[0]).toBe(6000);

    providerCalls.length = 0;
    const second = await call('POST', '/availability/check', {
      scope: 'all',
      since: one['since'],
      cursor: one['cursor'],
    });
    expect(second.body['recheck']).toMatchObject({ processed: 25, remaining: 0, done: true });
    expect(providerCalls).toEqual([6020, 6021, 6022, 6023, 6024]);
    expect(await counts()).toEqual(before);

    // A third tap with the same cursor finds nothing left, and asks nothing.
    providerCalls.length = 0;
    const third = await call('POST', '/availability/check', {
      scope: 'all',
      since: one['since'],
      cursor: one['cursor'],
    });
    expect(third.body['recheck']).toMatchObject({ remaining: 0, done: true });
    expect(providerCalls).toEqual([]);
  });
});
