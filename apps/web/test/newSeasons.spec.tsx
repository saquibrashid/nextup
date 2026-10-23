/**
 * #454 — tracking a removed show for a new season (US-072, REQ-138, A64).
 *
 * ⚠ Announced seasons are OFFERED, never applied: nothing here moves a title
 * unless the owner taps, and the Library return is the ordinary promote path.
 */

import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { RemovedRoute } from '../src/containers/RemovedRoute';
import { WaitingRoute } from '../src/containers/WaitingRoute';
import type {
  ApiClient,
  NewSeasonOffer,
  RemovedItem,
  WaitingItem,
  WaitingResponse,
} from '../src/lib/apiClient';
import { RemovedPage } from '../src/pages/RemovedPage';
import { WaitingPage } from '../src/pages/WaitingPage';

function render(ui: ReactElement): ReturnType<typeof rtlRender> {
  return rtlRender(ui, { wrapper: MemoryRouter });
}

function item(over: Partial<WaitingItem> = {}): WaitingItem {
  return {
    intentId: 'wi-1',
    titleId: 'title-1',
    workIdentity: 'tmdb:tv:84773',
    name: 'The Rings of Power',
    releaseYear: 2022,
    posterPath: null,
    discoveredAt: '2026-09-01',
    discoverySource: 'search',
    availableOn: [],
    flaggedOn: [],
    accessState: 'not-seen',
    availabilityCheckedAt: '2026-09-20T00:00:00.000Z',
    availabilityRegion: 'US',
    forecast: null,
    ...over,
  };
}

function removed(over: Partial<RemovedItem> = {}): RemovedItem {
  return {
    listingId: 'lst_1',
    titleId: 'ttl_1',
    workIdentity: 'tmdb:tv:84773',
    matchState: 'matched',
    name: 'The Rings of Power',
    mediaType: 'tv',
    releaseYear: 2022,
    posterPath: null,
    service: 'prime-video',
    dateAdded: '2026-01-04',
    removedAt: '2026-03-11T09:30:00.000Z',
    removedByBatchId: null,
    removedByGroupId: null,
    removedBy: 'owner',
    removalOrdinal: 1,
    removalTotalForWork: 1,
    restorable: true,
    suppressed: false,
    ...over,
  };
}

const OFFER: NewSeasonOffer = {
  titleId: 'ttl_1',
  workIdentity: 'tmdb:tv:84773',
  name: 'The Rings of Power',
  posterPath: null,
  season: { number: 3, airsOn: '2027-02-01' },
};

describe('T-SEAS-060 · Waiting shows the new season', () => {
  it('T-SEAS-060a: a season not yet out says when it premieres', () => {
    render(
      <WaitingPage items={[item({ season: { number: 3, airsOn: '2027-02-01', out: false } })]} />,
    );
    expect(screen.getByTestId('waiting-season-text').textContent).toBe(
      'Season 3 premieres 1 Feb 2027.',
    );
    expect(screen.getByText('New season')).toBeTruthy();
  });

  it('T-SEAS-060b: a season that is out says so, and still waits for the owner', () => {
    render(
      <WaitingPage items={[item({ season: { number: 3, airsOn: '2027-02-01', out: true } })]} />,
    );
    expect(screen.getByTestId('waiting-season-text').textContent).toContain('Season 3 is out');
    expect(screen.getByText('Season out')).toBeTruthy();
  });

  it('T-SEAS-060c: once streaming on the owner’s service, the streaming panel leads and Add to Library shows', () => {
    render(
      <WaitingPage
        items={[
          item({
            flaggedOn: ['prime-video'],
            season: { number: 3, airsOn: '2027-02-01', out: true },
          }),
        ]}
        onPromote={() => Promise.resolve()}
      />,
    );
    expect(screen.queryByTestId('waiting-season')).toBeNull();
    expect(screen.getByTestId('waiting-streaming-badge')).toBeTruthy();
    expect(screen.getByTestId('waiting-promote-prime-video')).toBeTruthy();
  });
});

