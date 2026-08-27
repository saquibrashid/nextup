/**
 * TASK-095 — `GET /api/removed`, the removed view (`specs/api.md` §6.9,
 * `specs/data-model.md` §11, US-023/US-024).
 *
 * ⚠ **WHAT THIS FILE IS REALLY GUARDING IS THE OWNER'S ABILITY TO SEE THAT A
 * TITLE KEEPS COMING BACK.** The removed view is a historical LOG, not a
 * recycle bin (product invariant 7), and the single most tempting "improvement"
 * to it — collapsing three removals of the same work into one row — destroys
 * exactly the information it exists to carry. De-duplication here would also
 * LOOK right in every screenshot: one row per title is what the combined list
 * does, and a reviewer who did not know §11 would read it as consistency.
 * `T-REM-006` is the assertion that stops that, and it is the reason the
 * ordinals exist at all.
 *
 * ⚠ **AND THE ABILITY TO FIND A ROW THAT NEVER MATCHED.** `T-REM-021` searches
 * for an UNMATCHED row's extracted text. A search that only looks at
 * `tmdb_name` passes a "search works" test written against matched rows and
 * silently hides every row the extraction could not identify — which is the
 * set an owner is most likely to come here looking for.
 *
 * Run against a real SQL Server and the real Express app (`specs/testing.md`
 * §3.2). Nothing reaches the internet.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import {
  asOwnerId,
  createServiceListing,
  createSuppression,
  createTitle,
  createUploadBatch,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-removed-view';
const OTHER_SUBJECT = 'oid-other-removed-view';
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

interface RemovedItem {
  listingId: string;
  titleId: string;
  workIdentity: string;
  name: string;
  service: string;
  dateAdded: string;
  removedAt: string;
  removedByBatchId: string | null;
  removalOrdinal: number;
  removalTotalForWork: number;
  restorable: boolean;
  suppressed: boolean;
}

interface RemovedPage {
  items: RemovedItem[];
  nextCursor: string | null;
  limit: number;
}

interface ErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

let server: Server;
let app: Express;
let origin: string;
let owner: OwnerId;
let otherOwner: OwnerId;

const ownerIdFor = async (subject: string): Promise<OwnerId> => {
  const res = await fetch(`${origin}/api/me`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject) },
  });
  expect(res.status).toBe(200);
  return asOwnerId(((await res.json()) as { ownerId: string }).ownerId);
};

const getRemoved = (query = '', subject = SUBJECT): Promise<Response> =>
  fetch(`${origin}/api/removed${query}`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(subject) },
  });

const page = async (query = ''): Promise<RemovedPage> => {
  const res = await getRemoved(query);
  expect(res.status).toBe(200);
  return (await res.json()) as RemovedPage;
};

let seq = 0;

/**
 * Seed one REMOVED listing.
 *
 * Each call makes its own title, which is what a reappearance genuinely does
 * (product invariant 7: a reappearing title becomes a brand-new row). Passing
 * the same `workIdentity` twice therefore models the real thing the removed
 * view has to survive — several distinct titles, one work — rather than
 * pointing two listings at one row, which the product never produces.
 */
async function seedRemoved(options: {
  ownerId?: OwnerId;
  workIdentity?: string;
  name?: string | null;
  extractedText?: string;
  service?: string;
  dateAdded?: string;
  removedAt: string;
}) {
  seq += 1;
  const id = `rv-${String(seq).padStart(4, '0')}`;
  const on = options.ownerId ?? owner;
  const service = options.service ?? 'netflix';
  const dateAdded = new Date(`${options.dateAdded ?? '2026-04-02'}T00:00:00.000Z`);
  const matched = options.name != null;

  const batch = await createUploadBatch(on, {
    id: `b-${id}`,
    service,
    mode: 'full-update',
    status: 'applied',
  });
  const title = await createTitle(on, {
    id,
    workIdentity:
      options.workIdentity ??
      (matched
        ? `tmdb:movie:${String(400_000 + seq)}`
        : `unmatched:${String(seq).padStart(16, '0')}`),
    state: 'removed',
    matchState: matched ? 'matched' : 'unmatched',
    // `title_match_coherent` is a CHECK, not a convention.
    ...(matched
      ? {
          tmdbId: 400_000 + seq,
          tmdbMediaType: 'movie',
          tmdbName: options.name ?? '',
          tmdbReleaseYear: 2021,
          tmdbPosterPath: '/poster.jpg',
        }
      : {
          rawExtractedText: options.extractedText ?? 'Unreadable Thing',
          normalisedText: (options.extractedText ?? 'Unreadable Thing').toLowerCase(),
        }),
    tmdbGenres: '[]',
    sortDateAdded: dateAdded,
    createdByBatchId: batch.id,
  });

  const listing = await createServiceListing(on, {
    listingId: `l-${id}`,
    titleId: title.id,
    service,
    state: 'removed',
    dateAdded,
    removedAt: new Date(options.removedAt),
    removedByBatchId: batch.id,
    createdByBatchId: batch.id,
  });

  return { title, listing, batch };
}

