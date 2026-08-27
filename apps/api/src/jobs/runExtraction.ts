/**
 * The inline extraction runner — TASK-058, `specs/ai.md` §2.2.
 *
 * ⚠ THERE IS NO QUEUE AND NO SCHEDULER, AND THAT IS A PRODUCT INVARIANT, NOT
 * A SIMPLIFICATION (REQ-041 as reworded at `A37`). `T-CI-005` asserts that
 * exactly TWO non-owner processes exist in this system — metadata-only lazy
 * refresh on access, and the 30-day blob purge. This runner is allowed to
 * exist because it is OWNER-INITIATED work running inline in the request that
 * submitted the batch. Introducing a timer that starts work, a cron, a worker,
 * a `setInterval` or a background queue makes `T-CI-005` fail, and it should.
 *
 * The one `setTimeout` below is not a scheduler: it starts no work, touches no
 * list state, and exists solely to STOP work that has overrun the ceiling. It
 * is cleared on every path.
 *
 * ⚠ NFR-012a — EXTRACTION IS QUALITY-FIRST. `estimatedCostUsd` is REPORTING
 * only. Nothing here may branch on it to pick a cheaper reader, skip a leg or
 * shorten a batch; a cost-motivated downgrade of extraction quality is
 * non-compliance, not an optimisation.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ---------------------------------------
 * It does not import Prisma, the blob store, Express, or a concrete extractor.
 * Every effect is an injected port ({@link RunExtractionPorts}), exactly as
 * `images/ingest.ts` injects {@link IngestStages}. That is what lets the whole
 * state machine be proven at unit level — which matters here beyond taste,
 * because `npm run coverage` excludes the integration project, so logic proven
 * only by an integration test scores as uncovered.
 *
 * It also does not run stage 2 (cleanup, TASK-057) or match (TASK-060). It
 * hands each image's stage-1 items to {@link RunExtractionPorts.recordItems}
 * and stops there.
 */

import {
  isExtractorError,
  isLowYield,
  type CrossCheckOutcome,
  type ExtractedTextItem,
  type ExtractionErrorCode,
  type ExtractionResult,
  type ImageFormat,
  type ImageMimeType,
  type TitleExtractor,
} from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import { isOutOfMemoryError } from '../images/transcode.js';

/**
 * IMAGE concurrency. **One. Serial. Not negotiable at 0.5 GiB** (REQ-079,
 * TASK-145, `RSK-016`).
 *
 * ⚠ `specs/ai.md` §2.2 reads *"Concurrency | 2 images in flight"* and
 * `T-BATCH-007` repeats *"image concurrency 2"*. That is a SPEC DEFECT and it
 * is reported, not silently followed: `docs/backlog.md` TASK-058 states, in
 * terms, *"the `concurrency 2` above is the extraction-call concurrency (two
 * reader legs); IMAGE processing is `concurrency = 1` per TASK-145 and that is
 * not negotiable at 0.5 GiB — do not 'optimise' it back to 2."*
 *
 * The physics decide it. Each in-flight image holds a decoded raster; the
 * pre-decode pixel guard is sized for ONE (`NEXTUP_MAX_DECODE_PIXELS`
 * = 25 MP against 0.5 GiB). Two 24 MP images each pass that guard individually
 * and together exhaust the container — the guard cannot see the second one.
 */
export const EXTRACTION_IMAGE_CONCURRENCY = 1;

/**
 * READER-LEG concurrency: the two calls for one image (vision + OCR) are
 * issued together. This constant documents the number; the parallelism itself
 * lives inside the hybrid extractor (TASK-056c), because the runner calls
 * `extract()` exactly once per image and cannot see the legs.
 */
export const EXTRACTION_READER_CONCURRENCY = 2;

/** `specs/ai.md` §2.2 — the whole-batch ceiling, raised from 10 for LLM latency. */
export const EXTRACTION_BATCH_TIMEOUT_MS = 900_000;

/** The MIME type an extractor may receive. HEIC never reaches this layer. */
const MIME_BY_FORMAT: Readonly<Record<ImageFormat, ImageMimeType>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
};

