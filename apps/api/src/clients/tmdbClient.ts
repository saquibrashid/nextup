/**
 * The TMDB client — `specs/ai.md` §4.1, `specs/api.md` §6.29. TASK-045,
 * `T-TMDB-001` / `T-TMDB-002`.
 *
 * ⚠ THE ONLY FILE THAT MAY HOLD `TMDB_API_KEY`. The key is a Container Apps
 * secret; it is never logged, never returned to the browser, and never sent to
 * any AI service. The web app reaches TMDB only through `GET /api/tmdb/search`
 * (`specs/security.md` §6, `T-SEC-027`).
 *
 * ⚠ RULE A (`specs/ai.md` §0). Nothing returned by this client may enter an
 * inference request. TMDB content flows to the deterministic matcher and to
 * storage — never to Azure OpenAI or Azure AI Vision. `T-AI-012` / `T-AI-013`
 * enforce that structurally.
 *
 * ⚠ TMDB unavailability is a FIRST-CLASS STATE, not an exception to swallow.
 * It surfaces as `TmdbUnavailableError` → `TMDB_UNAVAILABLE`, so the product
 * degrades visibly (US-007 AC-5: candidates are marked unmatched, the batch
 * does NOT fail, and the owner is told matching was incomplete). Returning an
 * empty result set on a network failure would be indistinguishable from "TMDB
 * has never heard of this title" — which is exactly how metadata gets lost
 * silently.
 *
 * PATH NOTE. `specs/security.md` §7 names `apps/api/src/matching/tmdbClient.ts`;
 * `docs/backlog.md` TASK-045 names `apps/api/src/clients/tmdbClient.ts`. The
 * backlog is the work order, so the file is here.
 */

import type { MediaType } from '@nextup/domain';

export const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

/** `specs/api.md` §6.29. */
export const TMDB_SEARCH_LIMIT_DEFAULT = 10;
export const TMDB_SEARCH_LIMIT_MAX = 20;
export const TMDB_QUERY_MAX_LENGTH = 100;

/** `specs/ai.md` §4.1 — at most 4 concurrent, minimum 30 ms spacing. */
export const TMDB_MAX_CONCURRENCY = 4;
export const TMDB_MIN_SPACING_MS = 30;
/** Two retries, 1 s then 4 s, on 429/5xx and network errors ONLY. */
export const TMDB_RETRY_BACKOFF_MS: readonly number[] = [1_000, 4_000];
export const TMDB_TIMEOUT_MS = 10_000;

/**
 * The §4.1 rate-limit gate, deliberately at MODULE scope rather than on the
 * class.
 *
 * The limit it enforces is a property of the shared resource — TMDB's API, one
 * per process — not of any one caller. `registerTmdbRoutes` builds a client per
 * request, so per-instance state would let every concurrent request start
 * believing it was the only caller and the 4-concurrent / 30 ms cap would hold
 * only WITHIN a request, never across them. That fails silently: each request
 * looks individually well-behaved while the process as a whole exceeds the cap.
 *
 * `#searchCache` stays per-instance for the opposite reason: it is a property
 * of the caller, and a cache that dies with the batch is exactly what US-007
 * AC-6 requires. The two lifetimes are independent; they only looked like a
 * trade-off while they shared an object.
 */
const gate = {
  inFlight: 0,
  waiting: [] as Array<() => void>,
  lastStartedAt: 0,
};

/**
 * Resets the shared gate. Test-only seam: module state outlives a single test,
 * so a suite that leaves the gate saturated would hang the next one.
 */
export function resetTmdbRateLimiterForTests(): void {
  gate.inFlight = 0;
  gate.waiting = [];
  gate.lastStartedAt = 0;
}

/** One search hit, already narrowed to the fields nextup is allowed to keep. */
export interface TmdbSearchItem {
  tmdbId: number;
  mediaType: MediaType;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
}

/**
 * TMDB could not be reached, or refused, after retries.
 *
 * `retryable` distinguishes "try again in a moment" (429/5xx/network) from a
 * response we will never be able to use (a 401 from a bad key). Both are
 * `TMDB_UNAVAILABLE` to the owner — there is nothing they can do differently —
 * but the log line must tell an operator which one it was.
 */
export class TmdbUnavailableError extends Error {
  readonly httpStatus: number | null;
  readonly retryable: boolean;

