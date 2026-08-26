/**
 * `T-A11Y-001`, `T-A11Y-012`, `T-CSS-005` — the browser-only accessibility
 * floor (`specs/testing.md` §37, `specs/ui.md` §10.2, §13.3, NFR-006).
 *
 * ⚠ THIS FILE DID NOT EXIST, AND ITS ABSENCE WAS INVISIBLE. `tests/e2e/` held
 * nothing but a `.gitkeep`, so `test:e2e` and `test:a11y` both reported green
 * over zero tests — two of the twelve required checks measuring nothing at
 * all. That is how a fully unstyled application passed 12/12 and was handed to
 * the owner, who reported the page as broken.
 *
 * ⚠ `T-A11Y-001` AND `T-A11Y-012` PASS TRIVIALLY ON A BROKEN PAGE. An empty
 * or unstyled document has no overflow to detect and no rendered colour pair
 * to fail on, so both are satisfied by exactly the state they exist to
 * prevent. Every test here therefore FIRST asserts the page is genuinely
 * rendered and styled — see `expectStyledAndRendered`.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** §10.1's floor — the narrowest width NFR-006 mandates. */
const NARROW = { width: 320, height: 720 };

const TITLES = {
  items: [
    {
      titleId: 'ttl_1',
      workIdentity: 'tmdb:movie:603',
      matchState: 'matched',
      name: 'A Very Long Film Title That Would Otherwise Force Sideways Scrolling',
      mediaType: 'movie',
      releaseYear: 1999,
      genres: ['Action', 'Science Fiction'],
      runtimeMinutes: 136,
      posterPath: null,
      badges: [
        { service: 'netflix', listingId: 'lst_1', dateAdded: '2026-01-04' },
        { service: 'max', listingId: 'lst_2', dateAdded: '2026-02-11' },
      ],
      sortDateAdded: '2026-01-04',
      dateAddedLabel: 'Added to nextup on 4 Jan 2026',
    },
  ],
  nextCursor: null,
  limit: 50,
};

/**
 * ⚠ THE STUB MUST MATCH THE REAL CONTRACT, NOT A PLAUSIBLE ONE. The first
 * draft invented `{ service, lastUpdatedAt }`, which left `label` undefined
 * and rendered a link with NO ACCESSIBLE NAME — axe caught it as `link-name`.
 * The bug was in the fixture, but the lesson is the reverse of comforting: a
 * wrong fixture produces a real, shipped-looking failure, so fixtures are
 * copied from the route's projection (`apps/api/src/routes/serviceState.ts`).
 */
const SERVICE_STATE = {
  services: [
    {
      service: 'netflix',
      lastCompletedBatchAt: '2026-02-11T00:00:00.000Z',
      lastCompletedBatchId: 'bat_1',
      ageDays: 0,
      label: 'Netflix updated today',
    },
    {
      service: 'max',
      lastCompletedBatchAt: null,
      lastCompletedBatchId: null,
      ageDays: null,
      label: 'Max has never been updated',
    },
  ],
};

/** Serves the API from the test rather than requiring a live backend. */
async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const body = url.includes('/titles')
      ? TITLES
      : url.includes('/service-state')
        ? SERVICE_STATE
        : url.includes('/suppressions')
          ? { items: [] }
          : {};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/**
 * ⚠ THE GUARD THAT MAKES EVERY OTHER ASSERTION IN THIS FILE MEAN SOMETHING.
 * Without it, a blank page or a page whose stylesheet 404'd passes the axe
 * scan and the overflow check perfectly.
 */
async function expectStyledAndRendered(page: Page): Promise<void> {
  await expect(page.getByRole('main')).toBeVisible();

  // The stylesheet actually applied: `body` inherits the token font stack and
  // the token background, neither of which is a browser default.
  const applied = await page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return {
      background: style.backgroundColor,
      font: style.fontFamily,
      token: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(),
    };
  });

  expect(applied.token).toBe('#f9fafb');
  expect(applied.background).toBe('rgb(249, 250, 251)');
  expect(applied.font).not.toBe('');
}

test.describe('T-A11Y-001 — the 320 px floor', () => {
  test('T-A11Y-001a: the list does not scroll sideways at 320 px', async ({ page }) => {
    await stubApi(page);
    await page.setViewportSize(NARROW);
    await page.goto('/');

    await expectStyledAndRendered(page);
    // A real row with a deliberately long title is on screen, so this measures
    // the layout rather than an empty document.
    await expect(page.getByText(/A Very Long Film Title/)).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('T-A11Y-001b: every interactive control meets the 44 px touch floor', async ({ page }) => {
    await stubApi(page);
    await page.setViewportSize(NARROW);
    await page.goto('/');
    await expectStyledAndRendered(page);

    const small = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('.tap-target')];
      return nodes
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return { text: node.textContent?.trim() ?? '', w: rect.width, h: rect.height };
        })
        .filter((box) => box.w < 44 || box.h < 44);
    });
    expect(small).toEqual([]);
  });
});

test.describe('T-A11Y-012 — axe-core finds no violation', () => {
  test('T-A11Y-012a: the list screen is clean at 320 px', async ({ page }) => {
    await stubApi(page);
    await page.setViewportSize(NARROW);
    await page.goto('/');
    await expectStyledAndRendered(page);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  test('T-A11Y-012b: the axe scan actually evaluated colour contrast', async ({ page }) => {
    // ⚠ A CLEAN SCAN OVER ZERO CHECKED NODES IS NOT A PASS. axe skips
    // colour-contrast entirely when nothing is rendered, which is precisely
    // the failure mode of an unstyled page — so assert the check ran.
    await stubApi(page);
    await page.goto('/');
    await expectStyledAndRendered(page);

    const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    const contrast = results.passes.find((rule) => rule.id === 'color-contrast');
    expect(contrast?.nodes.length ?? 0).toBeGreaterThan(0);
  });
});

test.describe('T-CSS-005 — prefers-reduced-motion is honoured', () => {
  test('T-CSS-005b: reduce collapses transitions and animations', async ({ page }) => {
    await stubApi(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expectStyledAndRendered(page);

    const durations = await page.evaluate(() => {
      /**
       * ⚠ PARSED AS A NUMBER, NEVER MATCHED AS A STRING. Chromium serialises
       * `0.01ms` as `1e-05s` and WebKit as `0.00001s` — a string test written
       * against one engine reports the other as broken while the CSS is
       * identical and correct.
       */
      const seconds = (value: string): number =>
        value
          .split(',')
          .map((part) => Number.parseFloat(part.trim()))
          .reduce((max, current) => Math.max(max, Number.isNaN(current) ? 0 : current), 0);

      return [...document.querySelectorAll('*')]
        .map((node) => {
          const style = getComputedStyle(node);
          return {
            tag: node.tagName,
            transition: seconds(style.transitionDuration),
            animation: seconds(style.animationDuration),
          };
        })
        .filter((value) => value.transition > 0.001 || value.animation > 0.001);
    });
    expect(durations).toEqual([]);
  });

  test('T-CSS-005c: without the preference, the reset does NOT apply', async ({ page }) => {
    // Otherwise T-CSS-005b passes on a stylesheet that simply has no motion —
    // proving nothing about whether the preference is read at all.
    await stubApi(page);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');

    const matches = await page.evaluate(
      () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );
    expect(matches).toBe(false);
  });
});