/**
 * Image-scoped failure codes that fail ONE IMAGE and never the batch
 * (`A43-M2`, REQ-080/081, TASK-154).
 *
 * ⚠ These are MEMORY and DECODE verdicts about one file. They are emphatically
 * NOT the extractor-reader failures in `specs/ai.md` §2.2 — an LLM or OCR
 * failure after retries fails the WHOLE batch (`T-AI-014`), because a
 * partially-extracted full-update batch reads as a wave of removals. Confusing
 * the two would breach product invariant 2 in the most damaging direction.
 *
 * ⚠ NOT the same list as `MEMORY_RELATED_CODES` in `errorCodes.ts`, and the
 * two must never be merged. That list is "whose message must name memory and
 * link the runbook" and deliberately EXCLUDES `IMAGE_DECODE_FAILED`, because
 * telling an owner to buy more memory for a truncated file is advice that can
 * never work. This list is "whose blast radius is one image", which a corrupt
 * file also has.
 */
const IMAGE_SCOPED_CODES: readonly string[] = [
  'IMAGE_DECODE_OOM',
  'IMAGE_DECODE_FAILED',
  'IMAGE_TOO_LARGE_TO_DECODE',
];

export interface ExtractionImageRef {
  readonly imageId: string;
  readonly fileName: string;
  readonly format: ImageFormat;
  readonly blobPath: string;
}

/** `specs/api.md` §6.15 — the polled progress shape. */
export interface ExtractionProgress {
  readonly imagesDone: number;
  readonly imagesTotal: number;
}

/**
 * The stage-1 slice of `uploadBatch.extractionStats`.
 *
 * Stages 2-5 add `candidatesAfterCleanup`, `candidatesCollapsed`, `matched`,
 * `unmatched` and `suppressedGated` (`specs/ai.md` §5, TASK-057/060). They are
 * absent here rather than zeroed: a zero is a measurement, and writing one for
 * a stage that never ran would be a false one.
 */
export interface ExtractionStats {
  imagesProcessed: number;
  imagesWithZeroCandidates: number;
  candidatesRaw: number;
  /**
   * Candidates surviving stage 2 (`cleanup`), reported by `recordItems`.
   *
   * ⚠ NOT DERIVABLE FROM `candidatesRaw`. Stage 2 merges `ocr-only` fragments
   * of one caption, so the two differ whenever a caption arrived in pieces —
   * and this is the arm `specs/ai.md` §8.1 reads, so guessing it from the raw
   * count would make the low-yield decision wrong on exactly the batches whose
   * reads were poorest.
   */
  candidatesAfterCleanup: number;
  /** REPORTING ONLY — never a branch (NFR-012a). */
  estimatedCostUsd: number;
}

/** One image that failed on memory/decode while the batch carried on. */
export interface ExtractionImageFailure {
  readonly imageId: string;
  readonly fileName: string;
  readonly code: string;
  readonly message: string;
}

export interface RunExtractionPorts {
  /**
   * Fetch the stored bytes. Throwing `AppError('IMAGES_PURGED')` is how a
   * caller reports that the 30-day retention window closed before a
   * re-extraction ran (US-034 AC-5).
   */
  loadImageBytes(image: ExtractionImageRef): Promise<Uint8Array>;
  /**
   * Stage-2 seam (TASK-057). Called once per image, in order.
   *
   * Returns the number of candidates that survived `cleanup` for this image.
   * ⚠ The COUNT, not `void`: stage 2 lives behind this port, so the runner
   * cannot see the post-cleanup total any other way, and `specs/ai.md` §8.1
   * decides low yield from it.
   */
  recordItems(image: ExtractionImageRef, items: readonly ExtractedTextItem[]): Promise<number>;
  /** Persist `progress` so `GET /api/batches/:batchId` can report it. */
  reportProgress(progress: ExtractionProgress): Promise<void> | void;
  now(): number;
  /**
   * The `A43-M5` decode sentinel (`docs/architecture.md` S1). A `begin` with
   * no matching `end` is the only signal that identifies WHICH image killed
   * the container, because a kernel OOM kill raises no error to catch.
   */
  log?(event: string, fields: Record<string, unknown>): void;
}

export interface RunExtractionInput {
  readonly batchId: string;
  readonly images: readonly ExtractionImageRef[];
  readonly extractor: TitleExtractor;
  readonly ports: RunExtractionPorts;
  /** Defaults to {@link EXTRACTION_BATCH_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
}

export interface ExtractionSucceeded {
  readonly status: 'in-review';
  readonly stats: ExtractionStats;
  /** `true` when any image fell back to OCR-only (`specs/ai.md` §2.2a). */
  readonly degradedExtraction: boolean;
  /**
   * `specs/ai.md` §8.1. Carried as STATE alongside `degradedExtraction`, and
   * for the same reason: it forces `computeRemovals: false` at review, so
   * recomputing it on read would let a later change to the stats shape quietly
   * unwithhold a batch the owner was already told nothing would be removed
   * from.
   */
  readonly lowYield: boolean;
  readonly crossCheck: CrossCheckOutcome;
  readonly imageFailures: readonly ExtractionImageFailure[];
  readonly progress: ExtractionProgress;
}

