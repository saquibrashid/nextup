import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const { describe } = test;

for (const width of [280, 390, 900, 1440]) {
  describe(`Guided capture at ${width}px`, () => {
    test('T-UX-156i: upload geometry and accessible choices remain bounded before and after setup', async ({
      page,
    }) => {
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
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            read: async () => [],
          },
        });
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/upload');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Upload screenshots');
      const cards = page.getByTestId('service-step').locator('label');
      await expect(cards).toHaveCount(8);
      const sizes = await cards.evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect();
          return {
            width: rect.width,
            height: rect.height,
            overflow: node.scrollWidth > node.clientWidth + 1,
          };
        }),
      );
      for (const size of sizes) {
        expect(size.width).toBeCloseTo(sizes[0]?.width ?? 0, 0);
        expect(size.height).toBeCloseTo(sizes[0]?.height ?? 0, 0);
        expect(size.height).toBeGreaterThanOrEqual(44);
        expect(size.overflow).toBe(false);
      }
      for (const ready of [false, true]) {
        if (ready) {
          await page.getByRole('radio', { name: 'Netflix' }).check();
          await page.getByTestId('mode-card-append-only').getByRole('radio').check();
        }
        await expect(page.getByTestId('file-input')).toBeEnabled();
        await expect(
          page.getByRole('button', { name: 'Paste screenshot', exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        const scan = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(
          scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
        ).toEqual([]);
      }
    });
  });
}
