/**
 * `T-SEC-018` — US-001 AC-4 in a real browser: an allow-listed-out identity
 * sees the refusal and **gets no data** (`specs/testing.md` §9, §12.2,
 * `specs/ux-states.md` §2.11, TASK-028).
 *
 * ⚠ THE ARCHITECTURE HANDOVER CALLS AC-4 "THE HIGHEST-VALUE TEST IN THE
 * PRODUCT", and the reason is that its failure is completely silent: nextup
 * looks perfectly healthy while showing one person's watchlist to another
 * account. Nothing errors and nothing logs.
 *
 * ⚠ AND THE COMPONENT TEST CANNOT SEE THE FAILURE MODE THAT MATTERS.
 * `apps/web/test/states.spec.tsx` renders `RefusalPage` **in isolation** and
 * asserts it emits no nav, no header and no list. That is true of the
 * component and says nothing about the application: every container renders
 * `<RefusalPage />` as its route element, i.e. **inside `AppShell`'s
 * `<main>`**, so the shell's own nav, header and footer are rendered around
 * it. Whether a refused account sees the product's navigation is a question
 * only the assembled app can answer, and this is the only place it is asked.
 *
 * The two halves are asserted separately and deliberately:
 *
 * - **What is shown** — the refusal copy, full-page, with no product UI.
 * - **What crossed the wire** — the response log is inspected directly. A
 *   screen that renders a refusal *over* a successful `/api/titles` response
 *   has already been served the data; the browser holds it, the SPA holds it,
 *   and only the paint is missing. §9's wording is exact about this: "no
 *   `/api/titles` 200 in the network log".
 */

import { expect, test, type Page, type Response } from '@playwright/test';

import { REFUSAL_NOT_ALLOWED_BODY, REFUSAL_NOT_ALLOWED_TITLE } from '../../apps/web/src/copy';

/**
 * Exactly what the API returns to a principal that authenticated but is not
 * the owner (`specs/api.md`, `apps/api/src/middleware/allowList.ts`). Copied
 * from the real envelope rather than invented: `tests/e2e/a11y.spec.ts`
 * records what a plausible-but-wrong stub costs — a real, shipped-looking
 * failure whose fault is in the fixture.
 */
const NOT_ALLOWED = {
  error: {
    code: 'NOT_ALLOWED',
    message: 'This account is not the owner of this nextup instance.',
    details: {},
  },
};

/** Refuse every API call, and record every response the page received. */
async function refuseAll(page: Page): Promise<Response[]> {
  const responses: Response[] = [];
  page.on('response', (response) => responses.push(response));
  await page.route('**/api/**', async (route) => {
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify(NOT_ALLOWED),
    });
  });
  return responses;
}

test.describe('T-SEC-018 — a refused identity sees the refusal and gets no data', () => {
  test('T-SEC-018a: the browser renders the refusal, not an empty list', async ({ page }) => {
    // ⚠ THE DISTINCTION THIS ASSERTS IS THE WHOLE POINT. `T-SEC-010` and
    // `T-SEC-017` prove the API refuses. Neither says the SPA renders a
    // refusal rather than an empty list — and a 403 that silently renders an
    // empty list looks to the owner exactly like a list that lost everything,
    // which is the single worst thing this product can appear to do.
    await refuseAll(page);
    await page.goto('/');

    await expect(page.getByText(REFUSAL_NOT_ALLOWED_TITLE)).toBeVisible();
    await expect(page.getByText(REFUSAL_NOT_ALLOWED_BODY)).toBeVisible();
  });

  test('T-SEC-018b: no /api/titles 200 ever reached the browser', async ({ page }) => {
    // Asserted against the RESPONSE LOG, not against the DOM. A screen that
    // renders a refusal over a successful fetch has already been served the
    // data — it is in the browser, in memory, and one console line away.
    const responses = await refuseAll(page);
    await page.goto('/');
    await expect(page.getByText(REFUSAL_NOT_ALLOWED_TITLE)).toBeVisible();

    const served = responses
      .filter((response) => response.url().includes('/api/'))
      .map((response) => ({ url: new URL(response.url()).pathname, status: response.status() }));

    // Every API response was a refusal; none carried a body.
    expect(served.filter((entry) => entry.status === 200)).toEqual([]);

    /*
     * ⚠ ANTI-VACUITY GUARD — and it changed meaning when `OwnerGate` landed.
     * It used to require that `/api/titles` HAD been requested and refused,
     * which was the strongest available statement while every container
     * fetched its own data and discovered the refusal from the answer. The
     * gate now settles identity before the router mounts, so the list is never
     * requested at all: strictly better, because a request that is never sent
     * cannot be answered wrongly by a future middleware bug.
     *
     * So the guard asserts what must still be true — the app really did ask
     * `/api/me`, really was refused, and asked for nothing else. Dropping it
     * entirely would let a build that issues NO requests (a blank page, a
     * crashed bundle) pass all three assertions above.
     */
    expect(served).toEqual([{ url: '/api/me', status: 403 }]);
  });

  test('T-SEC-018c: the refusal is full-page — no nav, no product UI', async ({ page }) => {
    // ⚠ THIS IS THE ASSERTION THE COMPONENT TEST CANNOT MAKE. `RefusalPage`
    // renders no nav; the SHELL AROUND IT might. The nav names the owner's
    // screens, so a refusal rendered inside the shell has already leaked the
    // shape of the account it just refused (`ux-states.md` §2.11: "no list
    // data, no nav and no partial UI").
    await refuseAll(page);
    await page.goto('/');
    await expect(page.getByText(REFUSAL_NOT_ALLOWED_TITLE)).toBeVisible();

    const leaked = await page.evaluate(() => ({
      nav: document.querySelectorAll('nav').length,
      lists: document.querySelectorAll('main ul').length,
      shell: document.querySelectorAll('.app-shell').length,
    }));

    expect(leaked).toEqual({ nav: 0, lists: 0, shell: 0 });
  });

  test('T-SEC-018d: the refusal offers sign-out only — no way in', async ({ page }) => {
    // NFR-015: there is no sign-up and no self-service path out of a refusal.
    // A "request access" link or a sign-in loop would both be an invitation to
    // an account this instance has already refused.
    await refuseAll(page);
    await page.goto('/');
    await expect(page.getByText(REFUSAL_NOT_ALLOWED_TITLE)).toBeVisible();

    const hrefs = await page.evaluate(() =>
      [...document.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href') ?? ''),
    );

    expect(hrefs).toEqual(['/.auth/logout']);
  });
});
