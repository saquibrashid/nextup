/**
 * TASK-187 — `GET /api/waiting`, the waiting list and the ONLY thing that
 * triggers an availability refresh (REQ-086, US-042 AC-1/AC-2, ADR-0010).
 *
 * ⚠ **THE TRIGGER IS THIS REQUEST, AND NOTHING ELSE.** There is no timer, no
 * queue, no cron, no worker and no startup sweep anywhere in this codebase
 * that reaches `refreshAvailability`. That is what makes the refresh
 * admissible under REQ-041 and product invariant 5 at all, and `T-CI-005` and
 * `T-AVAIL-002b` are the structural assertions that keep it true. If the
 * waiting view is never opened, no TMDB request is ever made.
 *
 * ⚠ **THE REFRESH IS METADATA-ONLY.** It writes five availability columns on
 * `watch_intent` through `updateWatchIntentAvailability` and nothing else: no
 * `Title`, no `ServiceListing`, no `Suppression`, and it satisfies no intent.
 * Graduation happens by the ordinary capture path (TASK-189), never here.
 *
 * ⚠ **A REFRESH FAILURE IS NEVER AN ERROR PAGE.** The waiting list is the
 * owner's data and it renders from the store; TMDB is an enrichment. A
 * lookup that fails leaves the row stale with its last-known answer, and the
 * response still comes back 200.
 */

import { type Router } from 'express';
import {
  MEDIA_TYPES,
  SERVICES,
  parseEditionLabels,
  ulid,
  workIdentityForTmdb,
  type EditionLabel,
  type MediaType,
  type Service,
} from '@nextup/domain';

import { TmdbClient, TmdbWorkNotFoundError } from '../clients/tmdbClient.js';
import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import {
  createTitle,
  createWatchIntent,
  findActiveSuppression,
  findTitleByWorkIdentity,
  isUniqueViolation,
  listListedWorkIdentities,
  listWaitingWorkIdentities,
  runInTransaction,
} from '../repository/ownerData.js';
import {
  listOwnerServices,
  listWaitingIntents,
  updateWatchIntentAvailability,
} from '../repository/watchIntents.js';
import {
  accessStateFor,
  flaggedProvidersFor,
  otherStreamingFor,
  refreshAvailability,
  selectForAvailabilityRefresh,
  type AccessState,
  type IntentRow,
} from '../services/watchAvailability.js';
import { tmdbUnavailableAppError } from './tmdb.js';
import { toIsoDate } from './titles.js';

/** One row of the waiting view. Shaped field by field, never spread. */
export interface WaitingItem {
  editionLabels?: EditionLabel[];
  intentId: string;
  titleId: string;
  workIdentity: string;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
  discoveredAt: string;
  discoverySource: string;
  /**
   * ⚠ `null` means NOT KNOWN, and the client must render it as *"not seen on
   * your services as of &lt;date&gt;"* — never *"not streaming anywhere"*
   * (ADR-0010 Trap 4). `[]` is the different, weaker fact that TMDB answered
   * and no subscription provider carries it.
   */
  availableOn: string[] | null;
  /**
   * Which of the services the owner USES carry it, or `null` for not known —
   * the "Now on X — add it to your library" invitation (#378).
   */
  flaggedOn: string[] | null;
  /** `SERVICES` members carrying it that the owner does NOT use (#378). */
  otherServicesOn: string[] | null;
  /** Subscription providers nextup has no service for, as TMDB names them. */
  otherProvidersOn: string[] | null;
  /**
   * Storefronts that RENT or SELL it, or `null` for not known (#378).
   * ⚠ Never availability.
   */
  rentOn: string[] | null;
  /** The one-word answer the row leads with (#378). */
  accessState: AccessState;
  /** When a subscription offer was first seen, for the highlight (#378). */
  streamingSince: string | null;
  /** When the answer above was computed, or `null` for never asked. */
  availabilityCheckedAt: string | null;
  availabilityRegion: string;
}

/**
 * ⚠ Parsed defensively. `available_on` is `NVARCHAR(MAX)` holding JSON, and a
 * value that is not an array of strings is treated as NOT KNOWN rather than
 * thrown — one malformed row must not take the whole waiting view down.
 */
function parseAvailableOn(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    return null;
  }
}

/**
 * The services a streaming offer counts as "yours" on (#378, owner decision 3).
 *
 * ⚠ An owner who has imported nothing yet has no services to tell apart, and
 * treating every offer as "not yours" would hide the one invitation this view
 * exists to make. Until the first import, every supported service is treated
 * as the owner's — which is exactly the behaviour before #378.
 */
