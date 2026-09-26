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

/**
 * The stand-in TMDB poster, **16 x 24**, not 1 x 1.
 *
 * ⚠ THE SIZE IS LOAD-BEARING AND A 1 x 1 PNG SILENTLY BREAKS `mountLibrary`.
 * The poster now ships a `srcset` (`w342` at `1x`, `w500` at `2x`,
 * `T-UX-153`). `naturalWidth` is **density-corrected**: for a candidate chosen
 * at `2x` the browser divides the intrinsic width by 2, and the IDL attribute
 * is an `unsigned long`, so a 1 px-wide source becomes 0.5 and **rounds to 0**.
 * `mountLibrary`'s readiness poll asserts `naturalWidth > 0`, which is then
 * false forever, and every test in this file times out in `mountLibrary`
 * before reaching its own assertions.
 *
 * ⚠ IT FAILED ON `mobile-safari` ONLY, AND THAT IS THE CLUE, NOT A WEBKIT BUG.
 * The desktop Chromium project runs at a device pixel ratio of 1 and picks the
 * `1x` candidate, where the correction is a no-op and a 1 px image measures 1.
 * Only the emulated phone, at 2x, selects the `2x` candidate and triggers the
 * rounding. Anything that changes `srcset`, the descriptors, or a project's
 * `deviceScaleFactor` can re-enter this, so the fixture is sized well clear of
 * the boundary rather than tuned to just clear it.
 *
 * The poll is deliberately NOT relaxed to `image.complete` alone: that is true
 * for a broken image too, so it would report the posters ready in exactly the
 * case the check exists to catch.
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAGklEQVR4nGMwcEggCTGMahjVMKphVANtNQAAhow4EORXJhAAAAAASUVORK5CYII=',
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
        params.getAll('priority').includes(preference?.priority ?? 'normal')) &&
      // `api.md` §6.2 `status`: Watching outranks the stored priority.
      (!params.has('status') ||
        params
          .getAll('status')
          .includes(
            preference?.watching === true ? 'watching' : (preference?.priority ?? 'normal'),
          ))
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

/**
 * Issue 369 — follows a destination the way the owner would at this width:
 * inline in the wide header, or through the Menu drawer on a phone.
 */
async function navigateTo(page: Page, name: string): Promise<void> {
  const nav = page.getByRole('navigation', { name: 'Primary' });
  const inline = nav.getByRole('link', { name, exact: true });
  await inline
    .or(nav.getByRole('button', { name: 'Menu' }))
    .first()
    .waitFor();
  if ((await inline.count()) > 0) {
    await inline.click();
    return;
  }
  await nav.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('dialog', { name: 'Menu' }).getByRole('link', { name, exact: true }).click();
}

