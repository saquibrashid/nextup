/**
 * TASK-033 — `GET /api/titles`, the combined list (`specs/api.md` §6.2).
 *
 * US-018 is the product's central read-side promise: **one row per canonical
 * work, one badge per service holding it.** These run against a real SQL
 * Server rather than a stubbed repository because every property here is a
 * property of the QUERY — deduplication, the suppression anti-join, keyset
 * ordering. A mock would agree with whatever the handler did, which is
 * agreement rather than evidence.
 *
 * Requests go through the real app so the auth chain, the error envelope and
 * the JSON shape are exercised as the browser will meet them.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import { encodeCursor } from '../../src/pagination.js';
import {
  asOwnerId,
  createServiceListing,
  createSuppression,
  createTitle,
  createUploadBatch,
  softDeleteServiceListing,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-titles';
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

interface Badge {
  service: string;
  listingId: string;
  dateAdded: string;
}

interface Item {
  titleId: string;
  workIdentity: string;
  name: string;
  genres: string[];
  badges: Badge[];
  sortDateAdded: string | null;
  dateAddedLabel: string | null;
}

interface ListBody {
  items: Item[];
  nextCursor: string | null;
  limit: number;
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

let server: Server;
let app: Express;
let origin: string;
/** The owner id the auth chain derives for `SUBJECT` — never hard-coded. */
let owner: OwnerId;

const get = (query = ''): Promise<Response> =>
  fetch(`${origin}/api/titles${query}`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });

const list = async (query = ''): Promise<ListBody> => {
  const res = await get(query);
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody;
};

let seq = 0;
/** A title with one active listing, i.e. the ordinary case. */
async function seedTitle(options: {
  ownerId?: OwnerId;
  workIdentity?: string;
  name?: string;
  dateAdded?: string;
  service?: string;
  mediaType?: string;
  genres?: string[];
}) {
  seq += 1;
  const id = `t-${String(seq).padStart(4, '0')}`;
  const on = options.ownerId ?? owner;
  const batch = await createUploadBatch(on, {
    id: `b-${id}`,
    service: options.service ?? 'netflix',
    mode: 'append-only',
    status: 'applied',
  });
  const title = await createTitle(on, {
    id,
    workIdentity: options.workIdentity ?? `tmdb:movie:${String(1000 + seq)}`,
    state: 'active',
    matchState: 'matched',
    tmdbId: 1000 + seq,
    tmdbMediaType: options.mediaType ?? 'movie',
    tmdbName: options.name ?? `Title ${String(seq)}`,
    tmdbGenres: JSON.stringify(options.genres ?? ['Drama']),
    sortDateAdded: new Date(`${options.dateAdded ?? '2026-04-02'}T00:00:00.000Z`),
    createdByBatchId: batch.id,
  });
  const listing = await createServiceListing(on, {
    listingId: `l-${id}`,
    titleId: title.id,
    service: options.service ?? 'netflix',
    state: 'active',
    dateAdded: new Date(`${options.dateAdded ?? '2026-04-02'}T00:00:00.000Z`),
    createdByBatchId: batch.id,
  });
  return { title, listing, batch };
}

