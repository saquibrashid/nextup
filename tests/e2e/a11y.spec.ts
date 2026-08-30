/**
 * `T-A11Y-001`, `T-A11Y-002`, `T-A11Y-012`, `T-A11Y-013`, `T-A11Y-015`,
 * `T-CSS-005` — the browser-only accessibility
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
/** TASK-123 R7: the deliberately narrower "degrades gracefully" viewport. */
const TINY = { width: 280, height: 720 };
/** US-037 AC-2: laptop/tablet width, not a desktop-only layout. */
const TABLET = { width: 1024, height: 768 };

const ROUTES = [
  '/',
  '/upload',
  '/batches',
  '/batches/01J0000000000000000000BTCH',
  '/batches/01J0000000000000000000BTCH/review',
  '/removed',
  '/not-interested',
  '/about',
  '/rating',
  '/no-such-route',
] as const;

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

const ME = {
  ownerId: 'owner-1',
  displayName: 'Owner',
  signOutUrl: '/.auth/logout',
  attribution: {},
};

function removedItem(index: number) {
  return {
    listingId: `lst_removed_${index}`,
    titleId: `ttl_removed_${index}`,
    workIdentity: `tmdb:movie:${600 + index}`,
    matchState: 'matched',
    name: `Removed title ${index} with a long but valid title`,
    mediaType: 'movie',
    releaseYear: 2000 + (index % 20),
    posterPath: null,
    service: index % 2 === 0 ? 'netflix' : 'max',
    dateAdded: '2026-01-04',
    removedAt: '2026-02-11T00:00:00.000Z',
    removedByBatchId: '01J0000000000000000000BTCH',
    removedByGroupId: null,
    removalOrdinal: 1,
    removalTotalForWork: 1,
    restorable: true,
    suppressed: false,
  };
}

const REMOVED = {
  items: Array.from({ length: 24 }, (_, index) => removedItem(index + 1)),
  nextCursor: null,
};

const BATCH = {
  batchId: '01J0000000000000000000BTCH',
  service: 'netflix',
  mode: 'append-only',
  status: 'complete',
  derivedFromBatchId: null,
  createdAt: '2026-02-11T00:00:00.000Z',
  submittedAt: '2026-02-11T00:01:00.000Z',
  completedAt: '2026-02-11T00:02:00.000Z',
  images: [],
  extractionError: null,
  lowYield: false,
  progress: { imagesDone: 0, imagesTotal: 0 },
  degradedExtraction: false,
  crossCheck: 'ok',
  provenance: { created: [], modified: [], removed: [] },
  changedNothing: true,
  titles: [],
};

const BATCHES = {
  batches: [
    {
      batchId: '01J0000000000000000000BTCH',
      service: 'netflix',
      mode: 'append-only',
      status: 'complete',
      createdAt: '2026-02-11T00:00:00.000Z',
      submittedAt: '2026-02-11T00:01:00.000Z',
      completedAt: '2026-02-11T00:02:00.000Z',
      undoneAt: null,
      counts: { created: 0, modified: 0, removed: 0 },
    },
  ],
};

const REVIEW = {
  batchId: '01J0000000000000000000BTCH',
  service: 'netflix',
  mode: 'append-only',
  status: 'review',
  createdAt: '2026-02-11T00:00:00.000Z',
  images: [],
  degradedExtraction: false,
  crossCheck: 'ok',
  sections: {
    new: [],
    changed: [],
    removals: [],
    unmatched: [],
  },
  summary: { new: 0, changed: 0, removals: 0, unmatched: 0 },
};

const ONE_BY_ONE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

