import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AppShell } from '../src/components/AppShell';
import { FreshnessStrip } from '../src/components/FreshnessStrip';
import type { TitleListItem } from '../src/components/TitleRow';
import { ListPage, type ListPageProps } from '../src/pages/ListPage';

const ITEMS: readonly TitleListItem[] = [
  {
    titleId: 'one',
    workIdentity: 'tmdb:movie:1',
    matchState: 'matched',
    name: 'First title in server order',
    mediaType: 'movie',
    releaseYear: 2026,
    genres: ['Science Fiction', 'Adventure'],
    runtimeMinutes: 128,
    imdbRating: 8.4,
    posterPath: null,
    badges: [
      { service: 'netflix', listingId: 'n1', dateAdded: '2026-09-01' },
      { service: 'max', listingId: 'm1', dateAdded: '2026-09-02' },
    ],
    sortDateAdded: '2026-09-01',
    dateAddedLabel: 'Added to nextup 1 Sep 2026',
  },
  {
    titleId: 'two',
    workIdentity: 'tmdb:tv:2',
    matchState: 'matched',
    name: 'Another title',
    mediaType: 'tv',
    releaseYear: 2025,
    genres: ['Drama'],
    runtimeMinutes: null,
    posterPath: null,
    badges: [{ service: 'max', listingId: 'm2', dateAdded: '2026-08-01' }],
    sortDateAdded: '2026-08-01',
    dateAddedLabel: 'Added to nextup 1 Aug 2026',
  },
];

function Location() {
  return <output data-testid="location">{useLocation().search}</output>;
}

