/**
 * `POST /api/batches/:batchId/images` — the ONE ingest route (`specs/api.md`
 * §6.12, §5.3.1; TASK-050).
 *
 * ⚠ ONE ENDPOINT, THREE AFFORDANCES. Clipboard paste, drag-and-drop and file
 * selection all post the same `multipart/form-data` body here. There is NO
 * `/paste` route, no JSON+base64 variant and no second batch model, and a
 * paste NEVER creates a batch or submits one — it appends to the open draft
 * exactly as attaching one more file does (`A45`).
 *
 * ⚠ `ingestSource` IS PROVENANCE ONLY. It is validated as an enum, recorded on
 * the row, and echoed back — and it selects no code path anywhere downstream.
 * The pipeline in `images/ingest.ts` is where that rule lives; this file's job
 * is to parse it and hand it over unread.
 *
 * PARTIAL ACCEPTANCE IS DELIBERATE (US-004 AC-6). Valid files in a multi-file
 * request are accepted and invalid ones are named individually in `rejected[]`.
 * The response is **201 whenever `accepted.length > 0`**; only when NOTHING was
 * accepted does the request take the failing code's own status. A memory
 * failure on one file never removes an already-accepted file from `accepted[]`
 * and never changes `batchTotals` for the others (REQ-080/081, `T-IMG-018`).
 */

import { type Request, type Router } from 'express';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import {
  INGEST_SOURCES,
  MAX_BATCH_UPLOAD_BYTES,
  MAX_FILES_PER_REQUEST,
  MAX_IMAGES_PER_BATCH,
  MAX_IMAGE_BYTES,
  type IngestSource,
} from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import {
  batchImageTotals,
  createUploadedImage,
  deleteUploadedImage,
  findUploadBatch,
  findUploadedImage,
} from '../repository/ownerData.js';
import { ingestFiles, type IncomingFile, type IngestStages } from '../images/ingest.js';
import { stripAllMetadata, transcodeHeicToPng } from '../images/transcode.js';
import { azureImageBlobStore, type ImageBlobStore } from '../storage/blobStore.js';

/**
 * In-memory multipart, because every downstream stage — the sniff, the header
 * read, the guard, the transcode — wants bytes, and a temp file would only add
 * a cleanup path that can leak screenshots onto the container's disk.
 *
 * `limits.fileSize` is set one byte ABOVE `MAX_IMAGE_BYTES` deliberately: the
 * spec's answer to an oversized image is a per-file `rejected[]` entry
 * (`IMAGE_TOO_LARGE`), not a failed request, so multer must let the file
 * through for the pipeline to judge it. The limit here is only a backstop
 * against an unbounded stream.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES + 1, files: MAX_FILES_PER_REQUEST + 1 },
});

/**
 * The pipeline's two byte-level stages, wired.
 *
 * ⚠ THEY ARE INJECTED, NOT IMPORTED BY `ingest.ts`, so a test can prove the
 * transcode branch is chosen by the SNIFFED format and never by `ingestSource`
 * (`T-IMG-023`), and that the strip is called for EVERY image.
 *
 * ~~Superseded (TASK-149, TASK-150 have landed): "The metadata strip (TASK-150)
 * is not built… the strip default is a pass-through and that is a known gap.
 * The transcode default THROWS rather than passing HEIC bytes through."~~ Both
 * stages are real; nothing passes through and nothing is unbuilt.
 */
export const DEFAULT_STAGES: IngestStages = {
  transcode(bytes, from) {
    return transcodeHeicToPng(bytes, from);
  },
  // ⚠ UNCONDITIONAL — every accepted image, every ingest source, PNG and JPEG
  // included (REQ-078, `security.md` §4.2). WebKit strips EXIF on clipboard
  // READ but not on file upload, so this is the only control covering the
  // route a GPS-bearing camera-roll photo actually arrives on.
  stripMetadata(bytes, format) {
    return Promise.resolve(stripAllMetadata(bytes, format));
  },
};

/**
 * ⚠ Retained name — `UNBUILT_STAGES` is cited by `specs/testing.md` §28. It is
 * an alias of `DEFAULT_STAGES`, not a second implementation, and nothing about
 * it is unbuilt any more.
 */
export const UNBUILT_STAGES: IngestStages = DEFAULT_STAGES;

function parseIngestSource(req: Request): IngestSource {
  // Absent means `upload` (§6.12) so a simpler client keeps working. An
  // UNKNOWN value is a 400 rather than a silent coercion to the default: the
  // column is provenance, and quietly recording the wrong provenance is worse
  // than refusing the request.
  const raw = (req.body as { ingestSource?: unknown } | undefined)?.ingestSource;
  if (raw === undefined || raw === null || raw === '') {
    return 'upload';
  }
  if (typeof raw !== 'string' || !(INGEST_SOURCES as readonly string[]).includes(raw)) {
    throw new AppError('VALIDATION_FAILED', 400, '"ingestSource" is not a recognised value.', {
      field: 'ingestSource',
      permitted: [...INGEST_SOURCES],
    });
  }
  return raw as IngestSource;
}