async function checkServiceUpdates(page: Page): Promise<void> {
  const panel = page.getByRole('group', { name: 'Service updates', exact: true });
  const box = await bounds(panel);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await expect(panel.getByRole('link')).toHaveCount(SERVICES.length);
  for (const chip of await panel.getByRole('link').all()) {
    await chip.click({ trial: true });
    expect(
      await chip.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2),
        );
      }),
      await chip.innerText(),
    ).toBe(true);
  }
  await panel.getByRole('button', { name: 'Done', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Service updates', exact: true });
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
}

async function mountLibrary(
  page: Page,
  {
    width = 1280,
    url = '/',
    paged = false,
    withGenres = true,
    allServices = false,
    varied = false,
    watchingIndexes = [2],
    singleService = false,
    unfinishedCapture = false,
    expectedCount = TITLES.length,
    titleSuffix = '',
    brightArtwork = false,
  } = {},
): Promise<URL[]> {
  const requests: URL[] = [];
  const preferences = new Map<string, Preferences>();
  if (varied) {
    TITLES.forEach((title, index) =>
      preferences.set(title.titleId, {
        watching: watchingIndexes.includes(index),
        priority: index === 0 ? 'up-next' : index === 1 ? 'someday' : 'normal',
      }),
    );
  }
  await page.setViewportSize({ width, height: 900 });
  await page.route('**/*', async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.hostname === 'image.tmdb.org') {
      await route.fulfill(
        brightArtwork
          ? {
              contentType: 'image/svg+xml',
              body: '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="240"><rect width="160" height="240" fill="white"/></svg>',
            }
          : { contentType: 'image/png', body: PNG },
      );
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
      case '/api/batches':
        expect(target.searchParams.get('open')).toBe('true');
        body = {
          batches: unfinishedCapture
            ? [
                {
                  batchId: 'unfinished-review',
                  service: 'netflix',
                  mode: 'append-only',
                  status: 'in-review',
                  createdAt: '2026-09-22T10:00:00Z',
                },
              ]
            : [],
        };
        break;
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
          .map((title, index) => ({
            ...title,
            name: title.name + titleSuffix,
            ...(varied && index === 4
              ? {
                  runtimeMinutes: null,
                  imdbRating: null,
                  posterPath: null,
                  matchState: 'unmatched',
                }
              : {}),
            genres: withGenres ? title.genres : [],
            badges:
              allServices || singleService
                ? (singleService ? SERVICES.slice(index, index + 1) : SERVICES).map((service) => ({
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
  if (paged) {
    // The first three are stable even if a visible sentinel has loaded page two.
    await expect(page.getByTestId('title-name').nth(2)).toBeVisible();
  } else {
    await expect(page.getByTestId('title-name')).toHaveCount(expectedCount);
  }
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

const { describe } = test;
for (const width of [320, 1280]) {
  describe(`Remembered library at ${width}px`, () => {
    test('T-LIB-003d: layout survives return, reload and restart without changing data requests', async ({
      page,
      browser,
    }) => {
      const requests = await mountLibrary(page, {
        width,
        url: '/?service=netflix&sort=name&dir=asc&q=Orbit',
        expectedCount: 1,
      });
      const url = page.url();
      const rows = await page.getByTestId('title-list').innerHTML();
      const reads = requests.filter((request) => request.pathname === '/api/titles').length;
      await page.getByRole('button', { name: 'Compact view', exact: true }).click();
      await expect(page.getByTestId('title-list')).toHaveAttribute('data-view', 'compact');
      expect(await page.getByTestId('title-list').innerHTML()).toBe(rows);
      expect(page.url()).toBe(url);
      expect(requests.filter((request) => request.pathname === '/api/titles')).toHaveLength(reads);
      await navigateTo(page, 'Import');
      await expect(
        page.getByRole('heading', { name: /^Import (screenshots|your watchlist)$/ }),
      ).toBeVisible();
      await navigateTo(page, 'Library');
      await expect(page.getByTestId('title-list')).toHaveAttribute('data-view', 'compact');
      expect(page.url()).toBe(url);
      await page.reload();
      await expect(page.getByTestId('title-list')).toHaveAttribute('data-view', 'compact');
      const restarted = await browser.newContext({
        storageState: await page.context().storageState(),
      });
      try {
        const fresh = await restarted.newPage();
        await mountLibrary(fresh, { width, expectedCount: 1 });
        await expect(fresh.getByTestId('title-list')).toHaveAttribute('data-view', 'compact');
        await expect(
          fresh.getByRole('button', { name: 'Compact view', exact: true }),
        ).toHaveAttribute('aria-pressed', 'true');
        expect(fresh.url()).toBe(url);
        await fresh.getByRole('button', { name: 'Grid view', exact: true }).click();
        await fresh.reload();
        await expect(fresh.getByTestId('title-list')).toHaveAttribute('data-view', 'grid');
        await noOverflow(fresh);
      } finally {
        await restarted.close();
      }
    });

    test('T-LIB-001h: library choices survive navigation and browser restart', async ({
      page,
      browser,
    }) => {
      const requests = await mountLibrary(page, { width });
      await page.getByTestId('sort-trigger').click();
      await page.getByRole('button', { name: 'Name A-Z', exact: true }).click();
      await page.getByTestId('filters-trigger').click();
      if (width < 640) {
        // TASK-255: the phone sheet's service chips are the checkboxes.
        const sheet = page.getByRole('dialog', { name: 'Filters', exact: true });
        const netflix = sheet.getByRole('checkbox', { name: 'Netflix', exact: true });
        await sheetChip(netflix).click();
        await expect(netflix).toBeChecked();
      } else {
        await page.getByRole('button', { name: /^Services / }).click();
        await page.getByRole('checkbox', { name: 'Netflix', exact: true }).click();
        await expect(page.getByRole('checkbox', { name: 'Netflix', exact: true })).toBeChecked();
      }
      await page.keyboard.press('Escape');
      if (width < 640) await page.getByTestId('tab-search').click();
      else if (width < 1280) await page.getByTestId('list-search-trigger').click();
      await page.getByRole('searchbox', { name: 'Search your library', exact: true }).fill('Orbit');
      await page.getByRole('search').getByRole('button', { name: 'Search', exact: true }).click();
      await expect(page.getByTestId('title-name')).toHaveText(['Quiet Orbit']);
      const saved = `?${await page.evaluate(() => localStorage.getItem('nextup.library.v1'))}`;
      await navigateTo(page, 'Import');
      await expect(
        page.getByRole('heading', { name: /^Import (screenshots|your watchlist)$/ }),
      ).toBeVisible();
      requests.length = 0;
      await navigateTo(page, 'Library');
      await expect(page.getByTestId('title-name')).toHaveText(['Quiet Orbit']);
      expect(new URL(page.url()).search).toBe(saved);
      expect(requests.find((url) => url.pathname === '/api/titles')?.search).toBe(saved);
      await expect(
        page.getByRole('button', { name: 'Remove service filter: Netflix' }),
      ).toBeVisible();
      await expect(page.getByTestId('sort-trigger')).toContainText('Name A-Z');
      await noOverflow(page);

      const state = await page.context().storageState();
      const restarted = await browser.newContext({ storageState: state });
      try {
        const fresh = await restarted.newPage();
        const restoredRequests = await mountLibrary(fresh, { width, expectedCount: 1 });
        expect(new URL(fresh.url()).search).toBe(saved);
        expect(restoredRequests.find((url) => url.pathname === '/api/titles')?.search).toBe(saved);
        await fresh.getByRole('button', { name: 'Clear search', exact: true }).click();
        await fresh.getByTestId('clear-filters').click();
        await expect(fresh).toHaveURL(
          (url) => !url.searchParams.has('service') && !url.searchParams.has('q'),
        );
        await expect(
          fresh.getByRole('button', { name: 'Remove service filter: Netflix' }),
        ).toHaveCount(0);
        await expect
          .poll(() => fresh.evaluate(() => localStorage.getItem('nextup.library.v1')))
          .toBe('sort=name&dir=asc');
        await expect(fresh.getByTestId('title-name')).toHaveCount(TITLES.length);
        await fresh.goto(new URL('/', fresh.url()).href);
        await expect(fresh.getByTestId('title-name')).toHaveCount(TITLES.length);
        expect(new URL(fresh.url()).searchParams.has('service')).toBe(false);
        expect(new URL(fresh.url()).searchParams.has('q')).toBe(false);
        await expect(fresh.getByTestId('sort-trigger')).toContainText('Name A-Z');
        await fresh.goto(new URL('/?sort=runtime&dir=desc', fresh.url()).href);
        await expect(fresh.getByTestId('sort-trigger')).toContainText('Longest runtime');
        await expect(fresh.getByTestId('title-name').first()).toHaveText('Paper Lanterns');
        expect(new URL(fresh.url()).searchParams.has('service')).toBe(false);
      } finally {
        await restarted.close();
      }
    });
  });
}

for (const width of [320, 640, 1280]) {
  describe(`Capture and library header at ${width}px`, () => {
    test('T-LIB-004: unfinished capture stays separate from library heading and actions', async ({
      page,
    }) => {
      await mountLibrary(page, { width, unfinishedCapture: true });
      const banner = page.getByRole('complementary', { name: 'Unfinished capture' });
      await expect(banner).toContainText('Netflix / Ready to review');
      const status = await bounds(banner);
      for (const control of [
        // TASK-255: the phone heading reads "My Library", as the mockup does.
        page.getByRole('heading', { name: width < 640 ? 'My Library' : 'Library', exact: true }),
        page.getByRole('button', { name: 'Service updates', exact: true }),
        page.getByTestId('add-title-open'),
      ]) {
        const box = await bounds(control);
        expect(box.y - (status.y + status.height)).toBeGreaterThanOrEqual(16);
      }
      await expect(banner.getByRole('link', { name: 'Continue review' })).toHaveAttribute(
        'href',
        '/batches/unfinished-review',
      );
      await page.getByRole('button', { name: 'Service updates', exact: true }).click();
      await expect(page.getByText('Netflix updated today', { exact: true })).toBeVisible();
      await checkServiceUpdates(page);
      await page.getByTestId('add-title-open').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await noOverflow(page);
    });
  });
}

async function bounds(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (box === null) throw new Error('Visible element has no bounding box');
  return box;
}

test('T-LIB-002d: responsive search preserves disclosure, desktop persistence and active search', async ({
  page,
}) => {
  for (const width of [320, 1280]) {
    const requests = await mountLibrary(page, { width });
    const controls = page.getByTestId('list-controls');
    /*
     * TASK-255: on the phone the tab bar's Search tab is the trigger and the
     * toolbar draws none; the tab sits in the bottom bar, not beside the sort
     * control, and carries no expanded state of its own.
     */
    const phone = width < 640;
    const trigger = page.getByTestId(phone ? 'tab-search' : 'list-search-trigger');
    const search = page.getByRole('searchbox', { name: 'Search your library', exact: true });
    if (width < 1280) {
      await expect(page.getByRole('search')).toHaveCount(0);
      const compactHeight = (await bounds(controls)).height;
      if (phone) {
        await expect(page.getByTestId('list-search-trigger')).toHaveCount(0);
      } else {
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect((await bounds(trigger)).y).toBeGreaterThanOrEqual(
          (await bounds(page.getByTestId('sort-trigger'))).y,
        );
      }
      await usableTarget(page, trigger);
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect
        .poll(async () => (await bounds(controls)).height)
        .toBeGreaterThan(compactHeight + 30);
    } else {
      await expect(trigger).toBeHidden();
      await expect(search).toBeVisible();
      await expect(page.getByRole('button', { name: 'Close search' })).toBeHidden();
      await search.focus();
    }
    await expect(search).toBeFocused();
    const reads = requests.length;
    await search.fill('Orbit');
    expect(requests.length).toBe(reads);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('title-name')).toHaveText(['Quiet Orbit']);
    await page.keyboard.press('Escape');
    if (width < 1280) {
      await expect(trigger).toBeFocused();
      await expect(page.getByRole('search')).toHaveCount(0);
    } else {
      await expect(search).toBeFocused();
      await expect(page.getByRole('search')).toBeVisible();
    }
    if (!phone) await expect(trigger).toHaveText('Search active');
    const chip = page.getByRole('button', { name: 'Remove search filter: Search: Orbit' });
    await expect(chip).toBeVisible();
    await noOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await chip.click();
    await expect(page.getByTestId('title-name')).toHaveCount(TITLES.length);
    expect(new URL(page.url()).searchParams.has('q')).toBe(false);
    if (width < 1280) await trigger.click();
    else await search.focus();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await noOverflow(page);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    if (width < 1280) {
      await page.getByRole('button', { name: 'Close search' }).click();
      await expect(trigger).toBeFocused();
    } else {
      await page.keyboard.press('Escape');
      await expect(search).toBeFocused();
    }
  }
});

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
  const dialog = page.getByRole('dialog', { name: 'Filter your library', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * TASK-255 — below `--bp-sm` the filters are the owner's phone sheet (native
 * chip inputs, named *Filters*), not the desktop panel of labelled dropdowns.
 * Cases that measure the desktop panel's structure take a phone branch that
 * measures the sheet instead; `T-PHONE-007` owns the sheet's own layout.
 */
function atPhoneWidth(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 640;
}

async function openFilterSheet(page: Page): Promise<Locator> {
  const trigger = page.getByTestId('filters-trigger');
  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const sheet = page.getByRole('dialog', { name: 'Filters', exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closeFilterSheet(page: Page, sheet: Locator): Promise<void> {
  await sheet.getByTestId('filter-sheet-show').click();
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('filters-trigger')).toHaveAttribute('aria-expanded', 'false');
}

/** A sheet chip's own box: the native input is visually replaced by its label. */
function sheetChip(input: Locator): Locator {
  return input.locator('xpath=ancestor::label[contains(@class, "filter-chip")][1]');
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
  const dialog = page.getByRole('dialog', { name: 'Sort your library', exact: true });
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

test('T-UX-141e: wide Cover browser uses shorter Comparison desk rows without losing list state', async ({
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
    expect(details.y).toBeGreaterThan(poster.y);
    expect(details.y).toBeLessThan(poster.y + poster.height);
    expect(poster.x).toBeGreaterThanOrEqual(first.x);
    expect(poster.height / poster.width).toBeCloseTo(1.5, 1);
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
  await expect(page.getByRole('dialog', { name: 'Sort your library', exact: true })).toHaveCount(0);
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
      await expect(
        page.getByRole('dialog', { name: 'Sort your library', exact: true }),
      ).toHaveCount(0);
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
  await expect(page.getByRole('dialog', { name: 'Sort your library', exact: true })).toHaveCount(0);
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
  const search = page.getByRole('searchbox', { name: 'Search your library', exact: true });
  await expect(search).toBeVisible();
  await search.fill('Amber');
  expect(requests.length).toBe(before);
  await page.getByRole('search').getByRole('button', { name: 'Search', exact: true }).click();
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
  const firstPage = page.waitForResponse((response) => {
    const target = new URL(response.url());
    return (
      target.pathname === '/api/titles' &&
      !target.searchParams.has('q') &&
      !target.searchParams.has('cursor')
    );
  });
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  expect((await (await firstPage).json()).items).toHaveLength(3);
  await expect(page.getByTestId('zero-match')).toBeHidden();
  expect(new URL(page.url()).searchParams.has('q')).toBe(false);
  // Shorter cards may already bring the sentinel into view. Verify pagination
  // completes instead of racing the transient Load more button's removal.
  await expect(page.getByTestId('title-name').nth(2)).toBeVisible();
  await expect(search).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByTestId('title-name')).toHaveCount(TITLES.length);
});

test('T-UX-143d: Services and service-update popovers are usable at 320px and 1280px', async ({
  page,
}, testInfo) => {
  await mountLibrary(page);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    if (atPhoneWidth(page)) {
      // TASK-255: the phone sheet shows every service as a chip at once.
      const sheet = await openFilterSheet(page);
      const sheetBox = await bounds(sheet);
      expect(sheetBox.x).toBeGreaterThanOrEqual(0);
      expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(width + 1);
      const group = sheet.getByRole('group', { name: 'Services', exact: true });
      const boxes = group.getByRole('checkbox');
      await expect(boxes).toHaveCount(SERVICES.length);
      for (const checkbox of await boxes.all()) {
        await sheetChip(checkbox).scrollIntoViewIfNeeded();
        await usableTarget(page, sheetChip(checkbox));
      }
      const netflix = group.getByRole('checkbox', { name: 'Netflix', exact: true });
      if (!(await netflix.isChecked())) await sheetChip(netflix).click();
      await expect
        .poll(() => new URL(page.url()).searchParams.getAll('service'))
        .toContain('netflix');
      await expect(sheet).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      await expect(page.getByTestId('filters-trigger')).toHaveAttribute('aria-expanded', 'false');
    } else {
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
      /*
       * ⚠ THE SEARCH BOX IS AUTOFOCUSED ONLY ON A FINE POINTER (TASK-289).
       *
       * On a touch device, focusing it raises the on-screen keyboard over the
       * checkboxes this very case then goes on to measure. The popover still
       * takes focus, so the case still proves focus is contained.
       */
      if (testInfo.project.name === 'mobile-safari') {
        await expect(panel).toBeFocused();
      } else {
        await expect(search).toBeFocused();
      }
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
    }

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
    if (atPhoneWidth(page)) {
      /*
       * TASK-255: the phone sheet has no dropdowns — each category is a
       * labelled group of chips, and the runtime slider sits in the sheet.
       */
      const sheet = await openFilterSheet(page);
      const sheetBox = await bounds(sheet);
      expect(sheetBox.x).toBeGreaterThanOrEqual(0);
      expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(width + 1);
      for (const category of ['Services', 'Type', 'Genre', 'Status']) {
        const group = sheet.getByRole('group', { name: category, exact: true });
        await group.scrollIntoViewIfNeeded();
        await expect(group).toBeVisible();
        await horizontallyBounded(page, group, width);
      }
      await expect(sheet.locator('.filter-disclosure')).toHaveCount(0);
      for (const name of ['Minimum runtime', 'Maximum runtime']) {
        const slider = sheet.getByRole('slider', { name, exact: true });
        await slider.scrollIntoViewIfNeeded();
        await usableTarget(page, slider);
      }
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
      await noOverflow(page);
      continue;
    }
    let dialog = await openFiltersPanel(page);
    const dialogBox = await bounds(dialog);
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width + 1);
    let controls = dialog.getByRole('group', { name: 'Filter by', exact: true });
    await expect(controls).toBeVisible();
    let fields = controls.locator('.filter-disclosure[data-filter-field]');
    await expect(fields).toHaveCount(5);
    const positions = await fields.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().x),
    );
    /*
     * ⚠ **TWO COLUMNS AT EVERY WIDTH.** This asserted `2 / 3 / 6` by viewport,
     * which codified the defect rather than catching it: the controls live in
     * `.dialog--panel`, capped at `26rem`, so six columns meant six controls
     * sharing ~400px and every label wrapped to one character per line. The
     * count is now a property of the panel, which does not change with the
     * viewport. `T-UX-147e` measures the consequence the owner actually sees.
     */
    expect(new Set(positions).size).toBe(2);
    for (const [index, category] of ['Services', 'Type', 'Genre', 'Runtime', 'Status'].entries()) {
      const field = fields.nth(index);
      const trigger = field.getByRole('button', { name: new RegExp(`^${category} `) });
      await usableTarget(page, trigger);
      await expect(field.locator('label.filter-disclosure__label')).toHaveText(category);
      await expect(trigger.locator('svg')).toHaveAttribute('aria-hidden', 'true');
      await trigger.click();
      const panel = field.locator('.filter-disclosure__panel');
      await horizontallyBounded(page, panel, width);
      if (category === 'Runtime') {
        await expect(panel.getByRole('checkbox')).toHaveCount(0);
        await expect(panel.getByRole('slider')).toHaveCount(2);
        for (const name of ['Minimum runtime', 'Maximum runtime']) {
          await usableTarget(page, panel.getByRole('slider', { name, exact: true }));
        }
      }
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId('filters-trigger')).toHaveAttribute('aria-expanded', 'false');
      if (category !== 'Status') {
        dialog = await openFiltersPanel(page);
        controls = dialog.getByRole('group', { name: 'Filter by', exact: true });
        fields = controls.locator('.filter-disclosure[data-filter-field]');
        await expect(controls).toBeVisible();
      }
    }
    await expect(
      page.getByRole('dialog', { name: 'Filter your library', exact: true }),
    ).toHaveCount(0);
    await noOverflow(page);
  }
  const dialog = await openFiltersPanel(page);
  const controls = dialog.getByRole('group', { name: 'Filter by', exact: true });
  await controls.getByRole('button', { name: 'Runtime Any', exact: true }).click();
  const minimum = dialog.getByRole('slider', { name: 'Minimum runtime', exact: true });
  const maximum = dialog.getByRole('slider', { name: 'Maximum runtime', exact: true });
  await minimum.fill('3');
  await maximum.fill('4');
  await expect.poll(() => new URL(page.url()).searchParams.getAll('runtime')).toEqual(['90-120']);
  await expect(
    controls.getByRole('button', { name: 'Runtime 1h 30m – 2h', exact: true }),
  ).toBeVisible();
});

/** Viewport centre of a range handle at `stop`, from the input's own box. */
async function handleCentre(slider: Locator, stop: number): Promise<{ x: number; y: number }> {
  const box = await bounds(slider);
  const half = 22;
  return { x: box.x + half + ((box.width - 2 * half) * stop) / 5, y: box.y + box.height / 2 };
}

async function openRuntimeSlider(page: Page): Promise<{
  trigger: Locator | null;
  panel: Locator;
  minimum: Locator;
  maximum: Locator;
}> {
  if (atPhoneWidth(page)) {
    // TASK-255: the phone sheet shows the slider itself, with no trigger.
    const sheet = await openFilterSheet(page);
    const panel = sheet.locator('.filter-sheet__runtime');
    await panel.locator('.range-slider').scrollIntoViewIfNeeded();
    return {
      trigger: null,
      panel,
      minimum: panel.getByRole('slider', { name: 'Minimum runtime', exact: true }),
      maximum: panel.getByRole('slider', { name: 'Maximum runtime', exact: true }),
    };
  }
  const dialog = await openFiltersPanel(page);
  const trigger = dialog.getByRole('button', { name: /^Runtime / });
  await trigger.click();
  const panel = dialog.locator('.filter-disclosure__panel:visible');
  await panel.locator('.range-slider').scrollIntoViewIfNeeded();
  return {
    trigger,
    panel,
    minimum: panel.getByRole('slider', { name: 'Minimum runtime', exact: true }),
    maximum: panel.getByRole('slider', { name: 'Maximum runtime', exact: true }),
  };
}

function runtimeParams(page: Page): string[] {
  return new URL(page.url()).searchParams.getAll('runtime');
}

for (const width of [320, 640, 1280]) {
  describe(`Runtime range slider at ${String(width)}px`, () => {
    test('T-RANGE-003a: runtime slider handles are usable targets by keyboard and pointer', async ({
      page,
    }) => {
      await mountLibrary(page, { width });
      const { trigger, panel, minimum, maximum } = await openRuntimeSlider(page);
      await horizontallyBounded(page, panel, width);
      const slider = panel.locator('.range-slider');
      await expect(slider.locator('label', { hasText: /^Min$/ })).toBeVisible();
      await expect(slider.locator('label', { hasText: /^Max$/ })).toBeVisible();
      await expect(slider.getByTestId('range-min-value')).toHaveText('0m');
      await expect(slider.getByTestId('range-max-value')).toHaveText('No limit');

      // Each visible handle is the element under its own centre, so the other
      // input spanning the same track cannot swallow the press.
      for (const [locator, stop, handle] of [
        [minimum, 0, 'min'],
        [maximum, 5, 'max'],
      ] as const) {
        const centre = await handleCentre(locator, stop);
        const hit = await page.evaluate(
          ({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('data-handle') ?? null,
          centre,
        );
        expect(hit).toBe(handle);
        const viewport = page.viewportSize();
        expect(centre.x - 22).toBeGreaterThanOrEqual(0);
        expect(centre.x + 22).toBeLessThanOrEqual((viewport?.width ?? 0) + 1);
      }

      await minimum.focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => runtimeParams(page)).toEqual(['60-90', '90-120', 'over120']);
      await expect(minimum).toHaveAttribute('aria-valuetext', '1 hour');
      await expect(slider.getByTestId('range-min-value')).toHaveText('1h');

      await maximum.focus();
      for (let step = 0; step < 5; step += 1) await page.keyboard.press('ArrowLeft');
      await expect.poll(() => runtimeParams(page)).toEqual(['60-90']);
      await expect(maximum).toHaveAttribute('aria-valuetext', '1 hour 30 minutes');
      await expect(minimum).toHaveAttribute('aria-valuetext', '1 hour');
      await expect(slider.getByTestId('range-notice')).toHaveText(
        'The maximum cannot go below the minimum.',
      );

      // TASK-255: on the phone the slider lives in the sheet's scroller, and a
      // keyboard focus need not scroll it into view (WebKit does not), so the
      // pointer half brings it on screen first, as a thumb would.
      await maximum.scrollIntoViewIfNeeded();
      const from = await handleCentre(maximum, 3);
      const to = await handleCentre(maximum, 5);
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x + 10, to.y, { steps: 8 });
      await page.mouse.up();
      await expect.poll(() => runtimeParams(page)).toEqual(['60-90', '90-120', 'over120']);
      if (trigger !== null) await expect(trigger).toHaveAccessibleName('Runtime Over 1h');
      await noOverflow(page);
      expect(
        (await new AxeBuilder({ page }).include('.range-slider').analyze()).violations,
      ).toEqual([]);
    });
  });
}

test('T-RANGE-003b: a touch drag moves the minimum handle in the phone filter drawer', async ({
  page,
}, testInfo) => {
  testInfo.skip(testInfo.project.name !== 'chromium', 'Touch is dispatched through Chromium CDP');
  await mountLibrary(page, { width: 390 });
  const { panel, minimum } = await openRuntimeSlider(page);
  await horizontallyBounded(page, panel, 390);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const from = await handleCentre(minimum, 0);
  const to = await handleCentre(minimum, 2);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y }],
  });
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + ((to.x - from.x) * step) / 8, y: from.y }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => runtimeParams(page)).toEqual(['60-90', '90-120', 'over120']);
  await expect(minimum).toHaveAttribute('aria-valuetext', '1 hour');
  await noOverflow(page);
});
for (const width of [320, 1280]) {
  describe(`Service filters at ${width}px`, () => {
    test('T-SVC-002g: all eight services fit and remain searchable', async ({ page }) => {
      const requests = await mountLibrary(page, { width, allServices: true });
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
      if (atPhoneWidth(page)) {
        // TASK-255: the phone sheet lists all eight at once — no search needed.
        const sheet = await openFilterSheet(page);
        const group = sheet.getByRole('group', { name: 'Services', exact: true });
        for (const service of SERVICES) {
          const choice = group.getByRole('checkbox', {
            name: SERVICE_LABELS[service],
            exact: true,
          });
          const chip = sheetChip(choice);
          await chip.scrollIntoViewIfNeeded();
          await expect(chip).toBeInViewport();
          if (!(await choice.isChecked())) await chip.click();
          await expect
            .poll(() => new URL(page.url()).searchParams.getAll('service'))
            .toContain(service);
        }
        await closeFilterSheet(page, sheet);
        const reopened = await openFilterSheet(page);
        for (const service of SERVICES)
          await expect(
            reopened.getByRole('checkbox', { name: SERVICE_LABELS[service], exact: true }),
          ).toBeChecked();
        await closeFilterSheet(page, reopened);
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
        return;
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
    });
  });
}

for (const width of [320, 640, 1280]) {
  describe(`Empty genre facets at ${width}px`, () => {
    test('T-WATCH-003j: filter panels remain bounded without genre facets', async ({ page }) => {
      await mountLibrary(page, { width, withGenres: false });
      if (atPhoneWidth(page)) {
        // TASK-255: without facets the phone sheet simply has no Genre group.
        const sheet = await openFilterSheet(page);
        const sheetBox = await bounds(sheet);
        expect(sheetBox.x).toBeGreaterThanOrEqual(0);
        expect(sheetBox.x + sheetBox.width).toBeLessThanOrEqual(width + 1);
        for (const category of ['Services', 'Type', 'Status']) {
          const group = sheet.getByRole('group', { name: category, exact: true });
          await group.scrollIntoViewIfNeeded();
          await horizontallyBounded(page, group, width);
        }
        await expect(sheet.getByRole('group', { name: 'Genre', exact: true })).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(sheet).toHaveCount(0);
        await noOverflow(page);
        return;
      }
      let dialog = await openFiltersPanel(page);
      const controls = dialog.getByRole('group', { name: 'Filter by', exact: true });
      const dialogBox = await bounds(dialog);
      expect(dialogBox.x).toBeGreaterThanOrEqual(0);
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(width + 1);
      await expect(controls.locator('.filter-disclosure[data-filter-field]')).toHaveCount(4);
      const categories = ['Services', 'Type', 'Runtime', 'Status'];
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
    });
  });
}

test('T-WATCH-003k: preferences overlay preserves the scrolled list and returns focus on dismissal', async ({
  page,
}, testInfo) => {
  await mountLibrary(page);
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 640 });
    for (const view of ['Grid', 'Compact']) {
      await page.getByRole('button', { name: `${view} view`, exact: true }).click();
      const trigger = page.getByRole('button', {
        name: 'Watch status for The Last Observatory: Normal',
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
      const dialog = page.getByRole('dialog', { name: 'Watch status', exact: true });
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
      await expect(dialog.getByRole('radio', { name: 'Watching', exact: true })).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('radio', { name: 'Watching', exact: true })).toBeFocused();
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
  const trigger = page.getByRole('button', { name: 'Watch status for Amber Harbor: Normal' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Watch status', exact: true });
  for (const input of await dialog.locator('input').all()) {
    await usableTarget(page, input.locator('..'));
  }
  await dialog.getByRole('radio', { name: 'Watching' }).check();
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Save status' }).click();
  await expect(
    page.getByRole('button', { name: 'Watch status for Amber Harbor: Watching' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Watch status for Amber Harbor: Watching' }),
  ).toBeVisible();
  const sortGroup = await openSortPanel(page);
  await sortGroup.getByRole('button', { name: 'Watch priority', exact: true }).click();
  await expect(page.getByTestId('title-name').first()).toHaveText('Amber Harbor');
  if (atPhoneWidth(page)) {
    // TASK-255: the phone sheet's Status chips are the multi-select checkboxes themselves.
    const sheet = await openFilterSheet(page);
    const status = sheet.getByRole('group', { name: 'Status', exact: true });
    const watchingChip = sheetChip(status.getByRole('checkbox', { name: 'Watching', exact: true }));
    await watchingChip.scrollIntoViewIfNeeded();
    await usableTarget(page, watchingChip);
    await watchingChip.click();
    await expect
      .poll(() => new URL(page.url()).searchParams.getAll('status'))
      .toEqual(['watching']);
    await expect(page.getByTestId('title-name')).toHaveText(['Amber Harbor']);
    // Multi-select: adding Up next keeps Watching; removing Watching leaves Up next alone.
    await sheetChip(status.getByRole('checkbox', { name: 'Up next', exact: true })).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.getAll('status'))
      .toEqual(['watching', 'up-next']);
    await expect(page.getByTestId('title-name')).toHaveText(['Amber Harbor']);
    await watchingChip.click();
    await expect.poll(() => new URL(page.url()).searchParams.getAll('status')).toEqual(['up-next']);
    await expect(page.getByTestId('zero-match')).toBeVisible();
    await closeFilterSheet(page, sheet);
    await page.getByTestId('clear-filters').click();
    await expect(page.getByTestId('title-name')).toHaveCount(TITLES.length);
    expect(new URL(page.url()).searchParams.get('sort')).toBe('watchPriority');
    await noOverflow(page);
    return;
  }
  const filterDialog = await openFiltersPanel(page);
  await filterDialog.getByRole('button', { name: 'Status Any', exact: true }).click();
  const watching = filterDialog.getByRole('checkbox', { name: 'Watching', exact: true });
  await chooseInput(watching);
  await expect.poll(() => new URL(page.url()).searchParams.getAll('status')).toEqual(['watching']);
  await filterDialog
    .locator('.filter-disclosure__panel:visible')
    .getByRole('button', { name: 'Done', exact: true })
    .click();
  await expect(page.getByTestId('title-name')).toHaveText(['Amber Harbor']);
  await filterDialog.getByRole('button', { name: 'Status Watching', exact: true }).click();
  // Multi-select: adding Up next keeps Watching; removing Watching leaves none.
  await chooseInput(filterDialog.getByRole('checkbox', { name: 'Up next', exact: true }));
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll('status'))
    .toEqual(['watching', 'up-next']);
  await expect(page.getByTestId('title-name')).toHaveText(['Amber Harbor']);
  await chooseInput(filterDialog.getByRole('checkbox', { name: 'Watching', exact: true }));
  await expect.poll(() => new URL(page.url()).searchParams.getAll('status')).toEqual(['up-next']);
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
      await (atPhoneWidth(page) ? openFilterSheet(page) : openFiltersPanel(page));
    } else if (state === 'Sort panel') {
      await openSortPanel(page);
    } else if (state !== 'default') {
      if (state === 'Services' && atPhoneWidth(page)) {
        // TASK-255: the phone sheet has no Services popover; its chips are it.
        const sheet = await openFilterSheet(page);
        await sheet.getByRole('group', { name: 'Services', exact: true }).scrollIntoViewIfNeeded();
      } else if (state === 'Services') {
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

/*
 * Owner-reported 2026-09-17, after the Filters/Sort panels shipped. Three
 * separate complaints, three separate claims — and every one of them is a
 * LAYOUT fact that only a real browser can answer, which is why they live here
 * and not in the jsdom suite.
 */
for (const width of [640, 900, 1280]) {
  for (const singleService of [true, false]) {
    describe(`Aligned grid at ${width}px with ${singleService ? 'different logos' : 'wrapped services'}`, () => {
      test('T-POL-004: Watching and content-sized service footers stay aligned', async ({
        page,
      }, testInfo) => {
        await mountLibrary(page, {
          width,
          varied: true,
          watchingIndexes: [0, 1],
          singleService,
          allServices: !singleService,
        });
        const cards = page.locator('li.title-row');
        const geometry = await cards.evaluateAll((rows) =>
          rows.map((row) => {
            const rect = (selector: string) => {
              const element = row.querySelector(selector);
              if (!element) throw new Error(`Missing ${selector}`);
              const { x, y, width, height, bottom } = element.getBoundingClientRect();
              return { x, y, width, height, bottom };
            };
            return {
              top: Math.round(row.getBoundingClientRect().top),
              name: rect('.title-row__name'),
              watching: row.querySelector('.title-row__watch[data-watching="true"]')
                ? rect('.title-row__watch[data-watching="true"]')
                : null,
              meta: rect('.title-row__meta'),
              priority: rect('.title-row__watch'),
              date: rect('.title-row__date'),
              footer: rect('.title-row__footer'),
            };
          }),
        );
        expect(geometry.filter((card) => card.watching !== null)).toHaveLength(2);
        for (const card of geometry) {
          if (card.watching !== null) {
            expect(card.watching.y).toBeLessThan(card.name.y);
            expect(card.watching.y).toBeCloseTo(card.priority.y, 0);
          }
        }
        for (const top of new Set(geometry.map((card) => card.top))) {
          const siblings = geometry.filter((card) => card.top === top);
          expect(siblings.length).toBe(width >= 1024 ? 3 : 2);
          for (const part of ['meta', 'priority', 'date', 'footer'] as const) {
            const positions = siblings.map((card) => card[part].y);
            expect(Math.max(...positions) - Math.min(...positions), part).toBeLessThan(1);
          }
          const heights = siblings.map((card) => card.footer.height);
          expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(1);
          const watchingPositions = siblings.flatMap((card) =>
            card.watching === null ? [] : [card.watching.y],
          );
          if (watchingPositions.length > 1) {
            expect(Math.max(...watchingPositions) - Math.min(...watchingPositions)).toBeLessThan(1);
          }
        }
        await expect(page.getByTestId('poster-placeholder')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Find a match', exact: true })).toBeVisible();
        await noOverflow(page);
        await page.screenshot({ path: testInfo.outputPath('aligned-catalog.png'), fullPage: true });
      });
    });
  }
}

for (const width of [390, 1024, 1440]) {
  describe(`Mockup catalog at ${width}px`, () => {
    test('T-MOCK-002: sidebar, service chips and poster cards form an accessible catalog', async ({
      page,
    }, testInfo) => {
      await mountLibrary(page, { width, varied: true });
      const content = await bounds(page.locator('.app-shell__content'));
      const navigation = await bounds(page.getByRole('navigation'));
      if (width >= 1024) {
        expect(navigation.x + navigation.width).toBeLessThan(content.x);
        const links = page.getByRole('navigation').getByRole('link');
        const first = await bounds(links.nth(0));
        const second = await bounds(links.nth(1));
        expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
        // The sidebar lists every destination directly; there is no Menu drawer at this width.
        await expect(
          page.getByRole('navigation').getByRole('link', { name: 'About' }),
        ).toBeVisible();
        await expect(
          page.getByRole('navigation').getByRole('button', { name: 'Menu' }),
        ).toHaveCount(0);
        for (const row of await page.locator('li.title-row').all()) {
          const poster = await bounds(row.locator('.title-row__poster'));
          const priority = await bounds(row.locator('.title-row__watch'));
          expect(priority.y).toBeGreaterThanOrEqual(poster.y);
          expect(priority.y + priority.height).toBeLessThan(poster.y + poster.height);
        }
      } else {
        /*
         * TASK-255: the phone nav is the mockup's bottom tab bar — fixed to the
         * viewport's foot, over the scrolling content, with Library its one link.
         * ~~Superseded: "the nav ends above the content and holds no links".~~
         */
        const viewport = page.viewportSize();
        if (!viewport) throw new Error('Expected an explicit viewport');
        expect(navigation.y).toBeGreaterThan(content.y);
        expect(navigation.y + navigation.height).toBeLessThanOrEqual(viewport.height + 1);
        await expect(page.getByRole('navigation').getByRole('link')).toHaveText(['Library']);
      }
      expect(
        await page
          .getByRole('heading', { level: 1 })
          .evaluate((el) => getComputedStyle(el).fontFamily),
      ).toContain('Georgia');
      const services = page.getByRole('group', { name: 'Filter by streaming service' });
      for (const button of await services.getByRole('button').all()) {
        await button.focus();
        await expect(button).toBeFocused();
        await expect
          .poll(async () => {
            const rect = await bounds(button);
            return rect.x + rect.width;
          })
          .toBeLessThanOrEqual(width);
        const rect = await bounds(button);
        expect(rect.height).toBeGreaterThanOrEqual(44);
        expect(rect.width).toBeGreaterThanOrEqual(44);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width);
      }
      await services.getByRole('button', { name: 'Netflix' }).click();
      await expect(services.getByRole('button', { name: 'Netflix' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.getByTestId('filters-trigger').click();
      // TASK-255: the phone sheet shows the service checkboxes directly.
      if (width >= 640) await page.getByRole('button', { name: /^Services/ }).click();
      await expect(page.getByRole('checkbox', { name: 'Netflix' })).toBeChecked();
      await page.getByRole('button', { name: 'Close filters', exact: true }).click();
      await services.getByRole('button', { name: 'All services' }).click();
      await noOverflow(page);
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('mockup-library.png'), fullPage: true });
    });
  });
}

for (const width of [640, 1024, 1440]) {
  describe(`Artwork composition at ${width}px`, () => {
    test('T-MOCK-004b: compact cards overlay artwork, retain facts and grow for full titles', async ({
      page,
    }, testInfo) => {
      await mountLibrary(page, { width, singleService: true, brightArtwork: true });
      await page.screenshot({ path: testInfo.outputPath('artwork-cards.png'), fullPage: true });
      const row = page.locator('li.title-row').first();
      const card = await bounds(row);
      const poster = await bounds(row.getByTestId('poster'));
      const heading = await bounds(row.getByTestId('title-name'));
      const facts = await bounds(row.locator('.title-row__facts'));
      const genres = await bounds(row.locator('.genre-chips'));
      const rating = await bounds(row.getByTestId('imdb-rating'));
      const date = await bounds(row.getByTestId('date-added-label'));
      const badges = await bounds(row.getByTestId('badges'));
      expect(card.height / card.width).toBeLessThanOrEqual(2.1);
      expect(heading.y).toBeGreaterThan(poster.y);
      expect(heading.y + heading.height).toBeLessThanOrEqual(poster.y + poster.height);
      expect(facts.y).toBeGreaterThanOrEqual(heading.y + heading.height);
      expect(rating.y).toBeGreaterThanOrEqual(genres.y - 1);
      expect(rating.y).toBeLessThan(genres.y + genres.height);
      expect(badges.x + badges.width).toBeLessThanOrEqual(date.x);
      expect(Math.abs(date.y + date.height - badges.y - badges.height)).toBeLessThan(1);
      await expect(row.getByTestId('date-added-label')).toHaveAttribute(
        'title',
        TITLES[0]?.dateAddedLabel ?? '',
      );
      await expect(row.getByTestId('date-added-label').locator('[aria-hidden="true"]')).toHaveText(
        'Added 16 Sep 2026',
      );
      expect(Math.abs(rating.y - genres.y)).toBeLessThanOrEqual(1);
      expect(
        await row
          .getByTestId('title-name')
          .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
      ).toBe(18);
      expect(
        await row
          .locator('.title-row__body')
          .evaluate((el) => getComputedStyle(el).backgroundImage),
      ).toContain('0.75');
      for (const selector of ['.title-row__priority', '[data-testid="row-menu"]']) {
        expect(
          await row.locator(selector).evaluate((el) => getComputedStyle(el).backgroundColor),
        ).toContain('0.85');
      }
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(scan.violations).toEqual([]);
      await noOverflow(page);

      const suffix = ' and the extraordinary journey beyond the distant mountains'.repeat(4);
      await page.unrouteAll({ behavior: 'wait' });
      await mountLibrary(page, { width, titleSuffix: suffix, allServices: true });
      await page.screenshot({
        path: testInfo.outputPath('long-artwork-cards.png'),
        fullPage: true,
      });
      await expect(row.getByTestId('title-name')).toHaveText(`${TITLES[0]?.name ?? ''}${suffix}`);
      expect((await bounds(row)).height).toBeGreaterThan(card.height);
      for (const item of await page.locator('li.title-row').all()) {
        const outer = await bounds(item);
        const title = await bounds(item.getByTestId('title-name'));
        const facts = await bounds(item.locator('.title-row__facts'));
        expect(facts.y).toBeGreaterThanOrEqual(title.y + title.height);
        for (const selector of ['.title-row__name', '.title-row__meta', '.title-row__footer']) {
          const part = item.locator(selector);
          const box = await bounds(part);
          expect(box.y + box.height).toBeLessThanOrEqual(outer.y + outer.height);
          expect(await part.evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
        }
      }
      await noOverflow(page);
      await page.getByRole('button', { name: 'Compact view', exact: true }).click();
      const compactPoster = await bounds(row.getByTestId('poster'));
      expect(compactPoster.width).toBe(72);
      expect(compactPoster.height).toBe(108);
      await expect(row.getByTestId('title-name')).toHaveText(`${TITLES[0]?.name ?? ''}${suffix}`);
      await noOverflow(page);
    });
  });
}

for (const width of [390, 1280, 1440]) {
  describe(`Library composition at ${width}px`, () => {
    test('T-MOCK-005: search and quick filters share URL state without crowding library actions', async ({
      page,
    }, testInfo) => {
      testInfo.setTimeout(60_000);
      await mountLibrary(page, { width });
      await page.screenshot({ path: testInfo.outputPath('library-header.png'), fullPage: true });
      const add = page.getByTestId('add-title-open');
      await add.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(add).toBeFocused();
      await page.getByRole('button', { name: 'Service updates', exact: true }).click();
      await expect(page.getByText('Netflix updated today', { exact: true })).toBeVisible();
      await checkServiceUpdates(page);
      const quick = page.getByRole('group', { name: 'Quick filters' });
      const input = page.getByRole('searchbox', { name: 'Search your library' });
      if (width >= 1280) {
        await expect(input).toBeVisible();
        await expect(page.getByRole('button', { name: 'Close search', exact: true })).toBeHidden();
        await expect(quick).toBeVisible();
        const heading = await bounds(page.getByRole('heading', { level: 1 }));
        const search = await bounds(page.getByRole('search', { name: 'Search your library' }));
        const filters = await bounds(page.getByTestId('filters-trigger'));
        const actions = await bounds(page.locator('.library-actions'));
        const updates = await bounds(
          page.getByRole('button', { name: 'Service updates', exact: true }),
        );
        const addTitle = await bounds(page.getByTestId('add-title-open'));
        const quickBox = await bounds(quick);
        expect(search.x).toBeGreaterThanOrEqual(heading.x + heading.width);
        expect(Math.abs(search.y - filters.y)).toBeLessThan(1);
        expect(quickBox.x + quickBox.width).toBeLessThanOrEqual(actions.x);
        expect(Math.abs(updates.y - addTitle.y)).toBeLessThan(1);
        await quick.getByRole('button', { name: /^Type/ }).click();
        await quick.getByRole('checkbox', { name: 'Movie', exact: true }).click();
        await expect(quick.getByRole('checkbox', { name: 'Movie', exact: true })).toBeChecked();
        await expect(page).toHaveURL(/category=movie/);
        await page.getByTestId('filters-trigger').click();
        const dialog = page.getByRole('dialog', { name: 'Filter your library', exact: true });
        await dialog.getByRole('button', { name: /^Type/ }).click();
        await expect(dialog.getByRole('checkbox', { name: 'Movie', exact: true })).toBeChecked();
        await dialog.getByRole('checkbox', { name: 'Movie', exact: true }).click();
        await expect(
          dialog.getByRole('checkbox', { name: 'Movie', exact: true }),
        ).not.toBeChecked();
        await dialog.getByRole('button', { name: 'Close filters', exact: true }).click();
        await quick.getByRole('button', { name: /^Type/ }).click();
        await expect(quick.getByRole('checkbox', { name: 'Movie', exact: true })).not.toBeChecked();
        await page.keyboard.press('Escape');
        await quick.getByRole('button', { name: /^Status/ }).click();
        await quick.getByRole('checkbox', { name: 'Normal', exact: true }).click();
        await expect(quick.getByRole('checkbox', { name: 'Normal', exact: true })).toBeChecked();
        await page.getByTestId('filters-trigger').click();
        await dialog.getByRole('button', { name: /^Status/ }).click();
        await expect(dialog.getByRole('checkbox', { name: 'Normal', exact: true })).toBeChecked();
        await dialog.getByRole('button', { name: 'Close filters', exact: true }).click();
        await quick.getByRole('button', { name: /^Status/ }).click();
        await expect(quick.getByRole('checkbox', { name: 'Normal', exact: true })).toBeChecked();
        await quick.getByRole('checkbox', { name: 'Normal', exact: true }).click();
        await expect(
          quick.getByRole('checkbox', { name: 'Normal', exact: true }),
        ).not.toBeChecked();
        await page.keyboard.press('Escape');
      } else {
        await expect(quick).toBeHidden();
        await expect(input).toBeHidden();
        // TASK-255: on the phone the tab bar's Search tab opens the field.
        await page.getByTestId(width < 640 ? 'tab-search' : 'list-search-trigger').click();
      }
      await input.fill('Orbit');
      expect(new URL(page.url()).searchParams.has('q')).toBe(false);
      await input.press('Enter');
      await expect(page).toHaveURL(/q=Orbit/);
      await expect(page.getByTestId('title-name')).toHaveText(['Quiet Orbit']);
      await noOverflow(page);
      await page.getByRole('button', { name: 'Clear search', exact: true }).click();
      await expect(page.getByTestId('title-name')).toHaveCount(TITLES.length);
      await expect(input).toBeFocused();
      await page.goBack();
      await expect(input).toHaveValue('Orbit');
      await expect(page.getByTestId('title-name')).toHaveText(['Quiet Orbit']);
      await noOverflow(page);
    });
  });
}

test('T-POL-003c: catalog surfaces and artwork stay consistent in both layouts with reduced motion', async ({
  page,
}, testInfo) => {
  await mountLibrary(page, { width: 1280, allServices: true, varied: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const view of ['Grid', 'Compact']) {
    await page.getByRole('button', { name: `${view} view`, exact: true }).click();
    await expect(page.getByTestId('title-list')).toHaveAttribute('data-view', view.toLowerCase());
    const rows = page.locator('li.title-row');
    // Even the reduced-motion 0.01ms transition needs its first animation frame.
    for (const poster of await rows.locator('.title-row__poster').all()) {
      const { width, height } = await bounds(poster);
      if (view === 'Compact') {
        expect(width).toBe(72);
        expect(height).toBe(108);
      } else {
        expect(width).toBeGreaterThanOrEqual(192);
        expect(height / width).toBeCloseTo(1.5, 2);
        const row = await bounds(poster.locator('..'));
        expect(row.width - width).toBeLessThanOrEqual(2);
      }
    }
    const appearance = await rows.first().evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        image: style.backgroundImage,
        transform: style.transform,
        durations: style.transitionDuration.split(',').map(Number.parseFloat),
      };
    });
    expect(appearance.image).toBe('none');
    expect(appearance.transform).toBe('none');
    expect(appearance.durations.every((duration) => duration <= 0.00001)).toBe(true);
    const control = rows.first().getByRole('button', { name: /^Watch status for/ });
    await control.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(control).toBeFocused();
    expect(await control.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe(
      'none',
    );
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`premium-${view}.png`), fullPage: true });
  }
});

test('T-UX-147a: compact rows line their ratings, badges and priority controls up as columns', async ({
  page,
}) => {
  await mountLibrary(page, { width: 1280 });
  await page.getByRole('button', { name: 'Compact view' }).click();
  await expect(page.getByTestId('title-list')).toHaveAttribute('data-view', 'compact');
  /*
   * ⚠ EVERY ROW IS ITS OWN GRID CONTAINER. There is no shared track sizing
   * between cards, so a content-sized column lands at a different offset in
   * every row — which is exactly what the owner saw. Reading the left edge of
   * the same part of each row is the only way to prove the columns are real.
   */
  for (const part of ['.title-row__rating', '.title-row__badges', '.title-row__watch']) {
    const lefts = await page
      .locator(`li.title-row ${part}`)
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().left)));
    expect(lefts.length).toBeGreaterThan(1);
    expect(new Set(lefts).size).toBe(1);
  }
  await noOverflow(page);
});

test('T-UX-155c: library frame, priority geometry and portrait artwork stay intentional across widths', async ({
  page,
}, testInfo) => {
  await mountLibrary(page, { allServices: true, varied: true });
  for (const width of [280, 390, 900, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    for (const view of ['Grid', 'Compact']) {
      await page.getByRole('button', { name: `${view} view`, exact: true }).click();
      const list = page.getByTestId('title-list');
      expect((await bounds(list)).width).toBeLessThanOrEqual(1248);
      const buttons = list.getByRole('button', { name: /^Watch status for/ });
      const geometry = await buttons.evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return {
            width: box.width,
            height: box.height,
            clientWidth: element.clientWidth,
            scrollWidth: element.scrollWidth,
          };
        }),
      );
      /*
       * TASK-255: the phone draws the mockup's content-sized status pills, so
       * uniform width is a wide-Compact property only; the 44 px height and
       * the no-clipping checks below still hold everywhere.
       * ~~Superseded: "`view === 'Compact' || width < 640` → one width".~~
       */
      if (view === 'Compact' && width >= 640) {
        expect(new Set(geometry.map((box) => box.width)).size).toBe(1);
      }
      for (const box of geometry) {
        expect(box.height, `${view} ${width}: priority control height`).toBe(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth);
      }
      for (const row of await list.locator('li.title-row').all()) {
        const poster = await bounds(row.locator('.title-row__poster'));
        expect(poster.width).toBeGreaterThanOrEqual(72);
        // TASK-255: the phone mockup crops artwork to a near-square 10:11.
        expect(poster.height / poster.width).toBeCloseTo(width < 640 ? 1.1 : 1.5, 1);
        const box = await bounds(row);
        for (const part of [
          // The phone dissolves the identity box (`display: contents`).
          width < 640 ? '.title-row__heading' : '.title-row__identity',
          '.title-row__watch',
          '.title-row__badges',
          '.title-row__date',
        ]) {
          const child = await bounds(row.locator(part));
          expect(child.x, `${view} ${width}: ${part} start`).toBeGreaterThanOrEqual(box.x);
          // 1 px for sub-pixel rounding: the phone row has no inline padding,
          // so its end column finishes exactly on the row's edge.
          expect(child.x + child.width, `${view} ${width}: ${part} end`).toBeLessThanOrEqual(
            box.x + box.width + 1,
          );
        }
      }
      const overlaps = await list.locator('li.title-row').evaluateAll((rows) =>
        rows.flatMap((row) => {
          const button = row.querySelector('.title-row__actions button');
          if (!button) throw new Error('Missing row action');
          const action = button.getBoundingClientRect();
          return [
            ...row.querySelectorAll(
              '.title-row__heading > *, .title-row__status > *, .title-row__meta, .title-row__watch, .title-row__badges, .title-row__date',
            ),
          ]
            .filter((content) => {
              const child = content.getBoundingClientRect();
              return (
                child.left < action.right &&
                child.right > action.left &&
                child.top < action.bottom &&
                child.bottom > action.top
              );
            })
            .map((content) => content.textContent);
        }),
      );
      expect(overlaps, `${view} ${width}: content overlaps row action`).toEqual([]);
      await noOverflow(page);
      if ([390, 1280].includes(width)) {
        await testInfo.attach(`library-${view}-${width}`, {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png',
        });
      }
    }
  }
});

