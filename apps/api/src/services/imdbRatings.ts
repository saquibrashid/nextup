/**
 * The IMDb rating cache and its lazy refresh (REQ-090, REQ-093, ADR-0011).
 *
 * ⚠ **THIS IS NOT A JOB, AND IT MUST NEVER BECOME ONE.** Product invariant 5
 * permits exactly three non-owner-initiated processes, and this is the third —
 * admissible only because it is **access-triggered**, touches **one
 * display-only numeric field**, and can therefore change no membership, no
 * ordering and no service badge. There is no timer, no sweep, no backfill.
 * `T-CI-005` / `T-MUT-001f` hold the line.
 *
 * ⚠ **REQ-095 IS WHY THIS IS ALLOWED AT ALL.** The rating is never a sort key.
 * The moment a list could be ordered by rating, a background write to a rating
 * would reorder the list, and the refresh would be squarely inside invariant 5.
 * Adding a rating sort is therefore not a UI change — it invalidates this
 * file's right to exist.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 *
 * Deciding *what* to refresh is a pure function (`selectForRefresh`) and doing
 * it is a separate, injectable one. That split is deliberate: the decision
 * carries every rule that can be got wrong quietly — staleness, the "asked and
 * there was none" state, the per-request ceiling — and none of them should
 * need a network or a database to test.
 */

import { IMDB_RATING_MAX_AGE_DAYS } from '../config.js';
import { isImdbId, type OmdbClient } from '../clients/omdbClient.js';

/**
 * The most ratings one page render may refresh.
 *
 * ⚠ A ceiling, not a target, and it is NOT the daily budget. The budget stops
 * the process spending more than OMDb allows in a day; this stops a single
 * render spending a large share of it at once — a first load of a 200-row list
 * would otherwise fire 200 serial requests and hold the page open for minutes.
 * The rest simply refresh on the next render, which is what "lazy" means.
 */
export const IMDB_REFRESH_PER_REQUEST = 8;

/** A stored rating, as the refresh sees it. */
export interface RatingRow {
  /** The Title row id. */
  id: string;
  /** From TMDB (REQ-094). `null` when TMDB has no IMDb mapping. */
  imdbId: string | null;
  /** Tenths, 1..100. `null` for "asked, none available" or "never asked". */
  imdbRatingTenths: number | null;
  /** When OMDb was last asked. `null` means never. */
  imdbRatingFetchedAt: Date | null;
}

/** What one refresh decided to write. */
export interface RatingWrite {
  id: string;
  imdbRatingTenths: number | null;
  imdbRatingFetchedAt: Date;
}

const MS_PER_DAY = 86_400_000;

/**
 * Is this row's rating old enough to re-ask?
 *
 * ⚠ **`fetchedAt === null` means NEVER ASKED, and that is stale.** It does not
 * mean "no rating exists" — that state is a non-null `fetchedAt` with a null
 * rating, which is exactly what stops an unrated work being re-queried on
 * every single render. Conflating the two gives one of two silent bugs: either
 * nothing is ever fetched, or every unrated work is fetched for ever.
 */
export function isRatingStale(row: RatingRow, now: Date): boolean {
  if (!isImdbId(row.imdbId)) return false;
  if (row.imdbRatingFetchedAt === null) return true;
  const ageDays = (now.getTime() - row.imdbRatingFetchedAt.getTime()) / MS_PER_DAY;
  return ageDays >= IMDB_RATING_MAX_AGE_DAYS;
}

/**
 * Which of the rows on this page should be re-asked, in order, bounded.
 *
 * Pure. No I/O, no clock of its own, no budget mutation — so every rule below
 * is testable in microseconds and none of them can be right by accident.
 *
 * @param rows   the rows about to be RENDERED. Never a table scan: passing
 *               anything wider than the current page turns lazy refresh into
 *               the backfill sweep REQ-090 forbids.
 * @param budget how many OMDb calls remain today (`omdbBudgetRemaining()`).
 */
export function selectForRefresh(
  rows: readonly RatingRow[],
  now: Date,
  budget: number,
  limit: number = IMDB_REFRESH_PER_REQUEST,
): RatingRow[] {
  const ceiling = Math.max(0, Math.min(limit, budget));
  if (ceiling === 0) return [];

  const out: RatingRow[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    if (out.length >= ceiling) break;
    if (!isRatingStale(row, now)) continue;
    // Two Title rows can legitimately share one work identity and therefore one
    // IMDb id (a reappearance is a brand-new row — product invariant 7). Asking
    // OMDb the same question twice in one render would spend budget to get the
    // same answer.
    const key = row.imdbId as string;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }

  return out;
}

/** Convert an OMDb rating (1.0–10.0) to the stored tenths, or `null`. */
export function toTenths(rating: number | null): number | null {
  if (rating === null || !Number.isFinite(rating)) return null;
  const tenths = Math.round(rating * 10);
  // Mirrors `ck_title_imdb_rating_range`. A value outside the scale is a bug
  // upstream, and storing it would fail the write anyway — better to record
  // "unknown", which is true, than to break the page.
  if (tenths < 1 || tenths > 100) return null;
  return tenths;
}

/** Convert stored tenths back to the displayed rating. `null` stays `null`. */
export function fromTenths(tenths: number | null): number | null {
  if (tenths === null || !Number.isInteger(tenths)) return null;
  if (tenths < 1 || tenths > 100) return null;
  return tenths / 10;
}

export interface RefreshDeps {
  client: Pick<OmdbClient, 'getRating'>;
  /** Remaining calls in today's budget. */
  budget: number;
  now?: () => Date;
  limit?: number;
}

/**
 * Refresh the stale ratings among `rows` and return the writes to persist.
 *
 * ⚠ **SERIAL, AND DEGRADES TO SILENCE.** Requests are issued one at a time —
 * a page render is not a reason to open eight sockets to a free-tier API — and
 * a transport failure ENDS the pass rather than being retried per row. If OMDb
 * is down for one id it is down for all of them, and continuing would spend the
 * whole per-request ceiling discovering that eight times.
 *
 * ⚠ **It never throws.** The rating is decoration on a page whose actual
 * subject is the owner's list. A caller that has to wrap this in a try/catch to
 * avoid 500-ing the list has been handed the wrong contract.
 *
 * ⚠ **A null rating is still WRITTEN, with a timestamp.** "We asked OMDb and it
 * has no rating" is a real, cacheable answer. Skipping the write because the
 * value is null makes every unrated work permanently stale and re-queried on
 * every render — the exact budget leak REQ-093 exists to prevent.
 */
export async function refreshRatings(
  rows: readonly RatingRow[],
  deps: RefreshDeps,
): Promise<RatingWrite[]> {
  const now = deps.now ?? ((): Date => new Date());
  const due = selectForRefresh(rows, now(), deps.budget, deps.limit);
  const writes: RatingWrite[] = [];

  for (const row of due) {
    try {
      const result = await deps.client.getRating(row.imdbId as string);
      writes.push({
        id: row.id,
        imdbRatingTenths: toTenths(result.rating),
        imdbRatingFetchedAt: now(),
      });
    } catch {
      // Transport failure. Stop the pass; keep what already succeeded. The
      // rows not reached stay stale and are simply retried on a later render.
      break;
    }
  }

  return writes;
}
