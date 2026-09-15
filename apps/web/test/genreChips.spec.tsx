/**
 * TASK-213 — the compact genre presentation and the display half of the
 * vocabulary fix (REQ-112/REQ-120, `specs/ui-refresh.md` §4.3/§4.4).
 *
 * Tests: `T-UX-125` (rendered half), `T-UX-126` (the facet), `T-UX-127`.
 *
 * The pure half of the map lives in `packages/domain/test/genres.spec.ts`.
 * These are the assertions that need a render: that the row actually shows the
 * normalised names, that the filter bar is offered the normalised vocabulary,
 * and that the `+n` overflow never hides a genre the owner is filtering on.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { GenreChips, GENRE_CHIP_LIMIT } from '../src/components/GenreChips';
import { TitleRow, type TitleListItem } from '../src/components/TitleRow';
import { collectGenres } from '../src/containers/ListRoute';

const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const CSS_CODE = readFileSync(join(WEB_ROOT, 'src', 'index.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

const BASE: TitleListItem = {
  titleId: '01J8ZC',
  workIdentity: 'tmdb:tv:1396',
  matchState: 'matched',
  name: 'Avatar: The Last Airbender',
  mediaType: 'tv',
  releaseYear: 2005,
  genres: ['Action & Adventure'],
  runtimeMinutes: 23,
  posterPath: null,
  badges: [{ service: 'netflix', listingId: '01J8ZD', dateAdded: '2026-04-02' }],
  sortDateAdded: '2026-04-02',
  dateAddedLabel: 'Added to nextup 2 Apr 2026',
};

function item(overrides: Partial<TitleListItem>): TitleListItem {
  return { ...BASE, ...overrides };
}

function renderChips(genres: readonly string[], activeGenres?: readonly string[]): void {
  render(
    <MemoryRouter>
      <p>
        <GenreChips genres={genres} activeGenres={activeGenres} />
      </p>
    </MemoryRouter>,
  );
}

function chipTexts(): string[] {
  const cell = screen.queryByTestId('genres');
  if (cell === null) return [];
  return Array.from(cell.querySelectorAll('[data-testid^="genre-chip-"]')).map(
    (node) => node.textContent ?? '',
  );
}

/* ------------------------------------------------------------------------ */
/* T-UX-125 — the rendered display half.                                    */
/* ------------------------------------------------------------------------ */

