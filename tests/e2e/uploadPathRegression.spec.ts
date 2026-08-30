import { expect, test, type Page, type Route } from '@playwright/test';

import { removalsLabel, type ReviewCandidate, type ReviewResponse } from '@nextup/domain';

import { IMAGE_ACCEPT_ATTRIBUTE, REVIEW_APPLY_LABEL, SUBMIT_LABEL } from '../../apps/web/src/copy';

/**
 * `T-PASTE-010` — TASK-164. **THE ADD-NOT-SWAP REGRESSION GUARD.**
 *
 * ⚠ **THIS TEST IS PINNED TO THE FILE INPUT BY DESIGN AND MUST NEVER BE
 * RE-POINTED.** It is deliberately *not* a duplicate of `T-E2E-001`.
 * `T-E2E-001` may legitimately be re-aimed at whatever the fastest ingest path
 * happens to be one day; this one may not. Its entire purpose is to FAIL if
 * clipboard paste ever quietly displaces file selection — the A42-shaped
 * mistake that ADR-0009 and invariant 16 exist to prevent, and which nothing
 * else in the suite would catch. If you are here because this test is in your
 * way: the correct fix is almost never to change this file.
 *
 * Invariant 16: paste was **ADDED, not swapped in**. File selection remains a
 * complete path because two real capture routes depend on it — the laptop
 * screenshot path, and the iOS Photos path that delivers raw HEIC (which is
 * also why `accept` must keep admitting all three formats, REQ-007/ASM-058).
 *
 * ⚠ **SCOPE HONESTY.** The e2e web server is `vite preview` — a static SPA with
 * every `/api/**` call stubbed — so this file CANNOT and does not claim to
 * observe the server-side HEIC→PNG transcode. That is owned by `T-IMG-013`
 * (integration) and `T-IMG-023` (the conditional-on-sniffed-format property).
 * What is asserted here is the half that lives in the browser: the input
 * exists, its `accept` still admits PNG/JPEG/HEIC, a HEIC selection is
 * accepted by the UI and actually transmitted to the images endpoint, and the
 * complete journey still completes when driven through the input.
 */

const BATCH_ID = 'bat_paste010_addnotswap';
const NOW = '2026-08-29T16:00:00.000Z';

interface UploadState {
  batchCreatedWith: unknown;
  uploadedFileNames: string[];
  submitted: boolean;
  statusReads: number;
  confirmed: boolean;
  closeBody: unknown;
}