test('T-UX-147b: Filters, the result count, the order and reverse share one phone line', async ({
  page,
}) => {
  /*
   * TASK-255 — REDEFINED IN PLACE for the owner's phone mockup. The Filters
   * tool moved up beside *My Library* and the count sits under the heading,
   * so "one line" is now two: the heading line (heading, count block and its
   * tools) and the toolbar line (order, reverse and the view switch). The
   * point is unchanged: no control is pushed to a half-empty line of its own.
   * ~~Superseded: "Filters, the count, the order and reverse share ONE line".~~
   */
  const sameRow = (a: { y: number; height: number }, b: { y: number; height: number }) =>
    a.y < b.y + b.height && b.y < a.y + a.height;
  for (const width of [360, 390, 430]) {
    await mountLibrary(page, { width });
    const title = await bounds(page.locator('.library-heading__title'));
    const filters = await bounds(page.getByTestId('filters-trigger'));
    expect(sameRow(title, filters)).toBe(true);
    const toolbar = [
      await bounds(page.getByTestId('sort-trigger')),
      await bounds(page.getByTestId('sort-reverse')),
      await bounds(page.locator('.list-view-control')),
    ];
    for (const box of toolbar) {
      for (const other of toolbar) expect(sameRow(box, other)).toBe(true);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    /* The count is the answer to "why is my list short" — it is never cut. */
    const count = page.locator('.library-heading__count');
    await expect(count).toHaveText(/^\d+ titles?$/);
    expect(await count.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.getByTestId('filter-count')).toHaveText(/^Showing \d+ of \d+$/);
    await usableTarget(page, page.getByTestId('sort-reverse'));
    await noOverflow(page);
  }
});

test('T-UX-147d: below the one-line width the toolbar reflows instead of overflowing', async ({
  page,
}) => {
  /*
   * ⚠ THE FLOOR IS A REQUIREMENT, NOT A ROUNDING ERROR. Four controls plus a
   * 44 px reverse target do not fit one line at 320 px — the first attempt
   * pushed the reverse button 11 px off a 280 px screen (`T-A11Y-015a`). The
   * single line is therefore a `min-width` enhancement, and this case pins the
   * behaviour underneath it: everything stays on screen and reachable.
   */
  for (const width of [280, 320]) {
    await mountLibrary(page, { width });
    await noOverflow(page);
    await usableTarget(page, page.getByTestId('sort-reverse'));
    await expect(page.getByTestId('filter-count')).toHaveText(/^Showing \d+ of \d+$/);
    for (const id of ['filters-trigger', 'sort-trigger', 'sort-reverse']) {
      const box = await bounds(page.getByTestId(id));
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
  }
});

test('T-UX-147c: a phone compact row flows instead of stacking, and stays inside the screen', async ({
  page,
}) => {
  await mountLibrary(page, { width: 390 });
  const rows = page.locator('li.title-row');
  const grid = await rows.first().boundingBox();
  await page.getByRole('button', { name: 'Compact view' }).click();
  await expect(page.getByTestId('title-list')).toHaveAttribute('data-view', 'compact');
  const compact = await rows.first().boundingBox();
  if (grid === null || compact === null) throw new Error('Expected measurable rows');
  expect(compact.height).toBeLessThan(grid.height);
  /*
   * ⚠ `.title-row__body` is a COLUMN flex by default, and wrapping a column
   * flex wraps into new COLUMNS — which pushed the priority control and the
   * meta line off the right of the screen while every jsdom test stayed green.
   * The rating sharing the priority control's line is what proves the row
   * flows across, and the overflow check is what proves it flows the right way.
   */
  /*
   * TASK-255 — REDEFINED IN PLACE for the owner's phone mockup: the row is
   * title-beside-pill, then the facts line, then rating beside the service
   * marks. Rating and marks sharing ONE line, left to right, is what now
   * proves the row flows across instead of wrapping into columns.
   * ~~Superseded: "the rating shares the priority control's line".~~
   */
  const first = rows.first();
  const rating = await bounds(first.locator('.title-row__rating'));
  const marks = await bounds(first.getByTestId('badges'));
  const facts = await bounds(first.getByTestId('title-meta'));
  const watch = await bounds(first.locator('.title-row__watch'));
  expect(rating.y).toBeGreaterThanOrEqual(facts.y + facts.height - 1);
  expect(rating.y).toBeLessThan(marks.y + marks.height);
  expect(marks.y).toBeLessThan(rating.y + rating.height);
  expect(marks.x).toBeGreaterThan(rating.x + rating.width);
  expect(marks.x + marks.width).toBeLessThanOrEqual(390 + 1);
  expect(watch.x + watch.width).toBeLessThanOrEqual(390 + 1);
  await noOverflow(page);
});

test('T-UX-147e: filter trigger labels stay on one line inside the filters panel at every width', async ({
  page,
}) => {
  /*
   * ⚠ The filters live inside `.dialog--panel`, which is capped at 26rem, so
   * the VIEWPORT width says nothing about the room they have. A viewport
   * media query once widened the grid to six columns at 1024px, which put six
   * controls into ~400px and wrapped every label to one character per line —
   * visible only on the big screen, while 320px stayed correct. The wide
   * widths here are the point of the test.
   */
  /*
   * TASK-255: below `--bp-sm` there is no panel of triggers — the phone sheet
   * of chips replaces it (`T-PHONE-007`) — so the narrowest panel width
   * measured here is the panel's own floor, 640 px.
   * ~~Superseded: `[390, 768, 1280, 1600]`.~~
   */
  for (const width of [640, 768, 1280, 1600]) {
    await mountLibrary(page, { width });
    const dialog = await openFiltersPanel(page);
    const fields = dialog.locator('.filter-disclosure[data-filter-field]');
    const count = await fields.count();
    expect(count).toBeGreaterThan(1);
    for (let index = 0; index < count; index += 1) {
      const field = fields.nth(index);
      const label = field.locator('.filter-disclosure__label');
      /* Not wrapped: the label's laid-out width is its full text width. */
      const overflow = await label.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, `label ${String(index)} at ${String(width)}px`).toBeLessThanOrEqual(1);
      const box = await bounds(field.locator('.btn'));
      expect(box.width, `trigger ${String(index)} at ${String(width)}px`).toBeGreaterThanOrEqual(
        96,
      );
    }
    /*
     * The popover must open inside the panel, not off its edge — the
     * column-alignment rule is keyed to the column count and silently points
     * at the wrong column when that count changes.
     */
    const dialogBox = await bounds(dialog);
    for (const index of [0, 1]) {
      await fields.nth(index).locator('.btn').click();
      const popover = dialog.locator('.filter-disclosure__panel:visible');
      const popoverBox = await bounds(popover);
      expect(popoverBox.x + popoverBox.width).toBeLessThanOrEqual(width + 1);
      expect(popoverBox.x).toBeGreaterThanOrEqual(0);
      if (width >= 640) {
        expect(popoverBox.x).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1);
      }
      /*
       * ⚠ Dismiss with the popover's own Done, not Escape: Escape here closes
       * the whole filters dialog, not just the disclosure, and the next
       * iteration would then be measuring nothing.
       */
      await popover.getByRole('button', { name: 'Done', exact: true }).click();
    }
    await noOverflow(page);
  }
});

