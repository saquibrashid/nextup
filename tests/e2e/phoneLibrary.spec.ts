/**
 * `T-PHONE-007` — the owner's mobile mockup for the library, in a real
 * browser (TASK-255).
 *
 * ⚠ **jsdom CANNOT SEE ANY OF THIS.** `phoneLibrary.spec.tsx` proves the
 * semantics; only a browser can prove the tab bar is fixed inside the
 * viewport, nothing overflows sideways, the row lays out as drawn and every
 * control is still a 44 px target.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const { beforeEach, describe } = test;

const ME = { ownerId: 'o_test', displayName: 'Saquib', email: 'owner@example.com' };

const TITLES = [
  {
    titleId: 't1',
    workIdentity: 'tmdb:tv:1',
    matchState: 'matched',
    name: 'Stranger Things: Tales from \u201985',
    mediaType: 'tv',
    releaseYear: 2026,
    genres: ['Animation', 'Sci-Fi'],
    runtimeMinutes: 29,
    posterPath: null,
    imdbRating: 5.8,
    priority: 'watching',
    badges: [{ service: 'netflix', listingId: 'n1', dateAdded: '2026-09-01' }],
    sortDateAdded: '2026-09-01',
    dateAddedLabel: 'Added 1 Sep 2026',
  },
  {
    titleId: 't2',
    workIdentity: 'tmdb:movie:2',
    matchState: 'matched',
    name: 'Dune: Part Two',
    mediaType: 'movie',
    releaseYear: 2024,
    genres: ['Sci-Fi', 'Adventure'],
    runtimeMinutes: 166,
    posterPath: null,
    imdbRating: 8.5,
    priority: 'someday',
    badges: [
      { service: 'max', listingId: 'm2', dateAdded: '2026-08-01' },
      { service: 'prime-video', listingId: 'p2', dateAdded: '2026-08-02' },
    ],
    sortDateAdded: '2026-08-01',
    dateAddedLabel: 'Added 1 Aug 2026',
  },
];

async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { items: [] };
    if (path === '/api/me') body = ME;
    else if (path === '/api/titles')
      body = { items: TITLES, nextCursor: null, limit: 50, runtimeUnknownHidden: 0, total: 2 };
    else if (path === '/api/service-state') body = { services: [] };
    else if (path === '/api/batches') body = { batches: [] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function box(locator: Locator) {
  const bounds = await locator.boundingBox();
  if (!bounds) throw new Error('element has no box');
  return bounds;
}

async function noSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
}

for (const width of [320, 390]) {
  describe(`T-PHONE-007 · the phone library at ${String(width)} px`, () => {
    beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await stubApi(page);
      await page.goto('/');
      await expect(page.getByTestId('title-row-t1')).toBeVisible();
    });

    test('T-PHONE-007a: the tab bar is fixed to the bottom, inside the viewport, with 44 px tabs', async ({
      page,
    }) => {
      const nav = page.getByRole('navigation', { name: 'Primary' });
      const bar = await box(nav);
      expect(bar.x).toBeGreaterThanOrEqual(0);
      expect(bar.x + bar.width).toBeLessThanOrEqual(width + 1);
      expect(Math.abs(bar.y + bar.height - 844)).toBeLessThanOrEqual(1);
      const tabs = [
        nav.getByRole('link', { name: 'Library' }),
        nav.getByTestId('tab-search'),
        nav.getByTestId('tab-filters'),
        nav.getByRole('button', { name: 'Menu' }),
      ];
      for (const tab of tabs) {
        const b = await box(tab);
        expect(b.height).toBeGreaterThanOrEqual(44);
        expect(b.width).toBeGreaterThanOrEqual(44);
      }
      await expect(page.getByRole('img', { name: 'Signed in as Saquib' })).toHaveText('S');
      await noSidewaysScroll(page);
    });

    test('T-PHONE-007b: the row lays out as drawn — title beside its pill, facts, then rating and marks', async ({
      page,
    }) => {
      const row = page.getByTestId('title-row-t2');
      const name = await box(row.getByTestId('title-name'));
      const pill = await box(row.locator('.title-row__priority'));
      const facts = await box(row.getByTestId('title-meta'));
      const rating = await box(row.getByTestId('imdb-rating'));
      const marks = await box(row.getByTestId('badges'));
      expect(pill.x).toBeGreaterThan(name.x);
      expect(Math.abs(pill.y - name.y)).toBeLessThan(name.height);
      expect(facts.y).toBeGreaterThanOrEqual(name.y + name.height - 1);
      expect(rating.y).toBeGreaterThanOrEqual(facts.y + facts.height - 1);
      // Rating and every service mark share one line.
      expect(Math.abs(rating.y + rating.height / 2 - (marks.y + marks.height / 2))).toBeLessThan(8);
      expect(marks.height).toBeLessThan(40);
      // The owner kept the Added date the mockup omits, on its own line.
      const added = row.getByTestId('date-added-label');
      await expect(added).toBeVisible();
      await expect(added).toContainText('Added 1 Aug 2026');
      expect((await box(added)).y).toBeGreaterThanOrEqual(rating.y + rating.height - 1);
      // Genres give way to the facts line.
      await expect(row.getByTestId('genres')).toBeHidden();
      expect(pill.x + pill.width).toBeLessThanOrEqual(width + 1);
      const watch = await box(row.locator('.title-row__watch .btn'));
      expect(watch.height).toBeGreaterThanOrEqual(44);
      await noSidewaysScroll(page);
    });

    test('T-PHONE-007c: Search and Filters tabs work, the sheet fits and is axe-clean', async ({
      page,
    }) => {
      await page.getByTestId('tab-search').click();
      await expect(page.getByRole('search', { name: 'Search your library' })).toBeVisible();
      await page.getByRole('button', { name: 'Close search' }).click();
      // With no toolbar trigger on the phone, focus goes back to the tab.
      await expect(page.getByTestId('tab-search')).toBeFocused();

      await page.getByTestId('tab-filters').click();
      const sheet = page.getByTestId('filter-sheet');
      await expect(sheet).toBeVisible();
      const chip = sheet.locator('label.filter-chip', { hasText: 'Netflix' });
      expect((await box(chip)).height).toBeGreaterThanOrEqual(44);
      await chip.click();
      await expect(page).toHaveURL(/service=netflix/);
      await expect(sheet.getByTestId('filter-sheet-show')).toBeVisible();
      await noSidewaysScroll(page);

      const results = await new AxeBuilder({ page }).include('[role="dialog"]').analyze();
      const blocking = results.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(blocking).toStrictEqual([]);

      await sheet.getByTestId('filter-sheet-show').click();
      await expect(sheet).toHaveCount(0);
      await expect(page.getByTestId('tab-filters')).toBeFocused();
    });
  });
}
