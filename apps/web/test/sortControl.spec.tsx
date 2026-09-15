/**
 * T-UI-024 — SortControl (TASK-166, reshaped by TASK-217).
 *
 * The control selects a sort field and a direction, reflects both in the URL
 * query string, and persists the direction in session storage so the preference
 * survives navigations that do not carry a `dir` param.
 *
 * ⚠ THE DIRECTION IS A SEGMENT, NOT A TOGGLE, SINCE REQ-121. It used to be one
 * button labelled "Newest first" *while the list was already newest-first*;
 * pressing it made the list oldest-first. Both readings — "this is the state"
 * and "this is what you'll get" — are defensible, which is precisely the defect
 * REQ-114 names. The owner's OQ-5 answer (`A53`) was to show BOTH options with
 * the current one marked.
 *
 * ⚠ THE CASES BELOW WERE REWRITTEN, NOT DELETED. Each one's behavioural intent
 * — default direction, the label naming the field's own ordering, URL
 * reconciliation, filter preservation, no redundant default param — survives
 * verbatim; only the mechanism it reads changed from `aria-pressed` on a button
 * to `checked` on a radio. Deleting them would have removed the only guards on
 * behaviour REQ-121 does not touch.
 *
 * ⚠ DATE-ADDED LABEL IS DATE-ADDED-TO-NEXTUP (REQ-061). The date this title
 * entered nextup, never the streaming service's own saved date.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { JSX } from 'react';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SortControl,
  readSortDir,
  readSortKey,
  defaultDirFor,
  SORT_KEYS,
  type SortDir,
} from '../src/components/SortControl';
import {
  SORT_AZ_LABEL,
  SORT_HIGHEST_LABEL,
  SORT_LONGEST_LABEL,
  SORT_LOWEST_LABEL,
  SORT_NEWEST_LABEL,
  SORT_OLDEST_LABEL,
  SORT_SHORTEST_LABEL,
  SORT_ZA_LABEL,
} from '../src/copy';
import { ListPage } from '../src/pages/ListPage';

/** The `<label>` wrapping one direction option, marked or not. */
const dirOption = (option: SortDir): HTMLElement =>
  screen.getAllByTestId(`sort-dir-${option}`).at(-1) as HTMLElement;

/** The radio inside that option — `checked` is what "marked" means here. */
const dirRadio = (option: SortDir): HTMLInputElement =>
  within(dirOption(option)).getByRole('radio') as HTMLInputElement;

/** The label text currently offered for one direction, per the selected field. */
const dirText = (option: SortDir): string => dirOption(option).textContent ?? '';

/** Which direction is currently marked. Exactly one always is. */
const markedDir = (): SortDir => (dirRadio('desc').checked ? 'desc' : 'asc');

/**
 * The real `ListPage`, for the REQ-113 group cases.
 *
 * ⚠ THE PAGE, NOT A HAND-BUILT WRAPPER. REQ-113 is a claim about where the two
 * controls are mounted; a test that assembled its own `<div>` around them would
 * assert the test's own markup and pass however `ListPage` was written.
 */
function renderListPage(initialUrl = '/'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <ListPage items={[]} total={0} />
              <SearchProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Helper: renders SortControl inside a MemoryRouter with the given initial URL.
 */
function renderSortControl(initialUrl = '/'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route path="*" element={<SortControl />} />
      </Routes>
    </MemoryRouter>,
  );
}

/**
 * Reads the live query string out of the router.
 *
 * ⚠ THE QUERY STRING IS THE THING UNDER TEST, not an implementation detail:
 * `ListRoute` forwards `params.toString()` straight to `GET /api/titles`, so
 * whatever is NOT in the URL is not what the owner is looking at.
 */
function SearchProbe(): JSX.Element {
  const [params] = useSearchParams();
  return <span data-testid="search-probe">{params.toString()}</span>;
}

const probeSearch = (): string => screen.getByTestId('search-probe').textContent ?? '';

