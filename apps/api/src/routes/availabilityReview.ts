/**
 * The "Availability changes" review screen (US-064, REQ-130, PRD `A55`,
 * `specs/api.md` §6.45–§6.48, TASK-266).
 *
 * WHY THIS EXISTS
 * ---------------
 * The per-row markers (US-063) tell the owner about one title at a time. This
 * screen gathers every un-kept Library change and every waiting title now
 * streaming on an owner service, and answers several of them at once.
 *
 *   - §6.45 `GET /api/availability/review` — the screen. ⚠ **STORED DATA
 *     ONLY**: it reads the rows and asks TMDB nothing, so opening the screen
 *     is never a table-scan refresh.
 *   - §6.46 `GET /api/availability/review/summary` — the count the Library
 *     page shows. Same reads, same rule.
 *   - §6.47 `POST /api/availability/check` — "Check more titles". ⚠ **OWNER-
 *     INITIATED, METADATA ONLY (PRD §7.4, `A55`).** One tap looks up at most
 *     `AVAILABILITY_CHECK_BATCH` stale rows, oldest first, serially; a failed
 *     lookup writes nothing. It writes the availability columns through the
 *     same narrow writers as the lazy refresh and never touches membership,
 *     order or badges. It is not a background process (`T-CI-005`).
 *   - §6.48 `POST /api/availability/review/apply` — one answer applied to
 *     several rows (§7.4 item 18). ⚠ **EACH ITEM IS ITS OWN TRANSACTION** with
 *     the one-tap route's guards, so one refused item never rolls back or
 *     blocks another; the response reports every item.
 */

import { type Service } from '@nextup/domain';
import { type Router } from 'express';

import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import { listLibraryAvailability } from '../repository/availabilityReview.js';
import {
  findTitle,
  listActiveSuppressions,
  listListingsForTitle,
} from '../repository/ownerData.js';
import {
  findWaitingIntent,
  keepTitleAvailabilityChange,
  listOwnerServices,
  listWaitingIntents,
  updateTitleAvailability,
  updateWatchIntentAvailability,
} from '../repository/watchIntents.js';
import {
  checkCounts,
  firstOwnerService,
  formatRecheckCursor,
  parseApplyBody,
  parseCheckBody,
  recheckProgress,
  selectForAvailabilityCheck,
  selectForRecheckAll,
  type ApplyItem,
  type CheckCandidate,
  type ReviewAction,
} from '../services/availabilityReview.js';
import {
  libraryAvailabilityFor,
  parseProviderList,
  yourServicesFrom,
  type LibraryAvailability,
} from '../services/libraryAvailability.js';
import {
  accessStateFor,
  flaggedProvidersFor,
  refreshAvailability,
  type AvailabilityWrite,
  type WatchProviderSource,
} from '../services/watchAvailability.js';
import {
  moveTitleToWaiting,
  promoteIntent,
  refuseIfSuppressed,
  softRemoveListings,
  type TitleListing,
} from './availabilityMoves.js';
import { toIsoDate } from './titles.js';

type OwnerId = Parameters<typeof listOwnerServices>[0];
type LibraryTitle = Awaited<ReturnType<typeof listLibraryAvailability>>[number];
type WaitingIntentRow = Awaited<ReturnType<typeof listWaitingIntents>>[number];

/**
 * The waiting rows one read considers. ⚠ Wider than the waiting page's 200 so
 * the review and the check see every intent an owner plausibly has; it bounds
 * a read of STORED rows, never a lookup (that is `AVAILABILITY_CHECK_BATCH`).
 */
const WAITING_READ_MAX = 2000;

const json = (list: readonly string[] | null): string | null =>
  list === null ? null : JSON.stringify(list);

type CheckableTitle = Pick<
  LibraryTitle,
  | 'id'
  | 'workIdentity'
  | 'tmdbId'
  | 'tmdbMediaType'
  | 'availabilityRegion'
  | 'availabilityCheckedAt'
  | 'availableOn'
  | 'rentOn'
