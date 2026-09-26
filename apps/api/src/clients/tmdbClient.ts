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

import {
  isComedyPerformance,
  catalogueEdition,
  editionForText,
  mergeEditionLabels,
  normaliseTitleText,
  type EditionLabel,
  isKnownRuntime,
  pickTrailer,
  titlePresentationSchema,
  type TitlePresentation,
  type MediaType,
} from '@nextup/domain';

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
  edition?: EditionLabel;
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
  evidenceText?: string;
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
  readonly #editionCache = new Map<number, EditionLabel[]>();

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
    const evidence = options.evidenceText ?? query;
    const cacheKey = `${query.trim().toLowerCase()}\u0000${options.type ?? ''}\u0000${limit}\u0000${evidence}`;

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

    for (const item of items) {
      if (
        item.mediaType !== 'movie' ||
        normaliseTitleText(evidence) === normaliseTitleText(item.name)
      ) {
        continue;
      }
      const edition = editionForText(evidence, item.name, await this.getEditionLabels(item.tmdbId));
      if (edition !== undefined) item.edition = edition;
    }
    this.#searchCache.set(cacheKey, items);
    return items;
  }

  async getEditionLabels(tmdbId: number): Promise<EditionLabel[]> {
    const cached = this.#editionCache.get(tmdbId);
    if (cached !== undefined) return cached;
    let body: unknown;
    try {
      body = await this.#get<unknown>(`/movie/${tmdbId}/alternative_titles`, {}, () => {
        throw new TmdbWorkNotFoundError('movie', tmdbId);
      });
    } catch (error) {
      if (!(error instanceof TmdbWorkNotFoundError)) throw error;
      this.#editionCache.set(tmdbId, []);
      return [];
    }
    if (!isRecord(body) || !Array.isArray(body['titles'])) {
      throw new TmdbUnavailableError('TMDB returned unreadable alternative titles.', 200, false);
    }
    const labels = mergeEditionLabels(
      [],
      body['titles'].flatMap((row: unknown) => {
        if (!isRecord(row)) return [];
        const edition = catalogueEdition(row['title'], row['type']);
        return edition === null ? [] : [edition];
      }),
    );
    this.#editionCache.set(tmdbId, labels);
    return labels;
  }

  /**
   * `GET /3/{movie|tv}/{id}` — the metadata read (REQ-029), plus `imdb_id`
   * (REQ-094, ADR-0011 D-2a).
   *
   * ⚠ `append_to_response=external_ids` COSTS NOTHING AND IS NOT OPTIONAL.
   * Measured against the live API: `/movie/{id}` carries `imdb_id` at the top
   * level, but **`/tv/{id}` does not carry it at all** — only
   * `external_ids.imdb_id` has it for a series, and that is the *series-level*
   * id (`tt0903747` for Breaking Bad), which is the number a watch decision
   * wants. Reading `body.imdb_id` alone therefore works for films and silently
   * returns `undefined` for every series, which renders as REQ-091's "no
   * rating" state and looks like correct behaviour.
   *
   * Appending here rather than calling `/external_ids` separately keeps TMDB
   * traffic unchanged for external IDs. TV runtime fallback may read one
   * season when the series-level runtime is unknown.
   */
  async getWork(mediaType: MediaType, tmdbId: number): Promise<TmdbWorkDetail> {
    const body = await this.#get<TmdbDetailResponse>(
      `/${mediaType}/${tmdbId}`,
      { append_to_response: 'external_ids,keywords' },
      () => {
        throw new TmdbWorkNotFoundError(mediaType, tmdbId);
      },
    );

    let runtimeMinutes = readRuntime(body);
    if (mediaType === 'tv' && runtimeMinutes === null) {
      const today = new Date().toISOString().slice(0, 10);
      const seasonNumber = latestAiredSeason(body.seasons, today);
      if (seasonNumber !== null) {
        const season = await this.#get<unknown>(`/tv/${tmdbId}/season/${seasonNumber}`, {});
        if (!isRecord(season) || !Array.isArray(season['episodes'])) {
          throw new TmdbUnavailableError('TMDB returned an unreadable season body.', 200, false);
        }
        runtimeMinutes = medianEpisodeRuntime(season['episodes'], seasonNumber, today);
      }
    }

    return {
      tmdbId,
      mediaType,
      name: readName(body) ?? '',
      releaseYear: readYear(body),
      posterPath: typeof body.poster_path === 'string' ? body.poster_path : null,
      runtimeMinutes,
      genres: Array.isArray(body.genres)
        ? body.genres.map((g) => (typeof g?.name === 'string' ? g.name : '')).filter(Boolean)
        : [],
      imdbId: readImdbId(body),
      comedyShow: readComedyShow(body.keywords, mediaType),
    };
  }

  /**
   * Which providers stream this work **on subscription** in `region`
   * (REQ-086, ADR-0010).
   *
   * ⚠ **`flatrate` ONLY.** TMDB's `/watch/providers` also reports `rent`,
   * `buy`, `ads` and `free`. A work the owner can rent is precisely what they
   * are WAITING TO ESCAPE, so counting a rent offer as availability inverts
   * the entire feature — `T-AVAIL-005` is the guard, and it is a unit test
   * because the rule must not need a network to be checked.
   *
   * ⚠ **Returns `null` for "not known", `[]` for "asked, no flatrate offer".**
   * They are different facts and the caller renders them differently: `null`
   * must never become *"not streaming anywhere"* (ADR-0010 Trap 4). A missing
   * region key in the response is `[]` — TMDB answered, and its answer for
   * this region was "nobody".
   *
   * ⚠ TMDB attribution: this data is JustWatch's, and REQ-087 requires every
   * surface that renders it to say so.
   */
  async getWatchProviders(
    mediaType: MediaType,
    tmdbId: number,
    region: string,
  ): Promise<string[] | null> {
    const body = await this.#get<TmdbWatchProviderResponse>(
      `/${mediaType}/${tmdbId}/watch/providers`,
      {},
      // A work TMDB does not know has no providers to report. That is a real
      // answer ("nobody streams it"), not a failure — throwing here would make
      // one unknown work fail the whole page render.
      () => null as never,
    );
    return readFlatrateProviders(body, region);
  }

  /**
   * The same one request as `getWatchProviders`, read twice: the subscription
   * (`flatrate`) providers, and separately the storefronts that RENT or SELL
   * it (#378). ONE lookup per refresh, never two.
   *
   * ⚠ The two lists are kept APART and never merged. `flatrate` alone is
   * availability; `rentOrBuy` only lets the waiting view say "rent/buy only
   * on Apple TV" instead of a bare "not seen" (owner decision 1 on #378 —
   * free and ad-supported tiers count as neither and are not read at all).
   */
  async getWatchOffers(
    mediaType: MediaType,
    tmdbId: number,
    region: string,
  ): Promise<WatchOffers | null> {
    const body = await this.#get<TmdbWatchProviderResponse>(
      `/${mediaType}/${tmdbId}/watch/providers`,
      {},
      () => null as never,
    );
    const flatrate = readFlatrateProviders(body, region);
    if (flatrate === null) return null;
    return { flatrate, rentOrBuy: readRentOrBuyProviders(body, region) ?? [] };
  }

  /**
   * #380 — the facts a streaming estimate is made from, for a MOVIE: its
   * production companies and its US theatrical and rent/buy dates. ONE
   * request (`release_dates` appended to the detail).
   *
   * ⚠ Returns `null` when TMDB does not know the work: that is an answer
   * ("nothing to estimate from"), not a failure.
   */
  async getReleaseFacts(tmdbId: number, region: string): Promise<ReleaseFacts | null> {
    const body = await this.#get<unknown>(
      `/movie/${tmdbId}`,
      { append_to_response: 'release_dates' },
      () => null as never,
    );
    if (body === null) return null;
    return readReleaseFacts(body, region);
  }

  async getPresentation(
    mediaType: MediaType,
    tmdbId: number,
  ): Promise<Omit<TitlePresentation, 'fetchedAt'>> {
    const body = await this.#get<unknown>(
      `/${mediaType}/${tmdbId}`,
      {
        append_to_response:
          mediaType === 'movie' ? 'credits,videos,release_dates' : 'credits,videos,content_ratings',
      },
      () => {
        throw new TmdbWorkNotFoundError(mediaType, tmdbId);
      },
    );
    if (!isRecord(body) || !isRecord(body['credits'])) {
      throw new TmdbUnavailableError('TMDB returned unreadable title credits.', 200, false);
    }
    const credits = body['credits'];
    const cast = credits['cast'];
    const crew = credits['crew'];
    const creators = mediaType === 'tv' ? body['created_by'] : [];
    if (!Array.isArray(cast) || !Array.isArray(crew) || !Array.isArray(creators)) {
      throw new TmdbUnavailableError('TMDB returned unreadable title credits.', 200, false);
    }
    const projected = {
      tmdbId,
      mediaType,
      overview: body['overview'] === '' ? null : (body['overview'] ?? null),
      cast: cast.map((person: unknown) =>
        isRecord(person)
          ? { name: person['name'], character: person['character'] || null }
          : person,
      ),
      directors:
        mediaType === 'movie'
          ? crew
              .filter((person: unknown) => isRecord(person) && person['job'] === 'Director')
              .map((person: Record<string, unknown>) => person['name'])
          : [],
      creators: creators.map((person: unknown) => (isRecord(person) ? person['name'] : person)),
      // #391 — every further detail is best-effort: an unreadable one is
      // `null`, never a reason to lose the synopsis and cast above.
      ...presentationExtras(mediaType, body),
    };
    const result = titlePresentationSchema.omit({ fetchedAt: true }).safeParse(projected);
    if (!result.success) {
      throw new TmdbUnavailableError('TMDB returned unreadable title information.', 200, false);
    }
    return result.data;
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────
  async #get<T>(
    path: string,
    params: Record<string, string>,
    onNotFound?: () => never,
  ): Promise<T> {
    // ⚠ An UNCONFIGURED key is refused HERE, before any request is made.
    // TMDB cannot possibly answer without one, so sending the request costs a
    // real outbound call and two retry backoffs (5 s) to learn something
    // already known locally. It also puts a live network dependency into every
    // test that exercises a TMDB-touching route without stubbing the client,
    // which is precisely how a suite becomes flaky offline.
    //
    // `retryable: false` — no amount of retrying supplies a missing secret.
    if (this.#apiKey === '') {
      throw new TmdbUnavailableError('TMDB is not configured.', null, false);
    }

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

/** #380 — what a streaming estimate is computed from. Dates are `YYYY-MM-DD`. */
export interface ReleaseFacts {
  companyIds: number[];
  theatricalOn: string | null;
  digitalOn: string | null;
}

/** TMDB release types: 2 limited theatrical, 3 theatrical, 4 digital (rent/buy). */
const THEATRICAL_TYPES = [3, 2] as const;
const DIGITAL_TYPE = 4;

/**
 * Read {@link ReleaseFacts} from a movie detail with `release_dates` appended.
 *
 * ⚠ Theatrical prefers a wide release (type 3) and falls back to limited (2);
 * each date is the EARLIEST of its type in `region`. Anything unreadable is
 * `null` or `[]` — never a guessed date.
 */
export function readReleaseFacts(body: unknown, region: string): ReleaseFacts {
  const companyIds: number[] = [];
  if (isRecord(body) && Array.isArray(body['production_companies'])) {
    for (const company of body['production_companies']) {
      if (isRecord(company) && isPositiveInteger(company['id'])) companyIds.push(company['id']);
    }
  }

  const byType = new Map<number, string>();
  const releaseDates = isRecord(body) ? body['release_dates'] : undefined;
  const results = isRecord(releaseDates) ? releaseDates['results'] : undefined;
  if (Array.isArray(results)) {
    const forRegion = results.find(
      (entry: unknown) => isRecord(entry) && entry['iso_3166_1'] === region,
    );
    const dates = isRecord(forRegion) ? forRegion['release_dates'] : undefined;
    if (Array.isArray(dates)) {
      for (const entry of dates) {
        if (!isRecord(entry)) continue;
        const type = entry['type'];
        const date = entry['release_date'];
        if (typeof type !== 'number' || typeof date !== 'string') continue;
        const day = date.slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const existing = byType.get(type);
        if (existing === undefined || day < existing) byType.set(type, day);
      }
    }
  }

  const theatricalType = THEATRICAL_TYPES.find((type) => byType.has(type));
  return {
    companyIds,
    theatricalOn: theatricalType === undefined ? null : (byType.get(theatricalType) ?? null),
    digitalOn: byType.get(DIGITAL_TYPE) ?? null,
  };
}

/** The metadata allow-list of US-007 AC-2/AC-6. Storage validation is TASK-061. */
export interface TmdbWorkDetail {
  comedyShow?: boolean | null;
  tmdbId: number;
  mediaType: MediaType;
  name: string;
  releaseYear: number | null;
  posterPath: string | null;
  runtimeMinutes: number | null;
  genres: string[];
  /**
   * The IMDb id, or `null` (REQ-094). The key OMDb is queried with — and the
   * ONLY way a rating is ever looked up (ADR-0011 D-2).
   */
  imdbId: string | null;
}

// ── Wire shapes (only what is read; everything else is ignored) ─────────────

interface TmdbSearchResponse {
  results?: unknown;
}

interface TmdbDetailResponse {
  keywords?: unknown;
  title?: unknown;
  name?: unknown;
  release_date?: unknown;
  first_air_date?: unknown;
  poster_path?: unknown;
  runtime?: unknown;
  episode_run_time?: unknown;
  seasons?: unknown;
  genres?: Array<{ name?: unknown }>;
  /** Present for a film. **Absent for a series** — see `readImdbId`. */
  imdb_id?: unknown;
  /** Present for both, once `append_to_response=external_ids` is sent. */
  external_ids?: { imdb_id?: unknown };
}

export function readComedyShow(value: unknown, mediaType: MediaType): boolean | null {
  if (!isRecord(value)) return null;
  const rows = value[mediaType === 'movie' ? 'keywords' : 'results'];
  if (!Array.isArray(rows)) return null;
  const names: string[] = [];
  for (const row of rows) {
    if (!isRecord(row) || typeof row['name'] !== 'string') return null;
    names.push(row['name']);
  }
  return isComedyPerformance(names);
}

/**
 * `/{media}/{id}/watch/providers`, as much of it as we read.
 *
 * ⚠ `ads` and `free` exist in the payload and are deliberately absent from
 * this type (owner decision 1 on #378: they are not streaming). `rent` and
 * `buy` are declared since #378 for `readRentOrBuyProviders` ONLY; the
 * flatrate rule never reads them, and `T-AVAIL-005a` fails if it starts to.
 */
export interface TmdbWatchProviderResponse {
  results?: Record<
    string,
    | {
        flatrate?: Array<{ provider_name?: unknown }>;
        // #378: read ONLY by `readRentOrBuyProviders`, never by the flatrate rule.
        rent?: Array<{ provider_name?: unknown }>;
        buy?: Array<{ provider_name?: unknown }>;
      }
    | undefined
  >;
}

/** Both halves of one `/watch/providers` answer, kept apart (#378). */
export interface WatchOffers {
  /** Subscription providers — the only availability there is. */
  flatrate: string[];
  /** Storefronts that rent or sell it. ⚠ Never availability. */
  rentOrBuy: string[];
}

/**
 * The **flatrate-only** rule, as a pure function (`T-AVAIL-005`, REQ-086).
 *
 * ⚠ **INVERTING THIS INVERTS THE FEATURE.** TMDB's `/watch/providers` payload
 * also carries `rent`, `buy`, `ads` and `free`. A work the owner can RENT is
 * precisely what they recorded an intent to escape (US-042 AC-5), so a
 * rent-only or buy-only offer must leave the intent waiting and unflagged.
 *
 * It lives out here, separate from the HTTP call, so the rule is a unit test
 * against a literal payload rather than something that needs a recording and
 * a network stack to check. It reads `flatrate` and nothing else; the rent
 * and buy offers have their own reader, `readRentOrBuyProviders`.
 *
 * ⚠ **`null` ≠ `[]`.** `null` is NOT KNOWN — TMDB gave us nothing usable. `[]`
 * is the different, weaker fact that TMDB answered and no subscription
 * provider carries it in this region, including the case of a region key that
 * is simply absent from the response. The caller renders them differently and
 * must be able to (ADR-0010 Trap 4).
 */
export function readFlatrateProviders(
  body: TmdbWatchProviderResponse | null,
  region: string,
): string[] | null {
  if (body === null || typeof body !== 'object') return null;

  const forRegion = body.results?.[region];
  if (forRegion === undefined) return [];

  const flatrate = forRegion.flatrate;
  if (!Array.isArray(flatrate)) return [];

  return flatrate
    .map((entry) => (typeof entry?.provider_name === 'string' ? entry.provider_name : ''))
    .filter((name) => name.length > 0);
}

/**
 * The storefronts that RENT or SELL a work in `region`, deduplicated, rent
 * first (#378). A separate function from `readFlatrateProviders` on purpose:
 * that rule must stay blind to `rent` and `buy`, and sharing a body would put
 * both keys one edit away from the availability answer.
 *
 * `null` = not known, `[]` = TMDB answered and nobody rents or sells it.
 */
export function readRentOrBuyProviders(
  body: TmdbWatchProviderResponse | null,
  region: string,
): string[] | null {
  if (body === null || typeof body !== 'object') return null;

  const forRegion = body.results?.[region];
  if (forRegion === undefined) return [];

  const names: string[] = [];
  for (const offers of [forRegion.rent, forRegion.buy]) {
    if (!Array.isArray(offers)) continue;
    for (const entry of offers) {
      const name = typeof entry?.provider_name === 'string' ? entry.provider_name : '';
      if (name.length > 0 && !names.includes(name)) names.push(name);
    }
  }
  return names;
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

/**
 * The runtime in minutes, or `null` when TMDB has none.
 *
 * ⚠ **A `0` FROM TMDB IS `null`, NOT A RUNTIME.** TMDB returns `runtime: 0`
 * for works it holds no runtime for, so without this the column stores a zero
 * that every reader then has to remember to special-case: it would display as
 * "Runtime unknown" (`isKnownRuntime`), satisfy no bucket, be counted among
 * the hidden unknowns — and still sort to the top of "Shortest first", because
 * `ORDER BY` has no `where` to filter it. Normalising at the boundary is the
 * only place that fixes all four at once.
 *
 * Series carry a list of per-episode runtimes; the first is the usual one, and
 * the `/ep` suffix on the row is what keeps that honest.
 */
function readRuntime(body: TmdbDetailResponse): number | null {
  const raw =
    typeof body.runtime === 'number'
      ? body.runtime
      : Array.isArray(body.episode_run_time) && typeof body.episode_run_time[0] === 'number'
        ? body.episode_run_time[0]
        : null;

  return isKnownRuntime(raw) ? raw : null;
}

/** #391 — the US rating region for `certification`, as for release facts. */
const CERTIFICATION_REGION = 'US';

const WRITER_JOBS = new Set(['Screenplay', 'Writer', 'Story', 'Novel', 'Author']);

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
const day = (value: unknown): string | null =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;

function usCertification(mediaType: MediaType, body: Record<string, unknown>): string | null {
  const block = body[mediaType === 'movie' ? 'release_dates' : 'content_ratings'];
  const results = isRecord(block) ? block['results'] : null;
  if (!Array.isArray(results)) return null;
  const us = results.find(
    (entry: unknown) => isRecord(entry) && entry['iso_3166_1'] === CERTIFICATION_REGION,
  );
  if (!isRecord(us)) return null;
  if (mediaType === 'tv') return text(us['rating']);
  const dates = us['release_dates'];
  if (!Array.isArray(dates)) return null;
  // Theatrical (3) first, then any release that carries a rating.
  const rated = dates.filter((entry: unknown) => isRecord(entry) && text(entry['certification']));
  const theatrical = rated.find((entry: Record<string, unknown>) => entry['type'] === 3);
  return text((theatrical ?? rated[0])?.['certification']);
}

/**
 * #391 — the display-only details beyond synopsis and credits. Each is
 * best-effort and independently `null`: a malformed field loses that field,
 * never the page.
 */
function presentationExtras(
  mediaType: MediaType,
  body: Record<string, unknown>,
): Pick<
  TitlePresentation,
  | 'tagline'
  | 'writers'
  | 'releaseDate'
  | 'status'
  | 'certification'
  | 'seasons'
  | 'episodes'
  | 'trailer'
> {
  const credits = isRecord(body['credits']) ? body['credits'] : {};
  const crew = Array.isArray(credits['crew']) ? credits['crew'] : [];
  const writers =
    mediaType === 'movie'
      ? [
          ...new Set(
            crew.flatMap((person: unknown) =>
              isRecord(person) &&
              typeof person['job'] === 'string' &&
              WRITER_JOBS.has(person['job']) &&
              text(person['name']) !== null
                ? [text(person['name']) as string]
                : [],
            ),
          ),
        ]
      : [];
  const videos = isRecord(body['videos']) ? body['videos']['results'] : null;
  return {
    tagline: text(body['tagline']),
    writers,
    releaseDate: day(mediaType === 'movie' ? body['release_date'] : body['first_air_date']),
    status: text(body['status']),
    certification: usCertification(mediaType, body),
    seasons: mediaType === 'tv' ? count(body['number_of_seasons']) : null,
    episodes: mediaType === 'tv' ? count(body['number_of_episodes']) : null,
    trailer: pickTrailer(videos),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function hasAired(date: unknown, today: string): boolean {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function latestAiredSeason(seasons: unknown, today: string): number | null {
  if (!Array.isArray(seasons)) return null;
  let latest: number | null = null;
  for (const season of seasons) {
    if (!isRecord(season)) continue;
    const number = season['season_number'];
    if (isPositiveInteger(number) && hasAired(season['air_date'], today)) {
      latest = Math.max(latest ?? number, number);
    }
  }
  return latest;
}

function medianEpisodeRuntime(
  episodes: readonly unknown[],
  season: number,
  today: string,
): number | null {
  const runtimes: number[] = [];
  for (const episode of episodes) {
    if (
      !isRecord(episode) ||
      episode['season_number'] !== season ||
      !isPositiveInteger(episode['episode_number']) ||
      !hasAired(episode['air_date'], today)
    )
      continue;
    const runtime = episode['runtime'];
    if (isPositiveInteger(runtime)) runtimes.push(runtime);
  }
  runtimes.sort((a, b) => a - b);
  const middle = Math.floor(runtimes.length / 2);
  const upper = runtimes[middle];
  if (upper === undefined) return null;
  const lower = runtimes.length % 2 === 0 ? runtimes[middle - 1] : upper;
  return lower === undefined ? null : Math.round(lower / 2 + upper / 2);
}

/**
 * The IMDb id (REQ-094), from `external_ids` first and the top level second.
 *
 * ⚠ THE ORDER MATTERS AND IS NOT ARBITRARY. Measured against the live API:
 * `/movie/{id}` carries `imdb_id` at the top level *and* (when appended) under
 * `external_ids`; `/tv/{id}` carries it **only** under `external_ids`. Reading
 * `external_ids` first is therefore the one branch that works for both media
 * types, and the top-level read is a fallback for the case where
 * `append_to_response` was somehow dropped from the request.
 *
 * Returns `null` for anything that is not a well-formed `tt…` id, so a
 * malformed value can never be interpolated into an OMDb URL.
 */
function readImdbId(body: TmdbDetailResponse): string | null {
  for (const candidate of [body.external_ids?.imdb_id, body.imdb_id]) {
    // TMDB returns `''` or `null` for a work it has no IMDb mapping for.
    if (typeof candidate === 'string' && /^tt\d{7,}$/.test(candidate)) return candidate;
  }
  return null;
}
