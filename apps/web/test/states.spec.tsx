/**
 * TASK-028 - the three states in which nextup renders nothing of itself
 * (`specs/ux-states.md` §2.10, §2.11; PRD US-001 AC-4/AC-5).
 *
 * `specs/testing.md` §9 maps US-001 AC-5 to `T-UX-019`: "IdP failure renders
 * the sign-in-again state; no partial app UI". §10 records WHY it is a
 * component test and not an e2e one - an unreachable identity provider is a
 * platform condition CI cannot induce, so the client-side state is what can
 * honestly be asserted here, and `T-SMOKE-001` covers the reachable case
 * against a deployed revision.
 *
 * The "no partial app UI" half is the load-bearing one, and it is asserted
 * negatively on purpose. US-001 AC-4 is described in the architecture handover
 * as the highest-value test in the product precisely because its failure is
 * silent: a refusal screen that still rendered the nav, or a stale list behind
 * a banner, would look fine to everyone except the person whose data leaked.
 *
 * ⚠ FINDING — A LIVE CONTRADICTION BETWEEN TWO SPECS, reported not resolved:
 * `specs/ux-states.md` §2.11 assigns **`T-UX-020`** to the 403 refusal state,
 * but `specs/testing.md` §12.2 (added by the phantom-id reconciliation) now
 * DEFINES `T-UX-020` as an **e2e** test that "each primary surface renders a
 * distinct offline state". Those are two different tests under one id, and
 * `testing.md` is the file NFR-003 makes authoritative.
 *
 * So the 403-refusal cases below are filed under **`T-UX-019f…i`**, not under
 * `T-UX-020`. Squatting on `T-UX-020` would have been the more damaging
 * choice: the id would resolve, CI would stay green, and the suite would
 * appear to carry offline-state coverage that does not exist anywhere -
 * precisely the phantom-id failure that reconciliation was run to remove.
 * `T-UX-019` is TASK-028's own named test and its definition
 * ("...; no partial app UI") is the property these cases assert.
 *
 * The real gap: **the 403 refusal has no COMPONENT-level id at all.** US-001
 * AC-4 maps only to `T-SEC-010` (unit, middleware), `T-SEC-017` (integration)
 * and `T-SEC-018` (e2e). `specs/testing.md` needs a `T-UX-0xx` row for it.
 */

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  IDP_FAILURE_BODY,
  IDP_FAILURE_TITLE,
  REFUSAL_NOT_ALLOWED_BODY,
  REFUSAL_NOT_ALLOWED_TITLE,
  SESSION_ENDED_TITLE,
  SIGN_IN_AGAIN_LABEL,
  SIGN_OUT_LABEL,
} from '../src/copy';
import { RefusalPage, SIGN_IN_URL, SIGN_OUT_URL } from '../src/pages/RefusalPage';

/**
 * "No partial app UI" made concrete.
 *
 * Anything the shell renders is a leak of the signed-in product: the nav names
 * the owner's screens, and a rendered list is the data itself. Asserting the
 * absence of the LANDMARKS rather than of specific text means a future page
 * cannot sneak content in under a different label.
 */
function expectNoAppUi(): void {
  expect(screen.queryByRole('navigation')).toBeNull();
  expect(document.querySelector('header')).toBeNull();
  expect(document.querySelector('footer')).toBeNull();
  expect(screen.queryByRole('list')).toBeNull();
}

