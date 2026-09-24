/**
 * #371 / TASK-248 — the Add a title dialog's layout and states.
 *
 * `T-ADDUI-001` — result rows keep title, year and type separate and
 * meaningful without optional metadata; the selection action is described by
 * its row; close, retry and confirmation feedback are explicit.
 *
 * `T-ADDUI-002` — Fix match renders the same shared result rows without losing
 * its test contract, and the stylesheet bounds thumbnails, generates the
 * separator and keeps one sticky, non-nested scroll surface.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  AddTitleDialog,
  type AddTitleDialogProps,
  type AddTitleResult,
} from '../src/components/AddTitleDialog';
import { FixMatchDialog, type TmdbSearchResult } from '../src/components/FixMatchDialog';
import { ADD_TITLE_CLOSE_LABEL } from '../src/copy';

const LONG_NAME =
  'The Extraordinarily Long and Deliberately Unwrapped Title of a Documentary Series About Everything';

const MATRIX: TmdbSearchResult = {
  tmdbId: 603,
  mediaType: 'movie',
  name: 'The Matrix',
  releaseYear: 1999,
  posterPath: '/matrix.jpg',
};
const BARE: TmdbSearchResult = {
  tmdbId: 9001,
  mediaType: 'tv',
  name: LONG_NAME,
  releaseYear: null,
  posterPath: null,
};

function mount(over: Partial<AddTitleDialogProps> = {}, items = [MATRIX, BARE]) {
  const searchTmdb = vi.fn(over.searchTmdb ?? (() => Promise.resolve({ items })));
  const addTitle = vi.fn(
    over.addTitle ??
      (() => Promise.resolve({ titleId: 't1', name: 'The Matrix', titleWasCreated: true })),
  );
  const onClose = vi.fn();
  render(<AddTitleDialog searchTmdb={searchTmdb} addTitle={addTitle} onClose={onClose} />);
  return { searchTmdb, addTitle, onClose, user: userEvent.setup() };
}

async function search(user: ReturnType<typeof userEvent.setup>, query = 'matrix') {
  await user.type(screen.getByTestId('add-title-search-input'), query);
  return screen.findByTestId('add-title-results');
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest('li');
  if (row === null) throw new Error(`no row for ${name}`);
  return row;
}

describe('T-ADDUI-001 — Add a title result rows and states', () => {
  it('T-ADDUI-001a: title, year and type are separate elements with no inline separator text', async () => {
    const { user } = mount();
    await search(user);
    const row = rowFor('The Matrix');
    const name = within(row).getByTestId('add-result-name');
    expect(name.textContent).toBe('The Matrix');
    const meta = row.querySelector('.title-search-result__meta');
    expect([...(meta?.children ?? [])].map((node) => node.textContent)).toEqual(['1999', 'Movie']);
    // The · is CSS-generated so it never enters the accessible text.
    expect(row.textContent).not.toContain('·');
    expect(name.contains(meta)).toBe(false);
  });

  it('T-ADDUI-001b: absent year and poster leave a meaningful type and a decorative placeholder', async () => {
    const { user } = mount();
    await search(user);
    const row = rowFor(LONG_NAME);
    const meta = row.querySelector('.title-search-result__meta');
    expect([...(meta?.children ?? [])].map((node) => node.textContent)).toEqual(['TV']);
    expect(row.querySelector('img')).toBeNull();
    const placeholder = row.querySelector('.title-search-thumb--empty');
    expect(placeholder?.getAttribute('aria-hidden')).toBe('true');
    expect(row.querySelector('img, .title-search-thumb')).not.toBeNull();
  });

  it('T-ADDUI-001c: a long title is rendered complete, never truncated in markup', async () => {
    const { user } = mount();
    await search(user);
    expect(within(rowFor(LONG_NAME)).getByTestId('add-result-name').textContent).toBe(LONG_NAME);
  });

  it('T-ADDUI-001d: one Select per result, named Select and described by its own row', async () => {
    const { user } = mount();
    const list = await search(user);
    const buttons = within(list).getAllByRole('button');
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toHaveAccessibleName('Select');
    }
    expect(buttons[0]).toHaveAccessibleDescription(/The Matrix.*1999.*Movie/);
    expect(buttons[1]).toHaveAccessibleDescription(new RegExp(`^${LONG_NAME}\\s*TV$`));
    expect(rowFor('The Matrix').querySelector('img')?.getAttribute('src')).toContain(
      '/w154/matrix.jpg',
    );
  });

  it('T-ADDUI-001e: search receives initial focus and the labelled close control dismisses', async () => {
    const { onClose, user } = mount();
    expect(screen.getByTestId('add-title-search-input')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: ADD_TITLE_CLOSE_LABEL }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('T-ADDUI-001f: an unavailable search offers Retry for the same query', async () => {
    const searchTmdb = vi
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ items: [MATRIX] });
    const { user } = mount({ searchTmdb });
    await user.type(screen.getByTestId('add-title-search-input'), 'matrix');
    await user.click(await screen.findByTestId('add-search-retry'));
    expect(await screen.findByTestId('add-title-results')).toBeTruthy();
    expect(searchTmdb.mock.calls.map(([query]) => query)).toEqual(['matrix', 'matrix']);
  });

  it('T-ADDUI-001g: a failed add shows no success and Back keeps the explicit choices', async () => {
    const addTitle = vi
      .fn()
      .mockRejectedValueOnce(new Error('store down'))
      .mockResolvedValueOnce({ titleId: 't1', name: 'The Matrix', titleWasCreated: true });
    const { user } = mount({ addTitle });
    await search(user);
    await user.click(screen.getByTestId('add-select-603'));
    expect(screen.getByTestId('add-selected-summary').textContent).toContain('The Matrix');
    await user.click(screen.getByTestId('add-service-netflix'));
    await user.click(screen.getByTestId('confirm-add-title'));

    expect(await screen.findByTestId('add-failed')).toBeTruthy();
    expect(screen.queryByTestId('add-title-done')).toBeNull();
    expect(addTitle).toHaveBeenCalledOnce();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('add-service-netflix')).toBeChecked();
    expect(addTitle).toHaveBeenCalledOnce();

    await user.click(screen.getByTestId('confirm-add-title'));
    expect(await screen.findByTestId('add-title-done')).toBeTruthy();
    expect(addTitle).toHaveBeenCalledTimes(2);
  });
  it('T-ADDUI-001h: Retry resubmits the identical request and success appears only after it resolves', async () => {
    const pending: { resolve?: (value: AddTitleResult) => void } = {};
    const addTitle = vi
      .fn()
      .mockRejectedValueOnce(new Error('store down'))
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            pending.resolve = done;
          }),
      );
    const { user } = mount({ addTitle });
    await search(user);
    await user.click(screen.getByTestId('add-select-603'));
    await user.click(screen.getByTestId('add-service-max'));
    await user.click(screen.getByTestId('confirm-add-title'));
    await user.click(await screen.findByTestId('add-submit-retry'));

    expect(screen.getByTestId('confirm-add-title')).toBeDisabled();
    expect(screen.queryByTestId('add-title-done')).toBeNull();
    expect(screen.queryByRole('button', { name: ADD_TITLE_CLOSE_LABEL })).toBeNull();
    expect(addTitle.mock.calls).toEqual([
      [{ tmdbId: 603, mediaType: 'movie', service: 'max' }],
      [{ tmdbId: 603, mediaType: 'movie', service: 'max' }],
    ]);

    pending.resolve?.({ titleId: 't1', name: 'The Matrix', titleWasCreated: true });
    await waitFor(() => expect(screen.getByTestId('add-title-done')).toBeTruthy());
  });
});

const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const css = readFileSync(join(WEB_ROOT, 'src', 'index.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css)?.[1] ?? '';
}

describe('T-ADDUI-002 — one shared, bounded result layout', () => {
  it('T-ADDUI-002a: Fix match renders the shared rows and keeps its existing test contract', async () => {
    const user = userEvent.setup();
    render(
      <FixMatchDialog
        titleId="t"
        name="Matrix"
        badges={[]}
        searchTmdb={() => Promise.resolve({ items: [MATRIX, BARE] })}
        fixMatch={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await user.type(screen.getByTestId('tmdb-search-input'), 'matrix');
    const list = await screen.findByTestId('tmdb-results');
    expect(list.className).toBe('title-search-results');
    expect(list.querySelectorAll('li.title-search-result')).toHaveLength(2);
    expect(screen.getAllByTestId('result-year').map((node) => node.textContent)).toEqual(['1999']);
    expect(screen.getAllByTestId('result-type').map((node) => node.textContent)).toEqual([
      'Movie',
      'TV',
    ]);
    expect(screen.getAllByTestId('result-poster')).toHaveLength(1);
    expect(screen.getByTestId('select-result-9001')).toHaveAccessibleName('Select');
  });

  it('T-ADDUI-002b: thumbnails are a bounded 2:3 box and the separator is generated', () => {
    const thumb = ruleFor('.title-search-thumb');
    expect(thumb).toMatch(/inline-size:\s*3rem/);
    expect(thumb).toMatch(/aspect-ratio:\s*2\s*\/\s*3/);
    expect(thumb).toMatch(/object-fit:\s*cover/);
    expect(css).toMatch(/\.title-search-result__meta\s*>\s*span\s*\+\s*span::before/);
    expect(ruleFor('.title-search-result__name')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('T-ADDUI-002c: the head is sticky and results never become a second scroller', () => {
    expect(ruleFor('.title-search-head')).toMatch(/position:\s*sticky/);
    expect(ruleFor('.title-search-results')).not.toMatch(/overflow/);
    expect(ruleFor('.dialog--overlay')).toMatch(/overflow-y:\s*auto/);
  });
});
