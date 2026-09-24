/**
 * `T-UX-152` — the fix-match result row is a TITLE AND A CONTROL, not two
 * blocks of prose (`specs/ux-states.md` §6.8, US-008 AC-2, NFR-008).
 *
 * Reported by the owner mid-capture on a phone: *"I used the imdb search and
 * the ui became difficult to interpret. the text was covering the button. I
 * guessed at the confirm button."*
 *
 * ⚠ **MEASURED IN A REAL BROWSER BECAUSE EVERY CLAIM HERE IS A LAYOUT FACT.**
 * jsdom reports zero for every box, so the component test for this row passed
 * throughout — it asserts the button exists and calls its handler, which was
 * true the whole time. What was false was that anyone could SEE it was a
 * button.
 *
 * Measured at 390 px before the fix: the row was `nowrap` with both children
 * at `flex: 0 1 auto`, so a 37-character title and a `Use {name}` label
 * interpolated from that same title split the line into a 137 px column and a
 * 158 px column and BOTH reflowed to four lines. The result was two adjacent
 * walls of the same words, one of which happened to be clickable.
 *
 * Two changes, both asserted below: the visible label is now the short
 * `Use this` with the specific title kept as the ACCESSIBLE name (so a
 * screen-reader owner still hears which result each button applies to), and
 * the row wraps with the control pinned at its natural width instead of being
 * squeezed.
 *
 * ⚠ The accessible-name assertion is not decoration. Shortening the visible
 * text without it would silently replace three distinguishable buttons with
 * three identically-named ones, trading a visual defect for a screen-reader
 * one — `T-UNM-010f` finds this button by the name `use dune`, and `c` pins
 * that the name survives.
 */

import { expect, test, type Page } from '@playwright/test';

const BATCH_ID = 'bat_unmatched_layout';

/** The narrowest phone the product commits to (`T-A11Y-015`, `T-UX-147d`). */
const PHONE = { width: 390, height: 844 };

/**
 * A real TMDB title long enough to reproduce the report. `Good Luck, Have Fun,
 * Don't Die` is the film the owner's own Disney+ capture was trying to match
 * when they hit this — a short fixture name would make the row fit and the
 * case would assert nothing.
 */
const LONG_NAME = 'Good Luck, Have Fun, Don\u2019t Die';

function emptySection(label: string) {
  return { label, count: 0, items: [], collapsedByDefault: false, omitted: false };
}

const UNMATCHED_CANDIDATE = {
  candidateId: 'cnd_u',
  rawText: 'GOOD LUCK VRACH FRANKENSHTEYN',
  inferredTitle: null,
  basis: 'text',
  ocrSupport: 'corroborated',
  provider: 'llm',
  verdict: 'title-candidate',
  ocrConfidence: 0.7,
  tileCrop: null,
  resolvedWorkIdentity: 'unmatched:0123456789abcdef',
  match: null,
  alternatives: [],
  sourceImageIds: ['img_1'],
  disposition: 'pending',
  collapsedIntoCandidateId: null,
  classification: null,
};

const REVIEW = {
  batchId: BATCH_ID,
  service: 'disney-plus',
  discoverySource: null,
  mode: 'append-only',
  lowYield: false,
  degradedExtraction: false,
  crossCheck: 'agreed',
  tmdbUnavailable: false,
  banner: null,
  sections: {
    additions: { label: 'New to your library', count: 0, items: [] },
    alreadyOnYourList: emptySection('Already in your library'),
    probablyNotTitles: emptySection('Probably not titles'),
    unmatched: { label: "Couldn't identify these", count: 1, items: [UNMATCHED_CANDIDATE] },
    unreadableTiles: { label: "Couldn't read these", count: 0, items: [] },
    removals: {
      label: 'No longer on Disney+',
      count: 0,
      items: [],
      omitted: true,
      withheld: false,
      withheldReason: null,
    },
  },
  imagesWithNoText: [],
};

const SEARCH_RESULTS = {
  items: [{ tmdbId: 1, mediaType: 'movie', name: LONG_NAME, releaseYear: 2025, posterPath: null }],
};

async function stubApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const body = url.includes('/tmdb/search')
      ? SEARCH_RESULTS
      : url.includes('/review')
        ? REVIEW
        : { items: [], services: [], nextCursor: null, limit: 50 };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

/**
 * Open the review, open the search on the unmatched row, run it, and return
 * the result row.
 *
 * ⚠ Waits for `.app-shell`, not merely for a `<main>`: `OwnerGate` settles
 * `GET /api/me` before the router mounts and its "checking your access" state
 * is itself a `<main>`, so every measurement would be taken against a
 * placeholder that trivially fits.
 */
async function searchedRow(page: Page) {
  await page.setViewportSize(PHONE);
  await stubApi(page);
  await page.goto(`/batches/${BATCH_ID}/review`);
  await expect(page.locator('.app-shell')).toBeVisible();

  await page.getByTestId('unmatched-find').click();
  await page.getByRole('searchbox').first().fill('good luck');
  // The submit button, not the disclosure — the disclosure now reads "Cancel".
  await page.getByRole('button', { name: /^find a match$/i }).click();

  const row = page.locator('.unmatched-actions__result').first();
  await expect(row).toBeVisible();
  return row;
}

async function box(locator: ReturnType<Page['locator']>) {
  const b = await locator.boundingBox();
  if (b === null) throw new Error('element is not rendered');
  return b;
}

test.describe('T-UX-152 — the fix-match result row reads as a control', () => {
  test('T-UX-152a: the button is a compact target, not a paragraph of the title', async ({
    page,
  }) => {
    const row = await searchedRow(page);
    const button = await box(row.locator('button'));

    // Before the fix: 158x76 — four wrapped lines of `Use Good Luck, Have Fun,
    // Don't Die`. A control taller than it is wide is prose with a border.
    expect(button.height).toBeLessThanOrEqual(56);
    expect(button.width).toBeGreaterThan(button.height);
    // NFR-008 / T-A11Y-015: and it is still a real touch target.
    expect(button.height).toBeGreaterThanOrEqual(44);
  });

  test('T-UX-152b: the title gets the row, and the control does not take a column of it for the same words', async ({
    page,
  }) => {
    const row = await searchedRow(page);
    const label = await box(row.locator('.unmatched-actions__result-label'));
    const button = await box(row.locator('button'));

    // Before the fix the row split into a 137 px column of title and a 158 px
    // column of the SAME title with `Use ` in front of it — the control took
    // more of the line than the thing it was about. The title now owns the
    // width; the button takes only what `Use this` needs.
    expect(label.width).toBeGreaterThan(button.width);

    // Never overlapping, which is what "the text was covering the button"
    // describes, and never off the phone.
    const overlaps =
      label.x < button.x + button.width &&
      button.x < label.x + label.width &&
      label.y < button.y + button.height &&
      button.y < label.y + label.height;
    expect(overlaps).toBe(false);
    expect(button.x + button.width).toBeLessThanOrEqual(PHONE.width);
    expect(label.x + label.width).toBeLessThanOrEqual(PHONE.width);
  });

  test('T-UX-152c: shortening the visible label did NOT cost the accessible name', async ({
    page,
  }) => {
    const row = await searchedRow(page);
    const button = row.locator('button');

    // The eye reads this...
    await expect(button).toHaveText('Use this');
    // ...and a screen reader still hears WHICH title it applies to. Without
    // this, three results would present as three buttons called "Use this".
    await expect(button).toHaveAccessibleName(`Use ${LONG_NAME}`);
  });
});
