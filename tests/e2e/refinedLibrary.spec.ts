import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import {
  SERVICES,
  SERVICE_LABELS,
  serviceFreshnessLabel,
  type WatchPriority,
} from '@nextup/domain';

const TITLES = [
  'Amber Harbor',
  'The Copper Moon and the Extraordinary Journey Home',
  'Quiet Orbit',
  'A Winter Beyond the Northern Mountains',
  'Paper Lanterns',
  'The Last Observatory',
].map((name, index) => ({
  titleId: `refined-${index}`,
  workIdentity: `tmdb:movie:${900000 + index}`,
  matchState: 'matched',
  name,
  mediaType: index % 2 === 0 ? 'movie' : 'tv',
  releaseYear: 2018 + index,
  genres: index % 2 === 0 ? ['Drama', 'Mystery'] : ['Adventure', 'Science Fiction'],
  runtimeMinutes: index % 2 === 0 ? 112 + index : 45 + index,
  posterPath: `/refined-${index}.png`,
  badges: [
    { service: 'netflix', listingId: `netflix-${index}`, dateAdded: '2026-09-01' },
    { service: 'max', listingId: `max-${index}`, dateAdded: '2026-09-02' },
  ],
  sortDateAdded: `2026-09-${16 - index}`,
  dateAddedLabel: `Added to nextup on ${16 - index} Sep 2026`,
  imdbRating: 7.2 + index / 10,
  metadataStale: false,
}));

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64',
);

type Title = (typeof TITLES)[number];
type Preferences = { watching: boolean; priority: WatchPriority };

function orderedTitles(
  params: URLSearchParams,
  preferences: ReadonlyMap<string, Preferences> = new Map(),
): Title[] {
  const q = (params.get('q') ?? '').toLowerCase();
  const sort = params.get('sort') ?? 'dateAdded';
  const direction =
    params.get('dir') ?? (sort === 'name' || sort === 'watchPriority' ? 'asc' : 'desc');
  const value = (title: Title): string | number => {
    switch (sort) {
      case 'name':
        return title.name;
      case 'releaseYear':
        return title.releaseYear;
      case 'runtime':
        return title.runtimeMinutes;
      case 'rating':
        return title.imdbRating;
      case 'dateAdded':
        return title.sortDateAdded;
      case 'watchPriority': {
        const preference = preferences.get(title.titleId);
        return preference?.watching
          ? 0
          : preference?.priority === 'up-next'
            ? 1
            : preference?.priority === 'someday'
              ? 3
              : 2;
      }
      default:
        throw new Error(`Unexpected sort field: ${sort}`);
    }
  };
  return TITLES.filter((title) => {
    const preference = preferences.get(title.titleId);
    return (
      title.name.toLowerCase().includes(q) &&
      (!params.has('watching') ||
        String(preference?.watching ?? false) === params.get('watching')) &&
      (!params.has('priority') ||
        params.getAll('priority').includes(preference?.priority ?? 'normal'))
    );
  })
    .map((title) => ({ ...title, ...preferences.get(title.titleId) }))
    .sort((a, b) => {
      const left = value(a);
      const right = value(b);
      const comparison = left < right ? -1 : left > right ? 1 : 0;
      return direction === 'asc' ? comparison : -comparison;
    });
}