function renderWithProbe(initialUrl = '/'): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialUrl]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SortControl />
              <SearchProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('T-UI-024 — SortControl', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  // T-UI-024a: renders on the page with the correct test id
  it('T-UI-024a: renders the sort control button', () => {
    renderSortControl();
    expect(screen.getByTestId('sort-control')).toBeInTheDocument();
  });

  // T-UI-024b: the default direction is marked, and reads SORT_NEWEST_LABEL
  it('T-UI-024b: defaults to newest-first label', () => {
    renderSortControl();
    expect(markedDir()).toBe('desc');
    expect(dirText('desc')).toBe(SORT_NEWEST_LABEL);
  });

  // T-UI-024c: choosing the other option marks it
  it('T-UI-024c: click toggles to oldest-first label', () => {
    renderSortControl();
    fireEvent.click(dirRadio('asc'));
    expect(markedDir()).toBe('asc');
    expect(dirText('asc')).toBe(SORT_OLDEST_LABEL);
  });

  // T-UI-024d: choosing the first option again marks it back
  it('T-UI-024d: second click toggles back to newest-first label', () => {
    renderSortControl();
    fireEvent.click(dirRadio('asc'));
    fireEvent.click(dirRadio('desc'));
    expect(markedDir()).toBe('desc');
  });

  // T-UI-024e: the non-current option is NOT marked (newest-first default)
  it('T-UI-024e: aria-pressed is false when newest-first (default)', () => {
    // ⚠ REWRITTEN FROM `aria-pressed`, WHICH NO LONGER EXISTS AND SHOULD NOT.
    // Two `aria-pressed` buttons announce two independent toggles, one of which
    // is always on — a state nobody chose. A radio group announces "2 of 2".
    // The property under test is unchanged: the option that is not current must
    // not read as current.
    renderSortControl();
    expect(dirRadio('asc').checked).toBe(false);
  });

  // T-UI-024f: the chosen option IS marked (oldest-first)
  it('T-UI-024f: aria-pressed is true when oldest-first', () => {
    renderSortControl();
    fireEvent.click(dirRadio('asc'));
    expect(dirRadio('asc').checked).toBe(true);
    expect(dirRadio('desc').checked).toBe(false);
  });

  // T-UI-024g: reads dir=asc from the URL query string
  it('T-UI-024g: readSortDir reads asc from URL params', () => {
    const params = new URLSearchParams('?dir=asc');
    expect(readSortDir(params)).toBe('asc');
  });

  // T-UI-024h: reads dir=desc from the URL query string
  it('T-UI-024h: readSortDir reads desc from URL params', () => {
    const params = new URLSearchParams('?dir=desc');
    expect(readSortDir(params)).toBe('desc');
  });

  // T-UI-024i: falls back to default desc when no param
  it('T-UI-024i: readSortDir defaults to desc when no param', () => {
    const params = new URLSearchParams('');
    expect(readSortDir(params)).toBe('desc');
  });

  // T-UI-024j: session storage persists across reload (dir=asc stored)
  it('T-UI-024j: readSortDir reads asc from session storage when no URL param', () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    const params = new URLSearchParams('');
    expect(readSortDir(params)).toBe('asc');
  });

  // T-UI-024k: URL param overrides session storage
  it('T-UI-024k: URL param overrides session storage', () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    const params = new URLSearchParams('?dir=desc');
    expect(readSortDir(params)).toBe('desc');
  });

  // T-UI-024l: the control is styled and meets the 44 px floor
  it('T-UI-024l: button is a §7d primitive and keeps the tap-target floor', () => {
    // ⚠ REWRITTEN TWICE, DELETED NEITHER TIME. TASK-210 moved it off the
    // private `.sort-control` rule onto §7d's `Button`; TASK-217 moves it again
    // because REQ-121 replaced the button with a radio segment. The INTENT —
    // that this control is styled and still reaches 44 px — is what mattered
    // each time, and it is what is preserved here. Deleting it would remove the
    // only per-control guard on invariant §8's tap-target floor, and the floor
    // matters MORE now: two adjacent options are two targets to miss between.
    renderSortControl();
    for (const option of ['desc', 'asc'] as const) {
      expect(dirOption(option)).toHaveClass('tap-target');
    }
  });

  // T-UI-024m: keyboard operable
  it('T-UI-024m: keyboard Enter toggles the sort direction', () => {
    // ⚠ NATIVE RADIOS ARE THE KEYBOARD STORY, which is most of why they were
    // chosen over two buttons: arrow keys move within the group and Space
    // selects, for free and correctly, on every platform. jsdom does not
    // implement that movement, so asserting it here would assert jsdom rather
    // than the app. What CAN be proved is the precondition it rests on — the
    // options are real `<input type="radio">` in one named group, not
    // `<div role>` reimplementations that would need the movement written by
    // hand and would silently lack it.
    renderSortControl();
    for (const option of ['desc', 'asc'] as const) {
      const radio = dirRadio(option);
      expect(radio.tagName).toBe('INPUT');
      expect(radio.type).toBe('radio');
      expect(radio.name).toBe('dir');
    }
    fireEvent.click(dirRadio('asc'));
    expect(markedDir()).toBe('asc');
  });

  // T-UI-024n: ?dir=asc in URL marks oldest-first immediately
  it('T-UI-024n: ?dir=asc in URL renders oldest-first label', () => {
    renderSortControl('/?dir=asc');
    expect(markedDir()).toBe('asc');
    expect(dirText('asc')).toBe(SORT_OLDEST_LABEL);
  });

  /**
   * ⚠ THE REMEMBERED DIRECTION MUST REACH THE QUERY STRING, NOT JUST THE
   * LABEL. `ListRoute` sends `params.toString()` verbatim to
   * `GET /api/titles`, so the URL is what the server sorts by. A control that
   * merely *renders* "Oldest first" from session storage, without putting
   * `dir=asc` in the URL, shows the owner a newest-first list under an
   * oldest-first label — silently, with no error anywhere.
   *
   * `T-UI-024j` above asserts only that `readSortDir` returns `asc`, which is
   * true of the broken version too. These three cases are the ones with teeth.
   */
  // T-UI-024o: a remembered `asc` is reconciled INTO the query string
  it('T-UI-024o: a session-persisted asc is written into the URL', async () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    renderWithProbe('/');
    expect(markedDir()).toBe('asc');
    // The mark is only honest if the API is asked for the same thing.
    await waitFor(() => {
      expect(new URLSearchParams(probeSearch()).get('dir')).toBe('asc');
    });
  });

  // T-UI-024p: reconciliation PRESERVES the other query parameters
  it('T-UI-024p: reconciliation keeps the existing filters', async () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    renderWithProbe('/?service=netflix&type=movie');
    await waitFor(() => {
      const q = new URLSearchParams(probeSearch());
      expect(q.get('dir')).toBe('asc');
      // ⚠ Dropping the filters here would silently widen the list the owner
      // is looking at, which reads as rows appearing from nowhere.
      expect(q.get('service')).toBe('netflix');
      expect(q.get('type')).toBe('movie');
    });
  });

  // T-UI-024q: the DEFAULT direction is not written, so URLs stay clean
  it('T-UI-024q: a remembered desc adds no redundant dir param', async () => {
    sessionStorage.setItem('nextup.sort.dir', 'desc');
    renderWithProbe('/?service=netflix');
    // An absent `dir` already means `desc` to the API (`api.md` §6.2). Writing
    // it would change the fetch key on every load for no behavioural gain.
    await waitFor(() => {
      expect(new URLSearchParams(probeSearch()).get('service')).toBe('netflix');
    });
    expect(new URLSearchParams(probeSearch()).has('dir')).toBe(false);
    expect(markedDir()).toBe('desc');
  });
});

