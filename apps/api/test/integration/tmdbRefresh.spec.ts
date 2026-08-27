/**
 * TASK-043 / TASK-061 — the lazy TMDB metadata refresh (US-010, REQ-076,
 * NFR-014, `specs/api.md` §6.4).
 *
 * ⚠ **THE POINT OF THIS FILE IS THAT NO SCHEDULER EXISTS.** Product invariant
 * 5 forbids any background process from changing user-visible list state, and
 * §6.4 grants exactly one exemption: metadata-only refresh, driven by a read,
 * scoped to the rows in the page being returned. Every case below is an
 * assertion about that exemption's boundary — what triggers a refresh, what a
 * refresh is allowed to write, and what happens when TMDB does not answer.
 *
 * ⚠ **THE LIST NEVER FAILS BECAUSE OF TMDB, AND NOTHING IS EVER DELETED.**
 * `T-TMDB-015` and `T-TMDB-016` are the two failure cases and both end in a
 * 200 carrying the STORED metadata. A refresh that blanked a name on a 404
 * would look like the owner's title had vanished.
 *
 * Run against a real SQL Server and the real Express app, with TMDB served
 * from the committed recordings through `msw` (`specs/testing.md` §3.2) — so
 * the client's request construction, the 183-day arithmetic and the column
 * writes are all exercised as they ship. Nothing reaches the internet.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { TMDB_METADATA_MAX_AGE_DAYS } from '../../src/config.js';
import { resetTmdbRateLimiterForTests } from '../../src/clients/tmdbClient.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import {
  asOwnerId,
  createServiceListing,
  createTitle,
  createUploadBatch,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { tmdbMswServer, type ReplayOptions } from '../../../../tests/fixtures/msw/tmdb/index.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-tmdb-refresh';
const ISSUER = 'https://sts.windows.net/tenant/';

const principalHeader = (subject: string): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: ISSUER },
        { typ: OID, val: subject },
        { typ: 'preferred_username', val: 'owner@example.com' },
      ],
    }),
    'utf8',
  ).toString('base64');

/** The one work the recordings cover: `movie/438631` — Dune. */
const DUNE_TMDB_ID = 438631;

interface Item {
  titleId: string;
  name: string;
  releaseYear: number | null;
  runtimeMinutes: number | null;
  genres: string[];
  posterPath: string | null;
  metadataStale: boolean;
  sortDateAdded: string | null;
  workIdentity: string;
  badges: { service: string; listingId: string; dateAdded: string }[];
}

let server: Server;
let app: Express;
let origin: string;
let owner: OwnerId;
let msw: ReturnType<typeof tmdbMswServer> | undefined;
let calls: string[];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * MS_PER_DAY);

function startTmdb(options: ReplayOptions = {}): void {
  msw?.close();
  msw = tmdbMswServer({ ...options, calls });
  msw.listen({
    // Loopback has to pass through: this suite drives a REAL listening API on
    // an ephemeral port, so every `fetch` to it is an unhandled msw request.
    // Erroring on those would fail the suite for exercising the thing under
    // test. Anything that is not loopback is a genuine escape and stays loud —
    // and the global egress guard (`T-CI-007`) is the backstop underneath.
    onUnhandledRequest: (request, print) => {
      const { hostname } = new URL(request.url);
      if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') return;
      print.error();
    },
  });
}

/** Requests the client actually made to a TMDB DETAIL path. */
const detailCalls = (): string[] => calls.filter((c) => !c.includes('/search/'));

let seq = 0;
async function seedTitle(options: {
  tmdbId?: number | null;
  matchState?: string;
  fetchedAt?: Date | null;
  name?: string;
  runtime?: number | null;
  genres?: string[];
  imdbId?: string | null;
  dateAdded?: string;
}) {
  seq += 1;
  const id = `tr-${String(seq).padStart(4, '0')}`;
  const dateAdded = new Date(`${options.dateAdded ?? '2026-04-02'}T00:00:00.000Z`);
  const batch = await createUploadBatch(owner, {
    id: `b-${id}`,
    service: 'netflix',
    mode: 'append-only',
    status: 'applied',
  });

  const matched = (options.matchState ?? 'matched') === 'matched';
  const title = await createTitle(owner, {
    id,
    workIdentity: matched
      ? `tmdb:movie:${String(options.tmdbId ?? DUNE_TMDB_ID)}`
      : `unmatched:${String(seq).padStart(16, '0')}`,
    state: 'active',
    matchState: matched ? 'matched' : 'unmatched',
    ...(matched
      ? {
          tmdbId: options.tmdbId ?? DUNE_TMDB_ID,
          tmdbMediaType: 'movie',
          tmdbName: options.name ?? 'Stale Name',
          tmdbReleaseYear: 1999,
          tmdbRuntimeMinutes: options.runtime === undefined ? 1 : options.runtime,
          tmdbGenres: JSON.stringify(options.genres ?? ['Stale Genre']),
          tmdbPosterPath: '/stale.jpg',
          imdbId: options.imdbId ?? null,
          tmdbFetchedAt: options.fetchedAt ?? null,
        }
      : { rawExtractedText: 'Some Unmatched Thing' }),
    sortDateAdded: dateAdded,
    createdByBatchId: batch.id,
  });

  await createServiceListing(owner, {
    listingId: `l-${id}`,
    titleId: title.id,
    service: 'netflix',
    state: 'active',
    dateAdded,
    createdByBatchId: batch.id,
  });
  return title;
}

