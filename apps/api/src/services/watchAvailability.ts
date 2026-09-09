/**
 * TASK-187 — the watch-availability refresh: lazy, on access, metadata-only
 * (REQ-086, US-042, ADR-0010).
 *
 * ⚠ **THIS IS NOT A JOB, AND IT MUST NEVER BECOME ONE.** Product invariant 5
 * permits exactly four non-owner-initiated processes, and this is the fourth —
 * admissible only because it is **access-triggered** and **metadata-only**. It
 * creates, deletes and re-states no `Title`, no `ServiceListing` and no
 * `Suppression`, and it satisfies no intent on its own, so it can change no
 * membership, no ordering and no service badge. There is no timer, no sweep,
 * no backfill. `T-CI-005` and `T-AVAIL-002b` hold the line.
 *
 * ⚠ **THE ONE RULE THAT INVERTS THE FEATURE IF GOT WRONG.** TMDB reports
 * `flatrate`, `rent`, `buy`, `ads` and `free`. Only `flatrate` counts. A work
 * the owner can RENT is exactly what they are waiting to escape (US-042 AC-5),
 * so a rent-only offer leaves the intent waiting and unflagged. The filtering
 * happens in `TmdbClient.getWatchProviders`; `flaggedProvidersFor` below is
 * the second half — which of those subscription providers are services the
 * owner actually has.
 *
 * ── The shape ───────────────────────────────────────────────────────────────
 *
 * Deciding *what* to refresh is a pure function (`selectForAvailabilityRefresh`)
 * and doing it is a separate, injectable one, exactly as the IMDb rating cache
 * is split. The decision carries every rule that can be got wrong quietly —
 * staleness, the never-checked state, the per-request ceiling, the region —
 * and none of them should need a network or a database to test.
 */

import { SERVICES, type Service } from '@nextup/domain';

import { WATCH_PROVIDER_MAX_AGE_DAYS } from '../config.js';

/**
 * The region every availability answer in this product is computed for
 * (`ASM-059`, owner-confirmed at `A49`).
 *
 * ⚠ **Declared once, stored on the row, and passed explicitly at every call
 * site** (`T-AVAIL-010`). A hard-coded `'US'` scattered through the
 * availability path is unfindable the day it changes, and — the load-bearing
 * half — a stored value is the only way to tell an answer computed for one
 * region from one computed for another. Without it, changing the region would
 * silently reinterpret every cached row rather than invalidating it.
 */
export const DEFAULT_AVAILABILITY_REGION = 'US';

/**
 * The most intents one waiting-view render may refresh.
 *
 * ⚠ A ceiling, not a target. A first load of a long waiting list would
 * otherwise fire one TMDB request per row and hold the page open; the rest
 * simply refresh on the next render, which is what "lazy" means. Raising this
 * to cover the whole list turns the refresh into the sweep REQ-041 forbids.
 */
export const AVAILABILITY_REFRESH_PER_REQUEST = 8;

/** A waiting intent, as the refresh sees it. */
export interface IntentRow {
  id: string;
  workIdentity: string;
  /** From the title this intent is for. `null` ⇒ nothing to ask TMDB about. */
  tmdbId: number | null;
  tmdbMediaType: string | null;
  /** ⚠ Stored on the row, never assumed (`T-AVAIL-010`). */
  availabilityRegion: string;
  /** `null` means NEVER CHECKED, which is stale. */
  availabilityCheckedAt: Date | null;
  /** ⚠ `null` ≠ "not streaming anywhere" — it means NOT KNOWN (Trap 4). */
  availableOn: string[] | null;
}

/** What one refresh decided to write. Metadata-only, by construction. */
export interface AvailabilityWrite {
  id: string;
  availableOn: string[] | null;
  availabilityCheckedAt: Date;
  availabilityRegion: string;
}

const MS_PER_DAY = 86_400_000;

/**
 * Is this intent's availability old enough to re-ask?
 *
 * ⚠ **`availabilityCheckedAt === null` means NEVER ASKED, and that is stale.**
 * It does not mean "no provider streams it" — that state is a non-null
 * `checkedAt` with an empty `availableOn`. Conflating the two gives one of two
 * silent bugs: either nothing is ever checked, or a work nobody streams is
 * re-checked on every single render for ever.
 */
