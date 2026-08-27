/**
 * TASK-090 — `POST /api/removal-groups/:groupId/undo` (`specs/api.md` §6.26,
 * US-017).
 *
 * Thin by design: the writes are `apps/api/src/services/removalGroupUndo.ts`
 * and what lives here is the HTTP shape.
 *
 * ⚠ There is NO request body and none may be added. Undo takes no options —
 * a `confirm` flag would imply the held-back refusal is something the owner can
 * click through, and suppression winning over restore (AC-4) is a decision they
 * already made, not a warning.
 */

import type { Router } from 'express';

import { requireOwnerId } from '../middleware/requestContext.js';
import { undoRemovalGroup } from '../services/removalGroupUndo.js';

export function registerRemovalGroupRoutes(router: Router): void {
  router.post('/removal-groups/:groupId/undo', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const result = await undoRemovalGroup(ownerId, req.params.groupId ?? '');
    res.status(200).json(result);
  });
}
