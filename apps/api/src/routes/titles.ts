/**
 * `GET /api/titles` — the combined list (`specs/api.md` §6.2, TASK-033).
 *
 * US-018 in one sentence: **one row per canonical work, one badge per service
 * holding it.** That is the whole product promise on the read side, and the
 * two properties that make it true are enforced below rather than in the SPA:
 *
 *   - deduplication is structural, not a post-processing step. A work IS one
 *     `title` row (invariant I-1, a filtered unique index in the database), so
 *     "one row per work" is not something this handler can get wrong by
 *     forgetting to group (`T-LIST-010`).
 *   - `badges` is derived from the title's ACTIVE listings (`T-LIST-011`), so
 *     a removed listing's badge disappears while the row survives.
 *
 * Suppression, ordering and pagination are the repository's job; this handler
 * validates, calls it once, and shapes the response. It deliberately performs
 * no filtering of its own — a second filter here would make short pages and a
 * `nextCursor` that skips rows.
 */

import {
  dateAddedLabel,
  parseEditionLabels,
  watchPriorityRank,
  titleCategory,
  type TitleCategory,
  type WatchPriority,
} from '@nextup/domain';
import { type Router } from 'express';

import {
  encodeCursor,
  encodeNameCursor,
  encodeRatingCursor,
  encodeReleaseYearCursor,
  encodeRuntimeCursor,
  encodeWatchPriorityCursor,
} from '../pagination.js';
import { AppError } from '../errors/AppError.js';
import { beginRatingRefresh, runRatingRefresh } from '../jobs/refreshRatings.js';
import { IMDB_SWEEP_BUDGET_MS, IMDB_SWEEP_PER_REQUEST } from '../services/imdbRatings.js';
import {
  countRuntimeUnknown,
  findTitleDetail,
  findActiveSuppression,
  listTitlePage,
  listTitleRatingRows,
  listUnclassifiedTitles,
  markCategoryAttempt,
  countUnclassifiedTitles,
} from '../repository/ownerData.js';
import { fromTenths, type RatingRow } from '../services/imdbRatings.js';
import {
  refreshStaleMetadata,
  staleTitles,
  type MetadataRefreshResult,
  type RefreshableTitle,
} from '../services/tmdbRefresh.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import { parseTitleListQuery } from './titlesQuery.js';
import { readTitlePresentation } from '../services/titlePresentation.js';

/** `date` columns come back as a `Date` at UTC midnight; we want `YYYY-MM-DD`. */
export function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * `tmdb_genres` is stored as a JSON array in an `NVARCHAR(MAX)` column
 * (`specs/data-model.md` §16) — the one place the database cannot check shape.
 *
 * A malformed value yields `[]` rather than a 500. Genres are decoration on a
 * row; refusing to render the owner's entire list because one title's metadata
 * blob is corrupt would be a much worse outcome than a missing genre chip.
 * ⚠ `[]` is also a MEANINGFUL value: a title with no genres matches no genre
 * filter and is never defaulted into one (US-019 AC-6).
 */
export function parseGenres(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((g): g is string => typeof g === 'string');
  } catch {
    return [];
  }
}

interface ListingRow {
  listingId: string;
  service: string;
  dateAdded: Date;
}

interface TitleRow {
  tmdbComedyShow?: boolean | null;
  categoryOverride?: TitleCategory | null;
  editionLabels?: string;
  watching?: boolean;
  priority?: WatchPriority;
  id: string;
  workIdentity: string;
  matchState: string;
  rawExtractedText: string | null;
  sortDateAdded: Date | null;
  /** TASK-219 — the stored `sort=name` key. Cursor source, never displayed. */
  sortName?: string | null;
  tmdbId?: number | null;
  tmdbMediaType: string | null;
  tmdbName: string | null;
  tmdbReleaseYear: number | null;
  tmdbRuntimeMinutes: number | null;
  tmdbGenres: string;
  tmdbPosterPath: string | null;
  tmdbFetchedAt?: Date | null;
  imdbId?: string | null;
  imdbRatingTenths?: number | null;
  imdbRatingFetchedAt?: Date | null;
  listings: ListingRow[];
}

