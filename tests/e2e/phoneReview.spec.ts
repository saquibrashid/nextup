/**
 * T-PHONE-013 — the owner's phone review mockup, in real browsers (TASK-262,
 * `specs/ui.md` §5.0a).
 *
 * The component cases (`T-PHONE-011`, `T-PHONE-012`) prove the grouping and
 * the pager's behaviour; what jsdom cannot answer is whether the overview and
 * the pager FIT a phone: every chip and option a 44 px target, nothing wider
 * than the viewport, and axe clean on both screens.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { buildReviewResponse, type ReviewCandidate } from '@nextup/domain';

import { openCandidate, reviewHeading, toOverview } from './phoneReviewSupport';

const BATCH_ID = 'bat_phone_review';

const match: NonNullable<ReviewCandidate['match']> = {
  tmdbId: 66732,
  mediaType: 'tv',
  name: 'Stranger Things',
  releaseYear: 2016,
  posterPath: null,
  score: 0.95,
  uncertain: false,
  ambiguous: false,
};

const base: ReviewCandidate = {
  candidateId: 'clear-1',
  rawText: 'STRANGER THINGS',
  inferredTitle: null,
  basis: 'text',
  ocrSupport: 'exact',
  provider: 'llm',
  verdict: 'title-candidate',
  ocrConfidence: 0.95,
  resolvedWorkIdentity: 'tmdb:tv:66732',
  match: {
    tmdbId: 66732,
    mediaType: 'tv',
    name: 'Stranger Things',
    releaseYear: 2016,
    posterPath: null,
    score: 0.95,
    uncertain: false,
    ambiguous: false,
  },
  alternatives: [],
  sourceImageIds: ['image'],
  tileCrop: null,
  disposition: 'pending',
  collapsedIntoCandidateId: null,
  classification: 'new',
};

const candidates: ReviewCandidate[] = [
  base,
  {
    ...base,
    candidateId: 'clear-2',
    rawText: 'THE CROWN',
    resolvedWorkIdentity: 'tmdb:tv:65494',
    match: { ...match, tmdbId: 65494, name: 'The Crown' },
  },
  {
    ...base,
    candidateId: 'unsure',
    rawText: 'THE LAST OF U',
    resolvedWorkIdentity: 'tmdb:tv:100088',
    match: {
      ...match,
      tmdbId: 100088,
      name: 'A Deliberately Long Title That Must Wrap On The Narrowest Phone',
      score: 0.6,
      uncertain: true,
    },
  },
  {
    ...base,
    candidateId: 'saved',
    rawText: 'DARK',
    resolvedWorkIdentity: 'tmdb:tv:70523',
    match: { ...match, tmdbId: 70523, name: 'Dark' },
    classification: 'already-present-for-this-service',
  },
  { ...base, candidateId: 'chrome', rawText: 'MY LIST', verdict: 'chrome-suspected' },
];

async function stub(page: Page): Promise<void> {
  const review = buildReviewResponse({
    batchId: BATCH_ID,
    service: 'netflix',
    mode: 'append-only',
    lowYield: false,
    degradedExtraction: false,
    crossCheck: 'ok',
    candidates,
    disappearedListings: [],
    imagesWithNoText: [],
  });
  await page.route('**/api/**', (route) =>
    route.fulfill({
      json: route.request().url().endsWith('/review')
        ? review
        : { ownerId: 'owner', displayName: 'Owner', signOutUrl: '/.auth/logout', attribution: {} },
    }),
  );
  await page.route('**/api/images/*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="104" height="104"><rect width="104" height="104" fill="#302744"/></svg>',
    }),
  );
}

async function expectNoOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

async function expectTargets(locator: Locator): Promise<void> {
  const boxes = await locator.evaluateAll((elements) =>
    elements
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => {
        const { width, height } = element.getBoundingClientRect();
        return { width, height };
      }),
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}

async function expectNoSeriousAxe(page: Page): Promise<void> {
  const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(
    scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
  ).toEqual([]);
}

async function open(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: 844 });
  await stub(page);
  await page.goto(`/batches/${BATCH_ID}/review`);
  await expect(page.locator('.app-shell')).toBeVisible();
}

const { describe } = test;
for (const width of [390, 320]) {
  describe(`T-PHONE-013 — the phone review at ${String(width)}px`, () => {
    test('T-PHONE-013a: the overview groups every candidate, fits the phone and is axe clean', async ({
      page,
    }) => {
      await open(page, width);
      await expect(page.locator('html')).toHaveAttribute('data-layout', 'phone');
      await expect(reviewHeading(page)).toBeVisible();
      await expect(page.getByTestId('review-context')).toContainText('Netflix');
      await expect(page.getByTestId('phone-review-group-new')).toBeVisible();
      await expect(page.getByTestId('phone-review-group-uncertain')).toBeVisible();
      await expect(page.getByTestId('phone-review-row-saved')).toBeVisible();
      await expect(page.getByTestId('phone-review-row-chrome')).toBeVisible();
      await expectTargets(page.locator('[data-testid^="phone-review-chip-"]'));
      await expect(page.getByTestId('confirm-all-button')).toBeVisible();
      await expectNoOverflow(page);
      await expectNoSeriousAxe(page);
    });

    test('T-PHONE-013b: the pager shows one candidate, pages and returns, fits and is axe clean', async ({
      page,
    }) => {
      await open(page, width);
      const card = await openCandidate(page, 'unsure');
      await expect(card.locator('.phone-review__hero')).toBeVisible();
      await expect(card.getByTestId('candidate-raw-text')).toHaveText('THE LAST OF U');
      await expectTargets(card.locator('.phone-review__options button'));
      await expectNoOverflow(page);
      await expectNoSeriousAxe(page);

      const next = page.getByRole('button', { name: 'Next' });
      const previous = page.getByRole('button', { name: 'Previous' });
      await expect(next.or(previous).first()).toBeVisible();

      await toOverview(page);
      await expect(page.getByTestId('phone-review-group-uncertain')).toBeVisible();
      await expect(page.getByTestId('candidate-unsure')).toHaveCount(0);
    });
  });
}
