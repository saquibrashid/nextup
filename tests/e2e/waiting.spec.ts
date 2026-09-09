/**
 * `T-AVAIL-009` and `T-WAIT-010` — the waiting view in a real browser
 * (US-042 AC-9, US-043 AC-6, REQ-087).
 *
 * ⚠ **THE JUSTWATCH ATTRIBUTION IS A CONDITION OF USE, AND ITS ABSENCE IS
 * INVISIBLE FROM INSIDE THE PRODUCT** — exactly like the TMDB obligation
 * `tests/e2e/attribution.spec.ts` guards. Nothing errors, nothing logs, the
 * screen looks completely healthy. It is asserted here, in a browser, against
 * the real stylesheet, because the ways it actually breaks are the ways jsdom
 * cannot see: a rule that hides it, a footer clipped out of the viewport, a
 * component that renders it only when a row happens to carry provider data.
 *
 * ⚠ **`T-WAIT-010` IS ABOUT AN EMPTY SCREEN, WHICH IS THE HARDEST THING TO
 * TEST BADLY-BUT-VISIBLY.** A waiting view with nothing in it and no
 * explanation is indistinguishable from a broken one. The assertion is
 * therefore that the empty state says what the view is FOR and offers a way to
 * fill it — not merely that the page loaded.
 */

import { expect, test, type Page } from '@playwright/test';

const ME = { ownerId: 'o_test', email: 'owner@example.com' };

const WAITING_WITH_ROWS = {
  count: 1,
  availabilityRefreshFailed: false,
  items: [
    {
      intentId: 'wi_1',
      titleId: 'ttl_1',
      workIdentity: 'tmdb:movie:438631',
      name: 'Dune',
      releaseYear: 2021,
      posterPath: null,
      discoveredAt: '2026-01-04',
      discoverySource: 'fandango-at-home',
      availableOn: null,
      flaggedOn: null,
      availabilityCheckedAt: '2026-02-01T00:00:00.000Z',
      availabilityRegion: 'US',
    },
  ],
};

const WAITING_EMPTY = { count: 0, availabilityRefreshFailed: false, items: [] };

/**
 * ⚠ `/api/me` MUST BE SERVED. `OwnerGate` settles it before the router mounts,
 * so an unstubbed `/me` leaves the whole app on its "checking your access"
 * screen and every assertion below fails for a reason that has nothing to do
 * with the waiting view.
 */
async function stubApi(page: Page, waiting: unknown): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const body = url.includes('/me') ? ME : url.includes('/waiting') ? waiting : { items: [] };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

test.describe('T-AVAIL-009 — the JustWatch attribution on the waiting view', () => {
  test('T-AVAIL-009a: the attribution is visible whether or not any row has provider data', async ({
    page,
  }) => {
    // ⚠ BOTH STATES, IN ONE TEST. Rendering the attribution beside the rows —
    // the natural, wrong implementation — passes on the populated screen and
    // fails only on the empty one, which is the screen a casual check skips.
    for (const waiting of [WAITING_WITH_ROWS, WAITING_EMPTY]) {
      await stubApi(page, waiting);
      await page.goto('/waiting');
      await expect(page.locator('.app-shell')).toBeVisible();

      const attribution = page.getByTestId('justwatch-attribution');
      await expect(attribution).toBeVisible();
      await expect(attribution).toHaveText('Streaming availability data provided by JustWatch.');

      // Quiet is allowed; hidden is not. A zero-height or clipped node reads as
      // "visible" to a naive check but discharges no obligation at all.
      const box = await attribution.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThan(4);
      await page.unrouteAll();
    }
  });
});

test.describe('T-WAIT-010 — the empty waiting view explains itself', () => {
  test('T-WAIT-010a: an empty view names what it is for and offers a way to fill it', async ({
    page,
  }) => {
    await stubApi(page, WAITING_EMPTY);
    await page.goto('/waiting');
    await expect(page.locator('.app-shell')).toBeVisible();

    const empty = page.getByTestId('waiting-empty');
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("You aren't waiting on anything yet.");

    // ⚠ THE ACTION MUST BE REACHABLE, NOT MERELY DESCRIBED. "Upload a
    // storefront screenshot" as prose is advice; as a link it is the way out
    // of the empty state, which is what AC-6 asks for.
    const action = empty.getByRole('link');
    await expect(action).toBeVisible();
    await action.click();
    await expect(page).toHaveURL(/\/upload$/);
  });

  test('T-WAIT-010e: a populated view shows the row instead of the empty state', async ({
    page,
  }) => {
    // The discriminating half: without it, `010a` passes against a build whose
    // waiting view is permanently empty because the fetch never lands.
    await stubApi(page, WAITING_WITH_ROWS);
    await page.goto('/waiting');
    await expect(page.locator('.app-shell')).toBeVisible();

    await expect(page.getByTestId('waiting-row')).toHaveCount(1);
    await expect(page.getByTestId('waiting-empty')).toHaveCount(0);
    await expect(page.getByTestId('waiting-availability')).toContainText(
      'Not seen on your services as of 2026-02-01.',
    );
  });
});
