/**
 * `OwnerGate` (TASK-028) — the identity check that decides whether the product
 * is rendered **at all** (`specs/ux-states.md` §2.10/§2.11, PRD US-001
 * AC-4/AC-5/AC-6).
 *
 * ⚠ THIS EXISTS BECAUSE A PER-SCREEN REFUSAL BRANCH CANNOT SATISFY §2.11.
 * Every container already renders `<RefusalPage />` when its own fetch is
 * refused — but a route element is rendered **inside `AppShell`'s `<main>`**,
 * so the shell's header, nav and footer are painted around it. §2.11 requires
 * "no list data, **no nav** and no partial UI", and the nav names every screen
 * the owner has. A refusal rendered inside the shell has already leaked the
 * shape of the account it just refused.
 *
 * ⚠ AND THE LEAK STARTS BEFORE THE REFUSAL. A container cannot know it is
 * refused until its fetch resolves; until then it renders a loading state
 * inside the shell, nav and all. So there is no post-hoc fix at the container
 * level — not even a correct one — and the check has to happen before the
 * router mounts. `RefusalPage`'s own header has said so since it was written:
 * *"It is rendered INSTEAD of the router when the API refuses."*
 *
 * ⚠ THE COMPONENT TEST COULD NOT SEE ANY OF THIS. `apps/web/test/states.spec.tsx`
 * renders `RefusalPage` in isolation and asserts it emits no nav — true of the
 * component, and silent about the application. `T-SEC-018` is the assertion
 * that caught it, in a browser, against the assembled app.
 *
 * ⚠ A FAILED `/api/me` DOES NOT RENDER THE PRODUCT. If the identity cannot be
 * established, the honest answer is a retry, not the shell: rendering the app
 * on an unproven identity is the same class of mistake as rendering it on a
 * refused one. It is a distinct state from a refusal, because a refusal can
 * never be retried into success (NFR-015) and a network blip can.
 *
 * Sign-in and sign-out remain platform operations (Easy Auth, ADR-0002) — this
 * component contains no authentication logic, only a read of `GET /api/me`.
 */

import type { JSX } from 'react';

import { App } from '../App';
import { apiClient, type ApiClient } from '../lib/apiClient';
import { useResource } from '../lib/useResource';
import { RefusalPage } from '../pages/RefusalPage';
import { GATE_CHECKING, GATE_FAILED_BODY, GATE_FAILED_TITLE, RETRY_LABEL } from '../copy';

export interface OwnerGateProps {
  /** Injected in tests; the module singleton everywhere else. */
  readonly client?: ApiClient;
}

export function OwnerGate({ client = apiClient }: OwnerGateProps = {}): JSX.Element {
  const me = useResource((signal) => client.getMe(signal), 'me');

  switch (me.resource.kind) {
    case 'ok':
      return <App />;

    // 403 `NOT_ALLOWED` — authenticated, but not the owner (US-001 AC-4).
    // ⚠ The email is supplied HERE, and this is the only site that has to
    // supply it. The eight per-container `<RefusalPage reason="not-allowed" />`
    // fallbacks sit behind this gate and cannot be reached by a refused
    // account, because the gate runs before the router mounts. Until this
    // line existed, `specs/ux-states.md` §2.11's "+ the signed-in email" was
    // asserted only by a test that hand-supplied the prop, so the product had
    // never once shown it.
    case 'refused':
      return <RefusalPage reason="not-allowed" signedInEmail={me.resource.signedInAs} />;

    /*
     * ⚠ CHROME-FREE, like the refusal itself. A spinner inside the shell would
     * show the nav to an account that is about to be refused — the leak this
     * component exists to close, merely delayed by one round trip.
     */
    case 'loading':
      return (
        <main className="owner-gate" aria-busy="true">
          <p>{GATE_CHECKING}</p>
        </main>
      );

    default:
      return (
        <main className="owner-gate" role="alert">
          <h1>{GATE_FAILED_TITLE}</h1>
          <p>{GATE_FAILED_BODY}</p>
          <button type="button" className="tap-target" onClick={me.reload}>
            {RETRY_LABEL}
          </button>
        </main>
      );
  }
}
