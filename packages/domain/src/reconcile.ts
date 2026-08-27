/**
 * TASK-073 — batch reconciliation, run **once** over the union of every image
 * in the batch (US-005 AC-2, REQ-006).
 *
 * ⚠ **THE UNIT OF RECONCILIATION IS THE BATCH, NEVER THE IMAGE.** A saved list
 * does not fit on one screenshot, so a six-image full-update capture is one
 * statement about the service made in six parts. Reconciling per image would
 * evaluate each part as though it were the whole list, and every title that
 * happened to be photographed on image 4 would be "missing" from images 1, 2,
 * 3, 5 and 6 — proposing the removal of almost the entire service on a capture
 * that in fact confirmed it. That is the largest silent-loss failure available
 * in this product, and it is a natural shape for the code to take, because the
 * upload, the storage, the extraction and the OCR cross-check are all
 * genuinely per-image. This module exists to make the batch-scoped step a
 * NAMED, SEPARATELY TESTABLE boundary rather than an emergent property of
 * where a `for` loop happens to be closed (`T-BATCH-004`).
 *
 * ⚠ **A CANDIDATE MAY CARRY MORE THAN ONE SOURCE IMAGE, AND THE SAME WORK MAY
 * ARRIVE FROM SEVERAL.** Overlapping screenshots are expected — the owner
 * scrolls and shoots, and rows repeat across the seam (SD-02). The union is
 * therefore over WORK IDENTITIES, deduplicated, not over per-image lists
 * concatenated.
 *
 * ⚠ **PURE, AND IT DECIDES NOTHING ABOUT VISIBILITY.** Whether the owner may
 * SEE the removals is `buildReviewResponse`'s decision (append-only omits them;
 * a low-yield or degraded read withholds them). Keeping the two apart is what
 * makes "we found nothing to remove" and "we are not going to tell you"
 * different values rather than the same one — product invariant 2.
 */

import type { Service } from './enums.js';
import {
  computeRemovals,
  type RemovalCandidateListing,
  type ComputeRemovalsInput,
} from './removals.js';
import type { ReviewRemovalItem } from './review.js';

/**
 * One extraction candidate as reconciliation needs it.
 *
 * Deliberately narrow: reconciliation reads a candidate's identity, whether it
 * survived, and where it came from — nothing about its text, match confidence
 * or disposition. A wider input would invite a rule that belongs in
 * classification to be written here instead.
 */
export interface ReconcileCandidate {
  /** `null` while unmatched-and-unresolved; such a candidate cannot keep a listing alive. */
  resolvedWorkIdentity: string | null;
  /**
   * Set when SD-02 collapsed this candidate into a survivor on another image.
   *
   * ⚠ A collapse loser is EXCLUDED from the union, and excluding it changes
   * nothing — its identity lives on in the survivor, which is in the union. It
   * is excluded anyway because reading `resolvedWorkIdentity` off a discarded
   * row is the exact shape of the bug where a REJECTED candidate keeps a title
   * alive, and the two rows are indistinguishable at this boundary.
   */
  collapsedIntoCandidateId: string | null;
  /** Every image this candidate was seen on. Overlapping captures give more than one. */
  sourceImageIds: readonly string[];
}

export interface ReconcileInput {
  /** The batch's service. Reconciliation says nothing about any other. */
  service: Service;
  /** **Every** candidate in the batch, from every image. See the header. */
  candidates: readonly ReconcileCandidate[];
  /** The owner's currently-active listings, as `computeRemovals` takes them. */
  activeListings: readonly RemovalCandidateListing[];
  /** Suppressed work identities (REQ-071 — keyed on identity, never a row id). */
  suppressed: ReadonlySet<string>;
}

export interface ReconcileResult {
  /**
   * The union: every work identity a SURVIVING candidate in this batch
   * resolved to, deduplicated across images.
   */
  extractedWorkIdentities: ReadonlySet<string>;
  /** The listings this batch proposes removing. `ticked` is not set here. */
  removals: Omit<ReviewRemovalItem, 'ticked'>[];
  /**
   * The images that contributed at least one surviving candidate,
   * deduplicated, in first-seen order.
   *
   * Reported so a caller can ASSERT the union spanned the batch rather than
   * assume it — which is what `T-BATCH-004` does. It is not used to decide
   * anything: an image contributing nothing is a fact about extraction
   * (`candidateCount === 0`, US-006 AC-3), not a reason to reconcile
   * differently.
   */
  contributingImageIds: readonly string[];
}

/**
 * Reconcile one batch against the owner's list.
 *
 * Call this ONCE per batch. There is no per-image entry point, and adding one
 * would be a defect rather than an optimisation — see the header.
 */
export function reconcile(input: ReconcileInput): ReconcileResult {
  const surviving = input.candidates.filter(
    (candidate) =>
      candidate.collapsedIntoCandidateId === null && candidate.resolvedWorkIdentity !== null,
  );

  const extractedWorkIdentities = new Set(
    surviving.map((candidate) => candidate.resolvedWorkIdentity as string),
  );

  const contributingImageIds: string[] = [];
  const seenImages = new Set<string>();
  for (const candidate of surviving) {
    for (const imageId of candidate.sourceImageIds) {
      if (seenImages.has(imageId)) continue;
      seenImages.add(imageId);
      contributingImageIds.push(imageId);
    }
  }

  const removalsInput: ComputeRemovalsInput = {
    service: input.service,
    activeListings: input.activeListings,
    extractedWorkIdentities,
    suppressed: input.suppressed,
  };

  return {
    extractedWorkIdentities,
    removals: computeRemovals(removalsInput),
    contributingImageIds,
  };
}
