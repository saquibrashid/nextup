// #457 (`A61`, US-070) — the Waiting add is an explicit Add (+) control, and
// every lookup result row says enough to tell similar titles apart.

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TitleSearchResults } from '../src/components/TitleSearchResults';
import { WaitingSearchAdd } from '../src/components/WaitingSearchAdd';
import {
  WAITING_ADD_CLOSE_LABEL,
  WAITING_ADD_OPEN,
  WAITING_SEARCH_ACTION,
  WAITING_SEARCH_LABEL,
  WAITING_SEARCH_LEGEND,
} from '../src/copy';
import type { TmdbSearchResult } from '../src/lib/apiClient';

const rich: TmdbSearchResult = {
  tmdbId: 1,
  mediaType: 'movie',
  name: 'Dune',
  releaseYear: 2021,
  posterPath: '/p.jpg',
  overview: 'A noble family takes charge of a desert planet.',
  genres: ['Science Fiction', 'Adventure'],
  cast: ['Timothée Chalamet', 'Zendaya'],
};
const bare: TmdbSearchResult = {
  tmdbId: 2,
  mediaType: 'tv',
  name: 'Dune: Prophecy',
  releaseYear: null,
  posterPath: null,
};

const ids = {
  list: 'list',
  item: 'item',
  name: 'name',
  genres: 'genres',
  cast: 'cast',
  overview: 'overview',
  type: 'type',
  poster: 'poster',
  select: (r: TmdbSearchResult) => `select-${r.tmdbId}`,
};

async function openAndSearch(items: TmdbSearchResult[], onAdd = vi.fn(() => Promise.resolve())) {
  const onSearch = vi.fn(() => Promise.resolve(items));
  render(<WaitingSearchAdd onSearch={onSearch} onAdd={onAdd} />);
  fireEvent.click(screen.getByTestId('waiting-add-open'));
  fireEvent.change(screen.getByTestId('waiting-search-input'), { target: { value: 'dune' } });
  fireEvent.click(screen.getByTestId('waiting-search-submit'));
  await screen.findByTestId('waiting-search-results');
  return { onSearch, onAdd };
}

