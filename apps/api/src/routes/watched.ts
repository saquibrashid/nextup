/**
 * #325 / #465 (PRD `A66`, US-074 / REQ-140) — "Finished watching".
 *
 * ⚠ SEPARATE FROM REMOVE. Recording that the owner finished a title changes
 * nothing about the Library. Only `POST …/library-hidden` takes it off the
 * combined list, and the web calls it only after the owner confirms. That
 * route hides the work with `watch_preference.library_hidden` — no listing is
 * touched, so a re-capture cannot resurrect it as unwatched, and it is not a
 * suppression ("not interested") nor an entry in the removal log.
 *
 * Records are keyed on canonical work identity (and a season number) and are
 * never deleted: "not finished" clears the flag and keeps the date and rating.
 * TMDB is asked only inside an owner request, for the season list.
 */

import {
  allAiredSeasonsFinished,
  parseFinishedRequest,
  parseWatchedPatch,
  seasonProgress,
  WHOLE_TITLE_SEASON,
} from '@nextup/domain';
import { type Router } from 'express';

import { TmdbClient, type ShowSeason } from '../clients/tmdbClient.js';
import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import { findTitle, listListedWorkIdentities } from '../repository/ownerData.js';
import { satisfyWaitingIntents } from '../repository/watchIntents.js';
import {
  isLibraryHidden,
  latestTitlesByIdentity,
  listFinishedRecords,
  listHiddenIdentities,
  listWatchRecords,
  setLibraryHidden,
  writeWatchRecord,
  type WatchRecordView,
  type WatchSnapshot,
} from '../repository/watchRecords.js';

export type WatchedTmdb = Pick<TmdbClient, 'getSeasons'>;

type TitleRow = NonNullable<Awaited<ReturnType<typeof findTitle>>>;

const HISTORY_PAGE = 25;
const MAX_PAGE = 100;

function snapshotOf(title: TitleRow): WatchSnapshot {
  return {
    titleName:
      title.tmdbName ?? title.normalisedText ?? title.rawExtractedText ?? title.workIdentity,
    releaseYear: title.tmdbReleaseYear,
    mediaType: title.tmdbMediaType,
    posterPath: title.tmdbPosterPath,
  };
}

const isShow = (title: TitleRow): title is TitleRow & { tmdbId: number } =>
  title.tmdbMediaType === 'tv' && title.tmdbId !== null;

async function requireTitle(ownerId: Parameters<typeof findTitle>[0], titleId: string) {
  // T-SEC-002g: a foreign id is a 404.
  const title = await findTitle(ownerId, titleId);
  if (title === null) throw new AppError('NOT_FOUND', 404, 'No such title.');
  return title;
}

/** `null` when TMDB cannot answer — the view then degrades to what is recorded. */
async function loadSeasons(tmdb: WatchedTmdb, tmdbId: number): Promise<ShowSeason[] | null> {
  try {
    return await tmdb.getSeasons(tmdbId);
  } catch {
    return null;
  }
}

function recordFacts(record: WatchRecordView | undefined) {
  return {
    watchedOn: record?.watchedOn ?? null,
    rating: record?.rating ?? null,
  };
}

function parseSeasonParam(raw: string | undefined): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 1000) {
    throw new AppError('VALIDATION_FAILED', 400, 'The season must be a whole number.');
  }
  return value;
}