async function mountLibrary(
  page: Page,
  { width = 1280, url = '/', paged = false, withGenres = true, allServices = false } = {},
): Promise<URL[]> {
  const requests: URL[] = [];
  const preferences = new Map<string, Preferences>();
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.hostname === 'image.tmdb.org') {
      await route.fulfill({ contentType: 'image/png', body: PNG });
      return;
    }
    if (target.hostname !== 'localhost' && target.hostname !== '127.0.0.1') {
      await route.abort();
      throw new Error(`Unexpected external request: ${request.url()}`);
    }
    if (!target.pathname.startsWith('/api/')) {
      await route.continue();
      return;
    }
    requests.push(target);
    if (request.method() === 'PATCH' && target.pathname.endsWith('/watch-preferences')) {
      const id = target.pathname.split('/')[3];
      const body: unknown = request.postDataJSON();
      if (
        !id ||
        !TITLES.some((title) => title.titleId === id) ||
        typeof body !== 'object' ||
        body === null ||
        !('watching' in body) ||
        typeof body.watching !== 'boolean' ||
        !('priority' in body) ||
        (body.priority !== 'up-next' && body.priority !== 'normal' && body.priority !== 'someday')
      ) {
        throw new Error('Invalid watch-preference fixture request');
      }
      preferences.set(id, { watching: body.watching, priority: body.priority });
      await route.fulfill({
        json: { titleId: id, watching: body.watching, priority: body.priority },
      });
      return;
    }
    expect(request.method()).toBe('GET');
    let body: unknown;
    switch (target.pathname) {
      case '/api/me':
        body = {
          ownerId: 'fixture-owner',
          displayName: 'Fixture owner',
          signOutUrl: '/.auth/logout',
          attribution: {},
        };
        break;
      case '/api/titles': {
        const matching = orderedTitles(target.searchParams, preferences)
          .map((title) => ({
            ...title,
            genres: withGenres ? title.genres : [],
            badges: allServices
              ? SERVICES.map((service) => ({
                  service,
                  listingId: `${service}-${title.titleId}`,
                  dateAdded: '2026-09-01',
                }))
              : title.badges,
          }))
          .filter(
            (title) =>
              !target.searchParams.has('service') ||
              title.badges.some((badge) =>
                target.searchParams.getAll('service').includes(badge.service),
              ),
          );
        const paginate = paged && !target.searchParams.has('q');
        const secondPage = target.searchParams.has('cursor');
        body = {
          items: paginate ? matching.slice(secondPage ? 3 : 0, secondPage ? 6 : 3) : matching,
          nextCursor: paginate && !secondPage ? 'fixture-next-page' : null,
          limit: 50,
          runtimeUnknownHidden: 0,
        };
        break;
      }
      case '/api/suppressions':
      case '/api/removed':
        body = { items: [] };
        break;
      case '/api/service-state':
        body = {
          services: SERVICES.map((service) => ({
            service,
            lastCompletedBatchAt: service === 'netflix' ? '2026-09-16T00:00:00.000Z' : null,
            lastCompletedBatchId: service === 'netflix' ? 'fixture-batch' : null,
            ageDays: service === 'netflix' ? 0 : null,
            label: serviceFreshnessLabel(service, service === 'netflix' ? 0 : null),
          })),
        };
        break;
      default:
        await route.abort();
        throw new Error(`Unstubbed API request: ${request.url()}`);
    }
    await route.fulfill({ json: body });
  });
  await page.goto(url);
  await expect(page.getByTestId('title-name')).toHaveCount(paged ? 3 : TITLES.length);
  await expect(page.getByRole('button', { name: 'Service updates', exact: true })).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect
    .poll(() =>
      page
        .getByTestId('poster')
        .evaluateAll((images) =>
          images.every(
            (image) =>
              image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
          ),
        ),
    )
    .toBe(true);
  return requests;
}

async function bounds(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (box === null) throw new Error('Visible element has no bounding box');
  return box;
}

async function noOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
}

async function usableTarget(page: Page, locator: Locator): Promise<void> {
  const box = await bounds(locator);
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Expected an explicit viewport');
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
  await expect(locator).toBeInViewport({ ratio: 1 });
}

async function horizontallyBounded(page: Page, locator: Locator, width: number): Promise<void> {
  const box = await bounds(locator);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.width).toBeLessThanOrEqual(width + 1);
  await noOverflow(page);
}

