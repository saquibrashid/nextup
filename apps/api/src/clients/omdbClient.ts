/**
 * The OMDb client — ADR-0011, REQ-089/REQ-091/REQ-093. Epic M.
 *
 * ⚠ THE ONLY FILE THAT MAY HOLD `OMDB_API_KEY`, exactly as `tmdbClient.ts` is
 * the only file that may hold `TMDB_API_KEY`. The key is a Container Apps
 * secret; it is never logged, never returned to the browser, and never sent to
 * any AI service.
 *
 * ⚠ RULE A (`specs/ai.md` §0) applies here as it does to TMDB: nothing
 * returned by this client may enter an inference request. A rating flows to
 * storage and to the browser — never to Azure OpenAI or Azure AI Vision.
 *
 * ⚠ LOOK UP BY `imdb_id` ONLY (D-2). OMDb also accepts `?t=<title>`, and this
 * client deliberately provides no way to call it. A title-text lookup would
 * reintroduce fuzzy matching against a *different vendor's* index, after the
 * pipeline has already resolved a canonical work — and its failure mode is
 * silent: a plausible rating attached to the wrong film. `T-OMDB-004` asserts
 * that `?t=` never appears in a request this module builds.
 *
 * ⚠ "NO RATING" IS A VALUE, NOT AN ERROR (REQ-091, D-4). OMDb answers HTTP 200
 * with `{"Response":"False","Error":"Movie not found!"}` for an unknown id, and
 * `"N/A"` for a known title that has no rating yet. Both mean *we do not know*,
 * and both resolve to `null` — never `0`. Rendering `0.0` would state that a
 * film is terrible when the truth is that it is unrated, which is the worst
 * available failure mode for a feature whose whole purpose is to inform a watch
 * decision.
 *
 * ZERO NEW RUNTIME DEPENDENCIES (NFR-004). Native `fetch`, mirroring
 * `tmdbClient.ts`.
 */

/** OMDb's only endpoint. `http` is free-tier; `https` is used regardless. */
export const OMDB_BASE_URL = 'https://www.omdbapi.com';

/**
 * The free tier's daily ceiling (D-6). Requests beyond it are not attempted.
 *
 * ⚠ The reserve is not timidity. A list of several hundred titles with a cold
 * cache could consume most of a day in one page load, and the failure is
 * invisible until the *next* thing that needs a rating gets nothing.
 */
export const OMDB_DAILY_BUDGET = 1_000;

/** Requests are issued one at a time (D-6), consistent with image processing. */
export const OMDB_TIMEOUT_MS = 8_000;

/** One retry, on 429/5xx and network errors only. Ratings are not worth more. */
export const OMDB_RETRY_BACKOFF_MS: readonly number[] = [1_000];

/**
 * A rating reading. `rating` is `null` whenever the value is unknown — which
 * includes "OMDb has never heard of this id" and "this title is not yet rated".
 *
 * ⚠ `null` and `0` are NOT interchangeable here and no caller may coalesce
 * them. `0` is not a rating OMDb can return: its scale is 1.0–10.0.
 */
export interface OmdbRating {
  imdbId: string;
  /** 1.0–10.0, or `null` for "unknown". Never `0`. */
  rating: number | null;
  /** The number of IMDb votes behind the rating, or `null`. */
  voteCount: number | null;
}

/**
 * The daily budget, at module scope for the same reason `tmdbClient`'s rate
 * gate is: the limit belongs to the shared resource — one OMDb account per
 * process — not to any one caller. Per-instance state would let every request
 * believe it was the only caller, and the cap would hold only *within* a
 * request. That fails silently: each request looks well-behaved while the
 * process as a whole blows the budget.
 */
const budget = {
  /** UTC day-of-epoch the counter belongs to, so it rolls over on its own. */
  day: -1,
  spent: 0,
};

const utcDay = (now: Date): number => Math.floor(now.getTime() / 86_400_000);

/** Test-only seam: module state outlives a single test. */
export function resetOmdbBudgetForTests(): void {
  budget.day = -1;
  budget.spent = 0;
}

/** How much of today's budget is left. Exported so a caller can bound a batch. */
export function omdbBudgetRemaining(now: Date = new Date()): number {
  if (budget.day !== utcDay(now)) return OMDB_DAILY_BUDGET;
  return Math.max(0, OMDB_DAILY_BUDGET - budget.spent);
}

/**
 * Claims one unit of today's budget.
 *
 * @returns `true` if the caller may proceed.
 */
function claimBudget(now: Date): boolean {
  const today = utcDay(now);
  if (budget.day !== today) {
    budget.day = today;
    budget.spent = 0;
  }
  if (budget.spent >= OMDB_DAILY_BUDGET) return false;
  budget.spent += 1;
  return true;
}

/**
 * OMDb could not be reached, or refused.
 *
 * ⚠ This is NOT thrown for "no rating" — see the header note. It is reserved
 * for *transport* failures, so a caller can tell "OMDb is down" from "this film
 * is unrated" and degrade differently.
 */
export class OmdbUnavailableError extends Error {
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(message: string, status: number | null, retryable: boolean) {
    super(message);
    this.name = 'OmdbUnavailableError';
    this.status = status;
    this.retryable = retryable;
  }
}

export type FetchLike = typeof globalThis.fetch;