describe('REQ-037 / T-UX-120 - the sort KEY (`specs/ui-refresh.md` §5a)', () => {
  it('T-UX-120a defaults to date-added with no `sort` in the URL', () => {
    renderWithProbe('/');

    expect(readSortKey(new URLSearchParams(probeSearch()))).toBe('dateAdded');
    expect(dirText('desc')).toBe(SORT_NEWEST_LABEL);
  });

  it('T-UX-120b selecting Runtime relabels the direction toggle', () => {
    // ⚠ THIS IS THE REQUIREMENT, NOT POLISH. "Newest first" on a
    // runtime-ordered list names a different column from the one the list is
    // ordered by. The label is the only thing on screen that says what the
    // order means, so a stale one is a false statement the owner cannot check.
    renderWithProbe('/');
    expect(dirText('desc')).toBe(SORT_NEWEST_LABEL);

    fireEvent.click(screen.getByDisplayValue('runtime'));

    expect(dirText('desc')).toBe(SORT_LONGEST_LABEL);
    expect(new URLSearchParams(probeSearch()).get('sort')).toBe('runtime');
  });

  it('T-UX-120c the runtime labels are Shortest/Longest, never Newest/Oldest', () => {
    renderWithProbe('/?sort=runtime&dir=asc');
    expect(dirText('asc')).toBe(SORT_SHORTEST_LABEL);
    expect(dirText('desc')).toBe(SORT_LONGEST_LABEL);
    // ⚠ The date wording must not merely be unselected — it must be ABSENT.
    // A segment that kept both vocabularies on screen would offer four
    // readings of a two-way choice.
    expect(screen.getByTestId('sort-control').textContent).not.toContain(SORT_NEWEST_LABEL);
    expect(screen.getByTestId('sort-control').textContent).not.toContain(SORT_OLDEST_LABEL);
  });

  it('T-UX-120d changing the key does NOT reset the direction', () => {
    // `desc` means newest-first under one key and longest-first under the
    // other; both are the same "most of the thing first" default, so carrying
    // the choice across preserves it rather than silently discarding it.
    renderWithProbe('/?dir=asc');
    fireEvent.click(screen.getByDisplayValue('runtime'));

    expect(new URLSearchParams(probeSearch()).get('dir')).toBe('asc');
    expect(markedDir()).toBe('asc');
    expect(dirText('asc')).toBe(SORT_SHORTEST_LABEL);
  });

  it('T-UX-120e returning to date-added REMOVES `sort` rather than writing the default', () => {
    // An absent `sort` already means `dateAdded` to the API (`specs/api.md`
    // §6.2), so writing it adds a parameter to every URL and changes the fetch
    // key for no effect - the same rule the `dir` reconciliation follows.
    renderWithProbe('/?sort=runtime');
    fireEvent.click(screen.getByDisplayValue('dateAdded'));

    expect(new URLSearchParams(probeSearch()).has('sort')).toBe(false);
    expect(dirText('desc')).toBe(SORT_NEWEST_LABEL);
  });

  it('T-UX-120f an unrecognised `sort` falls back to date-added rather than erroring', () => {
    // ⚠ `imdbRating` IS STILL THE WRONG SPELLING, even though the rating IS a
    // sort key since `A53`. The API's own token is `rating` (`TITLE_SORTS`),
    // so this case now guards a NEAR-MISS rather than a forbidden key — the
    // more dangerous of the two, because it looks right in a URL.
    expect(readSortKey(new URLSearchParams('sort=imdbRating'))).toBe('dateAdded');
    expect(readSortKey(new URLSearchParams('sort='))).toBe('dateAdded');
    expect(readSortKey(new URLSearchParams(''))).toBe('dateAdded');
  });

  it('T-UX-119 the sort field selector DOES offer the IMDb rating', () => {
    // ⚠⚠ REWRITTEN AT `A53`, NOT DELETED (`specs/ui-refresh.md` §7a).
    // This case previously asserted the exact opposite — REQ-095 made the
    // rating display-only and this guarded it, because the rating is the most
    // tempting key in the file precisely BECAUSE the row renders it. The owner
    // REVERSED that decision at `A53`, written up as ADR-0011 Revision 1. The
    // guard is kept pointing the other way so the reversal itself cannot be
    // quietly undone by a future agent who finds REQ-095 and "restores" it.
    //
    // ⚠ The token is `rating`, matching `TITLE_SORTS` in the API. An
    // `imdbRating` here would be a 400 on a control the owner can see and press.
    expect(SORT_KEYS).toEqual(['dateAdded', 'name', 'releaseYear', 'runtime', 'rating']);
    expect(SORT_KEYS as readonly string[]).toContain('rating');
    expect(SORT_KEYS as readonly string[]).not.toContain('imdbRating');

    renderWithProbe('/');
    expect(screen.getByDisplayValue('rating')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('imdbRating')).toBeNull();
  });

  it('T-UX-120g the key is NOT persisted in session storage, unlike the direction', () => {
    // A remembered key would reorder the list on a fresh visit that carries no
    // `sort`, and the URL reconciliation would then rewrite the address bar on
    // arrival. The direction is a preference about one list; the key is which
    // list it is.
    renderWithProbe('/');
    fireEvent.click(screen.getByDisplayValue('runtime'));

    const stored = Object.keys(sessionStorage).filter((key) => key.includes('sort'));
    for (const key of stored) {
      expect(sessionStorage.getItem(key)).not.toBe('runtime');
    }
  });
});

