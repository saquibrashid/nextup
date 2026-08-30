import { expect, test, type Page, type Route } from '@playwright/test';
import {
  SERVICE_LABELS,
  dateAddedLabel,
  modeExplanation,
  removalsLabel,
  type ReviewCandidate,
  type ReviewResponse,
} from '@nextup/domain';

import { REVIEW_APPLY_LABEL, SUBMIT_LABEL } from '../../apps/web/src/copy';

const BATCH_ID = 'bat_e2e_001_steps_1_4';
const TODAY = '2026-08-29';
const NOW = `${TODAY}T16:00:00.000Z`;
const DATE_LABEL = dateAddedLabel(TODAY);

const WORKS = [
  { id: 'dune', tmdbId: 438631, name: 'Dune', year: 2021, mediaType: 'movie' as const },
  {
    id: 'arrival',
    tmdbId: 329865,
    name: 'Arrival',
    year: 2016,
    mediaType: 'movie' as const,
  },
  {
    id: 'arcane',
    tmdbId: 94605,
    name: 'Arcane',
    year: 2021,
    mediaType: 'tv' as const,
  },
] as const;

function candidate(index: number, disposition: ReviewCandidate['disposition']): ReviewCandidate {
  const work = WORKS[index];
  if (work === undefined) throw new Error(`Missing work fixture at ${String(index)}`);
  return {
    candidateId: `cnd_${work.id}`,
    rawText: work.name,
    inferredTitle: work.name,
    basis: 'both',
    ocrSupport: 'exact',
    provider: 'llm',
    verdict: 'title-candidate',
    ocrConfidence: 0.98,
    resolvedWorkIdentity: `tmdb:${work.mediaType}:${String(work.tmdbId)}`,
    match: {
      tmdbId: work.tmdbId,
      mediaType: work.mediaType,
      name: work.name,
      releaseYear: work.year,
      posterPath: null,
      score: 0.99,
      uncertain: false,
      ambiguous: false,
    },
    alternatives: [],
    sourceImageIds: [`img_${String(index + 1)}`],
    disposition,
    collapsedIntoCandidateId: null,
    classification: 'new',
  };
}

function emptyCandidateSection(label: string, collapsedByDefault = true) {
  return { label, count: 0, items: [], collapsedByDefault, omitted: false };
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
        count: WORKS.length,
        items: WORKS.map((_, index) => candidate(index, confirmed ? 'confirmed' : 'pending')),
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

function listItems() {
  return WORKS.map((work) => ({
    titleId: `ttl_${work.id}`,
    workIdentity: `tmdb:${work.mediaType}:${String(work.tmdbId)}`,
    matchState: 'matched',
    name: work.name,
    mediaType: work.mediaType,
    releaseYear: work.year,
    genres: [],
    runtimeMinutes: null,
    posterPath: null,
    badges: [{ service: 'netflix', listingId: `lst_${work.id}_netflix`, dateAdded: TODAY }],
    sortDateAdded: TODAY,
    dateAddedLabel: DATE_LABEL,
    imdbRating: null,
  }));
}

interface JourneyState {
  batchCreatedWith: unknown;
  uploadedImageCalls: number;
  submitted: boolean;
  batchStatusReads: number;
  candidatesConfirmed: boolean;
  confirmAllBody: unknown;
  closed: boolean;
  closeBody: unknown;
}

function ok(body: unknown) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) };
}

async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function stubJourneyApi(page: Page, state: JourneyState): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/me') {
      await route.fulfill(
        ok({ ownerId: 'owner-e2e', displayName: 'Owner', signOutUrl: '/.auth/logout' }),
      );
      return;
    }

    if (method === 'GET' && path === '/api/titles') {
      await route.fulfill(
        ok({ items: state.closed ? listItems() : [], nextCursor: null, limit: 50 }),
      );
      return;
    }

    if (method === 'GET' && path === '/api/suppressions') {
      await route.fulfill(ok({ items: [] }));
      return;
    }

    if (method === 'GET' && path === '/api/service-state') {
      await route.fulfill(
        ok({
          services: [
            {
              service: 'netflix',
              lastCompletedBatchAt: state.closed ? NOW : null,
              lastCompletedBatchId: state.closed ? BATCH_ID : null,
              ageDays: state.closed ? 0 : null,
              label: state.closed ? 'Netflix updated today' : 'Netflix has never been updated',
            },
            {
              service: 'max',
              lastCompletedBatchAt: null,
              lastCompletedBatchId: null,
              ageDays: null,
              label: 'Max has never been updated',
            },
          ],
        }),
      );
      return;
    }

    if (method === 'POST' && path === '/api/batches') {
      state.batchCreatedWith = request.postDataJSON();
      await fulfillJson(route, 201, {
        batchId: BATCH_ID,
        service: 'netflix',
        mode: 'full-update',
        status: 'open',
        createdAt: NOW,
      });
      return;
    }

    if (method === 'POST' && path === `/api/batches/${BATCH_ID}/images`) {
      state.uploadedImageCalls += 1;
      await fulfillJson(route, 201, {
        accepted: [1, 2, 3].map((n) => ({
          imageId: `img_${String(n)}`,
          fileName: `netflix-golden-${String(n)}.png`,
        })),
        rejected: [],
        batchTotals: { imageCount: 3, uploadedByteSize: 300, storedByteSize: 300 },
      });
      return;
    }

    if (method === 'POST' && path === `/api/batches/${BATCH_ID}/submit`) {
      state.submitted = true;
      await route.fulfill({ status: 204, body: '' });
      return;
    }

    if (method === 'GET' && path === `/api/batches/${BATCH_ID}`) {
      state.batchStatusReads += 1;
      const inReview = state.submitted && state.batchStatusReads >= 2;
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
          images: [1, 2, 3].map((n) => ({
            imageId: `img_${String(n)}`,
            fileName: `netflix-golden-${String(n)}.png`,
            ingestSource: 'upload',
            available: true,
            retainUntil: '2026-09-28T16:00:00.000Z',
            candidateCount: inReview ? 1 : null,
            href: `/api/images/img_${String(n)}`,
          })),
          extractionError: null,
          lowYield: false,
          progress: inReview ? undefined : { imagesDone: 1, imagesTotal: 3 },
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
      await route.fulfill(ok(reviewResponse(state.candidatesConfirmed)));
      return;
    }

    if (method === 'POST' && path === `/api/batches/${BATCH_ID}/candidates/confirm-all`) {
      state.confirmAllBody = request.postDataJSON();
      state.candidatesConfirmed = true;
      await route.fulfill(ok({ section: 'additions', confirmed: WORKS.length, skipped: 0 }));
      return;
    }

    if (method === 'POST' && path === `/api/batches/${BATCH_ID}/close`) {
      state.closeBody = request.postDataJSON();
      state.closed = true;
      await route.fulfill(
        ok({
          batchId: BATCH_ID,
          status: 'closed',
          summary: { listingsCreated: WORKS.length, listingsRemoved: 0, removalGroupId: null },
          serviceState: { service: 'netflix' },
          undoable: true,
        }),
      );
      return;
    }

    await fulfillJson(route, 500, {
      error: { code: 'UNSTUBBED', message: `${method} ${path}`, details: {} },
    });
  });
}