export interface OmdbClientOptions {
  apiKey: string;
  /** Injected so the whole suite runs offline against recorded bodies. */
  fetch?: FetchLike;
  baseUrl?: string;
  /** Injected so retry backoff does not add a second to every test. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so budget roll-over is testable without waiting a day. */
  now?: () => Date;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * `tt` followed by at least seven digits. Validated before a request is built,
 * not after.
 *
 * ⚠ An unvalidated id would be interpolated straight into a URL. This is the
 * boundary between our data and a third party's, and the id ultimately
 * originates from TMDB — a source we do not control.
 */
const IMDB_ID_PATTERN = /^tt\d{7,}$/;

export function isImdbId(value: unknown): value is string {
  return typeof value === 'string' && IMDB_ID_PATTERN.test(value);
}

export class OmdbClient {
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #baseUrl: string;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => Date;

  constructor(options: OmdbClientOptions) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#baseUrl = options.baseUrl ?? OMDB_BASE_URL;
    this.#sleep = options.sleep ?? realSleep;
    this.#now = options.now ?? ((): Date => new Date());
  }

  /**
   * The rating for one `imdb_id`, or `null` for "unknown".
   *
   * Returns `null` rather than throwing when:
   *   • the id is malformed — no request is made;
   *   • today's budget is exhausted (REQ-093) — no request is made;
   *   • OMDb reports `Response: "False"` (unknown id);
   *   • `imdbRating` is `"N/A"` or unparseable.
   *
   * Throws `OmdbUnavailableError` only for transport failures, so a caller can
   * distinguish "we could not ask" from "the answer is: nobody knows".
   */
  async getRating(imdbId: string): Promise<OmdbRating> {
    const absent: OmdbRating = { imdbId, rating: null, voteCount: null };

    if (!isImdbId(imdbId)) return absent;
    if (!claimBudget(this.#now())) return absent;

    const url = new URL('/', this.#baseUrl);
    // `i` — never `t`. See the header note; `T-OMDB-004` asserts it.
    url.searchParams.set('i', imdbId);
    // Short plot keeps the response small; we read two fields from it.
    url.searchParams.set('plot', 'short');
    url.searchParams.set('r', 'json');
    // The key is a query parameter because that is OMDb's only scheme. It is
    // therefore INSIDE the URL: no code path may log an OMDb URL, and none
    // does — every message below names the id, never `url.href`.
    url.searchParams.set('apikey', this.#apiKey);

    const body = await this.#get(url, imdbId);

    // OMDb answers 200 with `Response: "False"` for an unknown id. That is a
    // legitimate "no rating", not a failure.
    if (body['Response'] === 'False') return absent;

    return {
      imdbId,
      rating: parseRating(body['imdbRating']),
      voteCount: parseVotes(body['imdbVotes']),
    };
  }

  async #get(url: URL, imdbId: string): Promise<Record<string, unknown>> {
    let lastError: OmdbUnavailableError | null = null;

    for (let attempt = 0; attempt <= OMDB_RETRY_BACKOFF_MS.length; attempt += 1) {
      if (attempt > 0) await this.#sleep(OMDB_RETRY_BACKOFF_MS[attempt - 1] ?? 0);

      const response = await this.#fetchOnce(url);

      if (response instanceof OmdbUnavailableError) {
        lastError = response;
        if (!response.retryable) throw response;
        continue;
      }

      if (response.status === 429 || response.status >= 500) {
        lastError = new OmdbUnavailableError(
          `OMDb returned ${String(response.status)} for ${imdbId}.`,
          response.status,
          true,
        );
        continue;
      }

      if (!response.ok) {
        // 401 from a bad or exhausted key: retrying cannot change the answer.
        throw new OmdbUnavailableError(
          `OMDb returned ${String(response.status)} for ${imdbId}.`,
          response.status,
          false,
        );
      }

      try {
        return (await response.json()) as Record<string, unknown>;
      } catch {
        // A 200 we cannot parse is not a result. Treating it as an absent
        // rating would look exactly like "this title is unrated".
        throw new OmdbUnavailableError(
          `OMDb returned an unreadable body for ${imdbId}.`,
          200,
          false,
        );
      }
    }

    throw (
      lastError ?? new OmdbUnavailableError(`OMDb could not be reached for ${imdbId}.`, null, true)
    );
  }

  /** @returns the response, or the error to consider retrying. Never throws. */
  async #fetchOnce(url: URL): Promise<Response | OmdbUnavailableError> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, OMDB_TIMEOUT_MS);
    try {
      return await this.#fetch(url, { signal: controller.signal });
    } catch {
      // Deliberately does not include the caught error's text: a fetch failure
      // message can contain the request URL, which carries the API key.
      return new OmdbUnavailableError('OMDb request failed at the network layer.', null, true);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * `"8.8"` → `8.8`; `"N/A"`, `""`, `undefined` and anything out of OMDb's
 * 1.0–10.0 scale → `null`.
 *
 * ⚠ The range check is not defensive padding. `Number('')` is `0` and
 * `Number(null)` is `0`, so a bare `Number()` would turn two different kinds of
 * "unknown" into the assertion that a film scores zero.
 */
function parseRating(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return null;
  if (value <= 0 || value > 10) return null;
  return value;
}

/** `"1,234,567"` → `1234567`; `"N/A"` → `null`. */
function parseVotes(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const value = Number.parseInt(raw.replace(/,/g, ''), 10);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}
