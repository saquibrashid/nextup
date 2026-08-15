/**
 * THE ingest pipeline (TASK-050, `specs/api.md` §5/§5.0/§5.3).
 *
 * ⚠ THERE IS ONE PIPELINE AND ONE SET OF LIMITS. Bytes that arrived by
 * clipboard paste or drag-and-drop run through exactly this code, in exactly
 * this order, as bytes that arrived by file upload. A pasted image is not
 * privileged, not exempt, and not handled by a second code path (`A45`).
 *
 * ⚠ `ingestSource` IS PROVENANCE, NEVER A CONTROL INPUT. It must not select a
 * branch anywhere below — not the sniff, not a ceiling, not the guard, not the
 * metadata strip, and above all not the transcode, whose condition is the
 * SNIFFED format (§5.1). It is untrusted client input; deciding anything
 * security-relevant from it would be equivalent-today and wrong-in-principle.
 * The single place it is read is the file NAME, which is display copy.
 * `T-IMG-023`, `T-PASTE-006`, `T-PASTE-007`.
 *
 * ORDER IS THE CONTRACT (§5.0):
 *
 *   1. sniff the magic bytes            → 415 `UNSUPPORTED_IMAGE_FORMAT`
 *   2. per-image byte ceiling           → 413 `IMAGE_TOO_LARGE`
 *   3. read dimensions from the HEADER  → 415 when unparseable
 *   4. pixel guard, BEFORE any decode   → 413/400
 *   5. transcode HEIC/HEIF → PNG        (TASK-149; seam below)
 *   6. strip EXIF/XMP                   (TASK-150; seam below)
 *   7. write the blob
 *   8. insert the row
 *
 * Steps 1-4 all happen before a single decode buffer is allocated. That is the
 * whole point: at 0.25 vCPU / 0.5 GiB, allocating first and checking after is
 * how the container dies (RSK-016).
 *
 * ⚠ A FAILURE FAILS ONE IMAGE, NEVER THE BATCH (REQ-080/081). Every per-file
 * outcome below is collected into `rejected[]`; the request still returns 201
 * as long as anything was accepted, already-accepted files are never removed,
 * and the failed file stays retryable.
 */

import {
  MAX_IMAGE_BYTES,
  resolveFileName,
  ulid,
  type ImageFormat,
  type IngestSource,
  type UploadFormat,
} from '@nextup/domain';

import { IMAGE_RETENTION_DAYS } from '../config.js';
import { AppError } from '../errors/AppError.js';
import { inspectDecodable } from './decodeGuard.js';
import { isAcceptedUploadFormat, sniffUploadFormat } from './sniffFormat.js';
import { blobPathFor, type ImageBlobStore } from '../storage/blobStore.js';

/** One incoming file part, already buffered by the multipart parser. */
export interface IncomingFile {
  /** The name the CLIENT supplied. Ignored entirely when pasting. */
  readonly clientFileName: string | undefined;
  readonly bytes: Uint8Array;
}

export interface AcceptedImage {
  readonly imageId: string;
  readonly fileName: string;
  readonly format: ImageFormat;
  readonly uploadedFormat: UploadFormat;
  readonly ingestSource: IngestSource;
  readonly byteSize: number;
  readonly width: number;
  readonly height: number;
  readonly blobPath: string;
  readonly seqInBatch: number;
  readonly retainUntil: Date;
}

