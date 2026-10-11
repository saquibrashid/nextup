/**
 * T-RECHECK-010 — "Check now" and "Re-check everything" in real browsers
 * (US-068, PRD `A59`, `specs/ui.md` §7d), on a phone width and a desktop
 * width.
 *
 * jsdom cannot answer whether the new controls are 44 px targets that fit a
 * phone without sideways scrolling, or whether one press is exactly one
 * request through the real client and the refreshed marker appears with no
 * manual reload.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const { describe } = test;

const stale = {
  accessState: 'streaming',
  checkedAt: '2026-09-01T10:00:00.000Z',
  region: 'US',
  streamingOn: ['starz'],
  rentOn: [],
  left: [],
  joined: [],
  signature: 'left=;joined=',
  kept: false,
  canMoveToWaiting: false,
};

const fresh = {
  ...stale,
  checkedAt: new Date().toISOString(),
  streamingOn: ['starz', 'max'],
  joined: ['max'],
  signature: 'left=;joined=max',
};

function detail(availability: unknown) {
  return {
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
    presentation: { status: 'unavailable', data: null },
    availability,
  };
}

async function mock(page: Page): Promise<string[]> {
  const writes: string[] = [];
  let checked = false;
  let walks = 0;
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== 'GET') writes.push(`${request.method()} ${path}`);
    let json: unknown;
    switch (path) {
      case '/api/me':
        json = { ownerId: 'fixture-owner', displayName: 'Fixture', signOutUrl: '/.auth/logout' };
        break;
      case '/api/titles/housemaid':
        json = detail(checked ? fresh : stale);
        break;
      case '/api/titles/housemaid/availability/check':
        checked = true;
        json = {
          id: 'housemaid',
          checkedAt: fresh.checkedAt,
          region: 'US',
          availableOn: ['starz', 'max'],
          rentOn: null,
          accessState: 'streaming',
        };
        break;
      case '/api/availability/review':
        json = {
          library: [],
          nowStreaming: [],
          check: { checked: 130, notCheckedRecently: 0 },
        };
        break;
      case '/api/availability/check': {
        walks += 1;
        const done = walks > 1;
        json = {
          lookedUp: done ? 30 : 20,
          failed: 0,
          checked: 130,
          notCheckedRecently: 0,
          recheck: {
            since: '2026-10-05T12:00:00.000Z',
            cursor: done ? 'c2' : 'c1',
            total: 50,
            remaining: done ? 0 : 30,
            processed: done ? 50 : 20,
            done,
          },
        };
        break;
      }
      default:
        json = { items: [] };
    }
    await route.fulfill({ json });
  });
  return writes;
}

async function assertFits(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    const box = await page.getByTestId(id).first().boundingBox();
    expect(box?.height ?? 0, id).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

for (const width of [390, 1440]) {
  describe(`re-check at ${String(width)}px`, () => {
    test('T-RECHECK-010a: Check now is one request and reveals the Add badge without a reload', async ({
      page,
    }) => {
      const writes = await mock(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/titles/housemaid');
      await expect(page.getByTestId('availability-add-max')).toHaveCount(0);
      // Opening the page wrote nothing (invariant 5).
      expect(writes).toEqual([]);
      await assertFits(page, ['check-now-button']);
      expect(
        (await new AxeBuilder({ page }).include('.title-details').analyze()).violations,
      ).toEqual([]);
      await page.getByTestId('check-now-button').click();
      await expect(page.getByTestId('availability-add-max')).toBeVisible();
      await expect(page.getByTestId('check-now-fact')).toHaveText('Checked just now');
      expect(writes).toEqual(['POST /api/titles/housemaid/availability/check']);
    });

    test('T-RECHECK-010b: Re-check everything walks 20 then the rest, showing N of M', async ({
      page,
    }) => {
      const writes = await mock(page);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/availability');
      await assertFits(page, ['avrev-recheck-all']);
      await page.getByTestId('avrev-recheck-all').click();
      await expect(page.getByTestId('avrev-recheck-progress')).toHaveText('20 of 50 re-checked');
      await page.getByTestId('avrev-recheck-all').click();
      await expect(page.getByTestId('avrev-recheck-progress')).toHaveText(
        'Everything has been re-checked.',
      );
      expect(writes).toEqual(['POST /api/availability/check', 'POST /api/availability/check']);
    });
  });
}
