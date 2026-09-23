import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TitleDetailsPage } from '../src/pages/TitleDetailsPage';
import { TitleDetailsRoute, detailsReturnTo } from '../src/containers/TitleDetailsRoute';
import { ListPage } from '../src/pages/ListPage';
import {
  ApiError,
  createApiClient,
  RefusedError,
  type TitleDetailResponse,
} from '../src/lib/apiClient';

const item: TitleDetailResponse = {
  titleId: 'title-one',
  workIdentity: 'tmdb:movie:42',
  matchState: 'matched',
  name: 'The Lighthouse Garden',
  mediaType: 'movie',
  releaseYear: 2024,
  genres: ['Drama'],
  runtimeMinutes: 112,
  posterPath: '/fixture.png',
  imdbRating: 7.8,
  listState: 'active',
  badges: [{ service: 'netflix', listingId: 'listing-one', dateAdded: '2026-09-01' }],
  sortDateAdded: '2026-09-01',
  dateAddedLabel: 'Added to nextup on 1 Sep 2026',
  presentation: {
    status: 'available',
    data: {
      tmdbId: 42,
      mediaType: 'movie',
      overview: 'An invented story about a garden.',
      directors: ['Morgan Example'],
      creators: [],
      fetchedAt: '2026-09-22T00:00:00.000Z',
      cast: Array.from({ length: 10 }, (_, i) => ({
        name: `Actor ${String(i)}`,
        character: `Character ${String(i)}`,
      })),
    },
  },
};
function client() {
  return createApiClient({
    fetchImpl: async () => {
      throw new Error('Unexpected API request');
    },
  });
}
function mount(overrides: Partial<TitleDetailResponse> = {}, offline = false) {
  const actions = client();
  const reload = vi.fn();
  render(
    <MemoryRouter>
      <TitleDetailsPage
        item={{ ...item, ...overrides }}
        backTo="/?sort=name&dir=asc"
        offline={offline}
        actions={actions}
        onReload={reload}
      />
    </MemoryRouter>,
  );
  return { actions, reload };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('T-CATEGORY-004 category editor', () => {
  it('T-CATEGORY-004a uses explicit save, restores Automatic, and Cancel writes nothing', async () => {
    const { actions, reload } = mount({
      category: 'comedy-show',
      automaticCategory: 'comedy-show',
    });
    const save = vi
      .spyOn(actions, 'updateTitleCategory')
      .mockResolvedValue({ titleId: item.titleId, categoryOverride: 'movie' });
    const trigger = screen.getByRole('button', { name: 'Title category' });
    await userEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Title category' });
    expect(within(dialog).getByRole('radio', { name: 'Automatic (Comedy Show)' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Movie', exact: true }));
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(save).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('radio', { name: 'Movie', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Save category' }));
    expect(save).toHaveBeenCalledWith(item.titleId, { categoryOverride: 'movie' });
    expect(reload).toHaveBeenCalledOnce();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: 'Save category' }));
    expect(save).toHaveBeenLastCalledWith(item.titleId, { categoryOverride: null });
  });
  it('T-CATEGORY-004b keeps the draft after errors and prevents duplicate pending saves', async () => {
    const { actions, reload } = mount({ categoryPending: true });
    const save = vi
      .spyOn(actions, 'updateTitleCategory')
      .mockRejectedValueOnce(new Error('failed'));
    await userEvent.click(screen.getByRole('button', { name: 'Title category' }));
    expect(screen.getByText(/Catalogue classification is not available/)).toBeVisible();
    await userEvent.click(screen.getByRole('radio', { name: 'Comedy Show', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Save category' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save the category');
    expect(screen.getByRole('radio', { name: 'Comedy Show', exact: true })).toBeChecked();
    expect(reload).not.toHaveBeenCalled();
    let complete: (() => void) | undefined;
    save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = () => resolve({ titleId: item.titleId, categoryOverride: 'comedy-show' });
        }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save category' }));
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeVisible();
    complete?.();
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });
  it('T-CATEGORY-004c disables offline edits and discloses incomplete filtered results with manual retry', async () => {
    mount({}, true);
    expect(screen.getByRole('button', { name: 'Title category' })).toBeDisabled();
    cleanup();
    const retry = vi.fn();
    render(
      <MemoryRouter>
        <ListPage items={[]} categoryPending={27} onRetry={retry} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Category classification is still pending for 27/)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Retry classification' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe('T-DETAIL-004 detail presentation and owner actions', () => {
  it('T-DETAIL-004a: shows hierarchy, saved badges, synopsis, movie directors and expandable character credits', async () => {
    mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(item.name);
    expect(screen.getByText('1h 52m')).toBeVisible();
    expect(screen.getByText('IMDb 7.8 / 10')).toBeVisible();
    expect(screen.getByText('Netflix')).toBeVisible();
    expect(screen.getByText('An invented story about a garden.')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Directors' })).toBeVisible();
    expect(screen.getByText('Morgan Example')).toBeVisible();
    expect(screen.queryByText('Actor 9')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show all 10 cast members' }));
    expect(screen.getByText('Actor 9')).toBeVisible();
    expect(screen.getByText('Character 9')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Show less cast' }));
    expect(screen.queryByText('Actor 9')).toBeNull();
  });
  it('T-DETAIL-004b: series label creators and episode runtime; missing fields never become fabricated values', () => {
    mount({
      mediaType: 'tv',
      runtimeMinutes: null,
      posterPath: null,
      imdbRating: null,
      releaseYear: null,
      genres: [],
      badges: [],
      dateAddedLabel: null,
      presentation: {
        status: 'available',
        data: {
          ...item.presentation!.data!,
          mediaType: 'tv',
          overview: null,
          cast: [],
          directors: [],
          creators: ['Series Creator'],
        },
      },
    });
    expect(screen.getByRole('heading', { name: 'Creators' })).toBeVisible();
    expect(screen.getByText('Series Creator')).toBeVisible();
    expect(screen.getByText('Runtime not available')).toBeVisible();
    expect(screen.getByText('IMDb rating not available')).toBeVisible();
    expect(screen.getByText('No synopsis available.')).toBeVisible();
    expect(screen.getByText('No cast information available.')).toBeVisible();
    expect(screen.getByText('No active saved services.')).toBeVisible();
  });
  it('T-DETAIL-004c: stale data stays readable with an explicit owner-triggered retry', async () => {
    const { reload } = mount({ presentation: { status: 'stale', data: item.presentation!.data } });
    expect(screen.getByRole('status')).toHaveTextContent('Showing cached synopsis');
    expect(screen.getByText('An invented story about a garden.')).toBeVisible();
    expect(reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry details' }));
    expect(reload).toHaveBeenCalledOnce();
  });
  it('T-DETAIL-004d: unidentified titles retain their identity and show a real Find a match action', async () => {
    mount({ matchState: 'unmatched', presentation: { status: 'unidentified', data: null } });
    expect(screen.getByText(/Unidentified title/)).toBeVisible();
    expect(screen.getByText('Netflix')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Synopsis' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Find a match' }));
    expect(screen.getByRole('dialog')).toBeVisible();
  });
  it.each(['Watch status', 'Fix match', 'Not interested', 'Remove from list'])(
    'T-DETAIL-004e: existing actions open their real confirmation dialog without immediate writes',
    async (name) => {
      const { actions } = mount();
      const remove = vi.spyOn(actions, 'removeTitle');
      const suppress = vi.spyOn(actions, 'suppressTitle');
      await userEvent.click(screen.getByRole('button', { name, exact: true }));
      expect(screen.getByRole('dialog')).toBeVisible();
      expect(remove).not.toHaveBeenCalled();
      expect(suppress).not.toHaveBeenCalled();
      await userEvent.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name, exact: true })).toHaveFocus();
    },
  );
  it('T-DETAIL-004f: preferences save through the existing API and refresh only after success', async () => {
    const { actions, reload } = mount();
    const save = vi.spyOn(actions, 'updateWatchPreferences').mockResolvedValue({
      titleId: item.titleId,
      watching: true,
      priority: 'normal',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Watch status' }));
    await userEvent.click(screen.getByRole('radio', { name: 'Watching' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save status' }));
    expect(save).toHaveBeenCalledWith(item.titleId, { watching: true, priority: 'normal' });
    expect(reload).toHaveBeenCalledOnce();
  });
  it('T-DETAIL-004g: offline disables actions and retries but not return navigation or readable metadata', () => {
    mount({ presentation: { status: 'unavailable', data: null } }, true);
    expect(screen.getByRole('button', { name: 'Remove from list' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry details' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Back to Your list' })).toHaveAttribute(
      'href',
      '/?sort=name&dir=asc',
    );
  });
  it.each(['removed', 'suppressed'] as const)(
    'T-DETAIL-004h: historical or suppressed titles stay readable without being restored',
    (listState) => {
      mount({ listState });
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(item.name);
      expect(screen.queryByRole('button', { name: 'Remove from list' })).toBeNull();
      expect(
        screen.getByRole('link', {
          name: listState === 'removed' ? 'View removal history' : 'Manage Not interested',
        }),
      ).toBeVisible();
    },
  );
  it('T-DETAIL-004i: failed artwork becomes an explicit placeholder', () => {
    const { container } = render(
      <MemoryRouter>
        <TitleDetailsPage
          item={item}
          backTo="/"
          actions={client()}
          onReload={vi.fn()}
          offline={false}
        />
      </MemoryRouter>,
    );
    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    expect(screen.getByText('No artwork available')).toBeVisible();
  });
});

describe('T-DETAIL-004 existing mutation outcomes', () => {
  it('T-DETAIL-004j: removal keeps the existing undo available and refreshes the detail after dismissal', async () => {
    const { actions, reload } = mount();
    const remove = vi.spyOn(actions, 'removeTitle').mockResolvedValue({
      titleId: item.titleId,
      removedListingIds: ['listing-one'],
    });
    const restore = vi.spyOn(actions, 'restoreListing').mockResolvedValue({
      restored: true,
      titleId: item.titleId,
      listingId: 'listing-one',
    });
    await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
    await userEvent.click(screen.getByTestId('confirm-remove-title'));
    await screen.findByTestId('remove-done');
    expect(remove).toHaveBeenCalledWith(item.titleId);
    expect(reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('undo-remove-title'));
    await screen.findByTestId('remove-undone');
    expect(restore).toHaveBeenCalledWith('listing-one');
    await userEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('T-DETAIL-004k: a failed write remains visible, never navigates away or claims success', async () => {
    const { actions, reload } = mount();
    vi.spyOn(actions, 'removeTitle').mockRejectedValue(new Error('Unavailable'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove from list' }));
    await userEvent.click(screen.getByTestId('confirm-remove-title'));
    expect(await screen.findByTestId('remove-failed')).toBeVisible();
    expect(screen.queryByTestId('remove-done')).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('T-DETAIL-004l: Fix match preserves confirmation and refreshes only after the saved outcome closes', async () => {
    const { actions, reload } = mount();
    vi.spyOn(actions, 'searchTmdb').mockResolvedValue({
      items: [
        {
          tmdbId: 99,
          mediaType: 'movie',
          name: 'The Correct Garden',
          releaseYear: 2023,
          posterPath: null,
        },
      ],
    });
    const fix = vi.spyOn(actions, 'fixMatch').mockResolvedValue({
      titleId: item.titleId,
      workIdentity: 'tmdb:movie:99',
      preserved: {
        listingIds: ['listing-one'],
        dateAdded: { 'listing-one': '2026-09-01' },
        sortDateAdded: '2026-09-01',
      },
      suppressionMigrated: null,
    });
    await userEvent.click(screen.getByRole('button', { name: 'Fix match', exact: true }));
    await userEvent.type(screen.getByTestId('tmdb-search-input'), 'Garden');
    await userEvent.click(await screen.findByTestId('select-result-99'));
    expect(fix).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('confirm-fix-match'));
    await screen.findByTestId('success-message');
    expect(fix).toHaveBeenCalledWith(item.titleId, {
      tmdbId: 99,
      mediaType: 'movie',
      confirmDuplicate: false,
    });
    expect(reload).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    expect(reload).toHaveBeenCalledOnce();
  });
});

describe('T-DETAIL-005 detail routing and failure boundaries', () => {
  function route(api = client()) {
    render(
      <MemoryRouter initialEntries={['/titles/title-one']}>
        <Routes>
          <Route path="/titles/:titleId" element={<TitleDetailsRoute client={api} />} />
        </Routes>
      </MemoryRouter>,
    );
    return api;
  }
  it('T-DETAIL-005a: library title links open details with the current query and no mutation', async () => {
    const api = client();
    const read = vi.spyOn(api, 'getTitle').mockResolvedValue(item);
    render(
      <MemoryRouter initialEntries={['/?service=netflix&sort=name&dir=asc']}>
        <Routes>
          <Route path="/" element={<ListPage items={[item]} />} />
          <Route path="/titles/:titleId" element={<TitleDetailsRoute client={api} />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('link', { name: item.name }));
    await screen.findByRole('heading', { name: item.name, level: 1 });
    expect(read).toHaveBeenCalledWith(item.titleId, expect.any(AbortSignal));
    expect(screen.getByRole('link', { name: 'Back to Your list' })).toHaveAttribute(
      'href',
      '/?service=netflix&sort=name&dir=asc',
    );
  });
  it('T-DETAIL-005b: failed reads have an explicit successful retry', async () => {
    const api = client();
    vi.spyOn(api, 'getTitle').mockRejectedValueOnce(new Error('offline')).mockResolvedValue(item);
    route(api);
    await screen.findByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: item.name })).toBeVisible();
  });
  it('T-DETAIL-005c: 404 is a missing title, not a provider outage or empty library', async () => {
    const api = client();
    vi.spyOn(api, 'getTitle').mockRejectedValue(
      new ApiError('NOT_FOUND', 404, 'No such title.', {}),
    );
    route(api);
    expect(await screen.findByText('This title is not available in your library.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
  it('T-DETAIL-005d: access refusal uses the existing refusal page', async () => {
    const api = client();
    vi.spyOn(api, 'getTitle').mockRejectedValue(new RefusedError('Not allowed'));
    route(api);
    await waitFor(() => expect(screen.queryByText('Loading title details...')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent(item.name);
  });
  it('T-DETAIL-005e: loading never masquerades as an empty title and direct entry retains a library destination', () => {
    const api = client();
    vi.spyOn(api, 'getTitle').mockReturnValue(new Promise(() => undefined));
    route(api);
    expect(within(screen.getByRole('status')).getByText('Loading title details...')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to Your list' })).toHaveAttribute('href', '/');
    expect(detailsReturnTo({ librarySearch: 'cursor=old&sort=name&dir=desc' })).toBe(
      '/?sort=name&dir=desc',
    );
    expect(detailsReturnTo({ librarySearch: 12 })).toBe('/');
    expect(detailsReturnTo(null)).toBe('/');
  });
});
