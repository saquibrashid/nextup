/**
 * #391 — Waiting to stream in Grid and Compact, a details page for a waiting
 * title, and every detail TMDB has — trailer included — on both details
 * pages (`T-WAIT-023`, `T-WAIT-024`, `T-DETAIL-008`).
 *
 * ⚠ THE TRAILER IS A LINK OUT. These assertions pin that it opens YouTube in
 * a new tab with `noopener noreferrer` and that nothing is embedded: an
 * iframe would load third-party script and cookies into nextup.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WaitingDetailsRoute } from '../src/containers/WaitingDetailsRoute';
import { WAITING_LAYOUT_KEY, WaitingRoute } from '../src/containers/WaitingRoute';
import {
  createApiClient,
  type ApiClient,
  type TitleDetailResponse,
  type WaitingItem,
} from '../src/lib/apiClient';
import { TitleDetailsPage } from '../src/pages/TitleDetailsPage';
import { WaitingPage } from '../src/pages/WaitingPage';

const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const css = readFileSync(join(WEB_ROOT, 'src', 'index.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function waitingItem(over: Partial<WaitingItem> = {}): WaitingItem {
  return {
    intentId: 'wi-1',
    titleId: 'title-1',
    workIdentity: 'tmdb:movie:967941',
    name: 'Wicked: For Good',
    releaseYear: 2025,
    posterPath: '/w.jpg',
    discoveredAt: '2026-09-24',
    discoverySource: 'fandango-at-home',
    availableOn: [],
    flaggedOn: [],
    otherServicesOn: ['max'],
    otherProvidersOn: [],
    accessState: 'rent-only',
    rentOn: ['Apple TV Store', 'Amazon Video'],
    availabilityCheckedAt: '2026-09-24T00:00:00.000Z',
    availabilityRegion: 'US',
    forecast: { kind: 'estimate', service: 'peacock', month: '2026-10', yours: true },
    ...over,
  };
}

const trailer = {
  key: 'abcDEF12345',
  name: 'Official Trailer',
  kind: 'Trailer' as const,
  publishedAt: '2026-01-01T00:00:00.000Z',
};

const title: TitleDetailResponse = {
  titleId: 'title-1',
  workIdentity: 'tmdb:movie:967941',
  matchState: 'matched',
  name: 'Wicked: For Good',
  mediaType: 'movie',
  releaseYear: 2025,
  genres: ['Fantasy', 'Music'],
  runtimeMinutes: 137,
  posterPath: '/w.jpg',
  imdbRating: 6.9,
  listState: 'removed',
  badges: [],
  sortDateAdded: null,
  dateAddedLabel: null,
  presentation: {
    status: 'available',
    data: {
      tmdbId: 967941,
      mediaType: 'movie',
      overview: 'The story continues.',
      tagline: 'Everyone deserves a chance to fly.',
      directors: ['Jon M. Chu'],
      writers: ['Winnie Holzman', 'Dana Fox'],
      creators: [],
      cast: [{ name: 'Cynthia Erivo', character: 'Elphaba' }],
      releaseDate: '2025-11-21',
      status: 'Released',
      certification: 'PG',
      seasons: null,
      episodes: null,
      trailer,
      fetchedAt: '2026-09-22T00:00:00.000Z',
    },
  },
};

function client(): ApiClient {
  return createApiClient({
    fetchImpl: async () => {
      throw new Error('Unexpected API request');
    },
  });
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mountLibraryDetails(overrides: Partial<TitleDetailResponse> = {}): void {
  render(
    <MemoryRouter>
      <TitleDetailsPage
        item={{ ...title, listState: 'active', ...overrides }}
        backTo="/"
        offline={false}
        actions={client()}
        onReload={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe('T-DETAIL-008 · #391 · every available detail and the trailer on the Library details page', () => {
  it('T-DETAIL-008a · the trailer is a link out to YouTube in a new tab, never an embed', () => {
    mountLibraryDetails();
    const link = screen.getByRole('link', {
      name: 'Watch trailer for Wicked: For Good (opens YouTube in a new tab)',
    });
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcDEF12345');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(document.querySelector('iframe, video, object, embed')).toBeNull();
  });

  it('T-DETAIL-008b · with no trailer there is no trailer control at all; a teaser says teaser', () => {
    const data = title.presentation?.data;
    mountLibraryDetails({
      presentation: { status: 'available', data: data ? { ...data, trailer: null } : null },
    });
    expect(screen.queryByTestId('title-trailer')).toBeNull();
    expect(screen.queryByText(/trailer/i)).toBeNull();
    cleanup();
    mountLibraryDetails({
      presentation: {
        status: 'available',
        data: data ? { ...data, trailer: { ...trailer, kind: 'Teaser' } } : null,
      },
    });
    expect(screen.getByTestId('title-trailer')).toHaveTextContent('Watch teaser');
  });

  it('T-DETAIL-008c · a movie shows its tagline and a Details list of release, status, rating and writers', () => {
    mountLibraryDetails();
    expect(screen.getByTestId('title-tagline')).toHaveTextContent(
      'Everyone deserves a chance to fly.',
    );
    const facts = within(screen.getByTestId('title-facts'));
    expect(screen.getByRole('heading', { name: 'Details' })).toBeVisible();
    const pairs = [...screen.getByTestId('title-facts').querySelectorAll('dt')].map(
      (term) => `${term.textContent ?? ''}=${term.nextElementSibling?.textContent ?? ''}`,
    );
    expect(pairs).toEqual([
      'Released=21 Nov 2025',
      'Status=Released',
      'Rated=PG',
      'Writers=Winnie Holzman, Dana Fox',
    ]);
    expect(facts.queryByText('Seasons')).toBeNull();
  });

  it('T-DETAIL-008d · a series says First aired, Seasons and Episodes; a title with none hides the section', () => {
    const data = title.presentation?.data;
    if (!data) throw new Error('fixture');
    mountLibraryDetails({
      mediaType: 'tv',
      presentation: {
        status: 'available',
        data: {
          ...data,
          mediaType: 'tv',
          creators: ['Avery Example'],
          writers: [],
          releaseDate: '2024-05-02',
          status: 'Returning Series',
          certification: 'TV-MA',
          seasons: 3,
          episodes: 24,
        },
      },
    });
    const terms = [...screen.getByTestId('title-facts').querySelectorAll('dt')].map(
      (term) => term.textContent,
    );
    expect(terms).toEqual(['First aired', 'Status', 'Rated', 'Seasons', 'Episodes']);
    cleanup();
    mountLibraryDetails({
      presentation: {
        status: 'available',
        data: {
          tmdbId: 1,
          mediaType: 'movie',
          overview: null,
          cast: [],
          directors: [],
          creators: [],
          fetchedAt: '2026-09-22T00:00:00.000Z',
        },
      },
    });
    expect(screen.queryByTestId('title-facts')).toBeNull();
    expect(screen.queryByTestId('title-tagline')).toBeNull();
    expect(screen.queryByTestId('title-trailer')).toBeNull();
  });
});

describe('T-WAIT-023 · #391 · Grid and Compact on Waiting to stream, as in the Library', () => {
  it('T-WAIT-023a · the Library switch is here, Compact by default, and Grid switches the list', async () => {
    render(
      <MemoryRouter>
        <WaitingPage items={[waitingItem()]} />
      </MemoryRouter>,
    );
    const group = screen.getByRole('group', { name: 'List layout' });
    const compact = within(group).getByRole('button', { name: 'Compact view' });
    const grid = within(group).getByRole('button', { name: 'Grid view' });
    expect(compact).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('waiting-list')).toHaveAttribute('data-view', 'compact');
    await userEvent.click(grid);
    expect(grid).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('waiting-list')).toHaveAttribute('data-view', 'grid');
  });

  it('T-WAIT-023b · a grid tile keeps the answer and Not interested, and leaves the rest to the details page', () => {
    render(
      <MemoryRouter>
        <WaitingPage
          view="grid"
          items={[
            waitingItem(),
            waitingItem({
              intentId: 'wi-2',
              titleId: 'title-2',
              name: 'Arrived',
              accessState: 'streaming',
              availableOn: ['Netflix'],
              flaggedOn: ['netflix'],
              otherServicesOn: [],
              rentOn: [],
              forecast: null,
            }),
          ]}
        />
      </MemoryRouter>,
    );
    const [arrived, rent] = screen.getAllByTestId('waiting-row');
    // The answer stays: the flag and its import link, the forecast sentence,
    // the rent-only pill and the bounded "not streaming on your services".
    expect(within(arrived!).getByTestId('waiting-flag-link')).toHaveAttribute(
      'href',
      '/upload?service=netflix',
    );
    expect(within(rent!).getByTestId('waiting-forecast')).toHaveTextContent(/^Estimate:/);
    expect(within(rent!).getByTestId('waiting-rent-tag')).toBeVisible();
    expect(within(rent!).getByTestId('waiting-rent-note')).toHaveTextContent(
      /not streaming on your services/i,
    );
    for (const row of [arrived!, rent!]) {
      expect(within(row).getByTestId('waiting-not-interested')).toBeVisible();
    }
    // The detail goes to the details page.
    expect(screen.queryByTestId('waiting-rent-only')).toBeNull();
    expect(screen.queryByTestId('waiting-other-services')).toBeNull();
    expect(screen.queryByTestId('waiting-discovery')).toBeNull();
  });

  it('T-WAIT-023c · the choice is remembered for this page alone, apart from the Library', async () => {
    const api = client();
    vi.spyOn(api, 'getWaiting').mockResolvedValue({
      items: [waitingItem()],
      count: 1,
      availabilityRefreshFailed: false,
    });
    localStorage.setItem('nextup.library.layout.v1', 'grid');
    const first = render(
      <MemoryRouter>
        <WaitingRoute client={api} />
      </MemoryRouter>,
    );
    await screen.findByTestId('waiting-list');
    // The Library's Grid does not leak in.
    expect(screen.getByTestId('waiting-list')).toHaveAttribute('data-view', 'compact');
    await userEvent.click(screen.getByRole('button', { name: 'Grid view' }));
    expect(localStorage.getItem(WAITING_LAYOUT_KEY)).toBe('grid');
    first.unmount();
    render(
      <MemoryRouter>
        <WaitingRoute client={api} />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('waiting-list')).toHaveAttribute('data-view', 'grid');
    expect(localStorage.getItem('nextup.library.layout.v1')).toBe('grid');
  });

  it('T-WAIT-023d · the stylesheet lays Grid out as wrapping tiles, two across even on a phone', () => {
    expect(css).toMatch(
      /\.waiting-list\[data-view='grid'\]\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(min\(100%,\s*8rem\),\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /\.waiting-list\[data-view='grid'\] \.waiting-row\s*\{[^}]*'poster'\s*'body'\s*'aside'/,
    );
    expect(css).toMatch(/\.waiting-toolbar\s*\{[^}]*justify-content:\s*flex-end/);
  });
});

function mountDetails(api: ApiClient, path = '/waiting/title-1'): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/waiting/:titleId" element={<WaitingDetailsRoute client={api} />} />
        <Route path="/waiting" element={<p>Waiting list</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

function detailsClient(items: WaitingItem[] = [waitingItem()]): {
  api: ApiClient;
  getWaiting: ReturnType<typeof vi.fn>;
  getTitle: ReturnType<typeof vi.fn>;
} {
  const api = client();
  const getWaiting = vi
    .spyOn(api, 'getWaiting')
    .mockResolvedValue({ items, count: items.length, availabilityRefreshFailed: false });
  const getTitle = vi.spyOn(api, 'getTitle').mockResolvedValue(title);
  return { api, getWaiting, getTitle } as never;
}

describe('T-WAIT-024 · #391 · a details page for a waiting title', () => {
  it('T-WAIT-024a · the title on a card links to its details page, in both views', () => {
    for (const view of ['compact', 'grid'] as const) {
      render(
        <MemoryRouter>
          <WaitingPage view={view} items={[waitingItem()]} />
        </MemoryRouter>,
      );
      const link = within(screen.getByTestId('waiting-name')).getByRole('link', {
        name: 'Wicked: For Good',
      });
      expect(link).toHaveAttribute('href', '/waiting/title-1');
      cleanup();
    }
  });

  it('T-WAIT-024b · it shows every detail the Library page does, plus the waiting answer and both attributions', async () => {
    const { api, getWaiting, getTitle } = detailsClient();
    mountDetails(api);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Wicked: For Good' }),
    ).toBeVisible();
    expect(getWaiting).toHaveBeenCalledOnce();
    expect(getTitle).toHaveBeenCalledWith('title-1', expect.anything());
    // Library's facts.
    expect(screen.getByText('Movie · 2025')).toBeVisible();
    expect(screen.getByText('2h 17m')).toBeVisible();
    expect(screen.getByText('Fantasy · Music')).toBeVisible();
    expect(screen.getByText('IMDb 6.9 / 10')).toBeVisible();
    expect(screen.getByText('The story continues.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Directors' })).toBeVisible();
    expect(screen.getByText('Jon M. Chu')).toBeVisible();
    expect(screen.getByText('Cynthia Erivo')).toBeVisible();
    expect(screen.getByTestId('title-facts')).toHaveTextContent('Rated');
    expect(screen.getByTestId('title-trailer')).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=abcDEF12345',
    );
    // The waiting answer, in full.
    const access = within(screen.getByRole('region', { name: 'Where to watch' }));
    expect(access.getByTestId('waiting-rent-tag')).toHaveTextContent('Rent or buy only');
    expect(access.getByTestId('waiting-forecast')).toHaveTextContent(/^Estimate:/);
    expect(access.getAllByTestId('waiting-rent-store')).toHaveLength(2);
    expect(access.getByTestId('waiting-other-services')).toBeVisible();
    expect(access.getByTestId('waiting-discovery')).toHaveTextContent('24 Sep 2026');
    expect(screen.getByTestId('justwatch-attribution')).toBeVisible();
    expect(screen.getByTestId('watchmode-attribution')).toBeVisible();
    // Never the Library's saved-title actions: this is not a library row.
    expect(screen.queryByRole('button', { name: 'Remove from library' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to Waiting to stream' })).toHaveAttribute(
      'href',
      '/waiting',
    );
  });

  it('T-WAIT-024c · Not interested suppresses the work and returns to the list; a failure says so and retries', async () => {
    const { api } = detailsClient();
    const suppress = vi
      .spyOn(api, 'suppressTitle')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({} as never);
    mountDetails(api);
    const button = await screen.findByRole('button', {
      name: 'Not interested: Wicked: For Good',
    });
    await userEvent.click(button);
    expect(await screen.findByTestId('waiting-suppress-error')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Not interested: Wicked: For Good' }));
    expect(await screen.findByText('Waiting list')).toBeVisible();
    expect(suppress).toHaveBeenCalledTimes(2);
    expect(suppress).toHaveBeenLastCalledWith('title-1');
  });

  it('T-WAIT-024d · a title no longer waiting says so, and a failed read offers a retry', async () => {
    const { api } = detailsClient([waitingItem({ titleId: 'someone-else' })]);
    mountDetails(api);
    expect(await screen.findByTestId('waiting-details-missing')).toHaveTextContent(
      'This title is not on your waiting list.',
    );
    cleanup();
    const failing = client();
    const read = vi.spyOn(failing, 'getWaiting').mockRejectedValue(new Error('down'));
    vi.spyOn(failing, 'getTitle').mockResolvedValue(title);
    mountDetails(failing);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load this title.');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });
});
