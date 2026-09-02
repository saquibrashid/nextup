/**
 * `T-UX-002` — `specs/ux-states.md` §2: **no fetch rejection path ends without
 * a rendered message.**
 *
 * ⚠ WHY THIS SUITE EXISTS WHEN EVERY SCREEN ALREADY HAS A FAILURE TEST.
 * `listRoute.spec.tsx`, `removedRoute.spec.tsx`, `suppressedRoute.spec.tsx`
 * and the batch suites each assert their OWN failure state, and each of those
 * assertions is stronger than anything here — they check the exact copy. What
 * none of them can assert is the word §2 actually uses: **no**. A per-screen
 * test proves the screens that HAVE a test are covered; it is silent about the
 * screen added next week whose author forgot one. That gap is invisible in a
 * green suite, which is the failure mode this repository keeps rediscovering.
 *
 * ⚠ THE EXPECTED SET IS READ OFF `ROUTES`, NOT WRITTEN DOWN HERE. `routes.tsx`
 * already exists as data for exactly this reason (`specs/ui.md` §8/§10.1), and
 * a hand-copied second list would drift silently — a new route would simply
 * never be visited and the suite would keep passing. Adding a route to the
 * table is enough to bring it under this rule.
 *
 * ⚠ AND WHICH ROUTES FETCH IS DISCOVERED, NOT DECLARED. `/about`, `/rating`
 * and the catch-all read nothing, so demanding an alert from them would be
 * wrong; listing the ones that do read would be another hand-maintained list
 * that drifts. Instead `fetch` is observed: a route that called it must render
 * a message, and a route that did not is exempt. `T-UX-002d` is the floor that
 * stops that cleverness from exempting EVERYTHING — if a refactor made the
 * routes stop fetching on mount, this file would otherwise pass vacuously
 * while asserting nothing at all.
 *
 * The rejection modelled is the network one (`TypeError: Failed to fetch`),
 * which is `fetch`'s literal rejection and the case §2 names. A 5xx resolves
 * rather than rejects and is covered per-screen.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { ROUTES } from '../src/routes';

/**
 * ⚠ A REJECTION, not a resolved error response. `useResource` funnels both to
 * `kind: 'failed'`, but only this one exercises the path with no envelope to
 * read a message out of — the case where a screen is likeliest to render the
 * raw `Error` or nothing.
 */
function rejectingFetch() {
  return vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
}

/** Routes whose screens read nothing are exempt; the catch-all is not a screen. */
const VISITABLE = ROUTES.filter((route) => route.path !== '*');

/**
 * Strings that mean the screen rendered machinery instead of copy. Each of
 * these has reached a real user somewhere in the world; `undefined` and
 * `null` are here because a template literal over an absent field is the
 * commonest way a message half-renders.
 */
const LEAKS = ['TypeError', 'Failed to fetch', '[object Object]', 'undefined', 'null'] as const;

interface Visit {
  readonly fetched: boolean;
  readonly alerts: readonly string[];
  /** Whether any alert contains a control the owner can press (§2's remedy). */
  readonly actionable: boolean;
}

async function visit(path: string): Promise<Visit> {
  const fetchSpy = rejectingFetch();
  vi.stubGlobal('fetch', fetchSpy);

  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );

  // The read is fired from an effect, so the rejection lands a microtask later.
  // ⚠ The wait is TOLERANT — it must not throw. `visit` is shared with the
  // non-vacuity floor (`T-UX-002d`), which counts routes that FETCHED; if a
  // missing message aborted the helper, one screen swallowing its error would
  // fail the floor too and the floor would stop measuring what it claims to.
  const fetched = fetchSpy.mock.calls.length > 0;
  if (fetched) {
    try {
      await waitFor(() => {
        expect(view.container.querySelector('[role="alert"]')).not.toBeNull();
      });
    } catch {
      /* Asserted by the caller, which knows which rule was broken. */
    }
  }

  /*
   * ⚠ SCOPED TO THIS RENDER, AND CLEANED UP BEFORE THE NEXT. Testing Library
   * unmounts between TESTS, not between `render` calls, and every case here
   * loops over nine routes inside ONE test. A global `screen.queryAllByRole`
   * therefore sees the alerts left behind by the routes visited earlier in the
   * same loop, and a screen that rendered NOTHING is credited with its
   * predecessor's message. That is not hypothetical — it silently un-killed
   * the `loadFailed={false}` mutation this suite exists to catch, and the
   * suite went green with the defect in place.
   */
  const nodes = Array.from(view.container.querySelectorAll('[role="alert"]'));
  const alerts = nodes.map((node) => (node.textContent ?? '').trim()).filter((text) => text !== '');
  const actionable = nodes.some((node) => node.querySelector('button, a[href]') !== null);

  cleanup();

  return { fetched, alerts, actionable };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('T-UX-002 · ux-states §2 · no fetch rejection ends without a message', () => {
  /*
   * ⚠ ONE STATIC TITLE PER RULE, WITH THE LOOP INSIDE — not one case per
   * route. A generated title (`T-UX-002a · ${route.path} · ...`) reads better
   * in the runner but hides the id from the CI scanners, and `nextup/test-id-naming`
   * refuses it for that reason. So each case collects OFFENDERS and asserts
   * the collection is empty: the assertion message then names the failing
   * routes, which is the information the per-route titles were carrying.
   */

  it('T-UX-002a · every screen that reads renders a visible message when the read fails', async () => {
    const offenders: string[] = [];

    for (const route of VISITABLE) {
      const { fetched, alerts } = await visit(route.examplePath);
      if (!fetched) continue;

      // A message, not a bare label: an alert reading "Error" tells the owner
      // nothing about whether their data survived, which §2's reassurance
      // requirement exists to answer.
      if (!alerts.some((text) => text.length >= 20)) offenders.push(route.path);
    }

    expect(offenders).toEqual([]);
  });

  it('T-UX-002b · the message is owner copy, never a raw error', async () => {
    const offenders: string[] = [];

    for (const route of VISITABLE) {
      const { fetched, alerts } = await visit(route.examplePath);
      if (!fetched) continue;

      const joined = alerts.join(' ');
      // Each of these has shipped to a user somewhere in the world. The raw
      // rejection is `TypeError: Failed to fetch`, so a screen that renders
      // `error.message` straight through is caught by name here.
      for (const leak of LEAKS) {
        if (joined.includes(leak)) offenders.push(`${route.path} → ${leak}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('T-UX-002c · every failed read offers a way forward', async () => {
    const offenders: string[] = [];

    for (const route of VISITABLE) {
      const { fetched, actionable } = await visit(route.examplePath);
      if (!fetched) continue;

      // §2 pairs the message with a remedy. Every failed read in nextup is
      // retryable by the owner pressing a control (REQ-100 — there is no
      // automatic retry anywhere), so the remedy is always an actionable
      // element inside the alert.
      if (!actionable) offenders.push(route.path);
    }

    expect(offenders).toEqual([]);
  });

  it('T-UX-002d · the rule is not vacuous — most screens really do read', async () => {
    let fetching = 0;
    for (const route of VISITABLE) {
      const { fetched } = await visit(route.examplePath);
      if (fetched) fetching += 1;
    }

    // Six of the ten routes read on mount today. The floor is deliberately
    // below that so that legitimately deferring one read is not a CI failure,
    // and deliberately well above zero so that a change which stopped the
    // screens reading on mount cannot quietly exempt every case above.
    expect(fetching).toBeGreaterThanOrEqual(4);
  });
});
