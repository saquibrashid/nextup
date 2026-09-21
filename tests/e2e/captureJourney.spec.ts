import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { buildReviewResponse, type BatchMode, type ReviewCandidate } from '@nextup/domain';
import type { BatchStatus } from '../../apps/web/src/lib/apiClient';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU1cAAAAASUVORK5CYII=',
  'base64',
);

const { describe } = test;
for (const width of [280, 390, 1440]) {
  for (const mode of ['append-only', 'full-update'] satisfies BatchMode[]) {
    describe(`${mode} capture journey at ${width}px`, () => {
      test('T-UX-165k: guided input, navigation resume, large-review focus, summary and terminal recovery', async ({
        page,
      }, testInfo) => {
        let created = false;
        let status = 'draft';
        let uploaded = false;
        let closes = 0;
        let decisionWrites = 0;
        let releaseReview: (() => void) | undefined;
        let holdReview = false;
        const candidates: ReviewCandidate[] = Array.from({ length: 40 }, (_, index) => ({
          candidateId: `candidate-${index}`,
          rawText: `Screenshot title ${index}`,
          inferredTitle: null,
          basis: 'text',
          ocrSupport: 'exact',
          provider: 'llm',
          verdict: 'title-candidate',
          ocrConfidence: 1,
          resolvedWorkIdentity: `tmdb:movie:${index + 1}`,
          match: {
            tmdbId: index + 1,
            mediaType: 'movie',
            name: `Screenshot title ${index}`,
            releaseYear: 2024,
            posterPath: null,
            score: 1,
            uncertain: false,
            ambiguous: false,
          },
          alternatives: [],
          sourceImageIds: [],
          tileCrop: null,
          disposition: index === 24 ? 'pending' : 'confirmed',
          collapsedIntoCandidateId: null,
          classification: 'new',
        }));
        function batch(): BatchStatus {
          return {
            batchId: 'journey',
            service: 'netflix',
            mode,
            status,
            createdAt: '2026-09-21T00:00:00Z',
            submittedAt: null,
            completedAt: status === 'applied' ? '2026-09-21T00:05:00Z' : null,
            derivedFromBatchId: null,
            extractionError: null,
            lowYield: false,
            changedNothing: false,
            provenance: { created: [], modified: [], removed: [] },
            titles: [],
            progress: { imagesDone: status === 'in-review' ? 1 : 0, imagesTotal: 1 },
            images: uploaded
              ? [
                  {
                    imageId: 'image',
                    fileName: 'capture.png',
                    ingestSource: 'upload',
                    available: true,
                    retainUntil: null,
                    candidateCount: status === 'in-review' ? 40 : null,
                    href: '/api/images/image',
                  },
                ]
              : [],
            application:
              status === 'applied'
                ? {
                    summary: {
                      listingsCreated: 40,
                      listingsRemoved: mode === 'full-update' ? 1 : 0,
                      removalGroupId: mode === 'full-update' ? 'removed' : null,
                    },
                    undoable: mode === 'append-only',
                    removalsUndone: false,
                  }
                : null,
          };
        }
        await page.route('**/api/**', async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          const path = url.pathname;
          if (path === '/api/me') {
            await route.fulfill({
              json: {
                ownerId: 'owner',
                displayName: 'Owner',
                signOutUrl: '/.auth/logout',
                attribution: {},
              },
            });
          } else if (path === '/api/batches' && request.method() === 'GET') {
            await route.fulfill({
              json: {
                batches:
                  created && (url.searchParams.get('open') !== 'true' || status !== 'applied')
                    ? [
                        {
                          ...batch(),
                          undoneAt: null,
                          counts: {
                            created: 40,
                            modified: 0,
                            removed: mode === 'full-update' ? 1 : 0,
                          },
                        },
                      ]
                    : [],
              },
            });
          } else if (path === '/api/batches' && request.method() === 'POST') {
            expect(request.postDataJSON()).toMatchObject({
              service: 'netflix',
              mode,
              captureProtocol: 1,
            });
            created = true;
            await route.fulfill({ status: 201, json: batch() });
          } else if (path === '/api/batches/journey/images' && request.method() === 'POST') {
            uploaded = true;
            await route.fulfill({
              status: 201,
              json: {
                accepted: [{ imageId: 'image', fileName: 'capture.png' }],
                rejected: [],
                batchTotals: {
                  imageCount: 1,
                  uploadedByteSize: png.length,
                  storedByteSize: png.length,
                },
              },
            });
          } else if (path === '/api/batches/journey/submit') {
            status = 'extracting';
            await route.fulfill({ status: 202, json: { batchId: 'journey', status } });
          } else if (path === '/api/batches/journey') {
            await route.fulfill({ json: batch() });
          } else if (path === '/api/batches/journey/review') {
            if (status !== 'in-review') {
              await route.fulfill({
                status: 409,
                json: {
                  error: {
                    code: 'BATCH_NOT_IN_REVIEW',
                    message: 'This capture is already applied.',
                  },
                },
              });
              return;
            }
            if (holdReview)
              await new Promise<void>((resolve) => {
                releaseReview = resolve;
              });
            await route.fulfill({
              json: buildReviewResponse({
                batchId: 'journey',
                service: 'netflix',
                mode,
                lowYield: false,
                degradedExtraction: false,
                crossCheck: 'ok',
                candidates,
                disappearedListings:
                  mode === 'full-update'
                    ? [
                        {
                          listingId: 'older',
                          titleId: 'older',
                          name: 'An older title',
                          releaseYear: 2000,
                          posterPath: null,
                          service: 'netflix',
                          dateAdded: '2020-01-01',
                        },
                      ]
                    : [],
                imagesWithNoText: [],
              }),
            });
          } else if (
            path === '/api/batches/journey/candidates/candidate-24' &&
            request.method() === 'PATCH'
          ) {
            expect(request.postDataJSON()).toEqual({ disposition: 'confirmed' });
            const candidate = candidates[24];
            if (candidate === undefined) throw new Error('Missing review fixture.');
            candidate.disposition = 'confirmed';
            decisionWrites += 1;
            holdReview = true;
            await route.fulfill({
              json: { candidateId: candidate.candidateId, disposition: 'confirmed' },
            });
          } else if (path === '/api/batches/journey/close') {
            expect(request.postDataJSON()).toEqual({ confirmRemovals: mode === 'full-update' });
            closes += 1;
            status = 'applied';
            await route.fulfill({
              json: {
                batchId: 'journey',
                status,
                serviceState: { service: 'netflix' },
                ...batch().application,
              },
            });
          } else if (path === '/api/images/image') {
            await route.fulfill({ contentType: 'image/png', body: png });
          } else if (path === '/api/titles') {
            await route.fulfill({ json: { items: [], nextCursor: null, limit: 50 } });
          } else if (path === '/api/service-state') {
            await route.fulfill({ json: { services: [] } });
          } else if (path === '/api/suppressions' || path === '/api/removed') {
            await route.fulfill({ json: { items: [], nextCursor: null, limit: 50 } });
          } else throw new Error(`Unexpected request: ${request.method()} ${path}`);
        });

        await page.setViewportSize({ width, height: 900 });
        await page.goto('/upload');
        await expect(page.getByRole('main')).toBeFocused();
        await page.getByRole('radio', { name: /Netflix/ }).check();
        await page.getByTestId(`mode-card-${mode}`).getByRole('radio').check();
        await page
          .getByTestId('file-input')
          .setInputFiles({ name: 'capture.png', mimeType: 'image/png', buffer: png });
        await page.getByTestId('submit-button').click();
        await expect(page.getByRole('progressbar')).toBeVisible();
        await expect(page.getByRole('main')).toBeFocused();
        const nav = page.getByRole('navigation', { name: 'Primary' });
        if (width < 640) await nav.getByRole('button', { name: 'More' }).click();
        await nav.getByRole('link', { name: 'Batches', exact: true }).click();
        const resume = page.getByRole('complementary', { name: 'Unfinished capture' });
        await expect(resume).toContainText('Reading screenshots');
        const metadataGap = await page.getByTestId('batch-card-link').evaluate((link) => {
          const [first, second] = Array.from(link.children);
          if (!(first instanceof HTMLElement) || !(second instanceof HTMLElement)) {
            throw new Error('Capture history metadata is missing.');
          }
          const a = first.getBoundingClientRect();
          const b = second.getBoundingClientRect();
          return b.top >= a.bottom ? b.top - a.bottom : b.left - a.right;
        });
        expect(metadataGap).toBeGreaterThanOrEqual(8);
        const navigationScan = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(
          navigationScan.violations.filter(
            (item) => item.impact === 'serious' || item.impact === 'critical',
          ),
        ).toEqual([]);
        await page.screenshot({ path: testInfo.outputPath('capture-journey-navigation.png') });
        expect(await page.locator('nav').count()).toBe(1);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        status = 'in-review';
        await resume.getByRole('link', { name: 'View progress' }).click();
        await expect(page).toHaveURL('/batches/journey/review');
        const card = page.getByTestId('candidate-candidate-24');
        const keep = card.getByTestId('addition-keep');
        await keep.scrollIntoViewIfNeeded();
        await keep.focus();
        const before = await page.evaluate(() => scrollY);
        expect(before).toBeGreaterThan(900);
        await page.keyboard.press('Enter');
        await expect.poll(() => releaseReview !== undefined).toBe(true);
        await expect(card).toBeVisible();
        await expect(page.getByTestId('review-loading')).toHaveCount(0);
        expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(2);
        holdReview = false;
        releaseReview?.();
        await expect(card.getByRole('button', { name: 'Change decision' })).toBeFocused();
        expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(100);
        expect(decisionWrites).toBe(1);
        await page.getByTestId('apply-changes-button').click();
        const summary = page.getByRole('dialog', { name: 'Confirm changes' });
        await expect(summary.getByRole('button', { name: 'Back to review' })).toBeFocused();
        await expect(summary).toContainText(
          mode === 'full-update' ? 'An older title' : 'Nothing will be removed',
        );
        await page.keyboard.press('Escape');
        await expect(summary).toHaveCount(0);
        await expect(card.getByTestId('addition-outcome')).toContainText('Confirmed');
        expect(closes).toBe(0);
        await page.getByTestId('apply-changes-button').click();
        await summary.getByRole('button', { name: 'Apply changes' }).click();
        await expect(page).toHaveURL('/');
        await page.goto('/batches/journey/review');
        await expect(page.getByRole('heading', { name: 'Capture applied' })).toBeVisible();
        await expect(page.getByRole('complementary', { name: 'Unfinished capture' })).toHaveCount(
          0,
        );
        const scan = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
          .analyze();
        expect(
          scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
        ).toEqual([]);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
        ).toBe(true);
        await page.screenshot({ path: testInfo.outputPath('capture-journey-outcome.png') });
        await page.getByRole('link', { name: 'Start another capture' }).click();
        await expect(page.getByTestId('service-step')).toBeVisible();
        expect(closes).toBe(1);
      });
    });
  }
}
