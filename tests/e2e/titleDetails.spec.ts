import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const { describe } = test;

const item = {
  titleId: 'detail-one',
  workIdentity: 'tmdb:movie:42',
  matchState: 'matched',
  name: 'The Lighthouse Garden and the Extraordinary Journey Home',
  mediaType: 'movie',
  releaseYear: 2024,
  genres: ['Drama'],
  runtimeMinutes: 112,
  posterPath: '/title-details-fixture.png',
  imdbRating: 7.8,
  watching: true,
  priority: 'up-next',
  listState: 'active',
  badges: [
    { service: 'netflix', listingId: 'listing-one', dateAdded: '2026-09-01' },
    { service: 'max', listingId: 'listing-two', dateAdded: '2026-09-01' },
  ],
  sortDateAdded: '2026-09-01',
  dateAddedLabel: 'Added to nextup on 1 Sep 2026',
  presentation: {
    status: 'available',
    data: {
      tmdbId: 42,
      mediaType: 'movie',
      overview: 'An invented story about a lighthouse garden. '.repeat(12),
      directors: ['Morgan Example'],
      creators: [],
      fetchedAt: '2026-09-22T00:00:00.000Z',
      cast: Array.from({ length: 12 }, (_, index) => ({
        name: `Actor ${index}`,
        character: `Character ${index} with a long descriptive name`,
      })),
    },
  },
};

async function mock(page: Page) {
  const writes: string[] = [];
  await page.route('https://image.tmdb.org/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAABAAAAAYCAIAAAB8wupbAAAAGklEQVR4nGMwcEggCTGMahjVMKphVANtNQAAhow4EORXJhAAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') writes.push(path);
    let json: unknown;
    switch (path) {
      case '/api/me':
        json = {
          ownerId: 'fixture-owner',
          displayName: 'Fixture',
          signOutUrl: '/.auth/logout',
          attribution: {},
        };
        break;
      case '/api/batches':
        json = { batches: [] };
        break;
      case '/api/titles':
        json = { items: [item], nextCursor: null, limit: 50, runtimeUnknownHidden: 0 };
        break;
      case '/api/titles/detail-one':
        json = item;
        break;
      case '/api/service-state':
        json = { services: [] };
        break;
      case '/api/suppressions':
      case '/api/removed':
        json = { items: [] };
        break;
      default:
        throw new Error(`Unexpected API request: ${request.method()} ${path}`);
    }
    await route.fulfill({ json });
  });
  return writes;
}

for (const width of [320, 768, 1440]) {
  describe(`details at ${width}px`, () => {
    test('T-DETAIL-006a: responsive details preserve complete text, accessible structure and modal context', async ({
      page,
    }, testInfo) => {
      const writes = await mock(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/titles/detail-one');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(item.name);
      const poster = page.locator('.title-details__poster');
      await expect
        .poll(() =>
          poster.evaluate((node) => node instanceof HTMLImageElement && node.naturalWidth > 0),
        )
        .toBe(true);
      const artwork = await poster.boundingBox();
      expect(artwork?.width).toBe(width < 640 ? 128 : 192);
      expect(artwork?.height).toBe(width < 640 ? 192 : 288);
      await expect(page.getByText(item.presentation.data.overview, { exact: true })).toBeVisible();
      await expect(page.getByText('Morgan Example')).toBeVisible();
      await page.getByRole('button', { name: 'Show all 12 cast members' }).click();
      await expect(page.getByText('Actor 11', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('title-details.png'), fullPage: true });
      const remove = page.getByRole('button', { name: 'Remove from list', exact: true });
      await remove.scrollIntoViewIfNeeded();
      await remove.click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(remove).toBeFocused();
      expect(writes).toEqual([]);
    });
  });
}

test('T-DETAIL-006b: title navigation, refresh and back retain filter, sort and Compact choices', async ({
  page,
}) => {
  const writes = await mock(page);
  const query = 'service=netflix&sort=name&dir=asc';
  await page.goto(`/?${query}`);
  await page.getByRole('button', { name: 'Compact view', exact: true }).click();
  const title = page.getByRole('link', { name: item.name });
  await title.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/titles\/detail-one$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(item.name);
  await page.reload();
  await page.getByRole('link', { name: 'Back to Your list' }).click();
  await expect(page).toHaveURL(new RegExp(`\\?${query}$`));
  await expect(page.getByTestId('title-list')).toHaveAttribute('data-view', 'compact');
  await page.getByRole('link', { name: item.name }).click();
  await page.goBack();
  await expect(page.getByTestId('title-list')).toHaveAttribute('data-view', 'compact');
  expect(writes).toEqual([]);
});
