/**
 * `GET /api/removed` — the removed view (`specs/api.md` §6.9, US-023/US-024,
 * TASK-095).
 *
 * ⚠ THE REMOVED VIEW IS A HISTORICAL LOG, NOT A RECYCLE BIN (product invariant
 * 7, PRD R-4, US-024 AC-6). Three consequences this handler is responsible for:
 *
 *   1. **ONE ITEM PER REMOVED LISTING. NEVER DE-DUPLICATED.** A work removed
 *      three times legitimately occupies three rows here. Grouping them —
 *      even "helpfully", even behind a collapsed cluster — is explicitly out of
 *      scope in `specs/data-model.md` §11 and is asserted against by
 *      `T-REM-006`. It would also destroy the only record the owner has that a
 *      title keeps coming back, which is the reason the view exists.
 *   2. **`removalOrdinal` / `removalTotalForWork` are what make the repetition
 *      READ as history** rather than as duplicate rows.
 *   3. Nothing here restores anything. Restore is an explicit owner action
 *      through §6.10, never a consequence of looking at the log.
 *
 * There is no lazy metadata refresh on this route. §6.4 names the combined list
 * and the title detail, and only those: a removed row is a historical record,
 * and spending the page's latency budget refreshing metadata for titles the
 * owner has already taken off their list would be a poor trade. The stored
 * values are shown as they are.
 */

import { type Router } from 'express';

import {
  countRemovalsForWorks,
  findActiveSuppressedWorks,
  listRemovedView,
  type RemovedViewRow,
  type WorkRemovalRow,
} from '../repository/ownerData.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import { toIsoDate } from './titles.js';
import { encodeRemovedCursor, parseRemovedListQuery } from './removedQuery.js';

/** `removal N of M for this work`, keyed by listing id. */
export interface RemovalRank {
  ordinal: number;
  total: number;
}

/**
 * Rank every removal of every work on the page (US-024 AC-6, §11 rule 4).
 *
 * ⚠ ORDINAL 1 IS THE OLDEST REMOVAL, NOT THE NEWEST. The annotation reads
 * "removal 2 of 3", so it has to count forwards through history — numbering
 * from the newest would renumber every earlier row the next time the work was
 * removed, and an ordinal that changes retroactively is not a record of
 * anything. The PAGE is ordered newest-first; the ORDINAL is not, and the two
 * orderings are deliberately opposed.
 *
 * ⚠ Ranks are computed over the work's WHOLE removal history, never over the
 * filtered page — see `countRemovalsForWorks`, which is deliberately not given
 * the caller's filters.
 */
export function rankRemovals(rows: WorkRemovalRow[]): Map<string, RemovalRank> {
  const byWork = new Map<string, WorkRemovalRow[]>();
  for (const row of rows) {
    const bucket = byWork.get(row.work_identity);
    if (bucket === undefined) byWork.set(row.work_identity, [row]);
    else bucket.push(row);
  }

  const ranks = new Map<string, RemovalRank>();
  for (const bucket of byWork.values()) {
    // The repository returns oldest-first, but sorting here as well keeps this
    // function correct on its own terms: it is the unit-testable half, and a
    // pure function that silently depends on its caller's ORDER BY is a trap.
    const ordered = [...bucket].sort((a, b) => {
      const byTime = a.removed_at.getTime() - b.removed_at.getTime();
      if (byTime !== 0) return byTime;
      return a.listing_id < b.listing_id ? -1 : a.listing_id > b.listing_id ? 1 : 0;
    });
    const total = ordered.length;
    ordered.forEach((row, index) => {
      ranks.set(row.listing_id, { ordinal: index + 1, total });
    });
  }
  return ranks;
}

/**
 * One removed-view item (§6.9).
 *
 * `name` falls back to the raw extracted text for an UNMATCHED row, exactly as
 * the combined list does. A removed row is disproportionately likely to be
 * unmatched — a title nobody could identify is a title the owner is more likely
 * to have taken off the list — so the fallback is the normal case here, not an
 * edge case.
 *
 * ⚠ `restorable` is `!suppressed`, and nothing else. A duplicate active title
 * does NOT make a row unrestorable: §6.10 answers `DUPLICATE_WORK_IDENTITY`
 * with a confirmable 409, so the owner can still complete the restore. Folding
 * that case in here would grey out a control that actually works. Suppression
 * is different in kind — §6.10 refuses it outright until the work is
 * un-suppressed, so it is the one state where the affordance is genuinely dead.
 */
export function toRemovedItem(
  row: RemovedViewRow,
  rank: RemovalRank,
  suppressed: boolean,
): Record<string, unknown> {
  return {
    listingId: row.listing_id,
    titleId: row.title_id,
    workIdentity: row.work_identity,
    matchState: row.match_state,
    name: row.tmdb_name ?? row.raw_extracted_text ?? '',
    mediaType: row.tmdb_media_type,
    releaseYear: row.tmdb_release_year,
    posterPath: row.tmdb_poster_path,
    service: row.service,
    dateAdded: toIsoDate(row.date_added),
    // A timestamp, not a date: the log is ordered, and two removals on the same
    // day must stay distinguishable (product invariant 7).
    removedAt: row.removed_at.toISOString(),
    removedByBatchId: row.removed_by_batch_id,
    removedByGroupId: row.removed_by_group_id,
    removalOrdinal: rank.ordinal,
    removalTotalForWork: rank.total,
    restorable: !suppressed,
    suppressed,
  };
}

export function registerRemovedRoutes(router: Router): void {
  router.get('/removed', async (req, res) => {
    const ownerId = requireOwnerId(req);

    // Validated BEFORE the store lookup, so a malformed query is a 400
    // whatever is in the database.
    const query = parseRemovedListQuery(req.query);

    // One extra row decides `hasMore` without a COUNT. A COUNT over an
    // append-only log that grows for ever is exactly the unbounded cost
    // keyset pagination exists to avoid (NFR-018).
    const fetched = await listRemovedView(ownerId, {
      limit: query.limit + 1,
      ...(query.cursor === undefined
        ? {}
        : {
            cursor: {
              removedAt: new Date(query.cursor.removedAt),
              listingId: query.cursor.listingId,
            },
          }),
      ...(query.q === undefined ? {} : { q: query.q }),
      ...(query.service === undefined ? {} : { service: query.service }),
    });
    const hasMore = fetched.length > query.limit;
    const rows = hasMore ? fetched.slice(0, query.limit) : fetched;

    const works = [...new Set(rows.map((row) => row.work_identity))];
    const [removals, suppressed] = await Promise.all([
      countRemovalsForWorks(ownerId, works),
      findActiveSuppressedWorks(ownerId, works),
    ]);
    const ranks = rankRemovals(removals);

    const items = rows.map((row) =>
      toRemovedItem(
        row,
        // The fallback can only be reached if the row vanished between the two
        // reads, which soft-delete-forever makes impossible; "1 of 1" is still
        // the honest answer for a row we can see exactly once.
        ranks.get(row.listing_id) ?? { ordinal: 1, total: 1 },
        suppressed.has(row.work_identity),
      ),
    );

    // Built from the LAST ROW RETURNED, never from a count or an index — that
    // is what makes it a position rather than an offset, and why a removal
    // recorded between two requests cannot shift the page boundary.
    const last = rows.at(-1);
    const nextCursor =
      hasMore && last !== undefined
        ? encodeRemovedCursor({
            removedAt: last.removed_at.toISOString(),
            listingId: last.listing_id,
          })
        : null;

    res.status(200).json({ items, nextCursor, limit: query.limit });
  });
}
