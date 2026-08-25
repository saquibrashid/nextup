/**
 * `GET /api/imdb/lookup` — look up any title's IMDb rating without adding it
 * to anything (REQ-092, US-045).
 *
 * ⚠ **THIS ROUTE WRITES NOTHING. THAT IS ITS DEFINING PROPERTY** (US-045
 * AC-2). It creates no `Title`, no `ServiceListing`, no `WatchIntent`, no
 * `Suppression`, and it does not cache the rating it just fetched onto a row
 * even when the work IS on the owner's list — a lookup is a question, and
 * answering a question must not mutate the thing asked about. `T-IMDB-006e`
 * asserts the module imports no repository writer at all, because "I checked
 * and it doesn't write" is a property that decays silently.
 *
 * The resolution chain is fixed by ADR-0011 D-2 and is not negotiable:
 *
 *     TMDB search  →  imdb_id  →  OMDb ?i=
 *
 * There is **no title-text fallback**. If TMDB has no `imdb_id` for the work,
 * the answer is REQ-091's no-rating state — never a `?t=` query, which would
 * return a confidently wrong rating for a same-named film (US-046 AC-1/AC-3).
 *
 * ⚠ REGISTRATION. Mounted by `apps/api/src/routes/index.ts` like every other
 * router here. A route mounted anywhere else answers WITHOUT AUTHENTICATION.
 */

import { type Router } from 'express';

import { workIdentityForTmdb } from '@nextup/domain';

import { type OmdbClient } from '../clients/omdbClient.js';
import { type TmdbClient, TmdbUnavailableError } from '../clients/tmdbClient.js';
import { AppError } from '../errors/AppError.js';
import { requireOwnerId } from '../middleware/requestContext.js';
import { findTitleByWorkIdentity } from '../repository/ownerData.js';
import { parseTmdbSearchQuery, TMDB_UNAVAILABLE_MESSAGE } from './tmdb.js';

export interface ImdbLookupResult {
  tmdbId: number;
  mediaType: string;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
  imdbId: string | null;
  /** 1.0–10.0, or `null` for REQ-091's no-rating state. Never `0`. */
  imdbRating: number | null;
  voteCount: number | null;
  /** US-045 AC-4 — the work is already on the owner's list. */
  inList: boolean;
  /** The row's id when `inList`, so the SPA can link to it. */
  titleId: string | null;
}

/**
 * Resolve the best TMDB match for `query` and attach its IMDb rating.
 *
 * Returns `null` for "TMDB matched nothing" — which the route reports plainly
 * as not-found (US-045 AC-3). ⚠ It must NOT be represented as a found work
 * with no rating: those are different answers and conflating them tells the
 * owner a film exists when it does not.
 */
export async function lookupImdbRating(
  clients: { tmdb: TmdbClient; omdb: Pick<OmdbClient, 'getRating'> },
  query: { q: string; type?: 'movie' | 'tv' },
  lookupInList: (workIdentity: string) => Promise<{ id: string } | null>,
): Promise<ImdbLookupResult | null> {
  let matches;
  try {
    matches = await clients.tmdb.searchMulti(
      query.q,
      query.type === undefined ? { limit: 1 } : { type: query.type, limit: 1 },
    );
  } catch (error) {
    // The upstream text never reaches the owner: a fetch failure message can
    // carry the request URL, and the TMDB URL carries the API key.
    if (error instanceof TmdbUnavailableError) {
      throw new AppError('TMDB_UNAVAILABLE', 502, TMDB_UNAVAILABLE_MESSAGE);
    }
    throw error;
  }

  const top = matches[0];
  if (top === undefined) return null;

  // One extra TMDB call, and only one: `getWork` already appends
  // `external_ids`, which is where a SERIES' `imdb_id` lives (ADR-0011 D-2a).
  // Search results carry no IMDb id at all, so this hop is unavoidable.
  const detail = await clients.tmdb.getWork(top.mediaType, top.tmdbId);

  // ⚠ OMDb is only asked when there IS an id. `getRating` would return the
  // absent state for a bad id anyway, but spending a request from a 1,000/day
  // budget to be told nothing is waste (REQ-093).
  const rating = detail.imdbId === null ? null : await clients.omdb.getRating(detail.imdbId);

  const existing = await lookupInList(workIdentityForTmdb(top.mediaType, top.tmdbId));

  return {
    tmdbId: top.tmdbId,
    mediaType: top.mediaType,
    name: detail.name === '' ? top.name : detail.name,
    releaseYear: detail.releaseYear ?? top.releaseYear,
    posterPath: detail.posterPath ?? top.posterPath,
    imdbId: detail.imdbId,
    imdbRating: rating?.rating ?? null,
    voteCount: rating?.voteCount ?? null,
    inList: existing !== null,
    titleId: existing?.id ?? null,
  };
}

/** `specs/api.md` — the owner-facing sentence for a query TMDB knows nothing of. */
export const IMDB_LOOKUP_NOT_FOUND_MESSAGE = "Couldn't find that title.";

export function registerImdbRoutes(
  router: Router,
  getClients: () => { tmdb: TmdbClient; omdb: Pick<OmdbClient, 'getRating'> },
): void {
  router.get('/imdb/lookup', (req, res, next) => {
    void (async () => {
      try {
        const ownerId = requireOwnerId(req);
        // Reuses §6.29's parser so `q`/`type` validate identically on both
        // routes; `limit` is parsed and ignored — this route answers with the
        // single best match by design, not with a page.
        const query = parseTmdbSearchQuery(req.query as Record<string, unknown>);

        const result = await lookupImdbRating(
          getClients(),
          query.type === undefined ? { q: query.q } : { q: query.q, type: query.type },
          async (workIdentity) => findTitleByWorkIdentity(ownerId, workIdentity),
        );

        if (result === null) {
          throw new AppError('NOT_FOUND', 404, IMDB_LOOKUP_NOT_FOUND_MESSAGE);
        }
        res.status(200).json(result);
      } catch (error) {
        next(error);
      }
    })();
  });
}