test('T-UX-147f: tapping a filter checkbox ticks it and leaves the popover open', async ({
  page,
}, testInfo) => {
  /*
   * ⚠ THIS CASE ONLY FAILS UNDER A REAL TAP, WHICH IS WHY IT SURVIVED SO LONG.
   *
   * WebKit does not focus a checkbox, radio or button when it is TAPPED —
   * focus drops onto `div.dialog--panel`, the dialog's `tabIndex={-1}` focus
   * container. `FilterDisclosure` read any focus outside itself as the owner
   * tabbing away and closed, so on a phone every filter shut on the very tap
   * that ticked a box and behaved as though Done had been pressed. The
   * existing helpers use `dispatchEvent('click')`, which never moves focus at
   * all and so can never see this.
   */
  const touch = testInfo.project.name === 'mobile-safari';
  /*
   * TASK-255: at 390 px the filters are the phone sheet, whose chips ARE the
   * checkboxes. The same defect would shut the sheet on the tap that ticks a
   * chip, so the phone half asserts exactly that; the disclosure half below
   * runs at 640 px, the narrowest width that still has disclosures.
   */
  await mountLibrary(page, { width: 390, allServices: true });
  const sheet = await openFilterSheet(page);
  const sheetBox = sheet.getByRole('checkbox', { name: 'Max', exact: true });
  if (touch) await sheetChip(sheetBox).tap();
  else await sheetChip(sheetBox).click();
  await expect(sheet).toBeVisible();
  await expect(sheetBox).toBeChecked();
  await expect.poll(() => new URL(page.url()).searchParams.getAll('service')).toContain('max');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  await mountLibrary(page, { width: 640, allServices: true });
  const dialog = await openFiltersPanel(page);
  const field = dialog.locator('.filter-disclosure[data-filter-field]').first();
  const openTrigger = field.locator('.btn');
  if (touch) await openTrigger.tap();
  else await openTrigger.click();

  const popover = dialog.locator('.filter-disclosure__panel:visible');
  await expect(popover).toBeVisible();

  /*
   * On a touch device the popover must NOT open with a text field focused:
   * that raises the on-screen keyboard over the very checkboxes it contains.
   * On a desktop pointer, focusing the search box is free and is kept.
   */
  const focusedTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
  if (touch) expect(focusedTag).not.toBe('INPUT');

  const box = popover.locator('input[type="checkbox"]').first();
  if (touch) await box.tap();
  else await box.click();

  await expect(popover).toBeVisible();
  await expect(box).toBeChecked();

  /*
   * The second half of the fix, exercised directly. Focus parking on a
   * `tabIndex={-1}` container OUTSIDE the picker — which is precisely where
   * WebKit put it before the panel became focusable — must not read as the
   * owner navigating away.
   */
  await dialog.evaluate((el: HTMLElement) => {
    el.focus();
  });
  await expect(popover).toBeVisible();

  /*
   * Moving focus to a genuinely tabbable control OUTSIDE the picker still
   * closes it — the guard narrows the rule to `tabIndex >= 0`, it does not
   * remove it. The panel's own Done button is such a control.
   */
  await dialog
    .locator('.panel-foot')
    .getByRole('button', { name: 'Done', exact: true })
    .evaluate((el: HTMLElement) => {
      el.focus();
    });
  await expect(dialog.locator('.filter-disclosure__panel:visible')).toHaveCount(0);
});

