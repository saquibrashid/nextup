/**
 * `T-UX-100`…`T-UX-105` — the five row/menu defects the owner hit on
 * 2026-09-10 (`specs/ui-refresh.md` §3, `docs/adr/ADR-0013-ui-refresh.md` §1).
 *
 * ⚠ **THESE ARE DEFECT REGRESSION TESTS, NOT DESIGN TESTS.** The owner
 * authorised this batch (OQ-4) ahead of the visual refresh precisely so the
 * fixes stay verifiable: bundled into a large restyle, nobody — including the
 * owner — can tell whether the menu was *fixed* or merely *moved*.
 *
 * ⚠ **Every case drives `ListPage`, never a component in isolation** — the
 * standing rule in `rowMenu.spec.tsx`, earned when two finished dialogs shipped
 * mounted by nothing. It matters more than usual here: REQ-105 is a defect in
 * *where a parent mounts a child*, so a test that mounted `RowMenu` itself
 * would be structurally incapable of detecting it.
 *
 * Several cases assert the stylesheet as a FILE. jsdom performs no layout, so
 * `getBoundingClientRect()` returns zeroes and any "is the button shorter than
 * the row" assertion passes vacuously whether the bug is present or not.
 * Reading the rule is honest about what is actually being checked.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { ListPage, type ListPageProps } from '../src/pages/ListPage';
import type { TitleListItem } from '../src/components/TitleRow';

const WEB_ROOT = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
  ? join(process.cwd(), 'apps', 'web')
  : process.cwd();
const css = readFileSync(join(WEB_ROOT, 'src', 'index.css'), 'utf8');
const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|})\\s*${escaped}\\s*{([^}]*)}`, 'm').exec(cssWithoutComments);
  return match?.[1] ?? '';
}

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
  imdbRating: null,
  metadataStale: false,
  posterPath: '/d5NXS.jpg',
  badges: [{ service: 'netflix', listingId: '01J8ZD', dateAdded: '2026-04-02' }],
  sortDateAdded: '2026-04-02',
  dateAddedLabel: 'Added to nextup 2 Apr 2026',
};

const ARRIVAL: TitleListItem = {
  ...DUNE,
  titleId: '01J8ZZ',
  workIdentity: 'tmdb:movie:329865',
  name: 'Arrival',
};

const SOLARIS: TitleListItem = {
  ...DUNE,
  titleId: '01J900',
  workIdentity: 'tmdb:movie:593',
  name: 'Solaris',
};

function wiring(over: Partial<ListPageProps> = {}): ListPageProps {
  return {
    items: [DUNE, ARRIVAL, SOLARIS],
    total: 3,
    onSuppress: vi
      .fn()
      .mockResolvedValue({ suppressionId: 's', workIdentity: 'x', alreadySuppressed: false }),
    onUnsuppress: vi.fn().mockResolvedValue({ active: false, restoredAnything: false }),
    onSearchTmdb: vi.fn().mockResolvedValue({ items: [] }),
    // ⚠ All four of suppress/unsuppress/search/fixMatch are required before
    // `ListPage` draws the ⋮ at all — the deliberate guard against the inert
    // button that shipped through Epics I and J. Omitting one here yields an
    // empty actions box and a confusing "button not found" failure.
    onFixMatch: vi.fn().mockResolvedValue({
      titleId: '01J8ZC',
      workIdentity: 'tmdb:movie:438631',
      preserved: { listingIds: ['01J8ZD'], dateAdded: {}, sortDateAdded: '2026-04-02' },
      suppressionMigrated: null,
    }),
    ...over,
  };
}

function mount(over: Partial<ListPageProps> = {}): void {
  render(<ListPage {...wiring(over)} />);
}

/** The `<li>` for a title — the element the menu must live inside. */
function rowFor(name: string): HTMLElement {
  const trigger = screen.getByRole('button', { name: `Actions for ${name}` });
  const row = trigger.closest('li');
  if (row === null) throw new Error(`no row element for ${name}`);
  return row;
}

async function openMenu(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
  return screen.findByRole('menu', { name: `Actions for ${name}` });
}

