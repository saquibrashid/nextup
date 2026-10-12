/**
 * US-067 / REQ-133 / TASK-276 — THE MODULE PERMITTED TO PERMANENTLY DELETE
 * REMOVED LISTINGS (`docs/adr/ADR-0015-permanent-delete.md`, `specs/data-model.md`
 * SD-18, I-7 and §8.5).
 *
 * ⚠ READ THIS BEFORE ADDING ANYTHING TO THIS FILE. REQ-028 is soft-delete
 * forever, amended at A58 to allow exactly one exception: the OWNER explicitly
 * asking, per listing or per work, for a listing that is ALREADY `removed` to
 * be erased. `T-INV-012` allow-lists this file by FILE and MODEL; a new model
 * or call site here is a product decision, not a test fix. Like
 * `undoDiscard.ts`, this file holds nothing else so the exemption stays the
 * size of the feature.
 *
 * ⚠ THE CALLER OWNS THE GUARDS. Nothing in this file checks that a listing is
 * removed before it deletes it — the service (`services/permanentDelete.ts`)
 * does, inside the same transaction, and `T-INV-012l` asserts it. Every
 * function here takes a `tx` and must only ever run inside that transaction.
 *
 * ⚠ NEVER TOUCHED HERE: `suppression` (keyed on work identity, deleted by
 * nobody — invariant 1), `watch_preference`, `removal_decision`, the batch and
 * its uploaded images. No tombstone is written; a reappearing work is a
 * brand-new title (L1/A33).
 */

import { PURGED_CHANGE_ATTR } from '@nextup/domain';
import { getPrisma } from './client.js';
import type { Db, OwnerId } from './ownerData.js';

/** A local copy of `ownerData.ts`'s private `db()` — see `undoDiscard.ts`. */
function db(tx?: Db): Db {
  return tx ?? getPrisma();
}

export interface PurgeListingRef {
  listingId: string;
  titleId: string;
  createdByBatchId: string | null;
}

/**
 * Delete the extraction candidates that produced these listings (and the
 * source-image links, which cascade). The uploaded images and the batch stay.
 *
 * A candidate is the one that produced a listing when it sits in the listing's
 * creating batch and resolved to the listing's title. It is KEPT when a
 * surviving listing of the same title was created by the same batch — an
 * auto-detect batch can write several services for one work from one candidate.
 */
export async function deleteProducingCandidates(
  ownerId: OwnerId,
  listings: readonly PurgeListingRef[],
  tx?: Db,
): Promise<number> {
  const conn = db(tx);
  const purgedIds = new Set(listings.map((l) => l.listingId));
  const pairs = new Map<string, { batchId: string; titleId: string }>();
  for (const l of listings) {
    if (l.createdByBatchId === null) continue;
    pairs.set(`${l.createdByBatchId}|${l.titleId}`, {
      batchId: l.createdByBatchId,
      titleId: l.titleId,
    });
  }

  const candidateIds: string[] = [];
  for (const { batchId, titleId } of pairs.values()) {
    const survivors = await conn.serviceListing.findMany({
      where: { ownerId, titleId, createdByBatchId: batchId },
      select: { listingId: true },
    });
    if (survivors.some((s) => !purgedIds.has(s.listingId))) continue;
    const rows = await conn.extractionCandidate.findMany({
      where: { ownerId, batchId, resolvedTitleId: titleId },
      select: { id: true },
    });
    candidateIds.push(...rows.map((r) => r.id));
  }
  if (candidateIds.length === 0) return 0;

  const collapsed = await conn.extractionCandidate.findMany({
    where: { ownerId, collapsedIntoCandidateId: { in: candidateIds } },
    select: { id: true },
  });
  const all = [...new Set([...candidateIds, ...collapsed.map((r) => r.id)])];
  const result = await conn.extractionCandidate.deleteMany({
    where: { ownerId, id: { in: all } },
  });
  return result.count;
}

/**
 * Detach provenance from the listings about to go, keeping the rows and
 * marking them with `PURGED_CHANGE_ATTR` so undo refuses the batch instead of
 * mistaking it for a smaller creates-only one.
 */
export async function detachPurgedProvenance(
  ownerId: OwnerId,
  listingIds: readonly string[],
  tx?: Db,
): Promise<void> {
  if (listingIds.length === 0) return;
  await db(tx).batchChange.updateMany({
    where: { ownerId, listingId: { in: [...listingIds] } },
    data: { listingId: null, attr: PURGED_CHANGE_ATTR, prevValue: null, nextValue: null },
  });
}

/** Delete the listings. Anything but `removed` in scope aborts the transaction. */
export async function deleteRemovedListings(
  ownerId: OwnerId,
  listingIds: readonly string[],
  tx?: Db,
): Promise<number> {
  if (listingIds.length === 0) return 0;
  const result = await db(tx).serviceListing.deleteMany({
    where: { ownerId, listingId: { in: [...listingIds] }, state: 'removed' },
  });
  if (result.count !== listingIds.length) {
    throw new Error('permanent delete matched fewer removed listings than requested');
  }
  return result.count;
}

/**
 * Delete the title only when nothing of any state still references it: no
 * listing, no watch intent, no candidate. Returns whether it was deleted.
 */
export async function deleteTitleIfUnreferenced(
  ownerId: OwnerId,
  titleId: string,
  tx?: Db,
): Promise<boolean> {
  const conn = db(tx);
  const [listings, intents, candidates] = await Promise.all([
    conn.serviceListing.count({ where: { ownerId, titleId } }),
    conn.watchIntent.count({ where: { ownerId, titleId } }),
    conn.extractionCandidate.count({ where: { ownerId, resolvedTitleId: titleId } }),
  ]);
  if (listings + intents + candidates > 0) return false;

  await conn.batchChange.updateMany({
    where: { ownerId, titleId },
    data: {
      titleId: null,
      listingId: null,
      attr: PURGED_CHANGE_ATTR,
      prevValue: null,
      nextValue: null,
    },
  });
  const result = await conn.title.deleteMany({ where: { ownerId, id: titleId } });
  return result.count > 0;
}
