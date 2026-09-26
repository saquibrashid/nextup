/**
 * `T-NAV-002` — the Menu drawer in a real browser (issue 369, TASK-250,
 * `specs/ui-refresh.md` §6).
 *
 * ⚠ **jsdom CANNOT SEE ANY OF THIS.** `navigation.spec.tsx` proves the drawer's
 * semantics; only a browser can prove it fits the viewport, scrolls when the
 * viewport is short, traps focus, and is free of axe violations while open.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const { beforeEach, describe } = test;

const ME = { ownerId: 'o_test', email: 'owner@example.com' };

const DESTINATIONS = [
  ['Library', '/'],
  ['Import', '/upload'],
  ['Review', '/batches'],
  ['Removal history', '/removed'],
  ['Not interested', '/not-interested'],
  ['Waiting to stream', '/waiting'],
  ['About', '/about'],
  ['Rating lookup', '/rating'],
] as const;

/** `OwnerGate` settles `/api/me` before the router mounts, so it must be served. */
async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(url.includes('/me') ? ME : { items: [] }),
    });
  });
}

/**
 * Opens the drawer from the keyboard: WebKit does not focus a button on
 * click, so a focus-return check after a click would test nothing there.
 */
async function openMenu(page: Page) {
  const menu = page.getByRole('navigation', { name: 'Primary' }).getByRole('button', {
    name: 'Menu',
  });
  await menu.focus();
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(drawer).toBeVisible();
  return { menu, drawer };
}

// 1023 is the widest drawer width; from --bp-lg (1024) the sidebar lists everything (T-NAV-003).
for (const width of [320, 390, 640, 1023]) {
  describe(`The Menu drawer at ${String(width)} px`, () => {
    beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await stubApi(page);
    });

    test('T-NAV-002a: the header shows the hybrid bar and the drawer lists every destination', async ({
      page,
    }) => {
      await page.goto('/about');
      const nav = page.getByRole('navigation', { name: 'Primary' });
      await expect(nav.getByRole('button', { name: 'Menu' })).toBeVisible();
      // TASK-255: below --bp-sm the phone tab bar's one link is Library.
      if (width < 640) await expect(nav.getByRole('link')).toHaveText(['Library']);
      else await expect(nav.getByRole('link')).toHaveText(['Library', 'Import', 'Review']);

      const { drawer } = await openMenu(page);
      // TASK-261: Sign out sits below the destination list, so count the list alone.
      await expect(drawer.getByRole('list').getByRole('link')).toHaveText(
        DESTINATIONS.map(([name]) => name),
      );
      for (const [name, href] of DESTINATIONS) {
        await expect(drawer.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
      }
      await expect(drawer.getByRole('link', { name: 'About', exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );

      const box = await drawer.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.x ?? -1) >= 0).toBe(true);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
    });

    test('T-NAV-002b: focus is trapped in the drawer, and Escape returns it to Menu', async ({
      page,
    }) => {
      await page.goto('/about');
      const { menu, drawer } = await openMenu(page);

      for (let step = 0; step < DESTINATIONS.length + 3; step += 1) {
        await page.keyboard.press('Tab');
        // ⚠ WebKit's default Tab order skips links, so from the last BUTTON it
        // would move focus to <body>; the trap must wrap it back either way.
        await expect
          .poll(() => drawer.evaluate((element) => element.contains(document.activeElement)))
          .toBe(true);
      }

      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
      await expect(menu).toBeFocused();
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
    });

    test('T-NAV-002c: a drawer link navigates, closes the drawer and marks the new page', async ({
      page,
    }) => {
      await page.goto('/about');
      const { drawer } = await openMenu(page);
      await drawer.getByRole('link', { name: 'Removal history', exact: true }).click();

      await expect(page).toHaveURL(/\/removed$/);
      await expect(page.getByRole('dialog', { name: 'Menu' })).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Removal history');

      const reopened = await openMenu(page);
      await expect(
        reopened.drawer.getByRole('link', { name: 'Removal history', exact: true }),
      ).toHaveAttribute('aria-current', 'page');
    });

    test('T-NAV-002d: on a short viewport the drawer scrolls so the last destination is reachable', async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 320 });
      await page.goto('/about');
      const { drawer } = await openMenu(page);

      const box = await drawer.boundingBox();
      expect((box?.y ?? -1) >= 0).toBe(true);
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(321);

      const last = drawer.getByRole('link', { name: 'Rating lookup', exact: true });
      await last.scrollIntoViewIfNeeded();
      await expect(last).toBeInViewport();
      await last.click();
      await expect(page).toHaveURL(/\/rating$/);
    });

    test('T-NAV-004e: the drawer offers a visible Sign out link to /.auth/logout', async ({
      page,
    }) => {
      await page.goto('/about');
      await expect(page.getByRole('link', { name: 'Sign out' })).toHaveCount(0);
      const { drawer } = await openMenu(page);
      const signOut = drawer.getByRole('link', { name: 'Sign out', exact: true });
      await signOut.scrollIntoViewIfNeeded();
      await expect(signOut).toBeVisible();
      await expect(signOut).toHaveAttribute('href', '/.auth/logout');
    });

    test('T-NAV-002e: the open drawer has no serious or critical axe violations', async ({
      page,
    }) => {
      await page.goto('/about');
      await openMenu(page);
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
      ).toEqual([]);
    });
  });
}

