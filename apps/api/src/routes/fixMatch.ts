/**
 * `POST /api/titles/:titleId/fix-match` — the owner corrects a wrong match
 * (`specs/api.md` §6.5, `specs/data-model.md` §6.3, US-030, TASK-109/TASK-110).
 *
 * ⚠ **NOTHING IS REMOVED AND NOTHING IS RE-CREATED.** The obvious
 * implementation — delete the wrongly-matched title and insert a correct one —
 * silently destroys everything the owner cannot recover: the dates the work
 * was saved on each service, and therefore its position in the default sort
 * (product invariant 6). This handler UPDATES one row's identity columns and
 * touches no listing at all. `T-FIX-002` asserts the title id, every
 * `listingId` and every `dateAdded` are byte-identical across the call, and
 * `T-FIX-003` asserts the sort position is unchanged.
 *
 * ⚠ **`sortDateAdded` IS NOT RECOMPUTED HERE.** It is derived from the
 * listings' `dateAdded` (REQ-038) and no `dateAdded` changes, so recomputing
 * it can only produce the same value or a wrong one. Assigning it at all would
 * put a write to an ordering column on the fix-match path, where a later
 * refactor could quietly make the row jump.
 *
 * ⚠ **NO `batch_change` ROW IS WRITTEN.** Fix-match is an owner decision made
 * OUTSIDE a batch, and US-031 AC-5 requires such decisions to be invisible to
 * batch provenance so a batch undo never reverses something the owner did
 * afterwards — see the header of `packages/domain/src/provenance.ts`.
 * (`specs/data-model.md` §6.3 step 7 asks for a `batch_change` row with
 * `batchId: null`; `batch_change.batch_id` is `NOT NULL` with a foreign key to
 * `upload_batch`, so that step is not implementable as written and contradicts
 * the provenance module it would feed. Recorded as a finding; the provenance
 * module's reading is the one implemented.)
 *
 * The gate order is load-bearing and is the same as the review-page correction
 * in `batchCandidates.ts`: SUPPRESSION first, then DUPLICATE, then TMDB.
 * Reversed, an owner fix-matching onto a work they marked "not interested"
 * would be told it was a duplicate — true, but not the reason they cannot do
 * it — and the two gates need no network, so a TMDB outage must not stop
 * either of them answering.
 */

import { type MediaType, MEDIA_TYPES, suppressionIdFor, workIdentityForTmdb } from '@nextup/domain';
import { type Router } from 'express';

import {
  type TmdbClient,
  TmdbUnavailableError,
  TmdbWorkNotFoundError,
} from '../clients/tmdbClient.js';
import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import {
  findActiveSuppression,
  findActiveTitleByWorkIdentity,
  findTitleDetail,
  migrateSuppression,
  runInTransaction,
  updateTitle,
} from '../repository/ownerData.js';
import { toDisplaySnapshot } from './suppressions.js';
import { TMDB_UNAVAILABLE_MESSAGE } from './tmdb.js';
import { toIsoDate } from './titles.js';

export interface FixMatchRequest {
  tmdbId: number;
  mediaType: MediaType;
  /** US-030 AC-4 — the owner has seen the duplicate warning and meant it. */
  confirmDuplicate: boolean;
}

export type FixMatchParseResult =
  | { ok: true; value: FixMatchRequest }
  | { ok: false; message: string; details: Record<string, unknown> };

/**
 * Parses one §6.5 body.
 *
 * Exported so the boundaries are driven directly by fast unit tests rather
 * than only through an integration test that has to stand a title up first.
 *
 * ⚠ `confirmDuplicate` defaults to `false` when absent but is REFUSED when
 * present and not a boolean. Coercing `"true"` would let a client that
 * stringifies its body add a second copy of a work to the owner's list while
 * believing it had asked a question — and US-030 AC-4 exists precisely so that
 * duplicate is never created without an explicit answer.
 */
