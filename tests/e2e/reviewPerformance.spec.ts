/**
 * `T-PERF-002` — a 500-candidate review renders, stays interactive, and does
 * not scroll sideways at 320 px (US-013 AC-5, SD-11c, `specs/ui.md` §5.4).
 * TASK-129.
 *
 * ⚠ **THIS IS A BROWSER-ONLY PROPERTY AND IT CANNOT BE FAKED IN JSDOM.**
 * `@tanstack/react-virtual` windows on measured layout, and jsdom reports
 * every element as 0 × 0 — so a component test of `CandidateList` observes a
 * virtualiser with no viewport to measure and proves nothing about what a
 * phone renders. `CandidateList` deliberately falls back to a plain list below
 * `VIRTUALISE_ABOVE` for exactly that reason. The windowed branch therefore
 * has no coverage anywhere except here.
 *
 * ⚠ **THE OBVIOUS TEST IS VACUOUS.** "Navigate to a 500-candidate review and
 * assert the page rendered" passes just as well against a non-virtualised list
 * that mounted all 500 cards and took four seconds doing it — which is the
 * exact failure SD-11c exists to prevent. Every test here therefore asserts a
 * property that is FALSE of an unwindowed list: that the DOM holds far fewer
 * rows than the section claims, that the claimed count is nonetheless 500, and
 * that scrolling swaps the rendered window rather than revealing pre-mounted
 * rows.
 *
 * ⚠ **MUTATING A COMPONENT AND RE-RUNNING THIS FILE PROVES NOTHING UNTIL YOU
 * REBUILD.** Playwright's `webServer` runs `vite preview`, which serves the
 * PREBUILT `apps/web/dist` — not the source. Restoring a mutant and re-running
 * therefore re-tests the mutant, and the "still failing" result reads exactly
 * like a flaky test. That misdiagnosis cost several cycles here: `T-PERF-002f`
 * was declared unstable, "fixed" twice, and was correct the whole time.
 * `npm run build --workspace apps/web` after EVERY source change.
 *
 * ⚠ **`--workers=1` IS THE CI SETTING AND IT IS THE ONE THAT MATTERS.** A
 * multi-worker local run can pass a test that fails serially.
 *
 * ⚠ **`count` AND THE DOM ARE NOT ENOUGH — `T-PERF-002f` IS THE ONE THAT
 * CATCHES TRUNCATION.** The first draft of this file claimed that asserting
 * the summary count alongside a small mounted-row count pinned "a window OF
 * 500". **It does not, and a mutation proved it:** rendering
 * `section.items.slice(0, 200)` leaves the summary reading 500, leaves the
 * list windowed, and passes every other test here. A windowed list and a
 * *silently truncated* one are indistinguishable from the top of the list, and
 * truncation is the far worse bug — it hides candidates from a review pass,
 * the one screen where a missing row becomes a lost title. The only assertion
 * that separates them is reaching the LAST candidate, which is what
 * `T-PERF-002f` does.
 * (Truncation below `VIRTUALISE_ABOVE` — `slice(0, 20)` — is caught by `a`,
 * `b` and `e` too, but only incidentally, because it drops the windowing
 * altogether. That coincidence is exactly what made the original claim look
 * true.)
 */

import { expect, test, type Page } from '@playwright/test';

/** §10.1's floor — the narrowest width NFR-006 mandates. */
const NARROW = { width: 320, height: 720 };

const BATCH_ID = 'bat_perf_500';

/** SD-11c, verbatim: "above 100 items in a section". Mirrors `CandidateList`. */
const VIRTUALISE_ABOVE = 100;

const CANDIDATE_COUNT = 500;

/**
 * One review candidate, shaped from `packages/domain/src/review.ts`
 * (`ReviewCandidate`) — not from a plausible guess. `a11y.spec.ts` records what
 * an invented fixture costs: it produced a real, shipped-looking axe failure
 * that was entirely the test's own fault.
 *
 * Every card carries a poster path, a year, a match and a genre-ish chip row so
 * the rows are as expensive to render as production rows. A fixture of bare
 * strings would make an unwindowed list cheap enough to pass a timing check.
 */
