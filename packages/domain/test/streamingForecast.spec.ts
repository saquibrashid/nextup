/**
 * #380 — `T-FORECAST-001`: the expected-streaming forecast is pure and honest.
 *
 * The load-bearing rules: an announced date always wins; an estimate exists
 * only for a movie whose mapped studios agree on ONE service; a month is shown
 * when the rent/buy date is known and a range only as the fallback.
 */

import { describe, expect, it } from 'vitest';

import {
  SERVICES,
  STUDIO_STREAMING_HOMES,
  DAYS_FROM_DIGITAL_TO_STREAMING,
  WATCHMODE_ATTRIBUTION,
  streamingForecast,
  studioStreamingHome,
  type ForecastInput,
} from '../src/index.js';

const BASE: ForecastInput = {
  mediaType: 'movie',
  companyIds: [33],
  theatricalOn: null,
  digitalOn: null,
  announced: null,
  today: '2026-09-24',
};

describe('T-FORECAST-001 — streamingForecast', () => {
  it('T-FORECAST-001a — an announced date wins over any estimate, for TV too', () => {
    const announced = { service: 'netflix' as const, on: '2026-10-03' };
    expect(streamingForecast({ ...BASE, digitalOn: '2026-09-01', announced })).toEqual({
      kind: 'announced',
      service: 'netflix',
      on: '2026-10-03',
    });
    expect(streamingForecast({ ...BASE, mediaType: 'tv', announced })?.kind).toBe('announced');
  });

  it('T-FORECAST-001b — the month comes from the rent/buy date plus the service window', () => {
    // Universal → Peacock, 75 days after 2026-09-01 is 2026-11-15.
    expect(streamingForecast({ ...BASE, digitalOn: '2026-09-01' })).toEqual({
      kind: 'estimate',
      service: 'peacock',
      month: '2026-11',
    });
  });

  it('T-FORECAST-001c — a range is the fallback when only the theatrical date is known', () => {
    // 2026-08-01 + 30 + 75 = 2026-11-14, ±45 days → Sep 30 … Dec 29.
    expect(streamingForecast({ ...BASE, theatricalOn: '2026-08-01' })).toEqual({
      kind: 'estimate-range',
      service: 'peacock',
      from: '2026-09',
      to: '2026-12',
    });
    // A range never starts in the past.
    expect(streamingForecast({ ...BASE, theatricalOn: '2026-06-15' })).toMatchObject({
      kind: 'estimate-range',
      from: '2026-09',
    });
  });

  it('T-FORECAST-001d — an estimate already overdue reads as "soon", never a past month', () => {
    expect(streamingForecast({ ...BASE, digitalOn: '2026-05-01' })).toEqual({
      kind: 'estimate-soon',
      service: 'peacock',
    });
    expect(streamingForecast({ ...BASE, theatricalOn: '2026-01-01' })?.kind).toBe('estimate-soon');
  });

  it('T-FORECAST-001e — no estimate for TV, unmapped studios, disagreeing studios or no dates', () => {
    expect(streamingForecast({ ...BASE, mediaType: 'tv', digitalOn: '2026-09-01' })).toBeNull();
    expect(
      streamingForecast({ ...BASE, companyIds: [999_999], digitalOn: '2026-09-01' }),
    ).toBeNull();
    expect(streamingForecast({ ...BASE, companyIds: null, digitalOn: '2026-09-01' })).toBeNull();
    // New Line (HBO Max) + Screen Gems (Netflix): the studios disagree.
    expect(studioStreamingHome([12, 3287])).toBeNull();
    expect(
      streamingForecast({ ...BASE, companyIds: [12, 3287], digitalOn: '2026-09-01' }),
    ).toBeNull();
    expect(streamingForecast(BASE)).toBeNull();
    // Two companies of the same studio agree.
    expect(studioStreamingHome([33, 6704, 999_999])).toBe('peacock');
  });

  it('T-FORECAST-001f — the reviewed map and windows only name supported services', () => {
    for (const service of Object.values(STUDIO_STREAMING_HOMES)) {
      expect(SERVICES).toContain(service);
    }
    expect(Object.keys(DAYS_FROM_DIGITAL_TO_STREAMING).sort()).toEqual([...SERVICES].sort());
    expect(WATCHMODE_ATTRIBUTION).toMatch(/Watchmode/);
    expect(WATCHMODE_ATTRIBUTION).toMatch(/announced/i);
  });
});