export function parseFixMatchRequest(body: unknown): FixMatchParseResult {
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

  const confirmDuplicate = record['confirmDuplicate'];
  if (confirmDuplicate !== undefined && typeof confirmDuplicate !== 'boolean') {
    return {
      ok: false,
      message: '"confirmDuplicate" must be a boolean.',
      details: { field: 'confirmDuplicate' },
    };
  }

  return {
    ok: true,
    value: {
      tmdbId,
      mediaType: mediaType as MediaType,
      confirmDuplicate: confirmDuplicate === true,
    },
  };
}

/** One title's listings, exactly as they were, for the §6.5 `preserved` block. */
export interface PreservedListings {
  listingIds: string[];
  dateAdded: Record<string, string>;
  sortDateAdded: string | null;
}

/**
 * ⚠ Read from the row AFTER the update and reported back verbatim.
 *
 * This is not decoration: US-030 AC-2/AC-3 are promises about data the owner
 * cannot restore if they are broken, and a client that echoes the request
 * cannot tell whether they were kept. Reporting what the STORE now holds lets
 * `T-FIX-002` compare bytes rather than trust the handler's own account.
 *
 * Every listing is reported, whatever its `state`: a removed listing's
 * `dateAdded` is just as unrecoverable as an active one's.
 */
export function toPreserved(
  listings: readonly { listingId: string; dateAdded: Date }[],
  sortDateAdded: Date | null,
): PreservedListings {
  const dateAdded: Record<string, string> = {};
  for (const listing of listings) dateAdded[listing.listingId] = toIsoDate(listing.dateAdded);
  return {
    listingIds: listings.map((listing) => listing.listingId),
    dateAdded,
    sortDateAdded: sortDateAdded === null ? null : toIsoDate(sortDateAdded),
  };
}

/**
 * @param getClient built per request, for the same reason as `registerTmdbRoutes`:
 *   the client's in-process search cache then dies with the request and can
 *   never accumulate into a mirror of the TMDB catalogue (US-007 AC-6).
 */
