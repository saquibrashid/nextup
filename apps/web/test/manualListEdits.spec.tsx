/**
 * The two manual list edits at the level the owner actually meets them
 * (`specs/ui.md` §2.2/§2.3, `specs/ux-states.md` §2.14 and §3.8–§3.13) —
 * US-047 (add a title) and US-048 (remove one).
 *
 * ⚠ EVERY CASE DRIVES `ListPage`, NEVER THE DIALOG IN ISOLATION, for the
 * reason written at length in `rowMenu.spec.tsx`: two finished dialogs once
 * shipped mounted by nothing, and a component test that mounts its own subject
 * can never discover that. The API side of both routes is covered by
 * `T-MANUAL-001`…`T-MANUAL-013`; what is unprovable there is whether the owner
 * can reach either one.
 */

import { render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ListPage, type ListPageProps } from '../src/pages/ListPage';
import type { TitleListItem } from '../src/components/TitleRow';
import { REMOVE_TITLE_CONFIRM_BODY, ROW_MENU_REMOVE_LABEL } from '../src/copy';
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

/** A two-badge row — the case that makes "whole row, every service" visible. */
const ARRIVAL: TitleListItem = {
  ...DUNE,
  titleId: '01J8ZZ',
  workIdentity: 'tmdb:movie:329865',
  name: 'Arrival',
  badges: [
    { service: 'netflix', listingId: 'l-n', dateAdded: '2026-05-01' },
    { service: 'max', listingId: 'l-m', dateAdded: '2026-05-04' },
  ],
};

function wiring(over: Partial<ListPageProps> = {}): ListPageProps {
  return {
    items: [DUNE, ARRIVAL],
    total: 2,
    onSuppress: vi.fn().mockResolvedValue({
      suppressionId: 's',
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
      preserved: { listingIds: ['01J8ZD'], dateAdded: {}, sortDateAdded: '2026-04-02' },
      suppressionMigrated: null,
    }),
    onRemoveTitle: vi.fn().mockResolvedValue({ titleId: '01J8ZC', removedListingIds: ['01J8ZD'] }),
    onRestoreListing: vi.fn().mockResolvedValue({}),
    onAddTitle: vi
      .fn()
      .mockResolvedValue({ titleId: 'new', name: 'Dune: Part Two', titleWasCreated: true }),
    onReload: vi.fn(),
    ...over,
  };
}

function mount(over: Partial<ListPageProps> = {}): ListPageProps {
  const props = wiring(over);
  render(<ListPage {...props} />);
  return props;
}

async function openMenu(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: `Actions for ${name}` }));
}

