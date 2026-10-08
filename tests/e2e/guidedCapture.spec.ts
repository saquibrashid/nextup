import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const { describe } = test;

for (const width of [280, 390, 1440]) {
  describe(`Authentic service artwork at ${width}px`, () => {
    test('T-BRAND-003: all local logos load within their choices and preserve service selection', async ({
      page,
    }, testInfo) => {
      const requests: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      await page.route('**/api/me', (route) =>
        route.fulfill({ json: { ownerId: 'owner', attribution: {} } }),
      );
      await page.route('**/api/batches?open=true', (route) =>
        route.fulfill({ json: { batches: [] } }),
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/upload');
      // #396 (`A57`): the first choice is Auto-detect, which has no service
      // artwork by design; the eight service cards are the subject here.
      const choices = page.getByTestId('service-step').locator('label:not([data-service="auto"])');
      const logos = choices.locator('img.brand-mark');
      await expect(logos).toHaveCount(8);
      await expect
        .poll(() =>
          logos.evaluateAll((images) =>
            images.every(
              (image) =>
                image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0,
            ),
          ),
        )
        .toBe(true);
      const geometry = await choices.evaluateAll((labels) =>
        labels.map((label) => {
          const image = label.querySelector('img');
          const name = label.querySelector('.service-mark__name');
          if (!image || !name) throw new Error('Missing service artwork or visible name');
          const frame = image.getBoundingClientRect();
          const card = label.getBoundingClientRect();
          const text = name.getBoundingClientRect();
          return {
            source: image.src,
            fit: getComputedStyle(image).objectFit,
            width: frame.width,
            height: frame.height,
            contained:
              frame.left >= card.left &&
              frame.right <= card.right &&
              frame.top >= card.top &&
              frame.bottom <= card.bottom,
            separate: frame.bottom <= text.top + 1,
            name: name.textContent,
          };
        }),
      );
      for (const logo of geometry) {
        expect(logo.source).toMatch(/^data:image\/svg\+xml[;,]/);
        expect(logo.fit).toBe('contain');
        expect(logo.width).toBeGreaterThan(0);
        expect(logo.width).toBeLessThanOrEqual(80);
        expect(logo.height).toBe(32);
        expect(logo.contained).toBe(true);
        expect(logo.separate).toBe(true);
        if (!logo.name) throw new Error('Empty service name');
        const option = page.getByRole('radio', { name: logo.name, exact: true });
        await option.check();
        // TASK-260: below --bp-sm the questions are flat tiles that never
        // collapse, so the answer is the checked tile itself — no summary.
        if (width < 640) {
          await expect(option).toBeChecked();
          continue;
        }
        await expect(page.getByTestId('service-step-panel-answer')).toHaveText(logo.name);
        await page.getByTestId('service-step-panel-change').click();
        await expect(option).toBeChecked();
      }
      expect(requests.filter((url) => new URL(url).origin !== new URL(page.url()).origin)).toEqual(
        [],
      );
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath('authentic-service-logos.png'),
        fullPage: true,
      });
    });
  });
}

describe('T-POL-003a calm capture framing', () => {
  for (const width of [280, 320, 390, 640, 900, 1440]) {
    describe(`Guided capture at ${width}px`, () => {
      test('T-UX-156i: upload geometry and accessible choices remain bounded before and after setup', async ({
        page,
      }, testInfo) => {
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
        await page.route('**/api/batches?open=true', (route) =>
          route.fulfill({ json: { batches: [] } }),
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
        // TASK-260: below --bp-sm the owner's mockup replaces the heading and
        // the capture progress with its own title and Service/Mode/Screenshots
        // stepper; T-PHONE-010 carries that screen's geometry.
        const phone = width < 640;
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          phone ? 'Import your watchlist' : 'Import screenshots',
        );
        expect(
          await page
            .getByRole('heading', { level: 1 })
            .evaluate((el) => getComputedStyle(el).fontFamily),
        ).toContain('Georgia');
        const progress = page.getByRole('list', {
          name: phone ? 'Import steps' : 'Capture progress',
        });
        // #396 (`A57`): the phone flow opens on Auto-detect (add only), so both
        // first-screen questions are already answered and no step is current
        // until Continue — the same state as answering both by hand.
        if (phone) await expect(progress.locator('[aria-current="step"]')).toHaveCount(0);
        else await expect(progress.locator('[aria-current="step"]')).toHaveText('Prepare');
        const stages = await progress.getByRole('listitem').evaluateAll((items) =>
          items.map((item) => {
            const rect = item.getBoundingClientRect();
            return { width: rect.width, bottom: rect.bottom, height: rect.height };
          }),
        );
        expect(new Set(stages.map((item) => Math.round(item.bottom))).size).toBe(1);
        expect(Math.max(...stages.map((item) => item.height))).toBeLessThanOrEqual(120);
        if (!phone) {
          const markers = await progress
            .getByRole('listitem')
            .evaluateAll((items) => items.map((item) => getComputedStyle(item, '::before').width));
          expect(markers).toEqual(Array<string>(3).fill('36px'));
        }
        expect(
          Math.max(...stages.map((item) => item.width)) -
            Math.min(...stages.map((item) => item.width)),
        ).toBeLessThan(1);
        await page.screenshot({ path: testInfo.outputPath('capture-setup.png'), fullPage: true });
        // #396: the Auto-detect choice is checked separately below.
        const cards = page.getByTestId('service-step').locator('label:not([data-service="auto"])');
        await expect(cards).toHaveCount(8);
        const auto = await page.getByTestId('service-option-auto').evaluate((node) => ({
          height: node.getBoundingClientRect().height,
          overflow: node.scrollWidth > node.clientWidth + 1,
        }));
        expect(auto.height).toBeGreaterThanOrEqual(44);
        expect(auto.overflow).toBe(false);
        if (width >= 1280) {
          const positions = await cards.evaluateAll((nodes) =>
            nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
          );
          expect(new Set(positions).size).toBe(1);
        }
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
            if (phone) await page.getByTestId('import-continue').click();
          }
          await expect(page.getByTestId('file-input')).toBeEnabled();
          if (phone && !ready) {
            // #396 (`A57`): Auto-detect (add only) is a complete answer, so
            // Continue is ready at once; T-PHONE-010a covers the wait.
            await expect(page.getByTestId('import-continue')).toBeEnabled();
          } else {
            await expect(
              page.getByRole('button', { name: 'Paste screenshot', exact: true }),
            ).toBeVisible();
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
          ).toBe(true);
          const scan = await new AxeBuilder({ page })
            .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
            .analyze();
          expect(
            scan.violations.filter(
              (item) => item.impact === 'serious' || item.impact === 'critical',
            ),
          ).toEqual([]);
        }
        await page.emulateMedia({ reducedMotion: 'reduce' });
        const durations = await page
          .locator('.dropzone__target')
          .evaluate((element) =>
            getComputedStyle(element).transitionDuration.split(',').map(Number.parseFloat),
          );
        expect(durations.every((duration) => duration <= 0.00001)).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath('capture-prepared.png'),
          fullPage: true,
        });
      });
    });
  }
});

