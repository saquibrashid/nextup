/**
 * Per-service freshness (REQ-039, US-022) — `specs/api.md` §6.28,
 * `specs/ui.md` §2.1.
 *
 * ⚠ **This is a FACT, never a nudge.** At `A46` the owner dropped the
 * staleness concept outright: there is no threshold, no derived `stale` state,
 * no "you haven't updated in N days" prompt and no re-capture reminder.
 * `LIST_STALENESS_DAYS` and `T-FRESH-011` were deleted with it. **Do not
 * reintroduce any of them**, and do not read a threshold into `ageDays` —
 * it is the number the label is built from, not a trigger.
 *
 * What stays, and stays `must`, is the factual date: REQ-039 is the mandatory
 * mitigation for RSK-007, the list silently going out of date without the
 * owner noticing. Show the fact; never nag about it.
 *
 * ⚠ **"Stale" is overloaded in this codebase.** The TMDB `metadataStale` flag
 * and its 183-day lazy refresh (NFR-014) are a different, still-required
 * feature. Nothing here relates to it.
 */

import { SERVICE_LABELS } from './copy.js';
import type { Service } from './enums.js';

/** Milliseconds in a day — used only to turn two instants into a day count. */
const MS_PER_DAY = 86_400_000;

/**
 * Whole days between two instants, floored, never negative.
 *
 * Computed on **UTC day boundaries** rather than by dividing the raw
 * difference, so "today" means the same calendar day and not "less than 24
 * hours ago". A batch completed at 23:00 and read at 01:00 the next morning is
 * **1 day**, which is what the owner sees on a calendar; the naive division
 * would call it 0 and label it "today".
 *
 * Clamped at zero because a clock skew between the database and the container
 * can put `lastCompletedBatchAt` marginally in the future, and "updated -1
 * days ago" is a bug report. Zero degrades to "today", which is true enough.
 */
export function ageInDays(from: Date, now: Date): number {
  const fromDay = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((nowDay - fromDay) / MS_PER_DAY));
}

/**
 * The chip text for one service.
 *
 * `null` is **"never updated"**, explicitly not an error and explicitly not an
 * empty chip (US-022 AC-3). A service the owner has never captured is the
 * ordinary first-run state; rendering it as a failure would teach them to
 * distrust the strip on day one.
 *
 * The wording is fixed here rather than in the SPA so `specs/ui.md` §2.1 has
 * exactly one implementation, and so a reword is a single diff that fails a
 * single test.
 */
export function serviceFreshnessLabel(service: Service, ageDays: number | null): string {
  const name = SERVICE_LABELS[service];
  if (ageDays === null) return `${name} has never been updated`;
  if (ageDays === 0) return `${name} updated today`;
  if (ageDays === 1) return `${name} updated 1 day ago`;
  return `${name} updated ${String(ageDays)} days ago`;
}
