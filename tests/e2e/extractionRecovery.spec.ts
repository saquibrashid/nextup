import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const { describe } = test;
for (const width of [280, 390, 1440]) {
  describe(`Extraction recovery at ${width}px`, () => {
    test('T-UX-157g: measured progress and retained failure evidence fit phone and desktop', async ({
      page,
    }, testInfo) => {
      let failed = false;
      let retries = 0;
      await page.route('**/api/me', (route) =>
        route.fulfill({
          json: {
            ownerId: 'owner-1',
            displayName: 'Owner',
            signOutUrl: '/.auth/logout',
            attribution: {},
          },
        }),
      );
      await page.route('**/api/images/*', (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="64"><rect width="48" height="64" fill="#302744"/></svg>',
        }),
      );
      await page.route('**/api/batches/b1/retry-extraction', (route) => {
        retries += 1;
        failed = false;
        return route.fulfill({ status: 202, json: { batchId: 'b1', status: 'submitted' } });
      });
      await page.route('**/api/batches/b1', (route) =>
        route.fulfill({
          json: {
            batchId: 'b1',
            service: 'netflix',
            mode: 'full-update',
            status: failed ? 'extraction-failed' : 'extracting',
            extractionError: failed ? 'EXTRACTOR_ERROR' : null,
            progress: { imagesDone: 1, imagesTotal: 3 },
            createdAt: '2026-09-19T00:00:00Z',
            submittedAt: null,
            completedAt: null,
            derivedFromBatchId: null,
            lowYield: false,
            changedNothing: true,
            provenance: { created: [], modified: [], removed: [] },
            titles: [],
            images: [null, 0, 3].map((candidateCount, index) => ({
              imageId: `image-${index}`,
              fileName: `Screenshot-from-a-very-long-camera-roll-filename-${index}.png`,
              ingestSource: 'upload',
              available: true,
              retainUntil: null,
              candidateCount,
              href: `/api/images/image-${index}`,
            })),
          },
        }),
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/batches/b1');
      await expect(page.getByRole('progressbar')).toHaveAttribute('value', '1');
      await expect(page.getByRole('button', { name: /Discard/ })).toHaveCount(0);
      failed = true;
      await page.reload();
      await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
      await expect(page.getByTestId('batch-status-image')).toHaveCount(3);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('status.png'), fullPage: true });
      await page.getByRole('button', { name: 'Try again', exact: true }).click();
      await expect(page.getByRole('progressbar')).toBeVisible();
      expect(retries).toBe(1);
    });
  });
}