>;

/** A Library title as the check sees it; `null` when it has no badge. */
function titleCandidate(
  title: CheckableTitle & { listings: readonly unknown[] },
): CheckCandidate | null {
  if (title.listings.length === 0) return null;
  return {
    kind: 'title',
    row: {
      id: title.id,
      workIdentity: title.workIdentity,
      tmdbId: title.tmdbId,
      tmdbMediaType: title.tmdbMediaType,
      availabilityRegion: title.availabilityRegion,
      availabilityCheckedAt: title.availabilityCheckedAt,
      availableOn: parseProviderList(title.availableOn),
      rentOn: parseProviderList(title.rentOn),
      streamingSince: null,
    },
  };
}

function intentCandidate(intent: WaitingIntentRow): CheckCandidate {
  return {
    kind: 'intent',
    row: {
      id: intent.id,
      workIdentity: intent.workIdentity,
      tmdbId: intent.title.tmdbId,
      tmdbMediaType: intent.title.tmdbMediaType,
      availabilityRegion: intent.availabilityRegion,
      availabilityCheckedAt: intent.availabilityCheckedAt,
      availableOn: parseProviderList(intent.availableOn),
      rentOn: parseProviderList(intent.rentOn),
      streamingSince: intent.streamingSince,
    },
  };
}

/** Write one answer through the narrow writer for its kind. */
async function persistWrite(
  ownerId: OwnerId,
  kind: CheckCandidate['kind'] | undefined,
  write: AvailabilityWrite,
): Promise<void> {
  if (kind === 'title') {
    await updateTitleAvailability(ownerId, write.id, {
      availableOn: json(write.availableOn),
      rentOn: json(write.rentOn),
      availabilityCheckedAt: write.availabilityCheckedAt,
      availabilityRegion: write.availabilityRegion,
    });
  } else {
    await updateWatchIntentAvailability(ownerId, write.id, {
      availableOn: json(write.availableOn),
      rentOn: json(write.rentOn),
      streamingSince: write.streamingSince,
      availabilityCheckedAt: write.availabilityCheckedAt,
      availabilityRegion: write.availabilityRegion,
    });
  }
}

/**
 * One forced lookup. ⚠ Refuses a work with no TMDB id (nothing to ask), and a
 * FAILED lookup writes nothing and answers 502 — the stored answer is kept.
 */
async function checkOne(
  ownerId: OwnerId,
  candidate: CheckCandidate | null,
  getSource: () => WatchProviderSource,
  id: string,
): Promise<AvailabilityWrite> {
  if (candidate === null) throw notActive(id);
  const { writes, failedIds } =
    candidate.row.tmdbId === null || candidate.row.tmdbMediaType === null
      ? { writes: [], failedIds: [] }
      : await refreshAvailability([candidate.row], getSource(), new Date());
  const write = writes[0];
  if (write === undefined) {
    if (failedIds.length > 0) {
      throw new AppError(
        'TMDB_UNAVAILABLE',
        502,
        "Couldn't reach TMDB. The last answer is unchanged. Try again in a moment.",
      );
    }
    throw new AppError('TMDB_WORK_NOT_FOUND', 404, 'This title has no TMDB match to check.', {
      id,
    });
  }
  await persistWrite(ownerId, candidate.kind, write);
  return write;
}

function checkNowBody(id: string, write: AvailabilityWrite): Record<string, unknown> {
  return {
    id,
    checkedAt: write.availabilityCheckedAt.toISOString(),
    region: write.availabilityRegion,
    availableOn: write.availableOn,
    rentOn: write.rentOn,
    accessState: accessStateFor(write.availableOn, write.rentOn, write.availabilityCheckedAt),
  };
}

