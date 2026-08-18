/**
 * TASK-038 - the combined-list row (`specs/ui.md` §2.2).
 *
 * Tests: `T-UI-010` (US-018 AC-5), `T-LIST-018` (US-021 AC-3), `T-UI-012`
 * (US-038 AC-3).
 *
 * `T-LIST-018` lives here rather than with TASK-035 by `specs/testing.md` §19.3:
 * its assertion is about a RENDERED label, and until `TitleRow.tsx` existed
 * there was nothing for it to fail on. The domain half - that `dateAddedLabel()`
 * produces the marker - is `T-LIST-034`. This is the other half: that the
 * component actually shows what the server computed instead of quietly
 * rebuilding it.
 */

import { render as rtlRender, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { DATE_ADDED_LABEL_MARKER } from '@nextup/domain';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TitleRow, TMDB_IMAGE_BASE, type TitleListItem } from '../src/components/TitleRow';
import { ListPage } from '../src/pages/ListPage';

/** `ListPage` mounts the freshness strip, whose chips are router `Link`s. */
function render(ui: ReactElement): ReturnType<typeof rtlRender> {
  return rtlRender(ui, { wrapper: MemoryRouter });
}

const DUNE: TitleListItem = {
  titleId: '01J8ZC',
  workIdentity: 'tmdb:movie:438631',
  matchState: 'matched',
  name: 'Dune',
  mediaType: 'movie',
  releaseYear: 2021,
  genres: ['Science Fiction', 'Adventure'],
  runtimeMinutes: 155,
  posterPath: '/d5NXSklXo0qyIYkgV94XAgMIckC.jpg',
  badges: [
    { service: 'netflix', listingId: '01J8ZD', dateAdded: '2026-04-02' },
    { service: 'max', listingId: '01J8ZE', dateAdded: '2026-06-11' },
  ],
  sortDateAdded: '2026-04-02',
  dateAddedLabel: 'Added to nextup 2 Apr 2026',
};

function item(overrides: Partial<TitleListItem>): TitleListItem {
  return { ...DUNE, ...overrides };
}

function renderRow(overrides: Partial<TitleListItem> = {}): HTMLElement {
  render(
    <ul>
      <TitleRow item={item(overrides)} />
    </ul>,
  );
  return screen.getByTestId(`title-row-${item(overrides).titleId}`);
}

/** Every element in the subtree carrying a URL attribute. */
function urlAttributes(root: HTMLElement): string[] {
  const urls: string[] = [];
  for (const el of root.querySelectorAll('[href], [src], [srcset], [action], [data-url]')) {
    for (const name of ['href', 'src', 'srcset', 'action', 'data-url']) {
      const value = el.getAttribute(name);
      if (value !== null) urls.push(value);
    }
  }
  return urls;
}

