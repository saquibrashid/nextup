import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { createServer } from 'vite';

async function renderButtons(): Promise<string> {
  // Vite renders the real TSX; Playwright's JSX transform produces its own
  // component-test objects, which React's server renderer cannot consume.
  const server = await createServer({
    root: join(process.cwd(), 'apps', 'web'),
    configFile: false,
    server: { middlewareMode: true, ws: false },
    appType: 'custom',
  });
  try {
    const module: unknown = await server.ssrLoadModule('/test/primitiveMarkup.ts');
    if (
      typeof module !== 'object' ||
      module === null ||
      !('buttonVariantMarkup' in module) ||
      typeof module.buttonVariantMarkup !== 'function'
    ) {
      throw new Error('The real Button fixture renderer was not loaded');
    }
    const rendered: unknown = module.buttonVariantMarkup();
    if (typeof rendered !== 'string') throw new Error('Button fixture did not render HTML');
    return rendered;
  } finally {
    await server.close();
  }
}

test('T-A11Y-017: every Button variant meets the 44px floor at 320px', async ({ page }) => {
  const markup = await renderButtons();
  await page.setViewportSize({ width: 320, height: 720 });
  const variants = ['primary', 'secondary', 'ghost', 'danger'] as const;
  await page.setContent(
    `<meta name="viewport" content="width=device-width, initial-scale=1">${markup}`,
  );
  await page.addStyleTag({
    content: readFileSync(join(process.cwd(), 'apps', 'web', 'src', 'index.css'), 'utf8'),
  });
  const floor = await page.evaluate(() =>
    parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--tap-target-min')),
  );
  expect(floor).toBe(44);
  for (const variant of variants) {
    const button = page.getByRole('button', { name: variant });
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(floor);
    expect(bounds?.height).toBeGreaterThanOrEqual(floor);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
});
