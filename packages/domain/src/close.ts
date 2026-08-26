/**
 * TASK-071 — what closing a batch is allowed to apply, decided purely.
 *
 * `specs/api.md` §6.22. The I/O half lives in
 * `apps/api/src/services/batchClose.ts`; everything here is a decision over a
 * candidate list with no clock, no store and no transaction.
 *
 * WHY THE DECISION IS SEPARATE FROM THE WRITE
 * -------------------------------------------
 * Close is the one request in the product that changes the list itself, and it
 * does so inside a single transaction scoped to a single service (product
 * invariant 3). A rule that lived inside the transaction body could only be
 * tested through a database, so the cases that matter most — "a pending item
 * blocks", "a discarded item is not applied", "a collapsed loser is not applied
 * twice" — would each cost a round trip and would be tempting to skip. Pulled
 * out here they are ordinary unit tests.
 *
 * ⚠ THE SECTIONS ARE NOT RE-DERIVED HERE. `sectionForCandidate` from
 * `./review.js` is the single implementation, shared with `GET /review` and
 * `POST …/confirm-all`. A second, simpler rule in this file — "everything with
 * classification 'new'", say — would drift from what the owner was looking at
 * when they pressed the button, and the drift is invisible: the summary counts
 * come back plausible and the wrong rows are written.
 */

import type { ReviewCandidate } from './review.js';
import { sectionForCandidate, type ReviewSectionName } from './review.js';

/**
 * The two sections a close decision is made from.
 *
 * ⚠ `alreadyOnYourList` is deliberately absent. Those items are already on the
 * list for this service, so there is nothing to apply and — the load-bearing
 * half — nothing to block on: a full-update review that lists two hundred
 * known titles would otherwise be unclosable until the owner clicked every one
 * of them, which is exactly the "already on your list is READ-ONLY" contract
 * (US-013 AC-2).
 *
 * `probablyNotTitles` and `unreadableTiles` are absent for the same reason
 * from the other direction: they are collapsed by default, so blocking on them
 * would block on rows the owner has not been shown. REQ-012 requires them
 * classified and surfaced, never that they be individually dispositioned.
 */
export const CLOSE_DECIDABLE_SECTIONS: readonly ReviewSectionName[] = ['additions', 'unmatched'];

/** What kind of row a close will write for an applicable candidate. */
export type CloseApplicableKind = 'addition' | 'unresolved';

export interface CloseApplicable {
  candidate: ReviewCandidate;
  /**
   * `'unresolved'` is the US-008 keep-anyway path: the owner confirmed a title
   * TMDB could not identify, and it becomes a title in its own right under an
   * `unmatched:` identity rather than being dropped.
   */
  kind: CloseApplicableKind;
}

export interface CloseSummary {
  titlesCreated: number;
  listingsCreated: number;
  listingsRemoved: number;
  unresolvedKept: number;
  discarded: number;
  suppressedGated: number;
  removalGroupId: string | null;
}

/**
 * Is this candidate one the owner is being asked to decide?
 *
 * ⚠ A collapsed loser (SD-02) is NOT. It was absorbed into the survivor and is
 * never rendered, so it can never leave `pending` — counting it would make
 * every batch with a duplicate tile permanently unclosable, and the owner
 * would have no control to fix it with.
 */
function isDecidable(candidate: ReviewCandidate): boolean {
  return (
    candidate.collapsedIntoCandidateId === null &&
    CLOSE_DECIDABLE_SECTIONS.includes(sectionForCandidate(candidate))
  );
}

/**
 * The ids that must block the close with 409 `PENDING_ADDITIONS`.
 *
 * REQ-014's no-accept-by-inaction rule (US-012 AC-3): an undecided addition is
 * never applied and never silently skipped. Returned as ids, not a count,
 * because `details.pendingCandidateIds` is what lets the client scroll to and
 * focus the first pending card (`specs/ux-states.md` §6.14).
 *
 * Order follows the input, which is the order the review renders in, so
 * "the first pending card" means the same thing on both sides.
 */
export function pendingAdditionIds(candidates: readonly ReviewCandidate[]): string[] {
  return candidates
    .filter((candidate) => isDecidable(candidate) && candidate.disposition === 'pending')
    .map((candidate) => candidate.candidateId);
}

/**
 * The candidates a close will actually write, and what each becomes.
 *
 * Only `confirmed` and `corrected` are applied (US-012 AC-3). `discarded` is a
 * decision to write nothing — REQ-012 forbids deleting the candidate row, so
 * the record of the discard survives in the batch, but no title or listing is
 * created from it.
 */
export function applicableCandidates(candidates: readonly ReviewCandidate[]): CloseApplicable[] {
  return candidates
    .filter(
      (candidate) =>
        isDecidable(candidate) &&
        (candidate.disposition === 'confirmed' || candidate.disposition === 'corrected'),
    )
    .map((candidate) => ({
      candidate,
      kind: sectionForCandidate(candidate) === 'unmatched' ? 'unresolved' : 'addition',
    }));
}

/**
 * How many candidates the owner explicitly discarded.
 *
 * Counted across EVERY section, not just the decidable two: an item the owner
 * discarded out of `probablyNotTitles` is still a discard they performed, and
 * a summary that under-reported it would read as though the review had fewer
 * decisions in it than it did.
 */
export function discardedCount(candidates: readonly ReviewCandidate[]): number {
  return candidates.filter(
    (candidate) =>
      candidate.collapsedIntoCandidateId === null && candidate.disposition === 'discarded',
  ).length;
}
