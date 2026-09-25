/**
 * #380 — the Watchmode client: announced upcoming streaming releases.
 *
 * ⚠ **WHAT IS SENT: A DATE WINDOW AND NOTHING ELSE.** `GET /v1/releases` is a
 * feed, not a lookup. No title, id, image or owner detail ever leaves this
 * process for Watchmode; the feed is joined to the waiting list locally on
 * the TMDB id it carries (`tools/check-outbound-hosts.mjs`, `sends:
 * 'date-window'`).
 *
 * ⚠ **The key travels in the `X-API-Key` header**, never the query string,
 * so no URL this client builds carries a secret.
 *
 * ⚠ **Free plan (owner's key):** 2,500 credits/month, 1 credit per page. The
 * feed is cached in-process for {@link WATCHMODE_FEED_CACHE_MS}, so a burst of
 * waiting-view renders spends one fetch, and it is only fetched when a
 * waiting row is due for a forecast refresh at all.
 */

import { SERVICES, type Service } from '@nextup/domain';

const WATCHMODE_BASE_URL = 'https://api.watchmode.com/v1';
const WATCHMODE_TIMEOUT_MS = 8_000;
/** The feed caps a page at 250 rows; 15-day windows stayed well under it in the #380 spike. */
export const WATCHMODE_WINDOW_DAYS = 15;
const WATCHMODE_PAGE_LIMIT = 250;
/** How far back and ahead the feed is read. */
export const WATCHMODE_LOOKBACK_DAYS = 30;
export const WATCHMODE_LOOKAHEAD_DAYS = 120;
export const WATCHMODE_FEED_CACHE_MS = 12 * 60 * 60 * 1000;

/**
 * Watchmode `source_id` → our service. Verified against `GET /v1/sources`
 * (US, `type: sub`) on 2026-09-24. Channels resold through another store
 * ("via Amazon Prime") are deliberately absent: they are not the service.
 */
export const WATCHMODE_SOURCE_SERVICES: Readonly<Record<number, Service>> = {
  203: 'netflix',
  387: 'max',
  26: 'prime-video',
  372: 'disney-plus',
  371: 'apple-tv-plus',
  522: 'apple-tv-plus',
  444: 'paramount-plus',
  455: 'paramount-plus',
  388: 'peacock',
  389: 'peacock',
  232: 'starz',
};

export class WatchmodeUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatchmodeUnavailableError';
  }
}

/** One announced release on one of our services. */
export interface AnnouncedRelease {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  service: Service;
  /** `YYYY-MM-DD`. */
  on: string;
}

export type FetchLike = typeof globalThis.fetch;

export interface WatchmodeClientOptions {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
}

const MS_PER_DAY = 86_400_000;

function compact(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

let feedCache: { fetchedAt: number; releases: AnnouncedRelease[] } | null = null;

export function resetWatchmodeCacheForTests(): void {
  feedCache = null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read one feed row, or `null` for a row that is not an announced release on our services. */
export function readRelease(raw: unknown): AnnouncedRelease | null {
  if (!isRecord(raw)) return null;
  const tmdbId = raw['tmdb_id'];
  const tmdbType = raw['tmdb_type'];
  const sourceId = raw['source_id'];
  const on = raw['source_release_date'];
  if (typeof tmdbId !== 'number' || !Number.isInteger(tmdbId) || tmdbId <= 0) return null;
  if (tmdbType !== 'movie' && tmdbType !== 'tv') return null;
  if (typeof sourceId !== 'number') return null;
  const service = WATCHMODE_SOURCE_SERVICES[sourceId];
  if (service === undefined || !SERVICES.includes(service)) return null;
  if (typeof on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return null;
  return { tmdbId, mediaType: tmdbType, service, on };
}

export class WatchmodeClient {
  readonly #apiKey: string;
  readonly #fetch: FetchLike;
  readonly #baseUrl: string;

  constructor(options: WatchmodeClientOptions) {
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#baseUrl = options.baseUrl ?? WATCHMODE_BASE_URL;
  }

  get configured(): boolean {
    return this.#apiKey !== '';
  }

  /**
   * Every announced release on our services from {@link WATCHMODE_LOOKBACK_DAYS}
   * ago to {@link WATCHMODE_LOOKAHEAD_DAYS} ahead, read in
   * {@link WATCHMODE_WINDOW_DAYS}-day windows. Cached in-process.
   *
   * ⚠ Throws {@link WatchmodeUnavailableError} on any failure. The caller keeps
   * the last-known announced dates; a failed feed must never read as "no
   * announcements".
   */
  async listAnnouncedReleases(now: Date): Promise<AnnouncedRelease[]> {
    if (!this.configured) throw new WatchmodeUnavailableError('Watchmode is not configured.');
    if (feedCache !== null && now.getTime() - feedCache.fetchedAt < WATCHMODE_FEED_CACHE_MS) {
      return feedCache.releases;
    }

    const releases: AnnouncedRelease[] = [];
    const first = now.getTime() - WATCHMODE_LOOKBACK_DAYS * MS_PER_DAY;
    const last = now.getTime() + WATCHMODE_LOOKAHEAD_DAYS * MS_PER_DAY;
    for (let start = first; start <= last; start += WATCHMODE_WINDOW_DAYS * MS_PER_DAY) {
      const end = Math.min(start + (WATCHMODE_WINDOW_DAYS - 1) * MS_PER_DAY, last);
      const rows = await this.#page(new Date(start), new Date(end));
      for (const row of rows) {
        const release = readRelease(row);
        if (release !== null) releases.push(release);
      }
    }

    feedCache = { fetchedAt: now.getTime(), releases };
    return releases;
  }

  async #page(start: Date, end: Date): Promise<unknown[]> {
    const url = new URL(`${this.#baseUrl}/releases/`);
    url.searchParams.set('start_date', compact(start));
    url.searchParams.set('end_date', compact(end));
    url.searchParams.set('limit', String(WATCHMODE_PAGE_LIMIT));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WATCHMODE_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: { 'X-API-Key': this.#apiKey, Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch {
      throw new WatchmodeUnavailableError('Watchmode request failed at the network layer.');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      throw new WatchmodeUnavailableError(`Watchmode returned ${response.status} for /releases.`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new WatchmodeUnavailableError('Watchmode returned an unreadable body for /releases.');
    }
    if (!isRecord(body) || !Array.isArray(body['releases'])) {
      throw new WatchmodeUnavailableError('Watchmode returned an unexpected /releases shape.');
    }
    return body['releases'];
  }
}

/**
 * The earliest announced release per work, keyed `movie:123` / `tv:456`.
 * The earliest wins because it is the first moment the owner can watch.
 */
export function earliestAnnouncements(
  releases: readonly AnnouncedRelease[],
): Map<string, { service: Service; on: string }> {
  const byWork = new Map<string, { service: Service; on: string }>();
  for (const release of releases) {
    const key = `${release.mediaType}:${release.tmdbId}`;
    const existing = byWork.get(key);
    if (existing === undefined || release.on < existing.on) {
      byWork.set(key, { service: release.service, on: release.on });
    }
  }
  return byWork;
}
