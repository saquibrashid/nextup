/**
 * `GET /api/tmdb/search` — `specs/api.md` §6.29. TASK-045, US-007 / US-009 /
 * US-030.
 *
 * The browser never talks to TMDB. It talks to this route, which holds the key
 * server-side (`specs/security.md` §6, `T-SEC-027` asserts no web bundle
 * contains `api.themoviedb.org` or key material).
 *
 * ⚠ REGISTRATION. This router is mounted by `apps/api/src/routes/index.ts`,
 * which is coordinator-owned, because the middleware chain it establishes
 * (`requirePrincipal → requireAllowList → attachOwnerScope → routes →
 * errorEnvelope`) is what makes every route refuse an unauthenticated caller.
 * A route mounted anywhere else answers WITHOUT AUTHENTICATION — `T-SEC-029`
 * exists precisely because that mistake was made once already. Nothing here
 * may mount itself on the app.
 */

import type { Router } from 'express';

import { type MediaType, MEDIA_TYPES } from '@nextup/domain';

import {
  type TmdbClient,
  type TmdbSearchItem,
  TMDB_QUERY_MAX_LENGTH,
  TMDB_SEARCH_LIMIT_DEFAULT,
  TMDB_SEARCH_LIMIT_MAX,
  TmdbUnavailableError,
} from '../clients/tmdbClient.js';
import { AppError } from '../errors/AppError.js';

/** `specs/api.md` §6.29 — the owner-facing sentence, verbatim. */
export const TMDB_UNAVAILABLE_MESSAGE = "Couldn't reach TMDB. Try again in a moment.";

/**
 * The ONE place a `TmdbUnavailableError` becomes the closed `TMDB_UNAVAILABLE`
 * envelope status. Returns `null` for anything else, so a caller threads it
 * straight into a `catch` without swallowing unrelated failures:
 *
 *   const mapped = tmdbUnavailableAppError(error);
 *   if (mapped) throw mapped;
 *   throw error;
 *
 * ⚠ SHARED ON PURPOSE. Every route that reaches TMDB — search, manual entry,
 * fix-match and the review-candidate PATCH — needs this exact mapping, and
 * this task exists because two independently-written copies disagreed once:
 * search mapped a 503 to 502 `TMDB_UNAVAILABLE`, the PATCH route let the same
 * error fall through to a generic 500. One function is one place to get it
 * right. The upstream error's own text is deliberately dropped — a fetch
 * failure message can carry the request URL, and the TMDB URL carries the API
 * key.
 */
export function tmdbUnavailableAppError(error: unknown): AppError | null {
  return error instanceof TmdbUnavailableError
    ? new AppError('TMDB_UNAVAILABLE', 502, TMDB_UNAVAILABLE_MESSAGE)
    : null;
}

export interface TmdbSearchQuery {
  q: string;
  type?: MediaType;
  limit: number;
}

/**
 * Parses and validates the query string.
 *
 * Exported so `T-TMDB-001` can drive every boundary directly. Validation is
 * strict on purpose: a silently-clamped `limit` or a silently-ignored `type`
 * would make the endpoint answer a question the caller did not ask.
 */
export function parseTmdbSearchQuery(raw: Record<string, unknown>): TmdbSearchQuery {
  const q = raw['q'];
  if (typeof q !== 'string' || q.trim() === '') {
    throw new AppError('VALIDATION_FAILED', 400, 'A search term is required.', { field: 'q' });
  }
  if (q.length > TMDB_QUERY_MAX_LENGTH) {
    throw new AppError(
      'VALIDATION_FAILED',
      400,
      `A search term may be at most ${TMDB_QUERY_MAX_LENGTH} characters.`,
      { field: 'q' },
    );
  }

  const rawType = raw['type'];
  let type: MediaType | undefined;
  if (rawType !== undefined && rawType !== '') {
    if (typeof rawType !== 'string' || !(MEDIA_TYPES as readonly string[]).includes(rawType)) {
      throw new AppError('VALIDATION_FAILED', 400, 'Type must be "movie" or "tv".', {
        field: 'type',
      });
    }
    type = rawType as MediaType;
  }

  const rawLimit = raw['limit'];
  let limit = TMDB_SEARCH_LIMIT_DEFAULT;
  if (rawLimit !== undefined && rawLimit !== '') {
    const parsed = typeof rawLimit === 'string' ? Number(rawLimit) : NaN;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > TMDB_SEARCH_LIMIT_MAX) {
      throw new AppError(
        'VALIDATION_FAILED',
        400,
        `Limit must be a whole number between 1 and ${TMDB_SEARCH_LIMIT_MAX}.`,
        { field: 'limit' },
      );
    }
    limit = parsed;
  }

  return type === undefined ? { q, limit } : { q, type, limit };
}

/**
 * Runs the search and maps an unreachable TMDB onto the closed error code.
 *
 * ⚠ The upstream error's own text never reaches the owner: a fetch failure
 * message can contain the request URL, and the TMDB URL carries the API key.
 */
export async function searchTmdb(
  client: TmdbClient,
  query: TmdbSearchQuery,
): Promise<TmdbSearchItem[]> {
  try {
    return await client.searchMulti(
      query.q,
      query.type === undefined ? { limit: query.limit } : { type: query.type, limit: query.limit },
    );
  } catch (error) {
    const mapped = tmdbUnavailableAppError(error);
    if (mapped) throw mapped;
    throw error;
  }
}

/**
 * @param getClient built per request so the client's in-process search cache
 *   has a bounded lifetime and never becomes a mirror of the TMDB catalogue,
 *   which US-007 AC-6 forbids.
 */
export function registerTmdbRoutes(router: Router, getClient: () => TmdbClient): void {
  router.get('/tmdb/search', (req, res, next) => {
    void (async () => {
      try {
        const query = parseTmdbSearchQuery(req.query as Record<string, unknown>);
        res.json({ items: await searchTmdb(getClient(), query) });
      } catch (error) {
        // Every failure goes to `errorEnvelope`, which is the ONE place an
        // error becomes a body. A handler that answered here itself would skip
        // the redaction and the correlation id.
        next(error);
      }
    })();
  });
}
