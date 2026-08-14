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

import { dateAddedLabel } from '@nextup/domain';
import { type Router } from 'express';

import { encodeCursor } from '../pagination.js';
import { AppError } from '../errors/AppError.js';
import { findTitleDetail, listTitlePage } from '../repository/ownerData.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import { parseTitleListQuery } from './titlesQuery.js';

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
  id: string;
  workIdentity: string;
  matchState: string;
  rawExtractedText: string | null;
  sortDateAdded: Date | null;
  tmdbMediaType: string | null;
  tmdbName: string | null;
  tmdbReleaseYear: number | null;
  tmdbRuntimeMinutes: number | null;
  tmdbGenres: string;
  tmdbPosterPath: string | null;
  listings: ListingRow[];
}

/**
 * One list item.
 *
 * `name` falls back to the raw extracted text for an UNMATCHED title. There is
 * no third option: a row with no name at all is unusable, and inventing a
 * placeholder would hide from the owner that the title never matched — which
 * is the state the fix-match flow exists to resolve.
 */
export function toListItem(row: TitleRow): Record<string, unknown> {
  const badges = row.listings.map((listing) => ({
    service: listing.service,
    listingId: listing.listingId,
    dateAdded: toIsoDate(listing.dateAdded),
  }));

  const sortDateAdded = row.sortDateAdded === null ? null : toIsoDate(row.sortDateAdded);

  return {
    titleId: row.id,
    workIdentity: row.workIdentity,
    matchState: row.matchState,
    name: row.tmdbName ?? row.rawExtractedText ?? '',
    mediaType: row.tmdbMediaType,
    releaseYear: row.tmdbReleaseYear,
    genres: parseGenres(row.tmdbGenres),
    runtimeMinutes: row.tmdbRuntimeMinutes,
    posterPath: row.tmdbPosterPath,
    badges,
    sortDateAdded,
    // Computed server-side so REQ-061's "to nextup" wording has exactly one
    // implementation; the SPA renders this verbatim (`specs/ui.md` §row).
    dateAddedLabel: sortDateAdded === null ? null : dateAddedLabel(sortDateAdded),
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
export function toDetailItem(row: TitleDetailRow): Record<string, unknown> {
  const active = row.listings.filter((listing) => listing.state === 'active');
  const removed = row.listings.filter((listing) => listing.state !== 'active');

  return {
    ...toListItem({ ...row, listings: active }),
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

    const { rows, hasMore } = await listTitlePage(ownerId, {
      limit: query.limit,
      dir: query.dir,
      cursor: query.cursor,
      services: query.services,
      mediaType: query.mediaType,
      genres: query.genres,
    });

    const items = rows.map((row) => toListItem(row as unknown as TitleRow));

    // The cursor is built from the LAST ROW RETURNED, never from a count or an
    // index. That is what makes it a position rather than an offset, and it is
    // why a row inserted between two requests cannot shift the page boundary.
    const last = rows.at(-1);
    const nextCursor =
      hasMore && last?.sortDateAdded != null
        ? encodeCursor({ sortDateAdded: toIsoDate(last.sortDateAdded), id: last.id })
        : null;

    res.status(200).json({ items, nextCursor, limit: query.limit });
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

    res.status(200).json(toDetailItem(row as unknown as TitleDetailRow));
  });
}
