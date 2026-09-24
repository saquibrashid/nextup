/**
 * Owner-approved 2026-09-16: five complete-order buttons, with one-click
 * reversal of the selected order. Existing IDs retain their behavioral
 * coverage; radio-shape and direction-preservation assertions are superseded.
 *
 * Owner-approved 2026-09-17 (`specs/ui.md` §2.1 item 2, §10.1): the six orders
 * moved into a chooser opened from the toolbar, and a dedicated reverse button
 * stayed on the toolbar beside it. Two consequences run through this file:
 *
 *  1. Anything that asserts "the current order is legible" now asserts it on
 *     the toolbar trigger (`expectOrder`), which shows the complete order with
 *     nothing open. That is the same claim the old `toHaveTextContent` on the
 *     pressed button made; the chooser rows spell the field and the direction
 *     separately, so their text alone no longer names a complete order.
 *  2. Anything that means "reverse the current order" now clicks the toolbar
 *     reverse button. Reversal from inside the chooser still works and is
 *     still covered, but the reverse button is the control REQ-038 / §10.1
 *     require to be reachable with nothing open, so it is what the
 *     one-interaction assertions exercise.
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, type JSX } from 'react';
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
  useSearchParams,
} from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SortControl,
  readSortDir,
  readSortKey,
  defaultDirFor,
  SORT_KEYS,
  type SortDir,
  type SortKey,
} from '../src/components/SortControl';
import { ListPage } from '../src/pages/ListPage';
import { LibraryNavigation } from '../src/components/LibraryNavigation';

const remembered = (): URLSearchParams =>
  new URLSearchParams(localStorage.getItem('nextup.library.v1') ?? '');

const FIELD_NAMES = [
  'Added to library',
  'Title',
  'Release date',
  'Runtime',
  'Rating',
  'Watch priority',
];

/** Both ways round, so a test naming one order need not also name its reverse. */
const REVERSE_OF: Readonly<Record<string, string>> = {
  'Recently added': 'Oldest additions',
  'Oldest additions': 'Recently added',
  'Name A-Z': 'Name Z-A',
  'Name Z-A': 'Name A-Z',
  'Newest releases': 'Oldest releases',
  'Oldest releases': 'Newest releases',
  'Longest runtime': 'Shortest runtime',
  'Shortest runtime': 'Longest runtime',
  'Highest rated': 'Lowest rated',
  'Lowest rated': 'Highest rated',
  'Watch priority': 'Lower priority first',
  'Lower priority first': 'Watch priority',
};

function trigger(): HTMLElement {
  return screen.getByTestId('sort-trigger');
}

function reverseButton(): HTMLElement {
  return screen.getByTestId('sort-reverse');
}

/**
 * The chooser is a dialog, so it is absent until asked for. Opening it here
 * keeps every order-selection assertion below about what selecting an order
 * does, rather than about the disclosure that now precedes it.
 */
function sortGroup(): HTMLElement {
  if (screen.queryByTestId('sort-control') === null) fireEvent.click(trigger());
  return screen.getByTestId('sort-control');
}

/**
 * The complete current order, read from the toolbar with nothing open — this
 * is where the owner reads it now, so it is where the tests read it.
 */
function expectOrder(label: string): void {
  expect(trigger()).toHaveTextContent(label);
  expect(trigger()).toHaveAccessibleName(`Sort: ${label}. Change the order.`);
}

function selectedButton(): HTMLElement {
  return within(sortGroup()).getByRole('button', { pressed: true });
}

/** The selected row still announces its complete order and its reverse. */
function expectSelectedOrder(label: string): void {
  expect(selectedButton()).toHaveAccessibleName(
    `${label}. Selected. Change to ${REVERSE_OF[label]}.`,
  );
}

function button(label: string): HTMLElement {
  return within(sortGroup()).getByRole('button', { name: label });
}

function SearchProbe({ onSearch }: { onSearch?: (search: string) => void }): JSX.Element {
  const [params] = useSearchParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    onSearch?.(search);
  }, [search, onSearch]);
  return (
    <LibraryNavigation>
      <span data-testid="search-probe">{params.toString()}</span>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
    </LibraryNavigation>
  );
}

