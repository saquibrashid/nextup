/**
 * Manual list edits — the owner adds or removes a title WITHOUT an upload
 * batch (`specs/api.md` §6.30/§6.32, US-047, US-048, TASK-207).
 *
 * WHY THIS EXISTS
 * ---------------
 * Extraction has a measured, knowingly-accepted false-title rate (§9.2). When
 * a wrapped caption splits "SOL LEVANTE" into a second phantom row, the owner
 * had exactly two remedies and neither fitted:
 *
 *   - **Not interested** (§6.6) suppresses the CANONICAL WORK for ever
 *     (REQ-071, product invariant 1). Used on a phantom it writes a permanent
 *     suppression against a real work the owner never rejected, so if that
 *     film ever legitimately appears it is silently hidden.
 *   - **Fix match** (§6.5) re-points a row at a different work. Used on a
 *     phantom it produces a second, correct-looking row for a work already on
 *     the list.
 *
 * A false extraction is a THIRD thing: a row that should never have existed.
 * §6.32 removes it without asserting anything about the work.
 *
 * ⚠ **"HARD DELETE" IS USER-FACING WORDING ONLY.** Nothing here deletes a row.
 * §6.32 is a soft delete — `state='removed'`, retained for ever (REQ-028,
 * product invariant 4) — and it is what makes the removal visible in the
 * removed log and reversible through the EXISTING `POST /api/listings/:id/
 * restore` (§6.10). No new undo path was built, because building one would
 * have created a second way to bring a listing back and `T-REAP-014` asserts
 * there are exactly two. `T-MANUAL-009` asserts neither handler calls
 * `prisma.*.delete()`.
 *
 * ⚠ **§6.32 WRITES NO SUPPRESSION, AND THAT IS THE WHOLE DISTINCTION.**
 * Removing a title says "this is not on my list"; the work may legitimately
 * return in a later capture and will then appear as a brand-new row dated
 * today (product invariant 7, L1/A33). Suppression says "never show me this
 * work again". Conflating them is the exact defect this route exists to fix,
 * so `T-MANUAL-008` asserts the suppression table is untouched by a removal.
 */

import {
  type MediaType,
  type Service,
  MEDIA_TYPES,
  SERVICES,
  deriveSortDateAdded,
  deriveTitleState,
  ulid,
  workIdentityForTmdb,
} from '@nextup/domain';
import { type Router } from 'express';

import { type TmdbClient, TmdbWorkNotFoundError } from '../clients/tmdbClient.js';
import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import {
  createServiceListing,
  createTitle,
  findActiveSuppression,
  findTitle,
  findTitleByWorkIdentity,
  isUniqueViolation,
  listListingsForTitle,
  runInTransaction,
  softDeleteServiceListing,
  updateTitle,
} from '../repository/ownerData.js';
import { tmdbUnavailableAppError } from './tmdb.js';
import { toIsoDate } from './titles.js';

export interface AddTitleRequest {
  tmdbId: number;
  mediaType: MediaType;
  service: Service;
}

export type AddTitleParseResult =
  | { ok: true; value: AddTitleRequest }
  | { ok: false; message: string; details: Record<string, unknown> };

/**
 * Parses one §6.30 body.
 *
 * ⚠ THE ACCEPTED FIELD SET IS CLOSED, and the omissions are deliberate:
 *
 *   - **No `name`.** The display name is read from TMDB, never supplied
 *     (SD-05, mirroring §6.20). A caller-supplied name would let the list hold
 *     a title TMDB cannot resolve, which renders permanently blank.
 *   - **No `dateAdded`.** Editing the date-added value is deferred to v1.1
 *     (NG-8, REQ-059) and `service_listing.date_added` is WRITE-ONCE
 *     (`T-INV-006`). The date is today, always.
 *
 * Unknown fields are ignored rather than refused, matching every other body
 * parser here — but they are ignored SILENTLY only because none of them can
 * mean anything: accepting `dateAdded` and dropping it would be the dangerous
 * case, and it is not accepted, it is simply not read.
 */
