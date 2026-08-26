/**
 * TASK-071 — `POST /api/batches/:batchId/close` (`specs/api.md` §6.22).
 *
 * Thin by design: everything this endpoint decides is decided in
 * `packages/domain/src/close.ts`, and everything it writes is written in
 * `apps/api/src/services/batchClose.ts`. What lives here is the HTTP shape.
 *
 * ⚠ THE BODY IS NOT READ YET, AND THAT IS DELIBERATE. §6.22 defines
 * `{ "confirmRemovals": true }`, but the gate it drives — 409
 * `REMOVALS_NOT_CONFIRMED` when a full-update batch proposes removals — is
 * TASK-086, and removals themselves are TASK-083. Accepting the flag now and
 * ignoring it would be worse than not accepting it: a client that sent
 * `confirmRemovals: true` would be told the removals were confirmed while
 * nothing was removed, and would have no way to tell that apart from a batch
 * that proposed none. Until TASK-086 lands, close applies additions only, and
 * REQ-020's "removal is never a side effect of closing" holds trivially.
 */

import type { Router } from 'express';

import { requireOwnerId } from '../middleware/requestContext.js';
import { closeBatch } from '../services/batchClose.js';

export function registerBatchCloseRoutes(router: Router): void {
  router.post('/batches/:batchId/close', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const batchId = req.params.batchId ?? '';

    const result = await closeBatch(ownerId, batchId);
    res.status(200).json(result);
  });
}
