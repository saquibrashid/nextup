/**
 * TASK-085 — `PATCH /api/batches/:batchId/removals` (`specs/api.md` §6.21,
 * US-015, REQ-021).
 *
 * Ticking and unticking proposed removals. Unticking is the **rescue** path:
 * it is the only way the owner keeps a title the screenshots no longer show,
 * and unticking every one of them is valid — it yields a zero-member removal
 * group at close (US-015 AC-5).
 *
 * ⚠ **Every id is checked against the LIVE removal set before it is stored.**
 * A tick for a listing this batch does not propose is refused, not ignored:
 * the request is asking for a listing to be removed that the owner was never
 * shown, and storing it would make the close remove it.
 *
 * Registered as its own route module, NOT inside the contended `batches.ts`.
 */

import { type Router } from 'express';
import {
  parseRemovalPatch,
  REMOVAL_PATCH_MESSAGES,
  type BatchMode,
  type Service,
} from '@nextup/domain';

import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import {
  findUploadBatch,
  listRemovalDecisions,
  runInTransaction,
  setRemovalDecisions,
} from '../repository/ownerData.js';

import { loadReviewCandidates, proposedRemovalsFrom } from './batchReview.js';

export function registerBatchRemovalRoutes(router: Router): void {
  router.patch('/batches/:batchId/removals', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const batchId = req.params.batchId ?? '';

    // ⚠ Existence and ownership BEFORE the body, matching every other write
    // here (`batchCandidates.ts`, `batchImages.ts`). `T-SEC-002g` walks every
    // id-bearing route on the real router with another owner's ids and
    // requires a flat 404; parsing first answers 400 for a foreign id, which
    // is a different answer from the one a missing id gets and so is a
    // disclosure.
    const batch = await findUploadBatch(ownerId, batchId);
    if (batch === null) {
      throw new AppError('NOT_FOUND', 404, 'No such batch.');
    }
    if (batch.status !== 'in-review') {
      throw new AppError('BATCH_NOT_IN_REVIEW', 409, 'That batch is not ready to review yet.', {
        status: batch.status,
      });
    }
    // ⚠ An append-only batch has NO removals — REQ-022 — so this is not an
    // empty set, it is a category error. Answering 200 with zero counts would
    // tell a client its tick was recorded against a section that does not
    // exist in that mode.
    if ((batch.mode as BatchMode) !== 'full-update') {
      throw new AppError('VALIDATION_FAILED', 400, 'Append-only batches propose no removals.', {
        mode: batch.mode,
      });
    }

    const parsed = parseRemovalPatch(req.body);
    if (!parsed.ok) {
      throw new AppError('VALIDATION_FAILED', 400, REMOVAL_PATCH_MESSAGES[parsed.reason], {
        reason: parsed.reason,
      });
    }

    const service = batch.service as Service;
    const loaded = await loadReviewCandidates(ownerId, batchId, service);
    const proposed = proposedRemovalsFrom(service, loaded);
    const proposedIds = new Set(proposed.map((item) => item.listingId));

    const unknown = [...parsed.patch.tick, ...parsed.patch.untick].filter(
      (id) => !proposedIds.has(id),
    );
    if (unknown.length > 0) {
      throw new AppError('NOT_FOUND', 404, 'That batch does not propose removing those.', {
        listingIds: unknown,
      });
    }

    // One transaction for the whole press. A half-applied tick leaves the
    // owner looking at a removal list that is neither the one they had nor the
    // one they asked for, and they have no way to tell which.
    await runInTransaction(async (tx) => {
      await setRemovalDecisions(ownerId, batchId, parsed.patch.untick, false, tx);
      await setRemovalDecisions(ownerId, batchId, parsed.patch.tick, true, tx);
    });

    // ⚠ Counts are re-derived from storage, never from the request. What the
    // owner needs back is the state of the batch, and computing it from the
    // instruction would report the state the request *intended* even if a
    // concurrent press changed something else.
    const decisions = await listRemovalDecisions(ownerId, batchId);
    const unticked = new Set(decisions.filter((d) => !d.ticked).map((d) => d.listingId));
    // Intersected with the live set: a decision about a listing this batch no
    // longer proposes is history, not a current tick.
    const untickedCount = proposed.filter((item) => unticked.has(item.listingId)).length;

    res.status(200).json({
      tickedCount: proposed.length - untickedCount,
      untickedCount,
      totalCount: proposed.length,
    });
  });
}
