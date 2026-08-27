/**
 * TASK-112 — `apps/api/src/repository/undoDiscard.ts` against a real engine
 * (`specs/data-model.md` §8.3, SD-03).
 *
 * ⚠ WHY THIS EXISTS SEPARATELY FROM `batchUndo.spec.ts`. That suite drives the
 * undo through the HTTP route, which is the right level for "did the list come
 * back". This one tests the discard module directly, because the property that
 * actually broke the feature is a DATABASE property and is invisible from
 * above: `batch_change` and `extraction_candidate` hold plain foreign keys
 * onto the rows the discard destroys, and only `service_listing → title`
 * cascades. Every discard failed with `fk_change_listing` until the detach was
 * added.
 *
 * The first case below deliberately runs the discard WITHOUT the detach and
 * asserts it throws. Without it, the detach could be deleted tomorrow and
 * nothing would explain why the route suite went red — and `T-INV-023b`
 * would have no integration spec reaching this module at all.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { asOwnerId } from '../../src/repository/ownerData.js';
import {
  detachReferencesToDiscarded,
  discardCreatedListings,
  discardCreatedTitles,
} from '../../src/repository/undoDiscard.js';
import { closeTestPrisma, resetDatabase, testPrisma } from './harness.js';

const ownerId = asOwnerId('o_undodiscard');
const OTHER = asOwnerId('o_someone_else');
const DUNE = 'tmdb:movie:438631';

async function seed(): Promise<void> {
  await testPrisma().uploadBatch.create({
    data: {
      id: 'disc-batch-1',
      ownerId,
      service: 'netflix',
      mode: 'append-only',
      status: 'applied',
      lowYield: false,
      degradedExtraction: false,
    },
  });
  await testPrisma().title.create({
    data: {
      id: 'disc-title-1',
      ownerId,
      workIdentity: DUNE,
      state: 'active',
      matchState: 'matched',
      normalisedText: 'dune',
      tmdbId: 438631,
      tmdbMediaType: 'movie',
      tmdbName: 'Dune',
      sortDateAdded: new Date('2026-02-01'),
    },
  });
  await testPrisma().serviceListing.create({
    data: {
      listingId: 'disc-listing-1',
      ownerId,
      titleId: 'disc-title-1',
      service: 'netflix',
      state: 'active',
      dateAdded: new Date('2026-02-01'),
      createdByBatchId: 'disc-batch-1',
    },
  });
  await testPrisma().batchChange.create({
    data: {
      ownerId,
      batchId: 'disc-batch-1',
      kind: 'listing_added',
      titleId: 'disc-title-1',
      listingId: 'disc-listing-1',
    },
  });
  await testPrisma().extractionCandidate.create({
    data: {
      id: 'disc-cand-1',
      ownerId,
      batchId: 'disc-batch-1',
      rawText: 'Dune',
      inferredTitle: 'Dune',
      basis: 'both',
      ocrSupport: 'exact',
      provider: 'llm',
      normalisedText: 'dune',
      boxSource: 'llm',
      cleanupVerdict: 'title-candidate',
      resolvedWorkIdentity: DUNE,
      classification: 'new',
      reviewDisposition: 'confirmed',
      resolvedTitleId: 'disc-title-1',
    },
  });
}

beforeEach(async () => {
  testPrisma();
  await resetDatabase();
  await seed();
});

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-UNDO-010 · the SD-03 discard against a real engine', () => {
  it('T-UNDO-010a: discarding WITHOUT the detach violates fk_change_listing', async () => {
    // The bug this module was written around. Kept as a test so the ordering
    // constraint is documented by something that fails when it is broken.
    await expect(discardCreatedTitles(ownerId, ['disc-title-1'])).rejects.toThrow(/[Ff]oreign key/);

    // And nothing partially happened.
    expect(await testPrisma().title.count({ where: { ownerId } })).toBe(1);
  });

  it('T-UNDO-010b: detach then discard removes the title AND cascades its listing', async () => {
    await detachReferencesToDiscarded(ownerId, ['disc-title-1'], ['disc-listing-1']);
    expect(await discardCreatedTitles(ownerId, ['disc-title-1'])).toBe(1);

    expect(await testPrisma().title.count({ where: { ownerId } })).toBe(0);
    expect(await testPrisma().serviceListing.count({ where: { ownerId } })).toBe(0);
  });

  it('T-UNDO-010c: provenance and candidates SURVIVE with their pointers cleared', async () => {
    // REQ-028. The discard removes list records, never the record OF the
    // discard, and never the owner's evidence (US-032 AC-3).
    await detachReferencesToDiscarded(ownerId, ['disc-title-1'], ['disc-listing-1']);
    await discardCreatedTitles(ownerId, ['disc-title-1']);

    const change = await testPrisma().batchChange.findFirst({ where: { ownerId } });
    expect(change).not.toBeNull();
    expect(change?.kind).toBe('listing_added');
    expect(change?.titleId).toBeNull();
    expect(change?.listingId).toBeNull();

    const candidate = await testPrisma().extractionCandidate.findFirst({ where: { ownerId } });
    expect(candidate?.rawText).toBe('Dune');
    expect(candidate?.reviewDisposition).toBe('confirmed');
    expect(candidate?.resolvedTitleId).toBeNull();
    // The identity the owner confirmed is NOT a pointer and must stay.
    expect(candidate?.resolvedWorkIdentity).toBe(DUNE);
  });

  it('T-UNDO-010d: a listing is discarded on its own, leaving its title alone', async () => {
    await detachReferencesToDiscarded(ownerId, [], ['disc-listing-1']);
    expect(await discardCreatedListings(ownerId, ['disc-listing-1'])).toBe(1);

    expect(await testPrisma().serviceListing.count({ where: { ownerId } })).toBe(0);
    expect(await testPrisma().title.count({ where: { ownerId } })).toBe(1);
  });

  it('T-UNDO-010e: every write is OWNER-SCOPED (NFR-008)', async () => {
    // A hard delete that ignored `ownerId` would destroy another owner's rows
    // irrecoverably — there is no soft-deleted copy behind SD-03.
    await detachReferencesToDiscarded(OTHER, ['disc-title-1'], ['disc-listing-1']);
    expect(await discardCreatedTitles(OTHER, ['disc-title-1'])).toBe(0);
    expect(await discardCreatedListings(OTHER, ['disc-listing-1'])).toBe(0);

    expect(await testPrisma().title.count({ where: { ownerId } })).toBe(1);
    expect(await testPrisma().serviceListing.count({ where: { ownerId } })).toBe(1);
    const change = await testPrisma().batchChange.findFirst({ where: { ownerId } });
    expect(change?.titleId).toBe('disc-title-1');
    expect(change?.listingId).toBe('disc-listing-1');
  });

  it('T-UNDO-010f: an empty id list is a no-op, not a delete-everything', async () => {
    // ⚠ `deleteMany({ where: { id: { in: [] } } })` is safe, but a hand-rolled
    // "skip the filter when the list is empty" is the classic way this becomes
    // a table wipe. Pinned because the blast radius is unrecoverable.
    await detachReferencesToDiscarded(ownerId, [], []);
    expect(await discardCreatedTitles(ownerId, [])).toBe(0);
    expect(await discardCreatedListings(ownerId, [])).toBe(0);

    expect(await testPrisma().title.count({ where: { ownerId } })).toBe(1);
    expect(await testPrisma().serviceListing.count({ where: { ownerId } })).toBe(1);
    const change = await testPrisma().batchChange.findFirst({ where: { ownerId } });
    expect(change?.titleId).toBe('disc-title-1');
  });
});