describe('T-SEAS-061 · offers are the owner’s call', () => {
  it('T-SEAS-061a: an offer names the show and date; Add to Waiting is an explicit tap', async () => {
    const onTrack = vi.fn(() => Promise.resolve());
    const onStop = vi.fn(() => Promise.resolve());
    render(<WaitingPage newSeasonOffers={[OFFER]} onTrackSeason={onTrack} onStopSeason={onStop} />);
    expect(screen.getByTestId('season-offer-date').textContent).toBe(
      'Season 3 premieres 1 Feb 2027.',
    );
    expect(onTrack).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('season-offer-add'));
    expect(onTrack).toHaveBeenCalledWith('ttl_1');
    await waitFor(() => expect(screen.queryByTestId('season-offers')).toBeNull());
  });

  it('T-SEAS-061b: Stop tracking dismisses the offer; a failure keeps it and says so', async () => {
    const onStop = vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(undefined);
    render(
      <WaitingPage
        newSeasonOffers={[OFFER]}
        onTrackSeason={() => Promise.resolve()}
        onStopSeason={onStop}
      />,
    );
    await userEvent.click(screen.getByTestId('season-offer-stop'));
    expect((await screen.findByTestId('season-offer-error')).getAttribute('role')).toBe('alert');
    expect(screen.getByTestId('season-offer')).toBeTruthy();
    await userEvent.click(screen.getByTestId('season-offer-stop'));
    await waitFor(() => expect(screen.queryByTestId('season-offers')).toBeNull());
  });

  it('T-SEAS-061c: no offers, or no handlers, renders no section', () => {
    const { unmount } = render(
      <WaitingPage newSeasonOffers={[]} onTrackSeason={vi.fn()} onStopSeason={vi.fn()} />,
    );
    expect(screen.queryByTestId('season-offers')).toBeNull();
    unmount();
    render(<WaitingPage newSeasonOffers={[OFFER]} />);
    expect(screen.queryByTestId('season-offers')).toBeNull();
  });
});

describe('T-SEAS-062 · WaitingRoute wires offers to the client', () => {
  it('T-SEAS-062a: Add to Waiting calls the tracking route then re-reads', async () => {
    const response: WaitingResponse = {
      items: [],
      count: 0,
      availabilityRefreshFailed: false,
      newSeasonOffers: [OFFER],
    };
    const client = {
      getWaiting: vi.fn(() => Promise.resolve(response)),
      startNewSeasonTracking: vi.fn(() => Promise.resolve({ titleId: 'ttl_1', status: 'waiting' })),
      stopNewSeasonTracking: vi.fn(() => Promise.resolve({ titleId: 'ttl_1', status: 'stopped' })),
    } as unknown as ApiClient;
    render(<WaitingRoute client={client} />);
    await userEvent.click(await screen.findByTestId('season-offer-add'));
    expect(client.startNewSeasonTracking).toHaveBeenCalledWith('ttl_1');
    await waitFor(() => expect(client.getWaiting).toHaveBeenCalledTimes(2));
    await userEvent.click(await screen.findByTestId('season-offer-stop'));
    expect(client.stopNewSeasonTracking).toHaveBeenCalledWith('ttl_1');
  });
});