async function openFiltersPanel(page: Page): Promise<Locator> {
  const trigger = page.getByTestId('filters-trigger');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const dialog = page.getByRole('dialog', { name: 'Filter your list', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function closeFiltersPanel(page: Page, dialog: Locator): Promise<void> {
  await dialog.locator('.panel-foot').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('filters-trigger')).toHaveAttribute('aria-expanded', 'false');
}

async function openSortPanel(page: Page): Promise<Locator> {
  const trigger = page.getByTestId('sort-trigger');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const dialog = page.getByRole('dialog', { name: 'Sort your list', exact: true });
  await expect(dialog).toBeVisible();
  return dialog.getByTestId('sort-control');
}

async function chooseInput(input: Locator): Promise<void> {
  await expect(input).toBeVisible();
  await input.dispatchEvent('click');
}

async function compactPreservesList(
  page: Page,
  requests: URL[],
  testInfo: TestInfo,
  singleColumn = false,
): Promise<void> {
  const list = page.getByTestId('title-list');
  const beforeHeight = (await bounds(list)).height;
  const beforeRowHeights = await list
    .locator('li.title-row')
    .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
  const beforeText = await list.innerText();
  const beforeNames = await page.getByTestId('title-name').allTextContents();
  const beforeButtons = await list.getByRole('button').allTextContents();
  const beforeUrl = page.url();
  const beforeRequests = requests.map((request) => request.href);

  await page.getByRole('button', { name: 'Compact view', exact: true }).click();
  await expect(list).toHaveAttribute('data-view', 'compact');
  await expect(page.getByRole('button', { name: 'Compact view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await testInfo.attach('layout-geometry', {
    contentType: 'application/json',
    body: JSON.stringify({
      viewport: page.viewportSize(),
      gridHeight: beforeHeight,
      compactHeight: (await bounds(list)).height,
      gridRowHeights: beforeRowHeights,
      compactRowHeights: await list
        .locator('li.title-row')
        .evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height)),
    }),
  });
  if (singleColumn) {
    expect((await bounds(list)).height, 'Compact must shorten a single-column list').toBeLessThan(
      beforeHeight,
    );
  }
  expect(await list.innerText()).toBe(beforeText);
  expect(await page.getByTestId('title-name').allTextContents()).toEqual(beforeNames);
  expect(await list.getByRole('button').allTextContents()).toEqual(beforeButtons);
  await expect(list.getByTestId('poster')).toHaveCount(TITLES.length);
  for (const [index, row] of (await list.locator('li.title-row').all()).entries()) {
    const beforeRowHeight = beforeRowHeights[index];
    if (beforeRowHeight === undefined) throw new Error('Compact introduced an unexpected row');
    expect((await bounds(row)).height, `Compact row ${index} must be shorter`).toBeLessThan(
      beforeRowHeight,
    );
    for (const id of ['title-meta', 'runtime', 'imdb-rating', 'date-added-label', 'badges']) {
      await expect(row.getByTestId(id)).toBeVisible();
    }
    const actions = row.getByRole('button');
    expect(await actions.count()).toBeGreaterThan(0);
    for (const action of await actions.all()) await expect(action).toBeVisible();
  }
  await page.waitForLoadState('networkidle');
  expect(page.url()).toBe(beforeUrl);
  expect(requests.map((request) => request.href)).toEqual(beforeRequests);
  await noOverflow(page);
}

test('T-UX-141e: wide artwork/detail grid uses shorter Compact rows without losing list state', async ({
  page,
}, testInfo) => {
  const requests = await mountLibrary(page, { url: '/?sort=runtime&dir=asc&service=netflix' });
  const list = page.getByTestId('title-list');
  await expect(list).toHaveAttribute('data-view', 'grid');
  const rows = list.locator('li.title-row');
  const first = await bounds(rows.nth(0));
  const second = await bounds(rows.nth(1));
  expect(Math.abs(first.y - second.y)).toBeLessThan(2);
  expect(second.x).toBeGreaterThanOrEqual(first.x + first.width);
  for (const row of await rows.all()) {
    const poster = await bounds(row.getByTestId('poster'));
    const details = await bounds(row.locator('.title-row__body'));
    expect(details.x).toBeGreaterThanOrEqual(poster.x + poster.width);
    expect(details.y).toBeLessThan(poster.y + poster.height);
    expect(poster.y).toBeLessThan(details.y + details.height);
  }
  await noOverflow(page);
  await compactPreservesList(page, requests, testInfo);
});

test('T-UX-141f: 320px Grid and Compact retain metadata, actions and query without overflow', async ({
  page,
}, testInfo) => {
  const requests = await mountLibrary(page, { width: 320, url: '/?sort=name&dir=asc' });
  await noOverflow(page);
  await compactPreservesList(page, requests, testInfo, true);
});

test('T-UX-142b: six sort buttons select complete server orders and reverse the current order', async ({
  page,
}) => {
  const requests = await mountLibrary(page);
  let group = await openSortPanel(page);
  await expect(group.getByRole('button')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Sort your list', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('sort-trigger')).toHaveAttribute('aria-expanded', 'false');
  const orders = [
    { label: 'Recently added', reverse: 'Oldest additions', field: 'dateAdded', dir: 'desc' },
    { label: 'Name A-Z', reverse: 'Name Z-A', field: 'name', dir: 'asc' },
    { label: 'Newest releases', reverse: 'Oldest releases', field: 'releaseYear', dir: 'desc' },
    { label: 'Longest runtime', reverse: 'Shortest runtime', field: 'runtime', dir: 'desc' },
    { label: 'Highest rated', reverse: 'Lowest rated', field: 'rating', dir: 'desc' },
    {
      label: 'Watch priority',
      reverse: 'Lower priority first',
      field: 'watchPriority',
      dir: 'asc',
    },
  ];
  for (const order of orders) {
    if (order.field !== 'dateAdded') {
      const before = requests.filter((request) => request.pathname === '/api/titles').length;
      group = await openSortPanel(page);
      const option = group.getByRole('button', { name: order.label, exact: true });
      await expect(option).toBeVisible();
      await option.click({ force: true });
      await expect(page.getByRole('dialog', { name: 'Sort your list', exact: true })).toHaveCount(
        0,
      );
      await expect
        .poll(() => requests.filter((request) => request.pathname === '/api/titles').length)
        .toBe(before + 1);
      const request = requests.filter((item) => item.pathname === '/api/titles').at(-1);
      expect(request?.searchParams.get('sort')).toBe(order.field);
      expect(request?.searchParams.get('dir')).toBe(order.dir);
    }
    await expect(page.getByTestId('sort-trigger')).toHaveAccessibleName(
      `Sort: ${order.label}. Change the order.`,
    );
    const before = requests.filter((request) => request.pathname === '/api/titles').length;
    await page.getByTestId('sort-reverse').click();
    await expect(page.getByTestId('sort-trigger')).toHaveAccessibleName(
      `Sort: ${order.reverse}. Change the order.`,
    );
    await expect
      .poll(() => requests.filter((request) => request.pathname === '/api/titles').length)
      .toBe(before + 1);
    const request = requests.filter((item) => item.pathname === '/api/titles').at(-1);
    if (!request) throw new Error('Sort click did not send a titles request');
    expect(request.searchParams.get('sort') ?? 'dateAdded').toBe(order.field);
    expect(request.searchParams.get('dir')).toBe(order.dir === 'desc' ? 'asc' : 'desc');
    expect(request.searchParams.has('cursor')).toBe(false);
    await expect(page.getByTestId('title-name')).toHaveText(
      orderedTitles(request.searchParams).map((title) => title.name),
    );
  }
  const before = requests.filter((request) => request.pathname === '/api/titles').length;
  group = await openSortPanel(page);
  await group.getByRole('button', { name: 'Recently added', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Sort your list', exact: true })).toHaveCount(0);
  await expect
    .poll(() => requests.filter((request) => request.pathname === '/api/titles').length)
    .toBe(before + 1);
  const returned = requests.filter((request) => request.pathname === '/api/titles').at(-1);
  expect(returned?.searchParams.get('sort') ?? 'dateAdded').toBe('dateAdded');
  expect(returned?.searchParams.get('dir')).toBe('desc');
  await expect(page.getByTestId('title-name')).toHaveText(TITLES.map((title) => title.name));
});

test('T-UX-143c: submitted URL search resets loaded pages, requests unfiltered totals and clears zero matches', async ({
  page,
}) => {
  const requests = await mountLibrary(page, { paged: true });
  // The sentinel auto-loads on scroll; clicking it can race its own removal.
  await page.evaluate(() =>
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }),
  );
  await expect(page.getByTestId('title-name')).toHaveCount(TITLES.length);
  expect(
    requests.some((request) => request.searchParams.get('cursor') === 'fixture-next-page'),
  ).toBe(true);
  const before = requests.length;
  const search = page.getByRole('searchbox', { name: 'Search your list', exact: true });
  await search.fill('Amber');
  expect(requests.length).toBe(before);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page).toHaveURL(/\?q=Amber$/);
  await expect(page.getByTestId('title-name')).toHaveText(['Amber Harbor']);
  const searchRequests = requests
    .slice(before)
    .filter((request) => request.pathname === '/api/titles');
  expect(searchRequests.some((request) => request.searchParams.get('q') === 'Amber')).toBe(true);
  expect(searchRequests.some((request) => request.search === '')).toBe(true);
  expect(searchRequests.every((request) => !request.searchParams.has('cursor'))).toBe(true);
  await expect(page.getByTestId('load-more')).toBeHidden();

  await search.fill('No matching fixture');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByTestId('zero-match')).toBeVisible();
  await expect(page.getByTestId('title-name')).toHaveCount(0);
  expect(requests.some((request) => request.searchParams.get('q') === 'No matching fixture')).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByTestId('title-name')).toHaveCount(3);
  await expect(page.getByTestId('zero-match')).toBeHidden();
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  await expect(page.getByTestId('load-more')).toBeVisible();
});

