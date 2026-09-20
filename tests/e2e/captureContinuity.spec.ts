import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU1cAAAAASUVORK5CYII=',
  'base64',
);
const { describe } = test;
for (const width of [280, 390, 1440]) {
  describe(`Capture continuity at ${width}px`, () => {
    test('T-UX-161j: Back, partial saved recovery and explicit leave preserve the intended files', async ({
      page,
    }, testInfo) => {
      let writes = 0;
      const images: {
        imageId: string;
        fileName: string;
        available: boolean;
        href: string;
        ingestSource: string;
        retainUntil: null;
        candidateCount: null;
      }[] = [];
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === '/api/me') {
          await route.fulfill({
            json: {
              ownerId: 'owner',
              displayName: 'Owner',
              signOutUrl: '/.auth/logout',
              attribution: {},
            },
          });
        } else if (path === '/api/batches' && request.method() === 'GET') {
          await route.fulfill({ json: { batches: [] } });
        } else if (path === '/api/batches' && request.method() === 'POST') {
          await route.fulfill({
            json: {
              batchId: 'draft',
              service: 'netflix',
              mode: 'full-update',
              status: 'draft',
              createdAt: '2026-09-20T12:00:00Z',
            },
          });
        } else if (path === '/api/batches/draft/images') {
          writes += 1;
          const name = writes === 1 ? 'unknown.png' : 'good.png';
          images.push({
            imageId: name,
            fileName: name,
            available: true,
            href: `/api/images/${name}`,
            ingestSource: 'upload',
            retainUntil: null,
            candidateCount: null,
          });
          if (writes === 1) await route.abort('failed');
          else
            await route.fulfill({
              json: {
                accepted: [{ imageId: name, fileName: name }],
                rejected: [],
                batchTotals: {
                  imageCount: images.length,
                  uploadedByteSize: 140,
                  storedByteSize: 140,
                },
              },
            });
        } else if (path === '/api/batches/draft') {
          await route.fulfill({
            json: {
              batchId: 'draft',
              service: 'netflix',
              mode: 'full-update',
              status: 'draft',
              images,
              batchTotals: {
                imageCount: images.length,
                uploadedByteSize: 140,
                storedByteSize: 140,
              },
              createdAt: '2026-09-20T12:00:00Z',
              submittedAt: null,
              completedAt: null,
              derivedFromBatchId: null,
              extractionError: null,
              lowYield: false,
              changedNothing: true,
              provenance: { created: [], modified: [], removed: [] },
              titles: [],
            },
          });
        } else if (path.startsWith('/api/images/')) {
          await route.fulfill({ contentType: 'image/png', body: png });
        } else if (path === '/api/titles') {
          await route.fulfill({ json: { items: [], limit: 50, nextCursor: null } });
        } else if (path === '/api/service-state') {
          await route.fulfill({ json: { services: [] } });
        } else {
          throw new Error(`Unexpected request: ${request.method()} ${path}`);
        }
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/about');
      await page.locator('a[href="/upload"]:visible').first().click();
      await expect(page.getByTestId('file-input')).toBeEnabled();
      await page.getByTestId('file-input').setInputFiles([
        { name: 'unknown.png', mimeType: 'image/png', buffer: png },
        { name: 'good.png', mimeType: 'image/png', buffer: png },
      ]);
      const previews = page.getByTestId('accepted-list').locator('img');
      await expect(previews).toHaveCount(2);
      await expect
        .poll(() => previews.first().evaluate((image) => (image as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0);
      await page.evaluate(() => history.back());
      const leave = page.getByRole('dialog', { name: 'Leave this capture?' });
      await expect(leave.getByRole('button', { name: 'Stay here' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(leave).toHaveCount(0);
      await expect(page.getByTestId('accepted-name')).toHaveCount(2);
      await page.getByRole('radio', { name: 'Netflix', exact: true }).check();
      await page.getByTestId('mode-card-full-update').getByRole('radio').check();
      await page.getByTestId('submit-button').click();
      await page.getByRole('button', { name: 'Open saved batch' }).click();
      await expect(
        page.getByRole('heading', { name: 'Check your saved screenshots' }),
      ).toBeVisible();
      const saved = page.getByRole('list', { name: 'Saved screenshots' });
      await expect(saved.locator('li')).toHaveCount(2);
      await expect(page.getByTestId('accepted-list')).toContainText('unknown.png');
      await expect(page.getByTestId('accepted-list')).not.toContainText('good.png');
      await expect(
        page.getByRole('button', { name: 'Upload selected screenshots' }),
      ).toBeDisabled();
      await page.getByRole('button', { name: 'Check saved screenshots' }).click();
      await expect(page.getByRole('button', { name: 'Check saved screenshots' })).toBeEnabled();
      expect(writes).toBe(2);
      await page.locator('a[href="/"]:visible').first().click();
      await expect(leave).toBeVisible();
      await leave.getByRole('button', { name: 'Stay here' }).click();
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('capture-continuity.png') });
      await page
        .getByTestId('accepted-list')
        .getByRole('button', { name: 'Remove unknown.png' })
        .click();
      await expect(page.getByTestId('draft-submit')).toBeEnabled();
      await page.locator('a[href="/"]:visible').first().click();
      await expect(page).toHaveURL('/');
      await expect(leave).toHaveCount(0);
      expect(writes).toBe(2);
    });
  });
}