/**
 * `T-UX-147g` — the toolbar does not waste rows when a filter is active.
 *
 * The owner, with one service filter on a phone: *"this is what the home page
 * looks like when a filter is selected. so much wasted space."* The screenshot
 * showed five toolbar rows, three of them more than half empty, ending 641 px
 * down an 844 px screen.
 *
 * Two independent causes, both measured before the fix:
 *
 *  1. A duplicate `.active-filters { flex-basis: 100% }` made the chip list
 *     claim the whole line (`w=340` for one ~110 px chip), so `Clear filters`
 *     wrapped under it — one active filter cost two rows.
 *  2. The toolbar parts were placed by COLUMN with the row left to grid
 *     auto-placement. The cursor only moves forward, so the full-width chips
 *     row — which exists ONLY when a filter is active — pushed the count and
 *     the sort control off the Filters trigger's line for good.
 *
 * ⚠ **THE FILTERED CASE IS THE CASE.** Cause 2 is invisible without a chip
 * row, so a measurement of the default toolbar passes on the broken build.
 * `T-UX-147b` does exactly that, which is why it never caught this.
 *
 * ⚠ Rows are derived from measured geometry, not from a height total. A single
 * height assertion would pass again the moment some unrelated control got
 * shorter, while the empty half-rows stayed.
 */
