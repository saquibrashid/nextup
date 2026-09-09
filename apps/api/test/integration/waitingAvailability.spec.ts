/**
 * TASK-187 — the availability refresh is **lazy, on access, and metadata-only**
 * (US-042 AC-1/AC-2/AC-4, REQ-041, REQ-086, ADR-0010).
 *
 * `T-AVAIL-001` (staleness decides what is refreshed), `T-AVAIL-002` (nothing
 * but opening the waiting view ever triggers it) and `T-AVAIL-004` (it writes
 * `watch_intent` metadata and nothing else).
 *
 * ⚠ **`T-AVAIL-001b` AND `T-AVAIL-002a` ARE THE POINT OF THIS FILE.** Every
 * other assertion here passes just as happily against a build that refreshes
 * every intent on every request — which is not a lazy refresh, it is the sweep
 * REQ-041 forbids wearing a route as a disguise. `001b` proves a
 * recently-checked intent is left alone; `002a` proves an untouched waiting
 * list generates no outbound request at all.
 *
 * ⚠ **`T-AVAIL-004` IS THE INVARIANT-5 ASSERTION.** The whole reason this
 * fourth non-owner process is admissible is that it cannot change
 * user-visible LIST state. That is only true if it creates no `Title`, no
 * `ServiceListing` and no `Suppression`, and satisfies no intent — so the test
 * counts those rows across the refresh rather than trusting the writer's
 * shape.
 *
 * Integration level throughout: the claims are about what the store holds
 * before and after a real request, which is exactly what a mocked store
 * cannot show.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import type { OwnerId } from '../../src/repository/ownerData.js';
import { listWaitingIntents } from '../../src/repository/watchIntents.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

/**
 * Every TMDB provider lookup the process makes, recorded.
 *
 * ⚠ The stub is installed on the CLIENT MODULE, not injected into the route,
 * so it observes the real wiring in `routes/index.ts`. A stub passed into
 * `registerWaitingRoutes` by the test would prove the service works and prove
 * nothing about whether the deployed app reaches it.
 */
const providerCalls: { tmdbId: number; region: string }[] = [];
let providerResult: string[] | null = ['Netflix'];
let providerThrows = false;

vi.mock('../../src/clients/tmdbClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/clients/tmdbClient.js')>();
  class StubTmdbClient extends actual.TmdbClient {
    override getWatchProviders(
      _mediaType: 'movie' | 'tv',
      tmdbId: number,
      region: string,
    ): Promise<string[] | null> {
      providerCalls.push({ tmdbId, region });
      if (providerThrows) return Promise.reject(new Error('injected tmdb failure'));
      return Promise.resolve(providerResult);
    }
  }
  return { ...actual, TmdbClient: StubTmdbClient };
});

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const ISSUER = 'https://sts.windows.net/tenant/';
const SUBJECT = 'oid-owner-avail';

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

const authed = { [CLIENT_PRINCIPAL_HEADER]: principalHeader };

const MS_PER_DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * MS_PER_DAY);

interface WaitingBody {
  count: number;
  items: {
    intentId: string;
    availableOn: string[] | null;
    flaggedOn: string[] | null;
    availabilityCheckedAt: string | null;
    availabilityRegion: string;
  }[];
}

const waitingRequest = async (): Promise<{ status: number; body: WaitingBody }> => {
  const res = await fetch(`${origin}/api/waiting`, { headers: authed });
  return { status: res.status, body: (await res.json()) as WaitingBody };
};

/* ── fixtures ─────────────────────────────────────────────────────────── */

let seq = 0;
let batchMade = false;
const SOURCE_BATCH = 'batch-av-source';

/**
 * ⚠ `discoveredAt` is DISTINCT per intent on purpose. `listWaitingIntents`
 * orders by it, and `T-AVAIL-002b` asserts that the second render picks up the
 * rows the first one left — which is only a meaningful claim if the order is
 * deterministic. Identical timestamps make that test pass or fail on whatever
 * order SQL Server felt like returning.
 */
