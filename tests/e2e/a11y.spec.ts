/**
 * `T-A11Y-001`, `T-A11Y-002`, `T-A11Y-012`, `T-A11Y-013`, `T-A11Y-014`,
 * `T-A11Y-015`, `T-CSS-005` — the browser-only accessibility
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

/**
 * ⚠ **THIS STUB WAS AN INVENTED SHAPE AND THE REVIEW ROUTE RENDERED A BLANK
 * PAGE FOR IT.** It declared `sections: { new, changed, removals, unmatched }`
 * and a `summary`, none of which exist on `ReviewResponse`. The real contract
 * is six *named* sections, each carrying `label`/`count`/`items`, plus
 * `lowYield`, `banner` and `imagesWithNoText`.
 *
 * The consequence was not a loud failure. `document.body` on
 * `/batches/:id/review` was **empty** — no heading, no error, no way back —
 * and `T-A11Y-001c` ("every route avoids horizontal scroll at 320 px") had
 * been passing on it since the day it was written, because a page with nothing
 * on it cannot overflow. That is exactly the trivial pass this file's own
 * header warns about, alive inside this file.
 *
 * The stub's header warning about `service-state` said the same thing about a
 * different endpoint and was not generalised. It is now.
 */
const REVIEW = {
  batchId: '01J0000000000000000000BTCH',
  service: 'netflix',
  mode: 'append-only',
  lowYield: false,
  degradedExtraction: false,
  crossCheck: 'ok',
  banner: null,
  sections: {
    additions: { label: 'New to your list', count: 0, items: [] },
    alreadyOnYourList: {
      label: 'Already on your list',
      count: 0,
      items: [],
      collapsedByDefault: true,
      omitted: false,
    },
    probablyNotTitles: {
      label: 'Probably not titles',
      count: 0,
      items: [],
      collapsedByDefault: true,
      omitted: false,
    },
    unmatched: { label: "Couldn't identify these", count: 0, items: [] },
    unreadableTiles: { label: "Couldn't read these", count: 0, items: [] },
    removals: {
      label: 'No longer on Netflix',
      count: 0,
      items: [],
      omitted: true,
      withheld: false,
      withheldReason: null,
    },
  },
  imagesWithNoText: [],
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
          text: (node.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40),
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
        };
      })
      .filter((rect) => rect.width > 0 && (rect.left < -0.5 || rect.right > clientWidth + 0.5))
      .sort((a, b) => b.right - a.right);

    return {
      bodyClientWidth: document.body.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
      clientWidth,
      currentUrl: window.location.href,
      devicePixelRatio: window.devicePixelRatio,
      offsetWidth: document.documentElement.offsetWidth,
      outerWidth: window.outerWidth,
      pasteButtonCount: document.querySelectorAll('[data-testid="paste-button"]').length,
      pasteHintCount: document.querySelectorAll('[data-testid="paste-hint"]').length,
      readyState: document.readyState,
      scrollbarWidth,
      scrollWidth,
      overflow: scrollWidth - clientWidth,
      innerWidth: window.innerWidth,
      visualViewportWidth: window.visualViewport?.width ?? null,
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

/**
 * `T-A11Y-014` (US-037 AC-4) — the US-033 refusal enumeration is readable and
 * actionable at 320 px.
 *
 * ⚠ THIS IS THE ONE SCREEN IN THE PRODUCT THAT IS UNBOUNDED BY DESIGN. Every
 * other list the owner sees is a page of results; the undo refusal enumerates
 * **everything** a one-step undo would touch and is forbidden from truncating
 * (`UndoRefusalDetails.truncated` is typed as the literal `false`, US-033 AC-5,
 * `specs/testing.md` §6 row 10). A refusal panel that is *correct* and
 * *unusable at 320 px* fails the owner in exactly the same way a truncated one
 * would: the entries they need to act on are there, and they cannot reach them.
 *
 * ⚠ AND THE COMPONENT TEST CANNOT SEE THIS. `apps/web/test` renders
 * `UndoRefusalPanel` in jsdom, which has no layout — every element is 0×0, so
 * neither the overflow check nor the 44 px tap target means anything there.
 * Width, wrapping and reachability are browser-only facts.
 */
const REFUSAL_BATCH = {
  batches: [
    {
      batchId: '01J0000000000000000000UNDO',
      service: 'netflix',
      mode: 'full-update',
      status: 'applied',
      createdAt: '2026-02-11T00:00:00.000Z',
      submittedAt: '2026-02-11T00:01:00.000Z',
      completedAt: '2026-02-11T00:02:00.000Z',
      undoneAt: null,
      counts: { created: 62, modified: 3, removed: 2 },
    },
  ],
};

/**
 * ⚠ 62 CREATED ENTRIES, NOT 3, AND THE NUMBER IS LOAD-BEARING. `PAGE_SIZE` is
 * 50, so a fixture below it never renders the "Show all" control and the
 * assertions about reaching the tail pass over a list that was never long
 * enough to have one. Names are deliberately long, unbroken and mixed-case:
 * a single unwrappable token is the usual cause of sideways scroll at 320 px.
 */
const REFUSAL_DETAILS = {
  batchId: '01J0000000000000000000UNDO',
  reason: 'modified-or-removed',
  truncated: false,
  created: Array.from({ length: 62 }, (_, i) => ({
    titleId: `ttl_created_${i}`,
    name: `Everything Everywhere All At Once In One Unbreakable Title Number ${i}`,
    releaseYear: 2022,
    posterPath: null,
    currentState: i % 3 === 0 ? 'suppressed' : 'active',
    remedy: 'not-interested',
    remedyHref: `/not-interested?title=ttl_created_${i}`,
  })),
  modified: Array.from({ length: 3 }, (_, i) => ({
    titleId: `ttl_modified_${i}`,
    name: `A Rematched Work With A Very Long Name Indeed ${i}`,
    releaseYear: 1999,
    posterPath: null,
    attr: 'workIdentity',
    before: 'tmdb:movie:603',
    currentState: 'active',
    remedy: 'fix-match',
    remedyHref: `/?fix=ttl_modified_${i}`,
  })),
  removed: Array.from({ length: 2 }, (_, i) => ({
    titleId: `ttl_removed_${i}`,
    listingId: `lst_removed_${i}`,
    name: `Something Taken Off The List Since This Batch Ran ${i}`,
    releaseYear: 2010,
    posterPath: null,
    currentState: 'removed',
    remedy: 'restore',
    remedyHref: `/removed?listing=lst_removed_${i}`,
  })),
};

/** Serves the batch history, then refuses the undo with the §8.4 body. */
async function stubUndoRefusal(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/undo') && method === 'POST') {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            // The exact code `isUndoRefusal` matches on. A plausible-but-wrong
            // one renders the generic retry panel and every assertion below
            // would then be measuring the wrong screen.
            code: 'BATCH_NOT_CREATES_ONLY',
            message: 'This upload cannot be undone in one step.',
            details: REFUSAL_DETAILS,
          },
        }),
      });
      return;
    }

    const body = url.includes('/me')
      ? ME
      : url.endsWith('/api/batches') && method === 'GET'
        ? REFUSAL_BATCH
        : { items: [] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/** Drive the history screen into the refusal panel. */
async function openRefusalPanel(page: Page): Promise<void> {
  await stubUndoRefusal(page);
  await page.setViewportSize(NARROW);
  await page.goto('/batches');
  await expectStyledAndRendered(page);

  await page.getByTestId('batch-card-undo').click();
  await expect(page.getByTestId('undo-refusal-panel')).toBeVisible();
}

test.describe('T-A11Y-014 — the undo-refusal enumeration at 320 px', () => {
  test('T-A11Y-014a: the panel renders all three groups without sideways scroll', async ({
    page,
  }) => {
    await openRefusalPanel(page);

    // Assert the panel is genuinely populated BEFORE measuring overflow — an
    // empty panel cannot overflow, which is the trivial pass this file's
    // header warns about.
    await expect(page.getByTestId('undo-refusal-group-added')).toBeVisible();
    await expect(page.getByTestId('undo-refusal-group-changed')).toBeVisible();
    await expect(page.getByTestId('undo-refusal-group-removed')).toBeVisible();
    expect(await page.getByTestId('undo-refusal-entry').count()).toBeGreaterThan(50);

    await expectNoHorizontalOverflow(page, 'undo refusal panel');
  });

  test('T-A11Y-014b: every rendered name is readable — wrapped, not clipped away', async ({
    page,
  }) => {
    await openRefusalPanel(page);

    // "Readable" is a layout claim, so measure layout: each name occupies real
    // width, sits inside the viewport, and is not collapsed to a sliver by an
    // overflow rule. A name rendered at 3 px wide is present in the DOM and
    // invisible to the owner.
    const names = page.getByTestId('undo-refusal-name');
    const count = await names.count();
    expect(count).toBeGreaterThan(50);

    const boxes = await names.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      }),
    );
    const viewport = page.viewportSize()?.width ?? 0;
    for (const box of boxes) {
      expect(box.width).toBeGreaterThan(40);
      expect(box.left).toBeGreaterThanOrEqual(-0.5);
      expect(box.right).toBeLessThanOrEqual(viewport + 0.5);
    }
  });

  test('T-A11Y-014c: the remedy for the FIRST entry is a real 44 px target', async ({ page }) => {
    await openRefusalPanel(page);

    // One remedy per group, so all three remedy kinds are covered rather than
    // whichever happens to sort first.
    for (const testId of [
      'undo-refusal-not-interested',
      'undo-refusal-fix-match',
      'undo-refusal-restore',
    ] as const) {
      const button = page.getByTestId(testId).first();
      await button.scrollIntoViewIfNeeded();
      await expect(button).toBeVisible();
      await expectTapTarget(button);
    }
  });

  test('T-A11Y-014d: the tail of a >50 entry group is reachable, and nothing is summarised away', async ({
    page,
  }) => {
    await openRefusalPanel(page);

    // ⚠ THE POINT OF US-033 AC-5, ASSERTED AT THE VIEWPORT WHERE IT IS
    // HARDEST. The API may not truncate; the panel pages CLIENT-SIDE at 50.
    // If "Show all" were unreachable at 320 px the effect on the owner is
    // identical to a truncated response — twelve of their titles simply do
    // not exist as far as they can tell.
    const showAll = page.getByTestId('undo-refusal-show-all-added');
    await showAll.scrollIntoViewIfNeeded();
    await expect(showAll).toBeVisible();
    await expect(showAll).toHaveText(/62/);
    await expectTapTarget(showAll);

    await showAll.click();

    const last = page
      .getByTestId('undo-refusal-name')
      .filter({ hasText: 'Unbreakable Title Number 61' });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeVisible();

    // The full count is now rendered — 62 + 3 + 2.
    expect(await page.getByTestId('undo-refusal-entry').count()).toBe(67);
    // …and expanding it did not push the layout sideways.
    await expectNoHorizontalOverflow(page, 'undo refusal panel, expanded');
  });

  test('T-A11Y-014e: the way out stays reachable at 320 px', async ({ page }) => {
    await openRefusalPanel(page);

    // The panel REPLACES the history full-screen, so its own close control is
    // the only exit. Unreachable, the owner is stranded on it.
    const close = page.getByTestId('undo-refusal-close');
    await close.scrollIntoViewIfNeeded();
    await expect(close).toBeVisible();
    await expectTapTarget(close);
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

  /**
   * TASK-124's "Done when" is **every route**, not the list screen.
   *
   * ⚠ `T-A11Y-012a` SCANNED ONE ROUTE OUT OF TEN AND THE TASK READ AS
   * DELIVERED. Nine of the surfaces the owner actually uses — including
   * `/upload`, which is where every piece of data enters the product, and
   * `/batches/:id/review`, which is where they confirm it — had never been put
   * in front of axe at all. A route-scoped gate that runs on one route is the
   * same defect class as a parity test that mounts one of two surfaces: it
   * cannot fail for the reason it exists.
   *
   * Reported per route AND per rule, so a failure names the screen and the
   * violation instead of an opaque boolean. `expectStyledAndRendered` runs
   * first on every route for the reason in this file's header: axe finds no
   * contrast pair on a page that never painted, so a broken route would
   * otherwise scan clean.
   */
  test('T-A11Y-012c: EVERY route is free of serious and critical violations at 320 px', async ({
    page,
  }) => {
    await enableClipboardRead(page);
    await stubApi(page);
    await page.setViewportSize(NARROW);

    const found: string[] = [];
    const contrastCheckedOn: string[] = [];

    for (const route of ROUTES) {
      await page.goto(route);
      await expectStyledAndRendered(page);

      /*
       * ⚠ `/upload` OPENS ON THE SERVICE PICKER, NOT ON THE DROPZONE. Landing
       * on the route and scanning it never reaches the ingest controls at all,
       * so the sweep reported `/upload` clean while the primary affordance on
       * it — the paste button — carried a serious contrast failure. Choosing a
       * draft is the cheapest way to put the real capture surface on screen;
       * the explicit visibility assertion stops this silently reverting to a
       * picker-only scan if the flow changes.
       */
      if (route === '/upload') {
        await chooseUploadDraft(page);
        await expect(page.getByTestId('paste-button')).toBeVisible();
      }

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();

      for (const violation of results.violations) {
        if (violation.impact === 'serious' || violation.impact === 'critical') {
          found.push(`${route} · ${violation.id} (${violation.impact})`);
        }
      }

      // ⚠ Per route, not once for the run. A route that failed to paint
      // contributes no violations and would otherwise be indistinguishable
      // from a clean one — the exact trivial pass this file's header warns of.
      if ((results.passes.find((rule) => rule.id === 'color-contrast')?.nodes.length ?? 0) > 0) {
        contrastCheckedOn.push(route);
      }
    }

    expect(found).toEqual([]);
    expect(contrastCheckedOn).toEqual([...ROUTES]);
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