export interface ExtractionFailed {
  readonly status: 'extraction-failed';
  readonly errorCode: ExtractionErrorCode;
  readonly errorMessage: string;
  readonly stats: ExtractionStats;
  readonly progress: ExtractionProgress;
}

export type RunExtractionResult = ExtractionSucceeded | ExtractionFailed;

/**
 * Worst-of aggregation over the batch's per-image cross-check outcomes.
 *
 * ⚠ WORST-OF, NEVER LAST-WINS. This is safety state (`enums.ts`): anything
 * other than `'ok'` forces `computeRemovals: false`. If image 1 lost the LLM
 * and image 2 was clean, the BATCH was not corroborated, and letting image 2
 * overwrite image 1's verdict would let a degraded batch propose removals —
 * product invariant 2, in the direction that destroys data.
 */
const CROSS_CHECK_SEVERITY: Readonly<Record<CrossCheckOutcome, number>> = {
  ok: 0,
  'ocr-unavailable': 1,
  'llm-unavailable': 2,
};

function worstCrossCheck(a: CrossCheckOutcome, b: CrossCheckOutcome): CrossCheckOutcome {
  return CROSS_CHECK_SEVERITY[b] > CROSS_CHECK_SEVERITY[a] ? b : a;
}

/**
 * Is this an image-scoped memory/decode verdict?
 *
 * Two independent signals, because the two OOM paths look nothing alike
 * (`docs/architecture.md`, "the single most important operational fact"): a
 * WASM allocation failure arrives as an `AppError` we already classified,
 * while a raw `RangeError` from a decoder we did not wrap arrives as a bare
 * message. Handling only the first misses the likelier case.
 *
 * The third path — a kernel OOM kill — raises NOTHING and cannot be caught
 * here by construction. It is covered structurally: nothing is visible until
 * the review-close transaction (TASK-072), so a process death mid-batch
 * commits nothing. That is why the sentinel log exists.
 */
function imageScopedFailure(error: unknown): { code: string; message: string } | null {
  if (error instanceof AppError && IMAGE_SCOPED_CODES.includes(error.code)) {
    return { code: error.code, message: error.message };
  }
  if (isOutOfMemoryError(error)) {
    return {
      code: 'IMAGE_DECODE_OOM',
      message:
        'That image ran out of memory while being read. This is a memory limit, ' +
        'not a problem with your image. No other image in this batch was affected; ' +
        're-attach this file after up-sizing compute — see docs/runbooks/scale-up-memory.md.',
    };
  }
  return null;
}

/**
 * Read the provider's own cost figure.
 *
 * ⚠ Deliberately NOT computed here from token counts. A price table in the
 * runner would hard-code one model's rates into a provider-agnostic
 * orchestrator and drift silently the day the deployment changes; the reader
 * knows its own pricing. A missing or non-finite value contributes zero rather
 * than throwing — a cost figure is observability, and losing it must never
 * fail an owner's import (NFR-012a).
 */
function costOf(result: ExtractionResult): number {
  const raw = result.providerMeta['estimatedCostUsd'];
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

class BatchCeilingExceeded extends Error {}

/**
 * Race one image's extraction against the batch's remaining budget.
 *
 * Without this the ceiling would be advisory: a reader that hangs forever
 * would never reach the between-images check and the batch would run for ever.
 */
async function withinBudget<T>(work: Promise<T>, remainingMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new BatchCeilingExceeded());
        }, remainingMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Run stage 1 over a batch's images and decide the batch's fate.
 *
 * ⚠ SERIAL, NOT `Promise.all`. See {@link EXTRACTION_IMAGE_CONCURRENCY}.
 */
