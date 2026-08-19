/**
 * The trigger for stage-1 extraction (TASK-058 wiring).
 *
 * `runExtraction()` is a pure orchestrator over injected ports: it decides
 * nothing about storage, configuration or batch status. This module is the
 * only place those three meet, and it is deliberately the only caller.
 *
 * ⚠ THREE PROPERTIES HERE ARE LOAD-BEARING.
 *
 * 1. **It never rejects.** It is invoked fire-and-forget from the `/submit`
 *    handler after the 202 has been decided, so an unhandled rejection would
 *    be an `unhandledRejection` on a single-process container — i.e. the whole
 *    API dies because one screenshot was odd. Every path ends in a recorded
 *    batch status.
 * 2. **A batch never silently stops.** Every failure — misconfiguration,
 *    purged blobs, an exception from anywhere — lands as
 *    `status: 'extraction-failed'` with a code from the closed
 *    `EXTRACTION_ERROR_CODES` enum. A batch left in `extracting` while the SPA
 *    polls forever is worse than a clear refusal: it looks like it is working.
 * 3. **The `submitted -> extracting` move is the concurrency control.** It
 *    goes through `transitionUploadBatchStatus`, whose `status: from`
 *    predicate makes the check and the write one statement. Two overlapping
 *    submits therefore cannot both extract the same batch — exactly one sees a
 *    count of 1, and the loser returns without touching anything.
 *
 * Nothing here changes user-visible LIST state: candidates are staged for
 * review and the owner closes the batch later (product invariant 5).
 */

import { cleanup, ulid, type TitleExtractor } from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import { createExtractor } from '../extraction/factory.js';
import { extractorConfigFromEnv } from '../extraction/configFromEnv.js';
import { azureImageBlobStore, type ImageBlobStore } from '../storage/blobStore.js';
import {
  createExtractionCandidate,
  listImagesForBatch,
  recordExtractionOutcome,
  transitionUploadBatchStatus,
  type OwnerId,
} from '../repository/ownerData.js';
import {
  runExtraction,
  type ExtractionImageRef,
  type ExtractionProgress,
  type RunExtractionPorts,
  type RunExtractionResult,
} from './runExtraction.js';

/** Injected in tests; defaulted to the real collaborators in production. */
export interface StartExtractionDeps {
  blobStore?: ImageBlobStore;
  /** Overrides the environment-built extractor. */
  extractor?: TitleExtractor;
  log?: (event: string, fields: Record<string, unknown>) => void;
  now?: () => number;
}

/**
 * What goes into `uploadBatch.extractionStats`.
 *
 * ⚠ NOT `extractionStatsSchema` from the domain. That schema is `.strict()`
 * and requires `candidatesAfterCleanup`, `candidatesCollapsed`, `matched`,
 * `unmatched` and `suppressedGated` — stages 2-5, which have not run
 * (TASK-057/060). Writing zeros for them to satisfy the schema would record
 * five measurements that were never taken, into the one field
 * `docs/architecture.md` calls the only evidence for RSK-021. The stage-1
 * slice is nested under its own key instead, so stages 2-5 can add theirs
 * without any value here ever having been a lie.
 */
interface PersistedExtractionStats {
  stage1: RunExtractionResult['stats'];
  progress: ExtractionProgress;
  imageFailures?: readonly { imageId: string; fileName: string; code: string; message: string }[];
}

/**
 * Ports over the real store and database.
 *
 * `imageOrdinals` is closed over rather than derived inside `recordItems`,
 * because `CandidateSourceImage.ordinal` must preserve the §7.4
 * `(imageIndex, ...)` reading order and the port is handed one image at a
 * time with no idea where it sat in the batch.
 */