/**
 * Project a served row down to what the metadata refresh is allowed to see.
 *
 * ⚠ Narrow ON PURPOSE, exactly as `toRatingRow` is. The refresh reads three
 * fields; handing it the whole row would let a future edit reach a
 * list-bearing column and quietly violate product invariant 5.
 */
export function toRefreshableTitle(row: TitleRow): RefreshableTitle {
  return {
    id: row.id,
    tmdbId: row.tmdbId ?? null,
    tmdbMediaType: row.tmdbMediaType,
    tmdbFetchedAt: row.tmdbFetchedAt ?? null,
    ...(row.tmdbComedyShow === undefined ? {} : { tmdbComedyShow: row.tmdbComedyShow }),
  };
}

/**
 * Overlay what the refresh just wrote onto the row that was read before it.
 *
 * ⚠ Only the columns `updateTitleMetadata` is allowed to write. Overlaying the
 * whole object would let a widened refresh reach a list-bearing field and
 * change the rendered page without touching any query — which is the same
 * invariant-5 hole the repository writer is narrow to prevent.
 */
export function applyRefresh<T extends TitleRow>(row: T, refresh: MetadataRefreshResult): T {
  const written = refresh.refreshed.get(row.id);
  if (written === undefined) return row;
  return {
    ...row,
    tmdbName: written.tmdbName,
    tmdbReleaseYear: written.tmdbReleaseYear,
    tmdbRuntimeMinutes: written.tmdbRuntimeMinutes,
    tmdbGenres: written.tmdbGenres,
    tmdbPosterPath: written.tmdbPosterPath,
    // `null` is "unchanged" here too, for the same reason the writer gives.
    imdbId: written.imdbId ?? row.imdbId ?? null,
    tmdbFetchedAt: written.tmdbFetchedAt,
    ...(written.tmdbComedyShow === undefined ? {} : { tmdbComedyShow: written.tmdbComedyShow }),
  };
}

/**
 * One list item.
 *
 * `name` falls back to the raw extracted text for an UNMATCHED title. There is
 * no third option: a row with no name at all is unusable, and inventing a
 * placeholder would hide from the owner that the title never matched — which
 * is the state the fix-match flow exists to resolve.
 */
export function toListItem(row: TitleRow, metadataStale = false): Record<string, unknown> {
  const badges = row.listings.map((listing) => ({
    service: listing.service,
    listingId: listing.listingId,
    dateAdded: toIsoDate(listing.dateAdded),
  }));

  const sortDateAdded = row.sortDateAdded === null ? null : toIsoDate(row.sortDateAdded);

  return {
    titleId: row.id,
    editionLabels: parseEditionLabels(row.editionLabels),
    watching: row.watching ?? false,
    priority: row.priority ?? 'normal',
    workIdentity: row.workIdentity,
    matchState: row.matchState,
    name: row.tmdbName ?? row.rawExtractedText ?? '',
    mediaType: row.tmdbMediaType,
    category: titleCategory(row.tmdbMediaType, row.tmdbComedyShow, row.categoryOverride),
    categoryOverride: row.categoryOverride ?? null,
    automaticCategory: titleCategory(row.tmdbMediaType, row.tmdbComedyShow),
    categoryPending:
      row.categoryOverride == null && row.tmdbId != null && row.tmdbComedyShow == null,
    releaseYear: row.tmdbReleaseYear,
    genres: parseGenres(row.tmdbGenres),
    runtimeMinutes: row.tmdbRuntimeMinutes,
    posterPath: row.tmdbPosterPath,
    // REQ-091. `null` means "no rating to show" and is rendered as such; it is
    // NEVER coerced to 0, which would read as the worst film ever made. It
    // covers both "never asked" and "OMDb has no rating for this work" —
    // indistinguishable to the owner, and deliberately so.
    imdbRating: fromTenths(row.imdbRatingTenths ?? null),
    badges,
    sortDateAdded,
    // `specs/api.md` §6.4. `true` means "what you are looking at is our
    // STORED copy and we could not confirm it just now" — it never means the
    // data is missing, and the fields above are always the stored values.
    metadataStale,
    // Computed server-side so REQ-061's "to nextup" wording has exactly one
    // implementation; the SPA renders this verbatim (`specs/ui.md` §row).
    dateAddedLabel: sortDateAdded === null ? null : dateAddedLabel(sortDateAdded),
  };
}