export function registerBatchImageRoutes(
  router: Router,
  store: ImageBlobStore = azureImageBlobStore,
  stages: IngestStages = DEFAULT_STAGES,
): void {
  router.post('/batches/:batchId/images', upload.array('files'), async (req, res) => {
    const ownerId = requireOwnerId(req);
    const batchId = firstParam(req.params.batchId);

    const batch = await findUploadBatch(ownerId, batchId);
    if (!batch) {
      throw new AppError('NOT_FOUND', 404, "That batch doesn't exist.");
    }
    // Images attach to a DRAFT only. Afterwards the batch has been reconciled
    // against the list and appending would change what was already applied.
    if (batch.status !== 'draft') {
      throw new AppError('BATCH_NOT_DRAFT', 409, 'That batch has already been submitted.', {
        batchId,
        status: batch.status,
      });
    }

    const ingestSource = parseIngestSource(req);
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      throw new AppError('VALIDATION_FAILED', 400, 'Attach at least one image.', {
        field: 'files',
      });
    }
    if (files.length > MAX_FILES_PER_REQUEST) {
      throw new AppError(
        'TOO_MANY_FILES_IN_REQUEST',
        400,
        `Attach at most ${MAX_FILES_PER_REQUEST} files per request.`,
        { max: MAX_FILES_PER_REQUEST, received: files.length },
      );
    }

    // ── Whole-request ceilings ────────────────────────────────────────────
    // Only a ceiling the request as a whole would breach refuses the request
    // outright (§6.12). These are evaluated against what is ALREADY in the
    // batch plus what arrived, across all ingest sources.
    const totals = await batchImageTotals(ownerId, batchId);
    if (totals.imageCount + files.length > MAX_IMAGES_PER_BATCH) {
      throw new AppError(
        'TOO_MANY_IMAGES',
        400,
        `A batch holds at most ${MAX_IMAGES_PER_BATCH} images.`,
        { max: MAX_IMAGES_PER_BATCH, current: totals.imageCount, incoming: files.length },
      );
    }
    const incomingBytes = files.reduce((sum, file) => sum + file.size, 0);
    // ⚠ UPLOADED vs UPLOADED. `totals.uploadedByteSize`, never
    // `totals.storedByteSize`: this ceiling bounds what the owner SENDS, and
    // the stored total for the same batch can be many times larger after the
    // HEIC→PNG transcode. Summing the stored total with incoming uploaded
    // bytes — which this line used to do — is wrong in both directions at
    // once: it under-counts arriving HEIC so the ceiling never fires, and
    // inflates what is already held so a later request is refused with a
    // 60 MiB message after ~7 MiB of files.
    if (totals.uploadedByteSize + incomingBytes > MAX_BATCH_UPLOAD_BYTES) {
      throw new AppError(
        'BATCH_TOO_LARGE',
        413,
        `A batch holds at most ${MAX_BATCH_UPLOAD_BYTES / (1024 * 1024)} MiB of images.`,
        {
          max: MAX_BATCH_UPLOAD_BYTES,
          current: totals.uploadedByteSize,
          incoming: incomingBytes,
        },
      );
    }

    const incoming: IncomingFile[] = files.map((file) => ({
      // ⚠ Passed through UNSANITISED and UNTRUSTED. `resolveFileName` decides
      // whether it is used at all, and no path is ever composed from it.
      clientFileName: file.originalname,
      bytes: new Uint8Array(file.buffer),
    }));

    const receivedAt = new Date();
    const { accepted, rejected } = await ingestFiles(incoming, {
      ownerId,
      batchId,
      ingestSource,
      // Receipt-order ordinals continue from what the batch already holds, so
      // a second paste into the same batch reads `-03`, not `-01` again.
      firstSeqInBatch: totals.imageCount + 1,
      receivedAt,
      store,
      stages,
      // The decode sentinel repeats this on both of its lines (`api.md` §9.1)
      // so an abandoned decode can be read against the request that caused it.
      // ⚠ Not the owner id and not a hash of it: identity belongs on the
      // request line, and §9.1 rule 5 forbids repeating it here.
      correlationId: randomUUID(),
    });

    for (const image of accepted) {
      await createUploadedImage(ownerId, {
        id: image.imageId,
        batchId,
        blobPath: image.blobPath,
        fileName: image.fileName,
        ingestSource: image.ingestSource,
        uploadedFormat: image.uploadedFormat,
        format: image.format,
        byteSize: BigInt(image.byteSize),
        uploadedByteSize: BigInt(image.uploadedByteSize),
        width: image.width,
        height: image.height,
        retainUntil: image.retainUntil,
      });
    }

    if (accepted.length === 0) {
      // Nothing landed, so the request takes the first rejection's own status
      // rather than a 201 with an empty `accepted[]` — which would read to the
      // client as success.
      const first = rejected[0];
      throw new AppError(
        (first?.code ?? 'UNSUPPORTED_IMAGE_FORMAT') as 'UNSUPPORTED_IMAGE_FORMAT',
        statusForRejection(first?.code),
        first?.message ?? 'nextup accepts PNG, JPEG and HEIC screenshots.',
        { rejected },
      );
    }

    res.status(201).json({
      // ⚠ `blobPath` is NEVER emitted (`T-SEC-003`). It is mapped out here
      // explicitly rather than spread, so adding a field to `AcceptedImage`
      // cannot leak it by accident.
      accepted: accepted.map((image) => ({
        imageId: image.imageId,
        fileName: image.fileName,
        format: image.format,
        uploadedFormat: image.uploadedFormat,
        ingestSource: image.ingestSource,
        byteSize: image.byteSize,
        width: image.width,
        height: image.height,
      })),
      rejected,
      // ⚠ BOTH totals, each named for its unit. A single `byteSize` here was
      // ambiguous in exactly the way that produced the ceiling defect: the
      // client would render one number against a limit expressed in the
      // other. `uploadedByteSize` is the one `MAX_BATCH_UPLOAD_BYTES` bounds.
      batchTotals: {
        imageCount: totals.imageCount + accepted.length,
        uploadedByteSize:
          totals.uploadedByteSize +
          accepted.reduce((sum, image) => sum + image.uploadedByteSize, 0),
        storedByteSize:
          totals.storedByteSize + accepted.reduce((sum, image) => sum + image.byteSize, 0),
      },
    });
  });

  /**
   * `DELETE /api/batches/:batchId/images/:imageId` (§6.13, US-004 AC-4).
   *
   * ⚠ THE ONE SANCTIONED HARD DELETE (`data-model.md` I-7, `T-INV-012`), and
   * the reason it is sanctioned is the DRAFT check below — not the endpoint.
   * REQ-028 is soft-delete-forever, but a draft batch is not history: nothing
   * has been reconciled against the list, no extraction candidate references
   * the image, and the owner is still assembling the upload. Removing a
   * mis-attached screenshot before submitting is a correction, not a deletion
   * of a record.
   *
   * Once the batch leaves `draft` the exemption is gone and the answer is a
   * **409**, because the image is by then evidence for candidates that were
   * reviewed and changes that were applied. Deleting it would leave the batch
   * detail page citing a screenshot that no longer exists.
   */
  router.delete('/batches/:batchId/images/:imageId', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const batchId = firstParam(req.params.batchId);
    const imageId = firstParam(req.params.imageId);

    const batch = await findUploadBatch(ownerId, batchId);
    if (!batch) {
      throw new AppError('NOT_FOUND', 404, "That batch doesn't exist.");
    }
    // ⚠ THE DRAFT CHECK IS THE EXEMPTION. Checked BEFORE the image lookup so
    // that a submitted batch answers 409 whether or not the id resolves - a
    // 404-then-409 order would leak, by timing and by status code, which image
    // ids exist in a batch the caller may no longer modify.
    if (batch.status !== 'draft') {
      throw new AppError(
        'BATCH_NOT_DRAFT',
        409,
        'That batch has already been submitted, so its images are part of the record.',
        { batchId, status: batch.status },
      );
    }

    const image = await findUploadedImage(ownerId, batchId, imageId);
    if (!image) {
      throw new AppError('NOT_FOUND', 404, "That image doesn't exist in this batch.");
    }

    // ⚠ BLOB FIRST, ROW SECOND. The reverse order can orphan bytes forever:
    // once the row is gone nothing names the `blobPath`, so a failed blob
    // delete leaves an unreferenced screenshot that only the 30-day lifecycle
    // purge will ever reach. This order can only fail the other way - a row
    // whose blob is already gone - which the delete below then removes, and
    // which a retry of the same request resolves either way.
    await store.remove(image.blobPath);
    await deleteUploadedImage(ownerId, imageId);

    res.status(204).end();
  });
}

/**
 * Express 5 types a route param as `string | string[]`: a repeated param
 * cannot occur on these paths, but the type is honest about the general case.
 * Normalising here keeps every downstream signature `string`.
 */
function firstParam(raw: string | string[] | undefined): string {
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
}

function statusForRejection(code: string | undefined): number {
  switch (code) {
    case 'IMAGE_TOO_LARGE':
    case 'IMAGE_TOO_LARGE_TO_DECODE':
      return 413;
    case 'IMAGE_DIMENSIONS_UNSUPPORTED':
      return 400;
    case 'IMAGE_DECODE_OOM':
      // 503, not 500: a capacity condition with a known one-command remedy,
      // after which the identical request succeeds (§5.2.3).
      return 503;
    default:
      return 415;
  }
}
