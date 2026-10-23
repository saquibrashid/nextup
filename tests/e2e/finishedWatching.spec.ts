/**
 * `T-VIEWED-080` — the Finished watching flow and the Recently watched view in a
 * real browser at 280 px (US-074 AC-8). jsdom cannot see layout, so this is the
 * only place overflow and axe are asserted.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const { describe } = test;

const MOVIE = {
  titleId: 'fin-one',
  workIdentity: 'tmdb:movie:77',
  matchState: 'matched',
  name: 'The Lighthouse Garden and the Extraordinary Journey Home',
  mediaType: 'movie',
  category: 'movie',
  automaticCategory: 'movie',
  categoryOverride: null,
  releaseYear: 2024,
  genres: ['Drama'],
  runtimeMinutes: 112,
  posterPath: null,
  imdbRating: 7.8,
  watching: false,
  priority: 'normal',
  listState: 'active',
  badges: [{ service: 'netflix', listingId: 'listing-fin', dateAdded: '2026-09-01' }],
  sortDateAdded: '2026-09-01',
  dateAddedLabel: 'Added to nextup on 1 Sep 2026',
};

const HISTORY_ROW = {
  workIdentity: 'tmdb:tv:9',
  seasonNumber: 2,
  finished: true,
  watchedOn: '2026-09-20',
  rating: 4,
  titleName: 'A Remarkably Long Fixture Show Title For Narrow Screens',
  releaseYear: 2020,
  mediaType: 'tv',
  posterPath: null,
  titleId: null,
  imdbRatingTenths: 78,
  leftLibrary: true,
};

async function mock(page: Page): Promise<string[]> {
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() !== 'GET') writes.push(`${request.method()} ${path}`);
    let json: unknown;
    switch (path) {
      case '/api/me':
        json = {
          ownerId: 'o',
          displayName: 'Fixture',
          signOutUrl: '/.auth/logout',
          attribution: {},
        };
        break;
      case '/api/titles':
        json = { items: [MOVIE], nextCursor: null, limit: 50, runtimeUnknownHidden: 0 };
        break;
      case '/api/titles/fin-one/watched':
        json = {
          titleId: 'fin-one',
          workIdentity: MOVIE.workIdentity,
          mediaType: 'movie',
          inLibrary: true,
          hidden: false,
          perSeason: false,
          seasonsUnavailable: false,
          seasons: [],
          allAiredFinished: false,
          whole: null,
        };
        break;
      case '/api/titles/fin-one/finished':
        json = {
          titleId: 'fin-one',
          records: [
            {
              workIdentity: MOVIE.workIdentity,
              seasonNumber: 0,
              finished: true,
              watchedOn: null,
              rating: null,
            },
          ],
        };
        break;
      case '/api/watched':
        json = { items: [HISTORY_ROW], nextCursor: null, limit: 50 };
        break;
      case '/api/service-state':
        json = { services: [] };
        break;
      case '/api/batches':
        json = { batches: [] };
        break;
      case '/api/suppressions':
      case '/api/removed':
        json = { items: [] };
        break;
      case '/api/availability/review/summary':
        json = { count: 0 };
        break;
      default:
        throw new Error(`Unexpected API request: ${request.method()} ${path}`);
    }
    await route.fulfill({ json });
  });
  return writes;
}

/** Names every element that pokes out of the viewport so a failure is diagnosable. */
async function offenders(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const viewport = document.documentElement.clientWidth;
    return Array.from(document.querySelectorAll(sel)).flatMap((el) => {
      const box = el.getBoundingClientRect();
      return box.right > viewport + 1 || box.left < -1
        ? [`${el.tagName}.${el.className} ${Math.round(box.left)}..${Math.round(box.right)}`]
        : [];
    });
  }, selector);
}

for (const width of [280, 1024]) {
  describe(`Finished watching at ${width}px`, () => {
    test('T-VIEWED-080a: row menu → Finished watching → ask → Keep, with no overflow and no axe violations', async ({
      page,
    }) => {
      const writes = await mock(page);
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      await page.getByTestId('row-menu').first().click();
      await page.getByTestId('row-menu-finished').click();
      const dialog = page.getByTestId('finished-dialog');
      await expect(dialog).toBeVisible();
      await expect(page.getByRole('button', { name: 'Mark as finished' })).toBeVisible();
      expect(await offenders(page, '[role="dialog"], [role="dialog"] *')).toEqual([]);
      expect(
        (await new AxeBuilder({ page }).include('[role="dialog"]').analyze()).violations,
      ).toEqual([]);

      await page.getByRole('button', { name: 'Mark as finished' }).click();
      await expect(page.getByTestId('finished-ask')).toBeVisible();
      expect(await offenders(page, '[role="dialog"], [role="dialog"] *')).toEqual([]);
      // Nothing leaves the Library until the owner says so.
      expect(writes).toEqual(['POST /api/titles/fin-one/finished']);
      await page.getByTestId('finished-keep').click();
      expect(writes).toEqual(['POST /api/titles/fin-one/finished']);
    });

    test('T-VIEWED-080b: Recently watched keeps every row inside the viewport and passes axe', async ({
      page,
    }) => {
      await mock(page);
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/watched');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Recently watched');
      await expect(page.getByText('A Remarkably Long Fixture Show Title')).toBeVisible();
      expect(await offenders(page, 'main, main *')).toEqual([]);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    });
  });
}
