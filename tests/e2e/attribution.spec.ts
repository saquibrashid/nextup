/**
 * `T-ATTR-002`, `T-ATTR-003`, `T-ATTR-004` — the TMDB attribution obligation,
 * asserted in a real browser against the real build (US-011 AC-1/AC-3/AC-5,
 * `specs/ui.md` §8, NFR-013, TASK-026 + TASK-046).
 *
 * ⚠ THIS IS THE ONLY LAYER AT WHICH THE OBLIGATION IS REALLY TESTED.
 * `T-ATTR-001` proves the constant, the API value and the rendered DOM string
 * are byte-equal — but it renders ONE component in jsdom, where nothing is
 * laid out, no stylesheet is applied and no image is ever fetched. Every way
 * this obligation actually breaks in production survives that test:
 *
 * - the footer is present but the logo file 404s (jsdom never requests it);
 * - the disclaimer is present but `display: none`, clipped, or ellipsised by
 *   a stylesheet rule (jsdom computes no layout);
 * - the shell renders the footer on eight routes and not the ninth.
 *
 * ⚠ AND ITS FAILURE IS INVISIBLE FROM INSIDE THE PRODUCT. `specs/ui.md` §8 is
 * blunt about this: nextup looks completely healthy with the attribution
 * missing. Nothing errors, nothing logs, no screen looks wrong. That is why
 * the obligation is asserted three separate ways rather than once.
 *
 * ⚠ THE ROUTE LIST IS ENUMERATED FROM `ROUTES`, NEVER RETYPED HERE
 * (`specs/testing.md` §9A). A literal list of nine paths keeps passing when a
 * tenth route ships — it simply stops covering it, silently, which is the
 * exact failure mode this suite exists to prevent. `T-UI-023a` is the test
 * that pins `ROUTES` itself; enumerating from it is what makes this file
 * honest.
 */

import { expect, test, type Page } from '@playwright/test';

import { TMDB_DISCLAIMER, TMDB_LOGO_PATH } from '@nextup/domain';
import { ROUTES } from '../../apps/web/src/routes';

/** §10.1's floor — the narrowest width NFR-006 mandates. */
const NARROW = { width: 320, height: 720 };

/**
 * Every screen the shell serves, catch-all included. The obligation is not
 * conditional on the route being a "real" one: a 404 screen renders the same
 * footer and is as much a page of this product as any other.
 */
const PATHS = ROUTES.map((route) => route.examplePath);

/**
 * ⚠ THE NINE-ROUTE COUNT IS ASSERTED, NOT ASSUMED. US-011 AC-1 and AC-5 both
 * say "all nine routes". If `ROUTES` grows or shrinks without this suite being
 * reconsidered, the per-route loop below still passes over whatever it finds —
 * so the shape of the set is pinned here, once.
 */
const NON_CATCH_ALL = ROUTES.filter((route) => route.path !== '*');

/**
 * The screens fetch on mount; without a stub they render their failure state.
 * That is not fatal to this suite — the footer is deliberately NOT gated on a
 * fetch — but a page stuck in a spinner is a poor place to assert layout from,
 * and an unstubbed run makes real outbound requests from CI.
 *
 * ⚠ THE TWO `/batches/:batchId…` SCREENS ARE SERVED A REAL ERROR ENVELOPE, NOT
 * A GENERIC `{}`. A batch id that does not exist is what those two routes
 * would genuinely meet here, and a malformed 200 is worse than useless: the
 * container reads fields off it, throws, and — because the SPA mounts no error
 * boundary — React unmounts the WHOLE tree including the footer. The suite
 * then reports a missing attribution on two routes when the real fault is in
 * the fixture. This is the same trap `tests/e2e/a11y.spec.ts` documents: a
 * wrong stub produces a real, shipped-looking failure.
 *
 * That the attribution survives on an error screen is not a concession — it is
 * the property `T-ATTR-002c` asserts directly, for the same reason.
 */
async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/api/batches/')) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'BATCH_NOT_FOUND', message: 'No such batch.', details: {} },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], services: [], nextCursor: null, limit: 50 }),
    });
  });
}

/**
 * ⚠ THE GUARD THAT MAKES EVERY OTHER ASSERTION HERE MEAN SOMETHING. A blank
 * document, or one whose stylesheet 404'd, would fail these assertions for the
 * wrong reason — or, worse, pass the "not clipped" checks trivially because
 * nothing is laid out at all.
 */