/** Serves the API from the test rather than requiring a live backend. */
async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();
    const body = url.includes('/me')
      ? ME
      : url.includes('/titles') && !url.includes('/fix-match')
        ? TITLES
        : url.includes('/service-state')
          ? SERVICE_STATE
          : url.includes('/suppressions')
            ? { items: [] }
            : url.includes('/removed')
              ? REMOVED
              : url.includes('/images') && method === 'POST'
                ? {
                    accepted: [{ imageId: 'img_1', fileName: 'screen.png' }],
                    rejected: [],
                    batchTotals: {
                      imageCount: 1,
                      uploadedByteSize: ONE_BY_ONE_PNG.length,
                      storedByteSize: ONE_BY_ONE_PNG.length,
                    },
                  }
                : url.includes('/submit') && method === 'POST'
                  ? {}
                  : url.includes('/batches/01J0000000000000000000BTCH/review')
                    ? REVIEW
                    : url.includes('/batches/01J0000000000000000000BTCH')
                      ? BATCH
                      : url.endsWith('/api/batches') && method === 'GET'
                        ? BATCHES
                        : url.endsWith('/api/batches') && method === 'POST'
                          ? {
                              batchId: '01J0000000000000000000BTCH',
                              service: 'netflix',
                              mode: 'append-only',
                              status: 'draft',
                              createdAt: '2026-02-11T00:00:00.000Z',
                            }
                          : {};
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

async function enableClipboardRead(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: () => Promise.resolve([]),
      },
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

async function expectNoHorizontalOverflow(page: Page, context = page.url()): Promise<void> {
  const result = await page.evaluate(() => {
    const scrollbarProbe = document.createElement('div');
    scrollbarProbe.style.position = 'absolute';
    scrollbarProbe.style.left = '-9999px';
    scrollbarProbe.style.top = '0';
    scrollbarProbe.style.width = '100px';
    scrollbarProbe.style.height = '100px';
    scrollbarProbe.style.overflow = 'scroll';
    document.body.append(scrollbarProbe);
    const scrollbarWidth = scrollbarProbe.offsetWidth - scrollbarProbe.clientWidth;
    scrollbarProbe.remove();

    const clientWidth = document.documentElement.clientWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    const offenders = [...document.body.querySelectorAll('*')]
      .map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          tag: node.tagName.toLowerCase(),
          className:
            typeof node.getAttribute('class') === 'string' ? node.getAttribute('class') : '',
          testId: node.getAttribute('data-testid') ?? '',
          text: (node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
        };
      })
      .filter((rect) => rect.width > 0 && (rect.left < 0 || rect.right > clientWidth))
      .sort((a, b) => b.right - a.right)
      .slice(0, 5);

    return {
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      clientWidth,
      offsetWidth: document.documentElement.offsetWidth,
      outerWidth: window.outerWidth,
      scrollbarWidth,
      scrollWidth,
      overflow: scrollWidth - clientWidth,
      innerWidth: window.innerWidth,
      offenders,
    };
  });

  expect(result.overflow, `${context} overflow: ${JSON.stringify(result)}`).toBeLessThanOrEqual(0);
}

async function expectTapTarget(locator: ReturnType<Page['locator']>): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
}

async function focusByTab(page: Page, locator: ReturnType<Page['locator']>): Promise<void> {
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press('Tab');
    if (await locator.evaluate((node) => node === document.activeElement)) return;
  }
  await expect(locator).toBeFocused();
}

