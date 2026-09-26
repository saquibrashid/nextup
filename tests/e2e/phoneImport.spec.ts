/**
 * T-PHONE-010 — the owner's phone import mockup, in real browsers (TASK-260).
 *
 * The unit layer (`apps/web/test/phoneImport.spec.tsx`) proves the two
 * screens' behaviour; this proves what jsdom cannot: the second screen is
 * really hidden until Continue, nothing scrolls sideways at 390 or 320 px,
 * every target is at least 44 px, and axe finds nothing serious on either
 * screen.
 *
 * ⚠ **THE TABS CHOOSE EMPHASIS, NEVER EXISTENCE (invariant 16).** Every tab is
 * visited and `Choose files` must be on screen under each one — a tab that
 * hid file selection would quietly remove the only raw-HEIC path from iOS.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU1cAAAAASUVORK5CYII=',
  'base64',
);

async function stub(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/me') {
      await route.fulfill({
        json: {
          ownerId: 'owner',
          displayName: 'Owner',
          signOutUrl: '/.auth/logout',
          attribution: {},
        },
      });
    } else if (path === '/api/batches') {
      await route.fulfill({ json: { batches: [] } });
    } else if (path === '/api/service-state') {
      await route.fulfill({ json: { services: [] } });
    } else {
      await route.fulfill({ json: {} });
    }
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [] },
    });
  });
}

async function expectNoOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
}

async function expectTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('A visible target has no box');
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);
}

async function expectNoSeriousAxe(page: Page): Promise<void> {
  const scan = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(
    scan.violations
      .filter((item) => item.impact === 'serious' || item.impact === 'critical')
      .map((item) => item.id),
  ).toEqual([]);
}

const { describe } = test;

for (const width of [390, 320]) {
  describe(`T-PHONE-010 — the phone import at ${String(width)}px`, () => {
    test('T-PHONE-010a: the first screen asks both questions and Continue waits with a reason', async ({
      page,
    }) => {
      await stub(page);
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/upload');
      await expect(page.locator('html')).toHaveAttribute('data-layout', 'phone');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Import your watchlist' }),
      ).toBeVisible();
      const stepper = page.getByRole('list', { name: 'Import steps' });
      await expect(stepper).toBeVisible();
      await expect(stepper.locator('[aria-current="step"]')).toContainText('Service');

      // The screenshots screen is not on this one: it waits behind Continue.
      await expect(page.getByTestId('dropzone')).toBeHidden();
      await expect(page.getByTestId('submit-button')).toBeHidden();
      await expect(page.getByRole('radio', { checked: true })).toHaveCount(0);

      const next = page.getByTestId('import-continue');
      await expect(next).toBeDisabled();
      await expect(page.getByTestId('import-continue-reason')).toBeVisible();
      await expectTarget(page.getByTestId('import-close'));

      const tiles = page.getByTestId('service-step').locator('label');
      await expect(tiles).toHaveCount(8);
      for (const tile of await tiles.all()) await expectTarget(tile);
      await expectNoSeriousAxe(page);
      await expectNoOverflow(page);

      await page.getByRole('radio', { name: 'Netflix', exact: true }).check();
      await page.getByTestId('mode-card-append-only').getByRole('radio').check();
      await expect(next).toBeEnabled();
      await expect(page.getByTestId('import-continue-reason')).toHaveCount(0);
      await expectTarget(next);
      await expectNoOverflow(page);
    });

    test('T-PHONE-010b: the screenshots screen keeps every ingest path and leads to extraction', async ({
      page,
    }) => {
      await stub(page);
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/upload');
      await page.getByRole('radio', { name: 'Netflix', exact: true }).check();
      await page.getByTestId('mode-card-append-only').getByRole('radio').check();
      await page.getByTestId('import-continue').click();

      await expect(page.getByRole('heading', { name: 'Add screenshots' })).toBeFocused();
      await expect(
        page.getByRole('list', { name: 'Import steps' }).locator('[aria-current="step"]'),
      ).toContainText('Screenshots');
      await expect(page.getByRole('radio', { name: 'Netflix', exact: true })).toBeHidden();
      await expect(page.getByTestId('import-close')).toHaveCount(0);

      for (const id of ['paste', 'files', 'drop']) {
        const tab = page.getByTestId(`dropzone-tab-${id}`);
        await tab.click();
        await expect(tab).toHaveAttribute('aria-pressed', 'true');
        await expectTarget(tab);
        await expect(page.getByText('Choose files', { exact: true })).toBeVisible();
        await expect(page.getByTestId('drop-target')).toBeVisible();
        await expectNoOverflow(page);
      }
      await page.getByTestId('dropzone-tab-paste').click();
      await expect(page.getByTestId('paste-button')).toBeVisible();
      await expectTarget(page.getByTestId('paste-button'));

      await page.getByTestId('file-input').setInputFiles(
        Array.from({ length: 8 }, (_, index) => ({
          name: `shot-${String(index)}.png`,
          mimeType: 'image/png',
          buffer: PNG,
        })),
      );
      await expect(page.getByTestId('dropzone-totals')).toContainText('8 images added');
      const more = page.getByTestId('dropzone-show-more');
      await expect(more).toHaveText('+3');
      await expectTarget(more);
      await expect(page.getByTestId('accepted-file').locator('visible=true')).toHaveCount(5);
      await expectTarget(page.getByRole('button', { name: 'Remove shot-0.png' }));
      await expect(page.getByText('PNG, JPEG, HEIC/HEIF supported')).toBeVisible();
      await expect(page.getByTestId('submit-button')).toBeEnabled();
      await expectTarget(page.getByTestId('submit-button'));
      await expectNoSeriousAxe(page);
      await expectNoOverflow(page);

      await more.click();
      await expect(page.getByTestId('accepted-file').locator('visible=true')).toHaveCount(8);

      // Back keeps both answers and every held screenshot.
      await page.getByRole('button', { name: 'Back to Service' }).click();
      await expect(page.getByRole('radio', { name: 'Netflix', exact: true })).toBeChecked();
      await page.getByTestId('import-continue').click();
      await expect(page.getByTestId('accepted-file')).toHaveCount(8);

      await page.getByTestId('dropzone-clear-all').click();
      await expect(page.getByTestId('accepted-file')).toHaveCount(0);
      await expect(page.getByTestId('submit-button')).toBeDisabled();
      await expect(page.getByTestId('submit-reason')).toBeVisible();
    });
  });
}
