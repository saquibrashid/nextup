// TASK-039 — the filter bar and its query-string sync (`specs/ui.md` §2.1
// item 2, `specs/api.md` §6.2, `specs/ux-states.md` §2.4).
//
// `T-UI-016` demands sync "in BOTH directions", so every case here is written
// as a round trip rather than as "clicking sets the URL". A component holding
// its own copy of the selection passes the one-way test and then drifts on the
// back button and on a deep link — the two ways a filtered list is actually
// shared and revisited.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { JSX } from 'react';
import { SERVICES, SERVICE_LABELS, runtimeInBucket } from '@nextup/domain';

import {
  FilterBar,
  NO_FILTERS,
  ZeroMatch,
  activeFilterChips,
  applyFilters,
  isFiltered,
  parseFilters,
} from '../src/components/FilterBar';
import { FilterDisclosure } from '../src/components/FilterDisclosure';
import {
  CLEAR_FILTERS_LABEL,
  FILTERS_CLOSE_LABEL,
  FILTERS_DONE_LABEL,
  FILTERS_PANEL_TITLE,
  FILTERS_TRIGGER_LABEL,
  RUNTIME_BUCKET_LABELS,
  RUNTIME_RANGE_MAX_CLAMPED,
  RUNTIME_RANGE_MAX_NAME,
  RUNTIME_RANGE_MIN_CLAMPED,
  RUNTIME_RANGE_MIN_NAME,
  ZERO_MATCH_TITLE,
  runtimeUnknownHiddenLabel,
} from '../src/copy';

/** Publishes the live URL so a test can assert what the bar actually wrote. */
function LocationProbe(): JSX.Element {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <span data-testid="url">{`${location.pathname}${location.search}`}</span>
      <button
        onClick={() => {
          void navigate(-1);
        }}
      >
        Back
      </button>
      <button
        onClick={() => {
          void navigate(1);
        }}
      >
        Forward
      </button>
    </>
  );
}

