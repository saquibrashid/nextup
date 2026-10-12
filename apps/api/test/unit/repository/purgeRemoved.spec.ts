/**
 * US-067 — `purgeRemoved.ts` against a recording fake `Db`.
 *
 * The integration suite proves the SQL behaviour; this proves the decisions
 * the module makes (which candidates are the producing ones, when a title is
 * kept) without a database, so they count towards the coverage floor.
 *
 * T-PURGE-003: producing candidates, and only those, are deleted.
 * T-PURGE-004: the title is deleted only with nothing referencing it.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  deleteProducingCandidates,
  deleteRemovedListings,
  deleteTitleIfUnreferenced,
  detachPurgedProvenance,
} from '../../../src/repository/purgeRemoved.js';
import type { Db, OwnerId } from '../../../src/repository/ownerData.js';

const OWNER = 'owner-1' as OwnerId;

function fakeDb(over: Record<string, Record<string, unknown>> = {}) {
  const db: Record<string, Record<string, unknown>> = {
    serviceListing: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    extractionCandidate: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    watchIntent: { count: vi.fn().mockResolvedValue(0) },
    batchChange: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    title: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  for (const [model, fns] of Object.entries(over)) Object.assign(db[model] ?? {}, fns);
  return db as Record<string, Record<string, ReturnType<typeof vi.fn>>>;
}
const asDb = (db: unknown): Db => db as Db;

describe('deleteProducingCandidates', () => {
  it('T-PURGE-003d: a listing with no creating batch has no producing candidates', async () => {
    const db = fakeDb();
    const n = await deleteProducingCandidates(
      OWNER,
      [{ listingId: 'l', titleId: 't', createdByBatchId: null }],
      asDb(db),
    );
    expect(n).toBe(0);
    expect(db['extractionCandidate']?.['deleteMany']).not.toHaveBeenCalled();
  });

  it('T-PURGE-003e: candidates of the creating batch that resolved to the title go, with those collapsed into them', async () => {
    const db = fakeDb({
      serviceListing: { findMany: vi.fn().mockResolvedValue([{ listingId: 'l' }]) },
      extractionCandidate: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'c1' }])
          .mockResolvedValueOnce([{ id: 'c2' }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
    });
    const n = await deleteProducingCandidates(
      OWNER,
      [{ listingId: 'l', titleId: 't', createdByBatchId: 'b' }],
      asDb(db),
    );
    expect(n).toBe(2);
    expect(db['extractionCandidate']?.['deleteMany']).toHaveBeenCalledWith({
      where: { ownerId: OWNER, id: { in: ['c1', 'c2'] } },
    });
  });

  it('T-PURGE-003f: candidates stay while a surviving listing from the same batch uses the title', async () => {
    const db = fakeDb({
      serviceListing: {
        findMany: vi.fn().mockResolvedValue([{ listingId: 'l' }, { listingId: 'other' }]),
      },
    });
    const n = await deleteProducingCandidates(
      OWNER,
      [{ listingId: 'l', titleId: 't', createdByBatchId: 'b' }],
      asDb(db),
    );
    expect(n).toBe(0);
    expect(db['extractionCandidate']?.['findMany']).not.toHaveBeenCalled();
  });

  it('T-PURGE-003g: nothing found means nothing is deleted', async () => {
    const db = fakeDb({
      serviceListing: { findMany: vi.fn().mockResolvedValue([{ listingId: 'l' }]) },
    });
    const n = await deleteProducingCandidates(
      OWNER,
      [{ listingId: 'l', titleId: 't', createdByBatchId: 'b' }],
      asDb(db),
    );
    expect(n).toBe(0);
    expect(db['extractionCandidate']?.['deleteMany']).not.toHaveBeenCalled();
  });
});

describe('detachPurgedProvenance and deleteRemovedListings', () => {
  it('T-PURGE-003h: an empty set is a no-op', async () => {
    const db = fakeDb();
    await detachPurgedProvenance(OWNER, [], asDb(db));
    expect(await deleteRemovedListings(OWNER, [], asDb(db))).toBe(0);
    expect(db['batchChange']?.['updateMany']).not.toHaveBeenCalled();
    expect(db['serviceListing']?.['deleteMany']).not.toHaveBeenCalled();
  });

  it('T-PURGE-003i: provenance is detached with the purged marker, not deleted', async () => {
    const db = fakeDb();
    await detachPurgedProvenance(OWNER, ['l'], asDb(db));
    expect(db['batchChange']?.['updateMany']).toHaveBeenCalledWith({
      where: { ownerId: OWNER, listingId: { in: ['l'] } },
      data: { listingId: null, attr: 'purged', prevValue: null, nextValue: null },
    });
  });

  it('T-PURGE-001i: the listing delete is scoped to removed rows and aborts on a short count', async () => {
    const db = fakeDb({ serviceListing: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) } });
    await expect(deleteRemovedListings(OWNER, ['l'], asDb(db))).rejects.toThrow(/fewer removed/);
    expect(db['serviceListing']?.['deleteMany']).toHaveBeenCalledWith({
      where: { ownerId: OWNER, listingId: { in: ['l'] }, state: 'removed' },
    });
  });
});

describe('deleteTitleIfUnreferenced', () => {
  it.each([
    ['a listing', { serviceListing: { count: vi.fn().mockResolvedValue(1) } }],
    ['a watch intent', { watchIntent: { count: vi.fn().mockResolvedValue(1) } }],
    ['a candidate', { extractionCandidate: { count: vi.fn().mockResolvedValue(1) } }],
  ])('T-PURGE-004c: keeps the title while %s still references it', async (_name, over) => {
    const db = fakeDb(over);
    expect(await deleteTitleIfUnreferenced(OWNER, 't', asDb(db))).toBe(false);
    expect(db['title']?.['deleteMany']).not.toHaveBeenCalled();
  });

  it('T-PURGE-004d: deletes an unreferenced title after detaching its provenance', async () => {
    const db = fakeDb();
    expect(await deleteTitleIfUnreferenced(OWNER, 't', asDb(db))).toBe(true);
    expect(db['batchChange']?.['updateMany']).toHaveBeenCalledWith({
      where: { ownerId: OWNER, titleId: 't' },
      data: { titleId: null, listingId: null, attr: 'purged', prevValue: null, nextValue: null },
    });
    expect(db['title']?.['deleteMany']).toHaveBeenCalledWith({
      where: { ownerId: OWNER, id: 't' },
    });
  });
});