function page(props: ListPageProps = {}) {
  const unexpectedAction = async (): Promise<never> => {
    throw new Error('unexpected list mutation');
  };
  return (
    <MemoryRouter initialEntries={['/?sort=runtime&dir=desc&service=max']}>
      <ListPage
        items={ITEMS}
        onSuppress={unexpectedAction}
        onUnsuppress={unexpectedAction}
        onSearchTmdb={unexpectedAction}
        onFixMatch={unexpectedAction}
        onRestoreListing={unexpectedAction}
        {...props}
      />
      <Location />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

it('T-UX-155a Watching is independent of the priority control and both survive layout changes', () => {
  const save = vi.fn(async () => {
    throw new Error('Layout must not save preferences');
  });
  const item = ITEMS[0];
  if (!item) throw new Error('Missing title fixture');
  render(
    page({ items: [{ ...item, watching: true, priority: 'up-next' }], onWatchPreferences: save }),
  );
  const list = screen.getByTestId('title-list');
  const trigger = within(list).getByRole('button', {
    name: /Watch preferences for.*Watching, Up next/,
  });
  expect(trigger).toHaveTextContent('Up next');
  expect(trigger).not.toHaveTextContent('Watching');
  expect(within(list).getByText('Watching', { exact: true })).toBeVisible();
  expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  const contents = list.innerHTML;
  fireEvent.click(screen.getByRole('button', { name: 'Compact view' }));
  expect(list.innerHTML).toBe(contents);
  expect(save).not.toHaveBeenCalled();
});

it('T-UX-141a grid and compact use the identical rows, metadata, actions and server order', async () => {
  const user = userEvent.setup();
  const remove = vi.fn(async () => {
    throw new Error('layout must not mutate the list');
  });
  render(page({ onRemoveTitle: remove }));
  const list = screen.getByTestId('title-list');
  const original = list.innerHTML;
  const query = screen.getByTestId('location').textContent;
  expect(list).toHaveAttribute('data-view', 'grid');
  expect(within(list).getAllByTestId('row-menu')).toHaveLength(2);
  await user.click(screen.getByRole('button', { name: 'Compact view' }));
  expect(list).toHaveAttribute('data-view', 'compact');
  expect(list.innerHTML).toBe(original);
  expect(screen.getByTestId('location').textContent).toBe(query);
  expect(screen.getByRole('button', { name: 'Compact view' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await user.click(screen.getByRole('button', { name: 'Grid view' }));
  expect(list.innerHTML).toBe(original);
  expect(remove).not.toHaveBeenCalled();
});

it('T-UX-141b layout survives filtering, loading, errors and retry without changing query state', () => {
  const { rerender } = render(page());
  fireEvent.click(screen.getByRole('button', { name: 'Compact view' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove service filter: Max' }));
  expect(screen.getByTestId('location')).not.toHaveTextContent('service=');
  expect(screen.getByTestId('title-list')).toHaveAttribute('data-view', 'compact');
  rerender(page({ loading: true }));
  expect(screen.getByTestId('list-loading-skeletons')).toHaveAttribute('data-view', 'compact');
  rerender(page({ loadFailed: true }));
  expect(screen.getByTestId('list-load-error')).toBeVisible();
  rerender(page());
  expect(screen.getByTestId('title-list')).toHaveAttribute('data-view', 'compact');
});

it('T-UX-141c keyboard selection changes only presentation and retains offline action restrictions', async () => {
  const user = userEvent.setup();
  render(
    page({
      offline: true,
      onRemoveTitle: async () => {
        throw new Error('offline');
      },
    }),
  );
  screen.getByRole('button', { name: 'Compact view' }).focus();
  await user.keyboard('{Enter}');
  expect(screen.getByTestId('title-list')).toHaveAttribute('data-view', 'compact');
  expect(screen.getByTestId('list-cached-note')).toBeVisible();
  await user.click(within(screen.getByTestId('title-row-one')).getByTestId('row-menu'));
  expect(screen.getByRole('menuitem', { name: /Remove/ })).toBeDisabled();
});

it('T-UX-141d an empty submitted search is a zero-match state whose clear action removes q', () => {
  render(
    <MemoryRouter initialEntries={['/?q=missing&sort=name&dir=asc']}>
      <ListPage items={[]} />
      <Location />
    </MemoryRouter>,
  );
  expect(screen.queryByTestId('list-empty-never-uploaded')).not.toBeInTheDocument();
  expect(screen.getByTestId('zero-match')).toBeVisible();
  fireEvent.click(
    within(screen.getByTestId('zero-match')).getByRole('button', { name: 'Clear filters' }),
  );
  expect(screen.getByTestId('location')).toHaveTextContent('?sort=name&dir=asc');
});

it('T-UX-142a the approved dark ink and violet palette is centralized with reduced-motion support', () => {
  const root = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
    ? join(process.cwd(), 'apps', 'web')
    : process.cwd();
  const css = readFileSync(join(root, 'src', 'index.css'), 'utf8');
  expect(css).toMatch(/color-scheme:\s*dark/);
  expect(css).toMatch(/--color-bg:\s*#121020/);
  expect(css).toMatch(/--color-surface:\s*#1e1932/);
  expect(css).toMatch(/--color-text:\s*#f2efff/);
  expect(css).toMatch(/--color-accent:\s*#b3a0ff/);
  expect(css).toMatch(/--color-text-muted:\s*#bcb4d2/);
  expect(css).toMatch(/--color-border:\s*#77678f/);
  expect(css).toMatch(/--color-danger:\s*#ff9ba8/);
  expect(css).toMatch(/--radius:\s*10px/);
  expect(css).toMatch(/--radius-card:\s*16px/);
  expect(css).toContain(
    "--font-stack: 'Segoe UI', Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif",
  );
  expect(css).toContain('prefers-reduced-motion: reduce');
});

it('T-UX-141h a service selection keeps its picker mounted across the pending request without fake counts', () => {
  const { rerender } = render(page());
  fireEvent.click(screen.getByTestId('filters-trigger'));
  const trigger = screen.getByRole('button', { name: /^Services / });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Netflix' }));
  rerender(page({ loading: true }));
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('checkbox', { name: 'Netflix' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Max' })).toBeChecked();
  expect(screen.queryByTestId('filter-count')).not.toBeInTheDocument();
  rerender(page());
  expect(screen.getByRole('checkbox', { name: 'Netflix' })).toBeChecked();
  const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
  if (panel === null) throw new Error('Missing services disclosure panel');
  fireEvent.click(within(panel).getByRole('button', { name: 'Done' }));
  expect(trigger).toHaveFocus();
});

it('T-UX-141i a selected genre remains available while the facet response is pending', () => {
  const { rerender } = render(page({ genres: ['Science Fiction'] }));
  fireEvent.click(screen.getByTestId('filters-trigger'));
  const trigger = screen.getByRole('button', { name: /^Genre / });
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Science Fiction' }));
  rerender(page({ loading: true, genres: [] }));
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('checkbox', { name: 'Science Fiction' })).toBeChecked();
  expect(screen.queryByTestId('filter-count')).not.toBeInTheDocument();
});

it('T-UX-143a service updates are available on demand while unavailable data remains visible', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <FreshnessStrip services={null} />
    </MemoryRouter>,
  );
  const trigger = screen.getByRole('button', { name: 'Service updates' });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByTestId('freshness-degraded')).toBeVisible();
  await user.click(trigger);
  expect(screen.getByTestId('freshness-chip-netflix')).toHaveAttribute(
    'href',
    '/upload?service=netflix',
  );
  expect(screen.getByTestId('freshness-chip-max')).toHaveAttribute('href', '/upload?service=max');
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
  expect(screen.getByTestId('freshness-degraded')).toBeVisible();
});

it('T-UX-143b compact desktop navigation keeps landmarks and restores focus when More closes', async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<h1>Library</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getAllByRole('banner')).toHaveLength(1);
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(screen.getAllByRole('contentinfo')).toHaveLength(1);
  const nav = screen.getByRole('navigation', { name: 'Primary' });
  expect(
    within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent),
  ).toEqual(['List', 'Upload', 'Batches']);
  const more = within(nav).getByRole('button', { name: 'More' });
  await user.click(more);
  within(nav).getByRole('link', { name: 'About' }).focus();
  await user.keyboard('{Escape}');
  expect(more).toHaveFocus();
  expect(more).toHaveAttribute('aria-expanded', 'false');
  await user.click(more);
  await user.click(screen.getByRole('heading'));
  expect(more).toHaveAttribute('aria-expanded', 'false');
});