test('T-UX-147g: with a filter active the toolbar rows are full, not half empty', async ({
  page,
}) => {
  await mountLibrary(page, { width: 390, url: '/?service=netflix' });

  const chip = page.locator('.active-filter');
  await expect(chip).toHaveCount(1);

  const trigger = await bounds(page.getByTestId('filters-trigger'));
  const count = await bounds(page.getByTestId('filter-count'));
  const sort = await bounds(page.locator('.sort-control-group'));
  const chipBox = await bounds(chip);
  const clear = await bounds(page.getByTestId('clear-filters'));
  const view = await bounds(page.locator('.list-view-control'));

  /** Two boxes share a visual row when their vertical spans overlap. */
  const sameRow = (a: typeof trigger, b: typeof trigger): boolean =>
    a.y < b.y + b.height && b.y < a.y + a.height;

  /*
   * TASK-255 — REDEFINED IN PLACE for the owner's phone mockup. Filters and
   * the count moved up into the heading, so the controls row is now the
   * order beside the view switch; the heading keeps Filters on its line.
   * ~~Superseded: "The controls row is ONE row: Filters, the count and the
   * order together" (`sameRow(trigger, count)`, `sameRow(trigger, sort)`).~~
   */
  const heading = await bounds(page.locator('.library-heading__title'));
  expect(count.width).toBeLessThanOrEqual(1); // the live count is sr-only here
  expect(sameRow(heading, trigger)).toBe(true);
  expect(sameRow(sort, view)).toBe(true);

  // The chips row is ONE row: the chip and the control that clears it.
  expect(sameRow(chipBox, clear)).toBe(true);

  // ...and they are genuinely different rows, so the assertions above are not
  // passing because everything happens to overlap everything.
  expect(sameRow(trigger, chipBox)).toBe(false);
  expect(sameRow(chipBox, view)).toBe(false);

  /*
   * ⚠ THE BUDGET IS A CEILING ON A MEASUREMENT, NOT A PIN. Before the fix this
   * was 357 px; it is 253 px now. The margin is deliberately loose — the point
   * is that a regression to five rows (~100 px more) fails, while a font or
   * padding tweak of a few pixels does not.
   */
  const toolbar = await bounds(page.getByTestId('list-controls'));
  expect(toolbar.height).toBeLessThan(300);

  await noOverflow(page);
});