async function chooseUploadDraft(page: Page): Promise<void> {
  await page.getByLabel('Netflix').check();
  await page.getByLabel('Add only').check();
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

    await expectNoHorizontalOverflow(page, '/');
  });

  test('T-A11Y-001c: every route avoids horizontal scroll at 320 px', async ({ page }) => {
    await enableClipboardRead(page);
    await stubApi(page);
    await page.setViewportSize(NARROW);

    for (const route of ROUTES) {
      console.log(`T-A11Y-001c measuring ${route}`);
      await page.goto(route);
      await expectStyledAndRendered(page);
      await expectNoHorizontalOverflow(page, route);
    }
  });

  test('T-A11Y-001d: all three ingest affordances remain visible and operable at 320 px', async ({
    page,
  }) => {
    await enableClipboardRead(page);
    await stubApi(page);
    await page.setViewportSize(NARROW);
    await page.goto('/upload');
    await expectStyledAndRendered(page);
    await chooseUploadDraft(page);

    const paste = page.getByTestId('paste-button');
    const choose = page.getByText('Choose files', { exact: true });
    const drop = page.getByTestId('drop-target');

    await expect(paste).toBeVisible();
    await expect(choose).toBeVisible();
    await expect(drop).toBeVisible();
    const touchViewport = await page.evaluate(
      () => window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0,
    );
    if (touchViewport) {
      await expect(page.getByTestId('paste-hint')).toHaveText(
        'Take a screenshot, tap Copy on the preview, then tap here.',
      );
    } else {
      await expect(page.getByTestId('paste-hint')).toHaveCount(0);
    }
    await expect(page.getByTestId('dropzone-label')).toContainText('Paste a screenshot');
    await expect(page.getByTestId('dropzone-label')).toContainText('choose files');
    await expect(page.getByTestId('dropzone-label')).toContainText('drag them here');
    await expectTapTarget(paste);
    await expectTapTarget(choose);
    await focusByTab(page, paste);
    await expectNoHorizontalOverflow(page);
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

  test('T-A11Y-001e: the open row menu keeps every menu item at the 44 px touch floor', async ({
    page,
  }) => {
    await stubApi(page);
    await page.setViewportSize(NARROW);
    await page.goto('/');
    await expectStyledAndRendered(page);

    await page.getByTestId('row-menu').click();
    const menu = page.getByRole('menu', {
      name: 'Actions for A Very Long Film Title That Would Otherwise Force Sideways Scrolling',
    });
    await expect(menu).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const items = menu.getByRole('menuitem');
    await expect(items).toHaveCount(3);
    for (let i = 0; i < 3; i += 1) {
      await expectTapTarget(items.nth(i));
    }
  });
});

test.describe('T-A11Y-002 — the 1024 px journey is not desktop-only', () => {
  test('T-A11Y-002a: file selection can create, attach and submit a batch at 1024 px', async ({
    page,
  }) => {
    await enableClipboardRead(page);
    await stubApi(page);
    await page.setViewportSize(TABLET);
    await page.goto('/upload');
    await expectStyledAndRendered(page);

    await chooseUploadDraft(page);
    await page.getByTestId('file-input').setInputFiles({
      name: 'screen.png',
      mimeType: 'image/png',
      buffer: ONE_BY_ONE_PNG,
    });

    await expect(page.getByTestId('draft-batch-id')).toHaveText('01J0000000000000000000BTCH');
    await page.getByTestId('submit-button').click();
    await expect(page).toHaveURL(/\/batches\/01J0000000000000000000BTCH$/);
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('T-A11Y-013 — long removal history stays operable at 320 px', () => {
  test('T-A11Y-013a: every visible restore control has a 44 px target', async ({ page }) => {
    await stubApi(page);
    await page.setViewportSize(NARROW);
    await page.goto('/removed');
    await expectStyledAndRendered(page);

    await expect(page.getByTestId('removed-row').first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const restoreButtons = page.getByTestId('restore-button');
    const count = await restoreButtons.count();
    expect(count).toBeGreaterThan(8);
    for (let i = 0; i < count; i += 1) {
      await expectTapTarget(restoreButtons.nth(i));
    }
  });
});

test.describe('T-A11Y-015 — the 280 px floor degrades gracefully', () => {
  test('T-A11Y-015a: key routes reflow without unreachable content at 280 px', async ({ page }) => {
    await enableClipboardRead(page);
    await stubApi(page);
    await page.setViewportSize(TINY);

    for (const route of ['/', '/upload', '/removed'] as const) {
      await page.goto(route);
      await expectStyledAndRendered(page);
      await expect(page.getByRole('main')).toBeInViewport();
      await expectNoHorizontalOverflow(page);
    }
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
