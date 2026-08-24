/**
 * The access trigger for the IMDb rating refresh (REQ-090, REQ-093, ADR-0011).
 *
 * ⚠ **THIS IS THE THIRD AND LAST PERMITTED NON-OWNER PROCESS.** Product
 * invariant 5 forbids any scheduler that changes user-visible list state.
 * This one is legal on three counts, all of which must stay true:
 *
 *   1. it is triggered by a READ of the rows it refreshes — never by a timer,
 *      a queue, a webhook or a sweep;
 *   2. it writes exactly two columns (`updateTitleRating` enforces that end);
 *   3. the rating is **display-only** (REQ-095) — not a sort key, not a
 *      filter. If that ever changes, a background write here would reorder
 *      the owner's list and this file becomes illegal, not merely impolite.
 *
 * ⚠ **IT RUNS AFTER THE RESPONSE, NOT BEFORE IT.** Eight serial calls to a
 * free-tier API would add seconds to a page whose actual subject is the
 * owner's list; the rating is decoration. So the handler answers from cache
 * (or from the honest "no rating" state) and the refresh lands in time for the
 * next render. That IS what "lazy" means here, and it is why a first-ever load
 * legitimately shows no ratings.
 *
 * The fire-and-forget shape, the `inFlight` map and the `…Settled` test seam
 * are copied deliberately from `startExtraction.ts` — see its header for why a
 * bare `void doWork()` is not good enough. The short version: the work races
 * the assertion on the next line of any test that triggers it, and an
 * unhandled rejection kills a single-process container.
 */

import { OmdbClient, omdbBudgetRemaining } from '../clients/omdbClient.js';
import { updateTitleRating, type OwnerId } from '../repository/ownerData.js';
import { refreshRatings, type RatingRow } from '../services/imdbRatings.js';

export interface RatingRefreshDeps {
  /** Injected in tests; built from the environment in production. */
  client?: Pick<OmdbClient, 'getRating'>;
  log?: (event: string, fields: Record<string, unknown>) => void;
  now?: () => Date;
  /** Overrides the module-scoped daily budget reading. */
  budget?: number;
}

/**
 * Refresh what is stale among `rows`, and persist it. Never rejects.
 *
 * Returns the number of rows written, for the log and for tests.
 */
export async function runRatingRefresh(
  ownerId: OwnerId,
  rows: readonly RatingRow[],
  deps: RatingRefreshDeps = {},
): Promise<number> {
  const log = deps.log ?? ((): void => undefined);

  // ⚠ Read from the environment at CALL time, not at module load. A key
  // supplied by a Container Apps secret is present from process start, but
  // reading it here keeps the module importable — and therefore testable —
  // in an environment that has no key at all.
  const apiKey = process.env['OMDB_API_KEY'] ?? '';

  // No key configured is a SUPPORTED state, not an error: REQ-091's "no
  // rating" is a first-class rendered state, so an unconfigured environment
  // shows the list with no ratings and nothing else changes. Logged once per
  // access rather than thrown, because the owner's list is unaffected.
  if (deps.client === undefined && apiKey === '') {
    log('imdb.refresh_skipped_no_key', { rows: rows.length });
    return 0;
  }

  const client = deps.client ?? new OmdbClient({ apiKey });
  const now = deps.now ?? ((): Date => new Date());

  try {
    const writes = await refreshRatings(rows, {
      client,
      budget: deps.budget ?? omdbBudgetRemaining(now()),
      now,
    });

    let written = 0;
    for (const write of writes) {
      try {
        await updateTitleRating(ownerId, write.id, {
          imdbRatingTenths: write.imdbRatingTenths,
          imdbRatingFetchedAt: write.imdbRatingFetchedAt,
        });
        written += 1;
      } catch (error) {
        // One row failing to persist is not a reason to drop the others. The
        // unwritten row simply stays stale and is retried on a later render.
        log('imdb.rating_write_failed', { titleId: write.id, error: String(error) });
      }
    }

    if (written > 0) log('imdb.ratings_refreshed', { written });
    return written;
  } catch (error) {
    // `refreshRatings` is documented never to throw, so reaching here means a
    // bug in this module or a dropped connection. Either way the list has
    // already been served; swallowing keeps the container alive.
    log('imdb.refresh_unexpected_error', { error: String(error) });
    return 0;
  }
}

/* ------------------------------------------------------------------ *
 * The fire-and-forget entry point, and its test seam
 * ------------------------------------------------------------------ */

const inFlight = new Set<Promise<void>>();

/**
 * Trigger a refresh for the rows just served, without waiting for it.
 *
 * ⚠ Called AFTER `res.json(...)`. Awaiting it would make every list render pay
 * for up to eight serial OMDb round trips.
 */
export function beginRatingRefresh(
  ownerId: OwnerId,
  rows: readonly RatingRow[],
  deps: RatingRefreshDeps = {},
): void {
  // Cheap guard so the common case — a page with nothing stale on it — costs
  // one array scan and never touches the environment or the clock.
  if (rows.length === 0) return;

  const run: Promise<void> = runRatingRefresh(ownerId, rows, deps)
    .then(() => undefined)
    // `.catch` is the belt to `runRatingRefresh`'s braces: an unhandled
    // rejection on a single-process container kills the API.
    .catch(() => undefined)
    .finally(() => {
      inFlight.delete(run);
    });
  inFlight.add(run);
}

/**
 * TEST SEAM. Resolves once every refresh started so far has settled, or
 * immediately if none is running. Never rejects.
 */
export async function ratingRefreshSettled(): Promise<void> {
  await Promise.all([...inFlight]);
}