test('T-UX-143d: Services and service-update popovers are usable at 320px and 1280px', async ({
  page,
}) => {
  await mountLibrary(page);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const dialog = await openFiltersPanel(page);
    const controls = dialog.getByRole('group', { name: 'Filter by', exact: true });
    const trigger = controls.getByRole('button', { name: /^Services / });
    await trigger.click();
    await usableTarget(page, page.getByTestId('filters-trigger'));
    const dialogBox = await bounds(dialog);
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width + 1);
    const panel = dialog.locator('.filter-disclosure__panel').filter({
      has: page.getByRole('searchbox', { name: 'Search services', exact: true }),
    });
    const search = panel.getByRole('searchbox', { name: 'Search services', exact: true });
    await expect(search).toBeFocused();
    await usableTarget(page, trigger);
    await usableTarget(page, search);
    for (const checkbox of await panel.getByRole('checkbox').all()) {
      await expect(checkbox).toBeVisible();
      await usableTarget(page, checkbox.locator('..'));
    }
    const done = panel.getByRole('button', { name: 'Done', exact: true });
    await usableTarget(page, done);
    await search.fill('Net');
    await expect(panel.getByRole('checkbox', { name: 'Netflix', exact: true })).toBeVisible();
    await expect(panel.getByRole('checkbox', { name: 'Max', exact: true })).toHaveCount(0);
    const netflix = panel.getByRole('checkbox', { name: 'Netflix', exact: true });
    if (!(await netflix.isChecked())) await chooseInput(netflix);
    await expect
      .poll(() => new URL(page.url()).searchParams.getAll('service'))
      .toContain('netflix');
    await done.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('filters-trigger')).toHaveAttribute('aria-expanded', 'false');

    const updates = page.getByRole('button', { name: 'Service updates', exact: true });
    await updates.click();
    await usableTarget(page, updates);
    for (const [service, label] of [
      ['netflix', 'Netflix updated today'],
      ['max', 'Max has never been updated'],
    ] as const) {
      const link = page.getByRole('link', { name: label, exact: true });
      await usableTarget(page, link);
      await expect(link).toHaveAttribute('href', `/upload?service=${service}`);
    }
    await usableTarget(
      page,
      page
        .locator('.filter-disclosure__panel')
        .filter({ has: page.getByRole('link', { name: 'Netflix updated today', exact: true }) })
        .getByRole('button', { name: 'Done', exact: true }),
    );
    await page.keyboard.press('Escape');
    await expect(updates).toBeFocused();
    await expect(updates).toHaveAttribute('aria-expanded', 'false');
    await noOverflow(page);
  }
});

