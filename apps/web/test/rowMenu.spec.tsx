/**
 * The §2.3 row menu and the two dialogs it opens (`specs/ui.md` §2.2/§2.3,
 * `specs/ux-states.md` §3.1) — `T-UX-030`.
 *
 * ⚠ THIS FILE EXISTS BECAUSE TWO FINISHED FEATURES WERE UNREACHABLE, AND THE
 * WHOLE SUITE WAS GREEN OVER IT. `SuppressDialog` (TASK-102, 18 passing cases)
 * and `FixMatchDialog` (TASK-111, 16 passing cases) were both fully built and
 * mounted by nothing: `ListPage` rendered `<TitleList items={items} />` with no
 * callbacks, so `TitleRow`'s `onOpenMenu?.(item)` and `onFixMatch?.(item)`
 * optional-chained to `undefined` on every click. `apiClient` had no `fixMatch`
 * method at all, so even a wired menu could not have completed the action.
 *
 * US-030 AC-1 — "the owner chooses fix match ... they can search TMDB from the
 * row" — was therefore unimplemented in the running app while its named test
 * (`T-FIX-010`, an INTEGRATION test of the server route) passed, and while
 * `T-UI-020` passed against the dialog in isolation.
 *
 * ⚠ THE GENERALISABLE LESSON, AND WHY THE CASES BELOW ARE SHAPED AS THEY ARE:
 * a component test that mounts the component under test can never discover
 * that nothing mounts it, and an a11y or tap-target sweep counts an inert
 * button as happily as a working one. Every case here therefore drives
 * `ListPage` — the page the owner actually gets — and asserts what happens
 * AFTER the click, never merely that the affordance is present.
 */

import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ListPage, type ListPageProps } from '../src/pages/ListPage';
import type { TitleListItem } from '../src/components/TitleRow';
import { SUPPRESS_CONFIRM_BODY } from '../src/copy';
import { withName } from '../src/components/SuppressDialog';

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
  genres: ['Science Fiction'],
  runtimeMinutes: 155,
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
  badges: [{ service: 'max', listingId: '01J8ZY', dateAdded: '2026-05-01' }],
};

/** All four row-action calls, resolved happily unless a case overrides one. */
function wiring(over: Partial<ListPageProps> = {}): ListPageProps {
  return {
    items: [DUNE, ARRIVAL],
    total: 2,
    onSuppress: vi.fn().mockResolvedValue({
      suppressionId: 'supp:tmdb:movie:438631',
      workIdentity: 'tmdb:movie:438631',
      alreadySuppressed: false,
    }),
    onUnsuppress: vi.fn().mockResolvedValue({ active: false, restoredAnything: false }),
    onSearchTmdb: vi.fn().mockResolvedValue({
      items: [
        {
          tmdbId: 438631,
          mediaType: 'movie' as const,
          name: 'Dune: Part Two',
          releaseYear: 2024,
          posterPath: '/p.jpg',
        },
      ],
    }),
    onFixMatch: vi.fn().mockResolvedValue({
      titleId: '01J8ZC',
      workIdentity: 'tmdb:movie:693134',
      preserved: {
        listingIds: ['01J8ZD'],
        dateAdded: { '01J8ZD': '2026-04-02' },
        sortDateAdded: '2026-04-02',
      },
      suppressionMigrated: null,
    }),
    ...over,
  };
}

function mount(over: Partial<ListPageProps> = {}) {
  const props = wiring(over);
  render(<ListPage {...props} />);
  return props;
}

/** Opens the `⋮` for a named row — the affordance the owner actually uses. */
async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
}

