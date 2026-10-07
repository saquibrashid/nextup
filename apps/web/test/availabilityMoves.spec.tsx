/**
 * US-063 (#397/#410, PRD `A54`) — the availability marker and its one-tap
 * answers on the web: the compact chip a Library row carries, the details
 * panel's actions, and "Add to Library" on a waiting row.
 *
 * ⚠ Invariant 8a: every assertion on the sentence is about a FACT with its
 * as-of date. Nothing here may render a reminder, a count or a "you should".
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AvailabilityChip,
  AvailabilityNotice,
  AvailabilityPanel,
  availabilityMarkerText,
} from '../src/components/AvailabilityMarker';
import type { TitleAvailability } from '../src/components/TitleRow';
import {
  AVAILABILITY_ACTION_FAILED,
  AVAILABILITY_BADGE_ADDED,
  AVAILABILITY_BADGE_REMOVED,
  AVAILABILITY_KEPT,
  AVAILABILITY_MOVED_TO_WAITING,
  JUSTWATCH_ATTRIBUTION,
  WAITING_ADD_TO_LIBRARY,
  WAITING_ADD_TO_LIBRARY_FAILED,
} from '../src/copy';
import type { WaitingItem } from '../src/lib/apiClient';
import { WaitingPage } from '../src/pages/WaitingPage';
import { TitleDetailsPage } from '../src/pages/TitleDetailsPage';
import { TitleDetailsRoute } from '../src/containers/TitleDetailsRoute';
import { createApiClient, type TitleDetailResponse } from '../src/lib/apiClient';

const LEFT: TitleAvailability = {
  accessState: 'rent-only',
  checkedAt: '2026-09-20T10:00:00.000Z',
  region: 'US',
  streamingOn: [],
  rentOn: ['Apple TV', 'Amazon Video', 'Fandango at Home', 'Google Play'],
  left: ['starz'],
  joined: [],
  signature: 'left=starz;joined=',
  kept: false,
  canMoveToWaiting: true,
};

const JOINED: TitleAvailability = {
  ...LEFT,
  accessState: 'streaming',
  streamingOn: ['starz', 'netflix'],
  rentOn: [],
  left: [],
  joined: ['netflix'],
  signature: 'left=;joined=netflix',
  canMoveToWaiting: false,
};

const BADGES = [{ service: 'starz' as const, listingId: 'l-1', dateAdded: '2026-01-05' }];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function actions() {
  return {
    removeBadge: vi.fn().mockResolvedValue({}),
    moveToWaiting: vi.fn().mockResolvedValue({}),
    keepAvailability: vi.fn().mockResolvedValue({}),
    addBadge: vi.fn().mockResolvedValue({}),
  };
}

function panel(availability: TitleAvailability | null, offline = false) {
  const acts = actions();
  const onMoved = vi.fn();
  render(
    <MemoryRouter>
      <AvailabilityPanel
        titleId="t-1"
        name="The Housemaid"
        badges={BADGES}
        availability={availability}
        offline={offline}
        actions={acts}
        onMoved={onMoved}
      />
    </MemoryRouter>,
  );
  return { acts, onMoved };
}

describe('T-MOVE-010 — the marker sentence (US-063 AC-2, invariant 8a)', () => {
  it('T-MOVE-010a: a left-for-rent change names the service and at most three storefronts', () => {
    expect(availabilityMarkerText(LEFT)).toBe(
      'Left Starz — now rent-only on Apple TV, Amazon Video, Fandango at Home',
    );
  });

  it('T-MOVE-010b: not seen anywhere says so with its as-of date', () => {
    expect(availabilityMarkerText({ ...LEFT, accessState: 'not-seen', rentOn: [] })).toBe(
      'Not seen on Starz as of 20 Sep 2026',
    );
    expect(availabilityMarkerText({ ...LEFT, accessState: 'streaming', rentOn: [] })).toBe(
      'Left Starz',
    );
  });

  it('T-MOVE-010c: joined, both, kept and no-change cases', () => {
    expect(availabilityMarkerText(JOINED)).toBe('Now also on Netflix');
    expect(availabilityMarkerText({ ...JOINED, left: ['max'], accessState: 'streaming' })).toBe(
      'Left Max · Now also on Netflix',
    );
    expect(availabilityMarkerText({ ...LEFT, kept: true })).toBeNull();
    expect(availabilityMarkerText({ ...LEFT, signature: null })).toBeNull();
    expect(availabilityMarkerText(undefined)).toBeNull();
  });

  it('T-MOVE-010d: the compact chip renders the fact and nothing when there is none', () => {
    const { unmount } = render(<AvailabilityChip availability={LEFT} />);
    expect(screen.getByTestId('availability-chip')).toHaveTextContent('Left Starz');
    unmount();
    render(<AvailabilityChip availability={{ ...LEFT, kept: true }} />);
    expect(screen.queryByTestId('availability-chip')).toBeNull();
    expect(document.body.textContent).not.toMatch(/days ago|remind|should/i);
  });
});

describe('T-MOVE-011 — the details panel one-tap answers (US-063 AC-3..AC-7)', () => {
  it('T-MOVE-011a: remove badge, move to Waiting and keep each call exactly their endpoint', async () => {
    const { acts, onMoved } = panel(LEFT);
    expect(screen.getByTestId('availability-attribution')).toHaveTextContent(JUSTWATCH_ATTRIBUTION);
    await userEvent.click(screen.getByTestId('availability-remove-starz'));
    expect(acts.removeBadge).toHaveBeenCalledWith('l-1');
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(AVAILABILITY_BADGE_REMOVED));
    await userEvent.click(screen.getByTestId('availability-move-to-waiting'));
    expect(acts.moveToWaiting).toHaveBeenCalledWith('t-1');
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(AVAILABILITY_MOVED_TO_WAITING));
    await userEvent.click(screen.getByTestId('availability-keep'));
    expect(acts.keepAvailability).toHaveBeenCalledWith('t-1', 'left=starz;joined=');
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(AVAILABILITY_KEPT));
    expect(acts.addBadge).not.toHaveBeenCalled();
  });

  it('T-MOVE-011b: now also on offers Add badge and never Move to Waiting', async () => {
    const { acts, onMoved } = panel(JOINED);
    expect(screen.queryByTestId('availability-move-to-waiting')).toBeNull();
    await userEvent.click(screen.getByTestId('availability-add-netflix'));
    expect(acts.addBadge).toHaveBeenCalledWith('t-1', 'netflix');
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith(AVAILABILITY_BADGE_ADDED));
  });

  it('T-MOVE-011c: a failed move says nothing changed; offline disables every action', async () => {
    const { acts, onMoved } = panel(LEFT);
    acts.moveToWaiting.mockRejectedValueOnce(new Error('nope'));
    await userEvent.click(screen.getByTestId('availability-move-to-waiting'));
    expect(await screen.findByTestId('availability-error')).toHaveTextContent(
      AVAILABILITY_ACTION_FAILED,
    );
    expect(onMoved).not.toHaveBeenCalled();
    cleanup();
    panel(LEFT, true);
    for (const id of ['availability-remove-starz', 'availability-keep']) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
    cleanup();
    panel(null);
    expect(screen.queryByTestId('availability-panel')).toBeNull();
  });

  it('T-MOVE-011d: a removal notice links straight to the removed log and Waiting', () => {
    const { unmount } = render(
      <MemoryRouter>
        <AvailabilityNotice notice={AVAILABILITY_MOVED_TO_WAITING} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'View removal history' })).toHaveAttribute(
      'href',
      '/removed',
    );
    expect(screen.getByRole('link', { name: 'Open Waiting' })).toHaveAttribute('href', '/waiting');
    unmount();
    render(
      <MemoryRouter>
        <AvailabilityNotice notice={AVAILABILITY_KEPT} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('T-MOVE-011e: the details page shows the panel for an active title and reloads after a move', async () => {
    const client = createApiClient({
      fetchImpl: async () => {
        throw new Error('Unexpected API request');
      },
    });
    const remove = vi.spyOn(client, 'removeBadge').mockResolvedValue({
      listingId: 'l-1',
      titleId: 't-1',
      service: 'starz',
      titleState: 'removed',
      removedAt: '2026-09-29T00:00:00.000Z',
    });
    const reload = vi.fn();
    const item: TitleDetailResponse = {
      titleId: 't-1',
      workIdentity: 'tmdb:movie:1100',
      matchState: 'matched',
      name: 'The Housemaid',
      mediaType: 'movie',
      releaseYear: 2025,
      genres: ['Thriller'],
      runtimeMinutes: 131,
      posterPath: null,
      imdbRating: null,
      listState: 'active',
      badges: BADGES,
      sortDateAdded: '2026-01-05',
      dateAddedLabel: 'Added to nextup on 5 Jan 2026',
      availability: LEFT,
      presentation: {
        status: 'available',
        data: {
          tmdbId: 1100,
          mediaType: 'movie',
          overview: 'An invented overview.',
          directors: [],
          creators: [],
          fetchedAt: '2026-09-22T00:00:00.000Z',
          cast: [],
        },
      },
    };
    render(
      <MemoryRouter>
        <TitleDetailsPage
          item={item}
          backTo="/"
          offline={false}
          actions={client}
          onReload={reload}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('availability-fact')).toHaveTextContent('Left Starz');
    await userEvent.click(screen.getByTestId('availability-remove-starz'));
    expect(remove).toHaveBeenCalledWith('l-1');
    expect(await screen.findByTestId('availability-notice')).toHaveTextContent(
      AVAILABILITY_BADGE_REMOVED,
    );
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('T-MOVE-011f — the move confirmation survives the reload', () => {
  it('T-MOVE-011f: the route keeps the notice across the remount a move triggers', async () => {
    let moved = false;
    const detail = {
      titleId: 't-1',
      workIdentity: 'tmdb:movie:1100',
      matchState: 'matched',
      name: 'The Housemaid',
      mediaType: 'movie',
      releaseYear: 2025,
      genres: [],
      runtimeMinutes: null,
      posterPath: null,
      imdbRating: null,
      sortDateAdded: '2026-01-05',
      dateAddedLabel: null,
      presentation: {
        status: 'available',
        data: {
          tmdbId: 1100,
          mediaType: 'movie',
          overview: '',
          directors: [],
          creators: [],
          fetchedAt: '2026-09-22T00:00:00.000Z',
          cast: [],
        },
      },
    };
    const client = createApiClient({
      fetchImpl: async () =>
        new Response(
          JSON.stringify(
            moved
              ? { ...detail, listState: 'removed', badges: [] }
              : { ...detail, listState: 'active', badges: BADGES, availability: LEFT },
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });
    vi.spyOn(client, 'moveToWaiting').mockImplementation(async () => {
      moved = true;
      return { titleId: 't-1', intentId: 'i-1', removedListingIds: ['l-1'], removedAt: '' };
    });
    render(
      <MemoryRouter initialEntries={['/titles/t-1']}>
        <Routes>
          <Route path="/titles/:titleId" element={<TitleDetailsRoute client={client} />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByTestId('availability-move-to-waiting'));
    expect(await screen.findByTestId('availability-notice')).toHaveTextContent(
      AVAILABILITY_MOVED_TO_WAITING,
    );
    await waitFor(() => expect(screen.queryByTestId('availability-panel')).toBeNull());
    expect(screen.getByTestId('availability-notice')).toBeVisible();
  });
});

describe('T-MOVE-012 — Add to Library from Waiting (US-063 AC-4, AC-8)', () => {
  const waiting = (over: Partial<WaitingItem> = {}): WaitingItem => ({
    intentId: 'wi-1',
    titleId: 'title-1',
    workIdentity: 'tmdb:movie:1100',
    name: 'The Housemaid',
    releaseYear: 2025,
    posterPath: null,
    discoveredAt: '2026-01-04',
    discoverySource: 'search',
    availableOn: ['Netflix'],
    flaggedOn: ['netflix'],
    availabilityCheckedAt: '2026-09-20T00:00:00.000Z',
    availabilityRegion: 'US',
    ...over,
  });

  it('T-MOVE-012a: a now-streaming row offers Add to Library and leaves the list on success', async () => {
    const onPromote = vi.fn().mockResolvedValue({});
    render(
      <MemoryRouter>
        <WaitingPage items={[waiting()]} onPromote={onPromote} />
      </MemoryRouter>,
    );
    const button = screen.getByTestId('waiting-promote-netflix');
    expect(button).toHaveTextContent(WAITING_ADD_TO_LIBRARY);
    await userEvent.click(button);
    expect(onPromote).toHaveBeenCalledWith('wi-1', 'netflix');
    await waitFor(() => expect(screen.queryByTestId('waiting-promote-netflix')).toBeNull());
  });

  it('T-MOVE-012b: several services name themselves; a failure keeps the row and says so', async () => {
    const onPromote = vi.fn().mockRejectedValue(new Error('nope'));
    render(
      <MemoryRouter>
        <WaitingPage
          items={[waiting({ flaggedOn: ['netflix', 'starz', 'someone-else'] })]}
          onPromote={onPromote}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('waiting-promote-starz')).toHaveTextContent('(Starz)');
    await userEvent.click(screen.getByTestId('waiting-promote-netflix'));
    expect(await screen.findByTestId('waiting-promote-error')).toHaveTextContent(
      WAITING_ADD_TO_LIBRARY_FAILED,
    );
    expect(screen.getByTestId('waiting-promote-netflix')).toBeVisible();
  });

  it('T-MOVE-012c: no promote handler means no button; a moved row states where it came from', () => {
    render(
      <MemoryRouter>
        <WaitingPage items={[waiting({ movedFromLibraryAt: '2026-09-29T08:00:00.000Z' })]} />
      </MemoryRouter>,
    );
    expect(screen.queryByTestId('waiting-promote-netflix')).toBeNull();
    expect(screen.getByTestId('waiting-moved-from-library')).toHaveTextContent(
      'Moved from your Library on 29 Sep 2026.',
    );
  });
});