describe('T-UI-010 - the row shows poster, name, type, year, date-added label and badges', () => {
  it('T-UI-010a renders all six elements of §2.2 for a matched title', () => {
    const row = renderRow();

    expect(within(row).getByTestId('poster')).toHaveAttribute(
      'src',
      `${TMDB_IMAGE_BASE}/d5NXSklXo0qyIYkgV94XAgMIckC.jpg`,
    );
    expect(within(row).getByTestId('title-name')).toHaveTextContent('Dune');
    expect(within(row).getByTestId('media-type')).toHaveTextContent('Movie');
    expect(within(row).getByTestId('release-year')).toHaveTextContent('2021');
    expect(within(row).getByTestId('date-added-label')).toHaveTextContent(
      'Added to nextup 2 Apr 2026',
    );
    expect(within(row).getByTestId('badge-netflix')).toBeInTheDocument();
    expect(within(row).getByTestId('badge-max')).toBeInTheDocument();
  });

  it('T-UI-010b gives the name the only heading weight in the row', () => {
    const row = renderRow();
    const headings = within(row).getAllByRole('heading');

    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Dune');
  });

  it('T-UI-010c marks the poster decorative so the name is not announced twice', () => {
    const row = renderRow();

    // `alt=""` removes it from the a11y tree, so querying by img role finds
    // nothing - that absence IS the assertion (§2.2).
    expect(within(row).queryAllByRole('img')).toHaveLength(0);
    expect(within(row).getByTestId('poster')).toHaveAttribute('alt', '');
  });

  it('T-UI-010d shows a placeholder tile, never a broken image, when there is no poster', () => {
    const row = renderRow({ posterPath: null });

    expect(within(row).getByTestId('poster-placeholder')).toBeInTheDocument();
    expect(within(row).queryByTestId('poster')).toBeNull();
    expect(row.querySelectorAll('img')).toHaveLength(0);
  });

  it('T-UI-010e renders one row with two badges for a work saved on both services', () => {
    render(<ListPage items={[DUNE]} />);

    // The collapse is the product (REQ-026): two listings, ONE row.
    expect(screen.getAllByTestId(/^title-row-/)).toHaveLength(1);
    expect(within(screen.getByTestId('badges')).getAllByRole('listitem')).toHaveLength(2);
  });

  it('T-UI-010f labels badges with text, never colour alone', () => {
    const badges = within(renderRow()).getByTestId('badges');

    expect(within(badges).getByTestId('badge-netflix')).toHaveTextContent('Netflix');
    expect(within(badges).getByTestId('badge-max')).toHaveTextContent('Max');
  });

  it('T-UI-010g renders nothing at all for an empty genre list - never "Unknown"', () => {
    const row = renderRow({ genres: [] });

    expect(within(row).queryByTestId('genres')).toBeNull();
    expect(row.textContent ?? '').not.toMatch(/unknown|n\/a|—|not available/i);
  });

  it('T-UI-010h omits the year rather than inventing one when the release year is unknown', () => {
    const row = renderRow({ releaseYear: null });

    expect(within(row).queryByTestId('release-year')).toBeNull();
    expect(within(row).getByTestId('title-name')).toHaveTextContent('Dune');
  });

  it('T-UI-010i shows the raw text, an Unidentified chip and a Find a match action when unmatched', async () => {
    const onFixMatch = vi.fn();
    const unmatched = item({
      matchState: 'unmatched',
      name: 'DUNE PART TVVO',
      posterPath: null,
      genres: [],
      releaseYear: null,
    });
    render(
      <ul>
        <TitleRow item={unmatched} onFixMatch={onFixMatch} />
      </ul>,
    );
    const row = screen.getByTestId(`title-row-${unmatched.titleId}`);

    expect(within(row).getByTestId('title-name')).toHaveTextContent('DUNE PART TVVO');
    expect(within(row).getByTestId('unidentified-chip')).toHaveTextContent('Unidentified');

    await userEvent.click(within(row).getByRole('button', { name: 'Find a match' }));
    expect(onFixMatch).toHaveBeenCalledWith(unmatched);
    // An unmatched row has no identity to suppress against yet (REQ-071), so it
    // offers the match action instead of the menu - not both.
    expect(within(row).queryByTestId('row-menu')).toBeNull();
  });

  it('T-UI-010j the row menu reports the intent rather than acting on a single tap', async () => {
    const onOpenMenu = vi.fn();
    render(
      <ul>
        <TitleRow item={DUNE} onOpenMenu={onOpenMenu} />
      </ul>,
    );
    const menu = screen.getByTestId('row-menu');

    expect(menu).toHaveAttribute('aria-haspopup', 'menu');
    expect(menu).toHaveAccessibleName('Actions for Dune');
    await userEvent.click(menu);
    expect(onOpenMenu).toHaveBeenCalledWith(DUNE);
  });

  it('T-UI-010k renders without action handlers wired, as the read-only list does', async () => {
    render(<ListPage items={[DUNE]} />);

    await userEvent.click(screen.getByTestId('row-menu'));
    expect(screen.getByTestId('title-name')).toHaveTextContent('Dune');
  });
});

