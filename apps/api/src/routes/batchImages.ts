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
import multer from 'multer';
import {
  INGEST_SOURCES,
  MAX_BATCH_BYTES,
  MAX_FILES_PER_REQUEST,
  MAX_IMAGES_PER_BATCH,
  MAX_IMAGE_BYTES,
  type IngestSource,
} from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import { batchImageTotals, createUploadedImage, findUploadBatch } from '../repository/ownerData.js';
import { ingestFiles, type IncomingFile, type IngestStages } from '../images/ingest.js';
import { transcodeHeicToPng } from '../images/transcode.js';
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
 * The metadata strip (TASK-150) is not built.
 *
 * ⚠ THE STRIP DEFAULT IS A PASS-THROUGH AND THAT IS A KNOWN GAP, NOT A
 * DECISION. REQ-078 requires EXIF/XMP — including GPS — to be stripped from
 * every uploaded image, and until TASK-150 lands this route does not do it.
 * The seam exists so that landing TASK-150 is a one-line wiring change rather
 * than surgery on the pipeline.
 *
 * The transcode is BUILT (TASK-149) and wired here. ⚠ It is injected, not
 * imported by `ingest.ts`, so a test can prove the branch is chosen by the
 * SNIFFED format and never by `ingestSource` (`T-IMG-023`).
 * ~~Superseded: "The transcode default THROWS rather than passing HEIC bytes
 * through."~~ — the stage exists now; nothing passes through.
 */
export const DEFAULT_STAGES: IngestStages = {
  transcode(bytes, from) {
    return transcodeHeicToPng(bytes, from);
  },
  stripMetadata(bytes) {
    return Promise.resolve(bytes);
  },
};

/**
 * ⚠ Retained name — `UNBUILT_STAGES` is cited by `specs/testing.md` §28. It is
 * an alias, not a second implementation, and only the strip is still unbuilt.
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
    const raw = req.params.batchId;
    // Express 5 types a param as `string | string[]` (a repeated `:batchId`
    // cannot occur on this path, but the type is honest about the general
    // case). Normalising here keeps every downstream signature `string`.
    const batchId = Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');

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
    if (totals.byteSize + incomingBytes > MAX_BATCH_BYTES) {
      throw new AppError(
        'BATCH_TOO_LARGE',
        413,
        `A batch holds at most ${MAX_BATCH_BYTES / (1024 * 1024)} MiB of images.`,
        { max: MAX_BATCH_BYTES, current: totals.byteSize, incoming: incomingBytes },
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
      batchTotals: {
        imageCount: totals.imageCount + accepted.length,
        byteSize: totals.byteSize + accepted.reduce((sum, image) => sum + image.byteSize, 0),
      },
    });
  });
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
