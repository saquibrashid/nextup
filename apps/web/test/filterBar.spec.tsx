// TASK-039 — the filter bar and its query-string sync (`specs/ui.md` §2.1
// item 2, `specs/api.md` §6.2, `specs/ux-states.md` §2.4).
//
// `T-UI-016` demands sync "in BOTH directions", so every case here is written
// as a round trip rather than as "clicking sets the URL". A component holding
// its own copy of the selection passes the one-way test and then drifts on the
// back button and on a deep link — the two ways a filtered list is actually
// shared and revisited.

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';

import {
  FilterBar,
  NO_FILTERS,
  ZeroMatch,
  activeFilterChips,
  applyFilters,
  isFiltered,
  parseFilters,
} from '../src/components/FilterBar';
import { ListPage } from '../src/pages/ListPage';
import { CLEAR_FILTERS_LABEL, ZERO_MATCH_TITLE } from '../src/copy';

/** Publishes the live URL so a test can assert what the bar actually wrote. */
function LocationProbe(): JSX.Element {
  const location = useLocation();
  return <span data-testid="url">{`${location.pathname}${location.search}`}</span>;
}

function mount(
  initial: string,
  props: { genres?: readonly string[]; shown?: number; total?: number } = {},
): void {
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <FilterBar
                genres={props.genres ?? ['Drama', 'Comedy']}
                shown={props.shown ?? 1}
                total={props.total ?? 10}
              />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

function url(): string {
  return screen.getByTestId('url').textContent ?? '';
}

function box(name: string, value: string): HTMLInputElement {
  // ⚠ `Array.from`, NOT `.values().find(...)`. Iterator helpers are ES2025 and
  // absent on Node 20, which is what `.nvmrc` and `engines` pin and what CI
  // runs; a newer local Node makes the iterator form pass here and fail there.
  const found = Array.from(
    document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`),
  ).find((input) => input.value === value);
  if (found === undefined) throw new Error(`no ${name} checkbox for ${value}`);
  return found;
}

describe('T-UI-016 - the filter bar syncs to the query string in both directions', () => {
  it('T-UI-016a renders the service, type and genre controls', () => {
    mount('/');

    expect(screen.getByTestId('filter-service')).toBeTruthy();
    expect(screen.getByTestId('filter-type')).toBeTruthy();
    expect(screen.getByTestId('filter-genre')).toBeTruthy();
  });

  it('T-UI-016b reads the selection FROM the URL, so a deep link arrives filtered', () => {
    // The direction a one-way implementation forgets: nothing was clicked, so
    // a component that only writes on change shows every box unchecked while
    // the list below is filtered.
    mount('/?service=netflix&type=movie&genre=Drama');

    expect(box('service', 'netflix').checked).toBe(true);
    expect(box('service', 'max').checked).toBe(false);
    expect(box('type', 'movie').checked).toBe(true);
    expect(box('genre', 'Drama').checked).toBe(true);
    expect(box('genre', 'Comedy').checked).toBe(false);
  });

  it('T-UI-016c writes the selection TO the URL when a filter is ticked', () => {
    mount('/');
    fireEvent.click(box('service', 'netflix'));

    expect(url()).toContain('service=netflix');
  });

  it('T-UI-016d round-trips a selection through the URL unchanged', () => {
    mount('/');
    fireEvent.click(box('service', 'max'));
    fireEvent.click(box('type', 'tv'));
    fireEvent.click(box('genre', 'Comedy'));

    const written = new URLSearchParams(url().split('?')[1] ?? '');
    expect(parseFilters(written)).toEqual({
      services: ['max'],
      types: ['tv'],
      genres: ['Comedy'],
    });
  });

  it('T-UI-016e repeats a parameter for multiple values in one dimension', () => {
    // api.md §6.2: OR within a dimension. A comma-joined `service=netflix,max`
    // is a different wire format and the API rejects it as VALIDATION_FAILED.
    mount('/?service=netflix');
    fireEvent.click(box('service', 'max'));

    const written = new URLSearchParams(url().split('?')[1] ?? '');
    expect(written.getAll('service')).toEqual(['netflix', 'max']);
  });

  it('T-UI-016f unticking removes only that value', () => {
    mount('/?service=netflix&service=max');
    fireEvent.click(box('service', 'netflix'));

    const written = new URLSearchParams(url().split('?')[1] ?? '');
    expect(written.getAll('service')).toEqual(['max']);
  });

  it('T-UI-016g preserves sort and direction across a filter change', () => {
    // REQ-038's oldest-first control is the one escape hatch from the
    // newest-first default. Rebuilding the query string from the filters alone
    // silently resets it on the first checkbox click.
    mount('/?sort=dateAdded&dir=asc');
    fireEvent.click(box('type', 'movie'));

    const written = new URLSearchParams(url().split('?')[1] ?? '');
    expect(written.get('dir')).toBe('asc');
    expect(written.get('sort')).toBe('dateAdded');
  });

  it('T-UI-016h drops an unknown value rather than forwarding it to the API', () => {
    // A hand-edited or stale shared link would otherwise return 400 and show
    // an error screen for what is really a typo.
    const params = new URLSearchParams('?service=netflix&service=disney&type=documentary');

    expect(parseFilters(params)).toEqual({
      services: ['netflix'],
      types: [],
      genres: [],
    });
  });

  it('T-UI-016i never defaults the genre dimension', () => {
    // api.md §6.2 / US-019 AC-6: absent means every genre.
    expect(parseFilters(new URLSearchParams('')).genres).toEqual([]);
    expect(isFiltered(parseFilters(new URLSearchParams('')))).toBe(false);
  });

  it('T-UI-016j shows the live result count', () => {
    mount('/?service=netflix', { shown: 42, total: 187 });

    expect(screen.getByTestId('filter-count').textContent).toBe('Showing 42 of 187');
  });

  it('T-UI-016k offers Clear filters only while something is filtered', () => {
    mount('/');
    expect(screen.queryByTestId('clear-filters')).toBeNull();

    fireEvent.click(box('genre', 'Drama'));
    expect(screen.getByTestId('clear-filters').textContent).toBe(CLEAR_FILTERS_LABEL);
  });

  it('T-UI-016l clears every dimension at once but keeps sort', () => {
    mount('/?service=netflix&type=movie&genre=Drama&dir=asc');
    fireEvent.click(screen.getByTestId('clear-filters'));

    const written = new URLSearchParams(url().split('?')[1] ?? '');
    expect(parseFilters(written)).toEqual(NO_FILTERS);
    expect(written.get('dir')).toBe('asc');
  });

  it('T-UI-016m applyFilters is pure and leaves the input untouched', () => {
    const original = new URLSearchParams('service=netflix&dir=asc');
    const next = applyFilters(original, { services: ['max'], types: [], genres: [] });

    expect(original.getAll('service')).toEqual(['netflix']);
    expect(next.getAll('service')).toEqual(['max']);
  });
});

describe('T-UX-013 - the zero-match state is not the empty state', () => {
  it('T-UX-013a says the filters excluded everything, not that the list is empty', () => {
    render(<ZeroMatch filters={{ services: ['netflix'], types: [], genres: [] }} />);

    expect(screen.getByTestId('zero-match-title').textContent).toBe(ZERO_MATCH_TITLE);
  });

  it('T-UX-013b never reads as data loss', () => {
    // US-019 AC-5. The owner's titles are all still there; a checkbox is
    // hiding them. Any wording implying otherwise is the defect.
    render(<ZeroMatch filters={{ services: [], types: ['movie'], genres: [] }} />);

    const text = screen.getByTestId('zero-match').textContent ?? '';
    expect(text).not.toMatch(/nothing here yet|no titles yet|removed|deleted|lost|empty list/i);
  });

  it('T-UX-013c names the active filters, so the cause is visible', () => {
    render(
      <ZeroMatch filters={{ services: ['max'], types: ['tv'], genres: ['Drama', 'Comedy'] }} />,
    );

    const chips = screen.getAllByTestId('zero-match-chip').map((el) => el.textContent);
    expect(chips).toEqual(['max', 'tv', 'Drama', 'Comedy']);
  });

  it('T-UX-013d offers the way out', () => {
    const onClear = vi.fn();
    render(<ZeroMatch filters={{ services: ['max'], types: [], genres: [] }} onClear={onClear} />);

    fireEvent.click(screen.getByTestId('zero-match-clear'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('T-UX-013e lists the chips in URL order so they match the controls', () => {
    const filters = parseFilters(new URLSearchParams('service=netflix&genre=Drama&type=movie'));

    expect(activeFilterChips(filters)).toEqual(['netflix', 'movie', 'Drama']);
  });
});

describe('T-UI-016 - the page wires the bar to the list', () => {
  it('T-UI-016n clearing from the zero-match state empties the query string', () => {
    render(
      <MemoryRouter initialEntries={['/?service=netflix&type=movie&dir=asc']}>
        <Routes>
          <Route
            path="/"
            element={
              <>
                <ListPage items={[]} total={12} />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId('zero-match-clear'));

    const written = new URLSearchParams(url().split('?')[1] ?? '');
    expect(parseFilters(written)).toEqual(NO_FILTERS);
    expect(written.get('dir')).toBe('asc');
  });
});
