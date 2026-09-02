/**
 * `T-UX-021` — `specs/ux-states.md` §2.13 **Submitting (row action)**:
 * *"The affected row dims with an inline spinner; the rest of the list stays
 * interactive."*
 *
 * ⚠ **THE SECOND HALF OF THAT SENTENCE IS THE REQUIREMENT.** A list-wide busy
 * flag satisfies "the affected row dims" — it dims that row too — while doing
 * the precise thing §2.13 forbids. On the owner's real list a frozen screen
 * invites a reload, and a reload is the one action that can lose the write
 * still in flight. Every case here that asserts something about the OTHER row
 * exists for that reason.
 *
 * ⚠ **`rowStates` ALREADY CARRIED `'pending'`.** `SuppressDialog` has reported
 * it since TASK-102 and `ListPage` has stored it — it simply never reached the
 * row, so the state was modelled, named, and rendered nowhere.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

import { TitleList } from '../src/components/TitleList';
import { TitleRow, type TitleListItem } from '../src/components/TitleRow';
import { ROW_PENDING_LABEL } from '../src/copy';
import { ListPage } from '../src/pages/ListPage';

afterEach(cleanup);

function item(titleId: string, overrides: Partial<TitleListItem> = {}): TitleListItem {
  return {
    titleId,
    workIdentity: `w-${titleId}`,
    matchState: 'matched',
    name: `Title ${titleId}`,
    mediaType: 'movie',
    releaseYear: 2020,
    genres: [],
    runtimeMinutes: null,
    posterPath: null,
    badges: [{ service: 'netflix', listingId: `l-${titleId}`, dateAdded: '2026-01-05' }],
    sortDateAdded: '2026-01-05',
    dateAddedLabel: 'Added to nextup on 5 Jan 2026',
    imdbRating: null,
    ...overrides,
  };
}

function renderList(pending: readonly string[]): void {
  render(
    <MemoryRouter>
      <TitleList
        items={[item('a'), item('b')]}
        pendingTitleIds={new Set(pending)}
        onOpenMenu={() => undefined}
        onFixMatch={() => undefined}
      />
    </MemoryRouter>,
  );
}

describe('T-UX-021 submitting (row action)', () => {
  it('T-UX-021a: the affected row dims and reports itself busy', () => {
    renderList(['a']);

    const row = screen.getByTestId('title-row-a');
    // ⚠ ONE FLAG DRIVES BOTH HALVES. The dim is applied by
    // `.title-row[aria-busy='true']` in `index.css` rather than by a modifier
    // class, so a row cannot look busy while announcing nothing — and
    // `T-CSS-001c` forbids the computed `className` that would be needed.
    expect(row).toHaveAttribute('aria-busy', 'true');
    expect(row.className).toBe('title-row');
  });

  it('T-UX-021b: an inline spinner appears, carrying words', () => {
    renderList(['a']);

    const spinner = screen.getByTestId('row-pending');
    expect(spinner).toHaveTextContent(ROW_PENDING_LABEL);
    // An unlabelled spinning glyph announces nothing at all.
    expect(spinner.textContent?.trim().length ?? 0).toBeGreaterThan(0);
    expect(screen.getByTestId('title-row-a')).toContainElement(spinner);
  });

  it('T-UX-021c: the rest of the list stays interactive', () => {
    /*
      ⚠ THE CASE A LIST-WIDE `busy` FLAG FAILS, AND THE ONLY ONE. Every other
      assertion in this file passes if the whole list is disabled while one row
      saves — that implementation dims the affected row, shows a spinner, and
      disables its control, ticking every box except the one that matters.
    */
    renderList(['a']);

    const other = screen.getByTestId('title-row-b');
    expect(other).not.toHaveAttribute('aria-busy');
    expect(other.querySelector('[data-testid="row-pending"]')).toBeNull();

    const otherMenu = other.querySelector('[data-testid="row-menu"]');
    expect(otherMenu).not.toBeNull();
    expect(otherMenu).not.toBeDisabled();
  });

  it('T-UX-021d: the pending row refuses a second action', () => {
    // A row whose write is in flight must not accept another: the double
    // submit is exactly what an unresponsive-looking row invites.
    renderList(['a']);

    const menu = screen.getByTestId('title-row-a').querySelector('[data-testid="row-menu"]');
    expect(menu).toBeDisabled();
  });

  it('T-UX-021e: an unmatched row disables its own Find a match only', () => {
    render(
      <MemoryRouter>
        <TitleList
          items={[item('a', { matchState: 'unmatched' }), item('b', { matchState: 'unmatched' })]}
          pendingTitleIds={new Set(['a'])}
          onOpenMenu={() => undefined}
          onFixMatch={() => undefined}
        />
      </MemoryRouter>,
    );

    const buttons = screen.getAllByRole('button', { name: 'Find a match' });
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toBeDisabled();
    expect(buttons[1]).not.toBeDisabled();
  });

  it('T-UX-021f: no pending set leaves every row untouched', () => {
    /*
      ⚠ THE DEFAULT MATTERS MORE THAN IT LOOKS. `pendingTitleIds` is optional,
      and a default that dimmed rows — or a `pending` prop read as truthy when
      absent — would put the whole list in the saving state permanently, on the
      one screen the owner spends all their time.
    */
    renderList([]);

    for (const id of ['a', 'b']) {
      const row = screen.getByTestId(`title-row-${id}`);
      expect(row).not.toHaveAttribute('aria-busy');
    }
    expect(screen.queryByTestId('row-pending')).not.toBeInTheDocument();
  });

  it('T-UX-021g: a pending row is never hidden', () => {
    /*
      ⚠ THE REGRESSION `ListPage` ALREADY GUARDS AGAINST, RESTATED AT THE ROW.
      Hiding on `pending` is the optimistic-then-reconcile behaviour TASK-102
      rejected: a failed write would leave a row hidden that is still on the
      list, and the owner would believe a title was removed when it was not.
    */
    render(
      <MemoryRouter>
        <TitleRow item={item('a')} pending onOpenMenu={() => undefined} />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('title-row-a')).toBeVisible();
    expect(screen.getByTestId('title-name')).toHaveTextContent('Title a');
  });

  it('T-UX-021h: a real suppress in flight dims that row on the list', async () => {
    /*
      ⚠ THE WIRING CASE, AND WITHOUT IT THIS ID IS DECORATIVE. Every case above
      hands `TitleList` a set that a test built; all of them still pass with
      `ListPage` deriving `pendingTitleIds` from nothing and passing an empty
      set for ever — which is exactly the state the screen was in, since
      `rowStates` has carried `'pending'` since TASK-102 and never reached a
      row. This drives the actual §2.3 menu → confirm path with a suppress that
      never settles, which is the only way the pending phase is observable.
    */
    render(
      <MemoryRouter>
        <ListPage
          items={[item('a'), item('b')]}
          onSuppress={() => new Promise(() => undefined)}
          onUnsuppress={() => Promise.resolve({})}
          onSearchTmdb={() => Promise.resolve({ results: [] })}
          onFixMatch={() =>
            Promise.resolve({ titleId: 'a', workIdentity: 'w-a', matchState: 'matched' })
          }
        />
      </MemoryRouter>,
    );

    fireEvent.click(within(screen.getByTestId('title-row-a')).getByTestId('row-menu'));
    fireEvent.click(screen.getByTestId('row-menu-suppress'));
    fireEvent.click(await screen.findByRole('button', { name: 'Not interested' }));

    const row = await screen.findByTestId('title-row-a');
    expect(row).toHaveAttribute('aria-busy', 'true');
    // ⚠ Still ON the list. `pending` dims; only `suppressed` removes.
    expect(within(row).getByTestId('title-name')).toHaveTextContent('Title a');
    // And the untouched row is untouched.
    expect(screen.getByTestId('title-row-b')).not.toHaveAttribute('aria-busy');
  });

  it('T-UX-021i: the stylesheet actually dims the busy row', () => {
    /*
      ⚠ WITHOUT THIS CASE THE VISUAL HALF OF §2.13 IS UNASSERTED. Every other
      case here checks the DOM, and `aria-busy` alone changes nothing a sighted
      owner can see: deleting the rule from `index.css` leaves the whole suite
      green while the row stops dimming entirely. `T-CSS-001` checks that every
      class is defined and rendered, but this dim is keyed on an ATTRIBUTE, so
      it sits outside that gate's reach.
    */
    const webRoot = existsSync(join(process.cwd(), 'apps', 'web', 'src'))
      ? join(process.cwd(), 'apps', 'web')
      : process.cwd();
    const css = readFileSync(join(webRoot, 'src', 'index.css'), 'utf8');

    const rule = /\.title-row\[aria-busy=['"]true['"]\]\s*\{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    // A rule that exists but sets nothing visible is the same defect wearing a
    // selector.
    expect(rule?.[1]).toMatch(/opacity\s*:/);
  });
});
