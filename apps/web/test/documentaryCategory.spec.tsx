/**
 * #456 — `T-DOC-003`: Documentary in the web app (PRD `A62`, US-071).
 *
 * The category is derived by the API; the web shows it through the shared
 * `TITLE_CATEGORY_LABELS` registry, offers it in the filter and in the owner's
 * category override, and keeps dropping unknown URL values.
 */

import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TITLE_CATEGORIES } from '@nextup/domain';

import { TitleCategoryDialog } from '../src/components/TitleCategoryDialog';
import { activeFilterChips, applyFilters, parseFilters } from '../src/components/FilterBar';
import { TitleRow, type TitleListItem } from '../src/components/TitleRow';

const BASE: TitleListItem = {
  titleId: 'doc-1',
  workIdentity: 'tmdb:movie:9',
  matchState: 'matched',
  name: 'Reel Life',
  mediaType: 'movie',
  releaseYear: 2025,
  genres: ['Documentary'],
  runtimeMinutes: 90,
  posterPath: null,
  badges: [{ service: 'netflix', listingId: 'l-1', dateAdded: '2026-04-02' }],
  sortDateAdded: '2026-04-02',
  dateAddedLabel: 'Added to nextup 2 Apr 2026',
};

afterEach(cleanup);

describe('T-DOC-003 Documentary label, filter and override in the web app', () => {
  it('T-DOC-003a the row shows Documentary for a documentary category, and Movie/TV otherwise', () => {
    const { rerender } = render(
      <MemoryRouter>
        <TitleRow item={{ ...BASE, category: 'documentary' }} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('media-type')).toHaveTextContent('Documentary');
    rerender(
      <MemoryRouter>
        <TitleRow item={{ ...BASE, mediaType: 'tv', category: 'tv' }} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('media-type')).toHaveTextContent('TV');
    expect(screen.getByTestId('media-type')).not.toHaveTextContent('Documentary');
  });
  it('T-DOC-003b the category URL parameter round-trips and unknown values are still dropped', () => {
    const filters = parseFilters(
      new URLSearchParams('category=documentary&category=documentaries&type=documentary'),
    );
    expect(filters.categories).toEqual(['documentary']);
    expect(filters.types).toEqual([]);
    expect(activeFilterChips(filters)).toEqual(['Documentary']);
    expect(applyFilters(new URLSearchParams('sort=name'), filters).toString()).toBe(
      'sort=name&category=documentary',
    );
  });
  it('T-DOC-003c the category override offers Documentary and saves it explicitly', async () => {
    const save = vi.fn().mockResolvedValue({ titleId: 'doc-1', categoryOverride: 'documentary' });
    const onSaved = vi.fn();
    render(
      <TitleCategoryDialog
        item={{ ...BASE, category: 'movie', automaticCategory: 'movie' }}
        save={save}
        offline={false}
        onClose={vi.fn()}
        onSaved={onSaved}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'Title category' });
    expect(within(dialog).getAllByRole('radio')).toHaveLength(TITLE_CATEGORIES.length + 1);
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Documentary' }));
    expect(save).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save category' }));
    expect(save).toHaveBeenCalledWith('doc-1', { categoryOverride: 'documentary' });
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