describe('T-LIST-018 - every rendered date label is honest about whose date it is', () => {
  it('T-LIST-018a renders the API label verbatim', () => {
    const row = renderRow({ dateAddedLabel: 'Added to nextup 11 Jun 2026' });

    expect(within(row).getByTestId('date-added-label').textContent).toBe(
      'Added to nextup 11 Jun 2026',
    );
  });

  it('T-LIST-018b every date label rendered by the list contains "to nextup"', () => {
    render(
      <ListPage
        items={[
          DUNE,
          item({ titleId: '01J8ZF', dateAddedLabel: 'Added to nextup 11 Jun 2026' }),
          item({ titleId: '01J8ZG', dateAddedLabel: 'Added to nextup today' }),
        ]}
      />,
    );

    const labels = screen.getAllByTestId('date-added-label');
    expect(labels).toHaveLength(3);
    for (const label of labels) {
      expect(label.textContent ?? '').toContain(DATE_ADDED_LABEL_MARKER);
    }
  });

  it('T-LIST-018c no bare "Added" label exists anywhere in a rendered row', () => {
    render(<ListPage items={[DUNE, item({ titleId: '01J8ZF', posterPath: null, genres: [] })]} />);
    const list = screen.getByTestId('title-list');

    // Walk text nodes rather than reading the container's whole textContent:
    // concatenation across siblings can make a bare "Added" look adjacent to a
    // "to nextup" that belongs to a different row entirely.
    const walker = document.createTreeWalker(list, NodeFilter.SHOW_TEXT);
    let seen = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      if (!/\bAdded\b/.test(text)) continue;
      seen += 1;
      expect(text).toContain(DATE_ADDED_LABEL_MARKER);
    }
    expect(seen).toBe(2);
  });

  it('T-LIST-018d renders no date label at all when the API supplies none', () => {
    const row = renderRow({ dateAddedLabel: null, sortDateAdded: null });

    // The component must not fall back to a locally built string: REQ-061 has
    // exactly one implementation and it is server-side.
    expect(within(row).queryByTestId('date-added-label')).toBeNull();
    expect(row.textContent ?? '').not.toMatch(/\bAdded\b/);
  });
});

describe('T-UI-012 - the row makes no automated or credentialed approach to a streaming service', () => {
  const STREAMING_HOSTS = /netflix\.com|max\.com|hbomax\.com|hbo\.com/i;
  const CREDENTIAL_LIKE = /(token|auth|session|cookie|password|apikey|api_key|secret)=/i;

  it('T-UI-012a any anchor leaving the app is a plain new-tab link with noopener noreferrer', () => {
    render(<ListPage items={[DUNE, item({ titleId: '01J8ZF' })]} />);
    const anchors = [...screen.getByTestId('title-list').querySelectorAll('a')];

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') ?? '';
      if (!/^https?:/i.test(href)) continue;
      expect(anchor).toHaveAttribute('target', '_blank');
      const rel = anchor.getAttribute('rel') ?? '';
      expect(rel).toContain('noopener');
      expect(rel).toContain('noreferrer');
    }
  });

  it('T-UI-012b no URL in a row addresses a streaming service (NFR-010)', () => {
    render(<ListPage items={[DUNE, item({ titleId: '01J8ZF', posterPath: null })]} />);

    for (const url of urlAttributes(screen.getByTestId('title-list'))) {
      expect(url).not.toMatch(STREAMING_HOSTS);
    }
  });

  it('T-UI-012c no URL in a row carries a credential or token (NFR-009)', () => {
    render(<ListPage items={[DUNE]} />);

    for (const url of urlAttributes(screen.getByTestId('title-list'))) {
      expect(url).not.toMatch(CREDENTIAL_LIKE);
    }
  });

  it('T-UI-012d the only remote asset a row fetches is the TMDB poster', () => {
    render(<ListPage items={[DUNE]} />);

    const remote = urlAttributes(screen.getByTestId('title-list')).filter((url) =>
      /^https?:/i.test(url),
    );
    expect(remote).toEqual([`${TMDB_IMAGE_BASE}/d5NXSklXo0qyIYkgV94XAgMIckC.jpg`]);
  });
});