/** Owner-scoped lookup FIRST, so a foreign or malformed key is the same 404 as a missing one. */
async function requireRecord(
  ownerId: Parameters<typeof findTitle>[0],
  workIdentity: string,
  rawSeason: string | undefined,
) {
  const records = await listWatchRecords(ownerId, workIdentity);
  if (records.length === 0) throw new AppError('NOT_FOUND', 404, 'No such watched record.');
  const seasonNumber = parseSeasonParam(rawSeason);
  const existing = records.find((record) => record.seasonNumber === seasonNumber);
  if (existing === undefined) throw new AppError('NOT_FOUND', 404, 'No such watched record.');
  return { existing, seasonNumber };
}
export function registerWatchedRoutes(
  router: Router,
  getTmdb: () => WatchedTmdb = () => new TmdbClient({ apiKey: process.env['TMDB_API_KEY'] ?? '' }),
): void {
  router.get('/titles/:titleId/watched', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const title = await requireTitle(ownerId, req.params.titleId ?? '');
    const records = await listWatchRecords(ownerId, title.workIdentity);
    const finishedSeasons = new Set(
      records.filter((record) => record.finished).map((record) => record.seasonNumber),
    );
    const byNumber = new Map(records.map((record) => [record.seasonNumber, record]));
    const [listed, hidden] = await Promise.all([
      listListedWorkIdentities(ownerId),
      isLibraryHidden(ownerId, title.workIdentity),
    ]);
    const inLibrary = title.state === 'active' && listed.has(title.workIdentity) && !hidden;

    let seasons: ReturnType<typeof seasonProgress> | null = null;
    if (isShow(title)) {
      const list = await loadSeasons(getTmdb(), title.tmdbId);
      if (list !== null) {
        seasons = seasonProgress(list, finishedSeasons, new Date().toISOString().slice(0, 10));
      }
    }
    const whole = byNumber.get(WHOLE_TITLE_SEASON);
    res.status(200).json({
      titleId: title.id,
      workIdentity: title.workIdentity,
      mediaType: title.tmdbMediaType,
      inLibrary,
      hidden,
      perSeason: isShow(title),
      seasonsUnavailable: isShow(title) && seasons === null,
      seasons: (seasons ?? []).map((season) => ({
        ...season,
        ...recordFacts(byNumber.get(season.seasonNumber)),
      })),
      allAiredFinished: seasons === null ? false : allAiredSeasonsFinished(seasons),
      whole: whole === undefined ? null : { finished: whole.finished, ...recordFacts(whole) },
    });
  });

  router.post('/titles/:titleId/finished', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const title = await requireTitle(ownerId, req.params.titleId ?? '');
    const parsed = parseFinishedRequest(req.body);
    if (!parsed.ok) throw new AppError('VALIDATION_FAILED', 400, parsed.message);
    const { seasons, watchedOn, rating } = parsed.value;

    if (isShow(title)) {
      if (seasons.some((season) => season < 1)) {
        throw new AppError('VALIDATION_FAILED', 400, 'Choose the seasons you finished.');
      }
      const list = await loadSeasons(getTmdb(), title.tmdbId);
      if (list !== null) {
        const today = new Date().toISOString().slice(0, 10);
        const aired = new Set(
          list
            .filter((season) => season.airDate !== null && season.airDate <= today)
            .map((season) => season.seasonNumber),
        );
        const bad = seasons.filter((season) => !aired.has(season));
        if (bad.length > 0) {
          throw new AppError(
            'VALIDATION_FAILED',
            400,
            'Only seasons that have aired can be marked finished.',
            { seasons: bad },
          );
        }
      }
    } else if (seasons.length !== 1 || seasons[0] !== WHOLE_TITLE_SEASON) {
      throw new AppError('VALIDATION_FAILED', 400, 'A movie is finished as a whole.');
    }

    const snapshot = snapshotOf(title);
    const saved: WatchRecordView[] = [];
    for (const season of seasons) {
      saved.push(
        await writeWatchRecord(
          ownerId,
          title.workIdentity,
          season,
          {
            finished: true,
            ...(watchedOn === undefined ? {} : { watchedOn }),
            ...(rating === undefined ? {} : { rating }),
          },
          snapshot,
        ),
      );
    }
    res.status(200).json({ titleId: title.id, records: saved.map(toWire) });
  });

  router.patch('/watched/:workIdentity/:seasonNumber', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const workIdentity = req.params.workIdentity ?? '';
    const { existing, seasonNumber } = await requireRecord(
      ownerId,
      workIdentity,
      req.params.seasonNumber,
    );
    const parsed = parseWatchedPatch(req.body);
    if (!parsed.ok) throw new AppError('VALIDATION_FAILED', 400, parsed.message);
    const saved = await writeWatchRecord(
      ownerId,
      workIdentity,
      seasonNumber,
      parsed.value,
      existing,
    );
    res.status(200).json(toWire(saved));
  });

  router.post('/watched/:workIdentity/:seasonNumber/unfinish', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const workIdentity = req.params.workIdentity ?? '';
    const { existing, seasonNumber } = await requireRecord(
      ownerId,
      workIdentity,
      req.params.seasonNumber,
    );
    // The date and rating are kept: the owner can mark it finished again.
    const saved = await writeWatchRecord(
      ownerId,
      workIdentity,
      seasonNumber,
      { finished: false },
      existing,
    );
    res.status(200).json(toWire(saved));
  });

  router.get('/watched', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const limitRaw = Number(req.query['limit'] ?? HISTORY_PAGE);
    const cursorRaw = Number(req.query['cursor'] ?? 0);
    if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > MAX_PAGE) {
      throw new AppError('VALIDATION_FAILED', 400, `limit must be 1 to ${MAX_PAGE}.`);
    }
    if (!Number.isInteger(cursorRaw) || cursorRaw < 0) {
      throw new AppError('VALIDATION_FAILED', 400, 'cursor is not valid.');
    }
    const { items, hasMore } = await listFinishedRecords(ownerId, {
      limit: limitRaw,
      offset: cursorRaw,
    });
    const identities = [...new Set(items.map((item) => item.workIdentity))];
    const [hidden, titles] = await Promise.all([
      listHiddenIdentities(ownerId, identities),
      latestTitlesByIdentity(ownerId, identities),
    ]);
    res.status(200).json({
      items: items.map((item) => ({
        ...toWire(item),
        titleName: item.titleName ?? item.workIdentity,
        releaseYear: item.releaseYear,
        mediaType: item.mediaType,
        posterPath: item.posterPath,
        titleId: titles.get(item.workIdentity)?.titleId ?? null,
        imdbRatingTenths: titles.get(item.workIdentity)?.imdbRatingTenths ?? null,
        leftLibrary: hidden.has(item.workIdentity),
      })),
      nextCursor: hasMore ? String(cursorRaw + limitRaw) : null,
      limit: limitRaw,
    });
  });

  // One route for both directions (REQ-041 allows one route per operation).
  router.post('/titles/:titleId/library-hidden', async (req, res) => {
    const ownerId = requireOwnerId(req);
    const title = await requireTitle(ownerId, req.params.titleId ?? '');
    const body: unknown = req.body;
    const hidden =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)['hidden']
        : undefined;
    if (typeof hidden !== 'boolean') {
      throw new AppError('VALIDATION_FAILED', 400, '"hidden" must be true or false.');
    }
    const listed = await listListedWorkIdentities(ownerId, undefined, { visibleOnly: hidden });
    if (title.state !== 'active' || !listed.has(title.workIdentity)) {
      throw new AppError(
        'TITLE_NOT_ACTIVE',
        409,
        hidden
          ? "That title isn't in your library. Nothing was changed."
          : 'That title has no listing to return. Nothing was changed.',
        { titleId: title.id },
      );
    }
    await setLibraryHidden(ownerId, title.workIdentity, hidden);
    // #468 (`A67`): returning a show also ends the Waiting entry that the
    // finished-to-waiting move opened, so it is never in both places.
    if (!hidden) await satisfyWaitingIntents(ownerId, [title.workIdentity], new Date());
    res.status(200).json({ titleId: title.id, workIdentity: title.workIdentity, hidden });
  });
}
function toWire(record: WatchRecordView) {
  return {
    workIdentity: record.workIdentity,
    seasonNumber: record.seasonNumber,
    finished: record.finished,
    watchedOn: record.watchedOn,
    rating: record.rating,
  };
}