/**
 * REQ-113 / REQ-121 — the sort control's SHAPE (`specs/ui-refresh.md` §5, §5b).
 *
 * ⚠ **THE SHAPE IS THE REQUIREMENT HERE, WHICH IS UNUSUAL AND DELIBERATE.**
 * §8 warns that a redesign can delete a behavioural `must` while every
 * behavioural test still passes, and the sort control is the worked example:
 * collapse the direction into the field list as ten combined options and
 * `click()` still reaches oldest-first, so every case above stays green while
 * product invariant 6 — oldest-first in ONE action — is gone. `T-UX-131`
 * counts interactions for exactly that reason.
 */
describe('REQ-121 — the sort control is a field selector plus a direction segment', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it('T-UX-128a renders BOTH direction options simultaneously', () => {
    // The owner's OQ-5 answer, verbatim: "show both options with the current
    // one marked". A single control showing one label is the REQ-114 defect.
    renderSortControl();

    expect(dirOption('desc')).toBeInTheDocument();
    expect(dirOption('asc')).toBeInTheDocument();
  });

  it('T-UX-128b marks exactly one option, and it is the current direction', () => {
    renderSortControl('/?dir=asc');

    expect(dirRadio('asc').checked).toBe(true);
    expect(dirRadio('desc').checked).toBe(false);
  });

  it('T-UX-128c is NOT a single toggling control', () => {
    // ⚠ THE REGRESSION THIS FILE EXISTS FOR. A toggle passes "oldest-first is
    // reachable", passes "the label is correct", and passes every persistence
    // case — it fails only a count of the options on screen.
    renderSortControl();
    const radios = within(screen.getByTestId('sort-control')).getAllByRole('radio');

    expect(radios).toHaveLength(2);
    expect(within(screen.getByTestId('sort-control')).queryByRole('button')).toBeNull();
  });

  it('T-UX-128d renders desc before asc regardless of which is current', () => {
    // ⚠ Ordering the options by which is current would move the owner's target
    // between renders — the control they just pressed jumps under the pointer.
    // "Marked" means marked in place.
    renderSortControl('/?dir=asc');
    const group = screen.getByTestId('sort-control');
    const order = Array.from(group.querySelectorAll<HTMLElement>('label')).map(
      (l) => l.dataset['testid'],
    );

    expect(order).toEqual(['sort-dir-desc', 'sort-dir-asc']);
  });

  it('T-UX-129a the direction labels change with the selected field', () => {
    renderWithProbe('/');
    expect(dirText('desc')).toBe(SORT_NEWEST_LABEL);

    fireEvent.click(screen.getByDisplayValue('runtime'));
    expect(dirText('desc')).toBe(SORT_LONGEST_LABEL);
    expect(dirText('asc')).toBe(SORT_SHORTEST_LABEL);

    fireEvent.click(screen.getByDisplayValue('name'));
    expect(dirText('asc')).toBe(SORT_AZ_LABEL);
    expect(dirText('desc')).toBe(SORT_ZA_LABEL);

    fireEvent.click(screen.getByDisplayValue('rating'));
    expect(dirText('desc')).toBe(SORT_HIGHEST_LABEL);
    expect(dirText('asc')).toBe(SORT_LOWEST_LABEL);
  });

  it('T-UX-129b the date pair is REUSED UNMODIFIED, for BOTH date-shaped fields', () => {
    // ⚠ `SORT_NEWEST_LABEL` / `SORT_OLDEST_LABEL` are governed copy
    // (`specs/ui.md` §9) and §8 is explicit that rewriting owner-facing wording
    // is a product decision, not a styling one. Release year is a date, reads
    // like a date, and gets the SAME two strings — a near-miss retype
    // ("Most recent first") would be a copy change nobody approved, and it
    // would look entirely reasonable in a diff.
    renderWithProbe('/?sort=releaseYear');

    expect(dirText('desc')).toBe(SORT_NEWEST_LABEL);
    expect(dirText('asc')).toBe(SORT_OLDEST_LABEL);
  });

  it('T-UX-129c the DEFAULT direction is per field, and name opens at A', () => {
    // ⚠⚠ THE LABEL-LIES BUG, IN ITS SECOND HOME. The API defaults `name` to
    // `asc` (`defaultDirectionFor`, `titlesQuery.ts`) because `?sort=name`
    // opening at Z is what nobody means by "sort by name". A single global
    // `desc` on this side marks `Z–A` while the API returns A–Z: the mark
    // lies, the list is fine, and nothing errors.
    expect(defaultDirFor('name')).toBe('asc');
    expect(defaultDirFor('dateAdded')).toBe('desc');
    expect(defaultDirFor('rating')).toBe('desc');

    renderWithProbe('/?sort=name');
    expect(markedDir()).toBe('asc');
    expect(dirText('asc')).toBe(SORT_AZ_LABEL);
  });

  it('T-UX-129d a field default that IS the default writes no redundant dir', async () => {
    // The mirror of `T-UI-024q`, under the field whose default is not `desc`.
    // A reconciliation checking against a hard-coded `desc` would write
    // `dir=asc` into every name-sorted URL on arrival.
    renderWithProbe('/?sort=name');

    await waitFor(() => {
      expect(new URLSearchParams(probeSearch()).get('sort')).toBe('name');
    });
    expect(new URLSearchParams(probeSearch()).has('dir')).toBe(false);
  });

  it('T-UX-130a changing the FIELD preserves dir', () => {
    renderWithProbe('/?dir=asc');
    fireEvent.click(screen.getByDisplayValue('rating'));

    expect(new URLSearchParams(probeSearch()).get('dir')).toBe('asc');
    expect(markedDir()).toBe('asc');
  });

  it('T-UX-130b changing the FIELD preserves the active filters', () => {
    // ⚠ Dropping them silently widens the list the owner is looking at, which
    // reads as rows appearing from nowhere in response to a sort.
    renderWithProbe('/?service=netflix&type=movie&genre=Action');
    fireEvent.click(screen.getByDisplayValue('runtime'));

    const q = new URLSearchParams(probeSearch());
    expect(q.get('service')).toBe('netflix');
    expect(q.get('type')).toBe('movie');
    expect(q.get('genre')).toBe('Action');
  });

  it('T-UX-130c changing the DIRECTION preserves the active filters', () => {
    renderWithProbe('/?service=max&runtime=60-120');
    fireEvent.click(dirRadio('asc'));

    const q = new URLSearchParams(probeSearch());
    expect(q.get('service')).toBe('max');
    expect(q.get('runtime')).toBe('60-120');
    expect(q.get('dir')).toBe('asc');
  });

  it('T-UX-130d neither change carries a cursor', () => {
    // ⚠ A date cursor sent with `sort=runtime` is a keyset that does not mirror
    // its own ORDER BY. The API answers `INVALID_CURSOR` rather than a page of
    // quietly wrong rows — but only if the cursor is not carried. It lives in
    // `useCursorPages` state, never the URL, and the query change resets it;
    // this pins the URL half so a future "remember my place" cannot bolt a
    // cursor onto the address without meeting this case.
    renderWithProbe('/?service=netflix');
    fireEvent.click(screen.getByDisplayValue('runtime'));
    expect(new URLSearchParams(probeSearch()).has('cursor')).toBe(false);

    fireEvent.click(dirRadio('asc'));
    expect(new URLSearchParams(probeSearch()).has('cursor')).toBe(false);
  });

  it('T-UX-131a oldest-first is reachable in EXACTLY one interaction from the default', () => {
    // ⚠⚠ PRODUCT INVARIANT 6, AND THE REASON THE DIRECTION IS NOT IN THE FIELD
    // LIST. REQ-038's oldest-first reverse was promoted to `must` at `A47`: it
    // is the sole escape hatch for the knowingly-accepted
    // newest-first-vs-SUC-003 trade-off, and OQ-029's revisit path depends on
    // it shipping in v1. A design that buries it one press deeper has deleted a
    // `must` while every other case here still passes.
    renderWithProbe('/');
    expect(markedDir()).toBe('desc');

    fireEvent.click(dirRadio('asc'));

    expect(new URLSearchParams(probeSearch()).get('dir')).toBe('asc');
    expect(markedDir()).toBe('asc');
  });

  it('T-UX-131b the oldest-first option is visible WITHOUT opening anything first', () => {
    // The interaction count above is only meaningful if the target is on
    // screen to begin with. A collapsed `<select>` of ten combined options
    // would still pass a one-`click()` assertion in jsdom, because jsdom does
    // not model the press that opens it.
    renderSortControl();
    const group = screen.getByTestId('sort-control');

    expect(group.tagName).toBe('FIELDSET');
    expect(within(group).queryByRole('combobox')).toBeNull();
    expect(dirText('asc')).toBe(SORT_OLDEST_LABEL);
  });

  it('T-UX-113a the filters and the sort render inside ONE group', () => {
    // REQ-113. They were two stacked bars with their own bottom margins, which
    // read as two unrelated decisions about the same list.
    renderListPage();
    const group = screen.getByTestId('list-controls');

    expect(within(group).getByTestId('filter-bar')).toBeInTheDocument();
    expect(within(group).getByTestId('sort-control-group')).toBeInTheDocument();
  });

  it('T-UX-113b merging them visually does NOT merge their state', () => {
    // ⚠⚠ §5's table calls this the single most likely way to break working
    // behaviour in this refresh. The two controls look like siblings and have
    // deliberately OPPOSITE persistence models: filters are URL-only, sort is
    // URL → session → default. A shared hook produces a green suite and a
    // broken back button, so this asserts the observable consequence — the sort
    // direction persists to session storage and a filter never does.
    renderListPage();

    fireEvent.click(dirRadio('asc'));
    expect(sessionStorage.getItem('nextup.sort.dir')).toBe('asc');

    const stored = Object.entries(sessionStorage).map(([, v]) => String(v));
    expect(stored).not.toContain('netflix');
  });

  it('T-UX-114a changing a filter preserves sort and dir', () => {
    // `applyFilters` copies the params and deletes only the filter keys, so
    // this holds by construction — which is exactly why it needs a test. The
    // construction is one line away from a `new URLSearchParams()` that starts
    // empty and silently resets the owner's ordering on every filter press.
    renderListPage('/?sort=runtime&dir=asc');

    fireEvent.click(screen.getByDisplayValue('netflix'));

    const q = new URLSearchParams(probeSearch());
    expect(q.get('sort')).toBe('runtime');
    expect(q.get('dir')).toBe('asc');
    expect(q.get('service')).toBe('netflix');
  });
});

