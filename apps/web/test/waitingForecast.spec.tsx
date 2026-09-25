/**
 * #380 — the forecast line on a waiting row (T-FORECAST-007).
 *
 * ⚠ **`T-FORECAST-007b` IS THE POINT OF THIS FILE.** An estimate is inferred
 * from a studio's usual window, not published by anyone. A build that
 * rendered it as a plain date would pass every "is there a forecast" check
 * while telling the owner something nobody announced.
 */

import { render as rtlRender, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { WATCHMODE_ATTRIBUTION, WATCHMODE_ATTRIBUTION_URL } from '@nextup/domain';

import type { WaitingItem } from '../src/lib/apiClient';
import { WaitingPage, forecastLine } from '../src/pages/WaitingPage';

function render(ui: ReactElement): ReturnType<typeof rtlRender> {
  return rtlRender(ui, { wrapper: MemoryRouter });
}

function item(over: Partial<WaitingItem> = {}): WaitingItem {
  return {
    intentId: 'wi-1',
    titleId: 'title-1',
    workIdentity: 'tmdb:movie:967941',
    name: 'Wicked: For Good',
    releaseYear: 2025,
    posterPath: null,
    discoveredAt: '2026-09-01',
    discoverySource: 'fandango-at-home',
    availableOn: [],
    flaggedOn: [],
    accessState: 'rent-only',
    rentOn: ['Apple TV'],
    availabilityCheckedAt: '2026-09-20T00:00:00.000Z',
    availabilityRegion: 'US',
    forecast: null,
    ...over,
  };
}

const TODAY = '2026-09-25';

describe('T-FORECAST-007 · when and where it is expected to stream', () => {
  it('T-FORECAST-007a · an announced date reads as a fact, and a passed one says it was announced', () => {
    const upcoming = item({
      forecast: { kind: 'announced', service: 'peacock', on: '2026-10-03', yours: true },
    });
    expect(forecastLine(upcoming, TODAY)).toEqual({
      estimate: false,
      text: 'Streaming on Peacock from Oct 3, 2026',
    });

    const passed = item({
      forecast: { kind: 'announced', service: 'peacock', on: '2026-09-01', yours: true },
    });
    expect(forecastLine(passed, TODAY)?.text).toBe('Announced for Peacock on Sep 1, 2026');
  });

  it('T-FORECAST-007b · every estimate kind SAYS it is an estimate', () => {
    const lines = [
      { kind: 'estimate', service: 'peacock', month: '2027-01', yours: true },
      { kind: 'estimate-range', service: 'max', from: '2026-11', to: '2027-02', yours: true },
      { kind: 'estimate-soon', service: 'disney-plus', yours: true },
    ].map((forecast) =>
      forecastLine(item({ forecast: forecast as NonNullable<WaitingItem['forecast']> }), TODAY),
    );
    expect(lines.map((line) => line?.text)).toEqual([
      'Estimate: likely on Peacock around Jan 2027',
      'Estimate: likely on Max, Nov 2026 – Feb 2027',
      'Estimate: likely on Disney+ soon',
    ]);
    for (const line of lines) {
      expect(line?.estimate).toBe(true);
      expect(line?.text.startsWith('Estimate:')).toBe(true);
    }
  });

  it('T-FORECAST-007c · a service the owner does not use is named as not theirs', () => {
    const line = forecastLine(
      item({ forecast: { kind: 'estimate', service: 'starz', month: '2027-02', yours: false } }),
      TODAY,
    );
    expect(line?.text).toBe('Estimate: likely on Starz (not one of your services) around Feb 2027');
  });

  it('T-FORECAST-007d · the row renders it styled as an estimate, and not at all once streaming', () => {
    const { unmount } = render(
      <WaitingPage
        items={[
          item({
            forecast: { kind: 'estimate', service: 'peacock', month: '2027-01', yours: true },
          }),
        ]}
      />,
    );
    const line = screen.getByTestId('waiting-forecast');
    expect(line.textContent).toMatch(/^Estimate: likely on Peacock around /);
    expect(line.className).toContain('waiting-row__forecast--estimate');
    unmount();

    render(
      <WaitingPage
        items={[
          item({
            flaggedOn: ['peacock'],
            availableOn: ['Peacock Premium'],
            accessState: 'streaming',
            forecast: { kind: 'estimate', service: 'peacock', month: '2027-01', yours: true },
          }),
        ]}
      />,
    );
    expect(screen.queryByTestId('waiting-forecast')).toBeNull();
  });

  it('T-FORECAST-007e · no forecast, or a server that predates it, renders no line', () => {
    expect(forecastLine(item({ forecast: null }), TODAY)).toBeNull();
    const legacy = item();
    delete legacy.forecast;
    expect(forecastLine(legacy, TODAY)).toBeNull();
  });

  it('T-FORECAST-007f · the Watchmode attribution is unconditional and links to Watchmode', () => {
    render(<WaitingPage items={[]} />);
    const attribution = screen.getByTestId('watchmode-attribution');
    expect(attribution.textContent).toContain(WATCHMODE_ATTRIBUTION);
    expect(attribution.querySelector('a')?.getAttribute('href')).toBe(WATCHMODE_ATTRIBUTION_URL);
  });
});