/**
 * Project a served row down to what the rating refresh is allowed to see.
 *
 * ⚠ Narrow ON PURPOSE. The refresh reads four fields and writes two; handing
 * it the whole row would let a future edit reach a list-bearing column and
 * quietly violate product invariant 5. This projection is the boundary.
 */
export function toRatingRow(row: TitleRow): RatingRow {
  return {
    id: row.id,
    imdbId: row.imdbId ?? null,
    imdbRatingTenths: row.imdbRatingTenths ?? null,
    imdbRatingFetchedAt: row.imdbRatingFetchedAt ?? null,
  };
}

/**
 * One removed listing, for the detail response's `removedListings[]`.
 *
 * `removedAt` is a timestamp, not a date: the removed view is an ordered LOG
 * (product invariant 7) and two removals on the same day must stay
 * distinguishable. `dateAdded` beside it is still a date — it is the same
 * write-once value the badge carried before the listing was removed.
 */
export function toRemovedListing(listing: DetailListingRow): Record<string, unknown> {
  return {
    listingId: listing.listingId,
    service: listing.service,
    state: listing.state,
    dateAdded: toIsoDate(listing.dateAdded),
    removedAt: listing.removedAt === null ? null : listing.removedAt.toISOString(),
  };
}

interface DetailListingRow extends ListingRow {
  state: string;
  removedAt: Date | null;
}

interface TitleDetailRow extends Omit<TitleRow, 'listings'> {
  createdByBatchId: string | null;
  createdAt: Date;
  listings: DetailListingRow[];
}

/**
 * The detail item: the list item's shape plus `removedListings[]`,
 * `createdByBatchId` and `createdAt` (`specs/api.md` §6.3).
 *
 * ⚠ `badges` is built from the ACTIVE listings only, exactly as in the list
 * (REQ-026). This handler receives ALL listings — that is the point, since
 * `removedListings[]` needs the others — so the split happens here, and
 * getting it wrong would put a removed service's badge back on the row in the
 * one view that shows removals next to it.
 */
export function toDetailItem(row: TitleDetailRow, metadataStale = false): Record<string, unknown> {
  const active = row.listings.filter((listing) => listing.state === 'active');
  const removed = row.listings.filter((listing) => listing.state !== 'active');

  return {
    ...toListItem({ ...row, listings: active }, metadataStale),
    removedListings: removed.map(toRemovedListing),
    createdByBatchId: row.createdByBatchId,
    createdAt: row.createdAt.toISOString(),
  };
}

