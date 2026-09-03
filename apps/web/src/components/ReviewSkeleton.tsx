// `specs/ux-states.md` §6.1 (`T-UX-060`) — the review's loading state.
//
// ⚠ **THE COUNT IS CARRIED FORWARD, NOT FETCHED.** §6.1 as first written said
// the counts were "already shown from `GET /api/batches/:batchId`". They are
// not obtainable from it: that payload carries `candidateCount` PER IMAGE and
// nothing about sections, because sectioning (`sectionForCandidate`,
// `packages/domain/src/review.ts`) happens when the review is built. Issuing a
// second request here to find out how many placeholders to draw would make the
// loading state slower than the thing it is covering for, so the count rides
// along in history state from the screen the owner came from.
//
// ⚠ **DECORATION, THEREFORE `aria-hidden`.** The announced loading state is the
// sibling `role="status"` paragraph. A screen reader that also walked a row of
// empty placeholders would hear the wait described twice, once meaninglessly.
import type { JSX } from 'react';

/**
 * The most placeholders this will ever draw.
 *
 * ⚠ A RENDER GUARD, NOT A STYLE CHOICE. The count arrives from history state,
 * which survives a reload and a back button and can be restored by the browser
 * across a deploy — so it is untrusted input that reaches a loop bound. A
 * screenful is all a skeleton is for; anything past it is invisible work.
 */
export const REVIEW_SKELETON_MAX = 24;

export interface ReviewSkeletonProps {
  /** How many cards to draw, or `null` for the countless placeholder. */
  readonly count: number | null;
}

export function ReviewSkeleton({ count }: ReviewSkeletonProps): JSX.Element {
  if (count === null) {
    return (
      <div data-testid="review-skeleton" data-count="unknown" aria-hidden="true">
        <div data-testid="review-skeleton-block" />
      </div>
    );
  }

  return (
    <div data-testid="review-skeleton" data-count={String(count)} aria-hidden="true">
      {Array.from({ length: count }, (_unused, index) => (
        <div key={index} data-testid="review-skeleton-card" />
      ))}
    </div>
  );
}

/**
 * Narrows a `location.state` to a skeleton card count.
 *
 * ⚠ **VALIDATED, NEVER CAST** — the same rule `parseAppliedState` follows in
 * `containers/ListRoute.tsx`, for the same reason: history state is not
 * trusted input.
 *
 * ⚠ Anything unusable becomes `null`, which renders the COUNTLESS skeleton.
 * There is no safe default count: a guessed number of placeholders is a claim
 * about how much was read from the owner's screenshots, and a wrong one is a
 * lie told on the one screen whose job is to show what was found.
 *
 * `0` is deliberately treated as unusable. A batch with nothing extracted never
 * reaches this state — it is §6.2/§6.3 — so a zero here means the count was
 * lost, not that the answer is none.
 */
export function parseSkeletonCount(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) return null;
  const raw = (state as { skeletonCount?: unknown }).skeletonCount;
  // ⚠ THE `typeof` CHECK IS NOT REDUNDANT WITH `Number.isInteger`, though a
  // mutation run will tell you it is: at RUNTIME it is dead (`isInteger`
  // already rejects every non-number), so no test can kill its removal. It is a
  // TYPE guard — `Number.isInteger` carries no type predicate, so without it
  // `raw` stays `unknown` and `Math.min` below does not compile. `tsc` is what
  // fails when it goes, and that was verified by deleting it and running one.
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) return null;
  return Math.min(raw, REVIEW_SKELETON_MAX);
}
