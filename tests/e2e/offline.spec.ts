/**
 * TASK-125 — the offline states, `specs/ux-states.md` §11 (`T-UX-023`,
 * `T-UX-024`).
 *
 * ⚠ **BEFORE THIS, EXACTLY ONE SURFACE OF SEVEN HAD AN OFFLINE STATE.** Batch
 * status (§5.8) had a careful implementation — banner, paused polling, an
 * immediate refetch on reconnect. The list, upload, review, removed,
 * not-interested and batches screens had none, so a lost connection surfaced
 * as whatever the failed `fetch` produced: the generic load-failure error, or
 * nothing at all. §11 requires a state per surface precisely so that a network
 * problem never reads as "nextup is broken".
 *
 * ⚠ **`context.setOffline` IS THE ONLY HONEST DRIVER HERE.** Dispatching a
 * synthetic `window.dispatchEvent(new Event('offline'))` would exercise the
 * listener while proving nothing about `navigator.onLine`, which is what the
 * initial state reads — a surface mounted while already offline receives no
 * event at all. `setOffline` moves both, so mount-time and transition are
 * covered by the same mechanism the browser uses.
 *
 * ⚠ **THE ROUTE STUBS KEEP FULFILLING WHILE OFFLINE**, because `page.route`
 * intercepts before the network. That is deliberate and is what makes §2.12
 * testable: it is the only way to have *cached* rows on screen and a dead
 * connection at the same time. A test that let the requests fail would be
 * testing the load-failure state instead, which is the state `T-UX-023`
 * exists to distinguish offline FROM.
 */

import { expect, test, type Page } from '@playwright/test';

const BATCH_ID = '01J0000000000000000000BTCH';

const TITLES = {
  items: [
    {
      titleId: 'ttl_1',
      workIdentity: 'tmdb:movie:603',
      matchState: 'matched',
      name: 'The Matrix',
      mediaType: 'movie',
      releaseYear: 1999,
      genres: ['Action'],
      runtimeMinutes: 136,
      posterPath: null,
      badges: [{ service: 'netflix', listingId: 'lst_1', dateAdded: '2026-01-04' }],
      sortDateAdded: '2026-01-04',
      dateAddedLabel: 'Added to nextup on 4 Jan 2026',
    },
  ],
  nextCursor: null,
  limit: 50,
};

const REVIEW = {
  batchId: BATCH_ID,
  service: 'netflix',
  mode: 'append-only',
  lowYield: false,
  degradedExtraction: false,
  crossCheck: 'ok',
  banner: null,
  sections: {
    additions: { label: 'New to your list', count: 0, items: [] },
    alreadyOnYourList: {
      label: 'Already on your list',
      count: 0,
      items: [],
      collapsedByDefault: true,
      omitted: false,
    },
    probablyNotTitles: {
      label: 'Probably not titles',
      count: 0,
      items: [],
      collapsedByDefault: true,
      omitted: false,
    },
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

const ONE_BATCH = {
  batchId: BATCH_ID,
  service: 'netflix',
  mode: 'append-only',
  status: 'complete',
  createdAt: '2026-02-11T00:00:00.000Z',
  submittedAt: '2026-02-11T00:01:00.000Z',
  completedAt: '2026-02-11T00:02:00.000Z',
  undoneAt: null,
  counts: { created: 0, modified: 0, removed: 0 },
};

/**
 * ⚠ A REAL `BatchStatus`, NOT `{ items: [] }`.
 *
 * The first version of this stub answered `/batches/:id` with the generic
 * empty body, and the SPA rendered a **completely blank page** — no shell, no
 * banner, no heading. The banner assertion below is what caught it, because a
 * missing shell is indistinguishable from a missing banner.
 *
 * ⚠ That the app answers a malformed response by unmounting its whole tree,
 * rather than with an error state, is a **product finding in its own right**
 * and is recorded as one; a correct stub hides it. The same shape was found by
 * `T-A11Y-012c` on the review route.
 */
const BATCH = {
  ...ONE_BATCH,
  imageCount: 1,
  images: [],
};

const BATCH_HISTORY = { items: [ONE_BATCH] };

async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const body = url.includes('/me')
      ? { ownerId: 'o_test', displayName: 'Owner' }
      : url.includes('/service-state')
        ? { services: [] }
        : url.includes('/suppressions')
          ? { items: [] }
          : url.includes('/removed')
            ? { items: [] }
            : url.includes(`/batches/${BATCH_ID}/review`)
              ? REVIEW
              : url.includes(`/batches/${BATCH_ID}`)
                ? BATCH
                : url.includes('/batches')
                  ? BATCH_HISTORY
                  : url.includes('/titles')
                    ? TITLES
                    : { items: [] };

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/**
 * ⚠ Made available so `PasteButton` renders at all. It returns `null` when
 * `navigator.clipboard` is absent, which it is on every `http://` origin —
 * including the preview server. Without this the §4.11 assertion below would
 * pass by finding nothing, which is the trivial pass this suite guards against
 * elsewhere; the explicit `toBeVisible` before the state check is the guard.
 */
async function enableClipboardRead(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { read: () => Promise.resolve([]) },
    });
  });
}

async function chooseUploadDraft(page: Page): Promise<void> {
  await page.getByLabel('Netflix').check();
  await page.getByLabel('Add only').check();
}

