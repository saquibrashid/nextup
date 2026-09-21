import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jU1cAAAAASUVORK5CYII=',
  'base64',
);
const { describe } = test;
for (const width of [280, 390, 1440]) {
  describe(`Capture completeness at ${width}px`, () => {
    test('T-UX-164z: explicit replacement, unknown response, reload and replacement deletion preserve safe responsive recovery', async ({
      page,
    }, testInfo) => {
      let images = [{ imageId: 'saved', fileName: 'saved.png' }];
      let replacement: string[] = [];
      let resolutionWrites = 0;
      let unavailableReads = 0;
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
        } else if (path === '/api/batches') {
          await route.fulfill({ json: { batches: [] } });
        } else if (path === '/api/batches/draft') {
          if (unavailableReads > 0) {
            unavailableReads -= 1;
            await route.abort('failed');
            return;
          }
          const complete =
            replacement.length > 0 &&
            replacement.every((id) => images.some((image) => image.imageId === id));
          await route.fulfill({
            json: {
              batchId: 'draft',
              service: 'netflix',
              mode: 'full-update',
              status: 'draft',
              createdAt: '2026-09-20T12:00:00Z',
              submittedAt: null,
              completedAt: null,
              derivedFromBatchId: null,
              extractionError: null,
              lowYield: false,
              changedNothing: true,
              provenance: { created: [], modified: [], removed: [] },
              titles: [],
              images: images.map((image) => ({
                ...image,
                available: true,
                href: `/api/images/${image.imageId}`,
                ingestSource: 'upload',
                retainUntil: null,
                candidateCount: null,
              })),
              batchTotals: { imageCount: images.length, uploadedByteSize: 70, storedByteSize: 70 },
              intake: {
                origin: 'tracked',
                complete,
                reason: complete ? null : 'unresolved-input',
                unresolvedAttemptIds: complete ? [] : ['issue'],
                attempts: [
                  {
                    id: 'issue',
                    token: 'issue',
                    kind: 'upload',
                    state: replacement.length > 0 ? 'resolved' : 'incomplete',
                    failures: [
                      { name: 'failed.png', message: 'The screenshot could not be saved.' },
                    ],
                    acceptedImageIds: [],
                    replacementImageIds: replacement,
                  },
                ],
              },
            },
          });
        } else if (path === '/api/batches/draft/intake/issue' && request.method() === 'PATCH') {
          const body: { replacementImageIds: string[] } = request.postDataJSON();
          replacement = body.replacementImageIds;
          resolutionWrites += 1;
          if (resolutionWrites === 1) {
            unavailableReads = 1;
            await route.abort('failed');
          } else await route.fulfill({ status: 204 });
        } else if (path === '/api/batches/draft/images/saved' && request.method() === 'DELETE') {
          images = [];
          await route.fulfill({ status: 204 });
        } else if (path === '/api/batches/draft/images' && request.method() === 'POST') {
          images = [{ imageId: 'new', fileName: 'new.png' }];
          await route.fulfill({
            status: 201,
            json: {
              accepted: images,
              rejected: [],
              batchTotals: { imageCount: 1, uploadedByteSize: 70, storedByteSize: 70 },
            },
          });
        } else if (path.startsWith('/api/images/')) {
          await route.fulfill({ contentType: 'image/png', body: png });
        } else {
          throw new Error(`Unexpected request: ${request.method()} ${path}`);
        }
      });
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/batches/draft');
      const confirm = page.getByRole('button', {
        name: 'Confirm selected screenshots cover this input',
      });
      await expect(confirm).toBeDisabled();
      await expect(
        page.getByText(/Nothing will be removed while screenshot input is unresolved/),
      ).toBeVisible();
      await page.getByRole('checkbox').check();
      await confirm.click();
      await expect(page.getByText(/Saved status is unverified/)).toBeVisible();
      await expect(page.getByTestId('draft-submit')).toBeDisabled();
      await expect(page.getByRole('checkbox')).toBeDisabled();
      await page.getByRole('button', { name: 'Check saved screenshots' }).click();
      await expect(page.getByText(/All recorded input issues are resolved/)).toBeVisible();
      await page.reload();
      await expect(page.getByTestId('draft-submit')).toBeEnabled();
      expect(resolutionWrites).toBe(1);
      await page.getByRole('button', { name: 'Remove saved.png', exact: true }).click();
      await expect(page.getByText(/Upload a replacement screenshot above/)).toBeVisible();
      await page.getByTestId('file-input').setInputFiles({
        name: 'new.png',
        mimeType: 'image/png',
        buffer: png,
      });
      await page.getByRole('button', { name: 'Upload selected screenshots' }).click();
      await expect(page.getByRole('checkbox')).toBeEnabled();
      await expect(page.getByRole('checkbox')).not.toBeChecked();
      await expect(confirm).toBeDisabled();
      expect(resolutionWrites).toBe(1);
      const scan = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      expect(
        scan.violations.filter((item) => item.impact === 'serious' || item.impact === 'critical'),
      ).toEqual([]);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('capture-input-recovery.png') });
      await page.getByRole('checkbox').check();
      await confirm.click();
      await expect(page.getByText(/All recorded input issues are resolved/)).toBeVisible();
      expect(resolutionWrites).toBe(2);
      expect(replacement).toEqual(['new']);
    });
  });
}