beforeEach(async () => {
  resetAllowListWarning();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = SUBJECT;
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
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
  delete process.env['NEXTUP_ALLOWED_SUBJECTS'];
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-LIST-010 exactly one row per canonical work', () => {
  it('T-LIST-010a: a work saved on two services is ONE row', async () => {
    // The central promise of US-018. Deduplication is structural — a work IS
    // one `title` row — so this asserts the query never re-splits it.
    const { title, batch } = await seedTitle({ name: 'Dune', service: 'netflix' });
    await createServiceListing(owner, {
      listingId: 'l-dune-max',
      titleId: title.id,
      service: 'max',
      state: 'active',
      dateAdded: new Date('2026-06-11T00:00:00.000Z'),
      createdByBatchId: batch.id,
    });

    const body = await list();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.name).toBe('Dune');
  });

  it('T-LIST-010b: distinct works are distinct rows', async () => {
    await seedTitle({ name: 'Dune' });
    await seedTitle({ name: 'Arrival' });

    const body = await list();
    expect(body.items).toHaveLength(2);
    expect(new Set(body.items.map((i) => i.workIdentity)).size).toBe(2);
  });

  it('T-LIST-010c: a suppressed work is excluded (REQ-024)', async () => {
    const kept = await seedTitle({ name: 'Kept' });
    const hidden = await seedTitle({ name: 'Not Interested' });
    await createSuppression(owner, {
      id: 'supp-1',
      workIdentity: hidden.title.workIdentity,
      displayName: 'Not Interested',
    });

    const body = await list();
    expect(body.items.map((i) => i.titleId)).toEqual([kept.title.id]);
  });

  it('T-LIST-010d: suppression is keyed on work identity, not on a row id', async () => {
    // ⚠ Product invariant 1 / REQ-071. A suppressed title that reappears in a
    // later capture becomes a BRAND-NEW row with a NEW id (product invariant
    // 7), so a row-id-keyed exclusion would appear to work and then quietly
    // stop — silently re-showing something the owner said they were not
    // interested in. That is exactly the bug this asserts against.
    const first = await seedTitle({ name: 'Reappears', workIdentity: 'tmdb:movie:7777' });
    await createSuppression(owner, {
      id: 'supp-2',
      workIdentity: 'tmdb:movie:7777',
      displayName: 'Reappears',
    });

    // The work leaves the service, so the original row is removed. The
    // database forbids two ACTIVE rows for one work (invariant I-1), which is
    // why the reappearance below is only reachable through this state.
    await testPrisma().title.updateMany({
      where: { ownerId: owner, id: first.title.id },
      data: { state: 'removed' },
    });

    // Captured again later: same canonical work, a DIFFERENT title id.
    const again = await seedTitle({
      name: 'Reappears',
      workIdentity: 'tmdb:movie:7777',
      service: 'max',
    });
    expect(again.title.id).not.toBe(first.title.id);

    const body = await list();
    expect(body.items).toHaveLength(0);
    expect(body.items.map((i) => i.titleId)).not.toContain(again.title.id);
  });

  it('T-LIST-010e: an INACTIVE suppression does not hide the work', async () => {
    // "Interested again" must actually bring the row back, or un-suppressing
    // is a button that does nothing.
    const seeded = await seedTitle({ name: 'Back Again' });
    await createSuppression(owner, {
      id: 'supp-3',
      workIdentity: seeded.title.workIdentity,
      displayName: 'Back Again',
      active: false,
    });

    expect((await list()).items).toHaveLength(1);
  });

  it('T-LIST-010f: a removed title has no row (US-018 AC-4)', async () => {
    const seeded = await seedTitle({ name: 'Gone' });
    await testPrisma().title.updateMany({
      where: { ownerId: owner, id: seeded.title.id },
      data: { state: 'removed' },
    });

    expect((await list()).items).toHaveLength(0);
  });

  it("T-LIST-010g: another owner's titles are invisible", async () => {
    await seedTitle({ name: 'Mine' });
    await seedTitle({ name: 'Theirs', ownerId: asOwnerId('someone-else') });

    const body = await list();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.name).toBe('Mine');
  });

  it("T-LIST-010h: another owner's suppression cannot hide this owner's row", async () => {
    // The anti-join must be owner-scoped on BOTH sides. An unscoped one would
    // let a stranger's "not interested" silently delete rows from this list.
    const seeded = await seedTitle({ name: 'Still Mine' });
    await createSuppression(asOwnerId('someone-else'), {
      id: 'supp-other',
      workIdentity: seeded.title.workIdentity,
      displayName: 'Still Mine',
    });

    expect((await list()).items).toHaveLength(1);
  });
});

describe('T-LIST-011 one badge per service holding the work', () => {
  it('T-LIST-011a: two active listings produce two badges on one row', async () => {
    const { title, batch } = await seedTitle({
      name: 'Dune',
      service: 'netflix',
      dateAdded: '2026-04-02',
    });
    await createServiceListing(owner, {
      listingId: 'l-dune-max',
      titleId: title.id,
      service: 'max',
      state: 'active',
      dateAdded: new Date('2026-06-11T00:00:00.000Z'),
      createdByBatchId: batch.id,
    });

    const body = await list();
    expect(body.items).toHaveLength(1);

    const badges = body.items[0]?.badges ?? [];
    expect(badges).toHaveLength(2);
    expect(badges.map((b) => b.service).sort()).toEqual(['max', 'netflix']);
    expect(badges.find((b) => b.service === 'netflix')?.dateAdded).toBe('2026-04-02');
    expect(badges.find((b) => b.service === 'max')?.dateAdded).toBe('2026-06-11');
  });

  it('T-LIST-011b: a REMOVED listing contributes no badge, and the row survives', async () => {
    // REQ-026 / US-018 AC-3. Soft delete forever: the listing row still
    // exists, so this proves the query filters on state rather than on the
    // row's absence.
    const { title, batch, listing } = await seedTitle({ name: 'Dune', service: 'netflix' });
    await createServiceListing(owner, {
      listingId: 'l-dune-max',
      titleId: title.id,
      service: 'max',
      state: 'active',
      dateAdded: new Date('2026-06-11T00:00:00.000Z'),
      createdByBatchId: batch.id,
    });
    await softDeleteServiceListing(owner, listing.listingId, {
      removedByBatchId: batch.id,
      removedAt: new Date('2026-07-01T00:00:00.000Z'),
    });

    const body = await list();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.badges.map((b) => b.service)).toEqual(['max']);

    const stillThere = await testPrisma().serviceListing.findFirst({
      where: { ownerId: owner, listingId: listing.listingId },
    });
    expect(stillThere?.state).toBe('removed');
  });

  it('T-LIST-011c: the date label is server-supplied and says "to nextup"', async () => {
    await seedTitle({ name: 'Dune', dateAdded: '2026-04-02' });

    const body = await list();
    expect(body.items[0]?.dateAddedLabel).toBe('Added to nextup 2 Apr 2026');
    expect(body.items[0]?.dateAddedLabel).toContain('to nextup');
  });

  it('T-LIST-011d: genres round-trip, and an empty list stays empty', async () => {
    // ⚠ `[]` is meaningful: it must never be defaulted into a genre
    // (US-019 AC-6), so it has to survive storage as an empty array.
    await seedTitle({ name: 'With', genres: ['Science Fiction', 'Adventure'] });
    await seedTitle({ name: 'Without', genres: [] });

    const body = await list();
    const byName = new Map(body.items.map((i) => [i.name, i.genres]));
    expect(byName.get('With')).toEqual(['Science Fiction', 'Adventure']);
    expect(byName.get('Without')).toEqual([]);
  });

  it('T-LIST-011e: a service filter does NOT hide the row\u2019s other badges', async () => {
    // REQ-032: filtering by Netflix selects titles held on Netflix; it does
    // not redact the Max badge from those rows.
    const { title, batch } = await seedTitle({ name: 'Dune', service: 'netflix' });
    await createServiceListing(owner, {
      listingId: 'l-dune-max',
      titleId: title.id,
      service: 'max',
      state: 'active',
      dateAdded: new Date('2026-06-11T00:00:00.000Z'),
      createdByBatchId: batch.id,
    });

    const body = await list('?service=netflix');
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.badges.map((b) => b.service).sort()).toEqual(['max', 'netflix']);
  });
});

