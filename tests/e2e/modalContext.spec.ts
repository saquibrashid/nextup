import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { SERVICES, serviceFreshnessLabel } from '@nextup/domain';

const titles = Array.from({ length: 40 }, (_, index) => ({
  titleId: `modal-${index}`,
  workIdentity: `tmdb:movie:${index + 1}`,
  matchState: 'matched',
  name: `Library title ${index}`,
  mediaType: 'movie',
  releaseYear: 2024,
  genres: ['Drama'],
  runtimeMinutes: 110,
  posterPath: null,
  badges: [{ service: 'netflix', listingId: `listing-${index}`, dateAdded: '2026-09-01' }],
  sortDateAdded: '2026-09-01',
  dateAddedLabel: 'Added to nextup on 1 Sep 2026',
}));

async function fixture(page: Page) {
  let release: (() => void) | undefined;
  let hold = false;
  let fail = false;
  const writes: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') {
      writes.push(path);
      if (path.endsWith('/restore')) {
        await route.fulfill({ json: { listingId: 'listing-15', dateAdded: '2026-09-01' } });
        return;
      }
      if (hold)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      if (fail) {
        await route.fulfill({
          status: 503,
          json: {
            error: { code: 'STORE_UNAVAILABLE', message: 'Try again later.', requestId: 'test' },
          },
        });
      } else {
        await route.fulfill({ json: { titleId: 'modal-15', removedListingIds: ['listing-15'] } });
      }
      return;
    }
    let body: unknown;
    if (path === '/api/me')
      body = {
        ownerId: 'fixture',
        displayName: 'Owner',
        signOutUrl: '/.auth/logout',
        attribution: {},
      };
    else if (path === '/api/batches') body = { batches: [] };
    else if (path === '/api/titles')
      body = { items: titles, nextCursor: null, limit: 50, runtimeUnknownHidden: null };
    else if (path === '/api/service-state')
      body = {
        services: SERVICES.map((service) => ({
          service,
          lastCompletedBatchAt: null,
          lastCompletedBatchId: null,
          ageDays: null,
          label: serviceFreshnessLabel(service, null),
        })),
      };
    else if (path === '/api/suppressions')
      body = {
        items: titles.map((title) => ({
          suppressionId: title.titleId,
          workIdentity: title.workIdentity,
          identityStability: 'tmdb',
          displaySnapshot: title,
          createdAt: '2026-09-01T00:00:00Z',
        })),
      };
    else if (path === '/api/tmdb/search') body = { items: [] };
    else if (path === '/api/removed')
      body = {
        items: titles.map((title) => ({
          ...title,
          listingId: `listing-${title.titleId}`,
          service: 'netflix',
          dateAdded: '2026-09-01',
          removedAt: '2026-09-02T00:00:00Z',
          removedByBatchId: null,
          removedByGroupId: null,
          removalOrdinal: 1,
          removalTotalForWork: 1,
          restorable: true,
          suppressed: false,
        })),
        nextCursor: null,
        limit: 50,
      };
    else throw new Error(`Unexpected request: ${path}`);
    await route.fulfill({ json: body });
  });
  return {
    writes,
    hold: () => {
      hold = true;
    },
    fail: () => {
      fail = true;
    },
    release: () => {
      if (!release) throw new Error('No pending request');
      release();
      hold = false;
    },
  };
}

async function modalInViewport(page: Page) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await dialog.evaluate((node) => node.parentElement?.parentElement === document.body)).toBe(
    true,
  );
  expect(await page.locator('#root').getAttribute('inert')).not.toBeNull();
  expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
}