function ok(body: unknown): { status: number; contentType: string; body: string } {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

/**
 * The images endpoint is multipart. Playwright exposes the raw body, and the
 * filename appears in each part's `Content-Disposition`, so the file names the
 * browser actually sent can be recovered without parsing the whole payload.
 */
function fileNamesFromMultipart(body: string | null): string[] {
  if (body === null) return [];
  return Array.from(body.matchAll(/filename="([^"]+)"/g)).map((m) => m[1] ?? '');
}

function emptyCandidateSection(label: string, collapsedByDefault = true) {
  return { label, count: 0, items: [], collapsedByDefault, omitted: false };
}

function duneCandidate(disposition: ReviewCandidate['disposition']): ReviewCandidate {
  return {
    candidateId: 'cnd_dune',
    rawText: 'Dune',
    inferredTitle: 'Dune',
    basis: 'both',
    ocrSupport: 'exact',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 0.98,
    // §5.3a — no crop: a `title-candidate` gets no mandatory tile thumbnail.
    tileCrop: null,
    resolvedWorkIdentity: 'tmdb:movie:438631',
    match: {
      tmdbId: 438631,
      mediaType: 'movie',
      name: 'Dune',
      releaseYear: 2021,
      posterPath: null,
      score: 0.99,
      uncertain: false,
      ambiguous: false,
    },
    alternatives: [],
    sourceImageIds: ['img_1'],
    disposition,
    collapsedIntoCandidateId: null,
    classification: 'new',
  };
}

function reviewResponse(confirmed: boolean): ReviewResponse {
  return {
    batchId: BATCH_ID,
    service: 'netflix',
    mode: 'full-update',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
    banner: null,
    sections: {
      additions: {
        label: 'New to your list',
        count: 1,
        items: [duneCandidate(confirmed ? 'confirmed' : 'pending')],
      },
      alreadyOnYourList: emptyCandidateSection('Already on your list'),
      probablyNotTitles: emptyCandidateSection('Probably not titles'),
      unmatched: { label: "Couldn't identify these", count: 0, items: [] },
      unreadableTiles: { label: "Couldn't read these", count: 0, items: [] },
      removals: {
        label: removalsLabel('netflix'),
        count: 0,
        items: [],
        omitted: true,
        withheld: false,
        withheldReason: null,
      },
    },
    imagesWithNoText: [],
  };
}

async function stubApi(page: Page, state: UploadState): Promise<void> {
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request();
    const method = request.method();
    const path = new URL(request.url()).pathname;

    if (method === 'GET' && path === '/api/me') {
      await route.fulfill(
        ok({ ownerId: 'owner-e2e', displayName: 'Owner', signOutUrl: '/.auth/logout' }),
      );
      return;
    }

    if (method === 'GET' && path === '/api/titles') {
      await route.fulfill(ok({ titles: [], total: 0 }));
      return;
    }

    if (method === 'GET' && path === '/api/services') {
      await route.fulfill(
        ok({
          services: (['netflix', 'max'] as const).map((service) => ({
            service,
            lastUpdatedAt: null,
            lastCompletedBatchId: null,
            ageDays: null,
            label:
              service === 'netflix'
                ? 'Netflix has never been updated'
                : 'Max has never been updated',
          })),
        }),
      );
      return;
    }

    if (method === 'POST' && path === '/api/batches') {
      state.batchCreatedWith = request.postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          batchId: BATCH_ID,
          service: 'netflix',
          mode: 'full-update',
          status: 'open',
          createdAt: NOW,
        }),
      });
      return;
    }

    if (method === 'POST' && path === `/api/batches/${BATCH_ID}/images`) {
      const sent = fileNamesFromMultipart(request.postData());
      state.uploadedFileNames.push(...sent);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          // The server stores the transcoded PNG; the HEIC never reaches the
          // store. Asserted for real by `T-IMG-013`, mirrored here only so the
          // client renders a realistic accepted-file row.
          accepted: sent.map((name, i) => ({
            imageId: `img_${String(i + 1)}`,
            fileName: name.replace(/\.hei[cf]$/i, '.png'),
          })),
          rejected: [],
          batchTotals: { imageCount: sent.length, uploadedByteSize: 120, storedByteSize: 120 },
        }),
      });
      return;
    }

    if (method === 'POST' && path === `/api/batches/${BATCH_ID}/submit`) {
      state.submitted = true;
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    if (method === 'GET' && path === `/api/batches/${BATCH_ID}`) {
      state.statusReads += 1;
      const inReview = state.submitted && state.statusReads >= 2;
      await route.fulfill(
        ok({
          batchId: BATCH_ID,
          service: 'netflix',
          mode: 'full-update',
          status: inReview ? 'in-review' : 'extracting',
          derivedFromBatchId: null,
          createdAt: NOW,
          submittedAt: NOW,
          completedAt: null,
          images: [
            {
              imageId: 'img_1',
              fileName: 'ios-photo.png',
              ingestSource: 'upload',
              available: true,
              retainUntil: '2026-09-28T16:00:00.000Z',
              candidateCount: inReview ? 1 : null,
              href: '/api/images/img_1',
            },
          ],
          extractionError: null,
          lowYield: false,
          progress: inReview ? undefined : { imagesDone: 0, imagesTotal: 1 },
          degradedExtraction: false,
          crossCheck: 'ok',
          provenance: { created: [], modified: [], removed: [] },
          changedNothing: true,
          titles: [],
        }),
      );
      return;
    }

    if (method === 'GET' && path === `/api/batches/${BATCH_ID}/review`) {
      await route.fulfill(ok(reviewResponse(state.confirmed)));
      return;
    }

    if (method === 'POST' && path === `/api/batches/${BATCH_ID}/candidates/confirm-all`) {
      state.confirmed = true;
      await route.fulfill(ok({ section: 'additions', confirmed: 1, skipped: 0 }));
      return;
    }

    if (method === 'POST' && path === `/api/batches/${BATCH_ID}/close`) {
      state.closeBody = request.postDataJSON();
      await route.fulfill(
        ok({
          batchId: BATCH_ID,
          status: 'closed',
          summary: { listingsCreated: 1, listingsRemoved: 0, removalGroupId: null },
          serviceState: { service: 'netflix' },
          undoable: true,
        }),
      );
      return;
    }

    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'UNSTUBBED', message: `${method} ${path}`, details: {} },
      }),
    });
  });
}

function freshState(): UploadState {
  return {
    batchCreatedWith: null,
    uploadedFileNames: [],
    submitted: false,
    statusReads: 0,
    confirmed: false,
    closeBody: null,
  };
}

/** A real HEIF `ftyp` box — brand `heic`, the iOS Photos shape (REQ-077). */ const HEIC_BYTES =
  Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0x00, 0x00, 0x00, 0x00,
    0x68, 0x65, 0x69, 0x63, 0x6d, 0x69, 0x66, 0x31,
  ]);