export function isAvailabilityStale(row: IntentRow, now: Date): boolean {
  // Nothing to ask about. An unmatched work has no TMDB id, and inventing a
  // request for one would spend the budget on a guaranteed 404.
  if (row.tmdbId === null || row.tmdbMediaType === null) return false;
  if (row.availabilityCheckedAt === null) return true;
  const ageDays = (now.getTime() - row.availabilityCheckedAt.getTime()) / MS_PER_DAY;
  return ageDays >= WATCH_PROVIDER_MAX_AGE_DAYS;
}

/**
 * Which of the intents on this page should be re-asked, in order, bounded.
 *
 * Pure. No I/O, no clock of its own — so every rule is testable in
 * microseconds and none of them can be right by accident.
 *
 * @param rows the intents about to be RENDERED. ⚠ Never a table scan: passing
 *             anything wider than the current page turns the lazy refresh into
 *             the backfill sweep REQ-041 forbids.
 */
export function selectForAvailabilityRefresh(
  rows: readonly IntentRow[],
  now: Date,
  limit: number = AVAILABILITY_REFRESH_PER_REQUEST,
): IntentRow[] {
  const stale: IntentRow[] = [];
  for (const row of rows) {
    if (stale.length >= limit) break;
    if (isAvailabilityStale(row, now)) stale.push(row);
  }
  return stale;
}

/**
 * Normalise a provider name for comparison against a `SERVICES` member.
 *
 * ⚠ TMDB's names are JustWatch's, and they carry qualifiers the owner's
 * services do not: "Netflix Standard with Ads", "Max Amazon Channel". Matching
 * on equality alone silently reports a work as unavailable on a service that
 * is streaming it right now.
 */
function normaliseProvider(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Which of the owner's services are among these subscription providers.
 *
 * ⚠ Returns `null` when availability is NOT KNOWN, and `[]` when it is known
 * and none of the owner's services carry it. TASK-188 renders those two
 * differently and must be able to: *"not seen on your services as of &lt;date&gt;"*
 * is honest about an unanswered question; *"not streaming anywhere"* is a
 * claim this data cannot support (ADR-0010 Trap 4).
 *
 * ⚠ This decides only what to FLAG. It adds nothing to the combined list —
 * that is US-042 AC-4 and the reason the whole refresh stays inside REQ-041.
 */
export function flaggedProvidersFor(availableOn: readonly string[] | null): Service[] | null {
  if (availableOn === null) return null;
  const seen = availableOn.map(normaliseProvider);
  return SERVICES.filter((service) => seen.some((name) => name.startsWith(service)));
}

/** The narrow slice of the TMDB client this refresh is allowed to reach. */
export interface WatchProviderSource {
  getWatchProviders(
    mediaType: 'movie' | 'tv',
    tmdbId: number,
    region: string,
  ): Promise<string[] | null>;
}

/**
 * Ask TMDB about the selected intents and return what to write.
 *
 * ⚠ **A FAILED LOOKUP WRITES NOTHING FOR THAT ROW.** TMDB being unreachable is
 * a first-class state, not an error to swallow into a null: writing
 * `availableOn = null` on a failure would erase a known-good answer and, with
 * Trap 4's rendering rule, downgrade the row to "not known" — the owner would
 * watch their availability data evaporate every time TMDB had a bad minute.
 * The row simply stays stale and is retried on the next render, and TASK-188
 * renders the last-known answer with its as-of date.
 *
 * ⚠ **Serial, not parallel.** The container is 0.25 vCPU / 0.5 GiB and the
 * TMDB client rate-limits internally; issuing eight at once buys a page render
 * nothing and makes the failure modes concurrent.
 */
export async function refreshAvailability(
  rows: readonly IntentRow[],
  source: WatchProviderSource,
  now: Date,
): Promise<AvailabilityWrite[]> {
  const writes: AvailabilityWrite[] = [];

  for (const row of rows) {
    const mediaType = row.tmdbMediaType;
    if (row.tmdbId === null || (mediaType !== 'movie' && mediaType !== 'tv')) continue;

    let providers: string[] | null;
    try {
      // ⚠ The region is PASSED, from the row. Never defaulted here — the whole
      // point of storing it is that a cached answer knows which question it
      // answered (`T-AVAIL-010`).
      providers = await source.getWatchProviders(mediaType, row.tmdbId, row.availabilityRegion);
    } catch {
      continue;
    }

    writes.push({
      id: row.id,
      availableOn: providers,
      availabilityCheckedAt: now,
      availabilityRegion: row.availabilityRegion,
    });
  }

  return writes;
}