export function parseAddTitleRequest(body: unknown): AddTitleParseResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, message: 'That request body could not be read as an object.', details: {} };
  }
  const record = body as Record<string, unknown>;

  const tmdbId = record['tmdbId'];
  if (typeof tmdbId !== 'number' || !Number.isInteger(tmdbId) || tmdbId <= 0) {
    return {
      ok: false,
      message: '"tmdbId" must be a positive integer.',
      details: { field: 'tmdbId' },
    };
  }

  const mediaType = record['mediaType'];
  if (typeof mediaType !== 'string' || !(MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    return {
      ok: false,
      message: '"mediaType" is not one of the permitted values.',
      details: { field: 'mediaType', permitted: [...MEDIA_TYPES] },
    };
  }

  const service = record['service'];
  if (typeof service !== 'string' || !(SERVICES as readonly string[]).includes(service)) {
    return {
      ok: false,
      message: '"service" is not one of the permitted values.',
      details: { field: 'service', permitted: [...SERVICES] },
    };
  }

  return {
    ok: true,
    value: {
      tmdbId,
      mediaType: mediaType as MediaType,
      service: service as Service,
    },
  };
}

/** Midnight UTC for the `@db.Date` column — the same shape `batchClose` writes. */
export function dateOnlyUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
}

export function registerManualListEditRoutes(router: Router, getClient: () => TmdbClient): void {
  /**
   * §6.30 `POST /api/titles` (US-047) — put a work on the list by hand.
   *
   * The gate order is the SAME as §6.5 fix-match, and for the same reasons:
   * SUPPRESSION first, then TMDB. Suppression needs no network, so a TMDB
   * outage must not stop it answering, and "you told me to stop showing you
   * this" is the reason the owner needs to hear first.
   */
  router.post('/titles', async (req, res) => {
    const ownerId = requireOwnerId(req);

    const parsed = parseAddTitleRequest(req.body);
    if (!parsed.ok) {
      throw new AppError('VALIDATION_FAILED', 400, parsed.message, parsed.details);
    }
    const { tmdbId, mediaType, service } = parsed.value;
    const workIdentity = workIdentityForTmdb(mediaType, tmdbId);

    // GATE 1 — suppression, on WORK IDENTITY (REQ-071).
    //
    // ⚠ §6.20 calls manual entry "the most direct back door there is", and a
    // standalone add is the same door with the batch removed. Without this
    // gate the owner could re-admit a suppressed work by typing its name,
    // while `/not-interested` still lists it — two screens disagreeing about
    // one work, with no way to tell which is right.
    const blocking = await findActiveSuppression(ownerId, workIdentity);
    if (blocking !== null) {
      throw new AppError(
        'WORK_SUPPRESSED',
        409,
        "You marked that title as not interested. Un-suppress it first if you'd like it back.",
        {
          workIdentity,
          suppressionId: blocking.id,
          unsuppressHref: `/api/suppressions/${encodeURIComponent(blocking.id)}/unsuppress`,
        },
      );
    }

    // GATE 2 — TMDB. Last, because it is the only slow or unavailable one, and
    // because nothing is written on either failure: a work TMDB does not hold
    // has no name, no poster and no metadata, and would sit on the list
    // permanently blank (the §6.20 reasoning, unchanged).
    let detail;
    try {
      detail = await getClient().getWork(mediaType, tmdbId);
    } catch (error) {
      if (error instanceof TmdbWorkNotFoundError) {
        throw new AppError('TMDB_WORK_NOT_FOUND', 404, 'TMDB has no such work.', {
          tmdbId,
          mediaType,
        });
      }
      const mapped = tmdbUnavailableAppError(error);
      if (mapped) throw mapped;
      throw error;
    }

    const today = dateOnlyUtc(new Date());

    // ⚠ NEW TITLE vs NEW LISTING ON AN EXISTING TITLE — this rule is NOT
    // re-derived here. It is `batchClose`'s, transcribed: `findTitleByWork-
    // Identity` (ANY state), and a new title only when there is none or it is
    // not active. REQ-005 is one row per WORK with a badge per service, so a
    // work already on Netflix that the owner adds on Max must gain a BADGE,
    // never a second row. A parallel rule here could diverge from that and
    // from the earliest-date rule below, and the divergence would show up as
    // duplicate rows the owner cannot merge.
    const result = await runInTransaction(async (tx) => {
      const existing = await findTitleByWorkIdentity(ownerId, workIdentity, tx);
      let titleId: string;
      let titleWasCreated: boolean;

      if (existing === null || existing.state !== 'active') {
        titleId = ulid();
        titleWasCreated = true;
        await createTitle(
          ownerId,
          {
            id: titleId,
            workIdentity,
            state: 'active',
            matchState: 'matched',
            tmdbId: detail.tmdbId,
            tmdbMediaType: detail.mediaType,
            tmdbName: detail.name,
            tmdbReleaseYear: detail.releaseYear,
            tmdbRuntimeMinutes: detail.runtimeMinutes,
            tmdbGenres: JSON.stringify(detail.genres),
            tmdbPosterPath: detail.posterPath,
            tmdbFetchedAt: new Date(),
            imdbId: detail.imdbId,
            sortDateAdded: today,
            // ⚠ NULL, never a synthetic batch id — migration
            // `0007_manual_list_edits` exists for exactly this value.
            createdByBatchId: null,
          },
          tx,
        );
      } else {
        titleId = existing.id;
        titleWasCreated = false;
        // Product invariant 6 — the title-level date is the EARLIEST across
        // its listings, so adding a second service today must NOT reorder a
        // row the owner has held since April. Transcribed from `batchClose`.
        if (existing.sortDateAdded === null || existing.sortDateAdded > today) {
          await updateTitle(ownerId, titleId, { sortDateAdded: today }, tx);
        }
      }

      const listingId = ulid();
      await createServiceListing(
        ownerId,
        {
          listingId,
          titleId,
          service,
          state: 'active',
          dateAdded: today,
          createdByBatchId: null,
        },
        tx,
      );

      return { titleId, listingId, titleWasCreated };
    }).catch((error: unknown) => {
      // ⚠ `listing_one_per_service` is a FILTERED unique index on
      // `(owner, title, service) WHERE state='active'`. It fires when the work
      // is already on this service — which is a 409 the owner can act on, not
      // the 500 an unmapped store error would produce. Detected from the store
      // rather than pre-checked with a SELECT because only the index sees the
      // race between two adds of the same work.
      //
      // ⚠ A REMOVED listing for the same (title, service) does NOT collide:
      // the index is filtered to `state='active'`. The owner therefore ends up
      // with a removed listing and a new active one for the same service,
      // which is correct — the removed view is a LOG (product invariant 7) and
      // both entries are true. A later `/restore` of the old one answers
      // `DUPLICATE_WORK_IDENTITY` (§6.10), which is confirmable.
      if (isUniqueViolation(error)) {
        throw new AppError(
          'DUPLICATE_WORK_IDENTITY',
          409,
          'That title is already on your list for that service.',
          { workIdentity, service },
        );
      }
      throw error;
    });

    res.status(201).json({
      titleId: result.titleId,
      listingId: result.listingId,
      workIdentity,
      service,
      name: detail.name,
      dateAdded: toIsoDate(today),
      titleWasCreated: result.titleWasCreated,
    });
  });

  /**
   * §6.32 `DELETE /api/titles/:titleId` (US-048) — take a title off the list.
   *
   * WHOLE ROW, EVERY SERVICE. The analogue is US-027 AC-5: suppressing a
   * two-badge title removes the whole row, because the row IS the unit the
   * owner sees and acts on. A per-badge delete would need a second affordance
   * on a control the owner reaches by tapping one row, and §6.9 is already
   * "one item per removed listing", so a two-badge delete correctly writes two
   * log entries, each independently restorable.
   */
  router.delete('/titles/:titleId', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const titleId = req.params.titleId ?? '';

    // Owner-scoped, so a foreign id is indistinguishable from a missing one
    // and must stay that way — 404, never 403 (`T-SEC-002d`).
    const title = await findTitle(ownerId, titleId);
    if (title === null) {
      throw new AppError('NOT_FOUND', 404, 'No such title.');
    }

    const before = await listListingsForTitle(ownerId, titleId);
    const active = before.filter((row: { state: string }) => row.state === 'active');

    // ⚠ A SUPPRESSED work is refused even though its listings may still be
    // `active`. Suppression is a SEPARATE table evaluated on the canonical work
    // and sitting ABOVE listing state (PRD §7.1) — `title.state` only ever
    // holds `active` or `removed` (`ck_title_state`), so a state check alone
    // would silently let this through.
    //
    // Removing a suppressed work's listings would be invisible until
    // un-suppression, and would then silently change WHERE the work lands:
    // US-029 AC-3 returns a suppressed work with active listings to the
    // combined list, AC-4 returns one with only removed listings to the removed
    // view. A hidden edit that redirects a later restore is precisely the class
    // of silent loss REQ-028 exists to prevent.
    //
    // Named before the not-active refusal, and for §6.10's reason: the escape
    // hatch (un-suppress first) is the thing the owner can act on.
    const suppression = await findActiveSuppression(
      ownerId,
      (title as { workIdentity: string }).workIdentity,
    );
    if (suppression !== null) {
      throw new AppError(
        'WORK_SUPPRESSED',
        409,
        "You marked that title as not interested, so it isn't on your list. Nothing was changed.",
        {
          titleId,
          suppressionId: suppression.id,
          unsuppressHref: `/api/suppressions/${encodeURIComponent(suppression.id)}/unsuppress`,
        },
      );
    }

    if (active.length === 0) {
      // Not a 404: the title exists and the owner may well be looking at it in
      // the removed view. A 404 there would read as data loss.
      throw new AppError(
        'TITLE_NOT_ACTIVE',
        409,
        'That title is not on your list. Nothing was changed.',
        { titleId },
      );
    }

    const removedAt = new Date();

    await runInTransaction(async (tx) => {
      for (const listing of active) {
        await softDeleteServiceListing(
          ownerId,
          listing.listingId,
          // Both NULL: no batch removed this and no removal group holds it.
          // §6.9 reads exactly this to say "Removed by you" (`removedBy`).
          { removedByBatchId: null, removedByGroupId: null, removedAt },
          tx,
        );
      }

      // Recomputed from the listings as they now stand — the same two derive
      // calls, in the same order, as the §6.10 restore path. Deriving rather
      // than assigning `'removed'` directly is what keeps the two paths from
      // disagreeing when a title has a listing this handler did not touch.
      const after = (await listListingsForTitle(ownerId, titleId, tx)).map(
        (row: { state: string; dateAdded: Date }) => ({
          state: row.state as 'active' | 'removed',
          dateAdded: toIsoDate(row.dateAdded),
        }),
      );
      const nextDate = deriveSortDateAdded(after);
      await updateTitle(
        ownerId,
        titleId,
        {
          state: deriveTitleState(after),
          sortDateAdded: nextDate === null ? null : new Date(`${nextDate}T00:00:00.000Z`),
        },
        tx,
      );
    });

    res.status(200).json({
      titleId,
      state: 'removed',
      removedListingIds: active.map((row: { listingId: string }) => row.listingId),
      removedAt: removedAt.toISOString(),
      // Named so the client copy can promise it without re-deriving it: a
      // removal asserts nothing about the work, so it CAN come back.
      suppressed: false,
    });
  });
}
