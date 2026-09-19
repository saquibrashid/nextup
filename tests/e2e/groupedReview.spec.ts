import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { buildReviewResponse, type ReviewCandidate } from '@nextup/domain';

const candidate: ReviewCandidate = {
  candidateId: 'new',
  rawText: 'A LONG ORIGINAL SCREENSHOT READING',
  inferredTitle: null,
  basis: 'text',
  ocrSupport: 'exact',
  provider: 'llm',
  verdict: 'title-candidate',
  ocrConfidence: 0.9,
  resolvedWorkIdentity: 'tmdb:movie:1',
  match: {
    tmdbId: 1,
    mediaType: 'movie',
    name: 'A Very Long Title With An Unexpectedly Long Subtitle',
    releaseYear: 2025,
    posterPath: null,
    score: 0.9,
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

const { describe } = test;
for (const width of [280, 390, 1440]) {
  describe(`Grouped review at ${width}px`, () => {
    test('T-UX-158d: consistent evidence and decision geometry without lost sections', async ({
      page,
    }, testInfo) => {
      const review = buildReviewResponse({
        batchId: 'grouped',
        service: 'netflix',
        mode: 'full-update',
        lowYield: false,
        degradedExtraction: false,
        crossCheck: 'ok',
        candidates: [
          candidate,
          {
            ...candidate,
            candidateId: 'known',
            classification: 'already-present-for-this-service',
          },
          { ...candidate, candidateId: 'unknown', resolvedWorkIdentity: null, match: null },
          { ...candidate, candidateId: 'chrome', verdict: 'chrome-suspected' },
        ],
        disappearedListings: [],
        imagesWithNoText: [],
      });
      await page.route('**/api/**', (route) =>
        route.fulfill({
          json: route.request().url().endsWith('/review')
            ? review
            : {
                ownerId: 'owner',
                displayName: 'Owner',
                signOutUrl: '/.auth/logout',
                attribution: {},
              },
        }),
      );
      await page.route('**/api/images/*', (route) =>
        route.fulfill({
          contentType: 'image/svg+xml',
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="104" height="104"><rect width="104" height="104" fill="#302744"/></svg>',
        }),
      );
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/batches/grouped/review');
      const actions = page.getByTestId('addition-actions').locator('button');
      await expect(actions).toHaveCount(3);
      const boxes = await actions.evaluateAll((buttons) =>
        buttons.map((button) => {
          const { width, height } = button.getBoundingClientRect();
          return { width, height };
        }),
      );
      expect(
        Math.max(...boxes.map((box) => box.width)) - Math.min(...boxes.map((box) => box.width)),
      ).toBeLessThan(1);
      expect(boxes.every((box) => box.height >= 44)).toBe(true);
      const image = await page
        .getByTestId('candidate-new')
        .getByTestId('candidate-thumb')
        .boundingBox();
      expect(image?.width).toBe(104);
      expect(image?.height).toBe(104);
      await page.getByTestId('review-already-on-list').locator('summary').click();
      await expect(page.getByTestId('candidate-known')).toBeVisible();
      await page.getByTestId('review-secondary').locator('summary').first().click();
      await page.getByTestId('review-probably-not-titles').locator('summary').click();
      await expect(page.getByTestId('candidate-chrome')).toBeVisible();
      if (width < 640) {
        const apply = await page.getByTestId('apply-changes-button').boundingBox();
        const navigation = await page.getByRole('navigation').boundingBox();
        expect(apply).not.toBeNull();
        expect(navigation).not.toBeNull();
        expect((apply?.y ?? 0) + (apply?.height ?? 0)).toBeLessThanOrEqual(navigation?.y ?? 0);
      }
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('grouped-review.png'), fullPage: true });
    });
  });
}