test('T-UX-144g: labelled dropdown fields and all five runtime options fit phone, tablet and desktop', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await mountLibrary(page);
  for (const width of [320, 640, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    let dialog = await openFiltersPanel(page);
    const dialogBox = await bounds(dialog);
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width + 1);
    let controls = dialog.getByRole('group', { name: 'Filter by', exact: true });
    await expect(controls).toBeVisible();
    let fields = controls.locator('.filter-disclosure[data-filter-field]');
    await expect(fields).toHaveCount(6);
    const positions = await fields.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().x),
    );
    expect(new Set(positions).size).toBe(width < 640 ? 2 : width < 1024 ? 3 : 6);
    for (const [index, category] of [
      'Services',
      'Type',
      'Genre',
      'Runtime',
      'Watching',
      'Priority',
    ].entries()) {
      const field = fields.nth(index);
      const trigger = field.getByRole('button', { name: new RegExp(`^${category} `) });
      await usableTarget(page, trigger);
      await expect(field.locator('label.filter-disclosure__label')).toHaveText(category);
      await expect(trigger.locator('svg')).toHaveAttribute('aria-hidden', 'true');
      await trigger.click();
      const panel = field.locator('.filter-disclosure__panel');
      await horizontallyBounded(page, panel, width);
      if (category === 'Runtime') {
        await expect(panel.getByRole('checkbox')).toHaveCount(5);
        await expect(panel.getByRole('checkbox', { name: '1h – 2h', exact: true })).toHaveCount(0);
        for (const label of ['1h – 1h 30m', '1h 30m – 2h']) {
          const option = panel.getByRole('checkbox', { name: label, exact: true });
          await usableTarget(page, option.locator('..'));
        }
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('filters-trigger')).toHaveAttribute('aria-expanded', 'false');
      if (category !== 'Priority') {
        dialog = await openFiltersPanel(page);
        controls = dialog.getByRole('group', { name: 'Filter by', exact: true });
        fields = controls.locator('.filter-disclosure[data-filter-field]');
        await expect(controls).toBeVisible();
      }
    }
    await expect(page.getByRole('dialog', { name: 'Filter your list', exact: true })).toHaveCount(
      0,
    );
    await noOverflow(page);
  }
  const dialog = await openFiltersPanel(page);
  const controls = dialog.getByRole('group', { name: 'Filter by', exact: true });
  await controls.getByRole('button', { name: 'Runtime Any runtime' }).click();
  const runtime = dialog.getByRole('checkbox', { name: '1h 30m – 2h', exact: true });
  await chooseInput(runtime);
  await expect.poll(() => new URL(page.url()).searchParams.getAll('runtime')).toEqual(['90-120']);
  await expect(
    controls.getByRole('button', { name: 'Runtime 1h 30m – 2h', exact: true }),
  ).toBeVisible();
});