describe('T-NAV-003: the sidebar at 1280 px lists every destination directly', () => {
  beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubApi(page);
  });

  test('T-NAV-003a: every destination is visible in the nav, with no Menu button or drawer', async ({
    page,
  }) => {
    await page.goto('/about');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link')).toHaveText(DESTINATIONS.map(([name]) => name));
    for (const [name, href] of DESTINATIONS) {
      const link = nav.getByRole('link', { name, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('href', href);
    }
    await expect(nav.getByRole('link', { name: 'About', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(nav.getByRole('button', { name: 'Menu' })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
  });

  test('T-NAV-003b: the sidebar and the page sit in one frame, split by a hairline', async ({
    page,
  }) => {
    await page.goto('/about');
    const frame = await page.locator('.app-shell').boundingBox();
    const nav = await page.getByRole('navigation', { name: 'Primary' }).boundingBox();
    const content = await page.locator('.app-shell__content').boundingBox();
    expect(frame && nav && content).toBeTruthy();
    if (!frame || !nav || !content) return;
    expect(nav.x).toBeGreaterThanOrEqual(frame.x);
    expect(nav.x + nav.width).toBeLessThanOrEqual(content.x);
    expect(content.x + content.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
    const divider = await page
      .locator('.app-shell__content')
      .evaluate((element) => getComputedStyle(element).borderInlineStartWidth);
    expect(divider).toBe('1px');
  });

  test('T-NAV-003c: a sidebar link navigates and moves the current-page marking', async ({
    page,
  }) => {
    await page.goto('/about');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await nav.getByRole('link', { name: 'Removal history', exact: true }).click();
    await expect(page).toHaveURL(/\/removed$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Removal history');
    await expect(nav.getByRole('link', { name: 'Removal history', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('T-NAV-004f: the sidebar shows a visible Sign out link to /.auth/logout', async ({
    page,
  }) => {
    await page.goto('/about');
    const signOut = page.getByRole('banner').getByRole('link', { name: 'Sign out', exact: true });
    await expect(signOut).toBeVisible();
    await expect(signOut).toHaveAttribute('href', '/.auth/logout');
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Sign out' }),
    ).toHaveCount(0);
  });

  test('T-NAV-003d: the sidebar has no serious or critical axe violations', async ({ page }) => {
    await page.goto('/about');
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
    ).toEqual([]);
  });
});
