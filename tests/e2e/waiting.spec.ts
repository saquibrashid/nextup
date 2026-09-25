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
    const body = url.includes('/me')
      ? ME
      : url.includes('/waiting')
        ? waiting
        : url.includes('/batches')
          ? { batches: [] }
          : { items: [] };
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

    // ⚠ THE ACTION MUST BE REACHABLE, NOT MERELY DESCRIBED. "Import a
    // storefront screenshot" as prose is advice; as a link it is the way out
    // of the empty state, which is what AC-6 asks for. #378: it lands on the
    // STOREFRONT import, not a service picker with no storefront in it.
    const action = empty.getByRole('link');
    await expect(action).toBeVisible();
    await action.click();
    await expect(page).toHaveURL(/\/upload\?source=fandango-at-home$/);
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

const WAITING_EVERY_STATE = {
  count: 3,
  availabilityRefreshFailed: false,
  items: [
    {
      ...WAITING_WITH_ROWS.items[0],
      intentId: 'wi_rent',
      name: 'A title with an unusually long name that has to wrap on a narrow phone',
      availableOn: [],
      flaggedOn: [],
      otherServicesOn: [],
      otherProvidersOn: [],
      rentOn: ['Apple TV', 'Amazon Video', 'Fandango At Home', 'Google Play Movies'],
      accessState: 'rent-only',
      streamingSince: null,
    },
    {
      ...WAITING_WITH_ROWS.items[0],
      intentId: 'wi_other',
      titleId: 'ttl_2',
      discoverySource: 'search',
      availableOn: ['Hulu', 'Max'],
      flaggedOn: [],
      otherServicesOn: ['max'],
      otherProvidersOn: ['Hulu'],
      rentOn: [],
      accessState: 'streaming',
      streamingSince: '2026-02-01T00:00:00.000Z',
    },
    {
      ...WAITING_WITH_ROWS.items[0],
      intentId: 'wi_yours',
      titleId: 'ttl_3',
      discoverySource: 'prime-video-store',
      availableOn: ['Netflix'],
      flaggedOn: ['netflix'],
      otherServicesOn: [],
      otherProvidersOn: [],
      rentOn: [],
      accessState: 'streaming',
      streamingSince: '2026-02-03T00:00:00.000Z',
    },
  ],
};

test.describe('T-WAIT-018 — waiting to stream in a real browser (#378)', () => {
  test('T-WAIT-018a: the empty action opens the storefront import, answered, with no overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 280, height: 900 });
    await stubApi(page, WAITING_EMPTY);
    await page.goto('/waiting');
    await page.getByTestId('waiting-empty').getByRole('link').click();

    await expect(page.getByTestId('service-step-panel-answer')).toContainText(
      'Fandango at Home (rent/buy)',
    );
    await expect(page.getByTestId('mode-card-append-only').locator('input')).toBeChecked();
    await expect(page.getByTestId('mode-card-full-update').locator('input')).toBeDisabled();
    // Reopened, the chosen storefront is shown in its own group, apart from
    // the services.
    await page.getByTestId('service-step-panel-change').click();
    await expect(page.getByTestId('storefront-step')).toBeVisible();
    await expect(
      page.getByTestId('storefront-option-fandango-at-home').locator('input'),
    ).toBeChecked();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('T-WAIT-018b: every access state reads in words and nothing overflows at 280px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 280, height: 900 });
    await stubApi(page, WAITING_EVERY_STATE);
    await page.goto('/waiting');
    await expect(page.getByTestId('waiting-row')).toHaveCount(3);

    // The row on the owner's own service leads, badged in words.
    const first = page.getByTestId('waiting-row').first();
    await expect(first.getByTestId('waiting-streaming-badge')).toHaveText('Now streaming');
    await expect(first.getByTestId('waiting-flag-link')).toHaveAttribute(
      'href',
      '/upload?service=netflix',
    );
    await expect(page.getByTestId('waiting-rent-only')).toContainText('(rent/buy)');
    await expect(page.getByTestId('waiting-other-services')).toContainText(
      '(not one of your services)',
    );
    await expect(page.getByTestId('waiting-search')).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

/* ── #380 — when and where it is expected to stream ──────────────────── */

const WAITING_FORECAST = {
  count: 2,
  availabilityRefreshFailed: false,
  items: [
    {
      ...WAITING_WITH_ROWS.items[0],
      intentId: 'wi_est',
      name: 'Wicked: For Good',
      availableOn: [],
      flaggedOn: [],
      accessState: 'rent-only',
      rentOn: ['Apple TV'],
      forecast: { kind: 'estimate', service: 'peacock', month: '2027-01', yours: false },
    },
    {
      ...WAITING_WITH_ROWS.items[0],
      intentId: 'wi_ann',
      name: 'Zootopia 2',
      availableOn: [],
      flaggedOn: [],
      forecast: { kind: 'announced', service: 'disney-plus', on: '2099-03-04', yours: true },
    },
  ],
};

test.describe('T-FORECAST-008 — the forecast on the waiting view', () => {
  test('T-FORECAST-008a: an estimate says so, an announcement reads as a date, and Watchmode is credited', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 280, height: 900 });
    for (const waiting of [WAITING_FORECAST, WAITING_EMPTY]) {
      await stubApi(page, waiting);
      await page.goto('/waiting');
      await expect(page.locator('.app-shell')).toBeVisible();

      if (waiting === WAITING_FORECAST) {
        const lines = page.getByTestId('waiting-forecast');
        await expect(lines).toHaveCount(2);
        await expect(lines.first()).toHaveText(
          'Estimate: likely on Peacock (not one of your services) around Jan 2027',
        );
        await expect(lines.nth(1)).toHaveText('Streaming on Disney+ from Mar 4, 2099');
      }

      // Unconditional, like JustWatch's: a condition of the free plan.
      const attribution = page.getByTestId('watchmode-attribution');
      await expect(attribution).toBeVisible();
      await expect(attribution.getByRole('link')).toHaveAttribute(
        'href',
        'https://www.watchmode.com/',
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await page.unrouteAll();
    }
  });
});