test('T-SVC-002g: all eight services fit the library and remain searchable on phone and desktop', async ({
  page,
}) => {
  const requests = await mountLibrary(page, { allServices: true });
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['Grid', 'Compact']) {
      await page.getByRole('button', { name: `${view} view`, exact: true }).click();
      const badges = page
        .getByTestId('title-list')
        .locator('li.title-row')
        .first()
        .getByTestId('badges');
      for (const service of SERVICES)
        await expect(badges.getByText(SERVICE_LABELS[service], { exact: true })).toBeVisible();
      await noOverflow(page);
    }
    const dialog = await openFiltersPanel(page);
    await dialog.getByRole('button', { name: /^Services / }).click();
    const search = dialog.getByRole('searchbox', { name: 'Search services', exact: true });
    for (const service of SERVICES) {
      await search.fill(SERVICE_LABELS[service]);
      const choice = dialog.getByRole('checkbox', { name: SERVICE_LABELS[service], exact: true });
      await choice.scrollIntoViewIfNeeded();
      await expect(choice).toBeInViewport();
      if (!(await choice.isChecked())) await chooseInput(choice);
      await expect
        .poll(() => new URL(page.url()).searchParams.getAll('service'))
        .toContain(service);
    }
    await closeFiltersPanel(page, dialog);
    const selectedDialog = await openFiltersPanel(page);
    await expect(
      selectedDialog.getByRole('button', { name: 'Services 8 selected', exact: true }),
    ).toBeVisible();
    await closeFiltersPanel(page, selectedDialog);
    await expect
      .poll(() =>
        requests.some(
          (request) =>
            request.pathname === '/api/titles' &&
            request.searchParams.getAll('service').length === 8,
        ),
      )
      .toBe(true);
    await page.getByTestId('clear-filters').click();
    await noOverflow(page);
  }
});