describe('US-048 — removing a title by hand from the row menu', () => {
  it('T-MANUAL-016: the row menu offers Remove ALONGSIDE Not interested, not instead of it', async () => {
    // ⚠ THE POINT OF THE WHOLE FEATURE. The two are different decisions —
    // "this is not on my list" vs "never show me this work again" — and a
    // menu offering only one of them is what sent the owner looking for a
    // delete that did not exist. Asserting all three together is what stops a
    // later tidy-up collapsing them back into one item.
    const user = userEvent.setup();
    mount();
    await openMenu(user, 'Dune');

    const menu = await screen.findByRole('menu', { name: 'Actions for Dune' });
    expect(within(menu).getByRole('menuitem', { name: 'Not interested' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Fix match' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: ROW_MENU_REMOVE_LABEL })).toBeTruthy();
  });

  it('T-MANUAL-017: opening the remove dialog is a CONFIRM step and writes nothing', async () => {
    const user = userEvent.setup();
    const props = mount();
    await openMenu(user, 'Dune');
    await user.click(await screen.findByTestId('row-menu-remove'));

    expect(screen.getByTestId('remove-confirm-body').textContent).toBe(
      withName(REMOVE_TITLE_CONFIRM_BODY, 'Dune'),
    );
    expect(props.onRemoveTitle).not.toHaveBeenCalled();
    expect(screen.getByTestId('title-row-01J8ZC')).toBeTruthy();
  });

  it('T-MANUAL-018: confirming removes the row the menu was opened from, and only that row', async () => {
    const user = userEvent.setup();
    const props = mount();
    await openMenu(user, 'Arrival');
    await user.click(await screen.findByTestId('row-menu-remove'));
    await user.click(screen.getByTestId('confirm-remove-title'));

    await waitFor(() => {
      expect(props.onRemoveTitle).toHaveBeenCalledWith('01J8ZZ');
    });
    await waitFor(() => {
      expect(screen.queryByTestId('title-row-01J8ZZ')).toBeNull();
    });
    expect(screen.getByTestId('title-row-01J8ZC')).toBeTruthy();
  });

  it('T-MANUAL-019: undo restores EVERY removed listing, one call each', async () => {
    // ⚠ A two-badge row removes two listings, and an undo that restored only
    // the first would leave the row back on the list with a badge silently
    // missing — a partial restore that looks like a success.
    const user = userEvent.setup();
    const restore = vi.fn().mockResolvedValue({});
    const props = mount({
      onRemoveTitle: vi
        .fn()
        .mockResolvedValue({ titleId: '01J8ZZ', removedListingIds: ['l-n', 'l-m'] }),
      onRestoreListing: restore,
    });
    await openMenu(user, 'Arrival');
    await user.click(await screen.findByTestId('row-menu-remove'));
    await user.click(screen.getByTestId('confirm-remove-title'));

    await user.click(await screen.findByTestId('undo-remove-title'));
    await screen.findByTestId('remove-undone');

    expect(restore.mock.calls.map((call) => call[0])).toEqual(['l-n', 'l-m']);
    expect(screen.getByTestId('title-row-01J8ZZ')).toBeTruthy();
    expect(props.onRestoreListing).toBe(restore);
  });

  it('T-MANUAL-020: a 409 TITLE_NOT_ACTIVE reads as "already done", not as a failure', async () => {
    const user = userEvent.setup();
    const error = Object.assign(new Error('not active'), { code: 'TITLE_NOT_ACTIVE' });
    mount({ onRemoveTitle: vi.fn().mockRejectedValue(error) });
    await openMenu(user, 'Dune');
    await user.click(await screen.findByTestId('row-menu-remove'));
    await user.click(screen.getByTestId('confirm-remove-title'));

    expect(await screen.findByTestId('remove-not-active')).toBeTruthy();
    expect(screen.queryByTestId('remove-failed')).toBeNull();
  });

  it('T-MANUAL-021: a failed removal puts the row BACK — nothing is hidden that was not removed', async () => {
    const user = userEvent.setup();
    mount({ onRemoveTitle: vi.fn().mockRejectedValue(new Error('boom')) });
    await openMenu(user, 'Dune');
    await user.click(await screen.findByTestId('row-menu-remove'));
    await user.click(screen.getByTestId('confirm-remove-title'));

    expect(await screen.findByTestId('remove-failed')).toBeTruthy();
    expect(screen.getByTestId('title-row-01J8ZC')).toBeTruthy();
  });

  it('T-MANUAL-022: offline, Remove is disabled with the reason stated as TEXT', async () => {
    const user = userEvent.setup();
    mount({ offline: true });
    await openMenu(user, 'Dune');

    const remove = await screen.findByTestId('row-menu-remove');
    expect((remove as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('row-menu-offline-reason')).toBeTruthy();
  });

  it('T-MANUAL-031: the Remove ITEM is absent when its dialog could not open — never present-but-dead', async () => {
    // ⚠ THE PARTIAL-WIRING CASE, WHICH `T-MANUAL-030` CANNOT SEE. The dialog
    // needs BOTH the call and its undo, so a container that wired the other
    // four row handlers and only `onRemoveTitle` — or only
    // `onRestoreListing` — would draw a third menu item that opens nothing.
    // That is precisely the shape `rowMenu.spec.tsx` was written after: a
    // finished dialog mounted by nothing, with a green suite over it. The
    // other two items must still work, so this is not "the menu disappeared".
    const user = userEvent.setup();
    const props = wiring();
    const withoutUndo: ListPageProps = { ...props };
    delete (withoutUndo as { onRestoreListing?: unknown }).onRestoreListing;
    render(<ListPage {...withoutUndo} />);
    await openMenu(user, 'Dune');

    const menu = await screen.findByRole('menu', { name: 'Actions for Dune' });
    expect(screen.queryByTestId('row-menu-remove')).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'Not interested' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Fix match' })).toBeTruthy();
  });
});

describe('US-047 — adding a title by hand, outside any batch', () => {
  it('T-MANUAL-023: the Add-title affordance is on the list page itself', async () => {
    // ⚠ NOT inside the empty state, and not inside `/upload`. It is needed
    // most when the list is long: one title was missed out of two hundred, and
    // re-capturing the whole service to catch it is the friction this removes.
    mount();
    expect(screen.getByTestId('add-title-open')).toBeTruthy();
  });

  it('T-MANUAL-024: the service picker has NO DEFAULT and refuses to submit without one', async () => {
    // ⚠ A default would silently put the title on whichever service was
    // pre-selected. `POST /api/titles` writes a listing for exactly one
    // service, so a wrong default is a wrong badge the owner never chose —
    // the same reasoning as US-003 AC-5's no-default mode.
    const user = userEvent.setup();
    const props = mount();
    await user.click(screen.getByTestId('add-title-open'));
    await user.type(screen.getByTestId('add-title-search-input'), 'dune');
    await user.click(await screen.findByTestId('add-select-438631'));

    expect((screen.getByTestId('add-service-netflix') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId('add-service-max') as HTMLInputElement).checked).toBe(false);

    await user.click(screen.getByTestId('confirm-add-title'));
    expect(await screen.findByTestId('add-service-required')).toBeTruthy();
    expect(props.onAddTitle).not.toHaveBeenCalled();
  });

  it('T-MANUAL-025: a chosen result plus a chosen service POSTS tmdbId, mediaType and service — and nothing else', async () => {
    // ⚠ The closed body of §6.30. No `name` (SD-05: the display name is TMDB's)
    // and no `dateAdded` (write-once, `T-INV-006`; NG-8 defers editing to v1.1).
    const user = userEvent.setup();
    const props = mount();
    await user.click(screen.getByTestId('add-title-open'));
    await user.type(screen.getByTestId('add-title-search-input'), 'dune');
    await user.click(await screen.findByTestId('add-select-438631'));
    await user.click(screen.getByTestId('add-service-max'));
    await user.click(screen.getByTestId('confirm-add-title'));

    await waitFor(() => {
      expect(props.onAddTitle).toHaveBeenCalledWith({
        tmdbId: 438631,
        mediaType: 'movie',
        service: 'max',
      });
    });
    expect(await screen.findByTestId('add-title-done')).toBeTruthy();
  });

  it('T-MANUAL-026: a successful add REFRESHES the list, so the new row appears without a reload', async () => {
    const user = userEvent.setup();
    const onReload = vi.fn();
    const props = mount({ onReload });
    await user.click(screen.getByTestId('add-title-open'));
    await user.type(screen.getByTestId('add-title-search-input'), 'dune');
    await user.click(await screen.findByTestId('add-select-438631'));
    await user.click(screen.getByTestId('add-service-netflix'));
    await user.click(screen.getByTestId('confirm-add-title'));

    await waitFor(() => {
      expect(onReload).toHaveBeenCalled();
    });
    expect(props.onAddTitle).toHaveBeenCalled();
  });

  it('T-MANUAL-027: a 409 DUPLICATE_WORK_IDENTITY is reported, and no row is invented', async () => {
    const user = userEvent.setup();
    const error = Object.assign(new Error('dupe'), { code: 'DUPLICATE_WORK_IDENTITY' });
    const onReload = vi.fn();
    mount({ onAddTitle: vi.fn().mockRejectedValue(error), onReload });
    await user.click(screen.getByTestId('add-title-open'));
    await user.type(screen.getByTestId('add-title-search-input'), 'dune');
    await user.click(await screen.findByTestId('add-select-438631'));
    await user.click(screen.getByTestId('add-service-netflix'));
    await user.click(screen.getByTestId('confirm-add-title'));

    expect(await screen.findByTestId('add-duplicate')).toBeTruthy();
    // Nothing was written, so nothing may be refetched as though it had been.
    expect(onReload).not.toHaveBeenCalled();
  });

  it('T-MANUAL-028: a 409 WORK_SUPPRESSED offers the way OUT of it, not just the refusal', async () => {
    const user = userEvent.setup();
    const error = Object.assign(new Error('suppressed'), {
      code: 'WORK_SUPPRESSED',
      details: { unsuppressHref: '/not-interested' },
    });
    mount({ onAddTitle: vi.fn().mockRejectedValue(error) });
    await user.click(screen.getByTestId('add-title-open'));
    await user.type(screen.getByTestId('add-title-search-input'), 'dune');
    await user.click(await screen.findByTestId('add-select-438631'));
    await user.click(screen.getByTestId('add-service-netflix'));
    await user.click(screen.getByTestId('confirm-add-title'));

    expect(await screen.findByTestId('add-suppressed')).toBeTruthy();
    expect(screen.getByTestId('add-unsuppress-link').getAttribute('href')).toBe('/not-interested');
  });

  it('T-MANUAL-029: offline, the Add-title button is disabled with the reason stated as TEXT', () => {
    mount({ offline: true });
    expect((screen.getByTestId('add-title-open') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('add-title-offline-reason')).toBeTruthy();
  });

  it('T-MANUAL-030: neither affordance is offered when the container wired no handler', () => {
    // ⚠ Present-but-dead is indistinguishable from working to every other kind
    // of test, so the absence is what has to be asserted.
    render(<ListPage items={[DUNE]} total={1} />);
    expect(screen.queryByTestId('add-title-open')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Actions for Dune' })).toBeNull();
  });
});
