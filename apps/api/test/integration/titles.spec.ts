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
  listTitleRatingRows,
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
  runtimeUnknownHidden: number | null;
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
  runtime?: number;
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
    tmdbRuntimeMinutes: options.runtime ?? null,
    tmdbFetchedAt: new Date(),
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

describe('T-API-030 server-backed search over the full library', () => {
  it.each(
    ['dateAdded', 'runtime', 'releaseYear', 'rating', 'name'].flatMap((sort) =>
      ['asc', 'desc'].map((dir) => ({ sort, dir })),
    ),
  )('T-API-030l keeps search scoped across every $sort/$dir cursor', async ({ sort, dir }) => {
    const first = await seedTitle({ name: 'Dune Am\u00e9lie', runtime: 20 });
    const second = await seedTitle({ name: 'Dune amelie', runtime: 20 });
    const unknown = await seedTitle({ name: 'Dune Unknown' });
    await seedTitle({ name: 'Unrelated', runtime: 20 });
    for (const title of [first.title, second.title]) {
      await testPrisma().title.updateMany({
        where: { ownerId: owner, id: title.id },
        data: { tmdbReleaseYear: 2001, imdbRatingTenths: 80, imdbRatingFetchedAt: new Date() },
      });
    }
    const query = `?q=dune&sort=${sort}&dir=${dir}`;
    const expected = (await list(query)).items.map((item) => item.titleId);
    expect(new Set(expected)).toEqual(new Set([first.title.id, second.title.id, unknown.title.id]));
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await list(
        `${query}&limit=1${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      seen.push(...page.items.map((item) => item.titleId));
      cursor = page.nextCursor;
      expect(seen.length).toBeLessThanOrEqual(expected.length);
    } while (cursor !== null);
    expect(seen).toEqual(expected);
  });

  it('T-API-030g filters before keyset pagination, preserving every filter on later pages', async () => {
    await seedTitle({ name: 'Newest distraction', dateAdded: '2026-09-01' });
    const first = await seedTitle({ name: 'The Matrix', dateAdded: '2026-08-01', runtime: 20 });
    const second = await seedTitle({
      name: 'Matrix Reloaded',
      dateAdded: '2026-07-01',
      runtime: 25,
    });
    await seedTitle({ name: 'Matrix wrong genre', genres: ['Comedy'], runtime: 20 });
    await seedTitle({ name: 'Matrix wrong service', service: 'max', runtime: 20 });
    await seedTitle({ name: 'Matrix wrong type', mediaType: 'tv', runtime: 20 });
    await seedTitle({ name: 'Matrix wrong runtime', runtime: 100 });
    const query = '?q=%20matrix%20&service=netflix&type=movie&genre=Drama&runtime=under30&limit=1';
    expect((await list('?limit=1')).items[0]?.name).toBe('Newest distraction');
    const page1 = await list(query);
    expect(page1.items.map((item) => item.titleId)).toEqual([first.title.id]);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await list(`${query}&cursor=${encodeURIComponent(page1.nextCursor ?? '')}`);
    expect(page2.items.map((item) => item.titleId)).toEqual([second.title.id]);
    expect(page2.nextCursor).toBeNull();
    expect((await list('?q=no-such-title')).items).toEqual([]);
  });

  it('T-API-030h searches full display names and unmatched text, case/accent insensitively', async () => {
    await seedTitle({ name: 'The Am\u00e9lie Story' });
    const unmatched = await seedTitle({});
    await testPrisma().title.updateMany({
      where: { ownerId: owner, id: unmatched.title.id },
      data: {
        matchState: 'unmatched',
        workIdentity: 'unmatched:unknown-search-title',
        tmdbId: null,
        tmdbName: null,
        rawExtractedText: 'An Unknown Screenshot',
        normalisedText: 'an unknown screenshot',
      },
    });
    expect((await list('?q=THE%20AMELIE')).items.map((item) => item.name)).toEqual([
      'The Am\u00e9lie Story',
    ]);
    expect((await list('?q=unknown%20screenshot')).items.map((item) => item.titleId)).toEqual([
      unmatched.title.id,
    ]);
  });

  it('T-API-030i treats SQL and LIKE punctuation literally, never as query syntax', async () => {
    const literal = "100%_[!] O'Brien";
    await seedTitle({ name: literal });
    await seedTitle({ name: '100percentX ordinary' });
    for (const q of [literal, '%', '_', '[', '!', "O'Brien"]) {
      expect((await list(`?q=${encodeURIComponent(q)}`)).items.map((item) => item.name)).toEqual([
        literal,
      ]);
    }
    expect((await list(`?q=${encodeURIComponent("' OR 1=1 --")}`)).items).toEqual([]);
  });

  it('T-API-030j keeps counts and rating scope searched, owner-scoped and suppression-safe', async () => {
    const visible = await seedTitle({ name: 'Dune short', runtime: 20 });
    await seedTitle({ name: 'Dune unknown' });
    await seedTitle({ name: 'Dune another unknown' });
    await seedTitle({ name: 'Unrelated unknown' });
    await seedTitle({ name: 'Dune another service', service: 'max' });
    await seedTitle({ name: 'Dune foreign', ownerId: asOwnerId('other-search-owner') });
    const removed = await seedTitle({ name: 'Dune removed' });
    await softDeleteServiceListing(owner, removed.listing.listingId, {
      removedAt: new Date(),
      removedByBatchId: removed.batch.id,
    });
    const suppressed = await seedTitle({ name: 'Dune suppressed' });
    await createSuppression(owner, {
      id: 'search-suppression',
      workIdentity: suppressed.title.workIdentity,
      displayName: 'Dune suppressed',
      active: true,
    });
    const body = await list('?q=dune&runtime=under30&service=netflix&limit=1');
    expect(body.items.map((item) => item.titleId)).toEqual([visible.title.id]);
    expect(body.runtimeUnknownHidden).toBe(2);
    expect(body.nextCursor).toBeNull();
    expect((await list('?q=nothing&runtime=under30')).runtimeUnknownHidden).toBe(0);
    expect((await list('?q=dune')).runtimeUnknownHidden).toBeNull();
    expect(
      (
        await listTitleRatingRows(owner, {
          q: 'dune',
          services: ['netflix'],
          runtimes: ['under30'],
        })
      ).map((row) => row.id),
    ).toEqual([visible.title.id]);
  });

  it('T-API-030k searches libraries beyond SQL Server parameter limits', async () => {
    const seeded = await seedTitle({ name: 'Needle original' });
    const rows = Array.from({ length: 2105 }, (_, index) => ({
      ...seeded.title,
      id: `search-large-${String(index).padStart(4, '0')}`,
      workIdentity: `tmdb:movie:large-search-${String(index)}`,
    }));
    for (let start = 0; start < rows.length; start += 100) {
      const chunk = rows.slice(start, start + 100);
      await testPrisma().title.createMany({ data: chunk });
      await testPrisma().serviceListing.createMany({
        data: chunk.map((row) => ({
          ...seeded.listing,
          listingId: `listing-${row.id}`,
          titleId: row.id,
        })),
      });
    }
    const page = await list('?q=Needle&limit=1');
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    expect((await list('?q=Needle&runtime=under30')).runtimeUnknownHidden).toBe(2106);
  });
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