test('T-WATCH-003j: filter panels remain bounded when no titles have genre facets', async ({
  page,
}) => {
  await mountLibrary(page, { withGenres: false });
  for (const width of [320, 640, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    let dialog = await openFiltersPanel(page);
    const controls = dialog.getByRole('group', { name: 'Filter by', exact: true });
    const dialogBox = await bounds(dialog);
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width + 1);
    await expect(controls.locator('.filter-disclosure[data-filter-field]')).toHaveCount(5);
    const categories = ['Services', 'Type', 'Runtime', 'Watching', 'Priority'];
    for (const [index, category] of categories.entries()) {
      const trigger = controls.getByRole('button', { name: new RegExp(`^${category} `) });
      await usableTarget(page, trigger);
      await trigger.click();
      const panel = dialog.locator('.filter-disclosure__panel:visible');
      await horizontallyBounded(page, panel, width);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('filters-trigger')).toHaveAttribute('aria-expanded', 'false');
      if (index < categories.length - 1) {
        dialog = await openFiltersPanel(page);
      }
    }
    await noOverflow(page);
  }
});

test('T-WATCH-003k: preferences overlay preserves the scrolled list and returns focus on dismissal', async ({
  page,
}, testInfo) => {
  await mountLibrary(page);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 640 });
    for (const view of ['Grid', 'Compact']) {
      await page.getByRole('button', { name: `${view} view`, exact: true }).click();
      const trigger = page.getByRole('button', {
        name: 'Watch preferences for Quiet Orbit: Normal',
        exact: true,
      });
      await trigger.evaluate((element) => element.scrollIntoView({ block: 'center' }));
      const before = await page.evaluate(() => ({
        scroll: window.scrollY,
        height: document.documentElement.scrollHeight,
      }));
      expect(before.scroll).toBeGreaterThan(0);
      const triggerBefore = await bounds(trigger);
      await trigger.click();
      const dialog = page.getByRole('dialog', { name: 'Watch preferences', exact: true });
      const box = await bounds(dialog);
      expect(
        Math.abs((await page.evaluate(() => window.scrollY)) - before.scroll),
      ).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(before.height);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(640);
      expect(box.width).toBeLessThanOrEqual(544);
      expect(Math.abs(box.x + box.width / 2 - width / 2)).toBeLessThan(12);
      await expect(dialog.getByRole('checkbox')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('checkbox')).toBeFocused();
      await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
      if (!testInfo.project.use.isMobile) {
        await page.mouse.move(2, 2);
        await page.mouse.wheel(0, 450);
      }
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before.scroll);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      expect(Math.abs((await bounds(trigger)).y - triggerBefore.y)).toBeLessThanOrEqual(1);
      await trigger.click();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(trigger).toBeFocused();
      expect(
        Math.abs((await page.evaluate(() => window.scrollY)) - before.scroll),
      ).toBeLessThanOrEqual(1);
      await noOverflow(page);
    }
  }
});

