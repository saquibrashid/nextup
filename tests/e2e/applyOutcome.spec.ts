import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { buildReviewResponse } from '@nextup/domain';

test('T-UX-163i: uncertain Apply is read-only until a durable receipt can be read', async ({
  page,
}, testInfo) => {
  for (const width of [280, 390, 1440]) {
    await page.unrouteAll();
    let closes = 0;
    let unreadable = true;
    const review = buildReviewResponse({
      batchId: 'review',
      service: 'netflix',
      mode: 'append-only',
      lowYield: false,
      degradedExtraction: false,
      crossCheck: 'ok',
      candidates: [],
      disappearedListings: [],
      imagesWithNoText: [],
    });
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/me')
        await route.fulfill({
          json: {
            ownerId: 'owner',
            displayName: 'Owner',
            signOutUrl: '/.auth/logout',
            attribution: {},
          },
        });
      else if (path === '/api/batches/review/review') await route.fulfill({ json: review });
      else if (path === '/api/batches/review/close' && request.method() === 'POST') {
        closes += 1;
        await route.abort('failed');
      } else if (path === '/api/batches/review') {
        if (unreadable) {
          await route.abort('failed');
          return;
        }
        await route.fulfill({
          json: {
            batchId: 'review',
            service: 'netflix',
            mode: 'append-only',
            status: 'applied',
            createdAt: '2026-09-20T12:00:00Z',
            submittedAt: null,
            completedAt: '2026-09-20T12:05:00Z',
            derivedFromBatchId: null,
            images: [],
            extractionError: null,
            lowYield: false,
            changedNothing: true,
            provenance: { created: [], modified: [], removed: [] },
            titles: [],
            application: {
              summary: { listingsCreated: 0, listingsRemoved: 0, removalGroupId: null },
              undoable: true,
              removalsUndone: false,
            },
          },
        });
      } else throw new Error(`Unexpected request: ${request.method()} ${path}`);
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/batches/review/review');
    await page.getByTestId('apply-changes-button').click();
    await page.getByRole('button', { name: 'Apply changes' }).click();
    await expect(page.getByText(/We could not verify whether/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Check saved status' })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`unknown-apply-${width}.png`) });
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    unreadable = false;
    await page.getByRole('button', { name: 'Check saved status' }).click();
    await expect(page.getByRole('heading', { name: 'Capture applied' })).toBeVisible();
    await expect(page.getByText('Nothing changed on your Netflix list.')).toBeVisible();
    expect(closes).toBe(1);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Undo this import' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Start another capture' })).toBeVisible();
    expect(closes).toBe(1);
  }
});