export interface RejectedImage {
  readonly fileName: string;
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/**
 * The HEIC/HEIF transcode (TASK-149) and the EXIF/XMP strip (TASK-150) are
 * injected rather than imported, so that TASK-050 can be asserted end to end
 * without either being built, and so a test can prove the transcode branch is
 * chosen by the SNIFFED format and never by `ingestSource`.
 */
export interface IngestStages {
  /**
   * Transcode HEIC/HEIF to LOSSLESS PNG. Called ONLY when the sniffed format
   * is `heic`/`heif`. Must not be reached for PNG/JPEG from any source.
   *
   * The optional dimensions are the DECODED raster's. libheif applies the
   * `irot` transform that the HEIF `ispe` header ignores, so a rotated phone
   * photo's stored PNG can legitimately be the transpose of its header — and
   * the row must record what was stored, not what the header claimed.
   */
  transcode(
    bytes: Uint8Array,
    from: UploadFormat,
  ): Promise<{ bytes: Uint8Array; width?: number; height?: number }>;
  /** Strip EXIF/XMP, including GPS and device model (REQ-078). Every image. */
  stripMetadata(bytes: Uint8Array, format: ImageFormat): Promise<Uint8Array>;
}

export interface IngestContext {
  readonly ownerId: string;
  readonly batchId: string;
  readonly ingestSource: IngestSource;
  /** 1-based ordinal of the FIRST file in this request within the batch. */
  readonly firstSeqInBatch: number;
  readonly receivedAt: Date;
  readonly store: ImageBlobStore;
  readonly stages: IngestStages;
  readonly env?: NodeJS.ProcessEnv;
}

export interface IngestOutcome {
  readonly accepted: AcceptedImage[];
  readonly rejected: RejectedImage[];
}

const BYTES_PER_MIB = 1024 * 1024;

/**
 * The name used to REPORT a rejection.
 *
 * A rejected pasted file still needs a name the owner can recognise, and the
 * error-reporting model works entirely by naming the file (§5.2, `ui.md`
 * §3.2a). The sniffed format is unavailable for a rejection that happened
 * because the sniff failed, so `png` stands in for the extension — the name is
 * a label, not a claim about the bytes.
 */
function reportableName(
  file: IncomingFile,
  seqInBatch: number,
  format: UploadFormat,
  context: IngestContext,
): string {
  return resolveFileName(
    file.clientFileName,
    seqInBatch,
    format,
    context.receivedAt,
    context.ingestSource,
  );
}

/**
 * Ingest one already-buffered file. Never throws for a per-file condition —
 * a caught condition becomes a `rejected[]` entry so the rest of the batch
 * proceeds (REQ-080/081).
 */
async function ingestOne(
  file: IncomingFile,
  seqInBatch: number,
  context: IngestContext,
): Promise<{ accepted?: AcceptedImage; rejected?: RejectedImage }> {
  // 1. THE SNIFF. Bytes only — `sniffUploadFormat` takes nothing else, so no
  //    declared `Content-Type` and no `Blob.type` can reach this decision.
  const uploadedFormat = sniffUploadFormat(file.bytes);
  if (uploadedFormat === null || !isAcceptedUploadFormat(uploadedFormat)) {
    return {
      rejected: {
        fileName: reportableName(file, seqInBatch, 'png', context),
        code: 'UNSUPPORTED_IMAGE_FORMAT',
        message: 'nextup accepts PNG, JPEG and HEIC screenshots.',
      },
    };
  }

  const fileName = reportableName(file, seqInBatch, uploadedFormat, context);

  // 2. The per-image byte ceiling — a cheap first filter, NOT the memory
  //    guard. Enforced against the UPLOADED bytes (§5).
  if (file.bytes.byteLength > MAX_IMAGE_BYTES) {
    return {
      rejected: {
        fileName,
        code: 'IMAGE_TOO_LARGE',
        message: `${fileName} is larger than the ${MAX_IMAGE_BYTES / BYTES_PER_MIB} MiB limit for a single image.`,
        details: { byteSize: file.bytes.byteLength, maxByteSize: MAX_IMAGE_BYTES },
      },
    };
  }

  // 3 + 4. HEADER dimensions and the pre-decode pixel guard, before any
  //        decoder exists. `inspectDecodable` is the non-throwing shape
  //        because this loop must not abort on one file.
  const verdict = inspectDecodable(file.bytes, context.env);
  if (!verdict.ok) {
    return {
      rejected: {
        fileName,
        code: verdict.code,
        message: guardMessage(fileName, verdict),
        details: {
          ...(verdict.width === undefined ? {} : { width: verdict.width }),
          ...(verdict.height === undefined ? {} : { height: verdict.height }),
          ...(verdict.megapixels === undefined ? {} : { megapixels: verdict.megapixels }),
          maxMegapixels: verdict.maxMegapixels,
          remedy: 'docs/runbooks/scale-up-memory.md',
        },
      },
    };
  }

  // 5. THE TRANSCODE — CONDITIONAL ON THE SNIFFED FORMAT, never on
  //    `ingestSource`. `if (ingestSource === 'paste') skipTranscode()` is
  //    forbidden: it is equivalent today and makes a security-relevant
  //    decision from untrusted client input. A pasted HEIC is transcoded.
  const needsTranscode = uploadedFormat === 'heic' || uploadedFormat === 'heif';
  const format: ImageFormat = needsTranscode ? 'png' : uploadedFormat;
  let bytes = file.bytes;
  let width = verdict.width;
  let height = verdict.height;
  if (needsTranscode) {
    // ⚠ A TRANSCODE FAILURE FAILS ONE IMAGE, NOT THE BATCH (REQ-080/081,
    // invariant 15). The stage throws `AppError` — a decision we made about
    // THIS file (`IMAGE_DECODE_FAILED`, `IMAGE_DECODE_OOM`) — and that becomes
    // a `rejected[]` entry so the rest of the batch still processes and the
    // file stays retryable. ⚠ Anything that is NOT an `AppError` propagates:
    // an Azure outage or a programming error is not a verdict about one image
    // and must not be reported to the owner as "that screenshot was bad".
    try {
      const transcoded = await context.stages.transcode(bytes, uploadedFormat);
      bytes = transcoded.bytes;
      // The row records the STORED raster. See `IngestStages.transcode`.
      width = transcoded.width ?? width;
      height = transcoded.height ?? height;
    } catch (error) {
      if (!(error instanceof AppError)) {
        throw error;
      }
      return {
        rejected: {
          fileName,
          code: error.code,
          message: error.message,
          details: error.details,
        },
      };
    }
  }

  // 6. THE METADATA STRIP — OUTSIDE the transcode condition, for every image
  //    from every source (REQ-078). ⚠ WebKit strips EXIF on clipboard READ but
  //    NOT on file upload, so this is the only control that covers the upload
  //    path, which is exactly where a GPS-bearing HEIC arrives.
  bytes = await context.stages.stripMetadata(bytes, format);

  const imageId = ulid();
  const blobPath = blobPathFor(context.ownerId, context.batchId, imageId, format);
  await context.store.put(blobPath, bytes, format);

  const retainUntil = new Date(
    context.receivedAt.getTime() + IMAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );

  return {
    accepted: {
      imageId,
      fileName,
      format,
      uploadedFormat,
      ingestSource: context.ingestSource,
      byteSize: bytes.byteLength,
      width,
      height,
      blobPath,
      seqInBatch,
      retainUntil,
    },
  };
}

function guardMessage(
  fileName: string,
  verdict: Extract<ReturnType<typeof inspectDecodable>, { ok: false }>,
): string {
  // Final wording is TASK-155's (`api.md` §5.2.4). The two constraints that are
  // already load-bearing and asserted by `T-IMG-020` are honoured here: a
  // MEMORY refusal names memory and cites the runbook; the unsupported-format
  // refusal mentions NEITHER, because more memory never fixes a corrupt file.
  if (verdict.code === 'IMAGE_TOO_LARGE_TO_DECODE') {
    return (
      `${fileName} is ${(verdict.megapixels ?? 0).toFixed(1)} MP (${String(verdict.width)} × ${String(verdict.height)}). ` +
      `nextup refuses anything above ${verdict.maxMegapixels.toFixed(1)} MP before allocating memory, ` +
      'because decoding it would exhaust container memory and kill the import. ' +
      'This is a memory limit, not a problem with your image. ' +
      'Remedy: up-size compute — see docs/runbooks/scale-up-memory.md. ' +
      'No other image in this batch was affected; re-attach this file after up-sizing.'
    );
  }
  if (verdict.code === 'IMAGE_DIMENSIONS_UNSUPPORTED') {
    return `${fileName} is outside the size nextup can read. Each side needs to be between 50 and 16,000 pixels.`;
  }
  return 'nextup accepts PNG, JPEG and HEIC screenshots.';
}

/**
 * Ingest the file parts of ONE request.
 *
 * ⚠ SERIAL, NOT `Promise.all` (REQ-079/TASK-145). Concurrency multiplies peak
 * memory by the number of in-flight decodes, and the guard is sized for one.
 * Two 24 MP images each pass a 25 MP guard and together exceed the container.
 */
export async function ingestFiles(
  files: readonly IncomingFile[],
  context: IngestContext,
): Promise<IngestOutcome> {
  const accepted: AcceptedImage[] = [];
  const rejected: RejectedImage[] = [];
  let seq = context.firstSeqInBatch;

  for (const file of files) {
    const result = await ingestOne(file, seq, context);
    if (result.accepted) {
      accepted.push(result.accepted);
    }
    if (result.rejected) {
      rejected.push(result.rejected);
    }
    // The ordinal advances for a REJECTED file too. It is the receipt-order
    // position within the request, and reusing it would give two files in one
    // request the same synthesised name.
    seq += 1;
  }

  return { accepted, rejected };
}
