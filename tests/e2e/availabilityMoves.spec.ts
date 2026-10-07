/**
 * T-MOVE-016 — availability moves in real browsers (US-063, PRD `A54`,
 * `specs/ui.md` §5.12), on a phone width and a desktop width.
 *
 * The component cases (`T-MOVE-010`..`012`) prove the sentence and which
 * endpoint each button calls. What jsdom cannot answer is whether the marker
 * is VISIBLE on the Library row at both widths, whether the details panel's
 * answers are 44 px targets that fit a phone, and whether the move round-trips
 * through the real client to the right request.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const { describe } = test;

const availability = {
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

const item = {
  titleId: 'housemaid',
  workIdentity: 'tmdb:movie:1100',
  matchState: 'matched',
  name: 'The Housemaid',
  mediaType: 'movie',
  releaseYear: 2025,
  genres: ['Thriller'],
  runtimeMinutes: 131,
  posterPath: null,
  imdbRating: 7.1,
  listState: 'active',
  badges: [{ service: 'starz', listingId: 'listing-starz', dateAdded: '2026-01-05' }],
  sortDateAdded: '2026-01-05',
  dateAddedLabel: 'Added to nextup on 5 Jan 2026',
  availability,
  presentation: {
    status: 'available',
    data: {
      tmdbId: 1100,
      mediaType: 'movie',
      overview: 'An invented overview.',
      directors: [],
      creators: [],
      fetchedAt: '2026-09-22T00:00:00.000Z',
      cast: [],
    },
  },
};

const waitingItem = {
  intentId: 'wi-1',
  titleId: 'waiting-title',
  workIdentity: 'tmdb:movie:2200',
  name: 'Now Streaming Film',
  releaseYear: 2025,
  posterPath: null,
  discoveredAt: '2026-01-04',
  discoverySource: 'search',
  availableOn: ['Netflix'],
  flaggedOn: ['netflix'],
  availabilityCheckedAt: '2026-09-20T00:00:00.000Z',
  availabilityRegion: 'US',
};

async function mock(page: Page): Promise<string[]> {
  const writes: string[] = [];
  let moved = false;
  let promoted = false;
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
        json = { items: moved ? [] : [item], nextCursor: null, limit: 50, runtimeUnknownHidden: 0 };
        break;
      case '/api/titles/housemaid':
        json = moved
          ? { ...item, listState: 'removed', badges: [], availability: undefined }
          : item;
        break;
      case '/api/titles/housemaid/move-to-waiting':
        moved = true;
        json = {
          titleId: 'housemaid',
          intentId: 'wi-moved',
          removedListingIds: ['listing-starz'],
          removedAt: '2026-09-29T00:00:00.000Z',
        };
        break;
      case '/api/waiting':
        json = {
          count: promoted ? 0 : 1,
          availabilityRefreshFailed: false,
          items: promoted ? [] : [waitingItem],
        };
        break;
      case '/api/waiting/wi-1/promote':
        promoted = true;
        json = {
          intentId: 'wi-1',
          titleId: 'new-title',
          listingId: 'listing-new',
          service: 'netflix',
          dateAdded: '2026-09-29',
          titleWasCreated: true,
        };
        await route.fulfill({ status: 201, json });
        return;
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
    const box = await page.getByTestId(id).boundingBox();
    expect(box?.height ?? 0, id).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const width of [390, 1440]) {
  describe(`availability moves at ${String(width)}px`, () => {
    test('T-MOVE-016a: the Library row shows the fact and the details page moves it to Waiting', async ({
      page,
    }) => {
      const writes = await mock(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await expect(page.getByTestId('availability-chip')).toHaveText(
        'Left Starz — now rent-only on Apple TV',
      );
      // Showing the fact wrote nothing (invariant 5).
      expect(writes).toEqual([]);

      await page.goto('/titles/housemaid');
      const panel = page.getByTestId('availability-panel');
      await expect(panel).toBeVisible();
      await expect(page.getByTestId('availability-attribution')).toBeVisible();
      await assertTargets(page, [
        'availability-remove-starz',
        'availability-move-to-waiting',
        'availability-keep',
      ]);
      expect(
        (await new AxeBuilder({ page }).include('[data-testid="availability-panel"]').analyze())
          .violations,
      ).toEqual([]);

      await page.getByTestId('availability-move-to-waiting').click();
      await expect(page.getByTestId('availability-notice')).toContainText('Waiting');
      expect(writes).toEqual(['POST /api/titles/housemaid/move-to-waiting']);
    });

    test('T-MOVE-016b: a now-streaming waiting row is added to the Library with one tap', async ({
      page,
    }) => {
      const writes = await mock(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/waiting');
      const add = page.getByTestId('waiting-promote-netflix');
      await expect(add).toBeVisible();
      await assertTargets(page, ['waiting-promote-netflix']);
      await add.click();
      await expect(page.getByTestId('waiting-promote-netflix')).toHaveCount(0);
      expect(writes).toEqual(['POST /api/waiting/wi-1/promote']);
    });
  });
}