/**
 * `T-TOOLBAR-003` — the restyled library toolbar (issue 370) at every width.
 *
 * The mockup made the controls one visual family: an iconed search field with
 * a keyboard hint, an iconed Filters button, a connected Grid/Compact switch
 * and a "Sort: ..." dropdown. The restyle must not cost a hit target, overflow
 * a phone, or leave the keyboard hint on a device that has no keyboard.
 */
describe('T-TOOLBAR-003 library toolbar', () => {
  for (const width of [1280, 640, 390, 320]) {
    describe(`at ${width}px`, () => {
      test('T-TOOLBAR-003a: one control family, usable at every width, with a truthful shortcut', async ({
        page,
      }, testInfo) => {
        await mountLibrary(page, { width });
        const controls = page.getByTestId('list-controls');
        const filters = page.getByTestId('filters-trigger');
        const sort = page.getByTestId('sort-trigger');
        const grid = page.getByRole('button', { name: 'Grid view', exact: true });
        const compact = page.getByRole('button', { name: 'Compact view', exact: true });
        const search = page.getByRole('searchbox', { name: 'Search your library', exact: true });
        const hint = page.getByTestId('list-search-shortcut');

        await expect(filters.locator('svg')).toHaveAttribute('aria-hidden', 'true');
        await expect(sort).toHaveText(/^Sort: .+/);
        // Below 640px the visible "Sort:" prefix gives way to the order itself.
        const prefix = sort.locator('.sort-trigger-prefix');
        if (width >= 640) await expect(prefix).toBeVisible();
        else await expect(prefix).toBeHidden();
        // Same floor as `usableTarget`, but with its 1 px edge tolerance applied
        // to the viewport check too: WebKit on Linux lays the end control out
        // a sub-pixel past the edge (ratio 0.998), which is rounding, not clipping.
        const viewport = page.viewportSize();
        if (!viewport) throw new Error('Expected an explicit viewport');
        for (const control of [filters, sort, page.getByTestId('sort-reverse'), grid, compact]) {
          const box = await bounds(control);
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
          expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
          await expect(control).toBeInViewport({ ratio: 0.99 });
        }
        await noOverflow(page);

        const keyboard = width >= 1280 && testInfo.project.name === 'chromium';
        if (keyboard) {
          await expect(hint).toBeVisible();
          await expect(hint).toContainText('K');
          const heights = await Promise.all(
            [search, filters, grid, compact, sort].map(async (item) => (await bounds(item)).height),
          );
          for (const height of heights)
            expect(Math.abs(height - (heights[0] ?? 0))).toBeLessThanOrEqual(1);
        } else {
          await expect(hint).toBeHidden();
        }

        // The pressed layout is marked by more than colour: an inset bar.
        const shadow = (locator: Locator) =>
          locator.evaluate((el) => getComputedStyle(el).boxShadow);
        await expect(grid).toHaveAttribute('aria-pressed', 'true');
        expect(await shadow(grid)).toContain('inset');
        expect(await shadow(compact)).not.toContain('inset');
        await compact.click();
        await expect(compact).toHaveAttribute('aria-pressed', 'true');
        expect(await shadow(compact)).toContain('inset');
        await noOverflow(page);

        await sort.focus();
        await page.keyboard.press('Enter');
        const panel = page
          .getByRole('dialog', { name: 'Sort your library', exact: true })
          .getByTestId('sort-control');
        await horizontallyBounded(page, panel, width);
        await page.keyboard.press('Escape');
        await expect(sort).toBeFocused();

        await page.locator('body').click({ position: { x: 1, y: 1 } });
        await page.keyboard.press(
          testInfo.project.name === 'mobile-safari' ? 'Meta+K' : 'Control+K',
        );
        await expect(search).toBeFocused();
        await expect(search).toHaveAttribute('placeholder', 'Search titles');
        await expect(hint).toBeHidden();
        await noOverflow(page);

        expect(
          (await new AxeBuilder({ page }).include('[data-testid="list-controls"]').analyze())
            .violations,
        ).toEqual([]);
        await expect(controls).toBeVisible();
      });
    });
  }
});