beforeEach(async () => {
  await resetDatabase();
  resetAllowListWarning();
  process.env['NEXTUP_ALLOWED_SUBJECTS'] = `${SUBJECT},${OTHER_SUBJECT}`;
  if (server === undefined) {
    app = createApp();
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  }
  owner = await ownerIdFor(SUBJECT);
  otherOwner = await ownerIdFor(OTHER_SUBJECT);
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeTestPrisma();
});

describe('GET /api/removed', () => {
  it('T-REM-020: each removed listing carries its service, date-added and date-removed', async () => {
    const seeded = await seedRemoved({
      name: 'Dune',
      service: 'netflix',
      dateAdded: '2026-04-02',
      removedAt: '2026-07-14T09:31:02.117Z',
    });

    const { items } = await page();

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      listingId: seeded.listing.listingId,
      titleId: seeded.title.id,
      name: 'Dune',
      service: 'netflix',
      // A DATE, not a timestamp: `dateAdded` is the write-once value the badge
      // carried before removal (REQ-030).
      dateAdded: '2026-04-02',
      // A TIMESTAMP, not a date: the log is ordered and two removals on one day
      // must stay distinguishable.
      removedAt: '2026-07-14T09:31:02.117Z',
      removedByBatchId: seeded.batch.id,
      restorable: true,
      suppressed: false,
    });
  });

  it('T-REM-020a: orders newest removal first, tie-broken by listing id ascending', async () => {
    // Identical `removedAt` is the NORMAL case, not a rare tie: one
    // full-update close removes many listings inside one transaction.
    const shared = '2026-07-14T09:31:02.117Z';
    await seedRemoved({ name: 'Older', removedAt: '2026-05-01T00:00:00.000Z' });
    await seedRemoved({ name: 'Tie B', removedAt: shared });
    await seedRemoved({ name: 'Tie A', removedAt: shared });

    const { items } = await page();

    expect(items.map((i) => i.name)).toEqual(['Tie B', 'Tie A', 'Older']);
    // `rv-0002` < `rv-0003`, so the tie resolves by listing id ASCENDING.
    expect((items[0]?.listingId ?? '') < (items[1]?.listingId ?? '')).toBe(true);
  });

  it('T-REM-006: three removals of one work are three rows, never de-duplicated', async () => {
    const work = 'tmdb:movie:438631';
    await seedRemoved({ workIdentity: work, name: 'Dune', removedAt: '2026-05-01T00:00:00.000Z' });
    await seedRemoved({ workIdentity: work, name: 'Dune', removedAt: '2026-06-01T00:00:00.000Z' });
    await seedRemoved({ workIdentity: work, name: 'Dune', removedAt: '2026-07-01T00:00:00.000Z' });

    const { items } = await page();

    expect(items).toHaveLength(3);
    expect(new Set(items.map((i) => i.listingId)).size).toBe(3);
    expect(items.every((i) => i.workIdentity === work)).toBe(true);
  });

  it('T-REM-006b: ordinals count forwards through history, oldest removal first', async () => {
    const work = 'tmdb:movie:438631';
    await seedRemoved({ workIdentity: work, name: 'Dune', removedAt: '2026-05-01T00:00:00.000Z' });
    await seedRemoved({ workIdentity: work, name: 'Dune', removedAt: '2026-06-01T00:00:00.000Z' });
    await seedRemoved({ workIdentity: work, name: 'Dune', removedAt: '2026-07-01T00:00:00.000Z' });

    const { items } = await page();

    // The PAGE is newest-first; the ORDINAL counts forwards. The two orderings
    // are deliberately opposed — numbering from the newest would renumber every
    // earlier row the next time the work was removed.
    expect(items.map((i) => i.removalOrdinal)).toEqual([3, 2, 1]);
    expect(items.map((i) => i.removalTotalForWork)).toEqual([3, 3, 3]);
  });

  it('T-REM-006c: an unrelated work has its own independent ordinals', async () => {
    await seedRemoved({
      workIdentity: 'tmdb:movie:1',
      name: 'A',
      removedAt: '2026-05-01T00:00:00.000Z',
    });
    await seedRemoved({
      workIdentity: 'tmdb:movie:1',
      name: 'A',
      removedAt: '2026-06-01T00:00:00.000Z',
    });
    await seedRemoved({
      workIdentity: 'tmdb:movie:2',
      name: 'B',
      removedAt: '2026-06-15T00:00:00.000Z',
    });

    const { items } = await page();
    const b = items.find((i) => i.name === 'B');

    expect(b).toMatchObject({ removalOrdinal: 1, removalTotalForWork: 1 });
  });

  it('T-REM-021: title-text search matches a MATCHED row on its TMDB name', async () => {
    await seedRemoved({ name: 'Dune', removedAt: '2026-05-01T00:00:00.000Z' });
    await seedRemoved({ name: 'Heat', removedAt: '2026-06-01T00:00:00.000Z' });

    const { items } = await page('?q=dun');

    expect(items.map((i) => i.name)).toEqual(['Dune']);
  });

  it('T-REM-021b: title-text search matches an UNMATCHED row on its extracted text', async () => {
    // The failure this guards is silent: a search over `tmdb_name` alone still
    // passes the matched case above, and hides every row that never matched.
    await seedRemoved({ extractedText: 'Bladerunner 2049', removedAt: '2026-05-01T00:00:00.000Z' });
    await seedRemoved({ name: 'Heat', removedAt: '2026-06-01T00:00:00.000Z' });

    const { items } = await page('?q=bladerunner');

    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe('Bladerunner 2049');
  });

  it('T-REM-021c: search is case- and accent-insensitive', async () => {
    await seedRemoved({ name: 'Amélie', removedAt: '2026-05-01T00:00:00.000Z' });

    const { items } = await page('?q=AMELIE');

    expect(items.map((i) => i.name)).toEqual(['Amélie']);
  });

  it('T-REM-021d: a LIKE metacharacter in the term is escaped, not honoured', async () => {
    // `%` reaching SQL Server unescaped would match everything and read as a
    // search that had simply found the whole log.
    await seedRemoved({ name: 'Dune', removedAt: '2026-05-01T00:00:00.000Z' });
    await seedRemoved({ name: 'Heat', removedAt: '2026-06-01T00:00:00.000Z' });

    const { items } = await page('?q=%25');

    expect(items).toHaveLength(0);
  });

  it('T-REM-022: the service filter matches on the REMOVED listing\u2019s service', async () => {
    await seedRemoved({
      name: 'On Netflix',
      service: 'netflix',
      removedAt: '2026-05-01T00:00:00.000Z',
    });
    await seedRemoved({ name: 'On Max', service: 'max', removedAt: '2026-06-01T00:00:00.000Z' });

    const { items } = await page('?service=max');

    expect(items.map((i) => i.name)).toEqual(['On Max']);
  });

  it('T-REM-022b: filtering by service does NOT renumber a work\u2019s removal history', async () => {
    // The annotation exists to make repetition read as history. History that
    // renumbers itself when the view is narrowed is worse than no annotation.
    const work = 'tmdb:movie:438631';
    await seedRemoved({
      workIdentity: work,
      name: 'Dune',
      service: 'netflix',
      removedAt: '2026-05-01T00:00:00.000Z',
    });
    await seedRemoved({
      workIdentity: work,
      name: 'Dune',
      service: 'netflix',
      removedAt: '2026-06-01T00:00:00.000Z',
    });
    await seedRemoved({
      workIdentity: work,
      name: 'Dune',
      service: 'max',
      removedAt: '2026-07-01T00:00:00.000Z',
    });

    const { items } = await page('?service=max');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ removalOrdinal: 3, removalTotalForWork: 3 });
  });

  it('T-REM-022c: search and service filter compose', async () => {
    await seedRemoved({ name: 'Dune', service: 'netflix', removedAt: '2026-05-01T00:00:00.000Z' });
    await seedRemoved({ name: 'Dune', service: 'max', removedAt: '2026-06-01T00:00:00.000Z' });

    const { items } = await page('?q=dune&service=max');

    expect(items).toHaveLength(1);
    expect(items[0]?.service).toBe('max');
  });

  it('T-REM-020b: a suppressed work is reported unrestorable', async () => {
    const work = 'tmdb:movie:949';
    await seedRemoved({ workIdentity: work, name: 'Heat', removedAt: '2026-05-01T00:00:00.000Z' });
    await createSuppression(owner, {
      id: `supp:${work}`,
      workIdentity: work,
      active: true,
      displayName: 'Heat',
    });

    const { items } = await page();

    expect(items[0]).toMatchObject({ suppressed: true, restorable: false });
  });

  it('T-REM-020c: a LIFTED suppression leaves the row restorable', async () => {
    const work = 'tmdb:movie:949';
    await seedRemoved({ workIdentity: work, name: 'Heat', removedAt: '2026-05-01T00:00:00.000Z' });
    await createSuppression(owner, {
      id: `supp:${work}`,
      workIdentity: work,
      active: false,
      displayName: 'Heat',
    });

    const { items } = await page();

    expect(items[0]).toMatchObject({ suppressed: false, restorable: true });
  });

  it('T-REM-020d: an ACTIVE listing never appears in the removed view', async () => {
    const batch = await createUploadBatch(owner, {
      id: 'b-active',
      service: 'netflix',
      mode: 'append-only',
      status: 'applied',
    });
    const title = await createTitle(owner, {
      id: 't-active',
      workIdentity: 'tmdb:movie:777',
      state: 'active',
      matchState: 'matched',
      tmdbId: 777,
      tmdbMediaType: 'movie',
      tmdbName: 'Still Here',
      tmdbGenres: '[]',
      sortDateAdded: new Date('2026-04-02T00:00:00.000Z'),
      createdByBatchId: batch.id,
    });
    await createServiceListing(owner, {
      listingId: 'l-active',
      titleId: title.id,
      service: 'netflix',
      state: 'active',
      dateAdded: new Date('2026-04-02T00:00:00.000Z'),
      createdByBatchId: batch.id,
    });

    const { items } = await page();

    expect(items).toHaveLength(0);
  });

  it('T-SEC-002f: another owner\u2019s removals are invisible', async () => {
    await seedRemoved({
      ownerId: otherOwner,
      name: 'Not Yours',
      removedAt: '2026-05-01T00:00:00.000Z',
    });

    const { items } = await page();

    expect(items).toHaveLength(0);
  });

  it('T-REM-020e: pages by keyset without repeating or skipping a row', async () => {
    // Every removal shares one instant, which is what a full-update close
    // produces. A cursor that truncated the key to a date could not tell these
    // apart and would silently drop rows.
    const shared = '2026-07-14T09:31:02.117Z';
    for (let i = 0; i < 5; i += 1) {
      await seedRemoved({ name: `Film ${String(i)}`, removedAt: shared });
    }

    const first = await page('?limit=2');
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await page(`?limit=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`);
    const third = await page(`?limit=2&cursor=${encodeURIComponent(second.nextCursor ?? '')}`);

    const seen = [...first.items, ...second.items, ...third.items].map((i) => i.listingId);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(third.nextCursor).toBeNull();
  });

  it('T-API-017b: an unreadable cursor is a loud 400, never a silent reset to page 1', async () => {
    await seedRemoved({ name: 'Dune', removedAt: '2026-05-01T00:00:00.000Z' });

    const res = await getRemoved('?cursor=not-a-real-cursor');

    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe('INVALID_CURSOR');
  });
});