export function registerFixMatchRoutes(router: Router, getClient: () => TmdbClient): void {
  router.post('/titles/:titleId/fix-match', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const titleId = req.params.titleId ?? '';

    // Existence and ownership BEFORE the body, matching every other write here.
    // `findTitleDetail` is owner-scoped, so a foreign id is indistinguishable
    // from a missing one and must stay that way — 404, never 403
    // (`T-SEC-002d`). Parsing first answers 400 for a foreign id, which is a
    // different answer from the one a missing id gets and so is a disclosure.
    const title = await findTitleDetail(ownerId, titleId);
    if (title === null) {
      throw new AppError('NOT_FOUND', 404, 'No such title.');
    }

    const parsed = parseFixMatchRequest(req.body);
    if (!parsed.ok) {
      throw new AppError('VALIDATION_FAILED', 400, parsed.message, parsed.details);
    }
    const { tmdbId, mediaType, confirmDuplicate } = parsed.value;

    const previousWorkIdentity = title.workIdentity;
    // Composed with no network call: `tmdb:<mediaType>:<id>` is fully
    // determined by the body, and a TMDB outage must not stop the two gates
    // below answering.
    const workIdentity = workIdentityForTmdb(mediaType, tmdbId);
    const identityChanged = workIdentity !== previousWorkIdentity;

    // GATE 1 — the target is suppressed (US-030 AC-5). Fix-matching onto a
    // work the owner marked "not interested" would re-admit it through the
    // back door, which is the REQ-071 hole from the other side.
    //
    // Skipped when the identity is unchanged: the only active suppression that
    // can hold it is this title's OWN, and refusing there would make a
    // metadata-only re-match impossible for a suppressed row.
    if (identityChanged) {
      const blocking = await findActiveSuppression(ownerId, workIdentity);
      if (blocking !== null) {
        throw new AppError(
          'TARGET_WORK_SUPPRESSED',
          409,
          "You marked that title as not interested. Un-suppress it first if you'd like it back.",
          {
            workIdentity,
            suppressionId: blocking.id,
            unsuppressHref: `/api/suppressions/${encodeURIComponent(blocking.id)}/unsuppress`,
          },
        );
      }
    }

    // GATE 2 — an active title already holds the target (US-030 AC-4). Warn
    // and let the owner insist; do not decide for them.
    let duplicateAckSeq: string | undefined;
    if (identityChanged) {
      const existing = await findActiveTitleByWorkIdentity(ownerId, workIdentity);
      if (existing !== null && existing.id !== title.id) {
        if (!confirmDuplicate) {
          throw new AppError(
            'DUPLICATE_WORK_IDENTITY',
            409,
            'That work is already on your list. Send confirmDuplicate to fix the match anyway.',
            { workIdentity, existingTitleId: existing.id },
          );
        }
        // ⚠ The acknowledgement has to be WRITTEN, not merely honoured in the
        // handler: `title_one_active_per_work` is a unique index on
        // `(owner, work_identity, duplicate_ack_seq)`, so a second active row
        // is only legal once this column differs. The title's own id is used
        // because it is unique by construction and already stable.
        // `''` means "not an acknowledged duplicate" and must never be used
        // here (the column is NEVER nullable — SQL Server treats two NULLs as
        // equal in a unique index and would reject the row it exists to allow).
        duplicateAckSeq = title.id;
      }
    }

    // GATE 3 — TMDB. Last, because it is the only one that can be slow or
    // unavailable, and because a 404 here is about the TARGET rather than
    // about anything the owner already owns.
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
      // The upstream text never reaches the owner: a fetch failure message can
      // carry the request URL, and the TMDB URL carries the API key.
      if (error instanceof TmdbUnavailableError) {
        throw new AppError('TMDB_UNAVAILABLE', 502, TMDB_UNAVAILABLE_MESSAGE);
      }
      throw error;
    }

    // SD-06 — read the OLD identity's suppression before the write replaces it.
    const carried = identityChanged
      ? await findActiveSuppression(ownerId, previousWorkIdentity)
      : null;

    await runInTransaction(async (tx) => {
      await updateTitle(
        ownerId,
        title.id,
        {
          workIdentity,
          matchState: 'matched',
          // §6.3 step 4 — the extracted text was evidence for a match that is
          // now settled. Kept on an unmatched row so the owner can still see
          // what was read; cleared here so a later reader cannot mistake it
          // for the basis of the identity it now carries.
          rawExtractedText: null,
          normalisedText: null,
          tmdbId: detail.tmdbId,
          tmdbMediaType: detail.mediaType,
          tmdbName: detail.name,
          tmdbReleaseYear: detail.releaseYear,
          tmdbRuntimeMinutes: detail.runtimeMinutes,
          tmdbGenres: JSON.stringify(detail.genres),
          tmdbPosterPath: detail.posterPath,
          tmdbFetchedAt: new Date(),
          imdbId: detail.imdbId,
          // ⚠ The stored rating belongs to the work this row USED to be. Left
          // in place it would show the owner one work's name beside another
          // work's score, and the NFR-014 refresh would keep it there for 14
          // days because `imdbRatingFetchedAt` says it was read recently.
          imdbRatingTenths: null,
          imdbRatingFetchedAt: null,
          ...(duplicateAckSeq === undefined ? {} : { duplicateAckSeq }),
        },
        tx,
      );

      if (carried !== null) {
        await migrateSuppression(
          ownerId,
          {
            id: suppressionIdFor(workIdentity),
            from: previousWorkIdentity,
            to: workIdentity,
            at: new Date(),
            snapshot: toDisplaySnapshot({
              workIdentity,
              rawExtractedText: null,
              tmdbName: detail.name,
              tmdbReleaseYear: detail.releaseYear,
              tmdbMediaType: detail.mediaType,
              tmdbPosterPath: detail.posterPath,
            }),
          },
          tx,
        );
      }
    });

    res.status(200).json({
      titleId: title.id,
      workIdentity,
      // Read back from the listings as they were: the write above touched no
      // listing, so these are the same rows, and reporting them is what makes
      // AC-2/AC-3 checkable rather than merely claimed.
      preserved: toPreserved(title.listings, title.sortDateAdded),
      suppressionMigrated:
        carried === null ? null : { from: previousWorkIdentity, to: workIdentity },
    });
  });
}
