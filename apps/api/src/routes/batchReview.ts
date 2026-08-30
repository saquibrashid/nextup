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
  reconcile,
  tileCropFor,
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
  listRemovalDecisions,
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
 * The persisted `bounding_boxes` column, as boxes.
 *
 * ⚠ Every field is checked, not cast. The column is `NVarChar(Max)` written by
 * the extraction runner from provider output; a box with a string `x` would
 * flow into an inline CSS transform and position the crop somewhere arbitrary,
 * which renders as a confident thumbnail of the wrong part of the screenshot.
 * A rejected box shows the whole image instead, which is honest.
 */
function parseBoundingBoxes(
  raw: string | null,
): { imageId: string; x: number; y: number; w: number; h: number }[] {
  if (raw === null || raw === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBoundingBox);
  } catch {
    return [];
  }
}

function isBoundingBox(
  value: unknown,
): value is { imageId: string; x: number; y: number; w: number; h: number } {
  if (typeof value !== 'object' || value === null) return false;
  const box = value as Record<string, unknown>;
  if (typeof box['imageId'] !== 'string') return false;
  return (['x', 'y', 'w', 'h'] as const).every((key) => typeof box[key] === 'number');
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
    // ⚠ REDUNDANT BY CONSTRUCTION, and deliberately kept. Mutation testing
    // (TASK-105) proved this filter is unobservable: the index is keyed on
    // work identity and `classifyWorkIdentity` only ever asks it about a
    // candidate's OWN identity, and every suppressed identity has already
    // been dropped from `candidates` below — so no lookup can reach a
    // suppressed entry. It stays because the redundancy is the point: it
    // makes the index correct on its own terms rather than correct only
    // while the candidate filter below stays exactly as wide as it is today.
    // Do not read its survival under mutation as evidence the candidate
    // filter is optional — that one is load-bearing and pinned by `T-SUP-016`.
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
        // §5.3a. The stored column is `NVarChar(Max)` JSON, so a malformed
        // value degrades to "no crop" (the whole image) rather than taking the
        // review page out: an unverifiable candidate the owner can still SEE
        // is recoverable, a 500 on the review pass is not.
        tileCrop: tileCropFor({
          verdict: row.cleanupVerdict as CleanupVerdict,
          boxSource: row.boxSource,
          boundingBoxes: parseBoundingBoxes(row.boundingBoxes),
        }),
        disposition: row.reviewDisposition as ReviewDisposition,
        collapsedIntoCandidateId: row.collapsedIntoCandidateId,
        classification: classifyWorkIdentity(row.resolvedWorkIdentity, service, index),
      };
    });

  return { candidates, suppressed, activeListings, rows };
}

/**
 * The removal set a batch currently proposes, derived from an already-loaded
 * review read.
 *
 * ⚠ Exported and SHARED with `PATCH …/removals` (TASK-085) on purpose, for the
 * same reason `loadReviewCandidates` is shared with `confirm-all`: the two
 * endpoints must agree about which listings are on the table. A second,
 * simpler implementation there would drift, and the way it drifts is that a
 * tick lands on a listing the owner was never shown.
 */
export function proposedRemovalsFrom(
  service: Service,
  loaded: Pick<
    Awaited<ReturnType<typeof loadReviewCandidates>>,
    'candidates' | 'suppressed' | 'activeListings'
  >,
): ReturnType<typeof computeRemovals> {
  // ⚠ ONE call, over the batch's WHOLE candidate set (US-005 AC-2, REQ-006).
  // `listCandidatesForReview` is batch-scoped, so `loaded.candidates` is
  // already the union across every image; `reconcile` is what makes that a
  // named property instead of an accident of where a loop was closed. There is
  // no per-image variant to reach for, deliberately — see `reconcile.ts`.
  return reconcile({
    service,
    candidates: loaded.candidates,
    activeListings: loaded.activeListings.map((listing) => ({
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
    suppressed: loaded.suppressed,
  }).removals;
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
    const decisions = await listRemovalDecisions(ownerId, batchId);
    const untickedListingIds = new Set(decisions.filter((d) => !d.ticked).map((d) => d.listingId));
    const disappearedListings = proposedRemovalsFrom(service, {
      candidates,
      suppressed,
      activeListings,
    });
    // ⚠ `candidateCount` is the DATUM, and `null` (not extracted yet) and `0`
    // (extracted, found nothing) are DIFFERENT and both meaningful — US-006
    // AC-3. Deriving this from "no candidate names this image" instead would
    // conflate the two, and would also name an image whose only candidate was
    // absorbed by an SD-02 survivor on another image. `T-AI-020`.
    const imagesWithNoText = images
      .filter((image) => image.candidateCount === 0)
      .map((image) => ({
        imageId: image.id,
        fileName: image.fileName,
        // ⚠ The API path, never a blob URL (NFR-020). US-006 AC-3 wants the
        // image THUMBNAILED as well as named, and this is what makes that
        // possible from the review pass.
        href: `/api/images/${encodeURIComponent(image.id)}`,
      }));

    const response = buildReviewResponse({
      batchId: batch.id,
      service,
      mode: batch.mode as BatchMode,
      lowYield: batch.lowYield,
      degradedExtraction: batch.degradedExtraction,
      crossCheck: (batch.crossCheck ?? 'ok') as CrossCheckOutcome,
      candidates,
      disappearedListings,
      untickedListingIds,
      imagesWithNoText,
    });

    // REQ-012 is asserted on the way out, not merely tested. A verdict added
    // later that routes nowhere must fail loudly here rather than quietly drop
    // a candidate the owner was supposed to see.
    assertEveryCandidateRouted(candidates, response);

    res.status(200).json(response);
  });
}
