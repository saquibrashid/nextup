/**
 * T-AVREV-016 — the "Availability changes" screen in real browsers (US-064,
 * PRD `A55`, `specs/ui.md` §5.13), on a phone width and a desktop width.
 *
 * The component cases (`T-AVREV-009`..`015`) prove the sections, selection,
 * confirmation and results. What jsdom cannot answer is whether the Library's
 * factual line leads here at both widths, whether the checkboxes and answers
 * are 44 px targets that fit a phone without sideways scrolling, and whether
 * the bulk answer and "Check more titles" round-trip through the real client
 * as exactly one request each.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const { describe } = test;

const left = {
  accessState: 'rent-only',
  checkedAt: '2026-09-20T10:00:00.000Z',
  region: 'US',
  streamingOn: [],
  rentOn: ['Apple TV'],
  left: ['starz'],
  joined: [],
  signature: 'left=starz;joined=',
  kept: false,
  canMoveToWaiting: true,
};

function libraryItem(id: string, name: string) {
  return {
    titleId: id,
    workIdentity: `tmdb:movie:${id}`,
    name,
    releaseYear: 2025,
    posterPath: null,
    badges: [{ service: 'starz', listingId: `listing-${id}`, dateAdded: '2026-01-05' }],
    availability: left,
  };
}

const listItem = {
  titleId: 'housemaid',
  workIdentity: 'tmdb:movie:housemaid',
  matchState: 'matched',
  name: 'The Housemaid',
  mediaType: 'movie',
  releaseYear: 2025,
  genres: ['Thriller'],
  runtimeMinutes: 131,
  posterPath: null,
  listState: 'active',
  badges: [{ service: 'starz', listingId: 'listing-housemaid', dateAdded: '2026-01-05' }],
  sortDateAdded: '2026-01-05',
  dateAddedLabel: 'Added to nextup on 5 Jan 2026',
  availability: left,
};

const waitingItem = {
  intentId: 'wi-1',
  titleId: 'waiting-title',
  workIdentity: 'tmdb:movie:2200',
  name: 'Now Streaming Film',
  releaseYear: 2025,
  posterPath: null,
  flaggedOn: ['netflix'],
  service: 'netflix',
  availabilityCheckedAt: '2026-09-20T00:00:00.000Z',
  availabilityRegion: 'US',
};

async function mock(page: Page): Promise<string[]> {
  const writes: string[] = [];
  let removed = false;
  let check = { checked: 142, notCheckedRecently: 37 };
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') writes.push(`${request.method()} ${path}`);
    let json: unknown;
    switch (path) {
      case '/api/me':
        json = { ownerId: 'fixture-owner', displayName: 'Fixture', signOutUrl: '/.auth/logout' };
        break;
      case '/api/batches':
        json = { batches: [] };
        break;
      case '/api/titles':
        json = { items: [listItem], nextCursor: null, limit: 50, runtimeUnknownHidden: 0 };
        break;
      case '/api/availability/review/summary':
        json = { count: 3 };
        break;
      case '/api/availability/review':
        json = {
          library: removed
            ? [libraryItem('arrival', 'Arrival')]
            : [libraryItem('housemaid', 'The Housemaid'), libraryItem('arrival', 'Arrival')],
          nowStreaming: [waitingItem],
          check,
        };
        break;
      case '/api/availability/review/apply':
        removed = true;
        json = {
          action: 'remove-left-badges',
          results: [
            { id: 'housemaid', outcome: 'done' },
            {
              id: 'arrival',
              outcome: 'refused',
              code: 'AVAILABILITY_CHANGED',
              message: 'Its availability changed since this screen loaded.',
            },
          ],
          done: 1,
          refused: 1,
        };
        break;
      case '/api/availability/check':
        check = { checked: 162, notCheckedRecently: 17 };
        json = { lookedUp: 20, failed: 0, ...check };
        break;
      case '/api/service-state':
        json = { services: [] };
        break;
      default:
        json = { items: [] };
    }
    await route.fulfill({ json });
  });
  return writes;
}

async function assertTargets(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    const box = await page.getByTestId(id).first().boundingBox();
    expect(box?.height ?? 0, id).toBeGreaterThanOrEqual(44);
  }
  for (const label of await page.locator('label:has([data-testid="avrev-select"])').all()) {
    expect((await label.boundingBox())?.height ?? 0, 'row checkbox').toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const width of [390, 1440]) {
  describe(`availability changes at ${String(width)}px`, () => {
    test('T-AVREV-016a: the Library line leads to the screen; a confirmed bulk removal reports per row', async ({
      page,
    }) => {
      const writes = await mock(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const line = page.locator('[data-testid="library-availability-count"]:visible');
      await expect(line).toHaveText('3 availability changes');
      // Reading the count wrote nothing (invariant 5).
      expect(writes).toEqual([]);
      await line.click();
      await expect(page).toHaveURL(/\/availability$/);

      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Availability changes');
      await expect(
        page.getByRole('heading', { name: 'Library titles that changed' }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Waiting titles now streaming' }),
      ).toBeVisible();
      await expect(page.getByTestId('avrev-attribution')).toBeVisible();
      await assertTargets(page, [
        'avrev-check-more',
        'avrev-bulk-keep',
        'avrev-bulk-remove-left-badges',
        'availability-keep',
        'avrev-promote-netflix',
      ]);
      expect((await new AxeBuilder({ page }).include('.avrev').analyze()).violations).toEqual([]);

      await page.getByTestId('avrev-select-all-library').check();
      await page.getByTestId('avrev-bulk-remove-left-badges').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
      await page.getByTestId('avrev-confirm').click();
      await expect(page.getByTestId('avrev-result')).toContainText(
        "1 done, 1 couldn't be changed.",
      );
      await expect(page.getByTestId('avrev-row-reason')).toHaveText(
        'Its availability changed since this screen loaded.',
      );
      await expect(page.getByTestId('avrev-library-row')).toHaveCount(1);
      await expect(page.getByTestId('avrev-result').getByRole('link')).toHaveAttribute(
        'href',
        '/removed',
      );
      expect(writes).toEqual(['POST /api/availability/review/apply']);
    });

    test('T-AVREV-016b: one "Check more titles" tap is one request and the counts re-render', async ({
      page,
    }) => {
      const writes = await mock(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/availability');
      await expect(page.getByTestId('avrev-check-counts')).toHaveText(
        '142 titles checked · 37 not checked recently',
      );
      await page.getByTestId('avrev-check-more').click();
      await expect(page.getByTestId('avrev-check-counts')).toHaveText(
        '162 titles checked · 17 not checked recently',
      );
      await expect(page.getByTestId('avrev-live')).toContainText('Checked 20.');
      expect(writes).toEqual(['POST /api/availability/check']);
    });
  });
}
