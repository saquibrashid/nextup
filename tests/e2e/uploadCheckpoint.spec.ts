import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const { describe } = test;
for (const width of [280, 390, 1440]) {
  describe(`Upload checkpoint at ${width}px`, () => {
    test('T-UX-160j: unfinished work, held paste and confirmed legal discard stay accessible', async ({
      page,
    }, testInfo) => {
      let status = 'draft';
      let discarded = false;
      const writes: string[] = [];
      const batch = () => ({
        batchId: 'checkpoint',
        service: 'max',
        mode: 'full-update',
        status,
        createdAt: '2026-09-01T12:00:00Z',
        submittedAt: null,
        completedAt: null,
        undoneAt: null,
        counts: { created: 0, modified: 0, removed: 0 },
      });
      await page.route('**/api/**', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() !== 'GET') writes.push(url.pathname);
        if (url.pathname === '/api/me') {
          await route.fulfill({
            json: {
              ownerId: 'owner',
              displayName: 'Owner',
              signOutUrl: '/.auth/logout',
              attribution: {},
            },
          });
        } else if (url.pathname === '/api/batches') {
          expect(url.searchParams.get('open')).toBe('true');
          expect(request.method()).toBe('GET');
          await route.fulfill({ json: { batches: discarded ? [] : [batch()] } });
        } else if (url.pathname === '/api/batches/checkpoint') {
          await route.fulfill({ json: batch() });
        } else if (url.pathname === '/api/batches/checkpoint/discard') {
          expect(status).toBe('in-review');
          discarded = true;
          await route.fulfill({ json: {} });
        } else {
          throw new Error(`Unexpected request ${request.method()} ${url.pathname}`);
        }
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/upload?service=netflix');
      await expect(
        page.getByRole('heading', { name: 'Continue your unfinished import' }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Continue your unfinished import' }),
      ).toBeFocused();
      await expect(page.getByTestId('service-step-panel')).not.toBeVisible();
      await expect(page.getByTestId('submit-button')).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Continue adding screenshots' })).toBeVisible();
      await page.evaluate(() => {
        const data = new DataTransfer();
        data.items.add(new File(['png'], 'held.png', { type: 'image/png' }));
        document.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      });
      await expect(page.getByTestId('upload-checkpoint')).toContainText('1 screenshot is held');
      await page.getByTestId('open-batch-go').click();
      const leave = page.getByRole('dialog', { name: 'Leave these new screenshots?' });
      await expect(leave.getByRole('button', { name: 'Stay here' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(leave).toHaveCount(0);
      status = 'extracting';
      await page.getByRole('button', { name: 'Refresh status' }).click();
      await expect(page.getByRole('button', { name: 'View progress' })).toBeVisible();
      await expect(page.getByTestId('open-batch-discard')).toHaveCount(0);
      status = 'in-review';
      await page.getByRole('button', { name: 'Refresh status' }).click();
      await expect(page.getByRole('button', { name: 'Continue review' })).toBeVisible();
      await page.getByTestId('open-batch-discard').click();
      const dialog = page.getByRole('dialog', { name: 'Discard this unfinished import?' });
      await expect(dialog.getByRole('button', { name: 'Stay here' })).toBeFocused();
      expect(writes).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('upload-checkpoint.png') });
      await dialog.getByRole('button', { name: 'Discard saved import' }).click();
      await expect(dialog).toHaveCount(0);
      if (width < 640) {
        // TASK-260: the phone questions are flat and the held paste waits on
        // the second screen, which opens once a mode is chosen.
        await expect(page.getByRole('radio', { name: 'Netflix', exact: true })).toBeChecked();
        await expect(page.getByTestId('import-continue')).toBeDisabled();
        await page.getByTestId('mode-card-append-only').getByRole('radio').check();
        await page.getByTestId('import-continue').click();
        await expect(page.getByRole('button', { name: 'Remove held.png' })).toBeVisible();
      } else {
        await expect(page.getByRole('button', { name: 'Remove held.png' })).toBeVisible();
        await expect(page.getByTestId('service-step-panel-answer')).toContainText('Netflix');
        await expect(page.getByTestId('submit-button')).toBeDisabled();
      }
      expect(writes).toEqual(['/api/batches/checkpoint/discard']);
    });
  });
}