function mount(
  initial: string,
  props: {
    genres?: readonly string[];
    shown?: number;
    total?: number;
    totalIsLowerBound?: boolean;
    runtimeUnknownHidden?: number | null;
  } = {},
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
                totalIsLowerBound={props.totalIsLowerBound ?? false}
                runtimeUnknownHidden={props.runtimeUnknownHidden ?? null}
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

describe('T-MOCK-001 service chips share the existing filter state', () => {
  it('T-CATEGORY-004d preserves category URL selections, chips, back navigation and legacy type semantics', async () => {
    const filters = parseFilters(
      new URLSearchParams('category=comedy-show&category=tv&category=invalid&type=movie'),
    );
    expect(filters.categories).toEqual(['comedy-show', 'tv']);
    expect(filters.types).toEqual(['movie']);
    expect(isFiltered(filters)).toBe(true);
    expect(activeFilterChips(filters)).toEqual(['Movies', 'Comedy Show', 'TV Show']);
    expect(applyFilters(new URLSearchParams('sort=name'), filters).toString()).toBe(
      'sort=name&type=movie&category=comedy-show&category=tv',
    );
    const user = userEvent.setup();
    mount('/?category=comedy-show&sort=name');
    await openFiltersWith(user);
    await user.click(screen.getByRole('button', { name: /^Type / }));
    expect(screen.getByRole('checkbox', { name: 'Comedy Show' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Movie', exact: true }));
    expect(url()).toContain('category=movie');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Back', exact: true }));
    expect(url()).not.toContain('category=movie');
    expect(url()).toContain('category=comedy-show');
  });
  it('T-MOCK-001b: pointer focus does not collapse an inline group before the outer Done click', async () => {
    const user = userEvent.setup();
    mount('/');
    await openFiltersWith(user);
    const trigger = screen.getByRole('button', { name: /^Services / });
    await user.click(trigger);
    const done = panelDoneButton();
    fireEvent.pointerDown(done);
    fireEvent.focusIn(done);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.pointerUp(done);
    fireEvent.click(done);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('T-MOCK-001a: toggles multiple services and preserves other query choices', async () => {
    const user = userEvent.setup();
    mount('/?service=netflix&type=tv&q=moon&sort=rating&dir=asc&cursor=old');
    const services = within(screen.getByRole('group', { name: 'Filter by streaming service' }));
    const scroll = vi.fn();
    const netflix = services.getByRole('button', { name: 'Netflix' });
    Object.defineProperty(netflix, 'scrollIntoView', { value: scroll });
    fireEvent.focus(netflix);
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(services.getAllByRole('button')).toHaveLength(SERVICES.length + 1);
    expect(services.getByRole('button', { name: 'Netflix' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(services.getByRole('button', { name: 'Max', exact: true }));
    let params = new URL(url(), 'https://nextup.test').searchParams;
    expect(params.getAll('service')).toEqual(['netflix', 'max']);
    expect(params.get('cursor')).toBe('old');
    expect(params.get('type')).toBe('tv');
    expect(params.get('q')).toBe('moon');
    expect(params.get('sort')).toBe('rating');
    expect(params.get('dir')).toBe('asc');
    await user.click(services.getByRole('button', { name: 'Netflix' }));
    expect(new URL(url(), 'https://nextup.test').searchParams.getAll('service')).toEqual(['max']);
    await user.click(services.getByRole('button', { name: 'All services' }));
    params = new URL(url(), 'https://nextup.test').searchParams;
    expect(params.has('service')).toBe(false);
    expect(params.get('type')).toBe('tv');
    expect(params.get('q')).toBe('moon');
    expect(services.getByRole('button', { name: 'All services' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Back', exact: true }));
    expect(services.getByRole('button', { name: 'Max', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

function openFilters(): HTMLElement {
  fireEvent.click(screen.getByTestId('filters-trigger'));
  return screen.getByRole('dialog', { name: 'Filter your list' });
}

async function openFiltersWith(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByTestId('filters-trigger'));
  return screen.getByRole('dialog', { name: 'Filter your list' });
}

function disclosurePanel(trigger: HTMLElement): HTMLElement {
  const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
  if (panel === null) throw new Error('missing disclosure panel');
  return panel;
}

function clickDisclosureDone(trigger: HTMLElement): void {
  fireEvent.click(within(disclosurePanel(trigger)).getByRole('button', { name: 'Done' }));
}

function panelDoneButton(): HTMLElement {
  const buttons = within(screen.getByRole('dialog', { name: FILTERS_PANEL_TITLE })).getAllByRole(
    'button',
    {
      name: FILTERS_DONE_LABEL,
    },
  );
  const button = buttons.at(-1);
  if (button === undefined) throw new Error('missing panel Done button');
  return button;
}

/** Opens the Runtime picker and returns one handle of the range slider. */
function runtimeHandle(handle: 'min' | 'max'): HTMLInputElement {
  if (screen.queryByRole('dialog', { name: 'Filter your list' }) === null) openFilters();
  const trigger = screen.getByRole('button', { name: /^Runtime / });
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  return screen.getByRole<HTMLInputElement>('slider', {
    name: handle === 'min' ? RUNTIME_RANGE_MIN_NAME : RUNTIME_RANGE_MAX_NAME,
  });
}

function moveRuntime(handle: 'min' | 'max', stop: number): void {
  fireEvent.change(runtimeHandle(handle), { target: { value: String(stop) } });
}

function box(name: string, value: string): HTMLInputElement {
  const labels: Record<string, string> = {
    service: 'Services',
    type: 'Type',
    category: 'Type',
    genre: 'Genre',
    runtime: 'Runtime',
  };
  if (screen.queryByRole('dialog', { name: 'Filter your list' }) === null) openFilters();
  const trigger = screen.getByRole('button', { name: new RegExp(`^${labels[name] ?? name} `) });
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  // `Array.from`, NOT `.values().find(...)`. Both work now that the runtime is
  // Node 22 (iterator helpers landed in V8 12.2), so this is a readability
  // choice rather than a constraint — but it is the form that cannot diverge
  // between a local Node and the one CI reads from `.nvmrc`, so leave it.
  // ~~Superseded: "Iterator helpers are ES2025 and absent on Node 20, which is
  // what `.nvmrc` and `engines` pin and what CI runs."~~
  const found = Array.from(
    document.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`),
  ).find((input) => input.value === value);
  if (found === undefined) throw new Error(`no ${name} checkbox for ${value}`);
  return found;
}

describe('T-UI-016 - the filter bar syncs to the query string in both directions', () => {
  it('T-UI-016a renders the service, type and genre controls', () => {
    mount('/');
    openFilters();

    fireEvent.click(screen.getByRole('button', { name: /^Services / }));
    expect(screen.getByTestId('filter-service')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Type / }));
    expect(screen.getByTestId('filter-type')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Genre / }));
    expect(screen.getByTestId('filter-genre')).toBeTruthy();
  });

  it('T-UI-016b reads the selection FROM the URL, so a deep link arrives filtered', () => {
    // The direction a one-way implementation forgets: nothing was clicked, so
    // a component that only writes on change shows every box unchecked while
    // the list below is filtered.
    mount('/?service=netflix&category=movie&genre=Drama');

    expect(box('service', 'netflix').checked).toBe(true);
    expect(box('service', 'max').checked).toBe(false);
    expect(box('category', 'movie').checked).toBe(true);
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
    fireEvent.click(box('category', 'tv'));
    fireEvent.click(box('genre', 'Comedy'));

    const written = new URLSearchParams(url().split('?')[1] ?? '');
    expect(parseFilters(written)).toEqual({
      services: ['max'],
      types: [],
      categories: ['tv'],
      genres: ['Comedy'],
      runtimes: [],
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
    fireEvent.click(box('category', 'movie'));

    const written = new URLSearchParams(url().split('?')[1] ?? '');
    expect(written.get('dir')).toBe('asc');
    expect(written.get('sort')).toBe('dateAdded');
  });

  it('T-UI-016h drops an unknown value rather than forwarding it to the API', () => {
    // A hand-edited or stale shared link would otherwise return 400 and show
    // an error screen for what is really a typo.
    const params = new URLSearchParams(
      '?service=netflix&service=disney&type=documentary&runtime=90min',
    );

    expect(parseFilters(params)).toEqual({
      services: ['netflix'],
      types: [],
      genres: [],
      runtimes: [],
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
    const next = applyFilters(original, { services: ['max'], types: [], genres: [], runtimes: [] });

    expect(original.getAll('service')).toEqual(['netflix']);
    expect(next.getAll('service')).toEqual(['max']);
  });
});

describe('T-UX-013 - the zero-match state is not the empty state', () => {
  it('T-UX-013a says the filters excluded everything, not that the list is empty', () => {
    render(<ZeroMatch filters={{ services: ['netflix'], types: [], genres: [], runtimes: [] }} />);

    expect(screen.getByTestId('zero-match-title').textContent).toBe(ZERO_MATCH_TITLE);
  });

  it('T-UX-013b never reads as data loss', () => {
    // US-019 AC-5. The owner's titles are all still there; a checkbox is
    // hiding them. Any wording implying otherwise is the defect.
    render(<ZeroMatch filters={{ services: [], types: ['movie'], genres: [], runtimes: [] }} />);

    const text = screen.getByTestId('zero-match').textContent ?? '';
    expect(text).not.toMatch(/nothing here yet|no titles yet|removed|deleted|lost|empty list/i);
  });

  it('T-UX-013c names the active filters, so the cause is visible', () => {
    render(
      <ZeroMatch
        filters={{ services: ['max'], types: ['tv'], genres: ['Drama', 'Comedy'], runtimes: [] }}
      />,
    );

    const chips = screen.getAllByTestId('zero-match-chip').map((el) => el.textContent);
    expect(chips).toEqual(['Max', 'TV series', 'Drama', 'Comedy']);
  });

  it('T-UX-013d offers the way out', () => {
    const onClear = vi.fn();
    render(
      <ZeroMatch
        filters={{ services: ['max'], types: [], genres: [], runtimes: [] }}
        onClear={onClear}
      />,
    );

    fireEvent.click(screen.getByTestId('zero-match-clear'));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('T-UX-013e lists the chips in URL order so they match the controls', () => {
    const filters = parseFilters(new URLSearchParams('service=netflix&genre=Drama&type=movie'));

    expect(activeFilterChips(filters)).toEqual(['Netflix', 'Movies', 'Drama']);
  });
});

describe('T-UI-016 - the page wires the bar to the list', () => {
  it('T-UI-016n clearing from the zero-match state empties the query string', async () => {
    const { ListPage } = await import('../src/pages/ListPage');
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

describe('T-UX-144 - labelled filter fields and split runtime options', () => {
  it('T-UX-145a the Filters trigger is a labelled dialog button whose expanded state follows the panel', () => {
    mount('/');
    const trigger = screen.getByTestId('filters-trigger');
    expect(trigger).toHaveAccessibleName(FILTERS_TRIGGER_LABEL);
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: FILTERS_PANEL_TITLE })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: FILTERS_CLOSE_LABEL }));
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('T-UX-145b the picker fields are absent until the Filters panel opens', () => {
    mount('/');
    expect(screen.queryByRole('group', { name: 'Filter by', exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Services / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Type / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Genre / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Runtime / })).not.toBeInTheDocument();

    openFilters();

    expect(screen.getByRole('group', { name: 'Filter by', exact: true })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Services / })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Type / })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Genre / })).toBeVisible();
    expect(screen.getByRole('button', { name: /^Runtime / })).toBeVisible();
  });

  it('T-UX-145c the trigger counts active filter values but not the search term', () => {
    mount('/?q=Arrival');
    expect(screen.getByTestId('filters-trigger')).toHaveAccessibleName(FILTERS_TRIGGER_LABEL);
    expect(screen.queryByLabelText(/\d+ active/)).not.toBeInTheDocument();

    cleanup();

    mount('/?q=Arrival&service=netflix&service=max&type=movie&runtime=under30');
    expect(screen.getByTestId('filters-trigger')).toHaveAccessibleName(
      `${FILTERS_TRIGGER_LABEL} 4 active`,
    );
    expect(screen.getByLabelText('4 active')).toHaveTextContent('4');
  });

  it('T-UX-145d Done keeps a selected service in the URL and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    mount('/?sort=name&dir=asc');
    const trigger = screen.getByTestId('filters-trigger');
    await openFiltersWith(user);
    await user.click(screen.getByRole('button', { name: 'Services All services' }));
    await user.click(screen.getByRole('checkbox', { name: 'Netflix' }));
    await user.click(panelDoneButton());

    expect(new URLSearchParams(url().split('?')[1]).getAll('service')).toEqual(['netflix']);
    expect(url()).toContain('sort=name');
    expect(url()).toContain('dir=asc');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('dialog', { name: FILTERS_PANEL_TITLE })).not.toBeInTheDocument();
  });

  it('T-UX-145e Escape closes the panel without undoing a selected service', async () => {
    const user = userEvent.setup();
    mount('/');
    const trigger = screen.getByTestId('filters-trigger');
    await openFiltersWith(user);
    await user.click(screen.getByRole('button', { name: 'Services All services' }));
    await user.click(screen.getByRole('checkbox', { name: 'Netflix' }));
    clickDisclosureDone(screen.getByRole('button', { name: 'Services Netflix' }));
    await user.keyboard('{Escape}');

    expect(new URLSearchParams(url().split('?')[1]).getAll('service')).toEqual(['netflix']);
    expect(screen.queryByRole('dialog', { name: FILTERS_PANEL_TITLE })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('T-UX-144a each field has a visible category, current value and decorative chevron', () => {
    mount('/');
    openFilters();
    expect(screen.getByRole('group', { name: 'Filter by', exact: true })).toBeVisible();
    for (const [category, value] of [
      ['Services', 'All services'],
      ['Type', 'All types'],
      ['Genre', 'All genres'],
      ['Runtime', 'Any runtime'],
    ]) {
      const trigger = screen.getByRole('button', { name: `${category} ${value}`, exact: true });
      expect(trigger).toHaveTextContent(value ?? '');
      expect(document.querySelector(`label[for="${trigger.id}"]`)).toHaveTextContent(
        category ?? '',
      );
      expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('T-UX-144b field summaries show one named selection or a deduplicated selection count', () => {
    mount('/?service=netflix&type=movie&genre=Drama&genre=Comedy&genre=Drama&runtime=90-120');
    openFilters();
    expect(screen.getByRole('button', { name: 'Services Netflix' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Type Movies' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Genre 2 selected' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: `Runtime ${RUNTIME_BUCKET_LABELS['90-120']}` }),
    ).toBeVisible();
  });

  it('T-UX-144c selecting a value updates the same named field while its picker remains open', () => {
    mount('/');
    openFilters();
    const trigger = screen.getByRole('button', { name: 'Services All services' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Netflix' }));
    expect(trigger).toHaveAccessibleName('Services Netflix');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Max' }));
    expect(trigger).toHaveAccessibleName('Services 2 selected');
    clickDisclosureDone(trigger);
    expect(trigger).toHaveFocus();
  });

  it('T-UX-144d runtime slider stops keep the five split ranges, with independent 60-90 and 90-120 steps', () => {
    mount('/');
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Runtime Any runtime' }));
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    const handles = screen.getAllByRole('slider');
    expect(handles).toHaveLength(2);
    for (const handle of handles) {
      expect(handle).toHaveAttribute('min', '0');
      expect(handle).toHaveAttribute('max', '5');
      expect(handle).toHaveAttribute('step', '1');
    }
    moveRuntime('min', 2);
    moveRuntime('max', 3);
    expect(new URLSearchParams(url().split('?')[1]).getAll('runtime')).toEqual(['60-90']);
    moveRuntime('max', 4);
    expect(new URLSearchParams(url().split('?')[1]).getAll('runtime')).toEqual(['60-90', '90-120']);
    expect(screen.getByRole('button', { name: 'Runtime 1h – 2h' })).toBeVisible();
  });

  it('T-UX-144e a legacy range selects both replacements and either chip can remove only its half', () => {
    mount('/?runtime=60-120&runtime=60-90&service=netflix&sort=name&dir=asc&q=Arrival');
    expect(parseFilters(new URLSearchParams(url().split('?')[1])).runtimes).toEqual([
      '60-90',
      '90-120',
    ]);
    expect(runtimeHandle('min')).toHaveValue('2');
    expect(runtimeHandle('max')).toHaveValue('4');
    clickDisclosureDone(screen.getByRole('button', { name: /^Runtime / }));
    fireEvent.click(
      screen.getByRole('button', {
        name: `Remove runtime filter: ${RUNTIME_BUCKET_LABELS['60-90']}`,
      }),
    );
    const remaining = new URLSearchParams(url().split('?')[1]);
    expect(remaining.getAll('runtime')).toEqual(['90-120']);
    expect(remaining.get('service')).toBe('netflix');
    expect(remaining.get('sort')).toBe('name');
    expect(remaining.get('dir')).toBe('asc');
    expect(remaining.get('q')).toBe('Arrival');
    expect(
      screen.getByRole('button', { name: `Runtime ${RUNTIME_BUCKET_LABELS['90-120']}` }),
    ).toBeVisible();
  });

  it('T-UX-144f clearing a legacy filter returns the field to Any runtime without an obsolete option', () => {
    mount('/?runtime=60-120&dir=asc');
    fireEvent.click(screen.getByTestId('clear-filters'));
    expect(url()).toBe('/?dir=asc');
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: 'Runtime Any runtime' }));
    expect(runtimeHandle('min')).toHaveValue('0');
    expect(runtimeHandle('max')).toHaveValue('5');
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});

describe('REQ-035 - the runtime filter (`specs/ui-refresh.md` §5a)', () => {
  it('T-UX-123h selecting a bucket writes `runtime` to the query string', () => {
    mount('/');
    moveRuntime('max', 3);
    moveRuntime('min', 2);

    const written = new URLSearchParams(url().split('?')[1] ?? '');
    expect(written.getAll('runtime')).toEqual(['60-90']);
    expect(parseFilters(written).runtimes).toEqual(['60-90']);
  });

  it('T-UX-123i the boundaries the labels name are half-open', () => {
    // The UI and the database must agree on the 60-minute case or the list
    // contradicts its own chip. Both read `RUNTIME_BUCKET_BOUNDS`; this asserts
    // the shared rule from the UI side so a divergence cannot hide behind the
    // fact that each side was tested alone.
    expect(runtimeInBucket(60, '60-90')).toBe(true);
    expect(runtimeInBucket(60, '30-60')).toBe(false);
    expect(runtimeInBucket(89, '60-90')).toBe(true);
    expect(runtimeInBucket(90, '60-90')).toBe(false);
    expect(runtimeInBucket(90, '90-120')).toBe(true);
    expect(runtimeInBucket(119, '90-120')).toBe(true);
    expect(runtimeInBucket(120, '90-120')).toBe(false);
    expect(runtimeInBucket(120, 'over120')).toBe(true);
  });

  it('T-UX-123j the bucket fieldset renders whatever the data contains', () => {
    // Unlike the genre fieldset, which is conditional on the list having
    // genres. The buckets are fixed, and hiding them on a list with no
    // runtimes would remove the only control that accounts for the list's
    // length.
    mount('/', { genres: [] });
    openFilters();
    fireEvent.click(screen.getByRole('button', { name: /^Runtime / }));
    expect(screen.getByTestId('filter-runtime')).toBeTruthy();
    expect(screen.queryByTestId('filter-genre')).toBeNull();
  });

  describe('T-UX-139 - scalable filter pickers and removable active filters', () => {
    it('T-UX-139a starts compact and offers only registry services, without a phantom All', async () => {
      const user = userEvent.setup();
      mount('/');
      expect(screen.getByTestId('filters-trigger')).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('checkbox')).toBeNull();
      await openFiltersWith(user);
      for (const name of ['Services', 'Type', 'Genre', 'Runtime']) {
        expect(screen.getByRole('button', { name: new RegExp(`^${name} `) })).toHaveAttribute(
          'aria-expanded',
          'false',
        );
      }
      await user.click(screen.getByRole('button', { name: /^Services / }));
      expect(screen.getAllByRole('checkbox')).toHaveLength(SERVICES.length);
      expect(SERVICES).toEqual([
        'netflix',
        'max',
        'prime-video',
        'disney-plus',
        'apple-tv-plus',
        'paramount-plus',
        'starz',
        'peacock',
      ]);
      for (const service of SERVICES) {
        expect(screen.getByRole('checkbox', { name: SERVICE_LABELS[service] })).toBeEnabled();
      }
      expect(screen.queryByRole('checkbox', { name: /all/i })).toBeNull();
      expect(screen.getByRole('dialog', { name: 'Filter your list' })).toBeVisible();
    });

    it('T-UX-139b service search filters only picker options, retaining selection and URL state', async () => {
      const user = userEvent.setup();
      mount('/?service=netflix&q=Arrival&sort=dateAdded&dir=asc&view=grid');
      await openFiltersWith(user);
      await user.click(screen.getByRole('button', { name: /^Services / }));
      const search = screen.getByRole('searchbox', { name: 'Search services' });
      expect(search).toHaveFocus();
      const original = url();
      await user.type(search, '  MAX');
      expect(screen.queryByRole('checkbox', { name: 'Netflix' })).toBeNull();
      expect(screen.getByRole('checkbox', { name: 'Max' })).toBeVisible();
      expect(url()).toBe(original);
      await user.click(screen.getByRole('checkbox', { name: 'Max' }));
      expect(new URLSearchParams(url().split('?')[1]).getAll('service')).toEqual([
        'netflix',
        'max',
      ]);
      const written = new URLSearchParams(url().split('?')[1]);
      expect(written.get('q')).toBe('Arrival');
      expect(written.get('sort')).toBe('dateAdded');
      expect(written.get('dir')).toBe('asc');
      expect(written.get('view')).toBe('grid');
      expect(screen.getByRole('button', { name: 'Remove service filter: Netflix' })).toBeVisible();
      await user.clear(search);
      expect(screen.getByRole('checkbox', { name: 'Netflix' })).toBeChecked();
      await user.type(search, 'unavailable provider');
      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.getByText('No services match your search.')).toHaveAttribute('role', 'status');
      expect(screen.getByTestId('filter-count')).toHaveTextContent('Showing 1 of 10');
    });

    it.each([
      ['service', 'netflix', 'Netflix'],
      ['service', 'max', 'Max'],
      ['type', 'movie', 'Movies'],
      ['type', 'tv', 'TV series'],
      ['genre', 'Drama', 'Drama'],
      ['runtime', 'under30', RUNTIME_BUCKET_LABELS.under30],
    ])('T-UX-139c removes only %s=%s, with a human-facing %s chip', (dimension, value, label) => {
      const initial =
        '/?service=netflix&service=max&type=movie&type=tv&genre=Drama&genre=Comedy&runtime=under30&runtime=over120&q=Arrival&sort=runtime&dir=asc&view=grid&cursor=abc&extra=one&extra=two';
      mount(initial, { shown: 4, total: 10 });
      const chips = screen.getByRole('list', { name: 'Active filters' });
      const chip = within(chips).getByRole('button', {
        name: `Remove ${dimension} filter: ${label}`,
      });
      expect(chip).toHaveClass('tap-target');
      expect(chip).toHaveAttribute('type', 'button');
      const expected = new URLSearchParams(initial.split('?')[1]);
      expected.delete(dimension, value);
      fireEvent.click(chip);
      const actual = new URLSearchParams(url().split('?')[1]);
      actual.sort();
      expected.sort();
      expect(actual.toString()).toBe(expected.toString());
      expect(screen.getByTestId('filter-count')).toHaveTextContent('Showing 4 of 10');
    });

    it('T-UX-139d exposes a search-only chip and removes q without touching other parameters', () => {
      mount('/?q=Arrival&sort=title&dir=desc&view=grid&extra=keep');
      expect(screen.getByTestId('clear-filters')).toBeVisible();
      fireEvent.click(
        screen.getByRole('button', { name: 'Remove search filter: Search: Arrival' }),
      );
      expect(url()).toBe('/?sort=title&dir=desc&view=grid&extra=keep');
      expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
      expect(screen.queryByTestId('clear-filters')).toBeNull();
    });

    it('T-UX-139e Clear filters removes every dimension and q, preserving sort, view and unrelated parameters', () => {
      mount(
        '/?service=max&type=tv&genre=Drama&runtime=over120&q=Arrival&sort=title&dir=asc&view=grid&extra=keep',
      );
      fireEvent.click(screen.getByTestId('clear-filters'));
      expect(url()).toBe('/?sort=title&dir=asc&view=grid&extra=keep');
      expect(screen.queryByRole('list', { name: 'Active filters' })).toBeNull();
    });

    it('T-UX-139f keyboard opening, picker Done and panel Escape keep selected filters', async () => {
      const user = userEvent.setup();
      mount('/');
      const panelTrigger = screen.getByTestId('filters-trigger');
      await openFiltersWith(user);
      const trigger = screen.getByRole('button', { name: /^Type / });
      trigger.focus();
      await user.keyboard('{Enter}');
      const movies = screen.getByRole('checkbox', { name: 'Movie', exact: true });
      expect(movies).toHaveFocus();
      await user.keyboard(' ');
      expect(movies).toBeChecked();
      await user.keyboard('{Escape}');
      expect(panelTrigger).toHaveFocus();
      expect(screen.queryByRole('dialog', { name: FILTERS_PANEL_TITLE })).not.toBeInTheDocument();
      expect(url()).toContain('category=movie');
      await openFiltersWith(user);
      const updatedTrigger = screen.getByRole('button', { name: /^Type / });
      updatedTrigger.focus();
      await user.keyboard(' ');
      expect(screen.getByRole('checkbox', { name: 'Movie', exact: true })).toBeChecked();
      await user.click(
        within(disclosurePanel(updatedTrigger)).getByRole('button', { name: 'Done' }),
      );
      expect(updatedTrigger).toHaveFocus();
      expect(updatedTrigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('T-UX-139g outside click closes and restores focus; Tab leaves without a focus trap', async () => {
      const user = userEvent.setup();
      mount('/');
      await openFiltersWith(user);
      const trigger = screen.getByRole('button', { name: /^Type / });
      await user.click(trigger);
      screen.getByRole('checkbox', { name: 'Movie', exact: true }).focus();
      fireEvent.click(screen.getByRole('heading', { name: 'Filter your list' }));
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveFocus();
      await user.click(trigger);
      await user.tab();
      expect(screen.getByRole('checkbox', { name: 'TV Show' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('checkbox', { name: 'Comedy Show' })).toHaveFocus();
      await user.tab();
      expect(within(disclosurePanel(trigger)).getByRole('button', { name: 'Done' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: /^Genre / })).toHaveFocus();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });

    it('T-UX-139h opening another picker closes the first without stealing its focus', async () => {
      const user = userEvent.setup();
      mount('/');
      await openFiltersWith(user);
      const services = screen.getByRole('button', { name: /^Services / });
      await user.click(services);
      await user.click(screen.getByRole('button', { name: /^Runtime / }));
      expect(services).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByRole('slider', { name: RUNTIME_RANGE_MIN_NAME })).toHaveFocus();
    });

    it('T-UX-139i generated IDs remain unique across instances and stable across updates', () => {
      render(
        <MemoryRouter>
          <FilterBar shown={1} total={2} />
          <FilterBar shown={1} total={2} />
        </MemoryRouter>,
      );
      const filterTriggers = screen.getAllByTestId('filters-trigger');
      for (const filterTrigger of filterTriggers) {
        fireEvent.click(filterTrigger);
        const trigger = screen.getByRole('button', { name: /^Services / });
        const controls = trigger.getAttribute('aria-controls');
        expect(controls).toBeTruthy();
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute('aria-controls', controls);
        expect(document.getElementById(controls ?? '')).toHaveAccessibleName('Services');
        clickDisclosureDone(trigger);
        fireEvent.click(panelDoneButton());
      }
      const ids = Array.from(document.querySelectorAll('[id]'), (element) => element.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('T-UX-139j Back and Forward update both chips and reopened checkboxes from the URL', async () => {
      const user = userEvent.setup();
      mount('/?service=netflix&q=Arrival');
      await user.click(screen.getByRole('button', { name: 'Remove service filter: Netflix' }));
      await user.click(screen.getByRole('button', { name: 'Back' }));
      expect(screen.getByRole('button', { name: 'Remove service filter: Netflix' })).toBeVisible();
      expect(box('service', 'netflix')).toBeChecked();
      await user.click(screen.getByRole('button', { name: 'Forward' }));
      expect(screen.queryByRole('button', { name: 'Remove service filter: Netflix' })).toBeNull();
      expect(box('service', 'netflix')).not.toBeChecked();
      expect(
        screen.getByRole('button', { name: 'Remove search filter: Search: Arrival' }),
      ).toBeVisible();
    });

    it('T-UX-139k identical labels across dimensions remove only the targeted value', () => {
      mount('/?service=max&genre=Max&genre=Max&type=movie');
      expect(screen.getAllByRole('button', { name: 'Remove genre filter: Max' })).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Remove genre filter: Max' }));
      expect(url()).toBe('/?service=max&type=movie');
      expect(screen.getByRole('button', { name: 'Remove service filter: Max' })).toBeVisible();
    });

    it('T-UX-139l keeps the live count honest when the total is a lower bound', () => {
      mount('/?service=netflix', { shown: 50, total: 50, totalIsLowerBound: true });
      expect(screen.getByTestId('filter-count')).toHaveTextContent('Showing 50 of at least 50');
      expect(screen.getByTestId('filter-count')).toHaveAttribute('role', 'status');
      expect(screen.getByRole('button', { name: 'Remove service filter: Netflix' })).toBeVisible();
    });

    it('T-UX-139m standalone disclosures retain their control identity when labels change', () => {
      const { rerender } = render(
        <FilterDisclosure label="Services (2)">
          <p>Selected services</p>
        </FilterDisclosure>,
      );
      const trigger = screen.getByRole('button', { name: 'Services (2)' });
      const id = trigger.id;
      rerender(
        <FilterDisclosure label="Services">
          <p>Selected services</p>
        </FilterDisclosure>,
      );
      expect(screen.getByRole('button', { name: 'Services', exact: true })).toHaveAttribute(
        'id',
        id,
      );
    });

    it('T-UX-139n standalone factual disclosures focus their first link and restore focus on Done', async () => {
      const user = userEvent.setup();
      render(
        <FilterDisclosure label="Service updates">
          <a href="/upload?service=netflix">Netflix updated today</a>
        </FilterDisclosure>,
      );
      const trigger = screen.getByRole('button', { name: 'Service updates' });
      await user.click(trigger);
      expect(screen.getByRole('link', { name: 'Netflix updated today' })).toHaveFocus();
      await user.tab();
      expect(screen.getByRole('button', { name: 'Done' })).toHaveFocus();
      await user.keyboard('{Enter}');
      expect(trigger).toHaveFocus();
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
    });
  });

  it('T-UX-123k buckets stay OR-ed within the dimension; the slider selects a contiguous run', () => {
    mount('/?runtime=under30');
    moveRuntime('max', 3);

    const written = new URLSearchParams(url().split('?')[1] ?? '');
    expect(written.getAll('runtime')).toEqual(['under30', '30-60', '60-90']);
  });

  it('T-UX-123l an unknown bucket is dropped rather than forwarded to the API', () => {
    // `runtime` reaches the API as a closed enum and an unrecognised token is a
    // 400 (`T-API-021`). A stale shared link must show an unfiltered dimension,
    // not an error screen.
    expect(parseFilters(new URLSearchParams('runtime=90min')).runtimes).toEqual([]);
  });

  it('T-UX-123m a runtime filter counts as filtered and clears with the rest', () => {
    mount('/?runtime=under30');
    expect(screen.getByTestId('clear-filters')).toBeTruthy();

    fireEvent.click(screen.getByTestId('clear-filters'));
    const written = new URLSearchParams(url().split('?')[1] ?? '');
    expect(written.getAll('runtime')).toEqual([]);
  });

  it('T-UX-123n a runtime change preserves sort and direction', () => {
    // Same escape-hatch reasoning as T-UI-016g: rebuilding the query from the
    // filters alone silently resets the owner's sort on the first click.
    mount('/?sort=runtime&dir=asc');
    moveRuntime('max', 1);

    const written = new URLSearchParams(url().split('?')[1] ?? '');
    expect(written.get('dir')).toBe('asc');
    expect(written.get('sort')).toBe('runtime');
  });

  it('T-UX-013 the zero-match chip NAMES the bucket rather than showing its token', () => {
    // The chips exist to state the cause of an empty list. `60-120` is the wire
    // vocabulary; the owner ticked a box that said "1h - 2h".
    const filters = parseFilters(new URLSearchParams('runtime=60-90'));
    expect(activeFilterChips(filters)).toEqual([RUNTIME_BUCKET_LABELS['60-90']]);
  });
});

describe('REQ-035 - the hidden-unknown disclosure (`T-UX-124`)', () => {
  it('T-UX-124a renders the SERVER count while a runtime filter is active', () => {
    // ⚠ THE COUNT CANNOT COME FROM THE CLIENT. The excluded rows were never
    // sent, so any figure computed from `items` counts what survived the
    // filter - it would read 0 on every list and look right in every fixture.
    mount('/?runtime=under30', { runtimeUnknownHidden: 3 });

    const disclosure = screen.getByTestId('runtime-unknown-hidden');
    expect(disclosure.textContent).toContain('3');
    expect(disclosure.textContent).toMatch(/no runtime/i);
  });

  it('T-UX-124b does not render at all when no runtime filter is active', () => {
    mount('/?service=netflix', { runtimeUnknownHidden: null });
    expect(screen.queryByTestId('runtime-unknown-hidden')).toBeNull();
  });

  it('T-UX-124c stays silent when the filter is active but hid nothing', () => {
    // `0` and `null` both render nothing, but they are different facts and the
    // component must not collapse them into one falsy check.
    mount('/?runtime=under30', { runtimeUnknownHidden: 0 });
    expect(screen.queryByTestId('runtime-unknown-hidden')).toBeNull();
  });

  it('T-UX-124d says "1 title" rather than "1 titles"', () => {
    mount('/?runtime=under30', { runtimeUnknownHidden: 1 });
    expect(screen.getByTestId('runtime-unknown-hidden').textContent).toBe(
      runtimeUnknownHiddenLabel(1),
    );
  });

  it('T-UX-124e is announced, because a screen-reader user gets no other signal', () => {
    // A sighted owner sees the list shrink; without `role=status` nothing at
    // all reports that a filter removed titles it could not classify.
    mount('/?runtime=under30', { runtimeUnknownHidden: 2 });
    expect(screen.getByTestId('runtime-unknown-hidden').getAttribute('role')).toBe('status');
  });
});

describe('T-RANGE-002 the runtime range slider (#366)', () => {
  it('T-RANGE-002a shows Min and Max labels, values with units and named handles', () => {
    mount('/?runtime=60-90&runtime=90-120');
    const min = runtimeHandle('min');
    const max = runtimeHandle('max');
    const slider = screen.getByTestId('filter-runtime');
    expect(within(slider).getByText('Min', { selector: 'label' })).toHaveAttribute('for', min.id);
    expect(within(slider).getByText('Max', { selector: 'label' })).toHaveAttribute('for', max.id);
    expect(within(slider).getByTestId('range-min-value')).toHaveTextContent('1h');
    expect(within(slider).getByTestId('range-max-value')).toHaveTextContent('2h');
    expect(min).toHaveAttribute('aria-valuetext', '1 hour');
    expect(max).toHaveAttribute('aria-valuetext', '2 hours');
    expect(screen.getByRole('button', { name: 'Runtime 1h – 2h' })).toBeVisible();
  });

  it('T-RANGE-002b the track ends announce no limit rather than a length', () => {
    mount('/');
    expect(runtimeHandle('min')).toHaveAttribute('aria-valuetext', 'No minimum');
    expect(runtimeHandle('max')).toHaveAttribute('aria-valuetext', 'No maximum');
    expect(screen.getByTestId('range-max-value')).toHaveTextContent('No limit');
  });

  it('T-RANGE-002c the minimum stops short of the maximum and says why, never swapping', () => {
    mount('/?runtime=30-60&runtime=60-90&sort=name');
    moveRuntime('min', 5);
    expect(runtimeHandle('min')).toHaveValue('2');
    expect(runtimeHandle('max')).toHaveValue('3');
    expect(new URLSearchParams(url().split('?')[1]).getAll('runtime')).toEqual(['60-90']);
    const notice = within(screen.getByTestId('filter-runtime')).getByTestId('range-notice');
    expect(notice).toHaveAttribute('role', 'status');
    expect(notice).toHaveTextContent(RUNTIME_RANGE_MIN_CLAMPED);
    moveRuntime('max', 0);
    expect(runtimeHandle('min')).toHaveValue('2');
    expect(runtimeHandle('max')).toHaveValue('3');
    expect(notice).toHaveTextContent(RUNTIME_RANGE_MAX_CLAMPED);
    moveRuntime('max', 5);
    expect(notice).toHaveTextContent('');
    expect(new URLSearchParams(url().split('?')[1]).get('sort')).toBe('name');
  });

  it('T-RANGE-002d dragging back to the full track removes the runtime filter', () => {
    mount('/?runtime=over120&service=netflix', { runtimeUnknownHidden: 2 });
    expect(screen.getByTestId('runtime-unknown-hidden')).toBeVisible();
    moveRuntime('min', 0);
    const written = new URLSearchParams(url().split('?')[1]);
    expect(written.has('runtime')).toBe(false);
    expect(written.get('service')).toBe('netflix');
    expect(screen.getByRole('button', { name: 'Runtime Any runtime' })).toBeVisible();
  });

  it('T-RANGE-002e a saved selection with a gap is disclosed and kept until a handle moves', () => {
    mount('/?runtime=under30&runtime=over120');
    const min = runtimeHandle('min');
    expect(min).toHaveValue('0');
    expect(runtimeHandle('max')).toHaveValue('5');
    const slider = screen.getByTestId('filter-runtime');
    expect(slider).toHaveAccessibleDescription(/separate ranges \(Under 30m, Over 2h\)/);
    expect(screen.getByRole('button', { name: 'Runtime 2 selected' })).toBeVisible();
    expect(new URLSearchParams(url().split('?')[1]).getAll('runtime')).toEqual([
      'under30',
      'over120',
    ]);
    moveRuntime('min', 1);
    expect(new URLSearchParams(url().split('?')[1]).getAll('runtime')).toEqual([
      '30-60',
      '60-90',
      '90-120',
      'over120',
    ]);
    expect(screen.getByTestId('filter-runtime')).not.toHaveAccessibleDescription();
  });

  it('T-RANGE-002f handle positions follow the URL through Back and Forward', () => {
    mount('/?runtime=under30');
    moveRuntime('max', 2);
    expect(runtimeHandle('max')).toHaveValue('2');
    fireEvent.click(screen.getByRole('button', { name: 'Back', hidden: true }));
    expect(runtimeHandle('max')).toHaveValue('1');
    fireEvent.click(screen.getByRole('button', { name: 'Forward', hidden: true }));
    expect(runtimeHandle('max')).toHaveValue('2');
  });
});
