import { parseWatchPreferencesPatch } from '@nextup/domain';
import type { Router } from 'express';

import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import {
  findActiveSuppression,
  findTitleDetail,
  lockTitleForWatchPreferences,
  runInTransaction,
  setWatchPreference,
} from '../repository/ownerData.js';

export function registerWatchPreferenceRoutes(router: Router): void {
  router.patch('/titles/:titleId/watch-preferences', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const titleId = req.params.titleId ?? '';
    const result = await runInTransaction(async (tx) => {
      await lockTitleForWatchPreferences(ownerId, titleId, tx);
      const title = await findTitleDetail(ownerId, titleId, tx);
      if (
        title === null ||
        title.state !== 'active' ||
        !title.listings.some((listing) => listing.state === 'active')
      ) {
        throw new AppError('NOT_FOUND', 404, 'No such active title.');
      }
      const parsed = parseWatchPreferencesPatch(req.body);
      if (!parsed.ok) throw new AppError('VALIDATION_FAILED', 400, parsed.message);
      const blocking = await findActiveSuppression(ownerId, title.workIdentity, tx);
      if (blocking !== null) {
        throw new AppError(
          'WORK_SUPPRESSED',
          409,
          'Un-suppress this title before changing its watch preferences.',
          {
            workIdentity: title.workIdentity,
            suppressionId: blocking.id,
            unsuppressHref: `/api/suppressions/${encodeURIComponent(blocking.id)}/unsuppress`,
          },
        );
      }
      return setWatchPreference(ownerId, title.workIdentity, parsed.value, tx);
    });
    res.status(200).json({ titleId, ...result });
  });
}
