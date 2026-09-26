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
      'Not seen on your services as of 1 Feb 2026.',
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
    await expect(page.getByTestId('waiting-rent-tag')).toHaveText('Rent or buy only');
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

/* ── #382 — the Library look, at the owner's three widths ────────────── */

const WAITING_RESTYLE = {
  count: 3,
  availabilityRefreshFailed: false,
  items: [
    WAITING_FORECAST.items[0],
    WAITING_FORECAST.items[1],
    { ...WAITING_EVERY_STATE.items[2], name: 'Arrived' },
  ],
};

async function checkRestyle(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 1000 });
  await stubApi(page, WAITING_RESTYLE);
  await page.goto('/waiting');
  const rows = page.getByTestId('waiting-row');
  await expect(rows).toHaveCount(3);

  // One page heading; the helper is its subtitle.
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Waiting to stream');
  await expect(page.getByTestId('waiting-subtitle')).toBeVisible();

  // Library poster sizes: 72 px on a phone, 96 px from 640 px.
  const poster = await rows.first().locator('.waiting-row__poster').boundingBox();
  expect(Math.round(poster?.width ?? 0)).toBe(width >= 640 ? 96 : 72);

  // The forecast headline is visible and carries its tag in words.
  const head = rows.nth(1).locator('.waiting-row__outlook-head');
  await expect(head).toBeVisible();
  await expect(head.locator('.waiting-row__tag')).toHaveText(/estimate/i);

  // "Not interested" keeps the 44 px target but is no longer card-wide.
  for (let index = 0; index < 3; index += 1) {
    const row = await rows.nth(index).boundingBox();
    const button = await rows.nth(index).getByTestId('waiting-not-interested').boundingBox();
    expect(button?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(button?.width ?? 0).toBeLessThan((row?.width ?? 0) * 0.6);
  }

  // #389 — one card per line; the panel sits beside the details from 1024 px
  // and under them below it.
  const first = await rows.nth(0).boundingBox();
  const second = await rows.nth(1).boundingBox();
  expect(second?.y ?? 0).toBeGreaterThan((first?.y ?? 0) + (first?.height ?? 0) - 1);
  const body = await rows.nth(1).locator('.waiting-row__body').boundingBox();
  const aside = await rows.nth(1).locator('.waiting-row__aside').boundingBox();
  if (width >= 1024) expect(aside?.x ?? 0).toBeGreaterThan((body?.x ?? 0) + (body?.width ?? 0) - 1);
  else expect(aside?.y ?? 0).toBeGreaterThan(body?.y ?? 0);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe('T-WAIT-021 — the restyled waiting view in a real browser (#382)', () => {
  test('T-WAIT-021a: cards, posters, forecast headline and a small Not interested at 320px', async ({
    page,
  }) => {
    await checkRestyle(page, 320);
  });
  test('T-WAIT-021b: cards, posters, forecast headline and a small Not interested at 640px', async ({
    page,
  }) => {
    await checkRestyle(page, 640);
  });
  test('T-WAIT-021c: cards, posters, forecast headline and a small Not interested at 1280px', async ({
    page,
  }) => {
    await checkRestyle(page, 1280);
  });
});

/* ── #391 — Grid view, and a details page with the trailer ───────────── */

const WAITING_VIEWS = {
  count: 3,
  availabilityRefreshFailed: false,
  items: WAITING_RESTYLE.items.map((item, index) => ({
    ...item,
    titleId: `ttl_view_${String(index)}`,
  })),
};

const WAITING_TITLE = {
  titleId: 'ttl_view_0',
  workIdentity: 'tmdb:movie:967941',
  matchState: 'matched',
  name: 'Wicked: For Good',
  mediaType: 'movie',
  releaseYear: 2025,
  genres: ['Fantasy', 'Music'],
  runtimeMinutes: 137,
  posterPath: null,
  imdbRating: 6.9,
  listState: 'removed',
  badges: [],
  sortDateAdded: null,
  dateAddedLabel: null,
  presentation: {
    status: 'available',
    data: {
      tmdbId: 967941,
      mediaType: 'movie',
      overview: 'The story continues.',
      tagline: 'Everyone deserves a chance to fly.',
      directors: ['Jon M. Chu'],
      writers: ['Winnie Holzman', 'Dana Fox'],
      creators: [],
      cast: [{ name: 'Cynthia Erivo', character: 'Elphaba' }],
      releaseDate: '2025-11-21',
      status: 'Released',
      certification: 'PG',
      seasons: null,
      episodes: null,
      trailer: {
        key: 'abcDEF12345',
        name: 'Official Trailer',
        kind: 'Trailer',
        publishedAt: '2026-01-01T00:00:00.000Z',
      },
      fetchedAt: '2026-09-22T00:00:00.000Z',
    },
  },
};

async function stubViews(page: Page): Promise<void> {
  await stubApi(page, WAITING_VIEWS);
  await page.route('**/api/titles/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(WAITING_TITLE),
    });
  });
}

