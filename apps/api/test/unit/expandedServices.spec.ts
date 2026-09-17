import { SERVICES, type Service } from '@nextup/domain';
import { describe, expect, it } from 'vitest';

import { readFlatrateProviders } from '../../src/clients/tmdbClient.js';
import { parseAddTitleRequest } from '../../src/routes/manualListEdits.js';
import { parseRemovedListQuery } from '../../src/routes/removedQuery.js';
import { parseTitleListQuery } from '../../src/routes/titlesQuery.js';
import {
  flaggedProvidersFor,
  DEFAULT_AVAILABILITY_REGION,
} from '../../src/services/watchAvailability.js';

describe('T-SVC-001 API service dimensions', () => {
  it('T-SVC-001d accepts all eight service tokens at list, removed, and manual-add boundaries', () => {
    for (const service of SERVICES) {
      expect(parseTitleListQuery({ service }).services).toEqual([service]);
      expect(parseRemovedListQuery({ service }).service).toBe(service);
      expect(parseAddTitleRequest({ service, tmdbId: 438631, mediaType: 'movie' })).toEqual({
        ok: true,
        value: { service, tmdbId: 438631, mediaType: 'movie' },
      });
    }
    expect(parseTitleListQuery({ service: [...SERVICES, 'netflix'] }).services).toEqual(SERVICES);
    expect(() => parseTitleListQuery({ service: 'unsupported-service' })).toThrow();
    expect(() => parseRemovedListQuery({ service: 'unsupported-service' })).toThrow();
    expect(
      parseAddTitleRequest({ service: 'unsupported-service', tmdbId: 1, mediaType: 'movie' }).ok,
    ).toBe(false);
    expect(() => parseTitleListQuery({ service: Array<string>(21).fill('netflix') })).toThrow();
  });

  it('T-SVC-001e maps only explicit subscription aliases, including qualified channels', () => {
    const names: Record<Service, string[]> = {
      netflix: ['Netflix', 'Netflix Standard with Ads', 'Netflix Kids'],
      max: [
        'Max',
        'Max with Ads',
        'Max Amazon Channel',
        'Max Apple TV Channel',
        'Max Roku Premium Channel',
        'HBO Max',
        'HBO Max with Ads',
        'HBO Max Amazon Channel',
        'HBO Max Apple TV Channel',
        'HBO Max Roku Premium Channel',
      ],
      'prime-video': [
        'Amazon Prime Video',
        'Amazon Prime Video with Ads',
        'Prime Video',
        'Prime Video with Ads',
      ],
      'disney-plus': ['Disney Plus', 'Disney+', 'Disney+ with Ads', 'Disney Plus Premium'],
      'apple-tv-plus': ['Apple TV Plus', 'Apple TV+', 'Apple TV+ Amazon Channel'],
      'paramount-plus': [
        'Paramount Plus',
        'Paramount+',
        'Paramount Plus Essential',
        'Paramount Plus Premium',
        'Paramount+ with Ads',
        'Paramount+ with Showtime',
        'Paramount+ Amazon Channel',
        'Paramount Plus Apple TV Channel',
        'Paramount+ Roku Premium Channel',
        'Paramount+ with Showtime Apple TV Channel',
        'Paramount+ with Showtime Amazon Channel',
        'Paramount+ with Showtime Roku Premium Channel',
      ],
      starz: [
        'Starz',
        'Starz Amazon Channel',
        'Starz Apple TV Channel',
        'Starz Roku Premium Channel',
      ],
      peacock: ['Peacock', 'Peacock Premium', 'Peacock Premium Plus'],
    };
    for (const service of SERVICES) {
      for (const name of names[service]) {
        expect(flaggedProvidersFor([name]), name).toEqual([service]);
        expect(flaggedProvidersFor([`  ${name.toUpperCase()}  `]), name).toEqual([service]);
      }
    }
    expect(flaggedProvidersFor(Object.values(names).flat().reverse())).toEqual(SERVICES);
    expect(
      flaggedProvidersFor([
        'Maxwell',
        'Maximum',
        'Disney',
        'Disney Channel',
        'Disney unrelated',
        'Disney Plus unrelated',
        'Hulu',
        'Amazon Video',
        'Amazon',
        'Apple TV',
        'Paramount Network',
        'Starzplay unrelated',
        'Peacock Premium unrelated',
        'Netflix unrelated',
        'unsupported-service',
      ]),
    ).toEqual([]);
  });

  it('T-SVC-001f keeps US flatrate eligibility and distinguishes unknown from an empty result', () => {
    expect(DEFAULT_AVAILABILITY_REGION).toBe('US');
    expect(flaggedProvidersFor(null)).toBeNull();
    expect(flaggedProvidersFor([])).toEqual([]);
    const body = {
      results: {
        US: {
          flatrate: [{ provider_name: 'Paramount+ Amazon Channel' }],
          rent: [{ provider_name: 'Amazon Prime Video' }],
          buy: [{ provider_name: 'Apple TV+' }],
          ads: [{ provider_name: 'Peacock Premium' }],
        },
        GB: { flatrate: [{ provider_name: 'Disney Plus' }] },
      },
    };
    expect(flaggedProvidersFor(readFlatrateProviders(body, 'US'))).toEqual(['paramount-plus']);
    expect(flaggedProvidersFor(readFlatrateProviders(null, 'US'))).toBeNull();
  });
});
