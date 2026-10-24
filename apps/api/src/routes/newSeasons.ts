/**
 * #454 (PRD `A64`, US-072 / REQ-138) — track a REMOVED TV show for a new
 * season.
 *
 * ⚠ BOTH ROUTES ARE OWNER ACTIONS, AND NEITHER CHANGES THE LIBRARY.
 * `POST …/new-season-tracking` records the owner's opt-in and, when TMDB
 * already announces a dated new season, opens a Waiting entry carrying that
 * season and its date — the same entry "Add to Waiting" makes. The show
 * returns to the Library only through Waiting's own "Add to Library"
 * (`POST /api/waiting/:intentId/promote`) once the season is out, which the
 * owner taps. Nothing here, and no read, ever lists a title.
 *
 * ⚠ A show TMDB has no dated season for stays removed and tracked; the lazy
 * re-check in `GET /api/waiting` picks the announcement up later and offers
 * it — it never acts on it.
 */

import { type Router } from 'express';

import { TmdbClient } from '../clients/tmdbClient.js';
import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import {
  findActiveSuppression,
  findTitle,
  listListedWorkIdentities,
  listWaitingWorkIdentities,
} from '../repository/ownerData.js';
import { recordSeasonFacts, setSeasonTracking } from '../repository/seasonTracking.js';
import { addSearchWaitingIntent } from './waiting.js';

export type NewSeasonTmdb = Pick<TmdbClient, 'getNextSeason' | 'getWork'>;

export function registerNewSeasonRoutes(
  router: Router,
  getTmdb: () => NewSeasonTmdb = () =>
    new TmdbClient({ apiKey: process.env['TMDB_API_KEY'] ?? '' }),
): void {
  router.post('/titles/:titleId/new-season-tracking', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const titleId = req.params.titleId ?? '';

    // T-SEC-002g: a foreign id is a 404.
    const title = await findTitle(ownerId, titleId);
    if (title === null) throw new AppError('NOT_FOUND', 404, 'No such title.');
    const { workIdentity, tmdbId } = title;
    if (title.tmdbMediaType !== 'tv' || tmdbId === null) {
      throw new AppError('VALIDATION_FAILED', 400, 'Only a matched TV show can be tracked.', {
        titleId,
      });
    }
    if (
      (await listListedWorkIdentities(ownerId, undefined, { visibleOnly: true })).has(workIdentity)
    ) {
      throw new AppError(
        'TITLE_NOT_ACTIVE',
        409,
        "That show is in your library, so there's nothing to track. Nothing was changed.",
        { titleId },
      );
    }
    const blocking = await findActiveSuppression(ownerId, workIdentity);
    if (blocking !== null) {
      throw new AppError(
        'WORK_SUPPRESSED',
        409,
        "You marked that title as not interested. Un-suppress it first if you'd like to track it.",
        { workIdentity, suppressionId: blocking.id },
      );
    }
    if ((await listWaitingWorkIdentities(ownerId)).has(workIdentity)) {
      res.status(200).json({ titleId, status: 'waiting', season: null, lookupFailed: false });
      return;
    }
    await setSeasonTracking(ownerId, workIdentity, true);

    const tmdb = getTmdb();
    const now = new Date();
    let season;
    let detail;
    try {
      season = await tmdb.getNextSeason(tmdbId, now.toISOString().slice(0, 10));
      detail = season === null ? null : await tmdb.getWork('tv', tmdbId);
    } catch {
      // TMDB being unavailable is not the owner's problem: tracking is on and
      // the next open of Waiting asks again.
      res.status(200).json({ titleId, status: 'tracking', season: null, lookupFailed: true });
      return;
    }
    await recordSeasonFacts(ownerId, workIdentity, { checkedAt: now, season });

    if (season === null || detail === null) {
      res.status(200).json({ titleId, status: 'tracking', season: null, lookupFailed: false });
      return;
    }
    const result = await addSearchWaitingIntent(ownerId, workIdentity, detail, season);
    await setSeasonTracking(ownerId, workIdentity, false);
    res.status(201).json({
      titleId,
      status: 'waiting',
      season,
      intentId: result.intentId,
      lookupFailed: false,
    });
  });

  router.post('/titles/:titleId/new-season-tracking/stop', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const titleId = req.params.titleId ?? '';
    const title = await findTitle(ownerId, titleId);
    if (title === null) throw new AppError('NOT_FOUND', 404, 'No such title.');
    await setSeasonTracking(ownerId, title.workIdentity, false);
    res.status(200).json({ titleId, status: 'stopped' });
  });
}
