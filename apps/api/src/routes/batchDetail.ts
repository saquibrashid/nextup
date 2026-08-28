/**
 * `GET /api/batches/:batchId` (`specs/api.md` §6.15) and `GET /api/batches`
 * (§6.15a) — TASK-076.
 *
 * ⚠ **THE DETAIL ROUTE WAS MISSING AND THE SPA WAS ALREADY CALLING IT.**
 * `apps/web/src/lib/apiClient.ts` has carried a `getBatch` method since
 * TASK-059, and `containers/BatchStatusRoute.tsx` polls it every two seconds
 * as the whole of US-006 AC-1 — against a route no router registered. Every
 * poll answered 404, so a real extraction would have looked permanently stuck
 * with no error to explain it. Nothing caught this because the SPA's own tests
 * stub the client and the API's tests only assert routes that exist: a route
 * that is *absent* is asserted by nobody on either side. `T-BATCH-017` now
 * pins the pairing directly.
 *
 * ⚠ **`available` IS DERIVED, NEVER STORED**, and it is derived by the SAME
 * predicate the byte route uses (`isExpired`, imported rather than restated).
 * The 30-day purge is an Azure Blob Storage lifecycle rule that writes nothing
 * back to the row (ADR-0006), so a second copy of the `<=` boundary here would
 * eventually disagree with `GET /api/images/:imageId` and offer the owner a
 * thumbnail that 410s when clicked.
 *
 * ⚠ **`progress` IS READ BACK FROM THE PERSISTED STATS, NOT RECOMPUTED.**
 * Counting images whose `candidateCount is not null` looks equivalent and is
 * not: an image that failed on memory (REQ-080) never gets a count, so a
 * recomputed `imagesDone` would stall one short of `imagesTotal` forever and
 * the status page would never leave its running state.
 */

import { type Router } from 'express';
import { toBatchProvenance, type BatchProvenance } from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import {
  countBatchChangeKinds,
  findUploadBatch,
  listBatchChanges,
  listBatchHistory,
  listImagesForBatch,
  listTitleNames,
} from '../repository/ownerData.js';
import { isExpired } from './images.js';

/**
 * How many batches one history page carries.
 *
 * The history is not paginated in v1: a single owner uploading a handful of
 * captures a month will not reach this in the product's lifetime, and a cursor
 * nobody exercises is a cursor nobody has debugged. The cap exists so that an
 * unexpected volume degrades into a truncated page rather than an unbounded
 * read on a 5-DTU database.
 */
export const BATCH_HISTORY_LIMIT = 50;

/** Statuses during which `progress` is part of the response (US-006 AC-1). */
export const IN_FLIGHT_STATUSES = new Set(['submitted', 'extracting']);

interface PersistedStatsShape {
  progress?: { imagesDone?: unknown; imagesTotal?: unknown };
}

/**
 * The `{ imagesDone, imagesTotal }` pair, or `null` when it was never written.
 *
 * ⚠ Returns `null` rather than `{ 0, 0 }` for an unwritten value. A zeroed
 * pair renders as "0 of 0 screenshots read", which is a claim; the absence
 * renders as nothing, which is the truth before extraction has reported.
 */
export function readProgress(
  extractionStats: string | null,
): { imagesDone: number; imagesTotal: number } | null {
  if (extractionStats === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractionStats);
  } catch {
    // The column is CHECK-guarded by `ISJSON`, so this is unreachable through
    // the application. It is caught rather than thrown because the status page
    // is what an owner opens when something has already gone wrong, and taking
    // it out over a malformed observability field would hide the failure it
    // exists to explain.
    return null;
  }
  const progress = (parsed as PersistedStatsShape | null)?.progress;
  if (progress === undefined || progress === null) return null;
  const { imagesDone, imagesTotal } = progress;
  if (typeof imagesDone !== 'number' || typeof imagesTotal !== 'number') return null;
  return { imagesDone, imagesTotal };
}

/** Every title id the three provenance arrays name, de-duplicated. */
export function provenanceTitleIds(provenance: BatchProvenance): string[] {
  const ids = new Set<string>();
  for (const entry of provenance.created) ids.add(entry.titleId);
  for (const entry of provenance.modified) ids.add(entry.titleId);
  for (const entry of provenance.removed) ids.add(entry.titleId);
  return [...ids];
}

/**
 * Did this batch change anything at all? (`ux-states.md` §9.5.)
 *
 * ⚠ Exported and asserted directly. §9.5 requires the detail view to SAY *"This
 * upload didn't change anything"* rather than render three empty panels, and
 * that sentence is only correct if all three arrays are empty — a batch that
 * only modified something must not claim it changed nothing.
 */
