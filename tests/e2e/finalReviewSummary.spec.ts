import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { buildReviewResponse, type ReviewCandidate } from '@nextup/domain';

const candidate: ReviewCandidate = {
  candidateId: 'c1',
  rawText: 'A long unidentified title retained exactly as the screenshot reader found it',
  inferredTitle: null,
  basis: 'text',
  ocrSupport: 'exact',
  provider: 'llm',
  verdict: 'title-candidate',
  ocrConfidence: 0.9,
  resolvedWorkIdentity: 'unmatched:fixture',
  match: null,
  alternatives: [],
  sourceImageIds: [],
  tileCrop: null,
  disposition: 'confirmed',
  collapsedIntoCandidateId: null,
  classification: 'new',
};

const { describe } = test;
for (const width of [280, 390, 1440]) {
  describe(`Final confirmation at ${width}px`, () => {
    test('T-UX-159f: selected names, Back, offline and explicit retry remain usable', async ({
      page,
    }, testInfo) => {
      let ticked = true;
      let closes = 0;
      await page.route('**/api/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/me') {
          await route.fulfill({
            json: {
              ownerId: 'owner',
              displayName: 'Owner',
              signOutUrl: '/.auth/logout',
              attribution: {},
            },
          });
        } else if (path.endsWith('/review')) {
          await route.fulfill({
            json: buildReviewResponse({
              batchId: 'final',
              service: 'netflix',
              mode: 'full-update',
              lowYield: false,
              degradedExtraction: false,
              crossCheck: 'ok',
              candidates: [candidate],
              disappearedListings: [
                {
                  listingId: 'keep',
                  titleId: 'old',
                  name: 'Keep this older title',
                  releaseYear: 2000,
                  posterPath: null,
                  service: 'netflix',
                  dateAdded: '2020-01-01',
                },
              ],
              untickedListingIds: new Set(ticked ? [] : ['keep']),
              imagesWithNoText: [],
            }),
          });
        } else if (path.endsWith('/removals')) {
          expect(route.request().postDataJSON()).toEqual({ tick: [], untick: ['keep'] });
          ticked = false;
          await route.fulfill({ json: { batchId: 'final', tickedCount: 0, untickedCount: 1 } });
        } else if (path.endsWith('/close')) {
          expect(route.request().postDataJSON()).toEqual({ confirmRemovals: true });
          closes += 1;
          await route.fulfill(
            closes === 1
              ? { status: 500, json: { error: { code: 'INTERNAL', message: 'Try again' } } }
              : {
                  json: {
                    batchId: 'final',
                    status: 'applied',
                    serviceState: { service: 'netflix' },
                    summary: { listingsCreated: 1, listingsRemoved: 0, removalGroupId: null },
                    undoable: true,
                  },
                },
          );
        } else {
          await route.fulfill({ json: { items: [], services: [], nextCursor: null, limit: 50 } });
        }
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/batches/final/review');
      await page.getByRole('checkbox', { name: 'Keep this older title' }).click();
      await expect(page.getByRole('checkbox')).not.toBeChecked();
      await page.getByRole('button', { name: 'Review changes' }).click();
      const dialog = page.getByRole('dialog', { name: 'Confirm changes' });
      await expect(dialog).toContainText('Nothing will be removed');
      await expect(dialog.getByTestId('confirmation-additions')).toContainText(candidate.rawText);
      expect(closes).toBe(0);
      await expect(dialog.getByRole('button', { name: 'Back to review' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('checkbox')).not.toBeChecked();
      await page.getByRole('button', { name: 'Review changes' }).click();
      await expect(dialog).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await expect(dialog.getByRole('button', { name: 'Apply changes' })).toBeDisabled();
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
      await expect(dialog.getByRole('button', { name: 'Apply changes' })).toBeEnabled();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
      ).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('final-summary.png') });
      await dialog.getByRole('button', { name: 'Apply changes' }).click();
      await expect(dialog.getByTestId('review-apply-error')).toBeVisible();
      expect(closes).toBe(1);
      await dialog.getByRole('button', { name: 'Apply changes' }).click();
      await expect(page).toHaveURL('/');
      expect(closes).toBe(2);
    });
  });
}