test('T-WATCH-003i: watch preferences save, survive reload, filter and sort in an accessible phone UI', async ({
  page,
}) => {
  await mountLibrary(page, { width: 320 });
  const trigger = page.getByRole('button', { name: 'Watch preferences for Amber Harbor: Normal' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Watch preferences', exact: true });
  for (const input of await dialog.locator('input').all()) {
    await usableTarget(page, input.locator('..'));
  }
  await dialog.getByRole('checkbox', { name: 'Currently watching' }).check();
  await dialog.getByRole('radio', { name: 'Someday' }).check();
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Save preferences' }).click();
  await expect(
    page.getByRole('button', { name: 'Watch preferences for Amber Harbor: Watching, Someday' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Watch preferences for Amber Harbor: Watching, Someday' }),
  ).toBeVisible();
  const sortGroup = await openSortPanel(page);
  await sortGroup.getByRole('button', { name: 'Watch priority', exact: true }).click();
  await expect(page.getByTestId('title-name').first()).toHaveText('Amber Harbor');
  const filterDialog = await openFiltersPanel(page);
  await filterDialog.getByRole('button', { name: 'Watching All titles', exact: true }).click();
  const watching = filterDialog.getByRole('radio', { name: 'Watching', exact: true });
  await chooseInput(watching);
  await expect.poll(() => new URL(page.url()).searchParams.get('watching')).toBe('true');
  await filterDialog
    .locator('.filter-disclosure__panel:visible')
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await expect(page.getByTestId('title-name')).toHaveText(['Amber Harbor']);
  await filterDialog.getByRole('button', { name: 'Priority All priorities', exact: true }).click();
  await chooseInput(filterDialog.getByRole('checkbox', { name: 'Up next', exact: true }));
  await filterDialog
    .locator('.filter-disclosure__panel:visible')
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await expect(page.getByTestId('zero-match')).toBeVisible();
  await closeFiltersPanel(page, filterDialog);
  await page.getByTestId('clear-filters').click();
  await expect(page.getByTestId('title-name')).toHaveCount(TITLES.length);
  expect(new URL(page.url()).searchParams.get('sort')).toBe('watchPriority');
  await noOverflow(page);
});

test('T-UX-141g: default, popovers and Compact pass axe and honor reduced motion', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mountLibrary(page, { width: 320 });
  for (const state of [
    'default',
    'Filters panel',
    'Sort panel',
    'Services',
    'Service updates',
    'Compact',
  ]) {
    if (state === 'Compact') {
      await page.getByRole('button', { name: 'Compact view', exact: true }).click();
    } else if (state === 'Filters panel') {
      await openFiltersPanel(page);
    } else if (state === 'Sort panel') {
      await openSortPanel(page);
    } else if (state !== 'default') {
      if (state === 'Services') {
        const dialog = await openFiltersPanel(page);
        await dialog.getByRole('button', { name: /^Services / }).click();
      } else {
        await page.getByRole('button', { name: state, exact: true }).click();
      }
    }
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect
      .soft(
        results.violations.map(({ id, nodes }) => ({
          id,
          nodes: nodes.map(({ target, failureSummary }) => ({ target, failureSummary })),
        })),
        `${state} accessibility violations`,
      )
      .toEqual([]);
    expect(
      results.passes.find((rule) => rule.id === 'color-contrast')?.nodes.length ?? 0,
      `${state} must actually evaluate contrast`,
    ).toBeGreaterThan(0);
    const motion = await page.evaluate(() => {
      const seconds = (value: string) =>
        value.split(',').map((duration) => {
          const token = duration.trim();
          return parseFloat(token) / (token.endsWith('ms') ? 1000 : 1);
        });
      return {
        reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
        durations: Array.from(document.querySelectorAll<HTMLElement>('main *')).flatMap(
          (element) => {
            const style = getComputedStyle(element);
            return [...seconds(style.transitionDuration), ...seconds(style.animationDuration)];
          },
        ),
      };
    });
    expect(motion.reduced).toBe(true);
    expect(motion.durations.length).toBeGreaterThan(0);
    expect(Math.max(...motion.durations)).toBeLessThanOrEqual(0.001);
    if (
      state === 'Services' ||
      state === 'Service updates' ||
      state === 'Filters panel' ||
      state === 'Sort panel'
    )
      await page.keyboard.press('Escape');
  }
});
