/**
 * Availability moves — the owner's one-tap answers to an availability change
 * (#397, #410, PRD `A54`, US-063, `specs/api.md` §6.40–§6.44, TASK-264).
 *
 * WHY THIS EXISTS
 * ---------------
 * The lazy availability refresh (PRD §7.4 process 4, widened to Library
 * titles at `A54`) can now TELL the owner that a Library title left one of
 * their services, joined another, or that a waiting title is now streaming.
 * It must never ACT on that (invariant 5): a refresh that removed a badge
 * would be a scheduler-shaped change to list state. These five routes are the
 * acting half, and every one of them is owner-initiated, audited by the
 * listing/intent rows it writes, and reversible:
 *
 *   - §7.4 item 13 `DELETE /api/listings/:listingId` — remove ONE badge.
 *     Soft delete; restorable through the EXISTING `POST /api/listings/:id/
 *     restore`, so no second undo path exists (`T-REAP-014`).
 *   - §7.4 item 14 `POST /api/waiting/:intentId/promote` — "Add to Library".
 *     Manual-add semantics (§6.30), and the waiting intent is satisfied in
 *     the SAME transaction — the second satisfaction path besides capture.
 *   - §7.4 item 15 `POST /api/titles/:titleId/move-to-waiting` — soft-removes
 *     every active listing (into the removed log) and opens a waiting intent.
 *   - §7.4 item 16 `POST /api/titles/:titleId/availability/keep` — records
 *     the dismissal signature, so the marker stays away until the provider
 *     set changes again. Writes no list state at all.
 *   - §7.4 item 17 `POST /api/titles/:titleId/badges` — "Add badge".
 *
 * ⚠ **NO HARD DELETE, NO SUPPRESSION.** Every removal here is `state=
 * 'removed'` (REQ-028, invariant 4) and none of them writes a suppression:
 * leaving a service says nothing about whether the owner wants the work.
 *
 * ⚠ **SUPPRESSION IS CHECKED ON THE WORK IDENTITY (REQ-071, invariant 1)**
 * before any write, with the same 409 and escape hatch as §6.30/§6.32.
 */

import {
  SERVICES,
  deriveSortDateAdded,
  deriveTitleState,
  ulid,
  type Service,
} from '@nextup/domain';
import { type Router } from 'express';

import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import {
  createServiceListing,
  createTitle,
  createWatchIntent,
  findActiveSuppression,
  findServiceListingWithWork,
  findTitle,
  findTitleByWorkIdentity,
  isUniqueViolation,
  listListingsForTitle,
  listWaitingWorkIdentities,
  runInTransaction,
  softDeleteServiceListing,
  updateTitle,
} from '../repository/ownerData.js';
import {
  findWaitingIntent,
  keepTitleAvailabilityChange,
  satisfyWaitingIntents,
} from '../repository/watchIntents.js';
import { isAvailabilitySignature } from '../services/libraryAvailability.js';
import { dateOnlyUtc } from './manualListEdits.js';
import { toIsoDate } from './titles.js';

type Tx = Parameters<typeof runInTransaction>[0] extends (tx: infer T) => unknown ? T : never;

/** The one field every service-taking body carries. Closed vocabulary. */
export function parseServiceBody(body: unknown): Service {
  const service =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)['service']
      : undefined;
  if (typeof service !== 'string' || !(SERVICES as readonly string[]).includes(service)) {
    throw new AppError('VALIDATION_FAILED', 400, '"service" is not one of the permitted values.', {
      field: 'service',
      permitted: [...SERVICES],
    });
  }
  return service as Service;
}

async function refuseIfSuppressed(
  ownerId: Parameters<typeof findActiveSuppression>[0],
  workIdentity: string,
  details: Record<string, unknown>,
): Promise<void> {
  const blocking = await findActiveSuppression(ownerId, workIdentity);
  if (blocking === null) return;
  throw new AppError(
    'WORK_SUPPRESSED',
    409,
    'You marked that title as not interested. Nothing was changed.',
    {
      ...details,
      suppressionId: blocking.id,
      unsuppressHref: `/api/suppressions/${encodeURIComponent(blocking.id)}/unsuppress`,
    },
  );
}

/**
 * Recompute a title's state and earliest date from its listings as they now
 * stand — the same two derive calls, in the same order, as §6.10 restore and
 * §6.32 remove, so no path can disagree with another.
 */
async function rederiveTitle(
  ownerId: Parameters<typeof updateTitle>[0],
  titleId: string,
  tx: Tx,
): Promise<'active' | 'removed'> {
  const after = (await listListingsForTitle(ownerId, titleId, tx)).map(
    (row: { state: string; dateAdded: Date }) => ({
      state: row.state as 'active' | 'removed',
      dateAdded: toIsoDate(row.dateAdded),
    }),
  );
  const state = deriveTitleState(after);
  const nextDate = deriveSortDateAdded(after);
  await updateTitle(
    ownerId,
    titleId,
    { state, sortDateAdded: nextDate === null ? null : new Date(`${nextDate}T00:00:00.000Z`) },
    tx,
  );
  return state;
}

