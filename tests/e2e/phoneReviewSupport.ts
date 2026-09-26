/**
 * TASK-262 — below `--bp-sm` (640 px) the review is the owner's phone mockup:
 * an overview of groups and a one-candidate pager (`specs/ui.md` §5.0a).
 *
 * The pager keeps the wide card's test ids (`candidate-{id}`, `addition-keep`,
 * `unmatched-find`, …), so a journey spec reaches a candidate through
 * `openCandidate` and then drives it with the SAME selectors on both layouts.
 */

import { expect, type Locator, type Page } from '@playwright/test';

export const PHONE_MAX_WIDTH = 639;

export function isPhone(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) <= PHONE_MAX_WIDTH;
}

/** The review's h1, whichever layout drew it. */
export function reviewHeading(page: Page): Locator {
  return page.getByRole('heading', {
    level: 1,
    name: isPhone(page) ? 'Review extracted titles' : 'Review this import',
  });
}

/** The bulk-confirm control's accessible name for `count` clear matches. */
export function confirmAllName(page: Page, count: number): string {
  return isPhone(page)
    ? `Add all ${count} clear ${count === 1 ? 'match' : 'matches'}`
    : `Confirm all ${count}`;
}

const GROUPS = ['all', 'new', 'uncertain', 'saved', 'other'] as const;

/**
 * Show the candidate's card: a no-op on the wide layout; on phone, back out of
 * any open pager, find the candidate's opener under whichever chip lists it,
 * and open the pager on it.
 */
export async function openCandidate(page: Page, candidateId: string): Promise<Locator> {
  const card = page.getByTestId(`candidate-${candidateId}`);
  if (!isPhone(page)) return card;
  if (await card.isVisible()) return card;
  const back = page.getByRole('button', { name: 'Back to review' });
  if (await back.isVisible()) await back.click();
  const opener = page.getByTestId(`phone-review-open-${candidateId}`).first();
  // ⚠ RETRIED AS A WHOLE: a re-read of the review can land between the chip
  // press and the open, and the pager must be reached however it settles.
  await expect(async () => {
    if (!(await opener.isVisible())) {
      for (const group of GROUPS) {
        const chip = page.getByTestId(`phone-review-chip-${group}`);
        if (!(await chip.isVisible())) continue;
        await chip.click();
        if ((await opener.count()) > 0) break;
      }
    }
    await opener.scrollIntoViewIfNeeded({ timeout: 2_000 });
    await opener.click({ timeout: 2_000 });
    await expect(card).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return card;
}

/** Return from the pager to the overview, where the action bar lives. */
export async function toOverview(page: Page): Promise<void> {
  if (!isPhone(page)) return;
  const back = page.getByRole('button', { name: 'Back to review' });
  if (await back.isVisible()) await back.click();
  const all = page.getByTestId('phone-review-chip-all');
  if (await all.isVisible()) await all.click();
}

/**
 * The additions or already-saved section's count and names: the wide
 * `<details>` summary, or the phone group's heading count.
 */
export async function expectReviewGroup(
  page: Page,
  kind: 'additions' | 'saved',
  count: number,
  names: readonly string[] = [],
): Promise<void> {
  if (isPhone(page)) {
    const group = page.getByTestId(`phone-review-group-${kind === 'additions' ? 'new' : 'saved'}`);
    await expect(group.locator('.phone-review__group-head .phone-review__count')).toHaveText(
      String(count),
    );
    for (const name of names) await expect(group.getByText(name).first()).toBeVisible();
    return;
  }
  const section = page.getByTestId(
    kind === 'additions' ? 'review-additions' : 'review-already-on-list',
  );
  await expect(section.locator('summary')).toHaveText(
    `${kind === 'additions' ? 'New to your library' : 'Already in your library'} (${count})`,
  );
  await expect(section.locator('details')).toHaveJSProperty('open', true);
  for (const name of names) await expect(section.getByText(name).first()).toBeVisible();
}
