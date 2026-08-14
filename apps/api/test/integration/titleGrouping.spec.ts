/**
 * US-018 AC-3/AC-4/AC-6 — one row per work, badges from ACTIVE listings.
 *
 * ── Why this file exists at all ─────────────────────────────────────────────
 *
 * `T-LIST-012`, `T-LIST-013` and `T-LIST-019` were **orphans**: defined in
 * `specs/testing.md` §9 against real acceptance criteria, cited by no task in
 * `docs/backlog.md`, and implemented by no suite. TASK-033 closed citing
 * `T-LIST-010`/`011`/`T-API-017` only, so three of US-018's criteria were
 * marked done by a ledger that had never been asked about them.
 *
 * That is the same shape that left TASK-037's genre filter unimplemented for
 * as long as `T-LIST-022` was unowned (`specs/testing.md` §21.1). These are
 * written now, and `tools/check-orphan-tests.mjs` is what stops the next one.
 *
 * ── Why integration and not unit ────────────────────────────────────────────
 *
 * Every property here is a property of the QUERY, not of the shaping function.
 * "Badges come from active listings" and "a work with no active listings has
 * no row" are both decided by the `include`/`where` that `listTitlePage`
 * builds; `toListItem` maps whatever rows it is handed and cannot get either
 * wrong. A unit test of the mapper would pass under a query that returned
 * removed listings.
 */

import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Express } from 'express';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { CLIENT_PRINCIPAL_HEADER } from '../../src/auth/principal.js';
import { resetAllowListWarning } from '../../src/middleware/allowList.js';
import {
  asOwnerId,
  createServiceListing,
  createTitle,
  createUploadBatch,
  softDeleteServiceListing,
  type OwnerId,
} from '../../src/repository/ownerData.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const OID = 'http://schemas.microsoft.com/identity/claims/objectidentifier';
const SUBJECT = 'oid-owner-grouping';
const ISSUER = 'https://sts.windows.net/tenant/';

const principalHeader = (subject: string): string =>
  Buffer.from(
    JSON.stringify({
      claims: [
        { typ: 'iss', val: ISSUER },
        { typ: OID, val: subject },
      ],
    }),
    'utf8',
  ).toString('base64');

interface Badge {
  service: string;
  listingId: string;
}

interface Item {
  titleId: string;
  badges: Badge[];
}

interface ListBody {
  items: Item[];
  nextCursor: string | null;
}

let server: Server;
let app: Express;
let origin: string;
let owner: OwnerId;

const list = async (): Promise<ListBody> => {
  const res = await fetch(`${origin}/api/titles`, {
    headers: { [CLIENT_PRINCIPAL_HEADER]: principalHeader(SUBJECT) },
  });
  expect(res.status).toBe(200);
  return (await res.json()) as ListBody;
};

const rowsFor = async (titleId: string): Promise<Item[]> =>
  (await list()).items.filter((item) => item.titleId === titleId);

const servicesOf = (item: Item): string[] => item.badges.map((b) => b.service).sort();

let seq = 0;

/** One upload batch, applied, for `service`. */
async function batchFor(id: string, service: string) {
  return createUploadBatch(owner, {
    id,
    service,
    mode: 'append-only',
    status: 'applied',
  });
}

/**
 * A title with one active listing per named service, all from ONE batch.
 *
 * Returns the listing ids keyed by service so a case can remove exactly one
 * without re-deriving the id from a naming convention.
 */
async function seedTitle(options: {
  id: string;
  services: readonly string[];
}): Promise<{ listingIds: Record<string, string>; batchId: string }> {
  seq += 1;
  const primary = options.services[0] ?? 'netflix';
  const batch = await batchFor(`b-${options.id}`, primary);
  const title = await createTitle(owner, {
    id: options.id,
    workIdentity: `tmdb:movie:${String(9000 + seq)}`,
    state: 'active',
    matchState: 'matched',
    tmdbId: 9000 + seq,
    tmdbMediaType: 'movie',
    tmdbName: `Grouping ${options.id}`,
    tmdbGenres: JSON.stringify(['Drama']),
    sortDateAdded: new Date('2026-04-02T00:00:00.000Z'),
    createdByBatchId: batch.id,
  });

  const listingIds: Record<string, string> = {};
  for (const service of options.services) {
    const listingId = `l-${options.id}-${service}`;
    await createServiceListing(owner, {
      listingId,
      titleId: title.id,
      service,
      state: 'active',
      dateAdded: new Date('2026-04-02T00:00:00.000Z'),
      createdByBatchId: batch.id,
    });
    listingIds[service] = listingId;
  }
  return { listingIds, batchId: batch.id };
}