const list = async (query = ''): Promise<{ items: Item[] }> => {
  const res = await fetch(`${origin}/api/titles${query}`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as { items: Item[] };
};

const detail = async (titleId: string): Promise<Item> => {
  const res = await fetch(`${origin}/api/titles/${titleId}`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Item;
};

const storedTitle = async (id: string) =>
  testPrisma().title.findFirstOrThrow({ where: { ownerId: owner, id } });

beforeEach(async () => {
  resetAllowListWarning();
  resetTmdbRateLimiterForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  // A key must be present or the refresh short-circuits — which is itself a
  // case below (`T-TMDB-016b`), and would silently make every other one vacuous.
  process.env['TMDB_API_KEY'] = 'test-key';
  calls = [];
  testPrisma();
  await resetDatabase();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });

  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  owner = asOwnerId(((await res.json()) as { ownerId: string }).ownerId);
});

afterEach(async () => {
  msw?.close();
  msw = undefined;
  delete process.env['TMDB_API_KEY'];
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-TMDB-004 · metadata older than 183 days refreshes on display', () => {
  it('T-TMDB-004a: a title past the horizon is refreshed, persisted AND served fresh', async () => {
    startTmdb();
    const seeded = await seedTitle({ fetchedAt: daysAgo(TMDB_METADATA_MAX_AGE_DAYS + 1) });

    const { items } = await list();
    const item = items[0];

    // ⚠ Served fresh, not merely written. A refresh that updated the row and
    // returned the pre-refresh values would satisfy "refreshes on display" in
    // the database and fail it on the screen — the owner would see the new
    // name only on the render AFTER the one that fetched it.
    expect(item?.name).toBe('Dune');
    expect(item?.runtimeMinutes).toBe(155);
    expect(item?.releaseYear).toBe(2021);
    expect(item?.genres).toEqual(['Science Fiction', 'Adventure']);
    expect(item?.posterPath).toBe('/d5NXSklXo0qyIYkgV94XAgMIckC.jpg');
    expect(item?.metadataStale).toBe(false);

    const stored = await storedTitle(seeded.id);
    expect(stored.tmdbName).toBe('Dune');
    expect(stored.tmdbRuntimeMinutes).toBe(155);
    expect(stored.tmdbFetchedAt).not.toBeNull();

    expect(detailCalls()).toHaveLength(1);
  });

  it('T-TMDB-004b: a title INSIDE the horizon is not refreshed at all', async () => {
    startTmdb();
    await seedTitle({ fetchedAt: daysAgo(TMDB_METADATA_MAX_AGE_DAYS - 1) });

    const { items } = await list();

    // The negative half, and it is the one that keeps the exemption narrow: a
    // refresh that ran on every read would be a per-request call to a free API
    // and would make the 183-day horizon decorative.
    expect(detailCalls()).toEqual([]);
    expect(items[0]?.name).toBe('Stale Name');
    expect(items[0]?.metadataStale).toBe(false);
  });

  it('T-TMDB-004c: a NEVER-fetched title counts as stale and is repaired', async () => {
    // Load-bearing, not defensive. `closeBatch` writes a matched title from
    // the review's alternatives, which carry name/year/poster but no runtime,
    // no genres and no `fetchedAt`. Reading `null` as "fresh" would leave
    // every closed batch's rows permanently without a runtime or a genre.
    startTmdb();
    const seeded = await seedTitle({ fetchedAt: null, runtime: null, genres: [] });

    const { items } = await list();
    expect(items[0]?.runtimeMinutes).toBe(155);
    expect(items[0]?.genres).toEqual(['Science Fiction', 'Adventure']);
    expect((await storedTitle(seeded.id)).tmdbFetchedAt).not.toBeNull();
  });

  it('T-TMDB-004d: an UNMATCHED title is never refreshed', async () => {
    startTmdb();
    await seedTitle({ matchState: 'unmatched', fetchedAt: null });

    const { items } = await list();
    expect(detailCalls()).toEqual([]);
    expect(items[0]?.name).toBe('Some Unmatched Thing');
    // There is no TMDB entry to be stale ABOUT, so the flag is false rather
    // than a permanently-true nag on every unmatched row.
    expect(items[0]?.metadataStale).toBe(false);
  });

  it('T-TMDB-004e: a title NOT on the page returned is never refreshed (REQ-076)', async () => {
    startTmdb();
    await seedTitle({ fetchedAt: daysAgo(400), dateAdded: '2026-04-02' });
    // A DIFFERENT work — same-work rows collide on `title_one_active_per_work`.
    await seedTitle({ tmdbId: 4242, fetchedAt: daysAgo(400), dateAdded: '2026-01-01' });

    const { items } = await list('?limit=1');
    expect(items).toHaveLength(1);
    // Exactly one detail call, for exactly the row served. This is what makes
    // the refresh lazy rather than a sweep with a read-shaped trigger.
    expect(detailCalls()).toHaveLength(1);
  });

  it('T-TMDB-004f: the DETAIL route refreshes too', async () => {
    startTmdb();
    const seeded = await seedTitle({ fetchedAt: daysAgo(400) });

    const item = await detail(seeded.id);
    expect(item.name).toBe('Dune');
    expect(item.metadataStale).toBe(false);
    expect(detailCalls()).toHaveLength(1);
  });
});