const duplicate = (workIdentity: string, service: Service) => (error: unknown) => {
  // `listing_one_per_service` / `title_one_active_per_work` — filtered unique
  // indexes; only the store sees the race, exactly as in §6.30.
  if (isUniqueViolation(error)) {
    throw new AppError(
      'DUPLICATE_WORK_IDENTITY',
      409,
      'That title is already in your library for that service.',
      { workIdentity, service },
    );
  }
  throw error;
};

export function registerAvailabilityMoveRoutes(router: Router): void {
  /** §6.40 — remove ONE service badge (PRD §7.4 item 13, US-063 AC-3). */
  router.delete('/listings/:listingId', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const listingId = req.params.listingId ?? '';

    const listing = await findServiceListingWithWork(ownerId, listingId);
    if (listing === null) throw new AppError('NOT_FOUND', 404, 'No such listing.');
    await refuseIfSuppressed(ownerId, listing.title.workIdentity, { listingId });
    if (listing.state !== 'active') {
      throw new AppError(
        'TITLE_NOT_ACTIVE',
        409,
        'That badge is not in your library. Nothing was changed.',
        { listingId },
      );
    }

    const removedAt = new Date();
    const titleState = await runInTransaction(async (tx) => {
      await softDeleteServiceListing(
        ownerId,
        listingId,
        // Both NULL — "Removed by you" in the removed log (§6.9).
        { removedByBatchId: null, removedByGroupId: null, removedAt },
        tx,
      );
      // The last badge going takes the row with it — the same outcome as a
      // whole-title remove, derived rather than assigned.
      return rederiveTitle(ownerId, listing.titleId, tx);
    });

    res.status(200).json({
      listingId,
      titleId: listing.titleId,
      service: listing.service,
      titleState,
      removedAt: removedAt.toISOString(),
    });
  });

  /** §6.44 — "Add badge" for a service it is now also on (§7.4 item 17). */
  router.post('/titles/:titleId/badges', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const titleId = req.params.titleId ?? '';

    // T-SEC-002g: a foreign id is a 404 before the body is even read.
    const title = await findTitle(ownerId, titleId);
    if (title === null) throw new AppError('NOT_FOUND', 404, 'No such title.');
    const service = parseServiceBody(req.body);
    await refuseIfSuppressed(ownerId, title.workIdentity, { titleId });
    if (title.state !== 'active') {
      throw new AppError(
        'TITLE_NOT_ACTIVE',
        409,
        'That title is not in your library. Nothing was changed.',
        { titleId },
      );
    }

    const today = dateOnlyUtc(new Date());
    const listingId = ulid();
    await runInTransaction(async (tx) => {
      await createServiceListing(
        ownerId,
        { listingId, titleId, service, state: 'active', dateAdded: today, createdByBatchId: null },
        tx,
      );
      // Invariant 6: the EARLIEST date stays, so a new badge never reorders.
      if (title.sortDateAdded === null || title.sortDateAdded > today) {
        await updateTitle(ownerId, titleId, { sortDateAdded: today }, tx);
      }
    }).catch(duplicate(title.workIdentity, service));

    res.status(201).json({ titleId, listingId, service, dateAdded: toIsoDate(today) });
  });

  /** §6.41 — "Add to Library" from Waiting (§7.4 item 14, US-063 AC-4). */
  router.post('/waiting/:intentId/promote', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const intentId = req.params.intentId ?? '';

    const intent = await findWaitingIntent(ownerId, intentId);
    if (intent === null) throw new AppError('NOT_FOUND', 404, 'No such waiting title.');
    const service = parseServiceBody(req.body);
    const workIdentity = intent.workIdentity;
    await refuseIfSuppressed(ownerId, workIdentity, { intentId });

    const now = new Date();
    const today = dateOnlyUtc(now);
    const result = await runInTransaction(async (tx) => {
      // The §6.30 rule, transcribed: a new title only when the work has none
      // or its newest is not active. A waiting work's title is stored
      // `removed` with no listing, so this normally creates a NEW row dated
      // today — reappearance is a brand-new row (invariant 7).
      const existing = await findTitleByWorkIdentity(ownerId, workIdentity, tx);
      let titleId: string;
      let titleWasCreated: boolean;
      if (existing === null || existing.state !== 'active') {
        const source = intent.title;
        titleId = ulid();
        titleWasCreated = true;
        await createTitle(
          ownerId,
          {
            id: titleId,
            workIdentity,
            state: 'active',
            matchState: 'matched',
            tmdbId: source.tmdbId,
            tmdbMediaType: source.tmdbMediaType,
            tmdbName: source.tmdbName,
            tmdbReleaseYear: source.tmdbReleaseYear,
            tmdbRuntimeMinutes: source.tmdbRuntimeMinutes,
            tmdbGenres: source.tmdbGenres,
            tmdbComedyShow: source.tmdbComedyShow,
            tmdbPosterPath: source.tmdbPosterPath,
            tmdbFetchedAt: source.tmdbFetchedAt,
            imdbId: source.imdbId,
            editionLabels: source.editionLabels,
            // The intent's last-known answer comes along, so the new row does
            // not need a fresh lookup to show where it streams.
            availableOn: intent.availableOn,
            rentOn: intent.rentOn,
            availabilityCheckedAt: intent.availabilityCheckedAt,
            availabilityRegion: intent.availabilityRegion,
            sortDateAdded: today,
            createdByBatchId: null,
          },
          tx,
        );
      } else {
        titleId = existing.id;
        titleWasCreated = false;
        if (existing.sortDateAdded === null || existing.sortDateAdded > today) {
          await updateTitle(ownerId, titleId, { sortDateAdded: today }, tx);
        }
      }
      const listingId = ulid();
      await createServiceListing(
        ownerId,
        { listingId, titleId, service, state: 'active', dateAdded: today, createdByBatchId: null },
        tx,
      );
      // The waiting intent ends HERE, in the same transaction as the listing
      // that satisfies it — never half-promoted.
      await satisfyWaitingIntents(ownerId, [workIdentity], now, tx);
      return { titleId, listingId, titleWasCreated };
    }).catch(duplicate(workIdentity, service));

    res.status(201).json({
      intentId,
      titleId: result.titleId,
      listingId: result.listingId,
      service,
      dateAdded: toIsoDate(today),
      titleWasCreated: result.titleWasCreated,
    });
  });

  /** §6.42 — "Move to Waiting" (§7.4 item 15, US-063 AC-5). */
  router.post('/titles/:titleId/move-to-waiting', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const titleId = req.params.titleId ?? '';

    const title = await findTitle(ownerId, titleId);
    if (title === null) throw new AppError('NOT_FOUND', 404, 'No such title.');
    await refuseIfSuppressed(ownerId, title.workIdentity, { titleId });
    const active = (await listListingsForTitle(ownerId, titleId)).filter(
      (row: { state: string }) => row.state === 'active',
    );
    if (active.length === 0) {
      throw new AppError(
        'TITLE_NOT_ACTIVE',
        409,
        'That title is not in your library. Nothing was changed.',
        { titleId },
      );
    }

    const removedAt = new Date();
    const intentId = await runInTransaction(async (tx) => {
      for (const listing of active) {
        await softDeleteServiceListing(
          ownerId,
          listing.listingId,
          { removedByBatchId: null, removedByGroupId: null, removedAt },
          tx,
        );
      }
      await rederiveTitle(ownerId, titleId, tx);
      // One waiting intent per work: a work already waiting keeps its intent.
      if ((await listWaitingWorkIdentities(ownerId, tx)).has(title.workIdentity)) return null;
      const id = ulid();
      await createWatchIntent(
        ownerId,
        {
          id,
          titleId,
          workIdentity: title.workIdentity,
          sourceBatchId: null,
          // ⚠ `ck_intent_source` is closed and widening it needs a DROP
          // CONSTRAINT that T-MIG-001 forbids, so a moved title is a
          // `search`-sourced intent marked by `moved_from_library_at`
          // (`ck_intent_moved_from_library_search`, migration 0019).
          discoverySource: 'search',
          state: 'waiting',
          availableOn: title.availableOn,
          rentOn: title.rentOn,
          availabilityCheckedAt: title.availabilityCheckedAt,
          availabilityRegion: title.availabilityRegion,
          movedFromLibraryAt: removedAt,
        },
        tx,
      );
      return id;
    });

    res.status(200).json({
      titleId,
      intentId,
      removedListingIds: active.map((row: { listingId: string }) => row.listingId),
      removedAt: removedAt.toISOString(),
    });
  });

  /** §6.43 — "Keep": dismiss this exact change (§7.4 item 16, US-063 AC-6). */
  router.post('/titles/:titleId/availability/keep', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const titleId = req.params.titleId ?? '';
    const title = await findTitle(ownerId, titleId);
    if (title === null) throw new AppError('NOT_FOUND', 404, 'No such title.');
    const body = req.body as unknown;
    const signature =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)['signature']
        : undefined;
    if (!isAvailabilitySignature(signature)) {
      throw new AppError('VALIDATION_FAILED', 400, '"signature" is not a valid change signature.', {
        field: 'signature',
      });
    }
    await keepTitleAvailabilityChange(ownerId, titleId, signature);
    res.status(200).json({ titleId, keptSignature: signature });
  });
}
