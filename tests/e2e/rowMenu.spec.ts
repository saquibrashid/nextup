/**
 * `T-MENU-080` — the light row action menu in a real browser (#471, `A69`,
 * US-078 / REQ-144).
 *
 * ⚠ jsdom has no layout, so only a browser can say a label stays on one line
 * and the menu stays inside the viewport. Mobile WebKit renders wider fonts
 * than Chromium: every check names the offending labels and re-measures with a
 * 30 % larger root font, rather than comparing raw scroll widths.
 */

import { expect, test, type Locator, type Page } from '@playwright/test';

const { describe } = test;

const ME = { ownerId: 'o_test', displayName: 'Saquib', email: 'owner@example.com' };

const LIBRARY_TITLES = [
  ['t1', 'tv', 2026, 'Stranger Things: Tales from \u201985', 'netflix'],
  ['t2', 'movie', 2024, 'Dune: Part Two', 'max'],
  ['t3', 'movie', 2021, 'Everything Everywhere All at Once', 'prime-video'],
  ['t4', 'tv', 2019, 'The Mandalorian', 'disney-plus'],
].map(([titleId, mediaType, releaseYear, name, service], index) => ({
  titleId,
  workIdentity: `tmdb:${String(mediaType)}:${String(index + 1)}`,
  matchState: 'matched',
  name,
  mediaType,
  releaseYear,
  genres: ['Sci-Fi', 'Adventure'],
  runtimeMinutes: 120,
  posterPath: null,
  imdbRating: 7.5,
  priority: 'someday',
  badges: [{ service, listingId: `l${String(index)}`, dateAdded: '2026-08-01' }],
  sortDateAdded: '2026-08-01',
  dateAddedLabel: 'Added 1 Aug 2026',
}));

const WAITING_BASE = {
  releaseYear: 2025,
  posterPath: null,
  discoveredAt: '2026-01-04',
  discoverySource: 'fandango-at-home',
  availableOn: [],
  flaggedOn: [],
  otherServicesOn: [],
  otherProvidersOn: [],
  rentOn: [],
  accessState: 'not-seen',
  streamingSince: null,
  availabilityCheckedAt: '2026-02-01T00:00:00.000Z',
  availabilityRegion: 'US',
};

const WAITING = {
  count: 4,
  availabilityRefreshFailed: false,
  items: [
    {
      ...WAITING_BASE,
      intentId: 'wi_1',
      titleId: 'w1',
      workIdentity: 'tmdb:movie:1',
      // Data arrives shouting; the card must not.
      name: 'THE LONG GOODBYE OF A VERY LONG NAMED MOVIE',
      forecast: { kind: 'announced', service: 'disney-plus', on: '2099-03-04', yours: true },
    },
    {
      ...WAITING_BASE,
      intentId: 'wi_2',
      titleId: 'w2',
      workIdentity: 'tmdb:movie:2',
      name: 'Wicked: For Good',
      accessState: 'rent-only',
      rentOn: ['Apple TV'],
      forecast: { kind: 'estimate', service: 'peacock', month: '2027-01', yours: false },
    },
    {
      ...WAITING_BASE,
      intentId: 'wi_3',
      titleId: 'w3',
      workIdentity: 'tmdb:movie:3',
      name: 'Arrived',
      accessState: 'streaming',
      availableOn: ['Netflix'],
      flaggedOn: ['netflix'],
      streamingSince: '2026-02-03T00:00:00.000Z',
    },
    {
      ...WAITING_BASE,
      intentId: 'wi_4',
      titleId: 'w4',
      workIdentity: 'tmdb:movie:4',
      name: 'Plain',
    },
  ],
};