function candidate(index: number) {
  const name = `Perf Fixture Title Number ${String(index).padStart(3, '0')}`;
  return {
    candidateId: `cnd_${String(index).padStart(3, '0')}`,
    rawText: name,
    inferredTitle: null,
    basis: 'both',
    ocrSupport: 'exact',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 0.97,
    resolvedWorkIdentity: `tmdb:movie:${String(10_000 + index)}`,
    match: {
      tmdbId: 10_000 + index,
      mediaType: 'movie',
      name,
      releaseYear: 1990 + (index % 30),
      posterPath: `/poster${String(index)}.jpg`,
      score: 0.98,
      uncertain: false,
      ambiguous: false,
    },
    alternatives: [],
    sourceImageIds: [`img_${String(index % 20)}`],
    disposition: 'pending',
    collapsedIntoCandidateId: null,
    classification: 'new',
  };
}

function emptySection(label: string) {
  return { label, count: 0, items: [], collapsedByDefault: true, omitted: false };
}

const REVIEW = {
  batchId: BATCH_ID,
  service: 'netflix',
  mode: 'append-only',
  lowYield: false,
  degradedExtraction: false,
  crossCheck: 'agreed',
  banner: null,
  sections: {
    additions: {
      label: 'New to your list',
      count: CANDIDATE_COUNT,
      items: Array.from({ length: CANDIDATE_COUNT }, (_, i) => candidate(i)),
    },
    alreadyOnYourList: emptySection('Already on your list'),
    probablyNotTitles: emptySection('Probably not titles'),
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

async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const body = url.includes('/review')
      ? REVIEW
      : { items: [], services: [], nextCursor: null, limit: 50 };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/**
 * ⚠ WAIT FOR THE SHELL, NOT MERELY FOR A `<main>`. `OwnerGate` settles
 * `GET /api/me` before the router mounts and its "checking your access" state
 * is itself a `<main>` — so `getByRole('main')` goes green while the product
 * has not rendered at all, and every measurement below would then be taken
 * against a one-line placeholder that trivially fits in 320 px.
 */
async function openReview(page: Page): Promise<void> {
  await stubApi(page);
  await page.goto(`/batches/${BATCH_ID}/review`);
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByTestId('review-additions')).toBeVisible();
}

/** The rows actually mounted in the additions section, right now. */
function rowCount(page: Page): Promise<number> {
  return page.getByTestId('review-additions').locator('.review-section__row').count();
}

test.describe('T-PERF-002 — a 500-candidate review stays usable', () => {
  test('T-PERF-002a: the section is windowed — far fewer rows are mounted than the 500 it reports', async ({
    page,
  }) => {
    await page.setViewportSize(NARROW);
    await openReview(page);

    // The claim and the DOM, together. Either alone is satisfied by a bug:
    // the count alone by a list that renders nothing, the DOM alone by a list
    // that silently truncated the batch to a handful of candidates.
    await expect(page.getByTestId('review-additions')).toContainText(
      `New to your list (${String(CANDIDATE_COUNT)})`,
    );
    await expect(page.getByTestId('candidate-list-viewport')).toBeVisible();

    const mounted = await rowCount(page);
    expect(mounted).toBeGreaterThan(0);
    // Generously above any plausible window (a 720 px viewport over ~120 px
    // rows plus overscan) and far below 500, so this fails loudly the moment
    // the windowing is removed rather than tracking an exact figure that would
    // make the test brittle against a row-height change.
    expect(mounted).toBeLessThan(VIRTUALISE_ABOVE);
  });

  test('T-PERF-002b: scrolling swaps the window rather than revealing pre-mounted rows', async ({
    page,
  }) => {
    await page.setViewportSize(NARROW);
    await openReview(page);

    const viewport = page.getByTestId('candidate-list-viewport');
    const firstBefore = await page
      .getByTestId('review-additions')
      .locator('.review-section__row')
      .first()
      .textContent();

    await viewport.evaluate((node) => {
      node.scrollTop = node.scrollHeight / 2;
    });

    // The window moved: a different candidate is now first. On an unwindowed
    // list every row is already mounted, so the first row never changes -- which
    // is precisely what this asserts against.
    await expect(async () => {
      const firstAfter = await page
        .getByTestId('review-additions')
        .locator('.review-section__row')
        .first()
        .textContent();
      expect(firstAfter).not.toBe(firstBefore);
    }).toPass({ timeout: 5_000 });

    // Still windowed after scrolling: rows are recycled, not accumulated. A
    // virtualiser that mounts and never unmounts passes the check above and
    // still degrades into the very stall SD-11c exists to prevent.
    expect(await rowCount(page)).toBeLessThan(VIRTUALISE_ABOVE);
  });

  test('T-PERF-002c: no horizontal scroll at 320 px with 500 candidates', async ({ page }) => {
    await page.setViewportSize(NARROW);
    await openReview(page);

    // Non-vacuity: real, laid-out rows are on screen, so this measures the
    // review layout rather than an empty or failed document.
    expect(await rowCount(page)).toBeGreaterThan(0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('T-PERF-002d: the batch stays INTERACTIVE — the action bar responds under 500 candidates', async ({
    page,
  }) => {
    await page.setViewportSize(NARROW);
    await openReview(page);

    // "Stays interactive" is the half of AC-5 that a render assertion misses
    // entirely. The action bar is the control the owner needs most on this
    // screen, and a main thread blocked mounting 500 cards is a screen that
    // looks finished and answers nothing.
    const confirmAll = page.getByTestId('confirm-all-button').first();
    await expect(confirmAll).toBeVisible();

    const started = Date.now();
    await confirmAll.click({ timeout: 5_000 });
    expect(Date.now() - started).toBeLessThan(5_000);

    // The discard control is still reachable afterwards -- the click did not
    // wedge the page.
    await expect(page.getByTestId('discard-batch-button')).toBeEnabled();
  });

  test('T-PERF-002e: the review reaches interactive within a real budget', async ({ page }) => {
    await page.setViewportSize(NARROW);

    const started = Date.now();
    await openReview(page);
    await expect(page.getByTestId('candidate-list-viewport')).toBeVisible();
    const elapsed = Date.now() - started;

    // ⚠ A DELIBERATELY LOOSE CEILING. This is a CI-shared-runner timing check,
    // so a tight budget would buy flakiness rather than signal; the structural
    // assertions above are what actually prove the windowing. This exists to
    // catch the order-of-magnitude regression -- an unwindowed 500-card mount
    // on a throttled runner -- not to police milliseconds.
    expect(elapsed).toBeLessThan(15_000);
  });

  test('T-PERF-002f: the LAST of the 500 candidates is reachable — the window spans the batch', async ({
    page,
  }) => {
    // Scrolling 500 virtual rows to the end, re-measuring as it goes, is slow
    // enough on a loaded runner to trip the default budget. Declared slow
    // rather than papered over with a bare retry.
    test.slow();
    await page.setViewportSize(NARROW);
    await openReview(page);

    const last = `Perf Fixture Title Number ${String(CANDIDATE_COUNT - 1).padStart(3, '0')}`;
    // ⚠ `.first()` IS REQUIRED, AND FINDING OUT WHY COST A DEBUG CYCLE. A
    // candidate card renders the title TWICE -- once as the resolved match name
    // and once as the raw extracted text -- so a bare `getByText` resolves to
    // two elements and fails Playwright's strict mode with a message that reads
    // exactly like "the row was never reached".
    const lastRow = page.getByTestId('review-additions').getByText(last).first();

    // Absent from the DOM at the top of the list -- otherwise "reachable after
    // scrolling" would be true of a list that never scrolled at all.
    await expect(page.getByTestId('review-additions').getByText(last)).toHaveCount(0);

    const viewport = page.getByTestId('candidate-list-viewport');

    // ⚠ ONE `scrollTop = scrollHeight` IS NOT ENOUGH, and it fails on *correct*
    // code. `@tanstack/react-virtual` starts from an ESTIMATED row height and
    // re-measures rows as they mount, so the total size -- and therefore the
    // bottom -- moves under the scroll. A single jump lands short of the end and
    // this test then reports truncation against a perfectly good list. Re-scroll
    // until the last row is genuinely reached; under a fully parallel e2e run
    // the settle is slow enough that a short budget flakes.
    //
    // ⚠ DO NOT "SIMPLIFY" THIS TO A HUGE CONSTANT. `scrollTop = MAX_SAFE_INTEGER`
    // looks like a cleaner way to let the browser clamp to the true maximum and
    // was tried and re-verified: it passes on Chromium and FAILS ON WEBKIT, so it
    // breaks only the `mobile-safari` project -- the one that represents the
    // device this product is designed for. The failure is indistinguishable from
    // the truncation bug this test exists to detect.
    await expect(async () => {
      await viewport.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      // ⚠ THE ASSERTION THAT SEPARATES WINDOWING FROM TRUNCATION. A list
      // rendering `items.slice(0, 200)` reports 500 in its summary, windows
      // correctly, scrolls, and recycles rows -- and simply never reaches this
      // candidate however far it is scrolled. Nothing else in this file notices.
      await expect(lastRow).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 45_000 });

    // Still windowed at the bottom: reaching the end did not mean mounting
    // everything on the way there.
    expect(await rowCount(page)).toBeLessThan(VIRTUALISE_ABOVE);
  });
});
