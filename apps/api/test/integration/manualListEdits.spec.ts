/**
 * TASK-207 — `POST /api/titles` and `DELETE /api/titles/:titleId`
 * (`specs/api.md` §6.30/§6.32, US-047, US-048).
 *
 * ⚠ **WHAT THIS FILE IS REALLY GUARDING IS THE DISTINCTION BETWEEN "TAKE THIS
 * OFF MY LIST" AND "NEVER SHOW ME THIS AGAIN".** Those two sentences look
 * interchangeable in a UI and are not remotely interchangeable in the store.
 * Suppression is keyed on the canonical WORK IDENTITY and survives
 * reappearance for ever (REQ-071, product invariant 1); a removal asserts
 * nothing at all about the work, so the same film may legitimately come back
 * in a later capture as a brand-new row dated today (product invariant 7).
 *
 * The reason both routes exist is a FALSE EXTRACTION — a row for a work the
 * services never listed, invented when a wrapped caption split "SOL LEVANTE"
 * across two lines. Suppressing it would write a permanent suppression against
 * a real film the owner never rejected. `T-MANUAL-009` is the case that keeps
 * the two apart, and it asserts the suppression TABLE, not the response.
 *
 * ⚠ **AND THAT NOTHING IS EVER HARD-DELETED.** "Delete" is user-facing wording
 * only: REQ-028 is soft delete for ever, so `T-MANUAL-010` proves the rows are
 * still there and reachable through the removed view after the owner has been
 * told the title is gone. `T-INV-012` guards the source half — no
 * `prisma.*.delete()` in `manualListEdits.ts`.
 *
 * Run against a real SQL Server and the real Express app, with TMDB served
 * from the committed recordings through `msw` (`specs/testing.md` §3.2).
 * Nothing reaches the internet.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetTmdbRateLimiterForTests } from '../../src/clients/tmdbClient.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import {
  asOwnerId,
  createServiceListing,
  createSuppression,
  createTitle,
  createUploadBatch,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { tmdbMswServer, type ReplayOptions } from '../../../../tests/fixtures/msw/tmdb/index.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-manual-edits';
const ISSUER = 'https://sts.windows.net/tenant/';

/** The one work the recordings cover: `movie/438631` — Dune. */
const DUNE_TMDB_ID = 438631;
const DUNE_IDENTITY = `tmdb:movie:${String(DUNE_TMDB_ID)}`;
/** Any other id 404s from the fixture server, which is the TMDB-miss path. */
const UNRECORDED_TMDB_ID = 999_111;

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

interface AddBody {
  titleId: string;
  listingId: string;
  workIdentity: string;
  service: string;
  name: string;
  dateAdded: string;
  titleWasCreated: boolean;
}

interface RemoveBody {
  titleId: string;
  state: string;
  removedListingIds: string[];
  removedAt: string;
  suppressed: boolean;
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

interface Item {
  titleId: string;
  workIdentity: string;
  badges: { service: string; listingId: string; dateAdded: string }[];
  sortDateAdded: string | null;
}

interface RemovedItem {
  listingId: string;
  titleId: string;
  service: string;
  removedBy: string;
  restorable: boolean;
}

let server: Server;
let app: Express;
let origin: string;
let owner: OwnerId;
let msw: ReturnType<typeof tmdbMswServer> | undefined;
let calls: string[];

function startTmdb(options: ReplayOptions = {}): void {
  msw?.close();
  msw = tmdbMswServer({ ...options, calls });
  msw.listen({
    onUnhandledRequest: (request, print) => {
      const { hostname } = new URL(request.url);
      if (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1') return;
      print.error();
    },
  });
}

const ownerIdFor = async (subject: string): Promise<OwnerId> => {
  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject) },
  });
  expect(res.status).toBe(200);
  return asOwnerId(((await res.json()) as { ownerId: string }).ownerId);
};