/** The marker for a stored title and its active badges — one definition. */
function availabilityOf(
  title: {
    availableOn: string | null;
    rentOn: string | null;
    availabilityCheckedAt: Date | null;
    availabilityRegion: string;
    availabilityKeptSignature: string | null;
  },
  listedServices: readonly string[],
  yours: readonly Service[],
): LibraryAvailability {
  return libraryAvailabilityFor({
    listedServices,
    availableOn: parseProviderList(title.availableOn),
    rentOn: parseProviderList(title.rentOn),
    checkedAt: title.availabilityCheckedAt,
    region: title.availabilityRegion,
    yourServices: yours,
    keptSignature: title.availabilityKeptSignature,
  });
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

/** §6.45 / §6.46 — everything the screen shows, from the store alone. */
async function readReview(ownerId: OwnerId, now: Date) {
  const [allTitles, intents, used, suppressions] = await Promise.all([
    listLibraryAvailability(ownerId),
    listWaitingIntents(ownerId, { take: WAITING_READ_MAX }),
    listOwnerServices(ownerId),
    listActiveSuppressions(ownerId),
  ]);
  const yours = yourServicesFrom(used);
  // ⚠ The Library hides suppressed works (REQ-071, keyed on WORK IDENTITY),
  // so this screen does too — a row the Library does not show is not a change
  // to review, and it is not looked up by "Check more titles" either.
  const suppressed = new Set(suppressions.map((row) => row.workIdentity));
  const titles = allTitles.filter((title) => !suppressed.has(title.workIdentity));

  const library = titles
    .filter((title) => title.listings.length > 0)
    .map((title) => ({
      titleId: title.id,
      workIdentity: title.workIdentity,
      name: title.tmdbName ?? title.rawExtractedText ?? '',
      releaseYear: title.tmdbReleaseYear,
      posterPath: title.tmdbPosterPath,
      badges: title.listings.map((listing) => ({
        service: listing.service,
        listingId: listing.listingId,
        dateAdded: toIsoDate(listing.dateAdded),
      })),
      availability: availabilityOf(
        title,
        title.listings.map((listing) => listing.service),
        yours,
      ),
    }))
    .filter((item) => item.availability.signature !== null && !item.availability.kept)
    .sort(byName);

  const nowStreaming = intents
    .map((intent) => {
      const flagged = (flaggedProvidersFor(parseProviderList(intent.availableOn)) ?? []).filter(
        (service) => yours.includes(service),
      );
      return {
        intentId: intent.id,
        titleId: intent.titleId,
        workIdentity: intent.workIdentity,
        name: intent.title.tmdbName ?? intent.title.rawExtractedText ?? '',
        releaseYear: intent.title.tmdbReleaseYear,
        posterPath: intent.title.tmdbPosterPath,
        flaggedOn: flagged,
        service: firstOwnerService(flagged, yours),
        availabilityCheckedAt:
          intent.availabilityCheckedAt === null ? null : intent.availabilityCheckedAt.toISOString(),
        availabilityRegion: intent.availabilityRegion,
      };
    })
    .filter((item) => item.flaggedOn.length > 0)
    .sort(byName);

  const candidates = [
    ...titles.map(titleCandidate).filter((row): row is CheckCandidate => row !== null),
    ...intents.map(intentCandidate),
  ];
  return { library, nowStreaming, check: checkCounts(candidates, now), titles, intents };
}

/** Refuse an item whose change is no longer the one the owner answered. */
function changed(id: string): AppError {
  return new AppError(
    'AVAILABILITY_CHANGED',
    409,
    'That availability change has changed since you saw it. Nothing was changed.',
    { id },
  );
}

/** Load a Library title, or refuse. The one-tap routes' 404. */
async function requireTitle(ownerId: OwnerId, id: string) {
  const title = await findTitle(ownerId, id);
  if (title === null) throw new AppError('NOT_FOUND', 404, 'No such title.');
  return title;
}

const notActive = (titleId: string): AppError =>
  new AppError('TITLE_NOT_ACTIVE', 409, 'That title is not in your library. Nothing was changed.', {
    titleId,
  });

/** One item of §6.48. Throws `AppError` to refuse; the caller isolates it. */
async function applyOne(
  ownerId: OwnerId,
  action: ReviewAction,
  item: ApplyItem,
  yours: readonly Service[],
): Promise<Record<string, unknown>> {
  if (action === 'add-to-library') {
    const intent = await findWaitingIntent(ownerId, item.id);
    if (intent === null) throw new AppError('NOT_FOUND', 404, 'No such waiting title.');
    const service = firstOwnerService(
      flaggedProvidersFor(parseProviderList(intent.availableOn)),
      yours,
    );
    if (service === null) throw changed(item.id);
    return promoteIntent(ownerId, intent, service);
  }

  const title = await requireTitle(ownerId, item.id);
  const matches = (active: readonly TitleListing[]): LibraryAvailability => {
    const availability = availabilityOf(
      title,
      active.map((row) => row.service),
      yours,
    );
    if (availability.signature !== item.signature) throw changed(item.id);
    return availability;
  };

  if (action === 'move-to-waiting') {
    return moveTitleToWaiting(ownerId, title, (active) => {
      if (!matches(active).canMoveToWaiting) throw changed(item.id);
    });
  }

  const active = (await listListingsForTitle(ownerId, title.id)).filter(
    (row) => row.state === 'active',
  );
  if (action === 'keep') {
    if (active.length === 0) throw notActive(title.id);
    const availability = matches(active);
    await keepTitleAvailabilityChange(ownerId, title.id, item.signature as string);
    return { titleId: title.id, keptSignature: availability.signature };
  }

  // 'remove-left-badges' — the §6.40 guards, applied to every badge that left.
  await refuseIfSuppressed(ownerId, title.workIdentity, { titleId: title.id });
  if (active.length === 0) throw notActive(title.id);
  const { left } = matches(active);
  if (left.length === 0) throw changed(item.id);
  const removing = active.filter((row) => left.includes(row.service as Service));
  const removedAt = new Date();
  const titleState = await softRemoveListings(
    ownerId,
    title.id,
    removing.map((row) => row.listingId),
    removedAt,
  );
  return {
    titleId: title.id,
    removedListingIds: removing.map((row) => row.listingId),
    titleState,
    removedAt: removedAt.toISOString(),
  };
}

export function registerAvailabilityReviewRoutes(
  router: Router,
  getSource: () => WatchProviderSource,
): void {
  /** §6.45 — the review screen, from stored data only. */
  router.get('/availability/review', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const { library, nowStreaming, check } = await readReview(ownerId, new Date());
    res.status(200).json({ library, nowStreaming, check });
  });

  /** §6.46 — how many rows the screen would show. No lookups. */
  router.get('/availability/review/summary', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const { library, nowStreaming } = await readReview(ownerId, new Date());
    res.status(200).json({ count: library.length + nowStreaming.length });
  });

  /**
   * §6.47 — "Check more titles" and "Re-check everything": ONE owner tap, at
   * most `AVAILABILITY_CHECK_BATCH` lookups. `scope: 'stale'` (the default)
   * picks stale rows; `scope: 'all'` walks every askable row regardless of age
   * with the stateless cursor of `selectForRecheckAll`.
   */
  router.post('/availability/check', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const now = new Date();
    const request = parseCheckBody(req.body, now);
    const { titles, intents } = await readReview(ownerId, now);
    const candidates = [
      ...titles.map(titleCandidate).filter((row): row is CheckCandidate => row !== null),
      ...intents.map(intentCandidate),
    ];
    const since = request.scope === 'all' ? (request.since ?? now) : null;
    const due =
      request.scope === 'all' && since !== null
        ? selectForRecheckAll(candidates, since, request.after)
        : selectForAvailabilityCheck(candidates, now);
    const kindById = new Map(due.map((candidate) => [candidate.row.id, candidate.kind]));
    const { writes, failedIds } =
      due.length === 0
        ? { writes: [], failedIds: [] }
        : await refreshAvailability(
            due.map((candidate) => candidate.row),
            getSource(),
            now,
          );
    for (const write of writes) await persistWrite(ownerId, kindById.get(write.id), write);

    const written = new Map(writes.map((write) => [write.id, write]));
    const after = candidates.map((candidate): CheckCandidate => {
      const write = written.get(candidate.row.id);
      return write === undefined
        ? candidate
        : {
            kind: candidate.kind,
            row: {
              ...candidate.row,
              availableOn: write.availableOn,
              rentOn: write.rentOn,
              availabilityCheckedAt: write.availabilityCheckedAt,
            },
          };
    });
    const counts = checkCounts(after, now);
    const last = due[due.length - 1];
    const recheck =
      request.scope === 'all' && since !== null
        ? (() => {
            const cursor =
              last === undefined
                ? request.after
                : { checkedAtMs: last.row.availabilityCheckedAt?.getTime() ?? 0, id: last.row.id };
            const progress = recheckProgress(after, since, cursor);
            return {
              since: since.toISOString(),
              cursor: cursor === null ? null : formatRecheckCursor(cursor),
              total: progress.total,
              remaining: progress.remaining,
              processed: progress.total - progress.remaining,
              done: progress.remaining === 0,
            };
          })()
        : undefined;
    res.status(200).json({
      lookedUp: writes.length,
      failed: failedIds.length,
      checked: counts.checked,
      notCheckedRecently: counts.notCheckedRecently,
      ...(recheck === undefined ? {} : { recheck }),
    });
  });

  /**
   * §6.52 — "Check now" for one Library title. ⚠ OWNER-INITIATED, regardless
   * of age, metadata-only: it writes the four availability columns and nothing
   * else, and the moves it reveals stay the owner's to make.
   */
  router.post('/titles/:titleId/availability/check', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const title = await requireTitle(ownerId, req.params.titleId ?? '');
    const active = (await listListingsForTitle(ownerId, title.id)).filter(
      (row) => row.state === 'active',
    );
    if (active.length === 0) throw notActive(title.id);
    const candidate = titleCandidate({ ...title, listings: active });
    const write = await checkOne(ownerId, candidate, getSource, title.id);
    res.status(200).json(checkNowBody(title.id, write));
  });

  /** §6.53 — "Check now" for one waiting title. Same contract as §6.52. */
  router.post('/waiting/:intentId/availability/check', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const intent = await findWaitingIntent(ownerId, req.params.intentId ?? '');
    if (intent === null) throw new AppError('NOT_FOUND', 404, 'No such waiting title.');
    const write = await checkOne(ownerId, intentCandidate(intent), getSource, intent.id);
    res.status(200).json(checkNowBody(intent.id, write));
  });

  /** §6.48 — one answer, several rows, each its own transaction. */
  router.post('/availability/review/apply', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const { action, items } = parseApplyBody(req.body);
    const yours = yourServicesFrom(await listOwnerServices(ownerId));
    const results: Record<string, unknown>[] = [];
    // ⚠ SERIAL and isolated: a refusal is recorded and the next item runs.
    for (const item of items) {
      try {
        results.push({
          id: item.id,
          outcome: 'done',
          ...(await applyOne(ownerId, action, item, yours)),
        });
      } catch (error) {
        results.push(
          error instanceof AppError
            ? { id: item.id, outcome: 'refused', code: error.code, message: error.message }
            : {
                id: item.id,
                outcome: 'refused',
                code: 'INTERNAL_ERROR',
                message: "Couldn't make that change. Nothing was changed.",
              },
        );
      }
    }
    const done = results.filter((result) => result.outcome === 'done').length;
    res.status(200).json({ action, results, done, refused: results.length - done });
  });
}
