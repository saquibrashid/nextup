/**
 * US-067 / REQ-133 / TASK-277 — owner-initiated permanent delete of REMOVED
 * listings (`specs/api.md` §6.54 and §6.55, `docs/adr/ADR-0015`).
 *
 * ⚠ THE GUARD AND THE DELETE SHARE ONE TRANSACTION. The removed-state check
 * runs inside `runInTransaction` immediately before the purge steps, so a
 * restore racing this request cannot slip an active listing past the guard
 * (`T-INV-012l`). Any failure after the first write rolls the whole request
 * back (`T-PURGE-007`).
 *
 * ⚠ ORDER, and why: candidates first (they reference the title), then the
 * provenance pointers (plain FKs to the listings), then the listings, then —
 * only if nothing of any state still references it — the title. Suppression is
 * never touched.
 */

import { AppError } from '../errors/AppError.js';
import {
  findServiceListingWithWork,
  listListingsForWork,
  runInTransaction,
  type OwnerId,
} from '../repository/ownerData.js';
import {
  deleteProducingCandidates,
  deleteRemovedListings,
  deleteTitleIfUnreferenced,
  detachPurgedProvenance,
  type PurgeListingRef,
} from '../repository/purgeRemoved.js';
import type { Db } from '../repository/ownerData.js';

export interface PermanentDeleteResult {
  listingsDeleted: number;
  candidatesDeleted: number;
  titlesDeleted: number;
}

async function purge(
  ownerId: OwnerId,
  listings: readonly PurgeListingRef[],
  tx: Db,
): Promise<PermanentDeleteResult> {
  const candidatesDeleted = await deleteProducingCandidates(ownerId, listings, tx);
  await detachPurgedProvenance(
    ownerId,
    listings.map((l) => l.listingId),
    tx,
  );
  const listingsDeleted = await deleteRemovedListings(
    ownerId,
    listings.map((l) => l.listingId),
    tx,
  );
  let titlesDeleted = 0;
  for (const titleId of new Set(listings.map((l) => l.titleId))) {
    if (await deleteTitleIfUnreferenced(ownerId, titleId, tx)) titlesDeleted += 1;
  }
  return { listingsDeleted, candidatesDeleted, titlesDeleted };
}

/**
 * Permanently delete one removed listing.
 *
 * @throws AppError 404 `NOT_FOUND`, 409 `LISTING_NOT_REMOVED`.
 */
export async function permanentlyDeleteListing(
  ownerId: OwnerId,
  listingId: string,
): Promise<PermanentDeleteResult> {
  return runInTransaction(async (tx) => {
    const listing = await findServiceListingWithWork(ownerId, listingId, tx);
    if (listing === null) throw new AppError('NOT_FOUND', 404, 'No such listing.');
    if (listing.state !== 'removed') {
      throw new AppError(
        'LISTING_NOT_REMOVED',
        409,
        'Only a removed listing can be deleted permanently. Nothing was changed.',
        { listingId },
      );
    }
    return purge(
      ownerId,
      [
        {
          listingId: listing.listingId,
          titleId: listing.titleId,
          createdByBatchId: listing.createdByBatchId,
        },
      ],
      tx,
    );
  });
}

/**
 * Permanently delete every listing of one work, refused WHOLE if any is active.
 *
 * @throws AppError 404 `NOT_FOUND`, 409 `WORK_HAS_ACTIVE_LISTING`.
 */
export async function permanentlyDeleteWorkHistory(
  ownerId: OwnerId,
  workIdentity: string,
): Promise<PermanentDeleteResult> {
  return runInTransaction(async (tx) => {
    const listings = await listListingsForWork(ownerId, workIdentity, tx);
    if (listings.length === 0) throw new AppError('NOT_FOUND', 404, 'No such work.');
    if (listings.some((l) => l.state !== 'removed')) {
      throw new AppError(
        'WORK_HAS_ACTIVE_LISTING',
        409,
        'This work is still on your list, so its history can’t be deleted. Nothing was changed.',
        { workIdentity },
      );
    }
    return purge(ownerId, listings, tx);
  });
}