test('T-UX-168f: at 1280px the quick-filter dropdowns are named pills with aligned option grids and a ticked slider', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await mountLibrary(page, { width: 1280 });
  const quick = page.getByRole('group', { name: 'Quick filters' });
  for (const name of ['Type', 'Genre', 'Runtime', 'Status']) {
    const pill = quick.getByRole('button', { name, exact: true });
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText(name);
  }
  for (const name of ['Type', 'Genre', 'Status']) {
    await quick.getByRole('button', { name, exact: true }).click();
    const panel = quick.locator('.filter-disclosure__panel:visible');
    const outer = await bounds(panel);
    const options = await panel.locator('label:has(.input--choice)').all();
    expect(options.length).toBeGreaterThan(1);
    const columns = new Set<number>();
    for (const option of options) {
      const box = await bounds(option);
      columns.add(Math.round(box.x));
      // One line each: no option wraps or spills out of the panel.
      expect(box.height).toBeLessThanOrEqual(48);
      expect(box.x + box.width).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
    }
    expect(columns.size).toBeLessThanOrEqual(2);
    await page.screenshot({ path: testInfo.outputPath(`quick-${name}.png`) });
    await page.keyboard.press('Escape');
  }
  await quick.getByRole('button', { name: 'Status', exact: true }).click();
  await quick.getByRole('checkbox', { name: 'Watching', exact: true }).click();
  await quick.getByRole('checkbox', { name: 'Up next', exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll('status'))
    .toEqual(['watching', 'up-next']);
  await page.keyboard.press('Escape');
  const status = quick.getByRole('button', { name: 'Status 2 selected', exact: true });
  await expect(status).toHaveAttribute('data-active', 'true');
  await quick.getByRole('button', { name: 'Runtime', exact: true }).click();
  const ticks = quick.locator('.range-slider__tick');
  await expect(ticks).toHaveCount(6);
  const first = await bounds(ticks.first());
  const last = await bounds(ticks.last());
  expect(first.height).toBeGreaterThan(0);
  expect(last.x).toBeGreaterThan(first.x);
  await page.screenshot({ path: testInfo.outputPath('quick-runtime.png') });
  await page.keyboard.press('Escape');
  await noOverflow(page);
});

test('T-UX-169b: dragging a runtime handle previews without refetching, keeps the panel still and commits once on release', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await mountLibrary(page, { width: 1280 });
  const quick = page.getByRole('group', { name: 'Quick filters' });
  await quick.getByRole('button', { name: 'Runtime', exact: true }).click();
  const panel = quick.locator('.filter-disclosure__panel:visible');
  const min = panel.getByRole('slider', { name: 'Minimum runtime' });
  const track = await bounds(panel.locator('.range-slider__track'));
  const y = track.y + track.height / 2;
  const at = (stop: number) => track.x + 8 + ((track.width - 16) * stop) / 5;

  const reads: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/titles') reads.push(request.url());
  });
  const before = await bounds(panel);

  await page.mouse.move(at(0), y);
  await page.mouse.down();
  for (const stop of [1, 2, 1, 2]) await page.mouse.move(at(stop), y, { steps: 4 });
  await expect(min).toHaveValue('2');
  expect(reads).toEqual([]);
  expect(new URL(page.url()).searchParams.getAll('runtime')).toEqual([]);
  await page.mouse.up();
  await expect
    .poll(() => new URL(page.url()).searchParams.getAll('runtime'))
    .toEqual(['60-90', '90-120', 'over120']);

  // The owner's report: sliding back to 0 moved the panel under the pointer.
  await page.mouse.move(at(2), y);
  await page.mouse.down();
  await page.mouse.move(at(0), y, { steps: 8 });
  const during = await bounds(panel);
  expect(Math.abs(during.x - before.x)).toBeLessThan(1);
  await page.mouse.up();
  await expect(min).toHaveValue('0');
  await expect.poll(() => new URL(page.url()).searchParams.getAll('runtime')).toEqual([]);
});

test('T-UX-169d: the page does not shift sideways while a filter change shows the short loading skeleton', async ({
  page,
}, testInfo) => {
  testInfo.setTimeout(60_000);
  await mountLibrary(page, { width: 1280, varied: true });
  // Headless browsers hide scrollbars, so the jolt itself cannot be seen here;
  // the engine must still ACCEPT the gutter rule, and nothing else may move.
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).scrollbarGutter),
  ).toBe('stable');
  const quick = page.getByRole('group', { name: 'Quick filters' });
  const sidebar = page.locator('.app-shell__header');
  const controls = page.getByTestId('list-controls');
  const before = { sidebar: await bounds(sidebar), controls: await bounds(controls) };

  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    (url) => url.pathname === '/api/titles' && url.searchParams.has('status'),
    async (route) => {
      await held;
      await route.fallback();
    },
  );
  await quick.getByRole('button', { name: 'Status', exact: true }).click();
  await quick.getByRole('checkbox', { name: 'Watching', exact: true }).click();
  await expect(page.getByTestId('list-loading')).toBeVisible();
  const during = { sidebar: await bounds(sidebar), controls: await bounds(controls) };
  expect(Math.abs(during.sidebar.x - before.sidebar.x)).toBeLessThan(0.5);
  expect(Math.abs(during.controls.x - before.controls.x)).toBeLessThan(0.5);
  expect(Math.abs(during.controls.width - before.controls.width)).toBeLessThan(0.5);
  release();
  await expect(page.getByTestId('list-loading')).toHaveCount(0);
});