describe('T-SEAS-063 · Removed view tracking control', () => {
  const ok = { titleId: 'ttl_1', status: 'tracking' as const, season: null };

  function page(
    over: Partial<RemovedItem>,
    onTrack = vi.fn(() => Promise.resolve(ok)),
    onStop = vi.fn(() => Promise.resolve({ titleId: 'ttl_1', status: 'stopped' })),
  ): { onTrack: typeof onTrack; onStop: typeof onStop } {
    render(
      <RemovedPage
        items={[removed(over)]}
        onRestore={() => Promise.reject(new Error('unused'))}
        onUnsuppress={() => Promise.resolve()}
        onTrackSeason={onTrack}
        onStopSeason={onStop}
      />,
    );
    return { onTrack, onStop };
  }

  it('T-SEAS-063a: only a TV show carries the control, and only when wired', () => {
    page({ mediaType: 'movie' });
    expect(screen.queryByTestId('removed-season')).toBeNull();
  });

  it('T-SEAS-063b: Track new seasons, then Stop tracking, are explicit taps', async () => {
    const { onTrack, onStop } = page({});
    await userEvent.click(screen.getByTestId('removed-season-track'));
    expect(onTrack).toHaveBeenCalledWith('ttl_1');
    expect(await screen.findByTestId('removed-season-tracking')).toBeTruthy();
    expect(screen.getByTestId('removed-season-note')).toBeTruthy();
    await userEvent.click(screen.getByTestId('removed-season-stop'));
    expect(onStop).toHaveBeenCalledWith('ttl_1');
    expect(await screen.findByTestId('removed-season-stopped')).toBeTruthy();
    expect(screen.getByTestId('removed-season-track')).toBeTruthy();
  });

  it('T-SEAS-063c: already tracking shows the tracking state', () => {
    page({ trackingNewSeason: true });
    expect(screen.getByTestId('removed-season-tracking')).toBeTruthy();
    expect(screen.queryByTestId('removed-season-note')).toBeNull();
  });

  it('T-SEAS-063d: an announced season at tracking time says it is now in Waiting', async () => {
    page(
      {},
      vi.fn(() => Promise.resolve({ titleId: 'ttl_1', status: 'waiting' as const })),
    );
    await userEvent.click(screen.getByTestId('removed-season-track'));
    expect((await screen.findByTestId('removed-season-waiting')).textContent).toContain(
      'now in Waiting to stream',
    );
  });

  it('T-SEAS-063e: a failed TMDB check is said plainly and tracking stays on', async () => {
    page(
      {},
      vi.fn(() => Promise.resolve({ ...ok, lookupFailed: true })),
    );
    await userEvent.click(screen.getByTestId('removed-season-track'));
    expect((await screen.findByTestId('removed-season-note')).textContent).toContain(
      'look again when you open Waiting',
    );
    expect(screen.getByTestId('removed-season-tracking')).toBeTruthy();
  });

  it('T-SEAS-063f: a failed request or stop changes nothing and offers a retry', async () => {
    const { onStop } = page(
      {},
      vi.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(ok),
      vi.fn().mockRejectedValueOnce(new Error('x')),
    );
    await userEvent.click(screen.getByTestId('removed-season-track'));
    expect(await screen.findByTestId('removed-season-error')).toBeTruthy();
    await userEvent.click(screen.getByTestId('removed-season-track'));
    await screen.findByTestId('removed-season-tracking');
    await userEvent.click(screen.getByTestId('removed-season-stop'));
    expect(await screen.findByTestId('removed-season-error')).toBeTruthy();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('T-SEAS-063g: RemovedRoute wires both handlers to the client', async () => {
    const client = {
      getRemoved: vi.fn(() =>
        Promise.resolve({ items: [removed({ trackingNewSeason: true })], nextCursor: null }),
      ),
      startNewSeasonTracking: vi.fn(() => Promise.resolve(ok)),
      stopNewSeasonTracking: vi.fn(() => Promise.resolve({ titleId: 'ttl_1', status: 'stopped' })),
    } as unknown as ApiClient;
    render(<RemovedRoute client={client} />);
    await userEvent.click(await screen.findByTestId('removed-season-stop'));
    expect(client.stopNewSeasonTracking).toHaveBeenCalledWith('ttl_1');
    await userEvent.click(await screen.findByTestId('removed-season-track'));
    expect(client.startNewSeasonTracking).toHaveBeenCalledWith('ttl_1');
  });
});