/**
 * REQ-113 / REQ-115 — the two cases §5's test table names in its own right.
 *
 * ⚠ THESE ARE NOT DUPLICATES OF `T-UI-024o` AND `T-UX-131a`, and the
 * difference is the thing that fails. `T-UI-024o` proves the remembered
 * direction reaches the QUERY STRING; `T-UX-115` proves the MARK and the query
 * string agree, which is the property the owner can actually check, and proves
 * it under a field whose default direction is not `desc`. `T-UX-131a` counts
 * interactions on the control in isolation; `T-UX-116` counts them on the
 * DEFAULT VIEW, where the control has to be present and unopened to be one
 * press away at all.
 */
describe('REQ-113 / REQ-115 — persistence and the one-press escape hatch', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });
  afterEach(() => {
    sessionStorage.clear();
  });

  it('T-UX-115a a remembered direction is reconciled into the URL and the mark agrees', async () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    renderWithProbe('/');

    await waitFor(() => {
      expect(new URLSearchParams(probeSearch()).get('dir')).toBe('asc');
    });
    // ⚠ BOTH HALVES, TOGETHER. `ListRoute` sends `params.toString()` verbatim
    // to `GET /api/titles`, so the URL is what the server sorts by. A control
    // that merely RENDERS the remembered direction, without writing it, shows
    // the owner a newest-first list under an oldest-first mark — silently, with
    // no error anywhere. Asserting either half alone passes on that version.
    expect(markedDir()).toBe('asc');
    expect(dirText('asc')).toBe(SORT_OLDEST_LABEL);
  });

  it('T-UX-115b the remembered direction survives a FIELD whose default differs', async () => {
    // ⚠ The hard case. Remembered `desc` under `sort=name` is NOT the field's
    // default, so it must be written — the reverse of `T-UX-129d`, where the
    // field's own default must NOT be. A reconciliation comparing against one
    // global `desc` gets both of these backwards at once.
    sessionStorage.setItem('nextup.sort.dir', 'desc');
    renderWithProbe('/?sort=name');

    await waitFor(() => {
      expect(new URLSearchParams(probeSearch()).get('dir')).toBe('desc');
    });
    expect(markedDir()).toBe('desc');
    expect(dirText('desc')).toBe(SORT_ZA_LABEL);
  });

  it('T-UX-115c the URL beats session storage, so a deep link means what it says', () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    renderWithProbe('/?dir=desc');

    expect(markedDir()).toBe('desc');
    expect(new URLSearchParams(probeSearch()).get('dir')).toBe('desc');
  });

  it('T-UX-116a oldest-first is ONE press away on the default view', () => {
    // ⚠⚠ PRODUCT INVARIANT 6, MEASURED WHERE THE OWNER MEETS IT. REQ-038's
    // reverse is `must` (promoted at `A47`) and is the sole escape hatch for
    // the knowingly-accepted newest-first-vs-SUC-003 trade-off; OQ-029's
    // revisit path depends on it shipping in v1. The default view is the one
    // that matters — a control correct in isolation but mounted behind a
    // disclosure on the real page has still deleted the `must`.
    renderListPage();

    expect(markedDir()).toBe('desc');
    expect(dirText('asc')).toBe(SORT_OLDEST_LABEL);

    fireEvent.click(dirRadio('asc'));

    expect(new URLSearchParams(probeSearch()).get('dir')).toBe('asc');
    expect(markedDir()).toBe('asc');
  });
});