test.describe('T-UX-023 — every surface has a distinct offline state', () => {
  test('T-UX-023a: the banner is on every primary surface, and is not the load-failure error', async ({
    page,
    context,
  }) => {
    await stubApi(page);
    await page.goto('/');
    await expect(page.getByRole('main')).toBeVisible();

    /*
     * ⚠ ASSERTED ON EVERY SURFACE, NOT ONCE. The banner lives in `AppShell`
     * precisely so "every surface" is structurally true, and this loop is what
     * stops that claim quietly becoming false — a page that renders its own
     * frame instead of the shell would drop it silently.
     *
     * ⚠ THE CONNECTION IS DROPPED **AFTER** EACH NAVIGATION, not once before
     * the loop. `setOffline` blocks the document request as well as the API
     * ones, so navigating while offline fails outright — `ERR_INTERNET_
     * DISCONNECTED` on Chromium and an internal error on WebKit. Going offline
     * per route is also the more faithful sequence: the owner is already on a
     * screen when their connection goes.
     */
    for (const route of [
      '/',
      '/upload',
      '/batches',
      `/batches/${BATCH_ID}`,
      `/batches/${BATCH_ID}/review`,
      '/removed',
      '/not-interested',
    ] as const) {
      await context.setOffline(false);
      await page.goto(route);
      await expect(page.getByRole('main')).toBeVisible();

      /*
       * ⚠ WAIT FOR THE ROUTE TO SETTLE BEFORE PULLING THE CONNECTION. Without
       * this, WebKit aborts whatever request is still in flight — in practice
       * `OwnerGate`'s `GET /api/me` — and the gate renders *"Couldn't check
       * your access."* IN PLACE OF THE WHOLE SHELL, banner included. Chromium
       * happened to finish first and passed, so this was a one-engine failure.
       *
       * ⚠ That is a real product finding, not just a test-timing artefact: a
       * connection lost during the identity check is reported to the owner as
       * an access problem. §10 specifies no offline row for auth, so it is
       * recorded rather than fixed here.
       */
      await page.waitForLoadState('networkidle');

      await context.setOffline(true);

      await expect(page.getByTestId('offline-banner'), route).toBeVisible();
      await expect(page.getByTestId('offline-banner')).toHaveText(
        'You’re offline. nextup needs a connection.',
      );
      // §2.9's generic failure must not be what the owner is shown instead.
      await expect(page.getByTestId('list-load-error')).toHaveCount(0);
    }
  });

  test('T-UX-023b: §2.12 — cached rows stay on screen and say they are cached', async ({
    page,
    context,
  }) => {
    await stubApi(page);
    await page.goto('/');
    await expect(page.getByText('The Matrix')).toBeVisible();

    await context.setOffline(true);

    // The row the owner was reading is still there — offline is not a reason
    // to take their list away.
    await expect(page.getByText('The Matrix')).toBeVisible();
    await expect(page.getByTestId('list-cached-note')).toHaveText(
      'Showing what was loaded earlier.',
    );
  });

  test('T-UX-023c: §4.11 — submit AND paste are disabled, each with the reason in words', async ({
    page,
    context,
  }) => {
    await enableClipboardRead(page);
    await stubApi(page);
    await page.goto('/upload');
    await chooseUploadDraft(page);

    // ⚠ Proven present and enabled FIRST. Asserting only the disabled state
    // would pass just as well against a button that was never rendered.
    await expect(page.getByTestId('paste-button')).toBeEnabled();

    await context.setOffline(true);

    await expect(page.getByTestId('submit-button')).toBeDisabled();
    await expect(page.getByTestId('submit-reason')).toHaveText('You’re offline.');

    // A45 / product invariant 16: a paste is a POST too.
    await expect(page.getByTestId('paste-button')).toBeDisabled();
    await expect(page.getByTestId('paste-offline-reason')).toHaveText('You’re offline.');
  });

  test('T-UX-023d: §6.17 — the close is disabled, and the review itself is untouched', async ({
    page,
    context,
  }) => {
    await stubApi(page);
    await page.goto(`/batches/${BATCH_ID}/review`);
    await expect(page.getByTestId('apply-changes-button')).toBeEnabled();

    await context.setOffline(true);

    await expect(page.getByTestId('apply-changes-button')).toBeDisabled();
    await expect(page.getByTestId('review-offline-reason')).toHaveText('You’re offline.');

    // ⚠ The review is STILL THERE. §6.17 says dispositions keep working; an
    // offline state that replaces the page has thrown the owner's pass away.
    await expect(page.getByTestId('review-action-bar')).toBeVisible();
    await expect(page.getByTestId('review-counts')).toBeVisible();
  });
});

test.describe('T-UX-024 — reconnect recovers without losing owner input', () => {
  test('T-UX-024a: the banner clears and the list is live again', async ({ page, context }) => {
    await stubApi(page);
    await page.goto('/');
    await expect(page.getByText('The Matrix')).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible();

    await context.setOffline(false);

    await expect(page.getByTestId('offline-banner')).toHaveCount(0);
    await expect(page.getByTestId('list-cached-note')).toHaveCount(0);
    await expect(page.getByText('The Matrix')).toBeVisible();
  });

  test('T-UX-024b: reconnect on the review page re-enables the close and keeps the pass', async ({
    page,
    context,
  }) => {
    await stubApi(page);
    await page.goto(`/batches/${BATCH_ID}/review`);
    await expect(page.getByTestId('review-action-bar')).toBeVisible();

    await context.setOffline(true);
    await expect(page.getByTestId('apply-changes-button')).toBeDisabled();

    await context.setOffline(false);

    /*
     * ⚠ THE PAIRED HALF OF `T-UX-023`. Recovery must be a re-enable, NOT a
     * reload: the review route deliberately does not refetch on reconnect,
     * because replacing the review would discard every disposition made while
     * offline. An implementation that "recovers" by remounting the page passes
     * the first assertion and fails the second.
     */
    await expect(page.getByTestId('apply-changes-button')).toBeEnabled();
    await expect(page.getByTestId('review-offline-reason')).toHaveCount(0);
    await expect(page.getByTestId('review-action-bar')).toBeVisible();
  });
});
