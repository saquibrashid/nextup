/**
 * `POST /api/batches/:batchId/re-extract` — read the SAME screenshots again
 * (`specs/api.md` §6.24, US-034, REQ-074, TASK-117).
 *
 * The owner reaches for this when a capture was read badly: the extractor was
 * degraded, an image OOMed mid-batch, or the model simply misread a screen.
 * The screenshots are still held for 30 days (NFR-019), so the bytes to try
 * again with already exist and asking the owner to re-photograph their TV
 * would be gratuitous.
 *
 * ⚠ THIS DERIVES A NEW BATCH; IT DOES NOT RE-RUN THE OLD ONE. That distinction
 * is the whole of US-034 AC-3 and it is easy to get backwards, because
 * `extraction-failed → submitted` RETRY (§6.16) re-enters the *same* batch and
 * looks like the same operation from the outside. It is not. Retry is for a
 * batch that never produced anything; re-extraction is for a batch that
 * produced something the owner has seen and judged wrong. Re-running in place
 * would overwrite the candidates the owner is currently looking at, and
 * — if the original had already been applied — would silently attach a second
 * set of results to a batch whose provenance rows (REQ-068) describe the
 * first. The original batch is left BYTE-IDENTICAL; `T-REX-012` asserts it.
 *
 * ⚠ RETENTION IS COPIED, NEVER RESTAMPED. The derived batch gets its own
 * `uploadedImage` rows, because an image belongs to exactly one batch — but
 * they carry the ORIGINAL `uploadedAt` and `retainUntil`. Letting the copies
 * take today's date is the natural thing to write and it quietly converts
 * NFR-019 into "30 days after you last re-extracted": an owner who re-extracts
 * once a month would retain screenshots forever, which is precisely the
 * indefinite-retention outcome the 30-day purge exists to prevent. The field
 * is documented WRITE-ONCE in `prisma/schema.prisma`; this is one of the two
 * places that could break it.
 *
 * ⚠ NOTHING ENTERS THE LIST HERE (US-034 AC-2). The derived batch goes to
 * review like any other. There is no "re-extract and apply".
 *
 * ⚠ THE SUPPRESSION GATE IS NOT RE-IMPLEMENTED HERE, AND MUST NOT BE
 * (US-034 AC-6, `T-SUP-017`). A suppressed work is gated in the close
 * transaction (`services/batchClose.ts`), which the derived batch closes
 * through exactly like any other batch — so the gate applies by construction.
 * A second copy of the check on this path would be a second place to forget
 * REQ-071's rule that suppression is keyed on WORK IDENTITY, not row id.
 */

import { AppError } from '../errors/AppError.js';
import { ulid } from '@nextup/domain';
import {
  createUploadBatch,
  createUploadedImage,
  findOpenUploadBatch,
  listImagesForBatch,
  type OwnerId,
} from '../repository/ownerData.js';
import { loadOwnedBatch } from './batchLifecycle.js';

export interface ReextractResult {
  batchId: string;
  derivedFromBatchId: string;
  status: 'submitted';
  service: string;
  mode: string;
  imageCount: number;
}

/**
 * Is this image's retention window closed as at `now`?
 *
 * `retainUntil` is the instant availability ENDS, so the comparison is `<=`:
 * at exactly `retainUntil` the bytes are already gone (US-035 AC-1 —
 * "at `retainUntil`, bytes are unavailable"). A `<` here would offer a
 * re-extraction that the blob store then refuses, turning a clean 410 into an
 * `extraction-failed` batch the owner has to go and read.
 */
function isPurged(image: { retainUntil: Date }, now: Date): boolean {
  return image.retainUntil.getTime() <= now.getTime();
}

export async function reextractBatch(
  ownerId: OwnerId,
  batchId: string,
  now: Date = new Date(),
): Promise<ReextractResult> {
  const source = await loadOwnedBatch(ownerId, batchId);

  const images = await listImagesForBatch(ownerId, batchId);
  if (images.length === 0) {
    throw new AppError('NO_IMAGES', 400, 'This batch has no screenshots to read again.', {
      batchId,
    });
  }

  // ⚠ CHECKED BEFORE THE OPEN-BATCH GUARD, DELIBERATELY. Both refuse, but only
  // one of them is recoverable: an owner told to "finish your other batch
  // first" will do so and come back to a 410 anyway, because purged bytes do
  // not come back. Leading with the permanent refusal tells them the truth on
  // the first attempt and points at the only action that helps — upload new
  // screenshots (`ux-states.md` §5.7).
  const purged = images.filter((image) => isPurged(image, now));
  if (purged.length > 0) {
    throw new AppError(
      'IMAGES_PURGED',
      410,
      "These screenshots were deleted 30 days after upload, so they can't be read again.",
      {
        batchId,
        // §6.24 names this field. The SPA does not render ids, but the count
        // and the identity of what was lost is the evidence behind the claim.
        purgedImageIds: purged.map((image) => image.id),
      },
    );
  }

  const open = await findOpenUploadBatch(ownerId);
  if (open) {
    throw new AppError(
      'OPEN_BATCH_EXISTS',
      409,
      'You already have a batch in progress. Finish or discard it before starting another.',
      { batchId: open.id, service: open.service, mode: open.mode, status: open.status },
    );
  }

  const derivedId = ulid();
  await createUploadBatch(ownerId, {
    id: derivedId,
    // ⚠ SERVICE AND MODE ARE INHERITED, NOT RE-ASKED (US-034 AC-3). The
    // screenshots are of one service and were captured under one mode; a
    // re-read of the same pixels cannot honestly be attributed to a different
    // service, and re-asking would let the owner point a `full-update`
    // reconciliation at bytes captured as `append-only`.
    service: source.service,
    mode: source.mode,
    derivedFromBatchId: source.id,
    // Straight to `submitted`: there is nothing to attach, so a `draft` state
    // would be a state the owner could never act on.
    status: 'submitted',
    submittedAt: now,
  });

  for (const image of images) {
    await createUploadedImage(ownerId, {
      id: ulid(),
      batchId: derivedId,
      // The SAME bytes. No copy is made in blob storage: two rows pointing at
      // one blob is correct here, and duplicating the object would double the
      // storage the 30-day purge is sized against for no benefit.
      blobPath: image.blobPath,
      fileName: image.fileName,
      ingestSource: image.ingestSource,
      uploadedFormat: image.uploadedFormat,
      format: image.format,
      byteSize: image.byteSize,
      uploadedByteSize: image.uploadedByteSize,
      width: image.width,
      height: image.height,
      // See the header note: both copied, neither restamped.
      uploadedAt: image.uploadedAt,
      retainUntil: image.retainUntil,
      // ⚠ NOT copied. `null` means "not extracted yet" and `0` means
      // "extracted, found nothing" (US-006 AC-3) — carrying the old count over
      // would make the derived batch report results it has not produced.
      candidateCount: null,
    });
  }

  return {
    batchId: derivedId,
    derivedFromBatchId: source.id,
    status: 'submitted',
    service: source.service,
    mode: source.mode,
    imageCount: images.length,
  };
}