function yourServices(used: readonly string[]): Service[] {
  const known = SERVICES.filter((service) => used.includes(service));
  return known.length > 0 ? known : [...SERVICES];
}

/** One `POST /api/waiting` body (#378, owner decision 2). Closed field set. */
export function parseSearchAddRequest(
  body: unknown,
):
  | { ok: true; value: { tmdbId: number; mediaType: MediaType } }
  | { ok: false; message: string; details: Record<string, unknown> } {
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
  return { ok: true, value: { tmdbId, mediaType: mediaType as MediaType } };
}

function alreadyWaiting(workIdentity: string): AppError {
  return new AppError('DUPLICATE_WORK_IDENTITY', 409, "You're already waiting for that title.", {
    workIdentity,
    reason: 'already-waiting',
  });
}

export function registerWaitingRoutes(
  router: Router,
  getTmdb: () => Pick<TmdbClient, 'getWatchOffers' | 'getWork'> = () =>
    new TmdbClient({ apiKey: process.env['TMDB_API_KEY'] ?? '' }),
): void {
  /**
   * `POST /api/waiting` — wait for ONE title found by search (#378).
   *
   * ⚠ **IT NEVER ADDS TO THE LIBRARY.** The title it creates is stored exactly
   * as a storefront capture stores a waiting work — `removed`, no listing, no
   * sort date (`batchClose.presenceFields('waiting')`) — so it is invisible to
   * the combined list and to the removed log, and it graduates only through
   * an ordinary service import, like every other waiting work.
   *
   * Gate order is `POST /api/titles`'s: suppression first (no network, and
   * the reason the owner needs to hear first), then TMDB, then the store.
   */
  router.post('/waiting', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const parsed = parseSearchAddRequest(req.body);
    if (!parsed.ok) throw new AppError('VALIDATION_FAILED', 400, parsed.message, parsed.details);
    const { tmdbId, mediaType } = parsed.value;
    const workIdentity = workIdentityForTmdb(mediaType, tmdbId);

    const blocking = await findActiveSuppression(ownerId, workIdentity);
    if (blocking !== null) {
      throw new AppError(
        'WORK_SUPPRESSED',
        409,
        "You marked that title as not interested. Un-suppress it first if you'd like to wait for it.",
        { workIdentity, suppressionId: blocking.id },
      );
    }

    let detail;
    try {
      detail = await getTmdb().getWork(mediaType, tmdbId);
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

    const result = await runInTransaction(async (tx) => {
      // Sequential: one transaction is one connection.
      const listed = await listListedWorkIdentities(ownerId, tx);
      const waiting = await listWaitingWorkIdentities(ownerId, tx);
      // US-040 AC-5, on this path too: a work already in the library is not
      // something to wait for. Refused, never doubled (#378 acceptance).
      if (listed.has(workIdentity)) {
        throw new AppError(
          'DUPLICATE_WORK_IDENTITY',
          409,
          "That title is already in your library, so there's nothing to wait for.",
          { workIdentity, reason: 'already-listed' },
        );
      }
      if (waiting.has(workIdentity)) throw alreadyWaiting(workIdentity);

      const existing = await findTitleByWorkIdentity(ownerId, workIdentity, tx);
      let titleId: string;
      if (existing === null) {
        titleId = ulid();
        await createTitle(
          ownerId,
          {
            id: titleId,
            workIdentity,
            // ⚠ `removed` with NO list date (the column is left unset, so
            // NULL): the waiting shape, never `active` (see
            // `presenceFields` in batchClose.ts). It is not written here by
            // name because this file also reads discovery dates (T-WAIT-011).
            state: 'removed',
            matchState: 'matched',
            tmdbId: detail.tmdbId,
            tmdbMediaType: detail.mediaType,
            tmdbName: detail.name,
            tmdbReleaseYear: detail.releaseYear,
            tmdbRuntimeMinutes: detail.runtimeMinutes,
            tmdbGenres: JSON.stringify(detail.genres),
            tmdbComedyShow: detail.comedyShow ?? null,
            tmdbPosterPath: detail.posterPath,
            tmdbFetchedAt: new Date(),
            imdbId: detail.imdbId,
            createdByBatchId: null,
          },
          tx,
        );
      } else {
        // Reused as it stands — a work in the removed log stays there.
        titleId = existing.id;
      }

      const intentId = ulid();
      await createWatchIntent(
        ownerId,
        {
          id: intentId,
          titleId,
          workIdentity,
          sourceBatchId: null,
          discoverySource: 'search',
          state: 'waiting',
        },
        tx,
      );
      return { intentId, titleId, titleWasCreated: existing === null };
    }).catch((error: unknown) => {
      // Two adds racing: only `ux_intent_owner_title_waiting` sees both.
      if (isUniqueViolation(error)) throw alreadyWaiting(workIdentity);
      throw error;
    });

    res.status(201).json({
      intentId: result.intentId,
      titleId: result.titleId,
      workIdentity,
      name: detail.name,
      discoverySource: 'search',
      titleWasCreated: result.titleWasCreated,
    });
  });

  router.get('/waiting', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const now = new Date();

    const [stored, used] = await Promise.all([
      listWaitingIntents(ownerId),
      listOwnerServices(ownerId),
    ]);
    const yours = yourServices(used);

    const rows: IntentRow[] = stored.map((intent) => ({
      id: intent.id,
      workIdentity: intent.workIdentity,
      tmdbId: intent.title.tmdbId,
      tmdbMediaType: intent.title.tmdbMediaType,
      availabilityRegion: intent.availabilityRegion,
      availabilityCheckedAt: intent.availabilityCheckedAt,
      availableOn: parseAvailableOn(intent.availableOn),
      rentOn: parseAvailableOn(intent.rentOn),
      streamingSince: intent.streamingSince,
    }));

    // ⚠ THE PAGE, never a table scan. `selectForAvailabilityRefresh` is given
    // exactly the rows about to be rendered; handing it anything wider turns
    // the lazy refresh into the backfill sweep REQ-041 forbids.
    const stale = selectForAvailabilityRefresh(rows, now);
    const { writes, failedIds } =
      stale.length === 0
        ? { writes: [], failedIds: [] }
        : await refreshAvailability(stale, getTmdb(), now);

    const fresh = new Map(writes.map((write) => [write.id, write]));
    for (const write of writes) {
      await updateWatchIntentAvailability(ownerId, write.id, {
        availableOn: write.availableOn === null ? null : JSON.stringify(write.availableOn),
        rentOn: write.rentOn === null ? null : JSON.stringify(write.rentOn),
        streamingSince: write.streamingSince,
        availabilityCheckedAt: write.availabilityCheckedAt,
        availabilityRegion: write.availabilityRegion,
      });
    }

    const items: WaitingItem[] = stored.map((intent, index) => {
      const row = rows[index] as IntentRow;
      const write = fresh.get(intent.id);
      const availableOn = write === undefined ? row.availableOn : write.availableOn;
      const rentOn = write === undefined ? row.rentOn : write.rentOn;
      const streamingSince = write === undefined ? row.streamingSince : write.streamingSince;
      const checkedAt =
        write === undefined ? intent.availabilityCheckedAt : write.availabilityCheckedAt;
      const flagged = flaggedProvidersFor(availableOn);
      const other = otherStreamingFor(availableOn, yours);

      return {
        intentId: intent.id,
        titleId: intent.titleId,
        workIdentity: intent.workIdentity,
        name: intent.title.tmdbName ?? intent.title.rawExtractedText ?? '',
        editionLabels: parseEditionLabels(intent.title.editionLabels),
        releaseYear: intent.title.tmdbReleaseYear,
        posterPath: intent.title.tmdbPosterPath,
        discoveredAt: toIsoDate(intent.discoveredAt),
        discoverySource: intent.discoverySource,
        availableOn,
        flaggedOn: flagged === null ? null : flagged.filter((service) => yours.includes(service)),
        otherServicesOn: other === null ? null : other.services,
        otherProvidersOn: other === null ? null : other.providers,
        rentOn,
        accessState: accessStateFor(availableOn, rentOn, checkedAt),
        streamingSince: streamingSince === null ? null : streamingSince.toISOString(),
        availabilityCheckedAt: checkedAt === null ? null : checkedAt.toISOString(),
        availabilityRegion: intent.availabilityRegion,
      };
    });

    res.status(200).json({
      items,
      count: items.length,
      // ⚠ US-042 AC-7. `true` means at least one lookup this render THREW, so
      // the rows above may be showing a last-known answer with an older as-of
      // date. It is a note the client renders unobtrusively — never a non-200,
      // never an error page: the waiting list is the owner's own data and
      // renders from the store whatever TMDB is doing.
      availabilityRefreshFailed: failedIds.length > 0,
    });
  });
}
