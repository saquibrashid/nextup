/**
 * TASK-112 — THE ONE MODULE PERMITTED TO HARD-DELETE A LIST RECORD
 * (`specs/data-model.md` I-7 and §8.3, SD-03).
 *
 * ⚠ READ THIS BEFORE ADDING ANYTHING TO THIS FILE. REQ-028 is soft-delete
 * forever. `T-INV-012` scans all shipping source for a Prisma delete against
 * any model and fails unless the call site is on an explicit allow-list keyed
 * on FILE **and MODEL**. That allow-list is a ratchet, not a permission: a new
 * entry is a product decision under I-7, not a test fix.
 *
 * ⚠ WHY THIS FILE EXISTS RATHER THAN TWO FUNCTIONS IN `ownerData.ts`. The
 * `T-INV-012` exemption is keyed on file and model, so an exemption granted to
 * `ownerData.ts::title` would silently pre-authorise EVERY future
 * `title.delete(...)` written anywhere in that 1,300-line module — where all
 * forty-odd repository functions live and where the next hard delete would
 * most plausibly be typed. Isolating the two sanctioned deletes in a file that
 * contains nothing else keeps the blast radius the size of the exemption.
 *
 * ⚠ WHY THIS IS NOT A REQ-028 VIOLATION. REQ-028 forbids purging HISTORY.
 * Creates-only undo reverses a CREATION that, once reversed, never
 * legitimately happened. Soft-removing instead would leave the removed view —
 * the historical log REQ-062 exists to make useful — full of several hundred
 * works the owner never chose, after undoing exactly the bad first import that
 * undo exists for. `specs/data-model.md` §8.3 states this reconciliation
 * explicitly; do not "fix" it into a soft delete.
 *
 * ⚠ WHAT IS **NOT** DISCARDED: `extractionCandidate` and `uploadedImage` rows
 * are RETAINED (US-032 AC-3). The batch still happened, its images are still
 * governed by NFR-019's 30-day blob lifecycle, and the owner can still re-run
 * it. Undo reverses the LIST, not the evidence.
 */

import { getPrisma } from './client.js';
import type { Db, OwnerId } from './ownerData.js';

/**
 * ⚠ A local copy of `ownerData.ts`'s private `db()` helper rather than an
 * export of it. Exporting `db()` would hand every module in the codebase a
 * raw, un-owner-scoped Prisma handle — which is exactly the capability the
 * repository pattern exists to withhold, and the one this file must not be the
 * reason anybody gains.
 */
function db(tx?: Db): Db {
  return tx ?? getPrisma();
}

/**
 * Clear every FOREIGN KEY that points at rows the discard is about to remove.
 *
 * ⚠ THIS IS FORCED BY REFERENTIAL INTEGRITY AND IT IS NOT A HISTORY PURGE.
 * `batch_change.title_id`, `batch_change.listing_id` and
 * `extraction_candidate.resolved_title_id` all reference rows SD-03 destroys,
 * and only `service_listing → title` cascades — the other three are plain
 * FKs. Without this the delete fails outright with `fk_change_listing`, which
 * is how it was found: creates-only undo could not run at all.
 *
 * The rows themselves SURVIVE. Provenance keeps its `kind`, `attr` and before
 * /after values, and every retained candidate keeps its text and its
 * disposition (US-032 AC-3) — what is cleared is a pointer to a row that no
 * longer exists, which is the only thing the database will let us keep
 * consistent. Deleting the provenance instead would be a genuine REQ-028
 * violation and would need a third entry on the `T-INV-012` allow-list.
 *
 * ⚠ NOT SCOPED TO THE UNDONE BATCH. A LATER batch can reference a title this
 * one created — it adds a second service to the same work — and its
 * `batch_change` row would keep the FK violated. Scoping this to
 * `batchId: undoneBatch` would pass every single-batch test and fail the first
 * time an owner undid an older import.
 */
export async function detachReferencesToDiscarded(
  ownerId: OwnerId,
  titleIds: readonly string[],
  listingIds: readonly string[],
  tx?: Db,
): Promise<void> {
  const conn = db(tx);

  if (listingIds.length > 0) {
    await conn.batchChange.updateMany({
      where: { ownerId, listingId: { in: [...listingIds] } },
      data: { listingId: null },
    });
  }

  if (titleIds.length > 0) {
    await conn.batchChange.updateMany({
      where: { ownerId, titleId: { in: [...titleIds] } },
      data: { titleId: null },
    });
    await conn.extractionCandidate.updateMany({
      where: { ownerId, resolvedTitleId: { in: [...titleIds] } },
      data: { resolvedTitleId: null },
    });
  }
}

/**
 * Discard titles the batch created, with their listings.
 *
 * ⚠ `deleteMany` with an `ownerId` predicate, NOT `delete`. `delete` requires
 * a unique selector, which for `title` is the id alone — so it cannot be
 * owner-scoped and would happily destroy a row belonging to somebody else if
 * an id ever leaked into a request. Every read in `ownerData.ts` is
 * `findFirst` for the same reason; a delete has strictly more to lose.
 *
 * Listings are removed by the schema's `service_listing → title` cascade,
 * which `specs/data-model.md` §15.7 names as firing from exactly this call
 * site and no other.
 *
 * Returns the number of rows actually removed. The caller MUST report that
 * number rather than the number it asked for: a mismatch means something else
 * removed the row first, and reporting the request as the outcome would tell
 * the owner a title was discarded when it may not have been.
 */
export async function discardCreatedTitles(
  ownerId: OwnerId,
  titleIds: readonly string[],
  tx?: Db,
): Promise<number> {
  if (titleIds.length === 0) return 0;
  const { count } = await db(tx).title.deleteMany({
    where: { ownerId, id: { in: [...titleIds] } },
  });
  return count;
}

/**
 * Discard listings the batch added to titles that already existed.
 *
 * The title itself survives; the caller re-derives its `state` and
 * `sortDateAdded` from whatever listings remain.
 */
export async function discardCreatedListings(
  ownerId: OwnerId,
  listingIds: readonly string[],
  tx?: Db,
): Promise<number> {
  if (listingIds.length === 0) return 0;
  const { count } = await db(tx).serviceListing.deleteMany({
    where: { ownerId, listingId: { in: [...listingIds] } },
  });
  return count;
}
