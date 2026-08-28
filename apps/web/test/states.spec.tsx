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
 * ⚠ FINDING — THE ID FOR THIS STATE IS INCONSISTENT ACROSS THE TWO SPECS,
 * reported not resolved. `specs/ux-states.md` §2.11 assigns the 403 refusal
 * `T-UX-020`, and `specs/testing.md`'s own TASK-024 correction note agrees
 * that the dense allocation in `ux-states.md` "is the original and wins" —
 * but the row `testing.md` actually DEFINES for this state is `T-UX-025`, and
 * `T-UX-020` has no definition row anywhere (it was struck through at
 * `testing.md` L1600 when the offline pair was renumbered to
 * `T-UX-023`/`T-UX-024`). So citing `T-UX-020` fails `T-META-005a` on the
 * spot. These cases use `T-UX-025`: it is the id `testing.md` defines, and
 * NFR-003 makes `testing.md` authoritative for the AC-to-test mapping.
 * `ux-states.md` §2.11 should be re-pointed to it.
 *
 * ⚠ AN EARLIER VERSION OF THIS NOTE WAS WRONG and is corrected here rather
 * than left to be inherited: it claimed `T-UX-020` was live in `testing.md`
 * §12.2 as an offline-state e2e test, and therefore that two different live
 * tests shared one id. It is not live — it is retired. The lesson survives
 * the correction: an id that resolves is not an id that runs.
 *
 * The gap this file used to record — "the 403 refusal has no COMPONENT-level
 * id at all" — is now CLOSED. `T-UX-025` (`specs/testing.md` L1583) was a
 * phantom: defined, mapped, and carried by no test, so `check:test-ids`
 * resolved it while nothing ran. The four 403 cases below (previously filed
 * under `T-UX-019f…i`, borrowing an IdP-failure id) now carry it.
 * `T-UX-019a…e` keep the 401/IdP cases that `T-UX-019` actually names.
 *
 * ⚠ AND A CORRECTION TO THIS FILE'S OWN CLAIM. The header used to present
 * these cases as the assertion of "no partial app UI". They are not, and
 * TASK-028 proved it in a browser: `RefusalPage` is rendered here IN
 * ISOLATION, so `expectNoAppUi()` below asserts only that the component emits
 * no nav of its own — which was true while the assembled application wrapped
 * that same component in `AppShell` and served a refused account the entire
 * product navigation. These cases passed throughout. `T-SEC-018c` is what
 * caught it. A component test cannot make a statement about composition; the
 * `OwnerGate` cases at the end of this file are the closest a unit test gets,
 * and they assert the gate's own choice, not the shell's.
 */

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import {
  GATE_FAILED_TITLE,
  IDP_FAILURE_BODY,
  IDP_FAILURE_TITLE,
  REFUSAL_NOT_ALLOWED_BODY,
  REFUSAL_NOT_ALLOWED_TITLE,
  RETRY_LABEL,
  SESSION_ENDED_TITLE,
  SIGN_IN_AGAIN_LABEL,
  SIGN_OUT_LABEL,
} from '../src/copy';
import { OwnerGate } from '../src/containers/OwnerGate';
import { RefusedError, type ApiClient } from '../src/lib/apiClient';
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

  it('T-UX-025a · US-001 AC-4 · a non-allow-listed account gets the refusal, its email and Sign out', () => {
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

  it('T-UX-025b · US-001 AC-4 · the refusal renders no list data, no nav and no partial UI', () => {
    render(<RefusalPage reason="not-allowed" signedInEmail="someone@example.com" />);
    expectNoAppUi();
  });

  it('T-UX-025c · NFR-015 · the refusal offers sign-out only - no sign-in loop, no way to request access', () => {
    // Offering "Sign in again" to a refused account produces a loop that reads
    // as a bug; offering a request-access path would be a self-service
    // registration path, which NFR-015 says does not exist.
    render(<RefusalPage reason="not-allowed" signedInEmail="someone@example.com" />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', SIGN_OUT_URL);
    expect(screen.queryByRole('link', { name: SIGN_IN_AGAIN_LABEL })).toBeNull();
  });

  it('T-UX-025d · specs/security.md §2.2 · the refusal renders without an email at all', () => {
    // The email is display-only and may be absent - a malformed or missing
    // principal still has to produce a refusal, not a crashed render. Falling
    // back to a blank "Signed in as" line would be worse than omitting it.
    render(<RefusalPage reason="not-allowed" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(REFUSAL_NOT_ALLOWED_TITLE);
    expect(screen.queryByTestId('refusal-email')).toBeNull();
    expect(screen.getByRole('link', { name: SIGN_OUT_LABEL })).toBeInTheDocument();
  });
});

/**
 * `OwnerGate` (TASK-028) — the gate itself, asserted at the component level.
 *
 * ⚠ THESE EXIST BECAUSE THE CASES ABOVE CANNOT COVER COMPOSITION. Rendering
 * `RefusalPage` alone proves the component is clean; it says nothing about
 * what the application renders around it. `T-SEC-018` is the real proof, in a
 * browser, against the built bundle — these are the fast, precise statement of
 * which branch the gate takes for each answer from `GET /api/me`, so a
 * regression names a branch instead of just failing an e2e screenshot.
 */
describe('OwnerGate', () => {
  function gateWith(getMe: () => Promise<unknown>) {
    return { getMe } as unknown as ApiClient;
  }

  it('T-UX-025e · US-001 AC-4 · a refused identity renders the refusal and never mounts the app', async () => {
    render(<OwnerGate client={gateWith(() => Promise.reject(new RefusedError('Not allowed.')))} />);

    expect(await screen.findByText(REFUSAL_NOT_ALLOWED_TITLE)).toBeVisible();
    // The property the container-level refusal could not deliver: the shell is
    // never constructed at all, so there is no nav to leak.
    expectNoAppUi();
    expect(document.querySelector('.app-shell')).toBeNull();
  });

  it('T-UX-025f · US-001 AC-4 · the app is not mounted while the identity check is still in flight', () => {
    // ⚠ THE HALF OF THE LEAK A POST-REFUSAL FIX CANNOT REACH. Before the gate,
    // every screen rendered its loading state INSIDE the shell — so a refused
    // account was shown the full navigation for the length of a round trip,
    // and only then told it had no account. A gate that renders the product
    // optimistically while it waits reintroduces exactly that window.
    render(<OwnerGate client={gateWith(() => new Promise(() => {}))} />);

    expectNoAppUi();
    expect(document.querySelector('.app-shell')).toBeNull();
  });

  it('T-UX-025g · specs/ux-states.md §2.11 · a failed identity check is retryable and is NOT reported as a refusal', async () => {
    // A refusal is final (NFR-015); a network fault is not. Collapsing the two
    // would either tell the owner they have been denied access over a dropped
    // packet, or - far worse in the other direction - render the product
    // because the check merely failed to complete.
    let attempts = 0;
    render(
      <OwnerGate
        client={gateWith(() => {
          attempts += 1;
          return Promise.reject(new Error('network down'));
        })}
      />,
    );

    expect(await screen.findByText(GATE_FAILED_TITLE)).toBeVisible();
    expect(screen.queryByText(REFUSAL_NOT_ALLOWED_TITLE)).toBeNull();
    expect(screen.getByRole('button', { name: RETRY_LABEL })).toBeVisible();

    const before = attempts;
    await userEvent.click(screen.getByRole('button', { name: RETRY_LABEL }));
    expect(attempts).toBeGreaterThan(before);
  });
});