async function noOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function checkGrid(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 1000 });
  await stubViews(page);
  await page.goto('/waiting');
  await page.getByRole('button', { name: 'Grid view' }).click();
  const list = page.getByTestId('waiting-list');
  await expect(list).toHaveAttribute('data-view', 'grid');
  const rows = page.getByTestId('waiting-row');
  await expect(rows).toHaveCount(3);

  // Tiles sit side by side — at least two across even at 320 px.
  const first = await rows.nth(0).boundingBox();
  const second = await rows.nth(1).boundingBox();
  expect(Math.round(second?.y ?? -1)).toBe(Math.round(first?.y ?? -2));
  expect(second?.x ?? 0).toBeGreaterThan((first?.x ?? 0) + (first?.width ?? 0) - 1);

  // The answer and the 44 px Not interested survive the tile.
  await expect(rows.nth(1).getByTestId('waiting-forecast')).toBeVisible();
  for (let index = 0; index < 3; index += 1) {
    const button = await rows.nth(index).getByTestId('waiting-not-interested').boundingBox();
    expect(button?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await noOverflow(page);

  // The choice survives a reload.
  await page.reload();
  await expect(page.getByTestId('waiting-list')).toHaveAttribute('data-view', 'grid');
}

test.describe('T-WAIT-025 — Grid view and the waiting details page in a real browser (#391)', () => {
  test('T-WAIT-025a: Grid tiles at 320px, two across, nothing overflows', async ({ page }) => {
    await checkGrid(page, 320);
  });
  test('T-WAIT-025b: Grid tiles at 1280px, nothing overflows', async ({ page }) => {
    await checkGrid(page, 1280);
  });
  test('T-WAIT-025c: a title opens its details page with every detail and a trailer link out', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 1000 });
    await stubViews(page);
    await page.goto('/waiting');
    await page.getByRole('link', { name: 'Wicked: For Good' }).click();
    await expect(page).toHaveURL(/\/waiting\/ttl_view_0$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Wicked: For Good');
    await expect(page.getByText('2h 17m')).toBeVisible();
    await expect(page.getByText('Jon M. Chu')).toBeVisible();
    await expect(page.getByText('Cynthia Erivo')).toBeVisible();
    await expect(page.getByTestId('title-facts')).toContainText('Winnie Holzman');
    await expect(page.getByTestId('waiting-forecast')).toBeVisible();
    await expect(page.getByTestId('justwatch-attribution')).toBeVisible();

    const trailer = page.getByTestId('title-trailer');
    await expect(trailer).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcDEF12345');
    await expect(trailer).toHaveAttribute('target', '_blank');
    await expect(trailer).toHaveAttribute('rel', 'noopener noreferrer');
    expect((await trailer.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await expect(page.locator('iframe')).toHaveCount(0);
    await noOverflow(page);

    await page.getByRole('link', { name: 'Back to Waiting to stream' }).click();
    await expect(page).toHaveURL(/\/waiting$/);
    await expect(page.getByTestId('waiting-row')).toHaveCount(3);
  });
});