export function extractionPorts(
  ownerId: OwnerId,
  batchId: string,
  images: readonly ExtractionImageRef[],
  deps: StartExtractionDeps = {},
): RunExtractionPorts {
  const store = deps.blobStore ?? azureImageBlobStore;
  const imageOrdinals = new Map(images.map((image, index) => [image.imageId, index]));
  const clock = deps.now ?? (() => Date.now());

  const ports: RunExtractionPorts = {
    async loadImageBytes(image) {
      const bytes = await store.get(image.blobPath);
      if (bytes === null) {
        // US-034 AC-5. The 30-day retention window (NFR-019) closed before a
        // re-extraction ran. This is a normal outcome with a specific message,
        // not a storage fault: the owner must be told the screenshots are gone
        // and asked for new ones, never shown a generic failure.
        throw new AppError(
          'IMAGES_PURGED',
          410,
          'The screenshots for this batch have passed the 30-day retention window and ' +
            'have been deleted. Upload them again to re-run extraction.',
          { imageId: image.imageId },
        );
      }
      return bytes;
    },

    async recordItems(image, items) {
      const ordinal = imageOrdinals.get(image.imageId) ?? 0;
      // Stage 2 (`specs/ai.md` §3, TASK-057). It classifies and may MERGE
      // `ocr-only` fragments of one caption; it never drops one, so the rows
      // written below still account for every piece of text the readers saw.
      const cleaned = cleanup(items);
      // Serial, and NOT `Promise.all`. These are inserts against a 5-DTU Basic
      // database from a 0.25-vCPU container; fanning out a screenshot's worth
      // of rows buys nothing and competes with the next image's extraction.
      for (const candidate of cleaned) {
        const item = candidate.item;
        await createExtractionCandidate(ownerId, {
          id: ulid(),
          batchId,
          // ALWAYS verbatim, and always shown beside the resolved match
          // (§3.1a, US-007 AC-3) so the owner can see what was on screen
          // versus what the reader concluded. Never replaced by `matchText`.
          rawText: item.rawText,
          inferredTitle: item.inferredTitle,
          basis: item.basis,
          ocrSupport: item.ocrSupport,
          provider: item.provider,
          // The grouping key for collapse, BIN2-collated in the migration.
          normalisedText: candidate.normalisedText,
          extractedYear: candidate.extractedYear,
          boundingBoxes: JSON.stringify([item.boundingBox]),
          boxSource: item.boxSource,
          ocrConfidence: item.confidence,
          cleanupVerdict: candidate.cleanupVerdict,
          sourceImages: { create: [{ ownerId, imageId: image.imageId, ordinal }] },
        });
      }
    },

    async reportProgress(progress) {
      // Swallowed on purpose. Progress is observability; a transient write
      // failure here must not fail an image, and certainly not the batch. The
      // authoritative counts are written once at the end regardless.
      try {
        await recordExtractionOutcome(ownerId, batchId, {
          extractionStats: JSON.stringify({ progress } satisfies Pick<
            PersistedExtractionStats,
            'progress'
          >),
        });
      } catch (error) {
        deps.log?.('extraction.progress_write_failed', { error: String(error) });
      }
    },

    now: clock,
  };

  return deps.log ? { ...ports, log: deps.log } : ports;
}

/**
 * Run stage-1 extraction for a submitted batch. Never rejects.
 */
export async function startExtraction(
  ownerId: OwnerId,
  batchId: string,
  deps: StartExtractionDeps = {},
): Promise<void> {
  const log = deps.log ?? (() => undefined);
  const startedAt = new Date();

  try {
    const claimed = await transitionUploadBatchStatus(ownerId, batchId, 'submitted', {
      status: 'extracting',
      extractionStartedAt: startedAt,
    });
    if (claimed === 0) {
      // Not ours, already extracting, or already resolved. Returning is the
      // whole point of the guard — see property 3 in the header.
      log('extraction.not_claimed', { batchId });
      return;
    }

    const rows = await listImagesForBatch(ownerId, batchId);
    const images: ExtractionImageRef[] = rows.map((row) => ({
      imageId: row.id,
      fileName: row.fileName,
      format: row.format as ExtractionImageRef['format'],
      blobPath: row.blobPath,
    }));

    let extractor: TitleExtractor;
    try {
      extractor = deps.extractor ?? createExtractor(extractorConfigFromEnv());
    } catch (error) {
      // The capability gate (see `configFromEnv.ts`). An environment with no
      // reader configured refuses LOUDLY and keeps its images, so the owner
      // gets a message and a retry rather than a batch that never moves.
      await fail(
        ownerId,
        batchId,
        'EXTRACTOR_UNAVAILABLE',
        'Screenshot reading is not configured in this environment, so nothing was ' +
          'extracted. Your screenshots are safe and nothing in your list changed. ' +
          'Try again once it is available.',
        { imagesDone: 0, imagesTotal: images.length },
      );
      log('extraction.extractor_unavailable', { batchId, error: String(error) });
      return;
    }

    const result = await runExtraction({
      batchId,
      images,
      extractor,
      ports: extractionPorts(ownerId, batchId, images, deps),
    });

    const stats: PersistedExtractionStats = {
      stage1: result.stats,
      progress: result.progress,
      ...(result.status === 'in-review' && result.imageFailures.length > 0
        ? { imageFailures: result.imageFailures }
        : {}),
    };

    if (result.status === 'in-review') {
      await recordExtractionOutcome(ownerId, batchId, {
        status: 'in-review',
        extractionStats: JSON.stringify(stats),
        // SAFETY STATE, not statistics: each of these forces
        // `computeRemovals: false` downstream, so they must survive the round
        // trip to the review request and must never be recomputed on read.
        degradedExtraction: result.degradedExtraction,
        crossCheck: result.crossCheck,
      });
      log('extraction.completed', {
        batchId,
        candidatesRaw: result.stats.candidatesRaw,
        degraded: result.degradedExtraction,
        crossCheck: result.crossCheck,
        imageFailures: result.imageFailures.length,
      });
      return;
    }

    await fail(ownerId, batchId, result.errorCode, result.errorMessage, result.progress, stats);
    log('extraction.failed', { batchId, code: result.errorCode });
  } catch (error) {
    // The last resort. Anything unanticipated — a dropped connection, a bug in
    // this module — still leaves the owner a batch they can see and retry
    // rather than a process-killing rejection.
    log('extraction.unexpected_error', { batchId, error: String(error) });
    try {
      await fail(
        ownerId,
        batchId,
        'EXTRACTOR_ERROR',
        'Something went wrong while reading your screenshots. Your screenshots are ' +
          'safe and nothing in your list changed. Try again.',
        { imagesDone: 0, imagesTotal: 0 },
      );
    } catch (recordError) {
      log('extraction.failure_write_failed', { batchId, error: String(recordError) });
    }
  }
}

