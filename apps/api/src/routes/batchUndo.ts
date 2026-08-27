/**
 * TASK-112 — `POST /api/batches/:batchId/undo` (`specs/api.md` §6.25, US-032).
 *
 * Thin by design: the predicate is `packages/domain/src/undo.ts`, the writes
 * are `apps/api/src/services/batchUndo.ts`, and what lives here is the HTTP
 * shape.
 *
 * ⚠ Its own file rather than a handler in `batches.ts`. `batches.ts` is a
 * contended file that several lanes need to keep small, and undo shares
 * nothing with the lifecycle routes but the batch id — the same reasoning that
 * put review and close in their own files.
 *
 * ⚠ There is NO request body and none may be added. Undo takes no options: a
 * `confirm` flag would imply the refusal is something the owner can override,
 * and §8.4's refusal is a repair workflow, not a warning to click through.
 */

import type { Router } from 'express';

import { requireOwnerId } from '../middleware/requestContext.js';
import { undoBatch } from '../services/batchUndo.js';

export function registerBatchUndoRoutes(router: Router): void {
  router.post('/batches/:batchId/undo', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const result = await undoBatch(ownerId, req.params.batchId ?? '');
    res.status(200).json(result);
  });
}