async function expectStyledAndRendered(page: Page): Promise<void> {
  /*
   * ⚠ WAIT FOR THE SHELL, NOT MERELY FOR A `<main>`. `OwnerGate` (TASK-028)
   * settles `GET /api/me` before the router mounts, and its "checking your
   * access" state is itself a `<main>` — so `getByRole('main')` alone goes
   * green while the product has not rendered at all. The per-route checks
   * below use non-retrying `isVisible()`, so they would then read a footer
   * that is a round trip away from existing and report every route as having
   * dropped the disclaimer. Waiting for `.app-shell` — which the gate
   * deliberately never renders — is what makes those reads meaningful.
   */
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByRole('main')).toBeVisible();
  const token = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(),
  );
  expect(token).toBe('#f9fafb');
}

test.describe('T-ATTR-002 — the disclaimer is visible on every route, without interaction', () => {
  test('T-ATTR-002a: ROUTES holds exactly nine routes plus the catch-all', () => {
    // Pins the set the two per-route loops below iterate. Without this they
    // are self-fulfilling: they cover whatever exists and report success.
    expect(NON_CATCH_ALL).toHaveLength(9);
    expect(PATHS).toHaveLength(10);
  });

  /**
   * ⚠ ONE TEST, LOOPING INSIDE — NOT `test()` INSIDE A `for`. A computed test
   * title hides the `T-` id from CI, which `T-META-004` (the
   * `nextup/test-id-naming` lint rule) refuses. The route is not lost from the
   * failure message: every route is visited, each result is collected, and the
   * assertion is made against the collected list, so a failure names exactly
   * which screens dropped the disclaimer rather than stopping at the first.
   */
  test('T-ATTR-002b: the disclaimer is visible on every route with no interaction', async ({
    page,
  }) => {
    await stubApi(page);
    const seen: { path: string; visible: boolean; text: string | null }[] = [];

    for (const path of PATHS) {
      await page.goto(path);
      await expectStyledAndRendered(page);

      // `isVisible` fails on `display: none`, `visibility: hidden`, zero size
      // and a collapsed `<details>` — which is exactly US-011 AC-3's "never
      // behind an expander". Nothing is clicked, hovered or expanded first.
      //
      // ⚠ VISIBLE **TEXT**, never a `title` or `aria-label` (US-011 AC-2). An
      // attribute-only implementation satisfies an `aria-label` locator but
      // not `getByText`, so the rendered text is compared byte for byte
      // against the constant as well.
      const disclaimer = page.getByText(TMDB_DISCLAIMER, { exact: true });
      const visible = await disclaimer.isVisible();
      seen.push({
        path,
        visible,
        text: visible ? await disclaimer.textContent() : null,
      });
    }

    expect(seen).toEqual(PATHS.map((path) => ({ path, visible: true, text: TMDB_DISCLAIMER })));
  });

  test('T-ATTR-002c: the disclaimer survives an API failure', async ({ page }) => {
    // ⚠ A COMPLIANCE STATEMENT THAT DISAPPEARS DURING AN OUTAGE IS ABSENT
    // EXACTLY WHEN THE OWNER IS MOST LIKELY TO BE LOOKING AT THE SCREEN. The
    // component renders synchronously from a constant rather than from
    // `GET /api/me`, and this is the test that stops that being "simplified"
    // into a fetch-gated render later.
    //
    // ⚠ `/api/me` SUCCEEDS AND EVERYTHING ELSE FAILS — the failure this test
    // means. Failing `/api/me` too would exercise `OwnerGate`'s failure screen
    // instead (TASK-028), which carries no attribution ON PURPOSE: it renders
    // before the router, shows no title, no poster and no TMDB-derived field
    // of any kind, and TMDB's requirement attaches to the display of their
    // content. Asserting a disclaimer there would also put TMDB's mark in
    // front of a stranger the product is in the middle of refusing. The
    // obligation covered here is the product's own error states, which is
    // where TMDB data would otherwise have been.
    await page.route('**/api/**', async (route) => {
      if (route.request().url().includes('/api/me')) {
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await page.goto('/');
    await expect(page.getByText(TMDB_DISCLAIMER, { exact: true })).toBeVisible();
  });
});

test.describe('T-ATTR-003 — the logo renders with a non-zero box on every route', () => {
  /** One test, looping inside — see the note on `T-ATTR-002b`. */
  test('T-ATTR-003a: the logo has a real, painted box on every route', async ({ page }) => {
    await stubApi(page);
    const seen: { path: string; ok: boolean }[] = [];

    for (const path of PATHS) {
      await page.goto(path);
      await expectStyledAndRendered(page);

      const logo = page.locator('img.tmdb-attribution__logo');
      await expect(logo).toBeVisible();

      const box = await logo.evaluate((node) => {
        const img = node as HTMLImageElement;
        const rect = img.getBoundingClientRect();
        return {
          // ⚠ `naturalWidth` IS THE ONLY THING THAT PROVES THE FILE LOADED.
          // A 404'd `<img>` still has a bounding box (the alt text), still
          // matches the locator and still passes `toBeVisible` — so a
          // box-only assertion passes over a missing asset, which is one of
          // the two ways this obligation breaks in production.
          natural: img.naturalWidth,
          complete: img.complete,
          width: rect.width,
          height: rect.height,
          src: img.currentSrc,
        };
      });

      seen.push({
        path,
        ok:
          box.complete &&
          box.natural > 0 &&
          box.width > 0 &&
          box.height > 0 &&
          box.src.includes(TMDB_LOGO_PATH),
      });
    }

    expect(seen).toEqual(PATHS.map((path) => ({ path, ok: true })));
  });

  test('T-ATTR-003b: a build WITHOUT the logo asset fails this check', async ({ page }) => {
    // US-011 AC-5 says "a build without it fails". That clause is a claim
    // about the TEST, not about the app, so it is asserted directly: the asset
    // is served as a 404 and the `naturalWidth` assertion above must go red.
    // Without this case, `T-ATTR-003a` could be silently weakened to a
    // `toBeVisible` check — which passes over a broken image — and nothing
    // would ever notice.
    await stubApi(page);
    await page.route(`**${TMDB_LOGO_PATH}`, async (route) => {
      await route.fulfill({ status: 404, body: '' });
    });
    await page.goto('/');
    await expectStyledAndRendered(page);

    const logo = page.locator('img.tmdb-attribution__logo');
    // Still present, still "visible" — which is precisely the point.
    await expect(logo).toBeVisible();
    const natural = await logo.evaluate((node) => (node as HTMLImageElement).naturalWidth);
    expect(natural).toBe(0);
  });
});

test.describe('T-ATTR-004 — at 320 px the attribution is fully visible and not truncated', () => {
  test('T-ATTR-004a: the disclaimer wraps rather than being clipped or ellipsised', async ({
    page,
  }) => {
    await stubApi(page);
    await page.setViewportSize(NARROW);
    await page.goto('/');
    await expectStyledAndRendered(page);

    const disclaimer = page.locator('.tmdb-attribution__disclaimer').first();
    await expect(disclaimer).toBeVisible();
    await expect(disclaimer).toHaveText(TMDB_DISCLAIMER);

    const measured = await disclaimer.evaluate((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        // Overflow in EITHER axis is truncation: a `nowrap` line is clipped
        // horizontally, a fixed height clips vertically, and the two are
        // reached by different stylesheet mistakes.
        overflowX: node.scrollWidth - node.clientWidth,
        overflowY: node.scrollHeight - node.clientHeight,
        textOverflow: style.textOverflow,
        whiteSpace: style.whiteSpace,
        left: rect.left,
        right: rect.right,
        height: rect.height,
      };
    });

    expect(measured.overflowX).toBeLessThanOrEqual(1);
    expect(measured.overflowY).toBeLessThanOrEqual(1);
    // ⚠ ASSERTED SEPARATELY FROM THE OVERFLOW MEASUREMENT. `text-overflow:
    // ellipsis` on a wrapped block produces NO overflow — the browser has
    // already shortened the text — so the geometry check alone reports a
    // truncated sentence as healthy.
    expect(measured.textOverflow).toBe('clip');
    expect(measured.whiteSpace).not.toBe('nowrap');
    // Wrapped, therefore taller than a single line at this width. Guards the
    // opposite mistake: a sentence that "fits" only because it was shortened.
    expect(measured.height).toBeGreaterThan(20);
    expect(measured.left).toBeGreaterThanOrEqual(0);
    expect(measured.right).toBeLessThanOrEqual(NARROW.width);
  });

  test('T-ATTR-004b: the logo is inside the viewport at 320 px', async ({ page }) => {
    await stubApi(page);
    await page.setViewportSize(NARROW);
    await page.goto('/');
    await expectStyledAndRendered(page);

    const rect = await page
      .locator('img.tmdb-attribution__logo')
      .evaluate((node) => node.getBoundingClientRect().toJSON() as DOMRect);

    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(NARROW.width);
    expect(rect.width).toBeGreaterThan(0);
  });

  test('T-ATTR-004c: the whole attribution block is reachable by scrolling, not cut off', async ({
    page,
  }) => {
    // The footer sits below the fold on a long screen; "fully visible" means
    // the owner can get to it, not that it is on screen at load. What must
    // NEVER happen is the page clipping it away entirely — an `overflow:
    // hidden` ancestor with a fixed height removes the attribution from the
    // product while leaving it in the DOM.
    await stubApi(page);
    await page.setViewportSize(NARROW);
    await page.goto('/');
    await expectStyledAndRendered(page);

    const attribution = page.getByTestId('tmdb-attribution');
    await attribution.scrollIntoViewIfNeeded();
    await expect(attribution).toBeInViewport();
  });
});