describe('T-UX-125 · ui-refresh.md §4.4 · the row renders the normalised vocabulary', () => {
  it('T-UX-125f: a TV row stored as `Action & Adventure` renders `Action` and `Adventure`', () => {
    render(
      <MemoryRouter>
        <ul>
          <TitleRow item={item({})} />
        </ul>
      </MemoryRouter>,
    );

    expect(chipTexts()).toStrictEqual(['Action', 'Adventure']);
    // ⚠ THE NEGATIVE IS THE OWNER'S ACTUAL COMPLAINT. They saw `Action`,
    // `Adventure` AND `Action & Adventure` in one filter list and asked why
    // the third existed. It must not survive anywhere in the row.
    expect(screen.getByTestId('genres').textContent).not.toContain('&');
  });

  it('T-UX-125g: normalisation runs in the ROW, not only in the facet', () => {
    // Asserted separately because the two call sites are independent and the
    // failure modes differ: normalising only the facet leaves the row showing
    // a chip whose name is not in the filter bar, and normalising only the row
    // leaves an option that always returns nothing.
    renderChips(['War & Politics', 'Drama']);

    expect(chipTexts()).toStrictEqual(['War', 'Drama']);
  });

  it('T-UX-125h: an empty genre list renders NOTHING — not an empty cell, not a `+0`', () => {
    // US-019 AC-6, and the `+0` is the case this task newly makes possible.
    renderChips([]);

    expect(screen.queryByTestId('genres')).toBeNull();
    expect(screen.queryByTestId('genre-overflow')).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* T-UX-126 — the facet offered to the filter bar.                          */
/* ------------------------------------------------------------------------ */

describe('T-UX-126 · ui-refresh.md §4.4 · no combined TV name reaches the filter bar', () => {
  it('T-UX-126d: collectGenres normalises, so a combined name is never an option', () => {
    const options = collectGenres([
      item({ titleId: 'a', genres: ['Action & Adventure'] }),
      item({ titleId: 'b', genres: ['Sci-Fi & Fantasy'] }),
      item({ titleId: 'c', genres: ['War & Politics'] }),
      item({ titleId: 'd', genres: ['Drama'] }),
    ]);

    expect(options).toStrictEqual([
      'Action',
      'Adventure',
      'Drama',
      'Fantasy',
      'Science Fiction',
      'War',
    ]);
  });

  it('T-UX-126e: a film and a TV title collapse to ONE option, not three', () => {
    // The owner's words: "would it not be easier just to click action and
    // adventure separately?" — yes, and this is what that means in the facet.
    const options = collectGenres([
      item({ titleId: 'a', mediaType: 'movie', genres: ['Action', 'Adventure'] }),
      item({ titleId: 'b', mediaType: 'tv', genres: ['Action & Adventure'] }),
    ]);

    expect(options).toStrictEqual(['Action', 'Adventure']);
  });
});

/* ------------------------------------------------------------------------ */
/* T-UX-127 — compact to one line, with `+n`, and the active-filter rule.   */
/* ------------------------------------------------------------------------ */

describe('T-UX-127 · ui-refresh.md §4.3 · compact genres with a `+n` overflow', () => {
  const MANY = ['Drama', 'Thriller', 'Crime', 'Mystery', 'Horror'];

  it('T-UX-127a: at or under the limit every genre shows and there is no `+n`', () => {
    renderChips(MANY.slice(0, GENRE_CHIP_LIMIT));

    expect(chipTexts()).toHaveLength(GENRE_CHIP_LIMIT);
    expect(screen.queryByTestId('genre-overflow')).toBeNull();
  });

  it('T-UX-127b: over the limit the rest collapse behind a `+n` that names the count', () => {
    renderChips(MANY);

    expect(chipTexts()).toStrictEqual(['Drama', 'Thriller', 'Crime']);
    const overflow = screen.getByTestId('genre-overflow');
    expect(overflow).toHaveTextContent(`+${MANY.length - GENRE_CHIP_LIMIT}`);
    // An unlabelled `+2` is silent to assistive technology, and this is the
    // only route to the hidden genres.
    expect(overflow).toHaveAccessibleName('Show 2 more genres');
  });

  it('T-UX-127c: the `+n` reveals the rest IN PLACE, not in a tooltip or a dialog', async () => {
    renderChips(MANY);

    await userEvent.click(screen.getByTestId('genre-overflow'));

    expect(chipTexts()).toStrictEqual(MANY);
    expect(screen.queryByTestId('genre-overflow')).toBeNull();
    // Still inside the same cell — a `title` attribute or a portal would be
    // invisible to touch, which is most of how this app is used.
    expect(within(screen.getByTestId('genres')).getAllByText(/Horror/)).toHaveLength(1);
  });

  it('T-UX-127d: ⚠ A GENRE IN THE ACTIVE FILTER IS ALWAYS VISIBLE, never behind `+n`', () => {
    // The load-bearing case. `Horror` is LAST in source order and would be cut
    // by any plain slice — so a row returned by `?genre=Horror` would show
    // three unrelated genres and a `+2`, and stop explaining the very filter
    // that produced it.
    renderChips(MANY, ['Horror']);

    expect(chipTexts()[0]).toBe('Horror');
    expect(chipTexts()).toContain('Horror');
    expect(screen.getByTestId('genre-overflow')).toHaveTextContent('+2');
  });

  it('T-UX-127e: more active genres than the limit widens the row rather than hiding one', () => {
    // ⚠ THE LIMIT YIELDS TO THE GUARANTEE, NOT THE OTHER WAY ROUND. With four
    // active genres and a limit of three, a `slice(0, LIMIT)` that merely
    // hoists would satisfy the limit and break the rule the limit exists
    // under — and it would look correct, because three of the four are there.
    renderChips(MANY, ['Drama', 'Thriller', 'Crime', 'Mystery']);

    expect(chipTexts()).toStrictEqual(['Drama', 'Thriller', 'Crime', 'Mystery']);
    expect(screen.getByTestId('genre-overflow')).toHaveTextContent('+1');
  });

  it('T-UX-127f: an active genre the title does not carry changes nothing', () => {
    // `?genre=Action` also returns TV rows via the §4.4 expansion, so a row
    // can legitimately match a filter whose exact name it does not carry. The
    // hoist must not crash or invent a chip for it.
    renderChips(['Drama', 'Thriller'], ['Comedy']);

    expect(chipTexts()).toStrictEqual(['Drama', 'Thriller']);
  });

  it('T-UX-127g: "at most one line" is held by the stylesheet as well as the count', () => {
    // ⚠ THE COUNT ALONE IS NOT THE REQUIREMENT. Three long genre names still
    // wrap at 320 px, and jsdom computes no layout so no render can see it.
    // `nowrap` plus an ellipsis is the other half; without `min-width: 0` the
    // ellipsis never engages and the row forces the page sideways instead.
    const rule = (selector: string): string =>
      new RegExp(`(?:^|[},])\\s*${selector}\\s*\\{([^}]*)\\}`).exec(CSS_CODE)?.[1] ?? '';

    expect(rule('\\.genre-chips')).toMatch(/flex-wrap:\s*nowrap/);
    expect(rule('\\.genre-chips')).toMatch(/min-width:\s*0/);
    // `inline-flex`, not `flex`: a block-level child of the `<p>` metadata line
    // would put the genres on a row of their own, which is the opposite of
    // compact.
    expect(rule('\\.genre-chips')).toMatch(/display:\s*inline-flex/);
    expect(rule('\\.genre-chips__chip')).toMatch(/text-overflow:\s*ellipsis/);
  });
});