describe('Refusal and sign-in states', () => {
  it('T-UX-019a · US-001 AC-5 · an IdP failure renders the sign-in-again state', () => {
    render(<RefusalPage reason="idp-failure" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(IDP_FAILURE_TITLE);
    // AC-5 requires the state to EXPLAIN that sign-in failed and offer a retry -
    // a bare "try again" would leave the owner unable to tell a broken app from
    // a broken identity provider.
    expect(screen.getByText(IDP_FAILURE_BODY)).toBeVisible();

    const action = screen.getByRole('link', { name: SIGN_IN_AGAIN_LABEL });
    expect(action).toHaveAttribute('href', SIGN_IN_URL);
  });

  it('T-UX-019b · US-001 AC-5 · the IdP-failure state renders no partial app UI', () => {
    render(<RefusalPage reason="idp-failure" />);
    expectNoAppUi();
  });

  it('T-UX-019c · US-001 AC-5 · the IdP-failure state offers no unauthenticated way in', () => {
    // "the app does not fall back to any unauthenticated mode" (US-001 AC-5).
    // Exactly one action exists, and it goes to the platform sign-in endpoint;
    // a "continue without signing in" or "browse anyway" escape hatch is the
    // failure this asserts against.
    render(<RefusalPage reason="idp-failure" />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', SIGN_IN_URL);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('T-UX-019d · specs/ux-states.md §2.10 · a 401 renders "Your session ended." and Sign in again', () => {
    render(<RefusalPage reason="session-expired" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(SESSION_ENDED_TITLE);
    expect(screen.getByRole('link', { name: SIGN_IN_AGAIN_LABEL })).toHaveAttribute(
      'href',
      SIGN_IN_URL,
    );
    expectNoAppUi();
  });

  it('T-UX-019e · specs/ux-states.md §1 · every refusal state is announced as an alert', () => {
    // §1: errors go in `role="alert"`. Without it a screen-reader user gets an
    // apparently empty page - the app did not load, and nothing said so.
    for (const reason of ['idp-failure', 'session-expired', 'not-allowed'] as const) {
      const view = render(<RefusalPage reason={reason} />);
      const alert = screen.getByRole('alert');
      expect(within(alert).getByRole('heading', { level: 1 })).toBeVisible();
      view.unmount();
    }
  });

  it('T-UX-019f · US-001 AC-4 · a non-allow-listed account gets the refusal, its email and Sign out', () => {
    render(<RefusalPage reason="not-allowed" signedInEmail="someone@example.com" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(REFUSAL_NOT_ALLOWED_TITLE);
    // AC-4 requires an EXPLICIT single-owner message, not just a denial.
    expect(screen.getByText(REFUSAL_NOT_ALLOWED_BODY)).toBeVisible();
    // §2.11: the signed-in email, so the owner can tell "nextup is broken" from
    // "I am signed in as the wrong account".
    expect(screen.getByTestId('refusal-email')).toHaveTextContent('someone@example.com');

    expect(screen.getByRole('link', { name: SIGN_OUT_LABEL })).toHaveAttribute(
      'href',
      SIGN_OUT_URL,
    );
  });

  it('T-UX-019g · US-001 AC-4 · the refusal renders no list data, no nav and no partial UI', () => {
    render(<RefusalPage reason="not-allowed" signedInEmail="someone@example.com" />);
    expectNoAppUi();
  });

  it('T-UX-019h · NFR-015 · the refusal offers sign-out only - no sign-in loop, no way to request access', () => {
    // Offering "Sign in again" to a refused account produces a loop that reads
    // as a bug; offering a request-access path would be a self-service
    // registration path, which NFR-015 says does not exist.
    render(<RefusalPage reason="not-allowed" signedInEmail="someone@example.com" />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', SIGN_OUT_URL);
    expect(screen.queryByRole('link', { name: SIGN_IN_AGAIN_LABEL })).toBeNull();
  });

  it('T-UX-019i · specs/security.md §2.2 · the refusal renders without an email at all', () => {
    // The email is display-only and may be absent - a malformed or missing
    // principal still has to produce a refusal, not a crashed render. Falling
    // back to a blank "Signed in as" line would be worse than omitting it.
    render(<RefusalPage reason="not-allowed" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(REFUSAL_NOT_ALLOWED_TITLE);
    expect(screen.queryByTestId('refusal-email')).toBeNull();
    expect(screen.getByRole('link', { name: SIGN_OUT_LABEL })).toBeInTheDocument();
  });
});