describe('T-WADD-010 · the explicit Add (+) entry point', () => {
  it('T-WADD-010a · an Add title button with a plus icon is present, and nothing is looked up yet', () => {
    const onSearch = vi.fn(() => Promise.resolve([]));
    render(<WaitingSearchAdd onSearch={onSearch} onAdd={vi.fn()} />);

    const add = screen.getByRole('button', { name: WAITING_ADD_OPEN });
    expect(add.querySelector('svg')).not.toBeNull();
    expect(add.getAttribute('aria-haspopup')).toBe('dialog');
    expect(add.getAttribute('aria-expanded')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('T-WADD-010b · the old "Search" entry point is gone: no control or field is named Search', () => {
    render(<WaitingSearchAdd onSearch={vi.fn()} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByTestId('waiting-add-open'));

    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
    expect(screen.queryByRole('searchbox', { name: /^search/i })).toBeNull();
    expect(screen.getByRole('searchbox', { name: WAITING_SEARCH_LABEL })).toBeTruthy();
    expect(screen.getByRole('button', { name: WAITING_SEARCH_ACTION })).toBeTruthy();
  });

  it('T-WADD-010c · pressing it opens the add dialog and focuses the field', async () => {
    render(<WaitingSearchAdd onSearch={vi.fn()} onAdd={vi.fn()} />);
    fireEvent.click(screen.getByTestId('waiting-add-open'));

    expect(screen.getByRole('dialog')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox')));
  });
  it('T-WADD-010d · nothing is added until the owner confirms a result', async () => {
    const { onAdd } = await openAndSearch([rich]);
    expect(onAdd).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('waiting-search-add'));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(rich));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('T-WADM-001 · the Add flow is a modal dialog', () => {
  function open() {
    const onAdd = vi.fn(() => Promise.resolve());
    render(
      <main>
        <WaitingSearchAdd onSearch={() => Promise.resolve([rich])} onAdd={onAdd} />
      </main>,
    );
    const button = screen.getByTestId('waiting-add-open');
    button.focus();
    fireEvent.click(button);
    return { button, onAdd };
  }

  it('T-WADM-001a · it opens as a named modal dialog, with focus inside', async () => {
    open();
    const dialog = screen.getByRole('dialog', { name: WAITING_SEARCH_LEGEND });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  });

  it('T-WADM-001b · the background is inert while open and restored after', () => {
    const { button } = open();
    expect(document.querySelector('main')?.parentElement?.hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: WAITING_ADD_CLOSE_LABEL }));
    expect(document.querySelector('main')?.parentElement?.hasAttribute('inert')).toBe(false);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(button).toBeTruthy();
  });

  it('T-WADM-001c · Escape closes it and focus returns to the Add title button', async () => {
    const { button } = open();
    await waitFor(() => expect(screen.getByRole('searchbox')).toBe(document.activeElement));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it('T-WADM-001d · a backdrop press closes it; a press inside does not', () => {
    open();
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(document.querySelector('.dialog-backdrop') as Element);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('T-WADM-001e · a successful add closes the dialog, returns focus and announces it', async () => {
    const { button, onAdd } = open();
    fireEvent.change(screen.getByTestId('waiting-search-input'), { target: { value: 'dune' } });
    fireEvent.click(screen.getByTestId('waiting-search-submit'));
    fireEvent.click(await screen.findByTestId('waiting-search-add'));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onAdd).toHaveBeenCalledWith(rich);
    expect(document.activeElement).toBe(button);
    const outcome = screen.getByTestId('waiting-search-outcome');
    expect(outcome.getAttribute('role')).toBe('status');
    expect(outcome.textContent).toBe('Added to Waiting to stream: Dune');
  });
});
describe('T-WADD-011 · richer lookup results', () => {
  it('T-WADD-011a · a row shows type, year, genres, lead cast and the overview', () => {
    render(<TitleSearchResults results={[rich]} onSelect={vi.fn()} testIds={ids} />);
    const row = screen.getByTestId('item');

    expect(within(row).getByTestId('name').textContent).toBe('Dune');
    expect(row.textContent).toContain('2021');
    expect(within(row).getByTestId('type').textContent).toBe('Movie');
    expect(within(row).getByTestId('genres').textContent).toBe('Science Fiction, Adventure');
    expect(within(row).getByTestId('cast').textContent).toBe('With Timothée Chalamet, Zendaya');
    expect(within(row).getByTestId('overview').textContent).toBe(rich.overview);
  });

  it('T-WADD-011b · the poster is decorative (alt="") beside the name, from the card image base', () => {
    render(<TitleSearchResults results={[rich]} onSelect={vi.fn()} testIds={ids} />);
    const poster = screen.getByTestId('poster');
    expect(poster.getAttribute('alt')).toBe('');
    expect(poster.getAttribute('src')).toBe('https://image.tmdb.org/t/p/w154/p.jpg');
  });

  it('T-WADD-011c · no poster is a neutral placeholder, and missing fields are simply omitted', () => {
    render(<TitleSearchResults results={[bare]} onSelect={vi.fn()} testIds={ids} />);

    expect(screen.queryByTestId('poster')).toBeNull();
    expect(document.querySelector('.title-search-thumb--empty')).not.toBeNull();
    expect(screen.queryByTestId('genres')).toBeNull();
    expect(screen.queryByTestId('cast')).toBeNull();
    expect(screen.queryByTestId('overview')).toBeNull();
    expect(screen.getByTestId('type').textContent).toBe('TV');
  });

  it('T-WADD-011d · the shared rows serve the Waiting add and the Library add dialog alike', async () => {
    await openAndSearch([rich]);
    expect(document.querySelector('.title-search-result__cast')).not.toBeNull();
  });
});

describe('T-WADD-012 · keyboard and accessible names', () => {
  it('T-WADD-012a · each action is a button whose description names the title, year and type', () => {
    render(<TitleSearchResults results={[rich]} onSelect={vi.fn()} testIds={ids} />);
    const button = screen.getByTestId('select-1');

    expect(button.tagName).toBe('BUTTON');
    const description = button
      .getAttribute('aria-describedby')
      ?.split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(description).toContain('Dune');
    expect(description).toContain('2021');
    expect(description).toContain('Movie');
  });

  it('T-WADD-012b · a result is chosen with the keyboard alone', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<TitleSearchResults results={[rich, bare]} onSelect={onSelect} testIds={ids} />);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByTestId('select-1'));
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(bare);
  });
});