export function changedNothing(provenance: BatchProvenance): boolean {
  return (
    provenance.created.length === 0 &&
    provenance.modified.length === 0 &&
    provenance.removed.length === 0
  );
}

export function registerBatchDetailRoutes(router: Router): void {
  // §6.15a. Registered BEFORE `/batches/:batchId` is irrelevant to Express
  // here — the paths differ in segment count — but the two live in one file so
  // that the list's counts and the detail's arrays are folded by the same
  // module and cannot drift apart.
  router.get('/batches', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const batches = await listBatchHistory(ownerId, BATCH_HISTORY_LIMIT);
    const counts = await countBatchChangeKinds(
      ownerId,
      batches.map((batch) => batch.id),
    );

    // Folded per batch through the SAME function the detail view uses, so a
    // card reading "Created 6" and a detail page listing five entries is not
    // an outcome this code can produce (`T-BATCH-018`).
    const rowsByBatch = new Map<string, { kind: string; count: number }[]>();
    for (const row of counts) {
      const existing = rowsByBatch.get(row.batchId) ?? [];
      existing.push({ kind: row.kind, count: row._count._all });
      rowsByBatch.set(row.batchId, existing);
    }

    res.status(200).json({
      batches: batches.map((batch) => {
        const rows = rowsByBatch.get(batch.id) ?? [];
        // `toBatchProvenance` folds a `title_created` into its `listing_added`
        // sibling, and the grouped counts cannot express that fold — so the
        // card's `created` is the `listing_added` count plus only those
        // `title_created` rows with no listing. A batch always writes both, so
        // the second term is zero in practice and present for the I-3 case the
        // fold itself reports rather than hides.
        const kind = (name: string) => rows.find((row) => row.kind === name)?.count ?? 0;
        const listingsAdded = kind('listing_added');
        const titlesCreated = kind('title_created');
        return {
          batchId: batch.id,
          service: batch.service,
          mode: batch.mode,
          status: batch.status,
          createdAt: batch.createdAt.toISOString(),
          submittedAt: batch.submittedAt?.toISOString() ?? null,
          completedAt: batch.completedAt?.toISOString() ?? null,
          undoneAt: batch.undoneAt?.toISOString() ?? null,
          counts: {
            created: Math.max(listingsAdded, titlesCreated),
            modified: kind('attr_modified'),
            removed: kind('listing_removed'),
          },
        };
      }),
    });
  });

  router.get('/batches/:batchId', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const batchId = req.params.batchId ?? '';

    const batch = await findUploadBatch(ownerId, batchId);
    if (batch === null) {
      // Indistinguishable from another owner's batch, deliberately — the same
      // rule `GET /api/images/:imageId` follows (US-036 AC-3).
      throw new AppError('NOT_FOUND', 404, 'No such batch.');
    }

    const now = new Date();
    const images = await listImagesForBatch(ownerId, batchId);
    const changes = await listBatchChanges(ownerId, batchId);
    const provenance = toBatchProvenance(changes);
    const titles = await listTitleNames(ownerId, provenanceTitleIds(provenance));
    const progress = readProgress(batch.extractionStats);

    res.status(200).json({
      batchId: batch.id,
      service: batch.service,
      mode: batch.mode,
      status: batch.status,
      derivedFromBatchId: batch.derivedFromBatchId,
      createdAt: batch.createdAt.toISOString(),
      submittedAt: batch.submittedAt?.toISOString() ?? null,
      completedAt: batch.completedAt?.toISOString() ?? null,
      images: images.map((image) => ({
        imageId: image.id,
        fileName: image.fileName,
        ingestSource: image.ingestSource,
        available: !isExpired(image.retainUntil, now),
        retainUntil: image.retainUntil.toISOString(),
        candidateCount: image.candidateCount,
        // An API path, never a blob URL (NFR-020). `blobPath` must not appear
        // in any response at all (`T-SEC-003`).
        href: `/api/images/${image.id}`,
      })),
      // The extraction-error CODE, not the message: the SPA owns the wording
      // for every code (`ux-states.md` §5.5-§5.7) and rendering a server
      // sentence instead would give the same failure two different voices.
      extractionError: batch.extractionErrorCode,
      lowYield: batch.lowYield,
      // SAFETY STATE, carried because the status page renders the degraded
      // banner from it (`T-UX-008`) and had no way to know it until now.
      degradedExtraction: batch.degradedExtraction,
      crossCheck: batch.crossCheck,
      ...(IN_FLIGHT_STATUSES.has(batch.status) && progress !== null ? { progress } : {}),
      provenance,
      changedNothing: changedNothing(provenance),
      titles: titles.map((title) => ({
        titleId: title.id,
        name: title.tmdbName ?? title.rawExtractedText ?? '',
        year: title.tmdbReleaseYear,
        state: title.state,
      })),
    });
  });
}
