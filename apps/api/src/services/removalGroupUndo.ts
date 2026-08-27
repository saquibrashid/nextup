/**
 * TASK-090 — undo a confirmed removal group (`specs/api.md` §6.26, US-017,
 * REQ-056).
 *
 * ⚠ **UNDO IS THE FEATURE THAT MAKES CONFIRMING A REMOVAL SAFE TO PRESS.**
 * Everything else in the removal flow is a decision the owner is asked to make
 * carefully; this is the one that lets them make it quickly. So the failure
 * that matters here is not "undo did not work" — that is visible — but "undo
 * reported success and part of the group did not come back". Every guard below
 * exists to make that outcome impossible rather than unlikely.
 *
 * ⚠ **SUPPRESSION WINS OVER RESTORE (AC-4), AND IT MUST BE REPORTED.** If the
 * owner marked one of the removed works "not interested" since confirming, that
 * is a NEWER decision than the removal being undone, and quietly returning the
 * work to the list would reverse a decision the owner never asked to reverse.
 * Held-back items are named, with the un-suppress link, so the outcome is
 * legible rather than mysterious.
 *
 * ⚠ **THE GROUP IS ALL-OR-NOTHING (AC-6).** One transaction. A guarded write
 * that touches zero rows aborts the whole thing with `PARTIAL_FAILURE_PREVENTED`
 * and `applied: false`, because a half-reversed group cannot be reversed again
 * as a group and the owner has no way to see which half landed.
 *
 * ⚠ **`dateAdded` IS NEVER WRITTEN** (AC-2). See `restoreServiceListing`.
 */

import { deriveSortDateAdded, deriveTitleState, suppressionIdFor } from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import {
  findActiveSuppressedWorks,
  findRemovalGroup,
  listListingsForTitle,
  listListingsInRemovalGroup,
  markRemovalGroupUndone,
  restoreServiceListing,
  runInTransaction,
  updateTitle,
  type Db,
  type OwnerId,
} from '../repository/ownerData.js';

/** `specs/api.md` §6.26 — the only reason an item is ever held back in v1. */
export const HELD_BACK_WORK_SUPPRESSED = 'work-suppressed';

export interface HeldBackItem {
  listingId: string;
  reason: typeof HELD_BACK_WORK_SUPPRESSED;
  name: string;
  unsuppressHref: string;
}

export interface UndoRemovalGroupResult {
  groupId: string;
  restoredListingIds: string[];
  heldBack: HeldBackItem[];
}

interface GroupListing {
  listingId: string;
  titleId: string;
  state: string;
  title: { workIdentity: string; tmdbName: string | null; rawExtractedText: string | null };
}

/** `YYYY-MM-DD` from a `date` column, which arrives as UTC midnight. */
function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * The held-back entry for one suppressed work.
 *
 * The name falls back to the raw extracted text for the same reason the list
 * does: a held-back item the owner cannot identify tells them nothing, and an
 * unmatched title is exactly the kind that ends up removed.
 */
export function toHeldBack(listing: GroupListing): HeldBackItem {
  return {
    listingId: listing.listingId,
    reason: HELD_BACK_WORK_SUPPRESSED,
    name: listing.title.tmdbName ?? listing.title.rawExtractedText ?? '',
    // The same shape `suppressions.ts` issues, built from the same id function,
    // so the remedy link is one implementation rather than two strings that
    // agree today.
    unsuppressHref: `/api/suppressions/${encodeURIComponent(
      suppressionIdFor(listing.title.workIdentity),
    )}/unsuppress`,
  };
}

/**
 * Recompute `state` and `sortDateAdded` for the titles this undo touched.
 *
 * ⚠ Both are DERIVED (invariant I-4) and must equal what `derive.ts` computes.
 * Restoring a listing without re-deriving leaves the title `removed` while one
 * of its listings is `active` — the row is back on the service and still
 * missing from the combined list, which is AC-2 failing in the one way the
 * owner cannot see from the response.
 */
