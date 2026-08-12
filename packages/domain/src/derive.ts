// Derived title fields — `specs/data-model.md` §5.
//
// These two functions are the ONLY place `title.state` and
// `title.sortDateAdded` are computed. `ownerData.ts` calls them on every write
// path; no route handler, UI component or test fixture recomputes them
// (`T-INV-009` greps for the logic appearing anywhere else).
//
// The reason is invariant I-4: the stored values must always equal what these
// functions return. A second implementation cannot be kept in step, and when
// it drifts the symptom is not an error — it is a row silently sorting into
// the wrong place, or a title appearing active when every listing is gone.

import type { TitleState } from './enums.js';
import type { ServiceListing } from './types.js';

/**
 * A title is `removed` only when **every** listing is removed (REQ-028).
 *
 * A title with zero listings cannot exist (invariant I-3), so the empty case is
 * not a meaningful input. `Array.prototype.every` returns `true` for it, which
 * would report `removed` — the safer of the two wrong answers, since it hides
 * a row rather than resurrecting one, but it is still wrong, so it throws.
 */
export function deriveTitleState(listings: readonly ServiceListing[]): TitleState {
  if (listings.length === 0) {
    throw new RangeError('a title must have at least one listing (invariant I-3)');
  }
  return listings.every((l) => l.state === 'removed') ? 'removed' : 'active';
}

/**
 * The EARLIEST `dateAdded` across the title's **non-removed** listings, or
 * `null` when every listing is removed (REQ-036).
 *
 * Earliest, not latest, and this is load-bearing. It is what makes adding an
 * already-saved work on a second service leave the row where it is
 * (US-020 AC-4, `T-LIST-014`) rather than jumping it to the top as though it
 * were new — while removing the earliest listing legitimately recomputes the
 * value and may move the row (US-020 AC-5, `T-LIST-015`).
 *
 * `null` sorts last under the default newest-first order (US-020 AC-7).
 *
 * Dates are `YYYY-MM-DD`, so a lexicographic comparison IS a chronological one;
 * no Date parsing is involved and no timezone can shift a day.
 */
export function deriveSortDateAdded(listings: readonly ServiceListing[]): string | null {
  let earliest: string | null = null;
  for (const listing of listings) {
    if (listing.state === 'removed') continue;
    if (earliest === null || listing.dateAdded < earliest) {
      earliest = listing.dateAdded;
    }
  }
  return earliest;
}