describe('T-TMDB-014 · a refresh writes descriptive fields and nothing else', () => {
  it('T-TMDB-014a: identity, membership, ordering and listings are untouched', async () => {
    startTmdb();
    const seeded = await seedTitle({ fetchedAt: daysAgo(400) });
    const before = await storedTitle(seeded.id);
    const listingsBefore = await testPrisma().serviceListing.findMany({
      where: { ownerId: owner, titleId: seeded.id },
    });

    await list();

    const after = await storedTitle(seeded.id);
    // ⚠ Named ONE BY ONE rather than diffed, so adding a list-bearing column
    // to the writer fails this test instead of quietly widening the exemption.
    expect(after.workIdentity).toBe(before.workIdentity);
    expect(after.tmdbId).toBe(before.tmdbId);
    expect(after.tmdbMediaType).toBe(before.tmdbMediaType);
    expect(after.state).toBe(before.state);
    expect(after.matchState).toBe(before.matchState);
    expect(after.sortDateAdded?.toISOString()).toBe(before.sortDateAdded?.toISOString());
    expect(after.createdByBatchId).toBe(before.createdByBatchId);
    expect(after.createdAt.toISOString()).toBe(before.createdAt.toISOString());

    // And the badges — the other half of what the owner sees.
    const listingsAfter = await testPrisma().serviceListing.findMany({
      where: { ownerId: owner, titleId: seeded.id },
    });
    expect(JSON.stringify(listingsAfter)).toBe(JSON.stringify(listingsBefore));
  });

  it('T-TMDB-014b: a stored IMDb id is NOT cleared when TMDB answers without one', async () => {
    // The recordings for `movie/438631` carry no `imdb_id`. Writing that null
    // through would silently end the work's ratings (REQ-094) and be
    // indistinguishable afterwards from "TMDB never had one". Gaining an id is
    // an ordinary refresh outcome; losing one is not.
    startTmdb();
    const seeded = await seedTitle({ fetchedAt: daysAgo(400), imdbId: 'tt1160419' });

    await list();

    expect((await storedTitle(seeded.id)).imdbId).toBe('tt1160419');
  });
});

describe('T-TMDB-015 · TMDB 404 keeps the stored metadata', () => {
  it('T-TMDB-015a: stored metadata retained, metadataStale true, nothing deleted', async () => {
    startTmdb();
    // 4242 has no recording, so the fixture answers 404 — TMDB withdrawing an
    // entry, which is NOT the owner removing a title.
    const seededAt = daysAgo(400);
    const seeded = await seedTitle({ tmdbId: 4242, fetchedAt: seededAt });

    const { items } = await list();

    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe('Stale Name');
    expect(items[0]?.metadataStale).toBe(true);

    const stored = await storedTitle(seeded.id);
    expect(stored.tmdbName).toBe('Stale Name');
    expect(stored.state).toBe('active');
    // The horizon is NOT advanced by a failure: a row that could not be
    // refreshed must be retried on the next view, not parked for another 183
    // days behind a fetchedAt stamp it never earned.
    expect(stored.tmdbFetchedAt?.getTime()).toBe(seededAt.getTime());
  });
});

describe('T-TMDB-016 · TMDB unreachable still renders the list', () => {
  it('T-TMDB-016a: a transport failure yields 200 with stored data and the flag', async () => {
    // A rejected `fetch` is a different code path from any status code, and
    // the one a client most often gets wrong. Three entries because the client
    // retries twice before giving up.
    startTmdb({ script: ['network-error', 'network-error', 'network-error'] });
    await seedTitle({ fetchedAt: daysAgo(400) });

    const { items } = await list();
    expect(items[0]?.name).toBe('Stale Name');
    expect(items[0]?.metadataStale).toBe(true);
  });

  it('T-TMDB-016b: an UNCONFIGURED key is a supported state, not an error', async () => {
    // No key is the ordinary state of a fresh environment and of the whole
    // test suite. The list must render from stored metadata, flagged stale,
    // with no outbound request attempted at all.
    delete process.env['TMDB_API_KEY'];
    startTmdb();
    await seedTitle({ fetchedAt: daysAgo(400) });

    const { items } = await list();
    expect(items[0]?.name).toBe('Stale Name');
    expect(items[0]?.metadataStale).toBe(true);
    expect(calls).toEqual([]);
  });
});