async function rederive(ownerId: OwnerId, titleIds: readonly string[], tx: Db): Promise<void> {
  for (const titleId of titleIds) {
    const listings = (await listListingsForTitle(ownerId, titleId, tx)).map((row) => ({
      state: row.state as 'active' | 'removed',
      dateAdded: toIsoDate(row.dateAdded),
    }));
    const nextDate = deriveSortDateAdded(listings);
    await updateTitle(
      ownerId,
      titleId,
      {
        state: deriveTitleState(listings),
        // Widened at midnight UTC, exactly as `batchClose.ts` does. The bare
        // string would be coerced by the driver in a local timezone and could
        // shift the row by a day.
        sortDateAdded: nextDate === null ? null : new Date(`${nextDate}T00:00:00.000Z`),
      },
      tx,
    );
  }
}

export async function undoRemovalGroup(
  ownerId: OwnerId,
  groupId: string,
): Promise<UndoRemovalGroupResult> {
  const group = await findRemovalGroup(ownerId, groupId);
  // 404, never 403, for a group belonging to someone else: `findRemovalGroup`
  // is owner-scoped, so a foreign id and a missing id arrive here as the same
  // `null` and cannot be told apart (`T-SEC-002`).
  if (group === null) {
    throw new AppError('NOT_FOUND', 404, 'No such removal group.');
  }
  if (group.undoneAt !== null) {
    throw new AppError('GROUP_ALREADY_REVERSED', 409, 'That undo has already been applied.', {
      groupId,
      undoneAt: group.undoneAt.toISOString(),
    });
  }

  const listings = (await listListingsInRemovalGroup(ownerId, groupId)) as GroupListing[];
  const suppressed = await findActiveSuppressedWorks(ownerId, [
    ...new Set(listings.map((l) => l.title.workIdentity)),
  ]);

  const restoredListingIds: string[] = [];
  const heldBack: HeldBackItem[] = [];

  await runInTransaction(async (tx) => {
    const touchedTitles = new Set<string>();

    for (const listing of listings) {
      if (suppressed.has(listing.title.workIdentity)) {
        heldBack.push(toHeldBack(listing));
        continue;
      }

      const changed = await restoreServiceListing(ownerId, listing.listingId, tx);
      // ⚠ Zero rows means the listing stopped being `removed` between the read
      // and this write — a per-listing restore (§6.10) landing concurrently, or
      // a double submit. Throwing rolls the WHOLE undo back: a group is
      // reversed in full or not at all, because a half-reversed group cannot be
      // reversed again as a group and the owner cannot see which half landed
      // (AC-6).
      if (changed.count !== 1) {
        throw new AppError(
          'PARTIAL_FAILURE_PREVENTED',
          500,
          'One of those titles changed while you were undoing. Nothing was changed.',
          { groupId, listingId: listing.listingId, applied: false },
        );
      }

      restoredListingIds.push(listing.listingId);
      touchedTitles.add(listing.titleId);
    }

    await rederive(ownerId, [...touchedTitles], tx);

    // ⚠ The group is marked reversed even when EVERY item was held back. The
    // owner asked for the undo and got an answer; AC-5 is unconditional, and a
    // group that stayed offerable would invite the same press to produce the
    // same refusal for ever. The escape hatch after un-suppressing is the
    // per-listing restore in §6.10, which is the documented way to bring back
    // an old removal (US-025) — not a second undo of a group already answered.
    const marked = await markRemovalGroupUndone(ownerId, groupId, new Date(), tx);
    if (marked.count !== 1) {
      // Lost the race with a concurrent undo of the same group. Rolling back is
      // the only safe outcome: the other request is restoring the same
      // listings, and letting both proceed would double-apply the rederive.
      throw new AppError('GROUP_ALREADY_REVERSED', 409, 'That undo has already been applied.', {
        groupId,
      });
    }
  });

  return { groupId, restoredListingIds, heldBack };
}
