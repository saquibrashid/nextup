/**
 * #415 (US-065, `A56`) — ordering on Waiting to stream, the web half
 * (`T-WSORT-004`), and #414 — the Grid card's shared rows (`T-WGRID-001`).
 *
 * The order is the SERVER's: the page writes `?sort=` / `?dir=` through the
 * Library's own SortControl, the route passes them to `GET /api/waiting`, and
 * the page renders what comes back without re-sorting it. The reverse button
 * is the same load-bearing control as the Library's (REQ-038's floor rule).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LIBRARY_SORT,
  WAITING_SORT,
  WAITING_SORT_KEYS,
  readSortDirIn,
  readSortKeyIn,
} from '../src/components/SortControl';
import { WaitingRoute } from '../src/containers/WaitingRoute';
import { createApiClient, type ApiClient, type WaitingItem } from '../src/lib/apiClient';
import { WaitingPage } from '../src/pages/WaitingPage';

const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const css = readFileSync(join(WEB_ROOT, 'src', 'index.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function item(over: Partial<WaitingItem> = {}): WaitingItem {
  return {
    intentId: 'wi-1',
    titleId: 'title-1',
    workIdentity: 'tmdb:movie:1',
    name: 'Wicked: For Good',
    releaseYear: 2025,
    posterPath: '/w.jpg',
    discoveredAt: '2026-09-24',
    discoverySource: 'fandango-at-home',
    availableOn: [],
    flaggedOn: [],
    otherServicesOn: [],
    otherProvidersOn: [],
    accessState: 'not-seen',
    rentOn: [],
    availabilityCheckedAt: '2026-09-24T00:00:00.000Z',
    availabilityRegion: 'US',
    forecast: null,
    ...over,
  };
}

function client(): ApiClient {
  return createApiClient({
    fetchImpl: async () => {
      throw new Error('Unexpected API request');
    },
  });
}

let lastSearch = '';
function Location(): JSX.Element | null {
  lastSearch = useLocation().search;
  return null;
}

function mountPage(path = '/waiting', items: WaitingItem[] = [item()]): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <WaitingPage items={items} />
      <Location />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('T-WSORT-004 · #415 · the Library’s SortControl orders Waiting to stream', () => {
  it('T-WSORT-004a · the waiting keys, in order, with the waiting panel title and the default shown', async () => {
    mountPage();
    expect(screen.getByTestId('sort-trigger')).toHaveTextContent('Streaming soonest');
    await userEvent.click(screen.getByTestId('sort-trigger'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Sort your waiting list' })).toBeTruthy();
    const names = [...dialog.querySelectorAll('.sort-option__name')].map((el) => el.textContent);
    expect(names).toEqual(['Expected to stream', 'Date discovered', 'Title', 'Release date']);
    // None of the Library's keys leak in.
    expect(names).not.toContain('Added to library');
    expect(names).not.toContain('Watch priority');
    expect(WAITING_SORT_KEYS).toEqual(['expected', 'discovered', 'name', 'releaseYear']);
  });

  it('T-WSORT-004b · choosing a key writes ?sort= and its own default ?dir=; the default key omits ?sort=', async () => {
    mountPage();
    const choose = async (name: RegExp): Promise<void> => {
      await userEvent.click(screen.getByTestId('sort-trigger'));
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));
    };
    await choose(/^Recently discovered$/);
    expect(new URLSearchParams(lastSearch).get('sort')).toBe('discovered');
    expect(new URLSearchParams(lastSearch).get('dir')).toBe('desc');
    await choose(/^Name A-Z$/);
    expect(lastSearch).toBe('?sort=name&dir=asc');
    await choose(/^Newest releases$/);
    expect(lastSearch).toBe('?sort=releaseYear&dir=desc');
    await choose(/^Streaming soonest$/);
    expect(lastSearch).toBe('?dir=asc');
  });

  it('T-WSORT-004c · the toolbar reverse button flips ?dir= in one press and names the order it gives', async () => {
    mountPage('/waiting?sort=name');
    const reverse = screen.getByTestId('sort-reverse');
    expect(reverse).toHaveAccessibleName('Reverse the order: Name Z-A');
    await userEvent.click(reverse);
    expect(lastSearch).toBe('?sort=name&dir=desc');
    expect(screen.getByTestId('sort-trigger')).toHaveTextContent('Name Z-A');
    await userEvent.click(screen.getByTestId('sort-reverse'));
    expect(lastSearch).toBe('?sort=name&dir=asc');
    // The default key reverses too: soonest ⇄ latest.
    await userEvent.click(screen.getByTestId('sort-trigger'));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^Streaming soonest$/ }),
    );
    await userEvent.click(screen.getByTestId('sort-reverse'));
    expect(lastSearch).toBe('?dir=desc');
    expect(screen.getByTestId('sort-trigger')).toHaveTextContent('Streaming latest');
  });

  it('T-WSORT-004d · the per-key defaults, and an unknown value reads as the default without touching the Library', () => {
    const read = (search: string): [string, string] => {
      const params = new URLSearchParams(search);
      return [readSortKeyIn(WAITING_SORT, params), readSortDirIn(WAITING_SORT, params)];
    };
    expect(read('')).toEqual(['expected', 'asc']);
    expect(read('sort=discovered')).toEqual(['discovered', 'desc']);
    expect(read('sort=name')).toEqual(['name', 'asc']);
    expect(read('sort=releaseYear')).toEqual(['releaseYear', 'desc']);
    expect(read('sort=releaseYear&dir=asc')).toEqual(['releaseYear', 'asc']);
    expect(read('sort=dateAdded&dir=sideways')).toEqual(['expected', 'asc']);
    // The Library's config is unchanged by the generalisation.
    expect(LIBRARY_SORT.defaultKey).toBe('dateAdded');
    expect(readSortKeyIn(LIBRARY_SORT, new URLSearchParams('sort=expected'))).toBe('dateAdded');
  });

  it('T-WSORT-004e · the route asks the server for the order and renders it untouched; a new order is a new read', async () => {
    const api = client();
    const zed = item({ intentId: 'wi-z', titleId: 't-z', name: 'Zootopia 2' });
    const arr = item({ intentId: 'wi-a', titleId: 't-a', name: 'Arrival' });
    const getWaiting = vi
      .spyOn(api, 'getWaiting')
      .mockImplementation(async (_signal, query = '') => ({
        // Deliberately NOT alphabetical for name A-Z: the page must not re-sort.
        items: query.includes('sort=name') ? [zed, arr] : [arr, zed],
        count: 2,
        availabilityRefreshFailed: false,
      }));
    render(
      <MemoryRouter initialEntries={['/waiting?sort=name&dir=asc&page=3']}>
        <WaitingRoute client={api} />
        <Location />
      </MemoryRouter>,
    );
    await screen.findByTestId('waiting-list');
    // Only sort and dir travel, verbatim.
    expect(getWaiting).toHaveBeenLastCalledWith(expect.anything(), 'sort=name&dir=asc');
    expect(screen.getAllByTestId('waiting-name').map((el) => el.textContent)).toEqual([
      'Zootopia 2',
      'Arrival',
    ]);
    await userEvent.click(screen.getByTestId('sort-reverse'));
    await waitFor(() => {
      expect(getWaiting).toHaveBeenLastCalledWith(expect.anything(), 'sort=name&dir=desc');
    });
    expect(lastSearch).toContain('dir=desc');
  });

  it('T-WSORT-004f · with no ?sort= or ?dir= the route sends no query, so the server default applies', async () => {
    const api = client();
    const getWaiting = vi.spyOn(api, 'getWaiting').mockResolvedValue({
      items: [item()],
      count: 1,
      availabilityRefreshFailed: false,
    });
    render(
      <MemoryRouter initialEntries={['/waiting']}>
        <WaitingRoute client={api} />
      </MemoryRouter>,
    );
    await screen.findByTestId('waiting-list');
    expect(getWaiting).toHaveBeenCalledWith(expect.anything(), '');
  });

  it('T-WSORT-004g · the sort control stays on the toolbar in both views and while a new order loads', async () => {
    const { rerender } = render(
      <MemoryRouter>
        <WaitingPage items={[item()]} view="grid" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('sort-reverse')).toBeTruthy();
    rerender(
      <MemoryRouter>
        <WaitingPage items={[item()]} view="compact" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('sort-reverse')).toBeTruthy();
    rerender(
      <MemoryRouter>
        <WaitingPage loading />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('sort-reverse')).toBeTruthy();
    expect(screen.getByTestId('waiting-loading')).toBeTruthy();
  });
});

const SLOTS = ['poster', 'title', 'chip', 'meta', 'availability', 'moved', 'date', 'action'];

function slotsOf(row: HTMLElement): string[] {
  return [...row.querySelectorAll<HTMLElement>('[data-grid-slot]')]
    .filter((el) => el.parentElement?.closest('[data-grid-slot]') === null)
    .map((el) => el.dataset.gridSlot ?? '');
}

function slot(row: HTMLElement, name: string): HTMLElement {
  const found = row.querySelector<HTMLElement>(`[data-grid-slot='${name}']`);
  if (found === null) throw new Error(`no ${name} slot`);
  return found;
}

describe('T-WGRID-001 · #414 · every Grid card has the same rows, in the same order', () => {
  const full = item({
    intentId: 'wi-full',
    titleId: 't-full',
    accessState: 'rent-only',
    rentOn: ['Apple TV'],
    movedFromLibraryAt: '2026-09-01T00:00:00.000Z',
    forecast: { kind: 'announced', service: 'netflix', on: '2026-11-01', yours: true },
  });
  const bare = item({
    intentId: 'wi-bare',
    titleId: 't-bare',
    name: 'Bare',
    workIdentity: 'unmatched:bare',
    posterPath: null,
    releaseYear: null,
    forecast: null,
  });

  it('T-WGRID-001a · a full card and a bare card expose the same eight slots in DOM order, the action last', () => {
    render(
      <MemoryRouter>
        <WaitingPage items={[full, bare]} view="grid" />
      </MemoryRouter>,
    );
    const [first, second] = screen.getAllByTestId('waiting-row');
    expect(slotsOf(first!)).toEqual(SLOTS);
    expect(slotsOf(second!)).toEqual(SLOTS);
    expect(within(slot(second!, 'action')).getByTestId('waiting-not-interested')).toBeTruthy();
    expect(within(slot(first!, 'action')).getByTestId('waiting-not-interested')).toBeTruthy();
  });

  it('T-WGRID-001b · an absent chip, meta, moved note or date block leaves its slot reserved and empty', () => {
    render(
      <MemoryRouter>
        <WaitingPage items={[full, bare]} view="grid" />
      </MemoryRouter>,
    );
    const [first, second] = screen.getAllByTestId('waiting-row');
    expect(within(slot(first!, 'chip')).queryByText(/./)).not.toBeNull();
    expect(slot(first!, 'date').textContent).not.toBe('');
    expect(slot(first!, 'moved').textContent).not.toBe('');
    for (const name of ['chip', 'meta', 'moved', 'date']) {
      const empty = slot(second!, name);
      expect(empty).toBeEmptyDOMElement();
    }
    // The reserved slots carry nothing for assistive technology.
    for (const name of ['chip', 'meta', 'moved']) {
      expect(slot(second!, name)).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('T-WGRID-001c · Compact reserves nothing: no empty slots, and the same words as before', () => {
    render(
      <MemoryRouter>
        <WaitingPage items={[bare]} view="compact" />
      </MemoryRouter>,
    );
    const row = screen.getByTestId('waiting-row');
    expect(row.querySelector('.waiting-row__slot-empty')).toBeNull();
    expect(row.querySelector('.waiting-row__slot')).toBeNull();
    expect(within(row).getByTestId('waiting-not-interested')).toBeTruthy();
  });

  it('T-WGRID-001d · the stylesheet puts each slot on a shared subgrid row and fixes the poster box', () => {
    const rule = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(css);
      if (match === null) throw new Error(`no rule for ${selector}`);
      return match[1] ?? '';
    };
    const card = rule(".waiting-list[data-view='grid'] .waiting-row");
    expect(card).toMatch(/grid-template-rows:\s*subgrid/);
    expect(card).toMatch(/grid-row:\s*span 8/);
    expect(rule(".waiting-list[data-view='grid'] .waiting-row__poster")).toMatch(
      /aspect-ratio:\s*2 \/ 3/,
    );
    SLOTS.slice(1).forEach((name, index) => {
      expect(rule(`.waiting-list[data-view='grid'] [data-grid-slot='${name}']`)).toMatch(
        new RegExp(`grid-row:\\s*${index + 2};`),
      );
    });
    expect(rule(".waiting-list[data-view='grid'] [data-grid-slot='action']")).toMatch(
      /justify-content:\s*flex-end/,
    );
    // Only Grid is restructured: the unscoped footer is no box at all.
    expect(rule('.waiting-row__footer')).toMatch(/display:\s*contents/);
  });
});