const { describe } = test;
for (const width of [320, 1280]) {
  describe(`Modal context at ${width}px`, () => {
    test('T-MOD-002a: library actions stay over the selected row and retain scroll and focus', async ({
      page,
    }) => {
      test.slow(); // Four independent axe scans, including desktop-sized WebKit.
      const api = await fixture(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.getByTestId('title-name')).toHaveCount(40);
      const row = page.getByTestId('title-row-modal-15');
      await row.scrollIntoViewIfNeeded();
      const trigger = row.getByTestId('row-menu');
      await trigger.click();
      const y = await page.evaluate(() => window.scrollY);
      await page.getByTestId('row-menu-remove').click();
      // The selected row must still be in the viewport, not the bottom of the list.
      const rowBox = await row.boundingBox();
      expect(rowBox!.y).toBeLessThan(900);
      expect(rowBox!.y + rowBox!.height).toBeGreaterThan(0);
      await modalInViewport(page);
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(1);
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(1);
      expect(api.writes).toHaveLength(0);

      for (const action of ['row-menu-suppress', 'row-menu-fix-match']) {
        await trigger.click();
        await page.getByTestId(action).click();
        await modalInViewport(page);
        await page.keyboard.press('Escape');
        await expect(trigger).toBeFocused();
        expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(1);
      }
      await page.getByTestId('add-title-open').click();
      await modalInViewport(page);
      await expect(page.getByTestId('add-title-search-input')).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('add-title-open')).toBeFocused();
    });

    test('T-MOD-002b: removal keeps pending writes and undo in the modal', async ({ page }) => {
      const api = await fixture(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.getByTestId('title-name')).toHaveCount(40);
      const row = page.getByTestId('title-row-modal-15');
      await row.scrollIntoViewIfNeeded();
      const trigger = row.getByTestId('row-menu');
      await trigger.click();
      await page.getByTestId('row-menu-remove').click();
      api.hold();
      await page.getByTestId('confirm-remove-title').click();
      await expect.poll(() => api.writes.length).toBe(1);
      await page.keyboard.press('Escape');
      await page.locator('.dialog-backdrop').click({ position: { x: 1, y: 1 } });
      await expect(page.getByRole('dialog')).toBeVisible();
      api.release();
      await expect(page.getByTestId('remove-done')).toBeVisible();
      await page.getByTestId('undo-remove-title').click();
      await expect(page.getByTestId('remove-undone')).toBeVisible();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(row).toBeVisible();
      await expect(trigger).toBeFocused();
    });

    test('T-MOD-002d: removal errors stay visible and return focus on dismissal', async ({
      page,
    }) => {
      const api = await fixture(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.getByTestId('title-name')).toHaveCount(40);
      const row = page.getByTestId('title-row-modal-15');
      await row.scrollIntoViewIfNeeded();
      const trigger = row.getByTestId('row-menu');
      await trigger.click();
      await page.getByTestId('row-menu-remove').click();
      api.fail();
      await page.getByTestId('confirm-remove-title').click();
      await expect(page.getByTestId('remove-failed')).toBeVisible();
      await modalInViewport(page);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
    });

    test('T-MOD-002c: long search results scroll inside the modal without moving the page', async ({
      page,
    }) => {
      await fixture(page);
      await page.route('**/api/tmdb/search?*', (route) =>
        route.fulfill({
          json: {
            items: titles.map((title, index) => ({
              tmdbId: index + 1,
              mediaType: 'movie',
              name: title.name,
              releaseYear: 2024,
              posterPath: null,
            })),
          },
        }),
      );
      await page.setViewportSize({ width, height: 560 });
      await page.goto('/');
      await page.getByTestId('add-title-open').click();
      const y = await page.evaluate(() => window.scrollY);
      await page.getByTestId('add-title-search-input').fill('Library');
      await expect(page.getByTestId('add-title-results').getByRole('button')).toHaveCount(40);
      await modalInViewport(page);
      const dialog = page.getByRole('dialog');
      expect(await dialog.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
      await page.getByTestId('add-title-results').getByRole('button').last().click();
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('add-title-open')).toBeFocused();
    });

    test('T-MOD-003: not-interested and restore conflicts use labelled cancellable modals', async ({
      page,
    }) => {
      await fixture(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/not-interested');
      const trigger = page.getByTestId('stop-ignoring-button').nth(15);
      await trigger.scrollIntoViewIfNeeded();
      const y = await page.evaluate(() => window.scrollY);
      await trigger.click();
      await modalInViewport(page);
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await expect(trigger).toBeFocused();
      expect(Math.abs((await page.evaluate(() => window.scrollY)) - y)).toBeLessThanOrEqual(1);
      for (const code of ['DUPLICATE_WORK_IDENTITY', 'WORK_SUPPRESSED']) {
        await page.route('**/api/listings/*/restore', (route) =>
          route.fulfill({
            status: 409,
            json: {
              error: {
                code,
                message: 'Needs confirmation',
                details: { unsuppressHref: '/api/suppressions/sup/unsuppress' },
                requestId: 'test',
              },
            },
          }),
        );
        await page.goto('/removed');
        const restore = page.getByTestId('restore-button').nth(15);
        await restore.click();
        const before = await page.evaluate(() => window.scrollY);
        await modalInViewport(page);
        await page.keyboard.press('Escape');
        await expect(restore).toBeFocused();
        expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(
          1,
        );
      }
    });
  });
}