test('T-MOCK-006: import groups choices, intake and bottom summary preselecting only Auto-detect (add only)', async ({
  page,
}, testInfo) => {
  await page.route('**/api/me', (route) =>
    route.fulfill({ json: { ownerId: 'owner', attribution: {} } }),
  );
  await page.route('**/api/batches?open=true', (route) => route.fulfill({ json: { batches: [] } }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: async () => [] },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/upload');
  await page.screenshot({
    path: testInfo.outputPath('import-composition.png'),
    fullPage: true,
  });
  await expect(page.getByRole('list', { name: 'Capture progress' })).toBeVisible();
  const heading = await page.getByRole('heading', { level: 1 }).boundingBox();
  const progress = await page.getByRole('list', { name: 'Capture progress' }).boundingBox();
  if (!heading || !progress) throw new Error('Missing import heading or progress');
  expect(progress.y).toBeGreaterThanOrEqual(heading.y + heading.height);
  const serviceCards = page.getByTestId('service-step').locator('label:not([data-service="auto"])');
  await expect(serviceCards).toHaveCount(8);
  const tops = await serviceCards.evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(1);
  // #396 (`A57`): the ONE default is Auto-detect, add only by source. A full
  // update is never preselected, and no named service is.
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(1);
  await expect(page.getByTestId('service-option-auto').getByRole('radio')).toBeChecked();
  await expect(
    page.getByTestId('mode-card-full-update').getByRole('radio', { includeHidden: true }),
  ).not.toBeChecked();
  await expect(page.getByTestId('submit-button')).toBeDisabled();
  const target = await page.locator('.dropzone__target').boundingBox();
  const summary = await page.locator('.upload-summary').boundingBox();
  if (!target || !summary) throw new Error('Missing intake target or summary');
  expect(summary.y).toBeGreaterThanOrEqual(target.y + target.height);
  await expect(page.getByTestId('file-input')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Paste screenshot', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'Netflix', exact: true }).check();
  await page.getByTestId('mode-card-append-only').getByRole('radio').check();
  await expect(page.getByTestId('file-input')).toBeEnabled();
  await expect(page.getByTestId('submit-button')).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
    true,
  );
});

test('T-MOCK-003a: mockup upload framing retains real choices and a readable numbered flow', async ({
  page,
}) => {
  await page.route('**/api/me', (route) =>
    route.fulfill({ json: { ownerId: 'owner', attribution: {} } }),
  );
  await page.route('**/api/batches?open=true', (route) => route.fulfill({ json: { batches: [] } }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/upload');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Import screenshots');
  const step = page
    .getByRole('list', { name: 'Capture progress' })
    .locator('[aria-current="step"]');
  expect(
    await step.evaluate((el) => Number.parseFloat(getComputedStyle(el, '::before').width)),
  ).toBe(36);
  const choices = page.getByTestId('service-step').locator('label');
  expect(
    await choices.first().evaluate((el) => el.getBoundingClientRect().height),
  ).toBeGreaterThanOrEqual(96);
  // #396 (`A57`): only Auto-detect is preselected (its add-only mode is folded).
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(1);
  await expect(page.getByTestId('service-option-auto').getByRole('radio')).toBeChecked();
  await expect(page.getByTestId('file-input')).toBeEnabled();
  await expect(page.getByTestId('submit-button')).toBeDisabled();
});
