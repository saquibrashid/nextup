/**
 * TASK-255 — the owner's mobile mockup for the library and its filters.
 *
 * `T-PHONE-001` … `T-PHONE-008`.
 *
 * ⚠ **`matchMedia` IS STUBBED, NOT MOCKED AWAY.** `useWideViewport` falls back
 * to the WIDE layout when the API is missing (jsdom), so a phone assertion
 * without the stub would render the desktop tree and pass for the wrong
 * reason. `atPhone` asserts the stub took effect via `html[data-layout]`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import type { JSX } from 'react';

import { WIDE_VIEWPORT_QUERY } from '../src/breakpoints';
import { AppShell } from '../src/components/AppShell';
import { FilterBar, PHONE_GENRE_LIMIT } from '../src/components/FilterBar';
import type { TitleListItem } from '../src/components/TitleRow';
import {
  ADD_TITLE_LABEL,
  FILTERS_RESET_LABEL,
  LIBRARY_PHONE_HEADING,
  NAV_MENU_LABEL,
  NAV_TAB_FILTERS_NAME,
  NAV_TAB_SEARCH_NAME,
  libraryTitleCount,
  showTitlesLabel,
  signedInAsLabel,
} from '../src/copy';
import { OwnerNameContext, ownerInitial } from '../src/lib/ownerContext';
import { ListPage } from '../src/pages/ListPage';

const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const CSS = readFileSync(join(WEB_ROOT, 'src', 'index.css'), 'utf8');

const ITEMS: readonly TitleListItem[] = [
  {
    titleId: 'one',
    workIdentity: 'tmdb:movie:1',
    matchState: 'matched',
    name: 'Hamnet',
    mediaType: 'movie',
    releaseYear: 2025,
    genres: ['Drama'],
    runtimeMinutes: 125,
    imdbRating: 7.8,
    posterPath: null,
    badges: [{ service: 'netflix', listingId: 'n1', dateAdded: '2026-09-01' }],
    sortDateAdded: '2026-09-01',
    dateAddedLabel: 'Added 1 Sep 2026',
  },
  {
    titleId: 'two',
    workIdentity: 'tmdb:tv:2',
    matchState: 'matched',
    name: 'The Bear',
    mediaType: 'tv',
    releaseYear: 2022,
    genres: ['Comedy'],
    runtimeMinutes: 30,
    posterPath: null,
    badges: [{ service: 'max', listingId: 'm2', dateAdded: '2026-08-01' }],
    sortDateAdded: '2026-08-01',
    dateAddedLabel: 'Added 1 Aug 2026',
  },
];

function stubMatchMedia(wide: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === WIDE_VIEWPORT_QUERY ? wide : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'matchMedia');
  delete document.documentElement.dataset.layout;
});

function Url(): JSX.Element {
  const location = useLocation();
  return <output data-testid="url">{`${location.pathname}${location.search}`}</output>;
}

const noop = async (): Promise<never> => {
  throw new Error('unexpected list mutation');
};

function mount(path: string, owner: string | null = 'Saquib'): HTMLElement {
  render(
    <OwnerNameContext.Provider value={owner}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route
              path="/"
              element={
                <ListPage
                  items={ITEMS}
                  onAddTitle={noop}
                  onSuppress={noop}
                  onUnsuppress={noop}
                  onSearchTmdb={noop}
                  onFixMatch={noop}
                  onRestoreListing={noop}
                />
              }
            />
            <Route path="/removed" element={<h1>Removal history</h1>} />
            <Route path="/upload" element={<h1>Import</h1>} />
          </Route>
        </Routes>
        <Url />
      </MemoryRouter>
    </OwnerNameContext.Provider>,
  );
  return screen.getByRole('navigation', { name: 'Primary' });
}

function atPhone(path: string, owner?: string | null): HTMLElement {
  stubMatchMedia(false);
  const nav = mount(path, owner);
  // ⚠ THE GUARD: the stub took effect and the phone tree is on screen.
  expect(document.documentElement.dataset.layout).toBe('phone');
  return nav;
}

describe('T-PHONE-001 · the bottom tab bar', () => {
  it('T-PHONE-001a: at phone width the nav is Library, Search, Filters and the Menu', () => {
    const nav = atPhone('/');
    expect(nav).toHaveAttribute('data-tabs');
    expect(within(nav).getByRole('link', { name: 'Library' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('button', { name: NAV_TAB_SEARCH_NAME })).toHaveTextContent(
      'Search',
    );
    expect(within(nav).getByRole('button', { name: NAV_TAB_FILTERS_NAME })).toHaveTextContent(
      'Filters',
    );
    expect(within(nav).getByRole('button', { name: NAV_MENU_LABEL })).toBeTruthy();
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-tab-bar');
  });

  it('T-PHONE-001b: the capture flow has no tab bar — its actions own the bottom edge', () => {
    const nav = atPhone('/upload');
    expect(nav).not.toHaveAttribute('data-tabs');
    expect(screen.queryByTestId('tab-search')).toBeNull();
    expect(within(nav).getByRole('button', { name: NAV_MENU_LABEL })).toBeTruthy();
    expect(document.querySelector('.app-shell')).not.toHaveAttribute('data-tab-bar');
  });

  it('T-PHONE-001c: at wide width there is no tab bar and the root says so', () => {
    stubMatchMedia(true);
    const nav = mount('/');
    expect(document.documentElement.dataset.layout).toBe('wide');
    expect(nav).not.toHaveAttribute('data-tabs');
    expect(screen.queryByTestId('tab-search')).toBeNull();
    expect(screen.queryByTestId('tab-filters')).toBeNull();
  });
});

describe('T-PHONE-002 · the Search and Filters tabs', () => {
  it('T-PHONE-002a: Search opens the library search; there is no second trigger on the page', () => {
    atPhone('/');
    expect(screen.queryByTestId('list-search-trigger')).toBeNull();
    expect(screen.queryByRole('search', { name: 'Search your library' })).toBeNull();

    fireEvent.click(screen.getByTestId('tab-search'));

    expect(screen.getByRole('search', { name: 'Search your library' })).toBeTruthy();
  });

  it('T-PHONE-002b: Search from another route goes to the library and opens the search', () => {
    atPhone('/removed');
    fireEvent.click(screen.getByTestId('tab-search'));
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/$/);
    expect(screen.getByRole('search', { name: 'Search your library' })).toBeTruthy();
  });

  it('T-PHONE-002c: Filters opens the filters sheet, from the library or from elsewhere', () => {
    atPhone('/');
    fireEvent.click(screen.getByTestId('tab-filters'));
    expect(screen.getByTestId('filter-sheet')).toBeTruthy();
    cleanup();

    atPhone('/removed');
    fireEvent.click(screen.getByTestId('tab-filters'));
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/$/);
    expect(screen.getByTestId('filter-sheet')).toBeTruthy();
  });

  it('T-PHONE-002d: a tab request is consumed once — a re-render does not reopen it', () => {
    atPhone('/');
    fireEvent.click(screen.getByTestId('tab-filters'));
    fireEvent.click(screen.getByRole('button', { name: showTitlesLabel(2, false) }));
    expect(screen.queryByTestId('filter-sheet')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Compact view' }));
    expect(screen.queryByTestId('filter-sheet')).toBeNull();
  });
});

describe('T-PHONE-003 · the header identity', () => {
  it('T-PHONE-003a: the avatar is the owner initial, named, and not a control', () => {
    atPhone('/');
    const avatar = screen.getByRole('img', { name: signedInAsLabel('Saquib') });
    expect(avatar).toHaveTextContent('S');
    expect(avatar.closest('button, a')).toBeNull();
  });

  it('T-PHONE-003b: no display name renders no avatar rather than a blank one', () => {
    atPhone('/', null);
    expect(screen.queryByRole('img', { name: /Signed in as/ })).toBeNull();
    expect(ownerInitial(null)).toBeNull();
    expect(ownerInitial('  ')).toBeNull();
    expect(ownerInitial('éva')).toBe('É');
  });
});

describe('T-PHONE-004 · the library heading', () => {
  it('T-PHONE-004a: "My Library" with its count, and every tool keeps an accessible name', () => {
    atPhone('/');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(LIBRARY_PHONE_HEADING);
    const count = document.querySelector('.library-heading__count');
    expect(count).toHaveTextContent(libraryTitleCount(2, false));
    // The live count is the filter bar's status line; this copy is decoration.
    expect(count).toHaveAttribute('aria-hidden', 'true');
    const tools = document.querySelector('.library-heading__tools');
    if (!(tools instanceof HTMLElement)) throw new Error('missing tools');
    expect(within(tools).getByRole('button', { name: ADD_TITLE_LABEL })).toBeTruthy();
    expect(within(tools).getByRole('button', { name: /Service updates/ })).toBeTruthy();
    expect(within(tools).getByRole('button', { name: /^Filters/ })).toBeTruthy();
  });

  it('T-PHONE-004b: the count says "at least" when the total is a lower bound', () => {
    expect(libraryTitleCount(127, false)).toBe('127 titles');
    expect(libraryTitleCount(1, false)).toBe('1 title');
    expect(libraryTitleCount(50, true)).toBe('at least 50 titles');
  });

  it('T-PHONE-004c: the service row leads with a short "All" that still names itself', () => {
    atPhone('/');
    const all = screen.getByRole('button', { name: 'All services' });
    expect(all).toHaveTextContent(/^All$/);
    expect(all).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('T-PHONE-005 · the filters sheet', () => {
  function sheet(path = '/?q=bear'): HTMLElement {
    atPhone(path);
    fireEvent.click(screen.getByTestId('tab-filters'));
    return screen.getByTestId('filter-sheet');
  }

  it('T-PHONE-005a: every chip is a native checkbox that writes the URL', () => {
    const panel = sheet('/');
    const netflix = within(panel).getByRole('checkbox', { name: /Netflix/ });
    fireEvent.click(netflix);
    expect(screen.getByTestId('url')).toHaveTextContent('service=netflix');
    expect(netflix).toBeChecked();

    fireEvent.click(within(panel).getByRole('checkbox', { name: 'TV Show' }));
    expect(screen.getByTestId('url')).toHaveTextContent('category=tv');

    // Status is multi-select (#384): a second chip adds to the first.
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Up next' }));
    expect(screen.getByTestId('url')).toHaveTextContent('status=up-next');
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Watching' }));
    expect(screen.getByTestId('url')).toHaveTextContent('status=up-next&status=watching');
    expect(within(panel).getByRole('checkbox', { name: 'All statuses' })).not.toBeChecked();
  });

  it('T-PHONE-005b: Reset clears every filter but keeps the search text', () => {
    const panel = sheet('/?q=bear&service=max&priority=someday');
    fireEvent.click(within(panel).getByRole('button', { name: FILTERS_RESET_LABEL }));
    expect(screen.getByTestId('url')).toHaveTextContent(/^\/\?q=bear$/);
    expect(within(panel).getByRole('checkbox', { name: 'All statuses' })).toBeChecked();
  });

  it('T-PHONE-005c: the primary button counts what it will show and closes the sheet', () => {
    const panel = sheet('/');
    const show = within(panel).getByTestId('filter-sheet-show');
    expect(show).toHaveTextContent(showTitlesLabel(2, false));
    fireEvent.click(show);
    expect(screen.queryByTestId('filter-sheet')).toBeNull();
  });

  it('T-PHONE-005d: genres past the limit sit behind a More chip that reveals them all', () => {
    const genres = Array.from({ length: PHONE_GENRE_LIMIT + 3 }, (_, i) => `Genre ${String(i)}`);
    stubMatchMedia(false);
    render(
      <MemoryRouter initialEntries={['/']}>
        <FilterBar
          part="trigger"
          genres={genres}
          shown={1}
          total={1}
          openRequest={{ kind: 'filters', seq: 1 }}
        />
      </MemoryRouter>,
    );
    const panel = screen.getByTestId('filter-sheet');
    const genreBoxes = (): HTMLElement[] =>
      within(panel)
        .getAllByRole('checkbox')
        .filter((box) => box.getAttribute('name') === 'genre');
    expect(genreBoxes()).toHaveLength(PHONE_GENRE_LIMIT);
    fireEvent.click(within(panel).getByRole('button', { name: 'Show 3 more genres' }));
    expect(genreBoxes()).toHaveLength(PHONE_GENRE_LIMIT + 3);
  });
});

describe('T-PHONE-006 · the stylesheet', () => {
  /** The TASK-255 block, comments stripped so only rules remain. */
  const phoneBlock = CSS.slice(CSS.indexOf('*/', CSS.indexOf('phone mockup (255)')) + 2).replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  it('T-PHONE-006a: every phone rule is scoped to html[data-layout=phone]', () => {
    const selectors = [...phoneBlock.matchAll(/^([^\s/@*}][^{]*)\{/gm)].map((m) =>
      (m[1] ?? '').trim(),
    );
    expect(selectors.length).toBeGreaterThan(20);
    for (const selector of selectors) {
      for (const part of selector.split(',')) {
        expect(part.trim(), selector).toMatch(/^html\[data-layout='phone'\]\s/);
      }
    }
  });

  it('T-PHONE-006b: slim chips are drawn on a pseudo-element; the target stays 44 px', () => {
    for (const owner of [
      '.filter-chip',
      '.service-filters > .btn',
      '.library-heading__tools .btn',
    ]) {
      expect(phoneBlock, owner).toContain(`html[data-layout='phone'] ${owner}::before`);
    }
    const chip = /html\[data-layout='phone'\] \.filter-chip \{([^}]*)\}/.exec(phoneBlock)?.[1];
    expect(chip).toMatch(/min-block-size:\s*var\(--tap-target-min\)/);
  });

  it('T-PHONE-006c: the tab bar reserves its height so nothing hides under it', () => {
    const shell = /html\[data-layout='phone'\] \.app-shell\[data-tab-bar\] \{([^}]*)\}/.exec(
      phoneBlock,
    )?.[1];
    expect(shell).toMatch(/padding-bottom:\s*calc\(var\(--tab-bar-height\)/);
  });
});