async function attachGoldenScreenshots(page: Page): Promise<void> {
  await page.getByTestId('file-input').setInputFiles(
    [1, 2, 3].map((n) => ({
      name: `netflix-golden-${String(n)}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, n]),
    })),
  );
}

test('T-E2E-001: upload, extract, match, review, and apply a first Netflix full update', async ({
  page,
}) => {
  const state: JourneyState = {
    batchCreatedWith: null,
    uploadedImageCalls: 0,
    submitted: false,
    batchStatusReads: 0,
    candidatesConfirmed: false,
    confirmAllBody: null,
    closed: false,
    closeBody: null,
  };
  await stubJourneyApi(page, state);

  await page.goto('/upload');
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Upload screenshots' })).toBeVisible();

  await page.getByRole('radio', { name: /Netflix/ }).check();
  await expect(page.getByText(modeExplanation('full-update', 'netflix'))).toBeVisible();
  await expect(page.getByText(modeExplanation('append-only', 'netflix'))).toBeVisible();
  await page.getByRole('radio', { name: /Full update/ }).check();
  await attachGoldenScreenshots(page);
  await expect(page.getByTestId('accepted-file')).toHaveCount(3);
  await expect(page.getByTestId('dropzone-totals')).toContainText('3 screenshots');
  await expect
    .poll(() => state.batchCreatedWith)
    .toEqual({ service: 'netflix', mode: 'full-update' });
  await expect.poll(() => state.uploadedImageCalls).toBe(1);

  await page.getByRole('button', { name: SUBMIT_LABEL }).click();
  await expect(page).toHaveURL(`/batches/${BATCH_ID}/review`);
  expect(state.submitted).toBe(true);
  expect(state.batchStatusReads).toBeGreaterThanOrEqual(2);

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your list' })).toBeVisible();
  await expect(page.getByTestId('title-list').locator('[data-testid^="title-row-"]')).toHaveCount(
    0,
  );
  await expect(page.getByText(WORKS[0].name)).toHaveCount(0);

  await page.goto(`/batches/${BATCH_ID}/review`);
  await expect(page.getByRole('heading', { name: 'Review this batch' })).toBeVisible();

  const additions = page.getByTestId('review-additions');
  await expect(additions.locator('summary')).toHaveText(
    `New to your list (${String(WORKS.length)})`,
  );
  await expect(additions.locator('details')).toHaveJSProperty('open', true);
  for (const work of WORKS) {
    await expect(additions.getByText(work.name).first()).toBeVisible();
    await expect(additions.getByText(String(work.year)).first()).toBeVisible();
  }

  const already = page.getByTestId('review-already-on-list');
  await expect(already.locator('summary')).toHaveText('Already on your list (0)');
  await expect(already.locator('details')).toHaveJSProperty('open', false);
  await expect(page.getByTestId('review-removals')).toHaveCount(0);
  await expect(page.getByText(removalsLabel('netflix'))).toHaveCount(0);

  await page.getByRole('button', { name: `Confirm all ${String(WORKS.length)}` }).click();
  await expect(
    page.getByRole('button', { name: `Confirm all ${String(WORKS.length)}` }),
  ).toHaveCount(0);
  await expect.poll(() => state.confirmAllBody).toEqual({ section: 'additions' });

  await page.getByRole('button', { name: REVIEW_APPLY_LABEL }).click();
  await expect(page).toHaveURL('/');
  await expect.poll(() => state.closeBody).toEqual({ confirmRemovals: false });

  const rows = page.getByTestId('title-list').locator('[data-testid^="title-row-"]');
  await expect(rows).toHaveCount(WORKS.length);
  for (const work of WORKS) {
    const row = page.getByTestId(`title-row-ttl_${work.id}`);
    await expect(row.getByTestId('title-name')).toHaveText(work.name);
    await expect(row.getByTestId('badge-netflix')).toHaveText(SERVICE_LABELS.netflix);
    await expect(row.getByTestId('date-added-label')).toHaveText(DATE_LABEL);
  }
  await expect(page.getByTestId('freshness-label-netflix')).toHaveText('Netflix updated today');
});
