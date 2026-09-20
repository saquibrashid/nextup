import AxeBuilder from '@axe-core/playwright';
import { test, expect } from '@playwright/test';
import { buildReviewResponse, type ReviewCandidate } from '@nextup/domain';

test('T-UX-162p: editable and offline decisions remain clear', async ({ page }, testInfo) => {
  for (const width of [280, 390, 1440]) {
    await page.unrouteAll();
    const candidate: ReviewCandidate = {
      candidateId: 'one',
      rawText: 'Title from screenshot',
      inferredTitle: null,
      basis: 'text',
      ocrSupport: 'exact',
      provider: 'llm',
      verdict: 'title-candidate',
      ocrConfidence: 1,
      resolvedWorkIdentity: 'tmdb:movie:1',
      match: {
        tmdbId: 1,
        mediaType: 'movie',
        name: 'A familiar title',
        releaseYear: 2024,
        posterPath: null,
        score: 1,
        uncertain: false,
        ambiguous: false,
      },
      alternatives: [],
      sourceImageIds: [],
      tileCrop: null,
      disposition: 'confirmed',
      collapsedIntoCandidateId: null,
      classification: 'new',
    };
    let writes = 0;
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/me')
        await route.fulfill({
          json: {
            ownerId: 'owner',
            displayName: 'Owner',
            signOutUrl: '/.auth/logout',
            attribution: {},
          },
        });
      else if (path === '/api/batches/review/review')
        await route.fulfill({
          json: buildReviewResponse({
            batchId: 'review',
            service: 'netflix',
            mode: 'full-update',
            lowYield: false,
            degradedExtraction: false,
            crossCheck: 'ok',
            candidates: [candidate],
            disappearedListings: [],
            imagesWithNoText: [],
          }),
        });
      else if (path === '/api/batches/review/candidates/one' && request.method() === 'PATCH') {
        writes += 1;
        const body: unknown = request.postDataJSON();
        if (
          typeof body !== 'object' ||
          body === null ||
          !('disposition' in body) ||
          (body.disposition !== 'confirmed' && body.disposition !== 'discarded')
        )
          throw new Error('Unexpected decision');
        candidate.disposition = body.disposition;
        await route.fulfill({
          json: {
            candidateId: 'one',
            rawText: candidate.rawText,
            inferredTitle: null,
            verdict: candidate.verdict,
            resolvedWorkIdentity: candidate.resolvedWorkIdentity,
            correctedToTmdbId: null,
            disposition: candidate.disposition,
          },
        });
      } else throw new Error(`Unexpected request: ${request.method()} ${path}`);
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/batches/review/review');
    const card = page.getByTestId('candidate-one');
    await card.getByRole('button', { name: 'Change decision' }).click();
    await card.getByTestId('addition-discard').click();
    await expect(card.getByTestId('addition-outcome')).toContainText('Discarded');
    await expect(page.getByRole('region', { name: 'Unsaved review choices' })).toHaveCount(0);
    await page.getByTestId('apply-changes-button').click();
    const summary = page.getByRole('dialog');
    await expect(summary).toBeVisible();
    await summary.getByRole('button', { name: /Back/ }).focus();
    await page.keyboard.press('Escape');
    await expect(summary).toHaveCount(0);
    await expect(card.getByTestId('addition-outcome')).toContainText('Discarded');
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
      window.dispatchEvent(new Event('offline'));
    });
    await card.getByRole('button', { name: 'Change decision' }).click();
    await card.getByTestId('addition-keep').click();
    const unsaved = page.getByRole('region', { name: 'Unsaved review choices' });
    await expect(unsaved).toBeVisible();
    await expect(unsaved).toContainText('Not saved');
    await expect(page.getByTestId('apply-changes-button')).toBeDisabled();
    expect(writes).toBe(1);
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath(`review-continuity-${width}.png`) });
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
      window.dispatchEvent(new Event('online'));
    });
    await expect(unsaved.getByRole('button', { name: 'Check and save choices' })).toBeEnabled();
    expect(writes).toBe(1);
    await unsaved.getByRole('button', { name: 'Check and save choices' }).click();
    await expect(unsaved).toHaveCount(0);
    await expect(card.getByTestId('addition-outcome')).toContainText('Confirmed');
    expect(writes).toBe(2);
  }
});
