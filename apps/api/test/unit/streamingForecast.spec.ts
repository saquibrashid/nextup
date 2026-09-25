/**
 * #380 — the streaming forecast's outbound half: the Watchmode releases
 * client (T-FORECAST-003), TMDB release facts (T-FORECAST-004) and the lazy
 * refresh (T-FORECAST-005). No network: every fetch is a stub.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  WATCHMODE_FEED_CACHE_MS,
  WatchmodeClient,
  WatchmodeUnavailableError,
  earliestAnnouncements,
  readRelease,
  resetWatchmodeCacheForTests,
} from '../../src/clients/watchmodeClient.js';
import { readReleaseFacts } from '../../src/clients/tmdbClient.js';
import {
  isForecastStale,
  refreshForecast,
  selectForForecastRefresh,
  type ForecastRow,
} from '../../src/services/streamingForecast.js';

const NOW = new Date('2026-09-25T12:00:00Z');
const MS_PER_DAY = 86_400_000;

interface Call {
  url: URL;
  headers: Record<string, string>;
}

function stubFetch(pages: (url: URL) => unknown, status = 200) {
  const calls: Call[] = [];
  const fetch = ((input: URL, init?: RequestInit) => {
    calls.push({ url: input, headers: (init?.headers ?? {}) as Record<string, string> });
    return Promise.resolve(
      new Response(JSON.stringify(pages(input)), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const release = (over: Record<string, unknown> = {}) => ({
  tmdb_id: 1_022_789,
  tmdb_type: 'movie',
  source_id: 389,
  source_name: 'Peacock Premium',
  source_release_date: '2026-10-03',
  ...over,
});

afterEach(() => resetWatchmodeCacheForTests());

describe('T-FORECAST-003 · the Watchmode releases feed', () => {
  it('T-FORECAST-003a · the key travels in a header, never the URL, and the date window is all that is sent', async () => {
    const { fetch, calls } = stubFetch(() => ({ releases: [] }));
    await new WatchmodeClient({ apiKey: 'k'.repeat(40), fetch }).listAnnouncedReleases(NOW);

    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.headers['X-API-Key']).toBe('k'.repeat(40));
      expect(call.url.toString()).not.toContain('kkkk');
      expect(call.url.host).toBe('api.watchmode.com');
      expect([...call.url.searchParams.keys()].sort()).toEqual(['end_date', 'limit', 'start_date']);
    }
  });

  it('T-FORECAST-003b · the windows cover 30 days back to 120 ahead with no gap', async () => {
    const { fetch, calls } = stubFetch(() => ({ releases: [] }));
    await new WatchmodeClient({ apiKey: 'key', fetch }).listAnnouncedReleases(NOW);

    const day = (compact: string | null) =>
      Date.parse(`${compact?.slice(0, 4)}-${compact?.slice(4, 6)}-${compact?.slice(6, 8)}`);
    const windows = calls.map((c) => ({
      start: day(c.url.searchParams.get('start_date')),
      end: day(c.url.searchParams.get('end_date')),
    }));
    expect(windows[0]?.start).toBe(Date.parse('2026-08-26'));
    expect(windows.at(-1)?.end).toBe(Date.parse('2027-01-23'));
    for (let i = 1; i < windows.length; i += 1) {
      expect((windows[i]?.start ?? 0) - (windows[i - 1]?.end ?? 0)).toBe(MS_PER_DAY);
    }
    // 1 credit per page on a 2,500-credit month.
    expect(calls.length).toBeLessThanOrEqual(11);
  });

  it('T-FORECAST-003c · only well-formed rows on our services are read', () => {
    expect(readRelease(release())).toEqual({
      tmdbId: 1_022_789,
      mediaType: 'movie',
      service: 'peacock',
      on: '2026-10-03',
    });
    expect(readRelease(release({ source_id: 203 }))?.service).toBe('netflix');
    expect(readRelease(release({ source_id: 999_999 }))).toBeNull();
    expect(readRelease(release({ tmdb_id: null }))).toBeNull();
    expect(readRelease(release({ tmdb_type: 'person' }))).toBeNull();
    expect(readRelease(release({ source_release_date: 'soon' }))).toBeNull();
    expect(readRelease('nonsense')).toBeNull();
  });

  it('T-FORECAST-003d · the feed is cached in-process, then read again once it ages out', async () => {
    const { fetch, calls } = stubFetch(() => ({ releases: [release()] }));
    const client = new WatchmodeClient({ apiKey: 'key', fetch });
    const first = await client.listAnnouncedReleases(NOW);
    const pages = calls.length;
    await client.listAnnouncedReleases(new Date(NOW.getTime() + 60_000));
    expect(calls.length).toBe(pages);
    await client.listAnnouncedReleases(new Date(NOW.getTime() + WATCHMODE_FEED_CACHE_MS + 1));
    expect(calls.length).toBe(pages * 2);
    expect(first.length).toBe(pages);
  });

  it('T-FORECAST-003e · a failure THROWS, and an unconfigured client asks nothing', async () => {
    const failing = stubFetch(() => ({ error: 'quota' }), 429);
    await expect(
      new WatchmodeClient({ apiKey: 'key', fetch: failing.fetch }).listAnnouncedReleases(NOW),
    ).rejects.toBeInstanceOf(WatchmodeUnavailableError);

    const shape = stubFetch(() => ({ unexpected: true }));
    await expect(
      new WatchmodeClient({ apiKey: 'key', fetch: shape.fetch }).listAnnouncedReleases(NOW),
    ).rejects.toBeInstanceOf(WatchmodeUnavailableError);

    const none = stubFetch(() => ({ releases: [] }));
    const client = new WatchmodeClient({ apiKey: '', fetch: none.fetch });
    expect(client.configured).toBe(false);
    await expect(client.listAnnouncedReleases(NOW)).rejects.toBeInstanceOf(
      WatchmodeUnavailableError,
    );
    expect(none.calls).toEqual([]);
  });

  it('T-FORECAST-003f · the earliest announced release per work wins', () => {
    const byWork = earliestAnnouncements([
      { tmdbId: 1, mediaType: 'movie', service: 'max', on: '2026-11-01' },
      { tmdbId: 1, mediaType: 'movie', service: 'peacock', on: '2026-10-03' },
      { tmdbId: 1, mediaType: 'tv', service: 'netflix', on: '2026-09-01' },
    ]);
    expect(byWork.get('movie:1')).toEqual({ service: 'peacock', on: '2026-10-03' });
    expect(byWork.get('tv:1')).toEqual({ service: 'netflix', on: '2026-09-01' });
  });
});

describe('T-FORECAST-004 · TMDB release facts', () => {
  const body = {
    production_companies: [{ id: 33 }, { id: 'x' }, { id: 6704 }],
    release_dates: {
      results: [
        {
          iso_3166_1: 'GB',
          release_dates: [{ type: 3, release_date: '2026-01-01T00:00:00.000Z' }],
        },
        {
          iso_3166_1: 'US',
          release_dates: [
            { type: 2, release_date: '2026-06-01T00:00:00.000Z' },
            { type: 3, release_date: '2026-06-20T00:00:00.000Z' },
            { type: 3, release_date: '2026-06-13T00:00:00.000Z' },
            { type: 4, release_date: '2026-07-22T00:00:00.000Z' },
            { type: 5, release_date: '2026-08-01T00:00:00.000Z' },
          ],
        },
      ],
    },
  };

  it('T-FORECAST-004a · the earliest wide release in the region, and the earliest rent/buy', () => {
    expect(readReleaseFacts(body, 'US')).toEqual({
      companyIds: [33, 6704],
      theatricalOn: '2026-06-13',
      digitalOn: '2026-07-22',
    });
  });

  it('T-FORECAST-004b · a limited release stands in only when there is no wide one', () => {
    const limitedOnly = {
      release_dates: {
        results: [
          { iso_3166_1: 'US', release_dates: [{ type: 2, release_date: '2026-05-01T00:00:00Z' }] },
        ],
      },
    };
    expect(readReleaseFacts(limitedOnly, 'US')).toEqual({
      companyIds: [],
      theatricalOn: '2026-05-01',
      digitalOn: null,
    });
  });

  it('T-FORECAST-004c · no region, or a malformed body, is nothing — never a guessed date', () => {
    expect(readReleaseFacts(body, 'CA')).toEqual({
      companyIds: [33, 6704],
      theatricalOn: null,
      digitalOn: null,
    });
    expect(readReleaseFacts(null, 'US')).toEqual({
      companyIds: [],
      theatricalOn: null,
      digitalOn: null,
    });
  });
});

describe('T-FORECAST-005 · the lazy forecast refresh', () => {
  const row = (over: Partial<ForecastRow> = {}): ForecastRow => ({
    id: 'i1',
    tmdbId: 1_022_789,
    tmdbMediaType: 'movie',
    availabilityRegion: 'US',
    forecastCheckedAt: null,
    companyIds: null,
    theatricalOn: null,
    digitalOn: null,
    announced: null,
    streamingOnAService: false,
    ...over,
  });

  const facts = { companyIds: [33], theatricalOn: '2026-06-13', digitalOn: '2026-07-22' };

  it('T-FORECAST-005a · only unchecked or week-old rows not yet streaming are due, capped per request', () => {
    expect(isForecastStale(row(), NOW)).toBe(true);
    expect(
      isForecastStale(row({ forecastCheckedAt: new Date(NOW.getTime() - MS_PER_DAY) }), NOW),
    ).toBe(false);
    expect(
      isForecastStale(row({ forecastCheckedAt: new Date(NOW.getTime() - 7 * MS_PER_DAY) }), NOW),
    ).toBe(true);
    expect(isForecastStale(row({ streamingOnAService: true }), NOW)).toBe(false);
    expect(isForecastStale(row({ tmdbId: null }), NOW)).toBe(false);

    const many = Array.from({ length: 12 }, (_, i) => row({ id: `i${i}` }));
    expect(selectForForecastRefresh(many, NOW)).toHaveLength(8);
  });

  it('T-FORECAST-005b · facts and the announced date are written; a TV row asks TMDB nothing', async () => {
    const asked: number[] = [];
    const { writes, failedIds } = await refreshForecast(
      [row(), row({ id: 'tv', tmdbId: 99, tmdbMediaType: 'tv' })],
      {
        tmdb: {
          getReleaseFacts: (id) => {
            asked.push(id);
            return Promise.resolve(facts);
          },
        },
        announcements: {
          announcements: () =>
            Promise.resolve(
              new Map([['tv:99', { service: 'netflix' as const, on: '2026-10-10' }]]),
            ),
        },
      },
      NOW,
    );
    expect(failedIds).toEqual([]);
    expect(asked).toEqual([1_022_789]);
    expect(writes).toEqual([
      { id: 'i1', forecastCheckedAt: NOW, ...facts, announced: null },
      {
        id: 'tv',
        forecastCheckedAt: NOW,
        companyIds: [],
        theatricalOn: null,
        digitalOn: null,
        announced: { service: 'netflix', on: '2026-10-10' },
      },
    ]);
  });

  it('T-FORECAST-005c · a failed or absent feed KEEPS the last-known announcement', async () => {
    const known = { service: 'peacock' as const, on: '2026-10-03' };
    const tmdb = { getReleaseFacts: () => Promise.resolve(facts) };
    for (const announcements of [
      null,
      { announcements: () => Promise.reject(new Error('quota')) },
    ]) {
      const { writes } = await refreshForecast(
        [row({ announced: known })],
        { tmdb, announcements },
        NOW,
      );
      expect(writes[0]?.announced).toEqual(known);
    }

    // …whereas a feed that ANSWERED without it clears it: the date was withdrawn.
    const { writes } = await refreshForecast(
      [row({ announced: known })],
      { tmdb, announcements: { announcements: () => Promise.resolve(new Map()) } },
      NOW,
    );
    expect(writes[0]?.announced).toBeNull();
  });

  it('T-FORECAST-005d · a failed TMDB lookup writes nothing for that row', async () => {
    const { writes, failedIds } = await refreshForecast(
      [row()],
      { tmdb: { getReleaseFacts: () => Promise.reject(new Error('down')) }, announcements: null },
      NOW,
    );
    expect(writes).toEqual([]);
    expect(failedIds).toEqual(['i1']);
  });
});
