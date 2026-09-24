/**
 * #378 — waiting to stream: the web half.
 *
 * `T-AVAIL-015` — each access state reads as what it is. Rent/buy is never
 * streaming; streaming somewhere the owner does not subscribe is said in
 * words, not only by colour; a row that reached the owner's services leads.
 *
 * `T-WAIT-017` — the rental storefronts are reachable from `/upload`, each
 * labelled "(rent/buy)", and are append-only by construction. The bug the
 * owner reported was that the waiting view's "upload" led to an import page
 * that offered no storefront at all.
 *
 * `T-WAIT-019` — search-to-add: an explicit "Wait for it", and every refusal
 * names the fact that stopped it.
 */

import { render as rtlRender, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { DISCOVERY_SOURCES, DISCOVERY_SOURCE_LABELS, batchSourceLabel } from '@nextup/domain';

import { ApiError, type TmdbSearchResult, type WaitingItem } from '../src/lib/apiClient';
import {
  WAITING_NOW_STREAMING_BADGE,
  WAITING_OTHER_SERVICES_SUFFIX,
  WAITING_SEARCH_ADDED,
  WAITING_SEARCH_ALREADY_LISTED,
  WAITING_SEARCH_ALREADY_WAITING,
  WAITING_SEARCH_FAILED,
  WAITING_SEARCH_SUPPRESSED,
} from '../src/copy';
import {
  WaitingPage,
  orderWaiting,
  otherServicesLine,
  rentOnlyLine,
} from '../src/pages/WaitingPage';
import { UploadPage } from '../src/pages/UploadPage';
import { searchAddRefusal } from '../src/components/WaitingSearchAdd';

function render(ui: ReactElement): ReturnType<typeof rtlRender> {
  return rtlRender(ui, { wrapper: MemoryRouter });
}

function item(over: Partial<WaitingItem> = {}): WaitingItem {
  return {
    intentId: 'wi-1',
    titleId: 'title-1',
    workIdentity: 'tmdb:movie:438631',
    name: 'Dune',
    releaseYear: 2021,
    posterPath: null,
    discoveredAt: '2026-01-04',
    discoverySource: 'fandango-at-home',
    availableOn: [],
    flaggedOn: [],
    otherServicesOn: [],
    otherProvidersOn: [],
    rentOn: [],
    accessState: 'not-seen',
    streamingSince: null,
    availabilityCheckedAt: '2026-02-01T00:00:00.000Z',
    availabilityRegion: 'US',
    ...over,
  };
}

describe('T-AVAIL-015 · #378 · each access state reads as what it is', () => {
  it('T-AVAIL-015a · rent-only names the storefronts, says (rent/buy), and is never the flag', () => {
    const row = item({ accessState: 'rent-only', rentOn: ['Apple TV', 'Amazon Video'] });
    render(<WaitingPage items={[row]} />);

    const line = screen.getByTestId('waiting-rent-only').textContent ?? '';
    expect(line).toContain('Apple TV, Amazon Video');
    expect(line).toContain('(rent/buy)');
    expect(line).toContain('Not streaming on your services yet');
    expect(line).toContain('2026-02-01');
    expect(screen.queryByTestId('waiting-flag')).toBeNull();
    expect(screen.queryByTestId('waiting-streaming-badge')).toBeNull();
    // The rent line REPLACES the weaker sentence rather than sitting beside it.
    expect(screen.queryByTestId('waiting-availability')).toBeNull();
  });

  it('T-AVAIL-015b · rent-only with no named storefront falls back to the bounded sentence', () => {
    expect(rentOnlyLine(item({ accessState: 'rent-only', rentOn: [] }))).toBeNull();
    expect(rentOnlyLine(item({ accessState: 'not-seen', rentOn: ['Apple TV'] }))).toBeNull();
  });

  it('T-AVAIL-015c · a service the owner does not use is said in words, apart from the flag', () => {
    const row = item({
      availableOn: ['Hulu', 'Max'],
      otherServicesOn: ['max'],
      otherProvidersOn: ['Hulu'],
      accessState: 'streaming',
    });
    render(<WaitingPage items={[row]} />);

    const other = screen.getByTestId('waiting-other-services');
    expect(other.textContent).toContain('Max, Hulu');
    expect(other.textContent).toContain(WAITING_OTHER_SERVICES_SUFFIX);
    // Not the good-news line: no flag, no badge, no invitation to import.
    expect(screen.queryByTestId('waiting-flag')).toBeNull();
    expect(screen.queryByTestId('waiting-streaming-badge')).toBeNull();
    expect(otherServicesLine(item())).toBeNull();
  });

  it('T-AVAIL-015d · a row on the owner\u2019s services is badged, dated and leads the list', () => {
    const waiting = item({ intentId: 'wi-a', name: 'Still waiting' });
    const streaming = item({
      intentId: 'wi-b',
      name: 'Arrived',
      availableOn: ['Netflix'],
      flaggedOn: ['netflix'],
      accessState: 'streaming',
      streamingSince: '2026-02-03T10:00:00.000Z',
    });
    render(<WaitingPage items={[waiting, streaming]} />);

    const rows = screen.getAllByTestId('waiting-row');
    expect(within(rows[0]!).getByTestId('waiting-name').textContent).toBe('Arrived');
    expect(within(rows[0]!).getByTestId('waiting-streaming-badge').textContent).toBe(
      WAITING_NOW_STREAMING_BADGE,
    );
    expect(within(rows[0]!).getByTestId('waiting-streaming-since').textContent).toContain(
      '2026-02-03',
    );
    expect(orderWaiting([waiting, streaming]).map((row) => row.intentId)).toEqual(['wi-b', 'wi-a']);
  });

  it('T-AVAIL-015e · the source line says (rent/buy) for a storefront and names a search add', () => {
    render(
      <WaitingPage
        items={[
          item({ intentId: 'wi-s', discoverySource: 'apple-tv-store' }),
          item({ intentId: 'wi-q', discoverySource: 'search' }),
        ]}
      />,
    );
    const lines = screen.getAllByTestId('waiting-discovery').map((el) => el.textContent);
    expect(lines).toContain('Seen on Apple TV (rent/buy) on 2026-01-04');
    expect(lines).toContain('Added by search on 2026-01-04');
  });
});

describe('T-WAIT-017 · #378 · rental storefronts are importable from /upload', () => {
  it('T-WAIT-017a · the storefronts sit behind a toggle, apart from the services', () => {
    render(<UploadPage />);

    expect(screen.queryByTestId('storefront-step')).toBeNull();
    fireEvent.click(screen.getByTestId('storefront-toggle'));

    const group = screen.getByTestId('storefront-step');
    expect(within(group).getAllByRole('radio')).toHaveLength(DISCOVERY_SOURCES.length);
    for (const source of DISCOVERY_SOURCES) {
      const label = screen.getByTestId(`storefront-option-${source}`).textContent ?? '';
      expect(label).toBe(DISCOVERY_SOURCE_LABELS[source]);
      expect(label).toContain('(rent/buy)');
    }
    // D-1: not one of them is in the services group.
    const services = within(screen.getByTestId('service-step')).getAllByRole('radio');
    expect(services.map((radio) => radio.getAttribute('value'))).not.toContain('fandango-at-home');
  });

  it('T-WAIT-017b · choosing a storefront answers the mode append-only and refuses full update', () => {
    const onSelectionChange = vi.fn();
    render(<UploadPage onSelectionChange={onSelectionChange} />);
    fireEvent.click(screen.getByTestId('storefront-toggle'));
    fireEvent.click(
      screen.getByTestId('storefront-option-prime-video-store').querySelector('input')!,
    );

    expect(onSelectionChange).toHaveBeenLastCalledWith({
      service: 'prime-video-store',
      mode: 'append-only',
    });
    expect(screen.getByTestId('service-step-panel-answer').textContent).toContain(
      'Prime Video (rent/buy)',
    );
    const fullUpdate = screen.getByTestId('mode-card-full-update').querySelector('input')!;
    expect(fullUpdate).toBeDisabled();
    expect(screen.getByTestId('mode-card-full-update-consequence').textContent).toContain(
      'always append-only',
    );
  });

  it('T-WAIT-017c · a ?source= preselect opens the storefronts with the answer already given', () => {
    render(<UploadPage initialService="fandango-at-home" />);

    expect(screen.getByTestId('storefront-step')).toBeTruthy();
    expect(screen.getByTestId('service-step-panel-answer').textContent).toContain(
      'Fandango at Home (rent/buy)',
    );
    expect(screen.getByTestId('mode-card-append-only').querySelector('input')).toBeChecked();
  });

  it('T-WAIT-017d · a storefront batch is labelled by its source, never "Discovery"', () => {
    expect(batchSourceLabel({ service: null, discoverySource: 'google-tv-store' })).toBe(
      'Google TV (rent/buy)',
    );
    expect(batchSourceLabel({ service: 'netflix', discoverySource: null })).toBe('Netflix');
    expect(batchSourceLabel({ service: null })).toContain('(rent/buy)');
  });
});

describe('T-WAIT-019 · #378 · search-to-add', () => {
  const dune: TmdbSearchResult = {
    tmdbId: 438631,
    mediaType: 'movie',
    name: 'Dune',
    releaseYear: 2021,
    posterPath: null,
  };

  it('T-WAIT-019a · a search result is waited for only by an explicit press', async () => {
    const onSearch = vi.fn(() => Promise.resolve([dune]));
    const onSearchAdd = vi.fn(() => Promise.resolve());
    render(<WaitingPage items={[]} onSearch={onSearch} onSearchAdd={onSearchAdd} />);

    fireEvent.change(screen.getByTestId('waiting-search-input'), { target: { value: 'dune' } });
    fireEvent.click(screen.getByTestId('waiting-search-submit'));
    await waitFor(() => expect(screen.getByTestId('waiting-search-results')).toBeTruthy());
    expect(onSearch).toHaveBeenCalledWith('dune');
    expect(onSearchAdd).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('waiting-search-add'));
    await waitFor(() =>
      expect(screen.getByTestId('waiting-search-outcome').textContent).toBe(
        `${WAITING_SEARCH_ADDED} Dune`,
      ),
    );
    expect(onSearchAdd).toHaveBeenCalledWith(dune);
  });

  it('T-WAIT-019b · every refusal names the fact that stopped it', () => {
    const duplicate = (reason: string) =>
      new ApiError('DUPLICATE_WORK_IDENTITY', 409, 'duplicate', { reason });
    expect(searchAddRefusal(duplicate('already-listed'))).toBe(WAITING_SEARCH_ALREADY_LISTED);
    expect(searchAddRefusal(duplicate('already-waiting'))).toBe(WAITING_SEARCH_ALREADY_WAITING);
    expect(searchAddRefusal(new ApiError('WORK_SUPPRESSED', 409, 'suppressed', {}))).toBe(
      WAITING_SEARCH_SUPPRESSED,
    );
    expect(searchAddRefusal(new Error('network'))).toBe(WAITING_SEARCH_FAILED);
  });

  it('T-WAIT-019c · a refused add is shown as an alert and the result stays', async () => {
    const onSearchAdd = vi.fn(() =>
      Promise.reject(
        new ApiError('DUPLICATE_WORK_IDENTITY', 409, 'dup', { reason: 'already-waiting' }),
      ),
    );
    render(
      <WaitingPage items={[]} onSearch={() => Promise.resolve([dune])} onSearchAdd={onSearchAdd} />,
    );
    fireEvent.change(screen.getByTestId('waiting-search-input'), { target: { value: 'dune' } });
    fireEvent.click(screen.getByTestId('waiting-search-submit'));
    await waitFor(() => expect(screen.getByTestId('waiting-search-add')).toBeTruthy());
    fireEvent.click(screen.getByTestId('waiting-search-add'));

    const outcome = await screen.findByTestId('waiting-search-outcome');
    expect(outcome.getAttribute('role')).toBe('alert');
    expect(outcome.textContent).toBe(WAITING_SEARCH_ALREADY_WAITING);
    expect(screen.getByTestId('waiting-search-result')).toBeTruthy();
  });

  it('T-WAIT-019d · without both handlers there is no search box', () => {
    render(<WaitingPage items={[]} />);
    expect(screen.queryByTestId('waiting-search')).toBeNull();
  });
});
