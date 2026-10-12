/**
 * `DELETE /api/listings/:listingId/permanent` and
 * `DELETE /api/works/:workIdentity/history` — owner-initiated permanent delete
 * from the Removed view (`specs/api.md` §6.54 and §6.55, US-067, REQ-133, A58).
 *
 * ⚠ These two routes are the ONLY way a removed listing is ever erased, and
 * only on an explicit owner request. 404 (never 403) for another owner's id.
 */

import { type Router } from 'express';

import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import {
  permanentlyDeleteListing,
  permanentlyDeleteWorkHistory,
} from '../services/permanentDelete.js';

export function registerPermanentDeleteRoutes(router: Router): void {
  router.delete('/listings/:listingId/permanent', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const listingId = req.params.listingId ?? '';
    if (listingId === '') throw new AppError('NOT_FOUND', 404, 'No such listing.');
    res.status(200).json(await permanentlyDeleteListing(ownerId, listingId));
  });

  router.delete('/works/:workIdentity/history', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const workIdentity = req.params.workIdentity ?? '';
    if (workIdentity === '') throw new AppError('NOT_FOUND', 404, 'No such work.');
    res.status(200).json(await permanentlyDeleteWorkHistory(ownerId, workIdentity));
  });
}