describe('T-LIST-030 ordering and keyset pagination', () => {
  it('T-LIST-030a: the default order is newest-first', async () => {
    // REQ-038, confirmed by the owner at A44.
    await seedTitle({ name: 'Older', dateAdded: '2026-01-01' });
    await seedTitle({ name: 'Newer', dateAdded: '2026-09-09' });

    expect((await list()).items.map((i) => i.name)).toEqual(['Newer', 'Older']);
  });

  it('T-LIST-030b: dir=asc reverses it', async () => {
    await seedTitle({ name: 'Older', dateAdded: '2026-01-01' });
    await seedTitle({ name: 'Newer', dateAdded: '2026-09-09' });

    expect((await list('?dir=asc')).items.map((i) => i.name)).toEqual(['Older', 'Newer']);
  });

  it('T-LIST-030c: paging visits every row exactly once, with no gaps', async () => {
    // The property that matters. A cursor that skipped a row would look
    // exactly like a title silently disappearing from the owner's list.
    for (let i = 0; i < 7; i += 1) {
      await seedTitle({ name: `T${String(i)}`, dateAdded: `2026-03-0${String(i + 1)}` });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const body: ListBody = await list(
        `?limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...body.items.map((i) => i.name));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toEqual(['T6', 'T5', 'T4', 'T3', 'T2', 'T1', 'T0']);
  });

  it('T-LIST-030d: rows sharing a date are not skipped or repeated across pages', async () => {
    // Without the `id` tie-breaker the comparison is not a total order, and
    // boundary rows are dropped — the worst possible silent failure here.
    for (let i = 0; i < 5; i += 1) {
      await seedTitle({ name: `Same${String(i)}`, dateAdded: '2026-05-05' });
    }

    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const body: ListBody = await list(
        `?limit=2${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...body.items.map((i) => i.name));
      cursor = body.nextCursor;
      if (cursor === null) break;
    }

    expect(new Set(seen).size).toBe(5);
  });

  it('T-LIST-030e: the last page reports nextCursor: null', async () => {
    await seedTitle({ name: 'Only' });

    const body = await list('?limit=50');
    expect(body.nextCursor).toBeNull();
    expect(body.limit).toBe(50);
  });

  it('T-LIST-030f: an empty list is 200 with an empty array, never a 404', async () => {
    const body = await list();
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });
});

describe('T-API-017 a tampered cursor is refused end to end', () => {
  it('T-API-017l: a tampered cursor is a 400 INVALID_CURSOR, NOT page 1', async () => {
    // ⚠ The behaviour under test is the ABSENCE of a silent reset. Returning
    // the first page here would read, from the owner's side, as the rows they
    // were looking at having vanished.
    await seedTitle({ name: 'First', dateAdded: '2026-09-09' });
    await seedTitle({ name: 'Second', dateAdded: '2026-01-01' });

    const res = await get(
      `?cursor=${encodeURIComponent(`${encodeCursor({ sortDateAdded: '2026-09-09', id: 't-0001' })}X`)}`,
    );
    expect(res.status).toBe(400);

    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe('INVALID_CURSOR');
    expect(JSON.stringify(body)).not.toContain('First');
  });

  it('T-API-017m: an unparseable cursor is refused before any rows are read', async () => {
    const res = await get('?cursor=not-a-real-cursor');
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('INVALID_CURSOR');
  });

  it('T-API-017n: a bad limit is VALIDATION_FAILED, not a clamped page', async () => {
    const res = await get('?limit=5000');
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('VALIDATION_FAILED');
  });

  it('T-API-017o: the list requires authentication', async () => {
    const res = await fetch(`${origin}/api/titles`);
    expect(res.status).toBe(401);
    expect(((await res.json()) as ErrorBody).error.code).toBe('UNAUTHENTICATED');
  });
});
