import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { buildReviewResponse, type ReviewCandidate } from '@nextup/domain';

test('T-AI-067f: every original tile, known match and next step survives responsive saved review', async ({
  page,
}, testInfo) => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="500"><rect width="1000" height="500" fill="black"/><rect x="0" y="50" width="190" height="400" fill="red"/><rect x="200" y="50" width="190" height="400" fill="green"/><rect x="400" y="50" width="190" height="400" fill="blue"/><rect x="600" y="50" width="190" height="400" fill="yellow"/><rect x="800" y="50" width="190" height="400" fill="white"/></svg>';
  const regions = Array.from({ length: 5 }, (_, i) => ({ x: i * 0.2, y: 0.1, w: 0.19, h: 0.8 }));
  for (const width of [280, 390, 1440]) {
    await page.unrouteAll();
    const items: ReviewCandidate[] = regions.map((region, index) => ({
      candidateId: `c${index}`,
      rawText: index === 4 ? '' : `TITLE ${index}`,
      inferredTitle: null,
      basis: 'text',
      ocrSupport: 'exact',
      provider: 'llm',
      verdict: index === 4 ? 'unreadable-tile' : 'title-candidate',
      ocrConfidence: 1,
      resolvedWorkIdentity: index === 4 ? null : `tmdb:movie:${index + 1}`,
      classification: index < 2 ? 'already-present-for-this-service' : 'new',
      match:
        index === 4
          ? null
          : {
              tmdbId: index + 1,
              mediaType: 'movie',
              name: `Title ${index}`,
              releaseYear: 2026,
              posterPath: '/poster.svg',
              score: 1,
              uncertain: false,
              ambiguous: false,
            },
      alternatives: [],
      sourceImageIds: ['image'],
      inputTiles: [{ imageId: 'image', ...region }],
      tileCrop: { imageId: 'image', ...region },
      disposition: 'pending',
      collapsedIntoCandidateId: null,
    }));
    await page.route('**/t/p/**', (route) =>
      route.fulfill({ contentType: 'image/svg+xml', body: svg }),
    );
    await page.route('**/api/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/me') {
        await route.fulfill({
          json: {
            ownerId: 'owner',
            displayName: 'Owner',
            signOutUrl: '/.auth/logout',
            attribution: {},
          },
        });
      } else if (path === '/api/images/image') {
        await route.fulfill({ contentType: 'image/svg+xml', body: svg });
      } else if (path === '/api/batches/review/review') {
        await route.fulfill({
          json: buildReviewResponse({
            batchId: 'review',
            service: 'netflix',
            mode: 'append-only',
            lowYield: true,
            degradedExtraction: false,
            crossCheck: 'ok',
            candidates: items,
            disappearedListings: [],
            imagesWithNoText: [],
            tileCoverage: [
              {
                imageId: 'image',
                fileName: 'shot.png',
                href: '/api/images/image',
                detectedTiles: 5,
                locatedTiles: 4,
                titleCandidates: 4,
                tiles: regions,
              },
            ],
          }),
        });
      } else if (
        request.method() === 'PATCH' &&
        path.startsWith('/api/batches/review/candidates/')
      ) {
        const item = items.find((candidate) => path.endsWith(`/${candidate.candidateId}`));
        const body: unknown = request.postDataJSON();
        if (
          !item ||
          typeof body !== 'object' ||
          body === null ||
          !('disposition' in body) ||
          (body.disposition !== 'confirmed' && body.disposition !== 'discarded')
        )
          throw new Error('Unexpected decision');
        item.disposition = body.disposition;
        await route.fulfill({
          json: {
            candidateId: item.candidateId,
            rawText: item.rawText,
            inferredTitle: null,
            verdict: item.verdict,
            resolvedWorkIdentity: item.resolvedWorkIdentity,
            correctedToTmdbId: null,
            disposition: item.disposition,
          },
        });
      } else throw new Error(`Unexpected request ${request.method()} ${path}`);
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/batches/review/review');
    await expect(
      page.getByRole('heading', { name: '5 tiles found · 2 already saved · 3 to review' }),
    ).toBeVisible();
    await expect(page.getByRole('img', { name: 'Original screenshot tile' })).toHaveCount(5);
    const first = page.getByRole('region', { name: 'Tile 1' });
    await expect(first.getByText(/Nothing to add/)).toBeVisible();
    await expect(first.getByTestId('candidate-poster')).toBeVisible();
    await expect
      .poll(async () => {
        const bounds = await first.getByTestId('candidate-thumb-crop').boundingBox();
        return bounds === null ? 0 : bounds.width / bounds.height;
      })
      .toBeCloseTo(190 / 400, 2);
    await expect(first.getByTestId('addition-keep')).toHaveCount(0);
    await first.getByRole('button', { name: 'Confirm match', exact: true }).click();
    await expect(first.getByTestId('known-outcome')).toContainText(
      'Match confirmed. Already saved; nothing will be added.',
    );
    for (const id of ['c2', 'c3']) {
      const card = page.getByTestId(`candidate-${id}`);
      await card.getByTestId('addition-keep').click();
      await expect(card.getByTestId('addition-outcome')).toContainText('Confirmed');
    }
    await page.getByTestId('candidate-c4').getByTestId('unmatched-discard').click();
    await expect(page.getByTestId('candidate-c4').getByTestId('unmatched-outcome')).toContainText(
      'Discarded',
    );
    await expect(page.getByRole('region', { name: 'Unsaved review choices' })).toHaveCount(0);
    await page.reload();
    await expect(first.getByTestId('known-outcome')).toContainText('Match confirmed');
    await expect(first.getByRole('button', { name: 'Confirm match', exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Tile 2' }).getByRole('button', { name: 'Confirm match' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', {
        name: '5 tiles found · 2 already saved · 0 to review · 3 decided',
      }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const scan = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    expect(
      scan.violations.filter((issue) => issue.impact === 'serious' || issue.impact === 'critical'),
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`tile-review-${width}.png`),
      fullPage: true,
    });
    await page.getByTestId('apply-changes-button').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Title 2');
    await expect(dialog).toContainText('Title 3');
    await expect(dialog).not.toContainText('Title 0');
    await page.keyboard.press('Escape');
  }
});
