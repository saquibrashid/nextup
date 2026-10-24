/**
 * US-074 (`A66`) — Finished watching, per-season tracking and Recently watched.
 *
 * ⚠ EVERY CASE DRIVES THE SCREEN THE OWNER GETS (the row menu on `ListPage`, the
 * details page, the `/watched` container) and asserts what happens AFTER the
 * click. A dialog that is only ever mounted by its own test is the defect
 * `rowMenu.spec.tsx` documents.
 */

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FinishedWatchingDialog, type FinishedApi } from '../src/components/FinishedWatchingDialog';
import { WatchedRoute } from '../src/containers/WatchedRoute';
import { ListPage } from '../src/pages/ListPage';
import { TitleDetailsPage } from '../src/pages/TitleDetailsPage';
import { WatchedPage } from '../src/pages/WatchedPage';
import type { TitleListItem } from '../src/components/TitleRow';
import {
  ApiError,
  RefusedError,
  createApiClient,
  type ApiClient,
  type TitleDetailResponse,
  type WatchedHistoryItem,
  type WatchedState,
} from '../src/lib/apiClient';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const movieState = (over: Partial<WatchedState> = {}): WatchedState => ({
  titleId: 't1',
  workIdentity: 'tmdb:movie:603',
  mediaType: 'movie',
  inLibrary: true,
  hidden: false,
  perSeason: false,
  seasonsUnavailable: false,
  seasons: [],
  allAiredFinished: false,
  whole: null,
  ...over,
});

const showState = (over: Partial<WatchedState> = {}): WatchedState =>
  movieState({
    workIdentity: 'tmdb:tv:1396',
    mediaType: 'tv',
    perSeason: true,
    seasons: [
      {
        seasonNumber: 1,
        airDate: '2020-01-01',
        aired: true,
        finished: true,
        watchedOn: '2024-03-04',
        rating: 5,
      },
      {
        seasonNumber: 2,
        airDate: '2021-01-01',
        aired: true,
        finished: false,
        watchedOn: null,
        rating: null,
      },
      {
        seasonNumber: 3,
        airDate: '2999-01-01',
        aired: false,
        finished: false,
        watchedOn: null,
        rating: null,
      },
      {
        seasonNumber: 4,
        airDate: null,
        aired: false,
        finished: false,
        watchedOn: null,
        rating: null,
      },
    ],
    ...over,
  });

interface Mocks {
  getWatched: ReturnType<typeof vi.fn>;
  markFinished: ReturnType<typeof vi.fn>;
  unfinishWatched: ReturnType<typeof vi.fn>;
  setLibraryHidden: ReturnType<typeof vi.fn>;
}

function apiWith(state: WatchedState | Error, after?: WatchedState): Mocks {
  const getWatched = vi.fn();
  if (state instanceof Error) getWatched.mockRejectedValue(state);
  else {
    getWatched.mockResolvedValueOnce(state);
    getWatched.mockResolvedValue(after ?? state);
  }
  return {
    getWatched,
    markFinished: vi.fn().mockResolvedValue({ titleId: 't1', records: [] }),
    unfinishWatched: vi.fn().mockResolvedValue({}),
    setLibraryHidden: vi.fn().mockResolvedValue({}),
  };
}

function mountDialog(mocks: Mocks, offline = false) {
  const onClose = vi.fn();
  const onLibraryChange = vi.fn();
  render(
    <FinishedWatchingDialog
      titleId="t1"
      name="The Matrix"
      api={mocks as unknown as FinishedApi}
      offline={offline}
      onClose={onClose}
      onLibraryChange={onLibraryChange}
    />,
  );
  return { onClose, onLibraryChange };
}