describe('REQ-105 — the row menu is anchored to the row it was opened from', () => {
  it('T-UX-100: the open menu is a DOM descendant of the row whose button was pressed', async () => {
    const user = userEvent.setup();
    mount();

    const menu = await openMenu(user, 'Dune');

    // ⚠ ANCESTRY, NOT SCREEN POSITION. A `position: fixed` overlay that happens
    // to land beside the row satisfies any coordinate check while remaining
    // exactly the detached element this requirement exists to eliminate — and
    // jsdom reports (0,0) for both anyway.
    expect(rowFor('Dune').contains(menu)).toBe(true);
  });

  it('T-UX-101: the LAST row also owns its menu — the load-more-sentinel ordering regression', async () => {
    const user = userEvent.setup();
    mount();

    const menu = await openMenu(user, 'Solaris');

    expect(rowFor('Solaris').contains(menu)).toBe(true);
    // The original defect mounted the menu after the sentinel: outside every
    // row, but nearest the last one — so the last row is precisely where a
    // broken implementation looks most convincing on screen.
    expect(rowFor('Dune').contains(menu)).toBe(false);
  });

  it('T-UX-100b: only one menu is open at a time, and it does not stay on the previous row', async () => {
    const user = userEvent.setup();
    mount();

    await openMenu(user, 'Dune');
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);

    const second = await openMenu(user, 'Arrival');
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(rowFor('Arrival').contains(second)).toBe(true);
  });

  it('T-UX-100c: the anchoring CSS is present — absolute inside a positioned actions box', () => {
    // Both halves are required. With only one, the menu silently reverts to
    // resolving against the page while keeping the correct DOM shape — the
    // original bug, in a form `T-UX-100` cannot see.
    expect(ruleFor('.row-menu')).toMatch(/position:\s*absolute/);
    expect(ruleFor('.title-row__actions')).toMatch(/position:\s*relative/);
  });
});

describe('REQ-106 — independent facts in the metadata line are separated', () => {
  it('T-UX-102: year, type and genres render in specs/ui.md §2.2 order with a CSS separator', () => {
    mount();

    const meta = screen.getAllByTestId('title-meta')[0];
    if (meta === undefined) throw new Error('no metadata line rendered');
    const order = Array.from(meta.querySelectorAll('span')).map((s) => s.dataset['testid']);
    expect(order).toEqual(['release-year', 'media-type', 'genres']);

    // The separator is generated, so the RULE is the assertion: jsdom does not
    // render `::before`, so checking the text would prove nothing either way.
    expect(cssWithoutComments).toMatch(/\.title-row__meta\s*>\s*span\s*\+\s*span::before/);
    expect(ruleFor('.title-row__meta')).toMatch(/display:\s*flex/);
  });

  it('T-UX-103: the separator is NOT in the accessible name — no "middot" between facts', () => {
    mount();

    // Guards the "simplification" that inlines the · into the JSX: identical on
    // screen, and a spoken character between every fact.
    expect(rowFor('Dune').textContent).not.toContain('·');
  });

  it('T-UX-102b: an empty genre list still renders nothing at all (US-019 AC-6 preserved)', () => {
    mount({ items: [{ ...DUNE, genres: [] }], total: 1 });

    expect(screen.queryByTestId('genres')).toBeNull();
    expect(screen.getByTestId('title-meta').textContent).not.toMatch(/unknown/i);
  });
});

describe('REQ-107 / REQ-108 — the row is a set of readable facts, not one block', () => {
  it('T-UX-104: the actions box does not stretch to the row height, and the 44px target is intact', () => {
    // `.title-row` is `display: flex`; the default `stretch` is what inflated
    // the ⋮ button into a full-height grey column.
    expect(ruleFor('.title-row__actions')).toMatch(/align-items:\s*flex-start/);

    // ⚠ REQ-107 narrows the BOX and must never shrink the TARGET — doing so
    // would regress a passing accessibility gate in order to fix an appearance.
    expect(ruleFor('.tap-target')).toMatch(/min-height:\s*var\(--tap-target-min\)/);
    expect(css).toMatch(/--tap-target-min:\s*44px/);
  });

  it('T-UX-105: the row body separates its lines by at least --space-2', () => {
    const gap = /gap:\s*var\(--space-(\d)\)/.exec(ruleFor('.title-row__body'));
    expect(gap).not.toBeNull();
    expect(Number(gap?.[1])).toBeGreaterThanOrEqual(2);
  });
});