const addTitle = (body: unknown): Promise<Response> =>
  fetch(`${origin}/api/titles`, {
    method: 'POST',
    headers: {
      [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

const removeTitle = (titleId: string): Promise<Response> =>
  fetch(`${origin}/api/titles/${titleId}`, {
    method: 'DELETE',
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });

const restoreListing = (listingId: string): Promise<Response> =>
  fetch(`${origin}/api/listings/${listingId}/restore`, {
    method: 'POST',
    headers: {
      [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT),
      'content-type': 'application/json',
    },
    body: JSON.stringify({}),
  });

const listTitles = async (): Promise<Item[]> => {
  const res = await fetch(`${origin}/api/titles`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: Item[] }).items;
};

/** The service badges on a row, sorted — REQ-005's "one row, a badge per service". */
const badgeServices = (item: Item | undefined): string[] =>
  [...(item?.badges ?? [])].map((badge) => badge.service).sort();

const listRemoved = async (): Promise<RemovedItem[]> => {
  const res = await fetch(`${origin}/api/removed`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: RemovedItem[] }).items;
};

/** Today as the store holds a `@db.Date` — the value §6.30 must write. */
const todayIso = (): string => new Date().toISOString().slice(0, 10);

let seq = 0;
/** A pre-existing, batch-created title — the shape everything else arrives as. */
async function seedTitle(options: {
  workIdentity?: string;
  services?: string[];
  dateAdded?: string;
  state?: string;
  listingState?: string;
  tmdbId?: number;
}) {
  seq += 1;
  const id = `mn-${String(seq).padStart(4, '0')}`;
  const services = options.services ?? ['netflix'];
  const primary = services[0] ?? 'netflix';
  const dateAdded = new Date(`${options.dateAdded ?? '2026-04-02'}T00:00:00.000Z`);

  const batch = await createUploadBatch(owner, {
    id: `b-${id}`,
    service: primary,
    mode: 'append-only',
    status: 'applied',
  });
  const title = await createTitle(owner, {
    id,
    workIdentity: options.workIdentity ?? DUNE_IDENTITY,
    state: options.state ?? 'active',
    matchState: 'matched',
    tmdbId: options.tmdbId ?? DUNE_TMDB_ID,
    tmdbMediaType: 'movie',
    tmdbName: 'Dune',
    tmdbReleaseYear: 2021,
    tmdbGenres: '[]',
    sortDateAdded: dateAdded,
    createdByBatchId: batch.id,
  });

  const listings = [];
  for (const service of services) {
    listings.push(
      await createServiceListing(owner, {
        listingId: `l-${id}-${service}`,
        titleId: title.id,
        service,
        state: options.listingState ?? 'active',
        dateAdded,
        createdByBatchId: batch.id,
        ...(options.listingState === 'removed'
          ? { removedAt: new Date('2026-05-01T00:00:00.000Z'), removedByBatchId: batch.id }
          : {}),
      }),
    );
  }
  return { title, listings, batch };
}

beforeEach(async () => {
  resetAllowListWarning();
  resetTmdbRateLimiterForTests();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
  process.env['TMDB_API_KEY'] = 'test-key';
  calls = [];
  seq = 0;
  testPrisma();
  await resetDatabase();
  startTmdb();

  await new Promise<void>((resolve) => {
    app = createApp({ webRoot: '/nonexistent-web-root' });
    server = app.listen(0, () => {
      origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
      resolve();
    });
  });
  owner = await ownerIdFor(SUBJECT);
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

describe('§6.30 POST /api/titles — US-047, adding a title by hand', () => {
  it('T-MANUAL-001: US-047 AC-1 · a chosen work and service become a row on the list', async () => {
    const res = await addTitle({ tmdbId: DUNE_TMDB_ID, mediaType: 'movie', service: 'netflix' });
    expect(res.status).toBe(201);

    const body = (await res.json()) as AddBody;
    expect(body.workIdentity).toBe(DUNE_IDENTITY);
    expect(body.titleWasCreated).toBe(true);
    expect(body.name).toBe('Dune');
    expect(body.dateAdded).toBe(todayIso());

    // ⚠ Asserted through the LIST, not the response. A handler that answers
    // 201 and writes nothing passes an assertion on its own return value.
    const items = await listTitles();
    expect(items).toHaveLength(1);
    expect(items[0]?.workIdentity).toBe(DUNE_IDENTITY);
    expect(badgeServices(items[0])).toEqual(['netflix']);
  });

  it('T-MANUAL-002: US-047 AC-2 · the same work on the same service is refused, and nothing changes', async () => {
    await seedTitle({ services: ['netflix'] });
    const before = await listTitles();

    const res = await addTitle({ tmdbId: DUNE_TMDB_ID, mediaType: 'movie', service: 'netflix' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as ErrorBody).error.code).toBe('DUPLICATE_WORK_IDENTITY');

    // The refusal has to be a refusal: no second listing, no orphaned title.
    expect(await listTitles()).toEqual(before);
    expect(await testPrisma().serviceListing.count()).toBe(1);
    expect(await testPrisma().title.count()).toBe(1);
  });

  it('T-MANUAL-003: US-047 AC-3 · the same work on ANOTHER service gains a badge, not a second row', async () => {
    const seeded = await seedTitle({ services: ['netflix'] });

    const res = await addTitle({ tmdbId: DUNE_TMDB_ID, mediaType: 'movie', service: 'max' });
    expect(res.status).toBe(201);
    expect(((await res.json()) as AddBody).titleWasCreated).toBe(false);

    // REQ-005 is one row per WORK with a badge per service. A second row here
    // is the defect the owner cannot repair from the UI — there is no merge.
    const items = await listTitles();
    expect(items).toHaveLength(1);
    expect(items[0]?.titleId).toBe(seeded.title.id);
    expect(badgeServices(items[0])).toEqual(['max', 'netflix']);
  });

  it('T-MANUAL-004: US-047 AC-4 · a suppressed work is refused before TMDB is consulted', async () => {
    await createSuppression(owner, {
      id: 'sup-manual-1',
      workIdentity: DUNE_IDENTITY,
      active: true,
      suppressedAt: new Date('2026-05-01T00:00:00.000Z'),
      // US-029 AC-1 — the suppressed view renders from this snapshot, without
      // a Title row, so the columns are NOT NULL.
      displayName: 'Dune',
      displayReleaseYear: 2021,
    });

    const res = await addTitle({ tmdbId: DUNE_TMDB_ID, mediaType: 'movie', service: 'netflix' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('WORK_SUPPRESSED');
    expect(body.error.details['unsuppressHref']).toBe('/api/suppressions/sup-manual-1/unsuppress');

    // ⚠ Gate ORDER, not just gate presence. Suppression needs no network, so a
    // TMDB outage must not stop it answering — and the owner needs to hear
    // "you dismissed this" rather than a transient failure.
    expect(calls).toEqual([]);
    expect(await testPrisma().title.count()).toBe(0);
  });

  it('T-MANUAL-005: US-047 AC-5 · a TMDB failure writes nothing at all', async () => {
    const missing = await addTitle({
      tmdbId: UNRECORDED_TMDB_ID,
      mediaType: 'movie',
      service: 'netflix',
    });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ErrorBody).error.code).toBe('TMDB_WORK_NOT_FOUND');

    startTmdb({ script: ['network-error', 'network-error', 'network-error', 'network-error'] });
    const down = await addTitle({ tmdbId: DUNE_TMDB_ID, mediaType: 'movie', service: 'netflix' });
    expect(down.status).toBe(502);
    expect(((await down.json()) as ErrorBody).error.code).toBe('TMDB_UNAVAILABLE');

    // A work with no name renders permanently blank, so neither failure may
    // leave a half-built row behind.
    expect(await testPrisma().title.count()).toBe(0);
    expect(await testPrisma().serviceListing.count()).toBe(0);
  });

  it('T-MANUAL-006: US-047 AC-6 · the date is today and a supplied dateAdded cannot override it', async () => {
    // ⚠ The dangerous shape here is ACCEPTING the field and dropping it: the
    // owner would be told a date was honoured that never reached the store.
    // `date_added` is write-once (`T-INV-006`) and editing it is deferred to
    // v1.1 (NG-8), so the only correct behaviour is to not read it at all.
    const res = await addTitle({
      tmdbId: DUNE_TMDB_ID,
      mediaType: 'movie',
      service: 'netflix',
      dateAdded: '2019-01-01',
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as AddBody).dateAdded).toBe(todayIso());

    const stored = await testPrisma().serviceListing.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.dateAdded.toISOString().slice(0, 10)).toBe(todayIso());
  });

  it('T-MANUAL-007: US-047 AC-7 · adding a badge today does not reorder a row held since April', async () => {
    await seedTitle({ services: ['netflix'], dateAdded: '2026-04-02' });

    expect(
      (await addTitle({ tmdbId: DUNE_TMDB_ID, mediaType: 'movie', service: 'max' })).status,
    ).toBe(201);

    // Product invariant 6 — the title-level date is the EARLIEST across its
    // listings. Taking today's would jump a months-old row to the top of the
    // default newest-first sort, which is a silent reordering of the list.
    const items = await listTitles();
    expect(items[0]?.sortDateAdded).toBe('2026-04-02');
  });
});

describe('§6.32 DELETE /api/titles/:titleId — US-048, removing a title by hand', () => {
  it('T-MANUAL-008: US-048 AC-1 · the row leaves the list and its listings are removed', async () => {
    const seeded = await seedTitle({ services: ['netflix'] });

    const res = await removeTitle(seeded.title.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as RemoveBody;
    expect(body.state).toBe('removed');
    expect(body.removedListingIds).toEqual(['l-mn-0001-netflix']);
    expect(body.suppressed).toBe(false);

    expect(await listTitles()).toEqual([]);
    const stored = await testPrisma().serviceListing.findMany();
    expect(stored.map((r) => r.state)).toEqual(['removed']);
  });

  it('T-MANUAL-009: US-048 AC-2 · no suppression is written, so the work may return', async () => {
    const seeded = await seedTitle({ services: ['netflix'] });
    expect((await removeTitle(seeded.title.id)).status).toBe(200);

    // ⚠ THE WHOLE POINT OF THIS ROUTE. Suppression is keyed on work identity
    // and survives reappearance for ever (REQ-071); a removal asserts nothing
    // about the work. Collapsing the two would make "remove this phantom row"
    // silently hide a real film the owner never rejected.
    expect(await testPrisma().suppression.count()).toBe(0);

    // And the identity is genuinely free: adding it back succeeds rather than
    // hitting the suppression gate.
    expect(
      (await addTitle({ tmdbId: DUNE_TMDB_ID, mediaType: 'movie', service: 'netflix' })).status,
    ).toBe(201);
  });

  it('T-MANUAL-010: US-048 AC-3 · nothing is hard-deleted — the listing is in the removed view', async () => {
    const seeded = await seedTitle({ services: ['netflix'] });
    expect((await removeTitle(seeded.title.id)).status).toBe(200);

    // REQ-028 is soft delete FOR EVER. "Delete" is the owner's word for it,
    // not the store's — `T-INV-012` guards the source half.
    expect(await testPrisma().title.count()).toBe(1);
    expect(await testPrisma().serviceListing.count()).toBe(1);

    const removed = await listRemoved();
    expect(removed).toHaveLength(1);
    expect(removed[0]?.listingId).toBe('l-mn-0001-netflix');
    expect(removed[0]?.restorable).toBe(true);
  });

  it('T-MANUAL-011: US-048 AC-5 · undo restores exactly what was removed', async () => {
    const seeded = await seedTitle({ services: ['netflix', 'max'] });
    const res = await removeTitle(seeded.title.id);
    const { removedListingIds } = (await res.json()) as RemoveBody;

    // ⚠ Undo reuses the EXISTING §6.10 restore — no second restore path was
    // built, because `T-REAP-014` asserts `restoreServiceListing` has exactly
    // two call sites and a third would be a second way to bring a row back.
    for (const listingId of removedListingIds) {
      expect((await restoreListing(listingId)).status).toBe(200);
    }

    const items = await listTitles();
    expect(items).toHaveLength(1);
    expect(badgeServices(items[0])).toEqual(['max', 'netflix']);
    expect(await listRemoved()).toEqual([]);
  });

  it('T-MANUAL-012: US-048 AC-6 · an already-removed or suppressed title is refused, not 404', async () => {
    const gone = await seedTitle({
      services: ['netflix'],
      state: 'removed',
      listingState: 'removed',
    });
    const first = await removeTitle(gone.title.id);
    expect(first.status).toBe(409);
    expect(((await first.json()) as ErrorBody).error.code).toBe('TITLE_NOT_ACTIVE');

    // ⚠ A suppressed work is refused even though its listings are ACTIVE, and
    // `title.state` cannot say so — `ck_title_state` allows only `active` and
    // `removed`, so suppression lives in its own table. Removing the listings
    // would be invisible until un-suppression and would then silently redirect
    // the work from the combined list (US-029 AC-3) to the removed view (AC-4).
    const hidden = await seedTitle({
      services: ['max'],
      workIdentity: 'tmdb:movie:11',
      tmdbId: 11,
    });
    await createSuppression(owner, {
      id: 'sup-manual-2',
      workIdentity: 'tmdb:movie:11',
      active: true,
      suppressedAt: new Date('2026-05-01T00:00:00.000Z'),
      displayName: 'Star Wars',
      displayReleaseYear: 1977,
    });
    const second = await removeTitle(hidden.title.id);
    expect(second.status).toBe(409);
    const body = (await second.json()) as ErrorBody;
    expect(body.error.code).toBe('WORK_SUPPRESSED');
    // The escape hatch is named, exactly as §6.10 restore names it.
    expect(body.error.details['unsuppressHref']).toBe('/api/suppressions/sup-manual-2/unsuppress');

    // Nothing moved on either path.
    const states = Object.fromEntries(
      (await testPrisma().serviceListing.findMany()).map((r) => [r.listingId, r.state]),
    );
    expect(states['l-mn-0001-netflix']).toBe('removed');
    expect(states['l-mn-0002-max']).toBe('active');

    // A title that is not the owner's is indistinguishable from one that does
    // not exist — 404, never 403.
    expect((await removeTitle('no-such-title')).status).toBe(404);
  });

  it('T-MANUAL-013: US-048 AC-7 · a two-badge row goes in one action, and logs two entries', async () => {
    const seeded = await seedTitle({ services: ['netflix', 'max'] });

    const res = await removeTitle(seeded.title.id);
    expect(res.status).toBe(200);
    expect([...((await res.json()) as RemoveBody).removedListingIds].sort()).toEqual([
      'l-mn-0001-max',
      'l-mn-0001-netflix',
    ]);

    // The row IS the unit the owner acts on (the US-027 AC-5 analogue), and
    // §6.9 is one item per removed LISTING — so two log entries, each
    // independently restorable, is the correct pair of answers.
    expect(await listTitles()).toEqual([]);
    const removed = await listRemoved();
    expect(removed).toHaveLength(2);
    expect([...removed.map((r) => r.service)].sort()).toEqual(['max', 'netflix']);
  });
});
