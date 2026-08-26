/**
 * TASK-083 — full-update removal computation (US-014, REQ-015 / REQ-019 /
 * REQ-073).
 *
 * A removal proposal is the only place in this product where the app suggests
 * taking something OFF the owner's list, so every exclusion here is a safety
 * rule rather than a filter, and each one is asserted by a named test:
 *
 * | rule | why | test |
 * |---|---|---|
 * | service-scoped | a Netflix batch says nothing about Max | `T-REM-010` |
 * | `active` only | an already-removed listing must not be proposed twice | `T-REM-013` |
 * | suppressed excluded | the owner already said "not interested" (REQ-073) | `T-SUP-004` |
 *
 * ⚠ **This module is pure and knows nothing about the mode.** It computes the
 * set difference and nothing else; `buildReviewResponse` decides whether the
 * owner is allowed to SEE it (append-only omits it, a low-yield or degraded
 * read withholds it). Keeping the two apart is deliberate — a computation that
 * also decided visibility would make "we found nothing to remove" and "we are
 * not going to tell you" the same value, which is product invariant 2 in a
 * different costume.
 *
 * ⚠ It was extracted from `apps/api/src/routes/batchReview.ts`, where it lived
 * inline. Behaviour is unchanged; the reason to move it is that the rules above
 * were only reachable through a database and an HTTP round trip, and rules this
 * consequential should be assertable in microseconds against a plain object.
 */

import type { Service } from './enums.js';
import type { ReviewRemovalItem } from './review.js';
import type { IsoDate } from './types.js';

/** One active listing as the caller has it, before any removal rule applies. */
export interface RemovalCandidateListing {
  listingId: string;
  titleId: string;
  workIdentity: string;
  /**
   * The listing's stored state. Carried rather than assumed: the repository
   * read hard-codes `active` today, but a future caller that relaxes it must
   * be refused HERE rather than silently proposing an already-removed listing
   * for removal a second time (`T-REM-013`).
   */
  state: string;
  service: Service;
  /** TMDB name when there is one. */
  tmdbName: string | null;
  /** The extracted text an unmatched title was created from. */
  rawExtractedText: string | null;
  releaseYear: number | null;
  posterPath: string | null;
  dateAdded: IsoDate;
}

export interface ComputeRemovalsInput {
  /** The batch's service. Listings on any other service are out of scope. */
  service: Service;
  activeListings: readonly RemovalCandidateListing[];
  /**
   * Work identities that a SURVIVING candidate in this batch resolved to.
   *
   * ⚠ SD-02 collapse losers must already be excluded by the caller, and
   * discarded rows must NOT be: a rejected candidate keeping a title alive is
   * a bug, but a collapse loser's identity lives on in its survivor.
   */
  extractedWorkIdentities: ReadonlySet<string>;
  /** Suppressed work identities (REQ-071 — keyed on identity, never a row id). */
  suppressed: ReadonlySet<string>;
}

/**
 * The listings this full-update batch proposes removing.
 *
 * Order follows the input, so the owner sees them in the same order twice.
 * `ticked` is not set here — `buildReviewResponse` owns REQ-055.
 */
export function computeRemovals(input: ComputeRemovalsInput): Omit<ReviewRemovalItem, 'ticked'>[] {
  return (
    input.activeListings
      // ⚠ Service scope FIRST. A Netflix screenshot is evidence about Netflix
      // and about nothing else; without this a full-update on one service
      // proposes emptying the other (`T-REM-010`).
      .filter((listing) => listing.service === input.service)
      // Only an ACTIVE listing can disappear. A removed one already did, and
      // re-proposing it would let a second full-update batch re-remove a listing
      // the owner restored in between (`T-REM-013`).
      .filter((listing) => listing.state === 'active')
      // REQ-073. The owner said they were not interested; asking again on every
      // full-update batch is the app arguing with them (`T-SUP-004`).
      .filter((listing) => !input.suppressed.has(listing.workIdentity))
      // The actual set difference: still on the list, not in the screenshots.
      .filter((listing) => !input.extractedWorkIdentities.has(listing.workIdentity))
      .map((listing) => ({
        listingId: listing.listingId,
        titleId: listing.titleId,
        // ⚠ An unmatched title has no TMDB name — its raw text IS its name.
        // Rendering an empty string here would offer the owner an anonymous row
        // to tick, and ticking it removes something they cannot identify
        // (`T-UNM-011`).
        name: listing.tmdbName ?? listing.rawExtractedText ?? '',
        releaseYear: listing.releaseYear,
        posterPath: listing.posterPath,
        service: listing.service,
        dateAdded: listing.dateAdded,
      }))
  );
}