  constructor(message: string, httpStatus: number | null, retryable: boolean) {
    super(message);
    this.name = 'TmdbUnavailableError';
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

/** TMDB answered, and has no such work. Distinct from unavailability. */
export class TmdbWorkNotFoundError extends Error {
  constructor(mediaType: MediaType, tmdbId: number) {
    super(`TMDB has no ${mediaType} with id ${tmdbId}.`);
    this.name = 'TmdbWorkNotFoundError';
  }
}

export type FetchLike = typeof globalThis.fetch;

export interface TmdbClientOptions {
  apiKey: string;
  /** Injected so the whole suite runs offline against recorded bodies. */
  fetch?: FetchLike;
  baseUrl?: string;
  /** Injected so retry backoff does not add five seconds to every test. */
  sleep?: (ms: number) => Promise<void>;
}

export interface TmdbSearchOptions {
  type?: MediaType;
  limit?: number;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class TmdbClient {
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #baseUrl: string;
  readonly #sleep: (ms: number) => Promise<void>;

  /**
   * In-process, per-client search cache (`specs/ai.md` §4.1): one client is
   * built per batch, so repeated candidates cost one call and the cache dies
   * with the batch. It is NOT a mirror of the TMDB catalogue — US-007 AC-6
   * forbids that — and nothing here is persisted.
   */
  readonly #searchCache = new Map<string, TmdbSearchItem[]>();

  constructor(options: TmdbClientOptions) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#baseUrl = options.baseUrl ?? TMDB_BASE_URL;
    this.#sleep = options.sleep ?? realSleep;
  }

  /**
   * `GET /3/search/multi` (`specs/ai.md` §4.1).
   *
   * `include_adult=false` is always sent and is not configurable.
   *
   * `media_type: 'person'` results are dropped: a person is not a work, has no
   * `MediaType`, and would otherwise be scored against a title by the matcher.
   */
  async searchMulti(query: string, options: TmdbSearchOptions = {}): Promise<TmdbSearchItem[]> {
    const limit = options.limit ?? TMDB_SEARCH_LIMIT_DEFAULT;
    const cacheKey = `${query.trim().toLowerCase()}\u0000${options.type ?? ''}\u0000${limit}`;

    const cached = this.#searchCache.get(cacheKey);
    if (cached) return cached;

    const body = await this.#get<TmdbSearchResponse>('/search/multi', {
      query,
      include_adult: 'false',
    });

    const items = (Array.isArray(body.results) ? body.results : [])
      .map(toSearchItem)
      .filter((item): item is TmdbSearchItem => item !== null)
      .filter((item) => options.type === undefined || item.mediaType === options.type)
      .slice(0, limit);

    this.#searchCache.set(cacheKey, items);
    return items;
  }