async function makeWaitingIntent(over: {
  tmdbId: number;
  name: string;
  checkedAt?: Date | null;
  availableOn?: string | null;
  region?: string;
  state?: string;
}): Promise<{ intentId: string; titleId: string }> {
  if (!batchMade) {
    await testPrisma().uploadBatch.create({
      data: {
        id: SOURCE_BATCH,
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
    batchMade = true;
  }

  const n = ++seq;
  const titleId = `title-av-${n}`;
  const intentId = `wi-av-${n}`;
  const workIdentity = `tmdb:movie:${over.tmdbId}`;

  await testPrisma().title.create({
    data: {
      id: titleId,
      ownerId,
      workIdentity,
      state: 'active',
      matchState: 'matched',
      rawExtractedText: over.name,
      tmdbId: over.tmdbId,
      tmdbMediaType: 'movie',
      tmdbName: over.name,
      tmdbReleaseYear: 2021,
      tmdbPosterPath: '/p.jpg',
    },
  });

  await testPrisma().watchIntent.create({
    data: {
      id: intentId,
      ownerId,
      titleId,
      workIdentity,
      state: over.state ?? 'waiting',
      satisfiedAt:
        (over.state ?? 'waiting') === 'satisfied' ? new Date(Date.UTC(2026, 1, 1)) : null,
      sourceBatchId: SOURCE_BATCH,
      discoverySource: 'fandango-at-home',
      discoveredAt: new Date(Date.UTC(2026, 0, n)),
      availabilityRegion: over.region ?? 'US',
      availabilityCheckedAt: over.checkedAt ?? null,
      availableOn: over.availableOn ?? null,
    },
  });

  return { intentId, titleId };
}

/* ── lifecycle ────────────────────────────────────────────────────────── */

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  providerCalls.length = 0;
  providerResult = ['Netflix'];
  providerThrows = false;
  seq = 0;
  batchMade = false;
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

/* ── tests ────────────────────────────────────────────────────────────── */

describe('T-AVAIL-001 · US-042 AC-1 · staleness decides what is re-asked', () => {
  it('T-AVAIL-001a · an intent checked longer ago than the max age is refreshed on access', async () => {
    const { intentId } = await makeWaitingIntent({
      tmdbId: 438_631,
      name: 'Dune',
      checkedAt: daysAgo(90),
      availableOn: JSON.stringify([]),
    });

    const { status, body } = await waitingRequest();
    expect(status).toBe(200);
    expect(providerCalls).toEqual([{ tmdbId: 438_631, region: 'US' }]);

    const item = body.items.find((i) => i.intentId === intentId);
    expect(item?.availableOn).toEqual(['Netflix']);
    expect(item?.flaggedOn).toEqual(['netflix']);

    // The answer was PERSISTED, not merely rendered — otherwise every render
    // re-asks and the "lazy" refresh is a per-request fetch.
    const stored = await testPrisma().watchIntent.findUniqueOrThrow({ where: { id: intentId } });
    expect(stored.availableOn).toBe(JSON.stringify(['Netflix']));
    expect(stored.availabilityCheckedAt).not.toBeNull();
  });

  it('T-AVAIL-001b · a recently-checked intent is NOT refreshed', async () => {
    // ⚠ THE DISCRIMINATING CASE. Without it `001a` passes against a build that
    // refreshes unconditionally, which is a per-render TMDB call for every
    // waiting row for ever.
    const { intentId } = await makeWaitingIntent({
      tmdbId: 949,
      name: 'Heat',
      checkedAt: daysAgo(1),
      availableOn: JSON.stringify(['Max']),
    });

    const { status, body } = await waitingRequest();
    expect(status).toBe(200);
    expect(providerCalls).toEqual([]);

    // And the stored answer is rendered untouched.
    const item = body.items.find((i) => i.intentId === intentId);
    expect(item?.availableOn).toEqual(['Max']);
    expect(item?.flaggedOn).toEqual(['max']);
  });

  it('T-AVAIL-001c · a never-checked intent is refreshed, and NOT KNOWN survives a failure', async () => {
    providerThrows = true;
    const { intentId } = await makeWaitingIntent({ tmdbId: 27_205, name: 'Inception' });

    const { status, body } = await waitingRequest();
    expect(status).toBe(200);
    expect(providerCalls).toHaveLength(1);

    // ⚠ A failed lookup writes NOTHING. `availableOn` stays `null` — NOT KNOWN
    // — and `checkedAt` stays null so the row is retried next render. Writing
    // a null answer here would look identical on this row and would ERASE a
    // known-good answer on any other.
    const item = body.items.find((i) => i.intentId === intentId);
    expect(item?.availableOn).toBeNull();
    expect(item?.flaggedOn).toBeNull();
    expect(item?.availabilityCheckedAt).toBeNull();

    const stored = await testPrisma().watchIntent.findUniqueOrThrow({ where: { id: intentId } });
    expect(stored.availabilityCheckedAt).toBeNull();
    expect(stored.availableOn).toBeNull();
  });

  it('T-AVAIL-001d · a satisfied intent is neither listed nor re-asked', async () => {
    // Retained for ever (REQ-028) but not waiting: re-checking it would spend
    // the request budget on a work that already graduated, and listing it
    // would put a resolved item back in front of the owner.
    await makeWaitingIntent({ tmdbId: 603, name: 'The Matrix', state: 'satisfied' });

    const { body } = await waitingRequest();
    expect(body.count).toBe(0);
    expect(providerCalls).toEqual([]);
  });
});

describe('T-AVAIL-002 · US-042 AC-2 · on access only', () => {
  it('T-AVAIL-002a · if the waiting view is never opened, no TMDB request is ever made', async () => {
    // ⚠ THE WHOLE ADMISSIBILITY ARGUMENT. A waiting intent that is due a
    // refresh sits in the store while the owner exercises the rest of the
    // product; not one outbound provider lookup may happen.
    await makeWaitingIntent({ tmdbId: 438_631, name: 'Dune', checkedAt: daysAgo(90) });

    for (const path of ['/api/me', '/api/titles', '/api/removed', '/api/suppressions']) {
      const res = await fetch(`${origin}${path}`, { headers: authed });
      expect(res.status).toBe(200);
    }

    expect(providerCalls).toEqual([]);

    // …and the moment the waiting view IS opened, exactly one happens. Without
    // this half the assertion above would pass against a build with no refresh
    // at all.
    await waitingRequest();
    expect(providerCalls).toHaveLength(1);
  });

  it('T-AVAIL-002b · the refresh has exactly one caller, and it is the waiting route', async () => {
    // The structural half of AC-2 lives in `T-CI-005`, which enumerates the
    // permitted non-owner processes and proves no timer reaches this one. Here
    // we assert the behavioural consequence: the per-request ceiling bounds a
    // single render, so a long waiting list cannot become a sweep.
    for (let i = 0; i < 12; i += 1) {
      await makeWaitingIntent({ tmdbId: 1000 + i, name: `Work ${i}` });
    }

    await waitingRequest();
    expect(providerCalls).toHaveLength(8);

    // The remainder catch up on the NEXT render, which is what lazy means.
    const asked = new Set(providerCalls.map((c) => c.tmdbId));
    providerCalls.length = 0;
    await waitingRequest();
    expect(providerCalls).toHaveLength(4);
    for (const call of providerCalls) expect(asked.has(call.tmdbId)).toBe(false);
  });
});

describe('T-AVAIL-004 · US-042 AC-4 · metadata-only: the refresh changes no list state', () => {
  it('T-AVAIL-004a · no Title, ServiceListing or Suppression is created, and no intent is satisfied', async () => {
    const { intentId, titleId } = await makeWaitingIntent({
      tmdbId: 438_631,
      name: 'Dune',
      checkedAt: daysAgo(90),
    });
    // Reported available on a service the owner HAS — the strongest possible
    // temptation for a build to "helpfully" add it to the list.
    providerResult = ['Netflix'];

    const before = {
      titles: await testPrisma().title.count({ where: { ownerId } }),
      listings: await testPrisma().serviceListing.count({ where: { ownerId } }),
      suppressions: await testPrisma().suppression.count({ where: { ownerId } }),
      intents: await testPrisma().watchIntent.count({ where: { ownerId } }),
    };

    const { body } = await waitingRequest();
    expect(body.items[0]?.flaggedOn).toEqual(['netflix']);

    const after = {
      titles: await testPrisma().title.count({ where: { ownerId } }),
      listings: await testPrisma().serviceListing.count({ where: { ownerId } }),
      suppressions: await testPrisma().suppression.count({ where: { ownerId } }),
      intents: await testPrisma().watchIntent.count({ where: { ownerId } }),
    };
    expect(after).toEqual(before);

    // ⚠ AC-4 in one line: being available is an INVITATION, not a graduation.
    // The intent stays waiting; only the ordinary capture path (TASK-189) may
    // satisfy it.
    const stored = await testPrisma().watchIntent.findUniqueOrThrow({ where: { id: intentId } });
    expect(stored.state).toBe('waiting');
    expect(stored.titleId).toBe(titleId);
    expect(stored.workIdentity).toBe('tmdb:movie:438631');
    expect(stored.discoveredAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('T-AVAIL-004b · the combined list is byte-identical before and after a refresh', async () => {
    // The load-bearing negative. Membership, ordering and badges are what
    // invariant 5 protects, so compare the rendered list itself rather than
    // trusting a row count.
    await makeWaitingIntent({ tmdbId: 438_631, name: 'Dune', checkedAt: daysAgo(90) });

    const before = await (await fetch(`${origin}/api/titles`, { headers: authed })).text();
    await waitingRequest();
    expect(providerCalls).toHaveLength(1);
    const after = await (await fetch(`${origin}/api/titles`, { headers: authed })).text();

    expect(after).toBe(before);
  });

  it('T-AVAIL-004c · the refresh persists through the repository layer', async () => {
    // `apps/api/src/repository/watchIntents.ts` is excluded from the unit
    // coverage thresholds (T-INV-023a), so the integration project is the only
    // place its two functions are exercised against a real engine. Read the row
    // back through `listWaitingIntents` rather than through Prisma directly:
    // that is the reader the route uses, and it is what must observe the write.
    await makeWaitingIntent({ tmdbId: 438_631, name: 'Dune', checkedAt: daysAgo(90) });

    const stale = await listWaitingIntents(ownerId as OwnerId);
    expect(stale[0]?.availabilityCheckedAt?.getTime()).toBeLessThan(daysAgo(80).getTime());

    await waitingRequest();

    const refreshed = await listWaitingIntents(ownerId as OwnerId);
    expect(refreshed).toHaveLength(1);
    expect(refreshed[0]?.availabilityCheckedAt?.getTime()).toBeGreaterThan(daysAgo(1).getTime());
    expect(refreshed[0]?.availabilityRegion).toBe('US');
    expect(refreshed[0]?.availableOn).not.toBeNull();
  });
});
