/**
 * `T-MCARD-080` — the Library and Waiting card layouts in a real browser
 * (#467, #470, `A68`, US-076 / US-077).
 *
 * ⚠ jsdom has no layout, so only a browser can say the Library grid is two
 * poster columns unlike its list, the Waiting grid's cards are equal height,
 * and no label is clipped or broken mid-word. Mobile WebKit renders wider
 * fonts than Chromium: every width assertion below names the offending labels
 * instead of comparing raw scroll widths.
 */

import { expect, test, type Page } from '@playwright/test';

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

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxes(page: Page, selector: string): Promise<Box[]> {
  return page.locator(selector).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }),
  );
}

async function noOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * Names every label in the list that spills out of its card or is broken in
 * the middle of a word (a word whose range spans more than one line box).
 */
async function textProblems(page: Page, rowSelector: string): Promise<string[]> {
  return page.evaluate((selector) => {
    const problems: string[] = [];
    for (const row of document.querySelectorAll<HTMLElement>(selector)) {
      const card = row.getBoundingClientRect();
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        const parent = node.parentElement;
        const text = node.textContent ?? '';
        if (parent === null || text.trim() === '') continue;
        if (parent.closest('.sr-only, [aria-hidden="true"][data-grid-slot]') !== null) continue;
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const whole = document.createRange();
        whole.selectNodeContents(node);
        const rect = whole.getBoundingClientRect();
        if (rect.width > 0 && (rect.right > card.right + 1 || rect.left < card.left - 1)) {
          problems.push(`spills: "${text.trim()}"`);
        }
        for (const match of text.matchAll(/\S+/g)) {
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
          if (match[0].length > 1 && lines.size > 1)
            problems.push(`broken mid-word: "${match[0]}"`);
        }
      }
    }
    return problems;
  }, rowSelector);
}

const WIDTHS = [280, 390, 1024] as const;

test.describe('T-MCARD-080 — mobile Library and Waiting layouts in a real browser (#467, #470)', () => {
  for (const width of WIDTHS) {
    describe(`at ${String(width)}px`, () => {
      test('T-MCARD-080a: the Library grid is a poster grid unlike its list', async ({ page }) => {
        await page.setViewportSize({ width, height: 1000 });
        await stubApi(page);
        await page.goto('/');
        const list = page.getByTestId('title-list');
        await page.getByRole('button', { name: 'Grid view', exact: true }).click();
        await expect(list).toHaveAttribute('data-view', 'grid');
        const rows = '[data-testid="title-list"] > li';
        await expect(page.locator(rows)).toHaveCount(LIBRARY_TITLES.length);
        const grid = await boxes(page, rows);
        const [first, second] = grid;
        // Two (or more) columns from the first line of the grid.
        expect(Math.round(second!.y)).toBe(Math.round(first!.y));
        if (width < 640) {
          const columns = grid.filter((box) => Math.round(box.y) === Math.round(first!.y));
          expect(columns).toHaveLength(2);
          // Poster-first: a tall card, narrower than the viewport's 55 %, not a flat row.
          expect(first!.height).toBeGreaterThan(first!.width);
          expect(first!.width).toBeLessThan(width * 0.55);
        }
        await noOverflow(page);

        await page.getByRole('button', { name: 'Compact view', exact: true }).click();
        await expect(list).toHaveAttribute('data-view', 'compact');
        const compact = await boxes(page, rows);
        if (width < 1024) {
          // The list is one card per line and clearly shorter than a poster card.
          expect(compact[1]!.y).toBeGreaterThan(compact[0]!.y + compact[0]!.height - 1);
          expect(compact[0]!.height).toBeLessThan(first!.height);
        }
        await noOverflow(page);
      });

      test('T-MCARD-080b: the Waiting grid has equal-height cards and no clipped or broken text', async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 1200 });
        await stubApi(page);
        await page.goto('/waiting');
        await page.getByRole('button', { name: 'Grid view' }).click();
        await expect(page.getByTestId('waiting-list')).toHaveAttribute('data-view', 'grid');
        const rows = '[data-testid="waiting-row"]';
        await expect(page.locator(rows)).toHaveCount(4);
        const cards = await boxes(page, rows);
        const firstLine = cards.filter((box) => Math.round(box.y) === Math.round(cards[0]!.y));
        if (width < 640) expect(firstLine).toHaveLength(2);
        else expect(firstLine.length).toBeGreaterThanOrEqual(2);
        for (const box of firstLine) {
          expect(Math.abs(box.height - firstLine[0]!.height)).toBeLessThanOrEqual(1);
        }
        // The data's ALL-CAPS title is shown in sentence case.
        const name = await page.getByTestId('waiting-name').first().innerText();
        expect(name).not.toBe(name.toUpperCase());
        expect(await textProblems(page, rows)).toEqual([]);
        await noOverflow(page);
      });

      test('T-MCARD-080c: Waiting compact rows are Library-list dense and keep Not interested', async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 1200 });
        await stubApi(page);
        await page.goto('/');
        await page.getByRole('button', { name: 'Compact view', exact: true }).click();
        const library = await boxes(page, '[data-testid="title-list"] > li');
        await page.goto('/waiting');
        const rows = '[data-testid="waiting-row"]';
        await expect(page.locator(rows)).toHaveCount(4);
        const waiting = await boxes(page, rows);
        // The plain row (poster, title, meta, menu) is never taller than a Library row.
        const plain = waiting[3]!;
        const shortest = Math.min(...library.map((box) => box.height));
        if (width < 1024) expect(plain.height).toBeLessThanOrEqual(shortest + 8);
        else expect(plain.height).toBeLessThanOrEqual(140);
        expect(await textProblems(page, rows)).toEqual([]);

        const menu = page.getByTestId('waiting-row-menu').first();
        expect((await menu.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await menu.click();
        await expect(page.getByTestId('waiting-not-interested')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('waiting-not-interested')).toHaveCount(0);
        await noOverflow(page);
      });
    });
  }

  test('T-MCARD-080d: the as-of date is said once on the page, not on every card', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 1000 });
    await stubApi(page);
    await page.goto('/waiting');
    await expect(page.getByTestId('waiting-asof-note')).toContainText(
      'Not seen on your services as of 1 Feb 2026.',
    );
    const visibleCopies = await page.getByText(/Not seen on your services as of/).evaluateAll(
      (els) =>
        els.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 2 && r.height > 2;
        }).length,
    );
    expect(visibleCopies).toBe(1);
  });
});
