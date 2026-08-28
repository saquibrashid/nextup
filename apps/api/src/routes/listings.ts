/**
 * `POST /api/listings/:listingId/restore` — restore a removed listing
 * (`specs/api.md` §6.10, US-025, TASK-098).
 *
 * RESTORE IS AN EXPLICIT OWNER ACTION, NEVER AUTOMATIC (product invariant 7).
 * T-REAP-014 asserts `restoreServiceListing` has exactly two call sites: the
 * removal-group undo and this route.
 *
 * PRE-CONDITION ORDER: existence → LISTING_NOT_REMOVED, then suppression →
 * WORK_SUPPRESSED, then duplicate → DUPLICATE_WORK_IDENTITY. Suppression is
 * before duplicate so the escape hatch (un-suppress first) is named clearly.
 *
 * confirmDuplicate path: the listing is restored to its own title and the
 * title's duplicateAckSeq is set to the title's own id, the same technique
 * fix-match uses. This gives the restored title a distinct value so the
 * filtered unique index title_one_active_per_work (owner, work_identity,
 * dup_ack_seq) WHERE state='active' does not fire with the existing active
 * title whose dup_ack_seq=''.
 *
 * 404 not 403 for another owner's listing (security spec §2).
 */

import { type Router } from 'express';

import { deriveSortDateAdded, deriveTitleState } from '@nextup/domain';
import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import {
  findActiveSuppression,
  findActiveTitleByWorkIdentity,
  findServiceListing,
  findServiceListingWithWork,
  listListingsForTitle,
  restoreServiceListing,
  updateTitle,
} from '../repository/ownerData.js';
import { toIsoDate } from './titles.js';

interface RestoreBody {
  confirmDuplicate?: unknown;
}

export function registerListingRoutes(router: Router): void {
  router.post('/listings/:listingId/restore', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const { listingId } = req.params as { listingId: string };
    const body = ((req.body as RestoreBody | undefined) ?? {}) as RestoreBody;
    const confirmDuplicate = body.confirmDuplicate === true;

    // Fetch listing + workIdentity in one read.
    const listing = await findServiceListingWithWork(ownerId, listingId);
    if (listing === null) {
      throw new AppError('NOT_FOUND', 404, 'No such listing.');
    }
    if (listing.state !== 'removed') {
      throw new AppError(
        'LISTING_NOT_REMOVED',
        409,
        'That listing is already active. Nothing was changed.',
      );
    }

    const workIdentity = listing.title.workIdentity;

    const suppression = await findActiveSuppression(ownerId, workIdentity);
    if (suppression !== null) {
      throw new AppError(
        'WORK_SUPPRESSED',
        409,
        'That work is marked as not interested. Un-suppress it first, then restore.',
        {
          unsuppressHref: `/api/suppressions/${encodeURIComponent(suppression.id)}/unsuppress`,
        },
      );
    }

    const existingActive = await findActiveTitleByWorkIdentity(ownerId, workIdentity);
    if (existingActive !== null && !confirmDuplicate) {
      throw new AppError(
        'DUPLICATE_WORK_IDENTITY',
        409,
        'A newer version of that title is already on your list. Confirm to add this listing back anyway.',
        {
          existingTitleId: existingActive.id,
        },
      );
    }

    // Both paths (normal and confirmDuplicate) restore the listing to its
    // original title. When confirmDuplicate:true, we additionally set
    // duplicateAckSeq = listing.titleId, which is the same technique fix-match
    // uses: it gives this title a distinct value so the filtered unique index
    // title_one_active_per_work — keyed on (owner, work_identity, dup_ack_seq)
    // — does not fire with the existing active title that has dup_ack_seq=''.
    await restoreServiceListing(ownerId, listingId);

    const siblings = (await listListingsForTitle(ownerId, listing.titleId)).map(
      (row: { state: string; dateAdded: Date }) => ({
        state: row.state as 'active' | 'removed',
        dateAdded: toIsoDate(row.dateAdded),
      }),
    );
    const nextDate = deriveSortDateAdded(siblings);
    await updateTitle(ownerId, listing.titleId, {
      state: deriveTitleState(siblings),
      sortDateAdded: nextDate === null ? null : new Date(`${nextDate}T00:00:00.000Z`),
      ...(existingActive !== null ? { duplicateAckSeq: listing.titleId } : {}),
    });

    const restored = await findServiceListing(ownerId, listingId);
    if (restored === null)
      throw new AppError('INTERNAL_ERROR', 500, 'Restore succeeded but listing disappeared.');

    const titleAfter = await findActiveTitleByWorkIdentity(ownerId, workIdentity);

    res.status(200).json({
      listingId: restored.listingId,
      titleId: restored.titleId,
      state: restored.state,
      dateAdded: toIsoDate(restored.dateAdded),
      titleState: titleAfter?.state ?? 'removed',
      sortDateAdded:
        titleAfter?.sortDateAdded !== null && titleAfter?.sortDateAdded !== undefined
          ? toIsoDate(titleAfter.sortDateAdded)
          : null,
    });
  });
}
