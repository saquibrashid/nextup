/**
 * TASK-071 / TASK-086 — `POST /api/batches/:batchId/close` (`specs/api.md`
 * §6.22).
 *
 * Thin by design: everything this endpoint decides is decided in
 * `packages/domain/src/close.ts`, and everything it writes is written in
 * `apps/api/src/services/batchClose.ts`. What lives here is the HTTP shape.
 *
 * ⚠ `confirmRemovals` IS READ STRICTLY — only a literal `true` confirms. A
 * truthy coercion would let `"false"`, a stray `1`, or an absent field from a
 * half-built client stand in for the owner pressing the button, and REQ-020's
 * whole point is that removal is never a side effect of anything.
 */

import type { Router } from 'express';

import { requireOwnerId } from '../middleware/requestContext.js';
import { closeBatch } from '../services/batchClose.js';

export function registerBatchCloseRoutes(router: Router): void {
  router.post('/batches/:batchId/close', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const batchId = req.params.batchId ?? '';

    const body: unknown = req.body;
    const confirmRemovals =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)['confirmRemovals'] === true
        : false;

    const result = await closeBatch(ownerId, batchId, new Date(), { confirmRemovals });
    res.status(200).json(result);
  });
}