async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { items: [] };
    if (path === '/api/me') body = ME;
    else if (path === '/api/titles')
      body = {
        items: LIBRARY_TITLES,
        nextCursor: null,
        limit: 50,
        runtimeUnknownHidden: 0,
        total: LIBRARY_TITLES.length,
      };
    else if (path === '/api/waiting') body = WAITING;
    else if (path === '/api/service-state') body = { services: [] };
    else if (path === '/api/batches') body = { batches: [] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

const WIDTHS = [280, 390, 1024] as const;

async function openLibraryMenu(page: Page, width: number): Promise<Locator> {
  await page.setViewportSize({ width, height: 900 });
  await stubApi(page);
  await page.goto('/');
  await page.getByTestId('row-menu').first().click();
  const menu = page.getByTestId('row-menu-popup');
  await expect(menu).toBeVisible();
  return menu;
}

/** Names every visible label that wraps or leaves the viewport. */
async function menuProblems(menu: Locator): Promise<string[]> {
  return menu.evaluate((root) => {
    const problems: string[] = [];
    const view = document.documentElement.clientWidth;
    const box = root.getBoundingClientRect();
    if (box.left < -1 || box.right > view + 1)
      problems.push(`menu outside the viewport: ${String(box.left)}..${String(box.right)}`);
    for (const label of root.querySelectorAll<HTMLElement>('.row-menu__label')) {
      if (label.offsetParent === null) continue;
      const range = document.createRange();
      range.selectNodeContents(label);
      const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
      if (lines.size > 1) problems.push(`wraps: "${label.textContent ?? ''}"`);
      const item = label.closest('button');
      if (
        item !== null &&
        label.getBoundingClientRect().right > item.getBoundingClientRect().right + 1
      )
        problems.push(`spills: "${label.textContent ?? ''}"`);
    }
    return problems;
  });
}

test.describe('T-MENU-080 — the light row action menu in a real browser (#471)', () => {
  for (const width of WIDTHS) {
    describe(`at ${String(width)}px`, () => {
      test('T-MENU-080a: items are plain rows with short labels and no visible Cancel on desktop', async ({
        page,
      }) => {
        const menu = await openLibraryMenu(page, width);
        const labels = await menu.locator('.row-menu__label').allInnerTexts();
        expect(labels).toEqual(['Not interested', 'Remove', 'Fix match', 'Finished']);
        await expect(menu.getByRole('menuitem', { name: 'Remove from library' })).toBeVisible();

        const styles = await menu
          .locator('.row-menu .btn:not([data-menu-close])')
          .evaluateAll((items) =>
            items.map((item) => {
              const s = getComputedStyle(item);
              return { border: s.borderTopWidth, weight: s.fontWeight };
            }),
          );
        for (const style of styles) {
          expect(style.border).toBe('0px');
          expect(Number(style.weight)).toBeLessThan(600);
        }

        const close = menu.getByRole('menuitem', { name: 'Close menu' });
        if (width >= 640) {
          await expect(close).toBeHidden();
          await expect(menu.getByText('Cancel', { exact: true })).toHaveCount(0);
          await page.keyboard.press('Escape');
          await expect(menu).toHaveCount(0);
        } else {
          await expect(close).toBeVisible();
          await close.click();
          await expect(menu).toHaveCount(0);
        }
      });

      test('T-MENU-080b: no label wraps and the menu stays in the viewport, even with a larger font', async ({
        page,
      }) => {
        const menu = await openLibraryMenu(page, width);
        expect(await menuProblems(menu)).toEqual([]);
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '130%';
        });
        expect(await menuProblems(menu)).toEqual([]);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });

      test('T-MENU-080c: the menu fits its content, never covers a whole desktop card, and the Waiting menu matches', async ({
        page,
      }) => {
        const menu = await openLibraryMenu(page, width);
        const box = (await menu.boundingBox())!;
        if (width >= 640) {
          const card = (await page
            .locator('[data-testid="title-list"] > li')
            .first()
            .boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(11 * 16 - 1);
          expect(box.width).toBeLessThanOrEqual(card.width);
          expect(box.height).toBeLessThan(card.height * 2);
        } else {
          // A phone sheet is anchored to the bottom edge and spans the viewport.
          expect(Math.round(box.y + box.height)).toBe(900);
          // Allow for a classic scrollbar (~15px) eating into the viewport.
          expect(box.width).toBeGreaterThanOrEqual(width - 20);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }

        await page.keyboard.press('Escape');
        await page.goto('/waiting');
        await page.getByTestId('waiting-row-menu').first().click();
        const waiting = page.getByRole('menu').first();
        await expect(waiting).toBeVisible();
        expect(await menuProblems(waiting)).toEqual([]);
        await expect(waiting.getByTestId('waiting-not-interested')).toHaveCSS(
          'border-top-width',
          '0px',
        );
      });
    });
  }
});