test.describe('T-PASTE-010 — the add-not-swap regression guard', () => {
  test('T-PASTE-010a: the file input still exists on /upload and accepts multiple files', async ({
    page,
  }) => {
    await stubApi(page, freshState());
    await page.goto('/upload');

    const input = page.getByTestId('file-input');
    await expect(input).toHaveCount(1);
    await expect(input).toHaveAttribute('type', 'file');
    await expect(input).toHaveAttribute('multiple', '');
    await expect(input).toBeEnabled();

    // ⚠ The visible affordance is the LABEL bound to this input; the input
    // itself is clipped. Both must be present — the label is what the owner
    // taps, the input is what keyboard focus lands on.
    const label = page.getByText('Choose files', { exact: true });
    await expect(label).toBeVisible();
    const box = await label.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);

    // ⚠ CLIPPED, NOT REMOVED, AND NOT LEFT RAW.
    //
    // With no CSS at all the browser paints its own file widget beside the
    // styled label — a second control `ux-states.md` §4.3 does not list, and
    // one whose INTRINSIC width is platform-dependent (~253 px on Chromium,
    // 347 px on the WebKit CI runner). At 347 px it cannot fit a 320 px phone
    // and `.dropzone__target` centres it, so it escaped both edges and put a
    // horizontal scrollbar on the primary capture screen.
    //
    // A width assertion in pixels would therefore be platform-dependent and
    // would pass vacuously on this machine. What is asserted instead is the
    // PROPERTY that fixes it and is stable everywhere: the input paints no
    // meaningful box. `display: none` would satisfy that too, so focusability
    // is asserted alongside it — invariant 16 requires file selection to stay
    // a complete path, and the `<label>` is not focusable, so removing the
    // input from the tab order would strand keyboard-only owners.
    const inputBox = await input.boundingBox();
    expect(inputBox?.width ?? 0).toBeLessThanOrEqual(1);
    await input.focus();
    await expect(input).toBeFocused();
  });

  test('T-PASTE-010b: accept still admits PNG, JPEG and HEIC — all three', async ({ page }) => {
    await stubApi(page, freshState());
    await page.goto('/upload');

    const accept = await page.getByTestId('file-input').getAttribute('accept');
    expect(accept).toBe(IMAGE_ACCEPT_ATTRIBUTE);

    // Asserted token by token so NARROWING the list fails loudly and names the
    // format that was dropped, rather than failing on an opaque string diff.
    for (const token of ['image/png', 'image/jpeg', 'image/heic', 'image/heif']) {
      expect(accept?.split(',')).toContain(token);
    }
  });

  test('T-PASTE-010c: the file input is not displaced by paste — both affordances coexist', async ({
    page,
  }) => {
    await stubApi(page, freshState());
    await page.addInitScript(() => {
      // Paste needs a clipboard API to render its button at all (invariant 19:
      // `navigator.clipboard` is absent on http://). Without this shim the
      // coexistence claim would pass vacuously, by paste simply being absent.
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { read: async () => [] },
      });
    });
    await page.goto('/upload');

    await expect(page.getByTestId('paste-button')).toBeVisible();
    await expect(page.getByTestId('file-input')).toHaveCount(1);
    await expect(page.getByText('Choose files', { exact: true })).toBeVisible();
  });

  test('T-PASTE-010d: a HEIC selection is accepted and actually transmitted', async ({ page }) => {
    const state = freshState();
    await stubApi(page, state);
    await page.goto('/upload');

    await page.getByRole('radio', { name: /Netflix/ }).check();
    await page.getByRole('radio', { name: /Full update/ }).check();
    await page.getByTestId('file-input').setInputFiles([
      {
        name: 'ios-photo.heic',
        // ⚠ iOS commonly declares `application/octet-stream`; the format is
        // determined by magic bytes, never the declared type (invariant 11).
        mimeType: 'application/octet-stream',
        buffer: HEIC_BYTES,
      },
    ]);

    await expect(page.getByTestId('accepted-file')).toHaveCount(1);
    // The HEIC really left the browser — not merely rendered locally.
    await expect.poll(() => state.uploadedFileNames).toEqual(['ios-photo.heic']);
  });

  test('T-PASTE-010e: the COMPLETE journey still passes when driven through the file input', async ({
    page,
  }) => {
    const state = freshState();
    await stubApi(page, state);
    await page.goto('/upload');

    await page.getByRole('radio', { name: /Netflix/ }).check();
    await page.getByRole('radio', { name: /Full update/ }).check();
    await page
      .getByTestId('file-input')
      .setInputFiles([
        { name: 'ios-photo.heic', mimeType: 'application/octet-stream', buffer: HEIC_BYTES },
      ]);
    await expect(page.getByTestId('accepted-file')).toHaveCount(1);
    await expect.poll(() => state.batchCreatedWith).not.toBeNull();

    await page.getByRole('button', { name: SUBMIT_LABEL }).click();
    await expect(page).toHaveURL(`/batches/${BATCH_ID}/review`);
    expect(state.submitted).toBe(true);

    await expect(page.getByRole('heading', { name: 'Review this batch' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm all 1' }).click();

    await page.getByRole('button', { name: REVIEW_APPLY_LABEL }).click();
    await expect(page).toHaveURL('/');
    await expect.poll(() => state.closeBody).toEqual({ confirmRemovals: false });
  });
});