export async function runExtraction(input: RunExtractionInput): Promise<RunExtractionResult> {
  const { batchId, images, extractor, ports } = input;
  const timeoutMs = input.timeoutMs ?? EXTRACTION_BATCH_TIMEOUT_MS;
  const startedAt = ports.now();
  const deadline = startedAt + timeoutMs;

  const stats: ExtractionStats = {
    imagesProcessed: 0,
    imagesWithZeroCandidates: 0,
    candidatesRaw: 0,
    candidatesAfterCleanup: 0,
    estimatedCostUsd: 0,
  };
  const imageFailures: ExtractionImageFailure[] = [];
  let crossCheck: CrossCheckOutcome = 'ok';
  let imagesDone = 0;
  const imagesTotal = images.length;

  const progress = (): ExtractionProgress => ({ imagesDone, imagesTotal });
  const failed = (errorCode: ExtractionErrorCode, errorMessage: string): ExtractionFailed => ({
    status: 'extraction-failed',
    errorCode,
    errorMessage,
    stats,
    progress: progress(),
  });

  for (const image of images) {
    const remainingMs = deadline - ports.now();
    if (remainingMs <= 0) {
      return failed(
        'EXTRACTOR_ERROR',
        `Extraction for this batch passed its ${String(Math.round(timeoutMs / 60_000))}-minute limit and was stopped. ` +
          'Nothing was changed in your list. You can retry it.',
      );
    }

    let bytes: Uint8Array;
    try {
      bytes = await ports.loadImageBytes(image);
    } catch (error) {
      // A missing blob is the retention window having closed (US-034 AC-5).
      // It is a BATCH verdict, not an image one: re-reading the rest would
      // stage a partial full-update, which reads as removals.
      if (error instanceof AppError && error.code === 'IMAGES_PURGED') {
        return failed('IMAGES_PURGED', error.message);
      }
      throw error;
    }

    ports.log?.('image.decode.begin', {
      batchId,
      imageId: image.imageId,
      fileName: image.fileName,
      declaredBytes: bytes.byteLength,
    });

    let result: ExtractionResult;
    try {
      result = await withinBudget(
        extractor.extract(bytes, MIME_BY_FORMAT[image.format]),
        deadline - ports.now(),
      );
    } catch (error) {
      if (error instanceof BatchCeilingExceeded) {
        return failed(
          'EXTRACTOR_ERROR',
          `Extraction for this batch passed its ${String(Math.round(timeoutMs / 60_000))}-minute limit and was stopped. ` +
            'Nothing was changed in your list. You can retry it.',
        );
      }

      // ── ONE IMAGE, NOT THE BATCH (`A43-M2`) ──────────────────────────────
      const scoped = imageScopedFailure(error);
      if (scoped) {
        imageFailures.push({
          imageId: image.imageId,
          fileName: image.fileName,
          code: scoped.code,
          message: scoped.message,
        });
        imagesDone += 1;
        await ports.reportProgress(progress());
        continue;
      }

      // ── THE WHOLE BATCH (`specs/ai.md` §2.2, `T-AI-014`) ─────────────────
      // A reader that failed after its retries means this image was never
      // read. In full-update mode an unread image is indistinguishable from
      // a shelf of titles the owner deleted, so no partial extraction is ever
      // staged for review.
      if (isExtractorError(error)) {
        return failed(
          error.kind === 'unavailable' ? 'EXTRACTOR_UNAVAILABLE' : 'EXTRACTOR_ERROR',
          `${image.fileName} couldn't be read (${error.kind}). Nothing was changed in your list. You can retry it.`,
        );
      }
      throw error;
    }

    ports.log?.('image.decode.end', { batchId, imageId: image.imageId });

    crossCheck = worstCrossCheck(crossCheck, result.crossCheck);
    stats.imagesProcessed += 1;
    stats.candidatesRaw += result.items.length;
    if (result.items.length === 0) stats.imagesWithZeroCandidates += 1;
    stats.estimatedCostUsd += costOf(result);

    stats.candidatesAfterCleanup += await ports.recordItems(image, result.items);

    imagesDone += 1;
    await ports.reportProgress(progress());
  }

  // Every image failed on memory: there is nothing to review, and reporting
  // `in-review` with zero candidates would invite a full-update wave of
  // removals from a batch that read nothing at all.
  if (imagesTotal > 0 && stats.imagesProcessed === 0) {
    return failed(
      'EXTRACTOR_ERROR',
      'None of the images in this batch could be read. Nothing was changed in your list.',
    );
  }

  return {
    status: 'in-review',
    stats,
    // §2.2a — the LLM leg was missing, so this batch was read by OCR alone.
    // Carried as STATE, never recomputed on read: it forces
    // `computeRemovals: false` at review (`T-AI-036`).
    degradedExtraction: crossCheck === 'llm-unavailable',
    // §8.1 — the read was too thin to reason about removals from. Independent
    // of `degradedExtraction`: a fully corroborated read of five blank
    // screenshots is not degraded and is still low yield.
    lowYield: isLowYield(stats),
    crossCheck,
    imageFailures,
    progress: progress(),
  };
}