/** Soft-delete a listing. `removedAt` is required: see `specs/testing.md` §19. */
async function removeListing(listingId: string, batchId: string): Promise<void> {
  await softDeleteServiceListing(owner, listingId, {
    removedByBatchId: batchId,
    removedAt: new Date('2026-04-09T00:00:00.000Z'),
  });
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

describe('T-LIST-012 — a removed listing badge is absent (US-018 AC-3)', () => {
  it('T-LIST-012a: removing one service listing drops that badge and keeps the row', async () => {
    const { listingIds, batchId } = await seedTitle({
      id: 't-012',
      services: ['netflix', 'max'],
    });
    await removeListing(listingIds['max'] ?? '', batchId);

    const rows = await rowsFor('t-012');
    expect(rows).toHaveLength(1);
    expect(servicesOf(rows[0] as Item)).toEqual(['netflix']);
  });

  it('T-LIST-012b: NON-VACUITY — both badges are present before the removal', async () => {
    // Without this, `012a` passes against a fixture that only ever created one
    // listing, and the assertion proves nothing about removal at all.
    await seedTitle({ id: 't-012b', services: ['netflix', 'max'] });

    const rows = await rowsFor('t-012b');
    expect(rows).toHaveLength(1);
    expect(servicesOf(rows[0] as Item)).toEqual(['max', 'netflix']);
  });

  it('T-LIST-012c: the removed listing id appears in no badge', async () => {
    // Stronger than asserting the service name: a query that returned the
    // removed row but blanked its service would satisfy `012a` and still be
    // leaking a removed listing's identifier into the payload.
    const { listingIds, batchId } = await seedTitle({
      id: 't-012c',
      services: ['netflix', 'max'],
    });
    const removed = listingIds['max'] ?? '';
    await removeListing(removed, batchId);

    const rows = await rowsFor('t-012c');
    expect(rows[0]?.badges.map((b) => b.listingId)).not.toContain(removed);
  });
});

describe('T-LIST-013 — a work with no active listings has no row (US-018 AC-4)', () => {
  /**
   * ⚠ `T-LIST-013` is DOUBLE-DEFINED in §9: line 960 is this criterion, line
   * 1026 assigns the same id to US-019 AC-2 ("hidden from the list, present in
   * the removed view"). Only the first half of that second sense is testable
   * today — there is no removed-view endpoint yet. This file implements the
   * US-018 AC-4 definition; the removed-view half needs its own id on the
   * removed-view task. Recorded in `specs/testing.md` §22.2.
   */
  it('T-LIST-013a: removing the only listing removes the row', async () => {
    const { listingIds, batchId } = await seedTitle({ id: 't-013', services: ['netflix'] });
    await removeListing(listingIds['netflix'] ?? '', batchId);

    expect(await rowsFor('t-013')).toHaveLength(0);
  });

  it('T-LIST-013b: NON-VACUITY — the row is present before the removal', async () => {
    await seedTitle({ id: 't-013b', services: ['netflix'] });
    expect(await rowsFor('t-013b')).toHaveLength(1);
  });

  it('T-LIST-013c: a work with one removed and one active listing KEEPS its row', async () => {
    // The discriminating case. "No ACTIVE listings" and "has a removed
    // listing" are different predicates that agree on `013a`; a query written
    // as the second silently deletes half-removed works from the list, which
    // is data loss the owner never approved (product invariant 2).
    const { listingIds, batchId } = await seedTitle({
      id: 't-013c',
      services: ['netflix', 'max'],
    });
    await removeListing(listingIds['max'] ?? '', batchId);

    const rows = await rowsFor('t-013c');
    expect(rows).toHaveLength(1);
    expect(servicesOf(rows[0] as Item)).toEqual(['netflix']);
  });
});

describe('T-LIST-019 — one work, two batches, two services (US-018 AC-6)', () => {
  it('T-LIST-019a: yields exactly one row carrying both badges', async () => {
    seq += 1;
    const netflixBatch = await batchFor('b-019-netflix', 'netflix');
    const title = await createTitle(owner, {
      id: 't-019',
      workIdentity: `tmdb:movie:${String(9000 + seq)}`,
      state: 'active',
      matchState: 'matched',
      tmdbId: 9000 + seq,
      tmdbMediaType: 'movie',
      tmdbName: 'Grouping t-019',
      tmdbGenres: JSON.stringify(['Drama']),
      sortDateAdded: new Date('2026-04-02T00:00:00.000Z'),
      createdByBatchId: netflixBatch.id,
    });
    await createServiceListing(owner, {
      listingId: 'l-019-netflix',
      titleId: title.id,
      service: 'netflix',
      state: 'active',
      dateAdded: new Date('2026-04-02T00:00:00.000Z'),
      createdByBatchId: netflixBatch.id,
    });

    // A SECOND, separate batch for the other service — the point of AC-6 is
    // that grouping is by work identity, not by the batch that found it.
    const maxBatch = await batchFor('b-019-max', 'max');
    await createServiceListing(owner, {
      listingId: 'l-019-max',
      titleId: title.id,
      service: 'max',
      state: 'active',
      dateAdded: new Date('2026-04-05T00:00:00.000Z'),
      createdByBatchId: maxBatch.id,
    });

    const rows = await rowsFor('t-019');
    expect(rows).toHaveLength(1);
    expect(servicesOf(rows[0] as Item)).toEqual(['max', 'netflix']);
  });

  it('T-LIST-019b: NON-VACUITY — two listing rows really exist in the store', async () => {
    // `019a` would pass identically if the second `createServiceListing` had
    // silently failed: one listing produces one row with one badge, and the
    // "exactly one row" half of the assertion is the easiest thing in the
    // suite to satisfy by accident.
    const { listingIds } = await seedTitle({ id: 't-019b', services: ['netflix', 'max'] });
    const stored = await testPrisma().serviceListing.findMany({
      where: { ownerId: owner, titleId: 't-019b' },
    });
    expect(stored).toHaveLength(2);
    expect(Object.keys(listingIds).sort()).toEqual(['max', 'netflix']);
  });
});
