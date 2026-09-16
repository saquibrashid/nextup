import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { ListPage } from '../src/pages/ListPage';
import { ListRoute } from '../src/containers/ListRoute';
import { ApiError, createApiClient, type WatchPreferencesResult } from '../src/lib/apiClient';
import { parseFilters, applyFilters, isFiltered, NO_FILTERS } from '../src/components/FilterBar';
import type { TitleListItem } from '../src/components/TitleRow';

const item: TitleListItem = {
  titleId: 'lanterns',
  workIdentity: 'tmdb:tv:95350',
  name: 'Lanterns',
  matchState: 'matched',
  mediaType: 'tv',
  releaseYear: 2026,
  genres: ['Drama'],
  runtimeMinutes: 54,
  posterPath: null,
  badges: [{ service: 'max', listingId: 'max-lanterns', dateAdded: '2026-09-01' }],
  sortDateAdded: '2026-09-01',
  dateAddedLabel: 'Added to nextup 1 Sep 2026',
};

function Location() {
  return <output data-testid="watch-query">{useLocation().search}</output>;
}

it('T-WATCH-003a defaults to Normal, opens accessible preferences, and only saves on confirmation', async () => {
  const save = vi.fn(async () => ({
    titleId: item.titleId,
    watching: true,
    priority: 'up-next' as const,
  }));
  const reload = vi.fn();
  render(
    <MemoryRouter>
      <ListPage items={[item]} onWatchPreferences={save} onReload={reload} />
    </MemoryRouter>,
  );
  const trigger = screen.getByRole('button', { name: 'Watch preferences for Lanterns: Normal' });
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: 'Watch preferences' });
  expect(within(dialog).getByRole('radio', { name: 'Normal' })).toBeChecked();
  fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Currently watching' }));
  fireEvent.click(within(dialog).getByRole('radio', { name: 'Up next' }));
  expect(save).not.toHaveBeenCalled();
  expect(trigger).toHaveTextContent('Normal');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save preferences' }));
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledExactlyOnceWith('lanterns', { watching: true, priority: 'up-next' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('T-WATCH-003b cancelling preserves saved values and restores focus', () => {
  const save = vi.fn();
  render(
    <MemoryRouter>
      <ListPage
        items={[{ ...item, watching: true, priority: 'someday' }]}
        onWatchPreferences={save}
      />
    </MemoryRouter>,
  );
  const trigger = screen.getByRole('button', {
    name: 'Watch preferences for Lanterns: Watching, Someday',
  });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('radio', { name: 'Up next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(save).not.toHaveBeenCalled();
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveTextContent('Someday');
});

it('T-WATCH-003c failed saves display the server message and retain the draft for explicit retry', async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(
      new ApiError('VALIDATION_FAILED', 400, 'Please choose a supported priority.', {}),
    )
    .mockResolvedValueOnce({ titleId: item.titleId, watching: false, priority: 'someday' });
  const reload = vi.fn();
  render(
    <MemoryRouter>
      <ListPage items={[item]} onWatchPreferences={save} onReload={reload} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Watch preferences for Lanterns: Normal' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Someday' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please choose a supported priority.');
  expect(screen.getByRole('radio', { name: 'Someday' })).toBeChecked();
  expect(reload).not.toHaveBeenCalled();
  expect(save).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
  await waitFor(() => expect(reload).toHaveBeenCalledOnce());
});

it('T-WATCH-003d pending saves cannot submit twice and do not optimistically change the row', async () => {
  let finish: ((value: WatchPreferencesResult) => void) | undefined;
  const save = vi.fn(
    () =>
      new Promise<WatchPreferencesResult>((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <MemoryRouter>
      <ListPage items={[item]} onWatchPreferences={save} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Watch preferences for Lanterns: Normal' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Up next' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
  expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Watch preferences for Lanterns: Normal' }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Saving…' }));
  expect(save).toHaveBeenCalledOnce();
  finish?.({ titleId: item.titleId, watching: false, priority: 'up-next' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('T-WATCH-003e offline rows display preferences without an editable control', () => {
  render(
    <MemoryRouter>
      <ListPage
        items={[{ ...item, watching: true, priority: 'up-next' }]}
        onWatchPreferences={vi.fn()}
        offline
      />
    </MemoryRouter>,
  );
  expect(screen.queryByRole('button', { name: /Watch preferences for/ })).not.toBeInTheDocument();
  expect(screen.getByTestId('title-row-lanterns')).toHaveTextContent('Watching · Up next');
});

it('T-WATCH-003f preference filters round-trip, clear independently and preserve unrelated URL state', () => {
  const params = new URLSearchParams(
    'watching=false&priority=up-next&priority=someday&priority=up-next&q=hello&sort=runtime&dir=asc',
  );
  const filters = parseFilters(params);
  expect(filters.watching).toBe(false);
  expect(filters.priorities).toEqual(['up-next', 'someday']);
  expect(isFiltered(filters)).toBe(true);
  expect(parseFilters(new URLSearchParams('watching=bogus&priority=bogus'))).toEqual(NO_FILTERS);
  const cleared = applyFilters(params, NO_FILTERS);
  expect(cleared.toString()).toBe('q=hello&sort=runtime&dir=asc');
  render(
    <MemoryRouter initialEntries={['/?' + params.toString()]}>
      <ListPage items={[item]} />
      <Location />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove priority filter: Up next' }));
  const remaining = new URLSearchParams(screen.getByTestId('watch-query').textContent ?? '');
  expect(remaining.getAll('priority')).toEqual(['someday']);
  expect(remaining.get('watching')).toBe('false');
  fireEvent.click(screen.getByTestId('clear-filters'));
  expect(screen.getByTestId('watch-query')).toHaveTextContent('?sort=runtime&dir=asc');
});

it('T-WATCH-003g Watch priority is opt-in, reverses in one action, and keeps existing filters', () => {
  render(
    <MemoryRouter initialEntries={['/?service=max&priority=someday']}>
      <ListPage items={[item]} />
      <Location />
    </MemoryRouter>,
  );
  expect(screen.getByRole('button', { name: /^Recently added.*Selected/ })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Watch priority', exact: true }));
  expect(screen.getByTestId('watch-query')).toHaveTextContent('sort=watchPriority');
  expect(screen.getByTestId('watch-query')).toHaveTextContent('dir=asc');
  fireEvent.click(screen.getByRole('button', { name: /^Watch priority. Selected/ }));
  expect(screen.getByTestId('watch-query')).toHaveTextContent('dir=desc');
  expect(screen.getByTestId('watch-query')).toHaveTextContent('priority=someday');
});

it('T-WATCH-003h the real container PATCHes once then refetches authoritative list state', async () => {
  let saved = false;
  const paths: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = String(input);
    paths.push(path);
    if (init?.method === 'PATCH') {
      expect(path).toBe('/api/titles/lanterns/watch-preferences');
      expect(init.credentials).toBe('same-origin');
      expect(JSON.parse(String(init.body))).toEqual({ watching: true, priority: 'someday' });
      saved = true;
      return Response.json({ titleId: 'lanterns', watching: true, priority: 'someday' });
    }
    if (path.startsWith('/api/titles'))
      return Response.json({
        items: [{ ...item, watching: saved, priority: saved ? 'someday' : 'normal' }],
        nextCursor: null,
        limit: 50,
      });
    if (path === '/api/service-state') return Response.json({ services: [] });
    if (path === '/api/suppressions') return Response.json({ items: [] });
    throw new Error(`Unexpected request: ${path}`);
  };
  render(
    <MemoryRouter>
      <ListRoute client={createApiClient({ fetchImpl })} />
    </MemoryRouter>,
  );
  fireEvent.click(
    await screen.findByRole('button', { name: 'Watch preferences for Lanterns: Normal' }),
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Currently watching' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Someday' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
  expect(
    await screen.findByRole('button', {
      name: 'Watch preferences for Lanterns: Watching, Someday',
    }),
  ).toBeVisible();
  expect(paths.filter((path) => path === '/api/titles')).toHaveLength(2);
  expect(paths.filter((path) => path.includes('/watch-preferences'))).toHaveLength(1);
});
