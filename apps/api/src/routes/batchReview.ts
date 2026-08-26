/**
 * TASK-065 — `GET /api/batches/:batchId/review` (`specs/api.md` §6.17).
 *
 * The I/O half. Everything that DECIDES anything — which section a candidate
 * belongs to, whether removals may be shown, what the banner says — lives in
 * `packages/domain/src/review.ts` so it can be tested without a database. This
 * file loads, gates and maps.
 *
 * Order of operations is load-bearing:
 *
 *   1. batch → 409 unless `in-review`
 *   2. candidates
 *   3. **suppression gate** (`specs/ai.md` §5) — BEFORE classification
 *   4. active listings for the batch's service
 *   5. classification (TASK-064)
 *   6. disappeared listings = active listings − resolved work identities
 *   7. assemble (TASK-065 domain)
 *
 * ⚠ **Step 3 must come before step 6, not just before step 5.** A work
 * suppressed *while* holding an active listing would otherwise appear in the
 * removal section: the owner said they were not interested, and the app would
 * respond by asking them about it again on every full-update batch. `T-SUP-004`.
 */

import { type Router } from 'express';
import {
  assertEveryCandidateRouted,
  buildActiveListingIndex,
  buildReviewResponse,
  classifyWorkIdentity,
  computeRemovals,
  type BatchMode,
  type CandidateBasis,
  type CandidateProvider,
  type CleanupVerdict,
  type CrossCheckOutcome,
  type OcrSupport,
  type ReviewCandidate,
  type ReviewMatch,
  type ReviewMatchRef,
  type ReviewDisposition,
  type Service,
} from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import {
  findUploadBatch,
  listActiveListingsForService,
  listActiveSuppressions,
  listCandidatesForReview,
  listImagesForBatch,
} from '../repository/ownerData.js';

/** `YYYY-MM-DD` in UTC. The listing's `dateAdded` is a DATE column already. */
function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * `matchCandidates` is stored as a JSON string, and it is UNTRUSTED at read
 * time — it was written by an earlier version of this code, so a shape change
 * would otherwise surface as a 500 on a batch the owner cannot then get past.
 * A malformed blob degrades to "no alternatives", which review can still work
 * with, rather than making the batch unreviewable.
 */
function parseMatchCandidates(raw: string | null): ReviewMatchRef[] {
  if (raw === null || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMatchRef);
  } catch {
    return [];
  }
}

function isMatchRef(value: unknown): value is ReviewMatchRef {
  if (typeof value !== 'object' || value === null) return false;
  const ref = value as Record<string, unknown>;
  return typeof ref['tmdbId'] === 'number' && typeof ref['name'] === 'string';
}

/**
 * Loads a batch's candidates, gated and classified exactly as the review
 * response does.
 *
 * ⚠ Exported and SHARED with `PATCH …/candidates/confirm-all` (TASK-066) on
 * purpose. `confirm-all` acts on "every pending item in this section", so it
 * must agree with `GET /review` about which section each candidate is in. A
 * second, simpler implementation there would drift — and the way it drifts is
 * that a bulk press confirms items the owner never saw in that section.
 */
export async function loadReviewCandidates(
  ownerId: ReturnType<typeof requireOwnerId>,
  batchId: string,
  service: Service,
): Promise<{
  candidates: ReviewCandidate[];
  suppressed: Set<string>;
  activeListings: Awaited<ReturnType<typeof listActiveListingsForService>>;
  /**
   * Every candidate row as stored, INCLUDING the ones the suppression gate
   * removed from `candidates`.
   *
   * Returned because close reports `summary.suppressedGated`, and the gated
   * rows are by definition absent from `candidates`. Deriving that count from
   * a second read would be a second chance to disagree with this one about
   * which rows the batch has.
   */
  rows: Awaited<ReturnType<typeof listCandidatesForReview>>;
}> {
  const [rows, suppressions, activeListings] = await Promise.all([
    listCandidatesForReview(ownerId, batchId),
    listActiveSuppressions(ownerId),
    listActiveListingsForService(ownerId, service),
  ]);

  // The suppression gate. Keyed on WORK IDENTITY, never on a row id
  // (REQ-071, product invariant 1), and with NO branch on the `tmdb:` vs
  // `unmatched:` prefix (`T-SUP-006a`).
  const suppressed = new Set(suppressions.map((s) => s.workIdentity));

  const index = buildActiveListingIndex(
    activeListings
      .filter((listing) => !suppressed.has(listing.title.workIdentity))
      .map((listing) => ({
        workIdentity: listing.title.workIdentity,
        service: listing.service as Service,
        state: 'active' as const,
      })),
  );

  const candidates: ReviewCandidate[] = rows
    .filter((row) => row.resolvedWorkIdentity === null || !suppressed.has(row.resolvedWorkIdentity))
    .map((row) => {
      const alternatives = parseMatchCandidates(row.matchCandidates);
      const match: ReviewMatch | null =
        alternatives[0] !== undefined && row.resolvedWorkIdentity?.startsWith('tmdb:') === true
          ? {
              ...alternatives[0],
              uncertain: alternatives[0].score < 1,
              ambiguous:
                alternatives[1] !== undefined &&
                alternatives[0].score - alternatives[1].score < 0.05,
            }
          : null;
      return {
        candidateId: row.id,
        rawText: row.rawText,
        inferredTitle: row.inferredTitle,
        basis: row.basis as CandidateBasis,
        ocrSupport: row.ocrSupport as OcrSupport,
        provider: row.provider as CandidateProvider,
        verdict: row.cleanupVerdict as CleanupVerdict,
        ocrConfidence: row.ocrConfidence,
        resolvedWorkIdentity: row.resolvedWorkIdentity,
        match,
        alternatives,
        sourceImageIds: row.sourceImages.map((image) => image.imageId),
        disposition: row.reviewDisposition as ReviewDisposition,
        collapsedIntoCandidateId: row.collapsedIntoCandidateId,
        classification: classifyWorkIdentity(row.resolvedWorkIdentity, service, index),
      };
    });

  return { candidates, suppressed, activeListings, rows };
}

