/**
 * Owner-approved 2026-09-16: five complete-order buttons, with one-click
 * reversal of the selected order. Existing IDs retain their behavioral
 * coverage; radio-shape and direction-preservation assertions are superseded.
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

const DEFAULT_LABELS = [
  'Recently added',
  'Name A-Z',
  'Newest releases',
  'Longest runtime',
  'Highest rated',
];

function sortGroup(): HTMLElement {
  return screen.getByTestId('sort-control');
}

function selectedButton(): HTMLElement {
  return within(sortGroup()).getByRole('button', { pressed: true });
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
    <>
      <span data-testid="search-probe">{params.toString()}</span>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
    </>
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
    expect(within(sortGroup()).getAllByRole('button')).toHaveLength(5);
  });

  it('T-UI-024b: defaults to recently added', () => {
    renderSortControl();
    expect(selectedButton()).toHaveTextContent('Recently added');
    expect(selectedButton()).toHaveAccessibleName(
      'Recently added. Selected. Change to Oldest additions.',
    );
  });

  it('T-UI-024c: click reverses to oldest additions', () => {
    renderSortControl();
    fireEvent.click(selectedButton());
    expect(selectedButton()).toHaveTextContent('Oldest additions');
    expect(query().get('dir')).toBe('asc');
  });

  it('T-UI-024d: second click reverses back to recently added', () => {
    renderSortControl();
    fireEvent.click(selectedButton());
    fireEvent.click(selectedButton());
    expect(selectedButton()).toHaveTextContent('Recently added');
    expect(query().get('dir')).toBe('desc');
  });

  it('T-UI-024e: inactive orders have aria-pressed false', () => {
    renderSortControl();
    expect(within(sortGroup()).getAllByRole('button', { pressed: false })).toHaveLength(4);
    expect(button('Name A-Z')).toHaveAttribute('aria-pressed', 'false');
  });

  it('T-UI-024f: oldest additions remains the sole pressed order', () => {
    renderSortControl();
    fireEvent.click(selectedButton());
    expect(selectedButton()).toHaveTextContent('Oldest additions');
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

  it('T-UI-024j: readSortDir reads asc from session when no URL param', () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    expect(readSortDir(new URLSearchParams())).toBe('asc');
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
    expect(selectedButton()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(query().get('dir')).toBe('asc');
    expect(selectedButton()).toHaveFocus();
    await user.keyboard(' ');
    expect(query().get('dir')).toBe('desc');
  });

  it('T-UI-024n: dir=asc in URL renders oldest additions', () => {
    renderSortControl('/?dir=asc');
    expect(selectedButton()).toHaveTextContent('Oldest additions');
  });

  it('T-UI-024o: a session-persisted asc is written into the URL', async () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    renderWithProbe();
    await waitFor(() => expect(query().get('dir')).toBe('asc'));
    expect(selectedButton()).toHaveTextContent('Oldest additions');
  });

  it('T-UI-024p: reconciliation keeps existing filters', async () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    renderWithProbe('/?service=netflix&type=movie');
    await waitFor(() => expect(query().get('dir')).toBe('asc'));
    expect(query().get('service')).toBe('netflix');
    expect(query().get('type')).toBe('movie');
  });

  it('T-UI-024q: a remembered desc adds no redundant dir param', () => {
    sessionStorage.setItem('nextup.sort.dir', 'desc');
    renderWithProbe('/?service=netflix');
    expect(query().has('dir')).toBe(false);
    expect(query().get('service')).toBe('netflix');
    expect(selectedButton()).toHaveTextContent('Recently added');
  });
});

describe('T-UX-120 - sort fields', () => {
  it('T-UX-120a defaults to date-added with no sort in the URL', () => {
    renderWithProbe();
    expect(readSortKey(query())).toBe('dateAdded');
    expect(selectedButton()).toHaveTextContent('Recently added');
  });

  it('T-UX-120b selecting runtime displays its complete order', () => {
    renderWithProbe();
    fireEvent.click(button('Longest runtime'));
    expect(selectedButton()).toHaveTextContent('Longest runtime');
    expect(query().get('sort')).toBe('runtime');
  });

  it('T-UX-120c runtime describes shortest and longest, not newest and oldest', () => {
    renderWithProbe('/?sort=runtime&dir=asc');
    expect(selectedButton()).toHaveAccessibleName(
      'Shortest runtime. Selected. Change to Longest runtime.',
    );
    fireEvent.click(selectedButton());
    expect(selectedButton()).toHaveAccessibleName(
      'Longest runtime. Selected. Change to Shortest runtime.',
    );
  });

  it('T-UX-120d changing the key chooses the advertised field default direction', () => {
    renderWithProbe('/?dir=asc');
    fireEvent.click(button('Longest runtime'));
    expect(query().get('dir')).toBe('desc');
    expect(selectedButton()).toHaveTextContent('Longest runtime');
  });

  it('T-UX-120e returning to date-added removes sort rather than writing the default', () => {
    renderWithProbe('/?sort=runtime');
    fireEvent.click(button('Recently added'));
    expect(query().has('sort')).toBe(false);
    expect(query().get('dir')).toBe('desc');
    expect(selectedButton()).toHaveTextContent('Recently added');
  });

  it('T-UX-120f an unrecognised sort falls back to date-added', () => {
    for (const search of ['sort=imdbRating', 'sort=', '']) {
      expect(readSortKey(new URLSearchParams(search))).toBe('dateAdded');
    }
  });

  it('T-UX-119 the sort selector offers the API rating field', () => {
    expect(SORT_KEYS).toEqual(['dateAdded', 'name', 'releaseYear', 'runtime', 'rating']);
    renderWithProbe();
    fireEvent.click(button('Highest rated'));
    expect(query().get('sort')).toBe('rating');
  });

  it('T-UX-120g the key is not persisted in session storage, unlike direction', () => {
    renderWithProbe();
    fireEvent.click(button('Longest runtime'));
    expect(Object.keys(sessionStorage)).toEqual(['nextup.sort.dir']);
    expect(sessionStorage.getItem('nextup.sort.dir')).toBe('desc');
  });
});

describe('One-click complete orders and stable visible controls', () => {
  it('T-UX-128a renders all five complete orders simultaneously', () => {
    renderSortControl();
    expect(
      within(sortGroup())
        .getAllByRole('button')
        .map((item) => item.textContent),
    ).toEqual(DEFAULT_LABELS);
  });

  it('T-UX-128b marks exactly one option and it is the current order', () => {
    renderSortControl('/?sort=name&dir=desc');
    expect(selectedButton()).toHaveTextContent('Name Z-A');
    expect(within(sortGroup()).getAllByRole('button', { pressed: false })).toHaveLength(4);
  });

  it('T-UX-128c uses five native buttons, not separate direction radios or a menu', () => {
    renderSortControl();
    expect(within(sortGroup()).getAllByRole('button')).toHaveLength(5);
    expect(within(sortGroup()).queryByRole('radio')).toBeNull();
    expect(within(sortGroup()).queryByRole('combobox')).toBeNull();
  });

  it('T-UX-128d keeps the same button nodes in field order after reversal and selection', () => {
    renderSortControl();
    const original = within(sortGroup()).getAllByRole('button');
    fireEvent.click(selectedButton());
    fireEvent.click(button('Name A-Z'));
    expect(within(sortGroup()).getAllByRole('button')).toEqual(original);
    expect(original.map((item) => item.textContent)).toEqual(DEFAULT_LABELS);
  });

  it('T-UX-129a selected labels and next actions describe each field ordering', () => {
    renderWithProbe();
    for (const [label, reverse] of [
      ['Longest runtime', 'Shortest runtime'],
      ['Name A-Z', 'Name Z-A'],
      ['Highest rated', 'Lowest rated'],
    ] as const) {
      fireEvent.click(button(label));
      expect(selectedButton()).toHaveAccessibleName(`${label}. Selected. Change to ${reverse}.`);
      fireEvent.click(selectedButton());
      expect(selectedButton()).toHaveAccessibleName(`${reverse}. Selected. Change to ${label}.`);
    }
  });

  it('T-UX-129b date-shaped fields distinguish additions from releases', () => {
    renderWithProbe('/?sort=releaseYear');
    expect(selectedButton()).toHaveAccessibleName(
      'Newest releases. Selected. Change to Oldest releases.',
    );
    fireEvent.click(selectedButton());
    expect(selectedButton()).toHaveTextContent('Oldest releases');
    fireEvent.click(button('Recently added'));
    expect(selectedButton()).toHaveAccessibleName(
      'Recently added. Selected. Change to Oldest additions.',
    );
  });

  it('T-UX-129c default direction is per field and name opens at A', () => {
    for (const key of SORT_KEYS) {
      expect(defaultDirFor(key)).toBe(key === 'name' ? 'asc' : 'desc');
    }
    renderWithProbe('/?sort=name');
    expect(selectedButton()).toHaveTextContent('Name A-Z');
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
    expect(sessionStorage.getItem('nextup.sort.dir')).toBe('desc');
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
    fireEvent.click(selectedButton());
    expect(query().get('service')).toBe('max');
    expect(query().get('runtime')).toBe('60-120');
    expect(query().get('dir')).toBe('asc');
  });

  it('T-UX-130d neither change introduces a cursor into the URL', () => {
    // ListRoute owns the actual page reset; this guards the URL contract.
    renderWithProbe('/?service=netflix');
    fireEvent.click(button('Longest runtime'));
    expect(query().has('cursor')).toBe(false);
    fireEvent.click(selectedButton());
    expect(query().has('cursor')).toBe(false);
  });

  it('T-UX-131a oldest-first is reachable in exactly one interaction from default', () => {
    renderWithProbe();
    fireEvent.click(selectedButton());
    expect(query().get('dir')).toBe('asc');
    expect(readSortKey(query())).toBe('dateAdded');
    expect(selectedButton()).toHaveTextContent('Oldest additions');
  });

  it('T-UX-131b the oldest-first action is visible without opening anything', () => {
    renderSortControl();
    expect(selectedButton()).toBeVisible();
    expect(selectedButton()).toHaveAccessibleName(
      'Recently added. Selected. Change to Oldest additions.',
    );
    expect(within(sortGroup()).queryByRole('combobox')).toBeNull();
  });

  it('T-UX-113a filters and sort render inside one group', () => {
    renderListPage();
    const group = screen.getByTestId('list-controls');
    expect(within(group).getByTestId('filter-bar')).toBeInTheDocument();
    expect(within(group).getByTestId('sort-control-group')).toBeInTheDocument();
  });

  it('T-UX-113b visual grouping does not merge filter and sort state', () => {
    renderListPage();
    fireEvent.click(selectedButton());
    fireEvent.click(screen.getByRole('button', { name: 'Services' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Netflix' }));
    expect(sessionStorage.getItem('nextup.sort.dir')).toBe('asc');
    expect(Object.values(sessionStorage)).not.toContain('netflix');
  });

  it('T-UX-114a changing a filter preserves sort and dir', () => {
    renderListPage('/?sort=runtime&dir=asc');
    fireEvent.click(screen.getByRole('button', { name: 'Services' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Netflix' }));
    expect(query().get('sort')).toBe('runtime');
    expect(query().get('dir')).toBe('asc');
    expect(query().get('service')).toBe('netflix');
  });
});

describe('Persistence and the default-view one-press escape hatch', () => {
  it('T-UX-115a remembered direction is reconciled into the URL and label', async () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    renderWithProbe();
    await waitFor(() => expect(query().get('dir')).toBe('asc'));
    expect(selectedButton()).toHaveTextContent('Oldest additions');
  });

  it('T-UX-115b remembered direction survives a field whose default differs', async () => {
    sessionStorage.setItem('nextup.sort.dir', 'desc');
    renderWithProbe('/?sort=name');
    await waitFor(() => expect(query().get('dir')).toBe('desc'));
    expect(selectedButton()).toHaveTextContent('Name Z-A');
  });

  it('T-UX-115c the URL beats session storage for a deep link', () => {
    sessionStorage.setItem('nextup.sort.dir', 'asc');
    renderWithProbe('/?dir=desc');
    expect(query().get('dir')).toBe('desc');
    expect(selectedButton()).toHaveTextContent('Recently added');
  });

  it('T-UX-116a oldest-first is one press away on the default view', () => {
    renderListPage();
    expect(selectedButton()).toBeVisible();
    fireEvent.click(selectedButton());
    expect(query().get('dir')).toBe('asc');
    expect(selectedButton()).toHaveTextContent('Oldest additions');
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
      expect(sessionStorage.getItem('nextup.sort.dir')).toBe(dir);
      expect(onSearch).toHaveBeenCalledTimes(1);
      expect(selectedButton()).toHaveTextContent(label);
    },
  );

  it.each(orders)(
    'T-UX-138b $key reverses both ways in one URL update per click',
    ({ key, label, reverse, dir }) => {
      const onSearch = vi.fn();
      renderWithProbe(`/?sort=${key}&dir=${dir}`, { onSearch });
      const target = selectedButton();
      onSearch.mockClear();

      fireEvent.click(target);
      expect(selectedButton()).toBe(target);
      expect(selectedButton()).toHaveAccessibleName(`${reverse}. Selected. Change to ${label}.`);
      expect(query().get('dir')).toBe(dir === 'desc' ? 'asc' : 'desc');
      expect(sessionStorage.getItem('nextup.sort.dir')).toBe(dir === 'desc' ? 'asc' : 'desc');
      expect(onSearch).toHaveBeenCalledTimes(1);

      onSearch.mockClear();
      fireEvent.click(target);
      expect(selectedButton()).toHaveAccessibleName(`${label}. Selected. Change to ${reverse}.`);
      expect(query().get('dir')).toBe(dir);
      expect(onSearch).toHaveBeenCalledTimes(1);
    },
  );

  it('T-UX-138c back and forward restore explicit URL order despite newer session choices', () => {
    renderWithProbe('/?sort=runtime&dir=asc&service=max');
    fireEvent.click(button('Name A-Z'));
    fireEvent.click(selectedButton());
    expect(sessionStorage.getItem('nextup.sort.dir')).toBe('desc');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(selectedButton()).toHaveTextContent('Name A-Z');
    expect(query().get('dir')).toBe('asc');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(selectedButton()).toHaveTextContent('Shortest runtime');
    expect(query().get('service')).toBe('max');

    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(selectedButton()).toHaveTextContent('Name A-Z');
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(selectedButton()).toHaveTextContent('Name Z-A');
  });

  it('T-UX-138d session reconciliation replaces history rather than adding an entry', () => {
    sessionStorage.setItem('nextup.sort.dir', 'desc');
    renderWithProbe('/', { entries: ['/?dir=asc', '/?sort=name&service=max'] });
    expect(query().get('dir')).toBe('desc');
    expect(selectedButton()).toHaveTextContent('Name Z-A');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(selectedButton()).toHaveTextContent('Oldest additions');
    expect(query().has('sort')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(selectedButton()).toHaveTextContent('Name Z-A');
    expect(query().get('service')).toBe('max');
  });

  it('T-UX-138e history entry without dir uses session and reconciles against its field default', () => {
    renderWithProbe('/?sort=name');
    fireEvent.click(button('Highest rated'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(selectedButton()).toHaveTextContent('Name Z-A');
    expect(query().get('dir')).toBe('desc');
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(selectedButton()).toHaveTextContent('Highest rated');
  });

  it('T-UX-138f unavailable session storage leaves field defaults and URL choices functional', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage unavailable', 'SecurityError');
    });
    renderWithProbe('/?sort=name&service=max');
    expect(selectedButton()).toHaveTextContent('Name A-Z');
    fireEvent.click(selectedButton());
    expect(query().get('dir')).toBe('desc');
    expect(selectedButton()).toHaveTextContent('Name Z-A');
    fireEvent.click(button('Recently added'));
    fireEvent.click(selectedButton());
    expect(selectedButton()).toHaveTextContent('Oldest additions');
    expect(query().get('dir')).toBe('asc');
    expect(query().get('service')).toBe('max');
  });

  it('T-UX-138g invalid directions fall through session then the field default', () => {
    sessionStorage.setItem('nextup.sort.dir', 'invalid');
    expect(readSortDir(new URLSearchParams('sort=name&dir=invalid'))).toBe('asc');
    sessionStorage.setItem('nextup.sort.dir', 'desc');
    renderWithProbe('/?sort=name&dir=invalid');
    expect(query().get('dir')).toBe('desc');
    expect(selectedButton()).toHaveTextContent('Name Z-A');
  });
});