describe('T-UX-030 the row menu reaches the suppress and fix-match dialogs', () => {
  it('T-UX-030a: the row menu button OPENS a menu naming both actions', async () => {
    // ⚠ The assertion that would have failed on the shipped code. The `⋮`
    // rendered and was correctly labelled the whole time; nothing happened
    // when it was pressed.
    const user = userEvent.setup();
    mount();
    await openMenu(user, 'Dune');

    const menu = await screen.findByRole('menu', { name: 'Actions for Dune' });
    expect(within(menu).getByRole('menuitem', { name: 'Not interested' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Fix match' })).toBeTruthy();
  });

  it('T-UX-030b: "Not interested" opens the §3.1 CONFIRM step, and suppresses nothing yet', async () => {
    const user = userEvent.setup();
    const props = mount();
    await openMenu(user, 'Dune');
    await user.click(await screen.findByRole('menuitem', { name: 'Not interested' }));

    expect(screen.getByText(withName(SUPPRESS_CONFIRM_BODY, 'Dune'))).toBeTruthy();
    // §3.1 is a confirm state: opening the dialog must not be the action.
    expect(props.onSuppress).not.toHaveBeenCalled();
    expect(screen.getByTestId('title-row-01J8ZC')).toBeTruthy();
  });

  it('T-UX-030c: confirming the suppress CALLS the server and hides the row', async () => {
    const user = userEvent.setup();
    const props = mount();
    await openMenu(user, 'Dune');
    await user.click(await screen.findByRole('menuitem', { name: 'Not interested' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Not interested' }),
    );

    await waitFor(() => {
      expect(props.onSuppress).toHaveBeenCalledWith('01J8ZC');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('title-row-01J8ZC')).toBeNull();
    });
    // ⚠ Only the suppressed row goes. A menu that emptied the list would also
    // satisfy "the row is gone".
    expect(screen.getByTestId('title-row-01J8ZZ')).toBeTruthy();
  });

  it('T-UX-030j: a row is hidden only once the SERVER has confirmed the suppress', async () => {
    // ⚠ The case that separates "hide when the server confirmed" from "hide
    // optimistically". `SuppressDialog` reports `pending` while the POST is in
    // flight and `suppressed` only once it lands (`T-UX-085a`). Hiding on
    // `pending` passes every other case in this file — the row is restored
    // when the error arrives, so an end-state assertion sees nothing wrong —
    // yet it makes the row vanish mid-request and stay vanished for as long as
    // a slow or hanging request takes. TASK-102 rejected optimistic-then-
    // reconcile explicitly, so the assertion has to be made WHILE pending.
    let release!: (v: unknown) => void;
    const inFlight = new Promise((resolve) => {
      release = resolve;
    });
    const user = userEvent.setup();
    const props = mount({ onSuppress: vi.fn().mockReturnValue(inFlight) });
    await openMenu(user, 'Dune');
    await user.click(await screen.findByRole('menuitem', { name: 'Not interested' }));
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Not interested' }),
    );

    await waitFor(() => {
      expect(props.onSuppress).toHaveBeenCalledWith('01J8ZC');
    });
    // Still in flight: nothing has been confirmed, so nothing may disappear.
    expect(screen.getByTestId('title-row-01J8ZC')).toBeTruthy();

    release({
      suppressionId: 'supp:tmdb:movie:438631',
      workIdentity: 'tmdb:movie:438631',
      alreadySuppressed: false,
    });
    await waitFor(() => {
      expect(screen.queryByTestId('title-row-01J8ZC')).toBeNull();
    });
  });

  it('T-UX-030d: "Fix match" opens a dialog whose search REACHES TMDB', async () => {
    // The US-030 AC-1 path end to end at component level: from the row, to a
    // search, to results the owner can choose from.
    const user = userEvent.setup();
    const props = mount();
    await openMenu(user, 'Dune');
    await user.click(await screen.findByRole('menuitem', { name: 'Fix match' }));

    await user.type(screen.getByRole('searchbox'), 'dune part two');
    await waitFor(
      () => {
        expect(props.onSearchTmdb).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
    expect(await screen.findByText('Dune: Part Two')).toBeTruthy();
  });

  it('T-UX-030e: an UNMATCHED row goes straight to fix match, with no menu step', async () => {
    // §2.2: an unmatched row offers "Find a match" instead of the `⋮`. There
    // is no identity to suppress yet, so a two-item menu would offer one item.
    const user = userEvent.setup();
    const props = mount({
      items: [{ ...DUNE, matchState: 'unmatched', name: 'DUNE PART TWO' }],
      total: 1,
    });
    await user.click(screen.getByRole('button', { name: 'Find a match' }));

    expect(screen.queryByRole('menu')).toBeNull();
    await user.type(screen.getByRole('searchbox'), 'dune');
    await waitFor(
      () => {
        expect(props.onSearchTmdb).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );
  });

  it('T-UX-030f: cancelling the menu opens NOTHING and changes NOTHING', async () => {
    const user = userEvent.setup();
    const props = mount();
    await openMenu(user, 'Dune');
    await user.click(await screen.findByRole('menuitem', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(props.onSuppress).not.toHaveBeenCalled();
    expect(props.onFixMatch).not.toHaveBeenCalled();
    expect(screen.getByTestId('title-row-01J8ZC')).toBeTruthy();
  });

  it('T-UX-030g: the menu acts on the row it was opened from, not the first row', async () => {
    // An off-by-one here is silent and destructive: the owner suppresses the
    // wrong title and the dialog names it correctly while doing so.
    const user = userEvent.setup();
    const props = mount();
    await openMenu(user, 'Arrival');
    await user.click(await screen.findByRole('menuitem', { name: 'Not interested' }));

    expect(screen.getByText(withName(SUPPRESS_CONFIRM_BODY, 'Arrival'))).toBeTruthy();
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Not interested' }),
    );
    await waitFor(() => {
      expect(props.onSuppress).toHaveBeenCalledWith('01J8ZZ');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('title-row-01J8ZZ')).toBeNull();
    });
    expect(screen.getByTestId('title-row-01J8ZC')).toBeTruthy();
  });

  it('T-UX-030h: a row menu is NOT offered when the container wired no handlers', async () => {
    // ⚠ ALL FOUR OR NONE. A menu over missing handlers is the exact defect
    // this file exists to close, so the page must render no affordance rather
    // than an inert one. Asserted on the ABSENCE of the button, because a
    // present-but-dead button is indistinguishable from a working one to
    // every other kind of test.
    render(<ListPage items={[DUNE]} total={1} />);
    expect(screen.queryByRole('button', { name: 'Actions for Dune' })).toBeNull();
  });

  it('T-UX-030i: the fix-match completes against the row it was opened from', async () => {
    // ⚠ The strongest available proof that the dialog got the right row: not
    // that it displays a name, but that the WRITE lands on the right title.
    // An off-by-one here re-points the wrong work while the confirmation reads
    // perfectly.
    const user = userEvent.setup();
    const props = mount();
    await openMenu(user, 'Arrival');
    await user.click(await screen.findByRole('menuitem', { name: 'Fix match' }));

    const search = screen.getByRole('searchbox');
    expect(search.getAttribute('placeholder')).toContain('Arrival');

    await user.type(search, 'dune');
    await screen.findByTestId('tmdb-results');
    await user.click(screen.getByTestId('select-result-438631'));
    await user.click(screen.getByTestId('confirm-fix-match'));

    await waitFor(() => {
      expect(props.onFixMatch).toHaveBeenCalledWith('01J8ZZ', {
        tmdbId: 438631,
        mediaType: 'movie',
        confirmDuplicate: false,
      });
    });
  });
});