  /** `GET /3/{movie|tv}/{id}` — the metadata read (REQ-029). */
  async getWork(mediaType: MediaType, tmdbId: number): Promise<TmdbWorkDetail> {
    const body = await this.#get<TmdbDetailResponse>(`/${mediaType}/${tmdbId}`, {}, () => {
      throw new TmdbWorkNotFoundError(mediaType, tmdbId);
    });

    return {
      tmdbId,
      mediaType,
      name: readName(body) ?? '',
      releaseYear: readYear(body),
      posterPath: typeof body.poster_path === 'string' ? body.poster_path : null,
      runtimeMinutes: readRuntime(body),
      genres: Array.isArray(body.genres)
        ? body.genres.map((g) => (typeof g?.name === 'string' ? g.name : '')).filter(Boolean)
        : [],
    };
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  async #get<T>(
    path: string,
    params: Record<string, string>,
    onNotFound?: () => never,
  ): Promise<T> {
    const url = new URL(`${this.#baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    // The key is a query parameter because that is TMDB's v3 scheme. It is
    // therefore INSIDE the URL: no code path may log a TMDB URL, and none does
    // — every message below names the path, never `url.href`.
    url.searchParams.set('api_key', this.#apiKey);

    let lastError: TmdbUnavailableError | null = null;

    for (let attempt = 0; attempt <= TMDB_RETRY_BACKOFF_MS.length; attempt += 1) {
      if (attempt > 0) {
        await this.#sleep(TMDB_RETRY_BACKOFF_MS[attempt - 1] ?? 0);
      }

      const response = await this.#rateLimited(() => this.#fetchOnce(url));

      if (response instanceof TmdbUnavailableError) {
        lastError = response;
        if (!response.retryable) throw response;
        continue;
      }

      if (response.status === 404 && onNotFound) onNotFound();

      if (response.status === 429 || response.status >= 500) {
        lastError = new TmdbUnavailableError(
          `TMDB returned ${response.status} for ${path}.`,
          response.status,
          true,
        );
        continue;
      }

      if (!response.ok) {
        // 401/403/404 without a handler: retrying cannot change the answer.
        throw new TmdbUnavailableError(
          `TMDB returned ${response.status} for ${path}.`,
          response.status,
          false,
        );
      }

      try {
        return (await response.json()) as T;
      } catch {
        // A 200 we cannot parse is not a result. Treating it as an empty one
        // would look exactly like "TMDB knows nothing about this title".
        throw new TmdbUnavailableError(`TMDB returned an unreadable body for ${path}.`, 200, false);
      }
    }

    throw (
      lastError ?? new TmdbUnavailableError(`TMDB could not be reached for ${path}.`, null, true)
    );
  }

  /** @returns the response, or the error to consider retrying. Never throws. */
  async #fetchOnce(url: URL): Promise<Response | TmdbUnavailableError> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, TMDB_TIMEOUT_MS);
    try {
      return await this.#fetch(url, { signal: controller.signal });
    } catch {
      // Deliberately does not include the caught error's text: a fetch failure
      // message can contain the request URL, which carries the API key.
      return new TmdbUnavailableError('TMDB request failed at the network layer.', null, true);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * At most `TMDB_MAX_CONCURRENCY` in flight, and ≥ `TMDB_MIN_SPACING_MS`
   * apart — enforced against the module-scoped `gate`, so the cap holds across
   * every client in this process, not merely within one instance.
   */
  async #rateLimited<T>(run: () => Promise<T>): Promise<T> {
    if (gate.inFlight >= TMDB_MAX_CONCURRENCY) {
      await new Promise<void>((resolve) => gate.waiting.push(resolve));
    }
    gate.inFlight += 1;

    try {
      const since = Date.now() - gate.lastStartedAt;
      if (since < TMDB_MIN_SPACING_MS) await this.#sleep(TMDB_MIN_SPACING_MS - since);
      gate.lastStartedAt = Date.now();
      return await run();
    } finally {
      gate.inFlight -= 1;
      gate.waiting.shift()?.();
    }
  }
}

/** The metadata allow-list of US-007 AC-2/AC-6. Storage validation is TASK-061. */
export interface TmdbWorkDetail {
  tmdbId: number;
  mediaType: MediaType;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
  runtimeMinutes: number | null;
  genres: string[];
}

// ── Wire shapes (only what is read; everything else is ignored) ─────────────

interface TmdbSearchResponse {
  results?: unknown;
}

interface TmdbDetailResponse {
  title?: unknown;
  name?: unknown;
  release_date?: unknown;
  first_air_date?: unknown;
  poster_path?: unknown;
  runtime?: unknown;
  episode_run_time?: unknown;
  genres?: Array<{ name?: unknown }>;
}

function toSearchItem(raw: unknown): TmdbSearchItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const row = raw as Record<string, unknown>;

  const mediaType = row['media_type'];
  if (mediaType !== 'movie' && mediaType !== 'tv') return null;

  const tmdbId = row['id'];
  if (typeof tmdbId !== 'number' || !Number.isInteger(tmdbId)) return null;

  const name = readName(row);
  if (name === null || name === '') return null;

  return {
    tmdbId,
    mediaType,
    name,
    releaseYear: readYear(row),
    posterPath: typeof row['poster_path'] === 'string' ? row['poster_path'] : null,
  };
}

/** `title` for a film, `name` for a series — TMDB uses different keys. */
function readName(row: Record<string, unknown> | TmdbDetailResponse): string | null {
  const record = row as Record<string, unknown>;
  if (typeof record['title'] === 'string') return record['title'];
  if (typeof record['name'] === 'string') return record['name'];
  return null;
}

function readYear(row: Record<string, unknown> | TmdbDetailResponse): number | null {
  const record = row as Record<string, unknown>;
  const date = record['release_date'] ?? record['first_air_date'];
  if (typeof date !== 'string' || date.length < 4) return null;
  const year = Number.parseInt(date.slice(0, 4), 10);
  // TMDB returns '' for an unknown date, which parses to NaN.
  return Number.isInteger(year) ? year : null;
}

function readRuntime(body: TmdbDetailResponse): number | null {
  if (typeof body.runtime === 'number') return body.runtime;
  // Series carry a list of per-episode runtimes; the first is the usual one.
  if (Array.isArray(body.episode_run_time) && typeof body.episode_run_time[0] === 'number') {
    return body.episode_run_time[0];
  }
  return null;
}