export function registerTitleRoutes(router: Router): void {
  router.get('/titles', async (req, res) => {
    const ownerId = requireOwnerId(req);

    // Validated BEFORE the store lookup: a malformed query must be a 400
    // whatever is in the database, and every rejection path stays reachable
    // without one, which is what lets the unit suite assert them.
    const query = parseTitleListQuery(req.query);
    let categoryPending = 0;
    if (query.categories.length > 0) {
      const pending = await listUnclassifiedTitles(ownerId);
      await markCategoryAttempt(
        ownerId,
        pending.map((row) => row.id),
      );
      await refreshStaleMetadata(
        ownerId,
        pending.map((row) => ({ ...row, tmdbFetchedAt: null })),
      );
      categoryPending = await countUnclassifiedTitles(ownerId);
    }

    // REQ-041 / `A53`, `specs/api.md` §6.2a — THE PRICE OF A RATING SORT.
    //
    // ⚠ **BEFORE THE ORDERED READ, AND OVER THE WHOLE FILTERED SET.** Every
    // other sort key is stable absent an owner edit: the date is
    // theirs, the year and the runtime are properties of the work. The rating
    // is not — it is fetched from OMDb and it changes. Leaving the refresh
    // where it is for every other sort (AFTER `res.json`, see
    // `refreshRatings.ts`) would mean a background write reordering a list the
    // owner is already looking at, which product invariant 5 forbids outright.
    // Running it here, synchronously, inside the request that asked for a
    // rating-ordered list, keeps the write owner-initiated — `T-CI-005`'s
    // process count does not move, because this makes the work MORE inside the
    // owner's action, not less.
    //
    // ⚠ **THE PAGE IS THE WRONG SCOPE AND IT IS THE OBVIOUS ONE.** Refreshing
    // only the rows this page will return computes the order from stale values
    // and renders fresh ones into it — an 8.4 below a 7.1, with no error
    // anywhere. Hence `listTitleRatingRows`, which is filtered but not paged.
    //
    // ⚠ **BOUNDED, AND WHAT IT MISSES IS NOT AN ERROR.** Rows the ceiling or
    // the deadline does not reach keep their cached-or-absent value and sort
    // on it (`T-API-025`). That is honest: it is the same number the row
    // displays.
    if (query.sort === 'rating') {
      // ⚠ **THE SWEEP CANNOT FAIL THE LIST** (`T-API-025`). `runRatingRefresh`
      // is documented never to reject, but the owner's list is the subject of
      // this page and the rating is decoration on it — resting a 200 on
      // another module's promise not to throw means a bug there takes the
      // whole list down, and the owner sees an error where they asked for
      // their watchlist. Rows this pass did not reach keep their
      // cached-or-absent value and are ordered on it, which is honest: it is
      // the same number the row displays. The scope query is inside the guard
      // for the same reason.
      try {
        const sweepRows = await listTitleRatingRows(ownerId, {
          watching: query.watching,
          priorities: query.priorities,
          q: query.q,
          services: query.services,
          mediaType: query.mediaType,
          categories: query.categories,
          genres: query.genres,
          runtimes: query.runtimes,
        });
        await runRatingRefresh(ownerId, sweepRows, {
          limit: IMDB_SWEEP_PER_REQUEST,
          deadline: new Date(Date.now() + IMDB_SWEEP_BUDGET_MS),
        });
      } catch {
        // Deliberately swallowed. See above.
      }
    }

    const { rows, hasMore } = await listTitlePage(ownerId, {
      watching: query.watching,
      priorities: query.priorities,
      q: query.q,
      limit: query.limit,
      dir: query.dir,
      cursor: query.cursor,
      services: query.services,
      mediaType: query.mediaType,
      categories: query.categories,
      genres: query.genres,
      runtimes: query.runtimes,
      sort: query.sort,
    });

    // REQ-035, `specs/api.md` §6.2. `null` when no runtime filter is active
    // and a NUMBER when one is — including `0`. The two are different states:
    // a `0` that means "not asked" cannot later be told apart from a `0` that
    // means "asked, none hidden", and the UI renders the disclosure for
    // neither. The count is skipped entirely when no filter is active, so the
    // default list still costs exactly what it did before.
    const runtimeUnknownHidden =
      query.runtimes.length === 0
        ? null
        : await countRuntimeUnknown(ownerId, {
            watching: query.watching,
            priorities: query.priorities,
            q: query.q,
            services: query.services,
            mediaType: query.mediaType,
            categories: query.categories,
            genres: query.genres,
          });

    // REQ-076 / NFR-014, `specs/api.md` §6.4. BEFORE the response, and only
    // for the rows on this page: `metadataStale` has to be on the item being
    // served, so the attempt must finish first. Bounded by the 5 s budget in
    // `tmdbRefresh.ts`; a page with nothing stale on it costs one array scan.
    const refreshable = rows.map((row) => toRefreshableTitle(row as unknown as TitleRow));
    // Category-filtered pages must render the same metadata that SQL filtered.
    const refresh: MetadataRefreshResult =
      query.categories.length > 0
        ? {
            stale: new Set(staleTitles(refreshable, new Date()).map((row) => row.id)),
            refreshed: new Map(),
          }
        : await refreshStaleMetadata(ownerId, refreshable);
    const items = rows.map((row) => {
      const typed = applyRefresh(row as unknown as TitleRow, refresh);
      return toListItem(typed, refresh.stale.has(typed.id));
    });
    // The cursor is built from the LAST ROW RETURNED, never from a count or an
    // index. That is what makes it a position rather than an offset, and it is
    // why a row inserted between two requests cannot shift the page boundary.
    //
    // ⚠ IT IS BUILT FROM THE KEY THE LIST IS ACTUALLY ORDERED BY. A date
    // cursor against a runtime-ordered list is a keyset that does not mirror
    // its own `ORDER BY`, and such a predicate skips or repeats rows at every
    // page boundary — indistinguishable from data loss, and invisible to any
    // test that never asks for a second page.
    //
    // ⚠ THE NULL GUARD IS PER SORT, AND ONLY THE DATE SORT HAS ONE. A row with
    // no `sortDateAdded` cannot be encoded as a date position, so the list
    // honestly stops there. A row with no RUNTIME, YEAR or RATING can be:
    // `null` is a real, encodable position at the end of each of those orders,
    // and refusing it would truncate every such list at the first unknown
    // value — silently, and exactly where the owner is least able to notice.
    const last = rows.at(-1);
    const lastRow = last === undefined ? undefined : (last as unknown as TitleRow);
    const nextCursor = !hasMore
      ? null
      : query.sort === 'watchPriority'
        ? lastRow === undefined
          ? null
          : encodeWatchPriorityCursor({
              watchPriorityRank: watchPriorityRank({
                watching: lastRow.watching ?? false,
                priority: lastRow.priority ?? 'normal',
              }),
              id: lastRow.id,
            })
        : query.sort === 'runtime'
          ? lastRow === undefined
            ? null
            : encodeRuntimeCursor({
                runtimeMinutes: lastRow.tmdbRuntimeMinutes,
                id: lastRow.id,
              })
          : query.sort === 'releaseYear'
            ? lastRow === undefined
              ? null
              : encodeReleaseYearCursor({
                  releaseYear: lastRow.tmdbReleaseYear,
                  id: lastRow.id,
                })
            : query.sort === 'rating'
              ? lastRow === undefined
                ? null
                : encodeRatingCursor({
                    ratingTenths: lastRow.imdbRatingTenths ?? null,
                    id: lastRow.id,
                  })
              : query.sort === 'name'
                ? lastRow === undefined
                  ? null
                  : // ⚠ THE STORED KEY, NOT THE DISPLAYED TITLE. They differ
                    // whenever a leading article was stripped — the row shown as
                    // *The Matrix* sits at position `Matrix` — so a cursor built
                    // from the visible name names the wrong place in the order
                    // and page two silently starts past the rows in between.
                    encodeNameCursor({ sortName: lastRow.sortName ?? null, id: lastRow.id })
                : last?.sortDateAdded != null
                  ? encodeCursor({ sortDateAdded: toIsoDate(last.sortDateAdded), id: last.id })
                  : null;

    res
      .status(200)
      .json({ items, nextCursor, limit: query.limit, runtimeUnknownHidden, categoryPending });

    // REQ-090. AFTER the response, deliberately — see `refreshRatings.ts`.
    // The owner's list is already on the wire; anything stale here shows up on
    // the next render. Awaiting this would charge every page load for up to
    // eight serial calls to a free-tier API, for decoration.
    beginRatingRefresh(
      ownerId,
      rows.map((row) => toRatingRow(row as unknown as TitleRow)),
    );
  });

  /**
   * `GET /api/titles/:titleId` (§6.3, TASK-034, `T-LIST-028`).
   *
   * ⚠ A row belonging to another owner answers **404, never 403**. 403 would
   * confirm the id exists, which turns id enumeration into a membership
   * oracle — the caller learns the owner's inventory without reading a single
   * title. `findTitleDetail` is owner-scoped, so a foreign id and a missing id
   * arrive here as the same `null` and cannot be told apart by construction
   * rather than by this handler remembering to conflate them (`T-SEC-002`).
   */
  router.get('/titles/:titleId', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const titleId = req.params.titleId ?? '';

    const row = await findTitleDetail(ownerId, titleId);
    if (row === null) {
      throw new AppError('NOT_FOUND', 404, 'No such title.');
    }

    // §6.4 names this route too: a detail view is a display, so the same lazy
    // refresh applies to the one row it renders.
    const typed = row as unknown as TitleDetailRow;
    const refresh = await refreshStaleMetadata(ownerId, [toRefreshableTitle(typed)]);

    const presentation = await readTitlePresentation(ownerId, row);
    const suppression = await findActiveSuppression(ownerId, row.workIdentity);
    res.status(200).json({
      ...toDetailItem(applyRefresh(typed, refresh), refresh.stale.has(typed.id)),
      presentation,
      listState:
        suppression !== null ? 'suppressed' : row.state === 'active' ? 'active' : 'removed',
    });
  });
}