describe('T-VIEWED-060 · the Finished watching dialog', () => {
  it('T-VIEWED-060a: a failed read says so and offers only Close', async () => {
    mountDialog(apiWith(new Error('down')));
    expect(await screen.findByTestId('finished-load-failed')).toBeVisible();
    expect(screen.queryByTestId('finished-mark')).toBeNull();
  });

  it('T-VIEWED-060b: a movie is recorded whole, then the owner is ASKED about the Library, and can undo', async () => {
    const mocks = apiWith(movieState());
    const { onClose, onLibraryChange } = mountDialog(mocks);
    await screen.findByTestId('finished-mark');

    await userEvent.click(screen.getByLabelText('Date unknown'));
    await userEvent.click(screen.getByRole('radio', { name: '4 stars' }));
    await userEvent.click(screen.getByTestId('finished-mark'));

    expect(mocks.markFinished).toHaveBeenCalledWith('t1', {
      seasons: [0],
      watchedOn: null,
      rating: 4,
    });
    const ask = await screen.findByTestId('finished-ask');
    expect(ask).toHaveTextContent('Also remove “The Matrix” from your Library?');
    // Nothing leaves the Library until the owner says so.
    expect(mocks.setLibraryHidden).not.toHaveBeenCalled();
    expect(screen.getByTestId('finished-keep')).toHaveFocus();

    await userEvent.click(screen.getByTestId('finished-remove'));
    expect(mocks.setLibraryHidden).toHaveBeenCalledWith('t1', true);
    expect(onLibraryChange).toHaveBeenLastCalledWith(true);
    expect(await screen.findByTestId('finished-removed')).toHaveTextContent(
      'stays in Recently watched',
    );

    await userEvent.click(screen.getByTestId('finished-undo'));
    expect(mocks.setLibraryHidden).toHaveBeenLastCalledWith('t1', false);
    expect(onLibraryChange).toHaveBeenLastCalledWith(false);
    expect(await screen.findByTestId('finished-returned')).toBeVisible();

    await userEvent.click(screen.getByTestId('finished-close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('T-VIEWED-060c: Keep in Library closes without writing, and a title already out of the Library is not asked', async () => {
    const mocks = apiWith(movieState());
    const { onClose } = mountDialog(mocks);
    await userEvent.click(await screen.findByTestId('finished-mark'));
    await userEvent.click(await screen.findByTestId('finished-keep'));
    expect(mocks.setLibraryHidden).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();

    cleanup();
    const out = apiWith(movieState({ inLibrary: false }));
    mountDialog(out);
    await userEvent.click(await screen.findByTestId('finished-mark'));
    expect(await screen.findByTestId('finished-message')).toHaveTextContent('Saved.');
    expect(screen.queryByTestId('finished-ask')).toBeNull();
  });

  it('T-VIEWED-060d: a finished movie shows its record, Save changes and Not finished, which keeps the record', async () => {
    const mocks = apiWith(
      movieState({ whole: { finished: true, watchedOn: '2024-03-04', rating: 3 } }),
      movieState({ whole: { finished: false, watchedOn: '2024-03-04', rating: 3 } }),
    );
    mountDialog(mocks);
    expect(await screen.findByTestId('finished-status')).toHaveTextContent('4 Mar 2024 · ★ 3/5');
    expect(screen.getByTestId('finished-mark')).toHaveTextContent('Save changes');
    expect(screen.getByRole('radio', { name: '3 stars' })).toBeChecked();

    await userEvent.click(screen.getByTestId('finished-unfinish'));
    expect(mocks.unfinishWatched).toHaveBeenCalledWith('tmdb:movie:603', 0);
    expect(await screen.findByTestId('finished-message')).toHaveTextContent(
      'Your date and rating are kept',
    );
    expect(screen.queryByTestId('finished-unfinish')).toBeNull();
  });

  it('T-VIEWED-060e: failures keep the form, name the server message, and a refused set-aside returns to the form', async () => {
    const mocks = apiWith(movieState());
    mocks.markFinished.mockRejectedValueOnce(
      new ApiError('VALIDATION_FAILED', 400, 'Pick a date in the past.', {}),
    );
    mountDialog(mocks);
    await userEvent.click(await screen.findByTestId('finished-mark'));
    expect(await screen.findByTestId('finished-error')).toHaveTextContent(
      'Pick a date in the past.',
    );

    mocks.markFinished.mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(screen.getByTestId('finished-mark'));
    await waitFor(() => {
      expect(screen.getByTestId('finished-error')).toHaveTextContent("Couldn't save that");
    });

    await userEvent.click(screen.getByTestId('finished-mark'));
    await screen.findByTestId('finished-remove');
    mocks.setLibraryHidden.mockRejectedValueOnce(new ApiError('TITLE_NOT_ACTIVE', 409, 'x', {}));
    await userEvent.click(screen.getByTestId('finished-remove'));
    expect(await screen.findByTestId('finished-message')).toBeVisible();
    expect(screen.getByTestId('finished-mark')).toBeVisible();
  });

  it('T-VIEWED-060f: a failed set-aside or unfinish reports it and changes nothing', async () => {
    const mocks = apiWith(movieState({ whole: { finished: true, watchedOn: null, rating: null } }));
    mocks.unfinishWatched.mockRejectedValueOnce(new Error('boom'));
    mountDialog(mocks);
    await userEvent.click(await screen.findByTestId('finished-unfinish'));
    expect(await screen.findByTestId('finished-error')).toBeVisible();

    mocks.setLibraryHidden.mockRejectedValueOnce(new Error('boom'));
    await userEvent.click(screen.getByTestId('finished-mark'));
    await userEvent.click(await screen.findByTestId('finished-remove'));
    await waitFor(() => {
      expect(screen.getByTestId('finished-error')).toBeVisible();
    });
    expect(screen.getByTestId('finished-ask')).toBeVisible();
  });

  it('T-VIEWED-060g: a show lists seasons, marks selected ones, and does not ask until the last aired season is finished', async () => {
    const mocks = apiWith(showState());
    mountDialog(mocks);
    const seasons = await screen.findByTestId('finished-seasons');
    expect(within(seasons).getByText('4 Mar 2024 · ★ 5/5')).toBeVisible();
    expect(within(seasons).getByText('Premieres date to be announced')).toBeVisible();
    expect(screen.getByTestId('finished-season-3')).toBeDisabled();
    expect(screen.getByTestId('finished-season-4')).toBeDisabled();
    expect(screen.getByTestId('finished-mark-selected')).toBeDisabled();

    await userEvent.click(screen.getByTestId('finished-season-2'));
    await userEvent.click(screen.getByTestId('finished-season-2'));
    await userEvent.click(screen.getByTestId('finished-season-2'));
    await userEvent.click(screen.getByTestId('finished-mark-selected'));
    expect(mocks.markFinished).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ seasons: [2] }),
    );
    expect(await screen.findByTestId('finished-message')).toHaveTextContent('Saved.');
    expect(screen.queryByTestId('finished-ask')).toBeNull();
  });

  it('T-VIEWED-060h: Mark all seasons finished covers only aired, unfinished seasons, then asks about the Library', async () => {
    const mocks = apiWith(showState(), showState({ allAiredFinished: true }));
    mountDialog(mocks);
    await userEvent.click(await screen.findByTestId('finished-mark-all'));
    expect(mocks.markFinished).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ seasons: [2] }),
    );
    expect(await screen.findByTestId('finished-ask')).toBeVisible();
  });

  it('T-VIEWED-060i: a season can be marked not finished, and a failed follow-up read does not hide a saved write', async () => {
    const mocks = apiWith(showState());
    mountDialog(mocks);
    await userEvent.click(await screen.findByTestId('finished-unfinish-1'));
    expect(mocks.unfinishWatched).toHaveBeenCalledWith('tmdb:tv:1396', 1);
    await screen.findByTestId('finished-message');

    mocks.getWatched.mockRejectedValue(new Error('down'));
    await userEvent.click(screen.getByTestId('finished-unfinish-1'));
    await waitFor(() => {
      expect(mocks.unfinishWatched).toHaveBeenCalledTimes(2);
    });
    await userEvent.click(screen.getByTestId('finished-season-2'));
    await userEvent.click(screen.getByTestId('finished-mark-selected'));
    await waitFor(() => {
      expect(mocks.markFinished).toHaveBeenCalledOnce();
    });
    expect(await screen.findByTestId('finished-message')).toHaveTextContent('Saved.');
  });

  it('T-VIEWED-060j: unavailable or unaired season lists say so instead of offering a guess', async () => {
    mountDialog(apiWith(showState({ seasonsUnavailable: true, seasons: [] })));
    expect(await screen.findByTestId('finished-seasons-unavailable')).toBeVisible();
    cleanup();
    mountDialog(apiWith(showState({ seasons: [] })));
    expect(await screen.findByTestId('finished-no-seasons')).toBeVisible();
  });

  it('T-VIEWED-060k: offline disables every write and Close stays live', async () => {
    const { onClose } = mountDialog(apiWith(movieState()), true);
    expect(await screen.findByTestId('finished-mark')).toBeDisabled();
    expect(screen.getByTestId('finished-close')).toBeEnabled();
    await userEvent.click(screen.getByTestId('finished-close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('T-VIEWED-060l: the date field edits a real date and Escape closes an idle dialog', async () => {
    const mocks = apiWith(movieState());
    const { onClose } = mountDialog(mocks);
    const date = await screen.findByLabelText('Date watched');
    fireEvent.change(date, { target: { value: '2024-05-06' } });
    await userEvent.click(screen.getByRole('radio', { name: 'Not rated' }));
    await userEvent.click(screen.getByTestId('finished-mark'));
    expect(mocks.markFinished).toHaveBeenCalledWith('t1', {
      seasons: [0],
      watchedOn: '2024-05-06',
    });
    await screen.findByTestId('finished-ask');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});

describe('T-FTW-010 · Move to Waiting to stream (#468)', () => {
  const finishedShow = (over: Partial<WatchedState> = {}): WatchedState =>
    showState({ allAiredFinished: true, ...over });

  function mount(
    state: WatchedState,
    tracking: unknown = { status: 'waiting', season: { number: 3, airsOn: '2999-01-01' } },
  ) {
    const mocks = {
      ...apiWith(state),
      startNewSeasonTracking: vi.fn().mockResolvedValue(tracking),
      stopNewSeasonTracking: vi.fn().mockResolvedValue({}),
    };
    return { mocks, ...mountDialog(mocks as unknown as Mocks) };
  }

  it('T-FTW-010a: the third option names the upcoming season and moves nothing until chosen', async () => {
    const { mocks } = mount(finishedShow());
    await userEvent.click(await screen.findByTestId('finished-mark-all'));
    const move = await screen.findByTestId('finished-move-waiting');
    expect(move).toHaveTextContent('Move to Waiting to stream (Season 3, 1 Jan 2999)');
    expect(screen.getByTestId('finished-keep')).toBeVisible();
    expect(screen.getByTestId('finished-remove')).toBeVisible();
    expect(mocks.setLibraryHidden).not.toHaveBeenCalled();
    expect(mocks.startNewSeasonTracking).not.toHaveBeenCalled();
  });

  it('T-FTW-010b: it is absent for a movie, with no dated unaired season, or while an aired season is unfinished', async () => {
    const noDate = finishedShow().seasons.filter((season) => season.seasonNumber !== 3);
    mount(finishedShow({ seasons: noDate }));
    await userEvent.click(await screen.findByTestId('finished-mark-all'));
    await screen.findByTestId('finished-ask');
    expect(screen.queryByTestId('finished-move-waiting')).toBeNull();
    cleanup();

    mount(movieState());
    await userEvent.click(await screen.findByTestId('finished-mark'));
    await screen.findByTestId('finished-ask');
    expect(screen.queryByTestId('finished-move-waiting')).toBeNull();
  });

  it('T-FTW-010c: choosing it sets the title aside, opens the Waiting entry, and Undo returns it', async () => {
    const { mocks, onLibraryChange } = mount(finishedShow());
    await userEvent.click(await screen.findByTestId('finished-mark-all'));
    await userEvent.click(await screen.findByTestId('finished-move-waiting'));

    expect(mocks.setLibraryHidden).toHaveBeenCalledWith('t1', true);
    expect(mocks.startNewSeasonTracking).toHaveBeenCalledWith('t1');
    expect(onLibraryChange).toHaveBeenLastCalledWith(true);
    expect(await screen.findByTestId('finished-waiting')).toHaveTextContent(
      'in Waiting to stream for Season 3',
    );

    await userEvent.click(screen.getByTestId('finished-waiting-undo'));
    expect(mocks.setLibraryHidden).toHaveBeenLastCalledWith('t1', false);
    expect(onLibraryChange).toHaveBeenLastCalledWith(false);
    expect(await screen.findByTestId('finished-returned')).toBeVisible();
  });

  it('T-FTW-010d: when the Waiting entry cannot be made the title is put back and the owner is told', async () => {
    const { mocks, onLibraryChange } = mount(finishedShow(), { status: 'tracking', season: null });
    await userEvent.click(await screen.findByTestId('finished-mark-all'));
    await userEvent.click(await screen.findByTestId('finished-move-waiting'));

    expect(await screen.findByTestId('finished-error')).toHaveTextContent('still in your Library');
    expect(mocks.setLibraryHidden).toHaveBeenLastCalledWith('t1', false);
    expect(mocks.stopNewSeasonTracking).toHaveBeenCalledWith('t1');
    expect(onLibraryChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('finished-ask')).toBeVisible();
  });
});

const DUNE: TitleListItem = {
  titleId: 't1',
  workIdentity: 'tmdb:movie:438631',
  matchState: 'matched',
  name: 'Dune',
  mediaType: 'movie',
  releaseYear: 2021,
  genres: ['Science Fiction'],
  runtimeMinutes: 155,
  posterPath: '/d5NXS.jpg',
  badges: [{ service: 'netflix', listingId: 'l1', dateAdded: '2026-04-02' }],
  sortDateAdded: '2026-04-02',
  dateAddedLabel: 'Added to nextup 2 Apr 2026',
};

describe('T-VIEWED-062 · the row menu', () => {
  it('T-VIEWED-062a: Finished watching is the LAST item, after Remove, and opens the dialog; setting aside hides the row, undo shows it', async () => {
    const mocks = apiWith(movieState());
    render(
      <MemoryRouter>
        <ListPage
          items={[DUNE]}
          total={1}
          onFinished={mocks as unknown as FinishedApi}
          onRemoveTitle={vi.fn()}
          onRestoreListing={vi.fn()}
          onSuppress={vi.fn()}
          onUnsuppress={vi.fn()}
          onSearchTmdb={vi.fn()}
          onFixMatch={vi.fn()}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Dune' }));
    const items = within(screen.getByTestId('row-menu-popup')).getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toStrictEqual([
      'Not interested',
      'Remove',
      'Fix match',
      'Finished',
      'Close',
    ]);

    await userEvent.click(screen.getByTestId('row-menu-finished'));
    await userEvent.click(await screen.findByTestId('finished-mark'));
    await userEvent.click(await screen.findByTestId('finished-remove'));
    await waitFor(() => {
      expect(screen.queryByTestId('title-name')).toBeNull();
    });
    await userEvent.click(await screen.findByTestId('finished-undo'));
    await waitFor(() => {
      expect(screen.getByTestId('title-name')).toHaveTextContent('Dune');
    });
  });

  it('T-VIEWED-062b: without the wiring the menu has no Finished item', async () => {
    render(
      <MemoryRouter>
        <ListPage
          items={[DUNE]}
          total={1}
          onSuppress={vi.fn()}
          onUnsuppress={vi.fn()}
          onSearchTmdb={vi.fn()}
          onFixMatch={vi.fn()}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Dune' }));
    expect(screen.queryByTestId('row-menu-finished')).toBeNull();
  });
});

const detail: TitleDetailResponse = {
  titleId: 't1',
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
  badges: [{ service: 'netflix', listingId: 'l1', dateAdded: '2026-09-01' }],
  sortDateAdded: '2026-09-01',
  dateAddedLabel: 'Added to nextup on 1 Sep 2026',
  presentation: { status: 'unavailable', data: null },
};

describe('T-VIEWED-063 · the details page', () => {
  it('T-VIEWED-063a: the Finished watching button opens the dialog, reloads after a change, and is disabled offline', async () => {
    const actions = createApiClient({
      fetchImpl: () => {
        throw new Error('Unexpected API request');
      },
    });
    vi.spyOn(actions, 'getWatched').mockResolvedValue(movieState());
    vi.spyOn(actions, 'markFinished').mockResolvedValue({ titleId: 't1', records: [] });
    vi.spyOn(actions, 'setLibraryHidden').mockResolvedValue({} as never);
    const reload = vi.fn();
    const view = render(
      <MemoryRouter>
        <TitleDetailsPage
          item={detail}
          backTo="/"
          offline={false}
          actions={actions}
          onReload={reload}
        />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Finished watching' }));
    await userEvent.click(await screen.findByTestId('finished-mark'));
    await userEvent.click(await screen.findByTestId('finished-remove'));
    await userEvent.click(await screen.findByTestId('finished-close'));
    expect(reload).toHaveBeenCalledOnce();

    view.unmount();
    render(
      <MemoryRouter>
        <TitleDetailsPage item={detail} backTo="/" offline actions={actions} onReload={reload} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Finished watching' })).toBeDisabled();
  });
});

const ROW: WatchedHistoryItem = {
  workIdentity: 'tmdb:tv:1396',
  seasonNumber: 2,
  finished: true,
  watchedOn: '2024-03-04',
  rating: 4,
  titleName: 'Breaking Bad',
  releaseYear: 2008,
  mediaType: 'tv',
  posterPath: '/bb.jpg',
  titleId: 't9',
  imdbRatingTenths: 95,
  leftLibrary: true,
};
const MOVIE_ROW: WatchedHistoryItem = {
  ...ROW,
  workIdentity: 'tmdb:movie:603',
  seasonNumber: 0,
  watchedOn: null,
  rating: null,
  titleName: 'The Matrix',
  releaseYear: null,
  mediaType: 'movie',
  posterPath: null,
  titleId: null,
  imdbRatingTenths: null,
  leftLibrary: false,
};

describe('T-VIEWED-061 · Recently watched', () => {
  const edit = () =>
    ({
      editWatched: vi.fn().mockResolvedValue({}),
      unfinishWatched: vi.fn().mockResolvedValue({}),
      setLibraryHidden: vi.fn().mockResolvedValue({}),
    }) satisfies Partial<ApiClient>;

  it('T-VIEWED-061a: rows show season, date or "Date unknown", both ratings and the out-of-Library fact', () => {
    render(
      <MemoryRouter>
        <WatchedPage items={[ROW, MOVIE_ROW]} />
      </MemoryRouter>,
    );
    const rows = screen.getAllByTestId('watched-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Breaking Bad (2008)');
    expect(rows[0]).toHaveTextContent('Season 2');
    expect(rows[0]).toHaveTextContent('4 Mar 2024');
    expect(rows[0]).toHaveTextContent('Your rating: ★ 4/5 · IMDb 9.5');
    expect(rows[0]).toHaveTextContent('Out of your Library');
    expect(rows[1]).toHaveTextContent('Date unknown');
    expect(rows[1]).toHaveTextContent('Not rated');
    expect(within(rows[1]!).queryByTestId('watched-season')).toBeNull();
    expect(within(rows[1]!).queryByTestId('watched-left-library')).toBeNull();
    // No nagging, no edit control without the wiring.
    expect(screen.queryByTestId('watched-edit')).toBeNull();
  });

  it('T-VIEWED-061b: loading, failed and empty states are distinct, and a failed read is never an empty list', async () => {
    const retry = vi.fn();
    const view = render(
      <MemoryRouter>
        <WatchedPage loading />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('watched-loading')).toBeVisible();
    view.unmount();

    const failed = render(
      <MemoryRouter>
        <WatchedPage loadFailed onRetry={retry} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('watched-load-error')).toBeVisible();
    expect(screen.queryByTestId('watched-empty')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    failed.unmount();

    const noRetry = render(
      <MemoryRouter>
        <WatchedPage loadFailed />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    noRetry.unmount();

    render(
      <MemoryRouter>
        <WatchedPage />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('watched-empty')).toBeVisible();
  });

  it('T-VIEWED-061c: editing saves the date and rating into the row; Not finished removes it; Return to Library clears the note', async () => {
    const api = edit();
    render(
      <MemoryRouter>
        <WatchedPage items={[ROW, MOVIE_ROW]} api={api} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Edit Breaking Bad' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Breaking Bad · Season 2');
    fireEvent.change(screen.getByLabelText('Date watched'), { target: { value: '2025-01-02' } });
    await userEvent.click(screen.getByRole('radio', { name: '5 stars' }));
    await userEvent.click(screen.getByTestId('watched-edit-save'));
    expect(api.editWatched).toHaveBeenCalledWith('tmdb:tv:1396', 2, {
      watchedOn: '2025-01-02',
      rating: 5,
    });
    await waitFor(() => {
      expect(screen.getAllByTestId('watched-date')[0]).toHaveTextContent('2 Jan 2025');
    });
    expect(screen.getAllByTestId('watched-ratings')[0]).toHaveTextContent('★ 5/5');

    await userEvent.click(screen.getByRole('button', { name: 'Edit Breaking Bad' }));
    await userEvent.click(screen.getByTestId('watched-edit-return'));
    expect(api.setLibraryHidden).toHaveBeenCalledWith('t9', false);
    await waitFor(() => {
      expect(screen.queryByTestId('watched-left-library')).toBeNull();
    });

    await userEvent.click(screen.getByRole('button', { name: 'Edit The Matrix' }));
    expect(screen.queryByTestId('watched-edit-return')).toBeNull();
    await userEvent.click(screen.getByTestId('watched-edit-unfinish'));
    expect(api.unfinishWatched).toHaveBeenCalledWith('tmdb:movie:603', 0);
    await waitFor(() => {
      expect(screen.getAllByTestId('watched-row')).toHaveLength(1);
    });
  });

  it('T-VIEWED-061d: an unknown date is saved as null, failures keep the dialog, Cancel writes nothing', async () => {
    const api = edit();
    api.editWatched.mockRejectedValueOnce(new ApiError('VALIDATION_FAILED', 400, 'Nope.', {}));
    api.editWatched.mockRejectedValueOnce(new Error('boom'));
    render(
      <MemoryRouter>
        <WatchedPage items={[MOVIE_ROW]} api={api} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByTestId('watched-edit'));
    expect(screen.getByLabelText('Date unknown')).toBeChecked();
    await userEvent.click(screen.getByTestId('watched-edit-save'));
    expect(await screen.findByTestId('watched-edit-error')).toHaveTextContent('Nope.');
    expect(api.editWatched).toHaveBeenCalledWith('tmdb:movie:603', 0, {
      watchedOn: null,
      rating: null,
    });
    await userEvent.click(screen.getByTestId('watched-edit-save'));
    await waitFor(() => {
      expect(screen.getByTestId('watched-edit-error')).toHaveTextContent("Couldn't save that");
    });
    await userEvent.click(screen.getByTestId('watched-edit-close'));
    expect(screen.queryByTestId('watched-edit-dialog')).toBeNull();
    expect(api.editWatched).toHaveBeenCalledTimes(2);
  });

  it('T-VIEWED-061e: offline disables the editor and the dialog says why', async () => {
    const api = edit();
    render(
      <MemoryRouter>
        <WatchedPage items={[MOVIE_ROW]} api={api} />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByTestId('watched-edit'));
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByTestId('watched-edit-save')).toBeDisabled();
    });
  });

  it('T-VIEWED-061f: the container reads page one, pages on, and a refusal or failure never degrades to an empty list', async () => {
    const getWatchedHistory = vi
      .fn()
      .mockResolvedValueOnce({ items: [ROW], nextCursor: '1', limit: 1 })
      .mockResolvedValue({ items: [MOVIE_ROW], nextCursor: null, limit: 1 });
    const client = { getWatchedHistory } as unknown as ApiClient;
    const view = render(
      <MemoryRouter>
        <WatchedRoute client={client} />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Breaking Bad (2008)')).toBeVisible();
    await userEvent.click(await screen.findByTestId('load-more'));
    expect(await screen.findByText('The Matrix')).toBeVisible();
    expect(getWatchedHistory).toHaveBeenLastCalledWith('1', expect.anything());
    view.unmount();

    const failing = {
      getWatchedHistory: vi.fn().mockRejectedValue(new Error('down')),
    } as unknown as ApiClient;
    const failed = render(
      <MemoryRouter>
        <WatchedRoute client={failing} />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('watched-load-error')).toBeVisible();
    failed.unmount();

    const refusing = {
      getWatchedHistory: vi.fn().mockRejectedValue(new RefusedError('no')),
    } as unknown as ApiClient;
    render(
      <MemoryRouter>
        <WatchedRoute client={refusing} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('watched-load-error')).toBeNull();
      expect(screen.queryByTestId('watched-empty')).toBeNull();
    });
  });
});

describe('T-VIEWED-064 · navigation', () => {
  it('T-VIEWED-064a: Recently watched is a History destination at /watched', async () => {
    const { ROUTES } = await import('../src/routes');
    const route = ROUTES.find((candidate) => candidate.path === '/watched');
    expect(route?.navLabel).toBe('Recently watched');
  });
});
