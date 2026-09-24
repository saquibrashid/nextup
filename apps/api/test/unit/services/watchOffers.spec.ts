/**
 * #378 — `T-AVAIL-014`: reading rent/buy offers without letting them become
 * availability, and the pure rules the waiting row is built from.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TmdbClient,
  readFlatrateProviders,
  readRentOrBuyProviders,
  resetTmdbRateLimiterForTests,
} from '../../../src/clients/tmdbClient.js';
import {
  DEFAULT_AVAILABILITY_REGION,
  accessStateFor,
  otherStreamingFor,
  refreshAvailability,
  type IntentRow,
} from '../../../src/services/watchAvailability.js';

const NOW = new Date('2026-03-01T12:00:00.000Z');

function intent(over: Partial<IntentRow> = {}): IntentRow {
  return {
    id: 'wi-1',
    workIdentity: 'tmdb:movie:438631',
    tmdbId: 438_631,
    tmdbMediaType: 'movie',
    availabilityRegion: DEFAULT_AVAILABILITY_REGION,
    availabilityCheckedAt: null,
    availableOn: null,
    rentOn: null,
    streamingSince: null,
    ...over,
  };
}

const PAYLOAD = {
  results: {
    US: {
      flatrate: [{ provider_name: 'Hulu' }],
      rent: [{ provider_name: 'Apple TV' }, { provider_name: 'Amazon Video' }],
      buy: [{ provider_name: 'Apple TV' }, { provider_name: 'Fandango At Home' }],
      ads: [{ provider_name: 'Tubi TV' }],
      free: [{ provider_name: 'Pluto TV' }],
    },
  },
};

describe('T-AVAIL-014 · rent/buy offers are recorded, never counted as streaming', () => {
  beforeEach(() => resetTmdbRateLimiterForTests());
  afterEach(() => {
    vi.unstubAllGlobals();
    resetTmdbRateLimiterForTests();
  });

  it('T-AVAIL-014a · rent and buy are read apart, deduplicated, and free/ads are read by neither', () => {
    expect(readRentOrBuyProviders(PAYLOAD, 'US')).toEqual([
      'Apple TV',
      'Amazon Video',
      'Fandango At Home',
    ]);
    expect(readFlatrateProviders(PAYLOAD, 'US')).toEqual(['Hulu']);
    const everything = [
      ...(readRentOrBuyProviders(PAYLOAD, 'US') ?? []),
      ...(readFlatrateProviders(PAYLOAD, 'US') ?? []),
    ];
    expect(everything).not.toContain('Tubi TV');
    expect(everything).not.toContain('Pluto TV');
  });

  it('T-AVAIL-014b · NOT KNOWN stays distinct from ASKED-AND-NOBODY', () => {
    expect(readRentOrBuyProviders(null, 'US')).toBeNull();
    expect(readRentOrBuyProviders({ results: {} }, 'US')).toEqual([]);
    expect(readRentOrBuyProviders({ results: { US: { rent: 'x' as never } } }, 'US')).toEqual([]);
    expect(
      readRentOrBuyProviders({ results: { US: { rent: [{ provider_name: 7 }] } } }, 'US'),
    ).toEqual([]);
  });

  it('T-AVAIL-014c · getWatchOffers makes ONE request and returns both halves', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(PAYLOAD), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new TmdbClient({ apiKey: 'fixture-key-not-a-real-secret' });

    await expect(client.getWatchOffers('movie', 438_631, 'US')).resolves.toEqual({
      flatrate: ['Hulu'],
      rentOrBuy: ['Apple TV', 'Amazon Video', 'Fandango At Home'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(
      '/movie/438631/watch/providers',
    );
  });

  it('T-AVAIL-014d · the access state follows flatrate alone', () => {
    expect(accessStateFor(null, null, null)).toBe('not-checked');
    expect(accessStateFor(null, null, NOW)).toBe('unknown');
    expect(accessStateFor(['Hulu'], ['Apple TV'], NOW)).toBe('streaming');
    expect(accessStateFor([], ['Apple TV'], NOW)).toBe('rent-only');
    expect(accessStateFor([], [], NOW)).toBe('not-seen');
    expect(accessStateFor([], null, NOW)).toBe('not-seen');
  });

  it('T-AVAIL-014e · streaming elsewhere is split into unused services and other providers', () => {
    expect(otherStreamingFor(null, ['netflix'])).toBeNull();
    expect(
      otherStreamingFor(['Netflix', 'Max Amazon Channel', 'Hulu', ' HULU ', 'Mubi'], ['netflix']),
    ).toEqual({ services: ['max'], providers: ['Hulu', 'Mubi'] });
    expect(otherStreamingFor(['Netflix'], ['netflix'])).toEqual({ services: [], providers: [] });
  });

  it('T-AVAIL-014f · the refresh records rent offers and the first streaming sighting', async () => {
    const earlier = new Date('2026-02-01T00:00:00.000Z');
    const rows = [
      intent({ id: 'wi-new', tmdbId: 1 }),
      intent({ id: 'wi-kept', tmdbId: 2, streamingSince: earlier }),
      intent({ id: 'wi-gone', tmdbId: 3, streamingSince: earlier }),
      intent({ id: 'wi-unknown', tmdbId: 4, streamingSince: earlier }),
    ];
    const answers: Record<number, { flatrate: string[]; rentOrBuy: string[] } | null> = {
      1: { flatrate: ['Hulu'], rentOrBuy: [] },
      2: { flatrate: ['Hulu'], rentOrBuy: [] },
      3: { flatrate: [], rentOrBuy: ['Apple TV'] },
      4: null,
    };
    const { writes } = await refreshAvailability(
      rows,
      { getWatchOffers: (_m, tmdbId) => Promise.resolve(answers[tmdbId] ?? null) },
      NOW,
    );
    expect(writes.map((w) => [w.id, w.streamingSince, w.rentOn])).toEqual([
      ['wi-new', NOW, []],
      ['wi-kept', earlier, []],
      ['wi-gone', null, ['Apple TV']],
      // NOT KNOWN invents no change in either direction.
      ['wi-unknown', earlier, null],
    ]);
  });
});