function renderWithProbe(
  initialUrl = '/',
  options: { page?: boolean; entries?: string[]; onSearch?: (search: string) => void } = {},
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={options.entries ?? [initialUrl]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              {options.page ? <ListPage items={[]} total={0} /> : <SortControl />}
              <SearchProbe {...(options.onSearch ? { onSearch: options.onSearch } : {})} />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

const renderSortControl = renderWithProbe;
const renderListPage = (initialUrl = '/'): ReturnType<typeof render> =>
  renderWithProbe(initialUrl, { page: true });
const query = (): URLSearchParams =>
  new URLSearchParams(screen.getByTestId('search-probe').textContent ?? '');

beforeEach(() => {
  sessionStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe('T-UI-024 - SortControl', () => {
  it('T-UI-024a: renders the sort control buttons', () => {
    renderSortControl();
    expect(sortGroup()).toBeInTheDocument();
    expect(within(sortGroup()).getAllByRole('button')).toHaveLength(6);
  });

  it('T-UI-024b: defaults to recently added', () => {
    renderSortControl();
    expectOrder('Recently added');
    expectSelectedOrder('Recently added');
  });

  it('T-UI-024c: click reverses to oldest additions', () => {
    renderSortControl();
    fireEvent.click(reverseButton());
    expectOrder('Oldest additions');
    expect(query().get('dir')).toBe('asc');
  });

  it('T-UI-024d: second click reverses back to recently added', () => {
    renderSortControl();
    fireEvent.click(reverseButton());
    fireEvent.click(reverseButton());
    expectOrder('Recently added');
    expect(query().get('dir')).toBe('desc');
  });

  it('T-UI-024e: inactive orders have aria-pressed false', () => {
    renderSortControl();
    expect(within(sortGroup()).getAllByRole('button', { pressed: false })).toHaveLength(5);
    expect(button('Name A-Z')).toHaveAttribute('aria-pressed', 'false');
  });

  it('T-UI-024f: oldest additions remains the sole pressed order', () => {
    renderSortControl();
    fireEvent.click(reverseButton());
    expectSelectedOrder('Oldest additions');
    expect(within(sortGroup()).getAllByRole('button', { pressed: true })).toHaveLength(1);
  });

  it('T-UI-024g: readSortDir reads asc from URL params', () => {
    expect(readSortDir(new URLSearchParams('dir=asc'))).toBe('asc');
  });

  it('T-UI-024h: readSortDir reads desc from URL params', () => {
    expect(readSortDir(new URLSearchParams('dir=desc'))).toBe('desc');
  });

  it('T-UI-024i: readSortDir defaults to desc when no param', () => {
    expect(readSortDir(new URLSearchParams())).toBe('desc');
  });

  it('T-UI-024j: obsolete direction-only session storage cannot change a URL default', () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    expect(readSortDir(new URLSearchParams())).toBe('desc');
  });

  it('T-UI-024k: URL param overrides session storage', () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    expect(readSortDir(new URLSearchParams('dir=desc'))).toBe('desc');
  });

  it('T-UI-024l: every button uses the primitive and keeps the tap-target floor', () => {
    renderSortControl();
    for (const option of within(sortGroup()).getAllByRole('button')) {
      expect(option).toHaveClass('btn', 'btn--secondary', 'tap-target');
      expect(option.tagName).toBe('BUTTON');
      expect(option).toHaveAttribute('type', 'button');
    }
  });

  it('T-UI-024m: keyboard Enter and Space reverse the selected order', async () => {
    const user = userEvent.setup();
    renderSortControl();
    await user.tab();
    expect(trigger()).toHaveFocus();
    await user.tab();
    expect(reverseButton()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(query().get('dir')).toBe('asc');
    expect(reverseButton()).toHaveFocus();
    await user.keyboard(' ');
    expect(query().get('dir')).toBe('desc');
  });

  it('T-UI-024n: dir=asc in URL renders oldest additions', () => {
    renderSortControl('/?dir=asc');
    expectOrder('Oldest additions');
  });

  it('T-UI-024o: a persisted complete order is written into the URL', async () => {
    localStorage.setItem('nextup.library.v1', 'sort=dateAdded&dir=asc');
    renderWithProbe();
    await waitFor(() => expect(query().get('dir')).toBe('asc'));
    expectOrder('Oldest additions');
  });

  it('T-UI-024p: explicit filters beat saved choices without inheriting their direction', () => {
    localStorage.setItem('nextup.library.v1', 'sort=dateAdded&dir=asc');
    renderWithProbe('/?service=netflix&type=movie');
    expect(query().has('dir')).toBe(false);
    expectOrder('Recently added');
    expect(query().get('service')).toBe('netflix');
    expect(query().get('type')).toBe('movie');
  });

  it('T-UI-024q: a remembered desc adds no redundant dir param', () => {
    sessionStorage.setItem('nextup.sort.dir', 'desc');
    renderWithProbe('/?service=netflix');
    expect(query().has('dir')).toBe(false);
    expect(query().get('service')).toBe('netflix');
    expectOrder('Recently added');
  });
});

describe('T-UX-120 - sort fields', () => {
  it('T-UX-120a defaults to date-added with no sort in the URL', () => {
    renderWithProbe();
    expect(readSortKey(query())).toBe('dateAdded');
    expectOrder('Recently added');
  });

  it('T-UX-120b selecting runtime displays its complete order', () => {
    renderWithProbe();
    fireEvent.click(button('Longest runtime'));
    expectOrder('Longest runtime');
    expect(query().get('sort')).toBe('runtime');
  });

  it('T-UX-120c runtime describes shortest and longest, not newest and oldest', () => {
    renderWithProbe('/?sort=runtime&dir=asc');
    expectSelectedOrder('Shortest runtime');
    fireEvent.click(reverseButton());
    expectSelectedOrder('Longest runtime');
  });

  it('T-UX-120d changing the key chooses the advertised field default direction', () => {
    renderWithProbe('/?dir=asc');
    fireEvent.click(button('Longest runtime'));
    expect(query().get('dir')).toBe('desc');
    expectOrder('Longest runtime');
  });

  it('T-UX-120e returning to date-added removes sort rather than writing the default', () => {
    renderWithProbe('/?sort=runtime');
    fireEvent.click(button('Recently added'));
    expect(query().has('sort')).toBe(false);
    expect(query().get('dir')).toBe('desc');
    expectOrder('Recently added');
  });

  it('T-UX-120f an unrecognised sort falls back to date-added', () => {
    for (const search of ['sort=imdbRating', 'sort=', '']) {
      expect(readSortKey(new URLSearchParams(search))).toBe('dateAdded');
    }
  });

  it('T-UX-119 the sort selector offers the API rating field', () => {
    expect(SORT_KEYS).toEqual([
      'dateAdded',
      'name',
      'releaseYear',
      'runtime',
      'rating',
      'watchPriority',
    ]);
    renderWithProbe();
    fireEvent.click(button('Highest rated'));
    expect(query().get('sort')).toBe('rating');
  });

  it('T-UX-120g the complete order is persisted together, not as separate session fields', () => {
    renderWithProbe();
    fireEvent.click(button('Longest runtime'));
    expect(Object.keys(sessionStorage)).toEqual([]);
    expect(remembered().get('sort')).toBe('runtime');
    expect(remembered().get('dir')).toBe('desc');
  });
});

describe('One-click complete orders and stable visible controls', () => {
  it('T-UX-128a renders all six complete orders simultaneously', () => {
    renderSortControl();
    // The chooser spells the field and the direction separately, so the row
    // text is the field name; the complete order is its accessible name.
    expect(
      within(sortGroup())
        .getAllByRole('button')
        .map((item) => item.querySelector('.sort-option__name')?.textContent),
    ).toEqual(FIELD_NAMES);
    for (const option of within(sortGroup()).getAllByRole('button')) {
      expect(option.querySelector('.sort-option__dir')?.textContent).not.toBe('');
    }
  });

  it('T-UX-128b marks exactly one option and it is the current order', () => {
    renderSortControl('/?sort=name&dir=desc');
    expectSelectedOrder('Name Z-A');
    expect(within(sortGroup()).getAllByRole('button', { pressed: false })).toHaveLength(5);
  });

  it('T-UX-128c uses six native buttons, not separate direction radios or a menu', () => {
    renderSortControl();
    expect(within(sortGroup()).getAllByRole('button')).toHaveLength(6);
    expect(within(sortGroup()).queryByRole('radio')).toBeNull();
    expect(within(sortGroup()).queryByRole('combobox')).toBeNull();
  });

  it('T-UX-128d keeps the orders in field order after reversal and selection', () => {
    renderSortControl();
    fireEvent.click(reverseButton());
    fireEvent.click(button('Name A-Z'));
    // Reordering the chooser by recency would move the option under the
    // owner's finger between one visit and the next.
    expect(
      within(sortGroup())
        .getAllByRole('button')
        .map((item) => item.querySelector('.sort-option__name')?.textContent),
    ).toEqual(FIELD_NAMES);
  });

  it('T-UX-129a selected labels and next actions describe each field ordering', () => {
    renderWithProbe();
    for (const [label, reverse] of [
      ['Longest runtime', 'Shortest runtime'],
      ['Name A-Z', 'Name Z-A'],
      ['Highest rated', 'Lowest rated'],
    ] as const) {
      fireEvent.click(button(label));
      expectOrder(label);
      expectSelectedOrder(label);
      fireEvent.click(reverseButton());
      expectOrder(reverse);
      expectSelectedOrder(reverse);
    }
  });

  it('T-UX-129b date-shaped fields distinguish additions from releases', () => {
    renderWithProbe('/?sort=releaseYear');
    expectSelectedOrder('Newest releases');
    fireEvent.click(reverseButton());
    expectOrder('Oldest releases');
    fireEvent.click(button('Recently added'));
    expectOrder('Recently added');
    expectSelectedOrder('Recently added');
  });

  it('T-UX-129c default direction is per field and name opens at A', () => {
    for (const key of SORT_KEYS) {
      expect(defaultDirFor(key)).toBe(key === 'name' || key === 'watchPriority' ? 'asc' : 'desc');
    }
    renderWithProbe('/?sort=name');
    expectOrder('Name A-Z');
  });

  it('T-UX-129d a field default writes no redundant dir on entry', () => {
    renderWithProbe('/?sort=name');
    expect(query().get('sort')).toBe('name');
    expect(query().has('dir')).toBe(false);
  });

  it('T-UX-130a changing the field selects and persists its default dir', () => {
    renderWithProbe('/?dir=asc');
    fireEvent.click(button('Highest rated'));
    expect(query().get('dir')).toBe('desc');
    expect(remembered().get('dir')).toBe('desc');
  });

  it('T-UX-130b changing the field preserves filters and other URL parameters', () => {
    renderWithProbe('/?service=netflix&type=movie&genre=Action&tag=one&tag=two&q=Alien');
    fireEvent.click(button('Longest runtime'));
    expect(query().get('service')).toBe('netflix');
    expect(query().get('type')).toBe('movie');
    expect(query().get('genre')).toBe('Action');
    expect(query().getAll('tag')).toEqual(['one', 'two']);
    expect(query().get('q')).toBe('Alien');
  });

  it('T-UX-130c reversing direction preserves active filters', () => {
    renderWithProbe('/?service=max&runtime=60-120');
    fireEvent.click(reverseButton());
    expect(query().get('service')).toBe('max');
    expect(query().get('runtime')).toBe('60-120');
    expect(query().get('dir')).toBe('asc');
  });

  it('T-UX-130d neither change introduces a cursor into the URL', () => {
    // ListRoute owns the actual page reset; this guards the URL contract.
    renderWithProbe('/?service=netflix');
    fireEvent.click(button('Longest runtime'));
    expect(query().has('cursor')).toBe(false);
    fireEvent.click(reverseButton());
    expect(query().has('cursor')).toBe(false);
  });

  it('T-UX-131a oldest-first is reachable in exactly one interaction from default', () => {
    renderWithProbe();
    fireEvent.click(reverseButton());
    expect(query().get('dir')).toBe('asc');
    expect(readSortKey(query())).toBe('dateAdded');
    expectOrder('Oldest additions');
  });

  it('T-UX-131b the oldest-first action is visible without opening anything', () => {
    // REQ-038 / `specs/ui.md` §10.1: the orders may sit behind a chooser, but
    // reversing the current one may not. This is the assertion that stops the
    // reverse button being folded back into the chooser as a duplicate.
    renderSortControl();
    expect(screen.queryByTestId('sort-control')).toBeNull();
    expect(reverseButton()).toBeVisible();
    expect(reverseButton()).toHaveAccessibleName('Reverse the order: Oldest additions');
    fireEvent.click(reverseButton());
    expect(query().get('dir')).toBe('asc');
    expect(screen.queryByTestId('sort-control')).toBeNull();
    expect(reverseButton()).toHaveAccessibleName('Reverse the order: Recently added');
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('T-UX-113a filters and sort render inside one group', () => {
    renderListPage();
    const group = screen.getByTestId('list-controls');
    expect(within(group).getByTestId('filter-bar')).toBeInTheDocument();
    expect(within(group).getByTestId('sort-control-group')).toBeInTheDocument();
  });

  it('T-UX-113b visual grouping does not merge filter and sort state', () => {
    renderListPage();
    fireEvent.click(reverseButton());
    fireEvent.click(screen.getByTestId('filters-trigger'));
    fireEvent.click(screen.getByRole('button', { name: /^Services / }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Netflix' }));
    expect(remembered().get('dir')).toBe('asc');
    expect(remembered().get('service')).toBe('netflix');
    expect(Object.keys(sessionStorage)).toEqual([]);
  });

  it('T-UX-114a changing a filter preserves sort and dir', () => {
    renderListPage('/?sort=runtime&dir=asc');
    fireEvent.click(screen.getByTestId('filters-trigger'));
    fireEvent.click(screen.getByRole('button', { name: /^Services / }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Netflix' }));
    expect(query().get('sort')).toBe('runtime');
    expect(query().get('dir')).toBe('asc');
    expect(query().get('service')).toBe('netflix');
  });
});

describe('Persistence and the default-view one-press escape hatch', () => {
  it('T-UX-115a remembered direction is reconciled into the URL and label', async () => {
    localStorage.setItem('nextup.library.v1', 'sort=dateAdded&dir=asc');
    renderWithProbe();
    await waitFor(() => expect(query().get('dir')).toBe('asc'));
    expectOrder('Oldest additions');
  });

  it('T-UX-115b explicit field links use their own default, not a newer preference', () => {
    localStorage.setItem('nextup.library.v1', 'sort=dateAdded&dir=desc');
    renderWithProbe('/?sort=name');
    expect(query().has('dir')).toBe(false);
    expectOrder('Name A-Z');
  });

  it('T-UX-115c the URL beats session storage for a deep link', () => {
    localStorage.setItem('nextup.library.v1', 'sort=dateAdded&dir=asc');
    renderWithProbe('/?dir=desc');
    expect(query().get('dir')).toBe('desc');
    expectOrder('Recently added');
  });

  it('T-UX-116a oldest-first is one press away on the default view', () => {
    renderListPage();
    expect(reverseButton()).toBeVisible();
    fireEvent.click(reverseButton());
    expect(query().get('dir')).toBe('asc');
    expectOrder('Oldest additions');
  });
});

describe('T-UX-138 - atomic complete-order choices and navigation', () => {
  const orders: ReadonlyArray<{
    key: SortKey;
    label: string;
    reverse: string;
    dir: SortDir;
  }> = [
    { key: 'dateAdded', label: 'Recently added', reverse: 'Oldest additions', dir: 'desc' },
    { key: 'name', label: 'Name A-Z', reverse: 'Name Z-A', dir: 'asc' },
    { key: 'releaseYear', label: 'Newest releases', reverse: 'Oldest releases', dir: 'desc' },
    { key: 'runtime', label: 'Longest runtime', reverse: 'Shortest runtime', dir: 'desc' },
    { key: 'rating', label: 'Highest rated', reverse: 'Lowest rated', dir: 'desc' },
  ];

  it.each(orders)(
    'T-UX-138a $key selects its default order in one URL update',
    ({ key, label, dir }) => {
      const onSearch = vi.fn();
      const initialUrl = key === 'name' ? '/?dir=desc' : '/?sort=name&dir=asc';
      renderWithProbe(initialUrl, { onSearch });
      onSearch.mockClear();

      expect(button(label)).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(button(label));

      expect(readSortKey(query())).toBe(key);
      expect(query().get('dir')).toBe(dir);
      expect(remembered().get('dir')).toBe(dir);
      expect(onSearch).toHaveBeenCalledTimes(1);
      expectOrder(label);
    },
  );

  it.each(orders)(
    'T-UX-138b $key reverses both ways in one URL update per click',
    ({ key, label, reverse, dir }) => {
      const onSearch = vi.fn();
      renderWithProbe(`/?sort=${key}&dir=${dir}`, { onSearch });
      const target = reverseButton();
      onSearch.mockClear();

      fireEvent.click(target);
      // The reverse control is the same node either way round — reversing does
      // not swap one button for another under the owner's finger.
      expect(reverseButton()).toBe(target);
      expectOrder(reverse);
      expectSelectedOrder(reverse);
      expect(query().get('dir')).toBe(dir === 'desc' ? 'asc' : 'desc');
      expect(remembered().get('dir')).toBe(dir === 'desc' ? 'asc' : 'desc');
      expect(onSearch).toHaveBeenCalledTimes(1);

      onSearch.mockClear();
      fireEvent.click(target);
      expectOrder(label);
      expectSelectedOrder(label);
      expect(query().get('dir')).toBe(dir);
      expect(onSearch).toHaveBeenCalledTimes(1);
    },
  );

  it('T-UX-138c back and forward restore explicit URL order despite newer session choices', () => {
    renderWithProbe('/?sort=runtime&dir=asc&service=max');
    fireEvent.click(button('Name A-Z'));
    fireEvent.click(reverseButton());
    expect(remembered().get('dir')).toBe('desc');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expectOrder('Name A-Z');
    expect(query().get('dir')).toBe('asc');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expectOrder('Shortest runtime');
    expect(query().get('service')).toBe('max');

    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expectOrder('Name A-Z');
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expectOrder('Name Z-A');
  });

  it('T-UX-138d destination restoration replaces history rather than adding an entry', () => {
    localStorage.setItem('nextup.library.v1', 'service=max&sort=name&dir=desc');
    renderWithProbe('/', { entries: ['/?dir=asc', '/'] });
    expect(query().get('dir')).toBe('desc');
    expectOrder('Name Z-A');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expectOrder('Oldest additions');
    expect(query().has('sort')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expectOrder('Name Z-A');
    expect(query().get('service')).toBe('max');
  });

  it('T-UX-138e history without dir keeps its field default despite newer choices', () => {
    renderWithProbe('/?sort=name');
    fireEvent.click(button('Highest rated'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expectOrder('Name A-Z');
    expect(query().has('dir')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expectOrder('Highest rated');
  });

  it('T-UX-138f unavailable session storage leaves field defaults and URL choices functional', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });
    renderWithProbe('/?sort=name&service=max');
    expectOrder('Name A-Z');
    fireEvent.click(reverseButton());
    expect(query().get('dir')).toBe('desc');
    expectOrder('Name Z-A');
    fireEvent.click(button('Recently added'));
    fireEvent.click(reverseButton());
    expectOrder('Oldest additions');
    expect(query().get('dir')).toBe('asc');
    expect(query().get('service')).toBe('max');
  });

  it('T-UX-138g invalid directions use the field default, never a stale session choice', () => {
    sessionStorage.setItem('nextup.sort.dir', 'invalid');
    expect(readSortDir(new URLSearchParams('sort=name&dir=invalid'))).toBe('asc');
    sessionStorage.setItem('nextup.sort.dir', 'desc');
    renderWithProbe('/?sort=name&dir=invalid');
    expect(query().get('dir')).toBe('invalid');
    expectOrder('Name A-Z');
  });
});

/**
 * REQ-038, `specs/ui.md` §2.1 item 2 and §10.1 (owner-approved 2026-09-17):
 * the toolbar must state the current order and offer reversal with nothing
 * open, and the six orders live in a chooser behind it.
 */
describe('T-UX-146 - the sort chooser and the toolbar it hides behind', () => {
  it('T-UX-146a the toolbar states the complete current order with nothing open', () => {
    renderSortControl('/?sort=runtime&dir=asc');
    expect(screen.queryByTestId('sort-control')).toBeNull();
    expect(trigger()).toBeVisible();
    expectOrder('Shortest runtime');
  });

  it('T-UX-146b the trigger is a disclosure for a dialog and reports its state', async () => {
    const user = userEvent.setup();
    renderSortControl();
    expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Sort your library' })).toBeInTheDocument();
  });

  it('T-UX-146c every chooser row names its field and spells out its direction', () => {
    renderSortControl();
    const rows = within(sortGroup()).getAllByRole('button');
    const directions = rows.map((row) => row.querySelector('.sort-option__dir')?.textContent);
    expect(rows.map((row) => row.querySelector('.sort-option__name')?.textContent)).toEqual(
      FIELD_NAMES,
    );
    // T-A11Y-008: the arrow is decorative, so the words must carry direction.
    expect(directions).toEqual([
      'Newest first',
      'A to Z',
      'Newest first',
      'Longest first',
      'Highest first',
      'Highest first',
    ]);
  });

  it('T-UX-146d choosing an order applies it and closes the chooser', async () => {
    const user = userEvent.setup();
    renderSortControl();
    await user.click(trigger());
    await user.click(button('Highest rated'));
    await waitFor(() => expect(screen.queryByTestId('sort-control')).toBeNull());
    expect(query().get('sort')).toBe('rating');
    expectOrder('Highest rated');
    expect(trigger()).toHaveFocus();
  });

  it('T-UX-146e choosing the selected order again reverses it', async () => {
    const user = userEvent.setup();
    renderSortControl();
    await user.click(trigger());
    await user.click(selectedButton());
    await waitFor(() => expect(screen.queryByTestId('sort-control')).toBeNull());
    expect(query().get('dir')).toBe('asc');
    expectOrder('Oldest additions');
  });

  it('T-UX-146i choosing a field keeps the field, not just its direction', async () => {
    // Regression: `chooseOrder` used to write the remembered direction to
    // session storage before navigating. The chooser's own close-state update
    // let a render run in between, the reconcile effect saw a dir-less URL
    // plus a remembered non-default direction, and `replace`d the entry the
    // pending navigation was about to push — losing the chosen field and
    // keeping only the direction. The URL leads; session storage follows.
    const user = userEvent.setup();
    renderSortControl('/?sort=name');
    expect(sessionStorage.getItem('nextup.sort.dir')).toBeNull();
    await user.click(trigger());
    await user.click(button('Highest rated'));
    expect(query().get('sort')).toBe('rating');
    expect(query().get('dir')).toBe('desc');
    expect(remembered().get('dir')).toBe('desc');
    expectOrder('Highest rated');
  });

  it('T-UX-146f Escape closes the chooser without changing the order', async () => {
    const user = userEvent.setup();
    renderSortControl('/?sort=runtime');
    await user.click(trigger());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('sort-control')).toBeNull());
    expect(query().get('sort')).toBe('runtime');
    expectOrder('Longest runtime');
    expect(trigger()).toHaveFocus();
  });

  it('T-UX-146g the close button dismisses the chooser and returns focus', async () => {
    const user = userEvent.setup();
    renderSortControl();
    await user.click(trigger());
    await user.click(screen.getByRole('button', { name: 'Close sort options' }));
    await waitFor(() => expect(screen.queryByTestId('sort-control')).toBeNull());
    expect(trigger()).toHaveFocus();
    expect(query().has('sort')).toBe(false);
  });

  it('T-UX-146h the reverse button never opens the chooser', async () => {
    const user = userEvent.setup();
    renderSortControl();
    await user.click(reverseButton());
    expect(screen.queryByTestId('sort-control')).toBeNull();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(query().get('dir')).toBe('asc');
  });
});