export function registerBatchReviewRoutes(router: Router): void {
  router.get('/batches/:batchId/review', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const batchId = req.params.batchId ?? '';

    const batch = await findUploadBatch(ownerId, batchId);
    if (batch === null) {
      throw new AppError('NOT_FOUND', 404, 'No such batch.');
    }
    if (batch.status !== 'in-review') {
      throw new AppError('BATCH_NOT_IN_REVIEW', 409, 'That batch is not ready to review yet.', {
        status: batch.status,
      });
    }

    const service = batch.service as Service;
    const [{ candidates, suppressed, activeListings }, images] = await Promise.all([
      loadReviewCandidates(ownerId, batchId, service),
      listImagesForBatch(ownerId, batchId),
    ]);
    // Step 6. A listing "disappeared" when no SURVIVING candidate resolved to
    // its work. ⚠ SD-02 collapse losers are excluded from the extracted set
    // deliberately — their identity lives on in the survivor, so counting them
    // changes nothing, but reading `resolvedWorkIdentity` off a discarded row
    // is the shape of a bug where a rejected candidate keeps a title alive.
    const extracted = new Set(
      candidates
        .filter((c) => c.collapsedIntoCandidateId === null && c.resolvedWorkIdentity !== null)
        .map((c) => c.resolvedWorkIdentity as string),
    );
    const disappearedListings = computeRemovals({
      service,
      activeListings: activeListings.map((listing) => ({
        listingId: listing.listingId,
        titleId: listing.titleId,
        workIdentity: listing.title.workIdentity,
        state: listing.state,
        service: listing.service as Service,
        tmdbName: listing.title.tmdbName,
        rawExtractedText: listing.title.rawExtractedText,
        releaseYear: listing.title.tmdbReleaseYear,
        posterPath: listing.title.tmdbPosterPath,
        dateAdded: toIsoDate(listing.dateAdded),
      })),
      extractedWorkIdentities: extracted,
      suppressed,
    });

    // ⚠ `candidateCount` is the DATUM, and `null` (not extracted yet) and `0`
    // (extracted, found nothing) are DIFFERENT and both meaningful — US-006
    // AC-3. Deriving this from "no candidate names this image" instead would
    // conflate the two, and would also name an image whose only candidate was
    // absorbed by an SD-02 survivor on another image. `T-AI-020`.
    const imagesWithNoText = images
      .filter((image) => image.candidateCount === 0)
      .map((image) => ({ imageId: image.id, fileName: image.fileName }));

    const response = buildReviewResponse({
      batchId: batch.id,
      service,
      mode: batch.mode as BatchMode,
      lowYield: batch.lowYield,
      degradedExtraction: batch.degradedExtraction,
      crossCheck: (batch.crossCheck ?? 'ok') as CrossCheckOutcome,
      candidates,
      disappearedListings,
      imagesWithNoText,
    });

    // REQ-012 is asserted on the way out, not merely tested. A verdict added
    // later that routes nowhere must fail loudly here rather than quietly drop
    // a candidate the owner was supposed to see.
    assertEveryCandidateRouted(candidates, response);

    res.status(200).json(response);
  });
}