async function fail(
  ownerId: OwnerId,
  batchId: string,
  code: string,
  message: string,
  progress: ExtractionProgress,
  stats?: PersistedExtractionStats,
): Promise<void> {
  await recordExtractionOutcome(ownerId, batchId, {
    status: 'extraction-failed',
    extractionErrorCode: code,
    extractionErrorMessage: message,
    extractionErrorAt: new Date(),
    extractionStats: JSON.stringify(
      stats ?? ({ stage1: emptyStats(), progress } satisfies PersistedExtractionStats),
    ),
  });
}

/**
 * Zeroes are honest HERE and only here: this is the shape written when the run
 * did not start, so nothing was processed and no candidate was produced.
 */
function emptyStats(): RunExtractionResult['stats'] {
  return {
    imagesProcessed: 0,
    imagesWithZeroCandidates: 0,
    candidatesRaw: 0,
    estimatedCostUsd: 0,
  };
}

/* ------------------------------------------------------------------ *
 * The fire-and-forget entry point, and its test seam
 * ------------------------------------------------------------------ */

const inFlight = new Map<string, Promise<void>>();

/**
 * Start extraction without waiting for it. The route's only entry point.
 *
 * ⚠ WHY THIS EXISTS RATHER THAN A BARE `void startExtraction(...)`. The moment
 * the 202 is written, extraction is racing the client — and, in a test, racing
 * the assertion on the next line. `T-BATCH-019a` read the batch row straight
 * after submit and got `extraction-failed`, because CI configures no extractor
 * and the capability gate correctly refuses in microseconds. That is not a
 * test artefact to be papered over with a looser assertion: the race is real,
 * it is nondeterministic, and it would have surfaced later as an intermittent
 * failure in whichever test happened to lose it that day. Tracking the promise
 * lets a test await the settled state deterministically WITHOUT the route
 * awaiting anything, so production behaviour is byte-for-byte unchanged.
 */
export function beginExtraction(
  ownerId: OwnerId,
  batchId: string,
  deps: StartExtractionDeps = {},
): void {
  // `.catch` is the belt to `startExtraction`'s braces: an unhandled rejection
  // on a single-process container kills the API.
  const run: Promise<void> = startExtraction(ownerId, batchId, deps)
    .catch(() => undefined)
    .finally(() => {
      // Only clear our own entry — a resubmit of the same batch may already
      // have registered a newer run.
      if (inFlight.get(batchId) === run) inFlight.delete(batchId);
    });
  inFlight.set(batchId, run);
}

/**
 * TEST SEAM. Resolves once the extraction started for `batchId` has settled,
 * or immediately if none is running. Never rejects.
 */
export async function extractionSettled(batchId: string): Promise<void> {
  await inFlight.get(batchId);
}
