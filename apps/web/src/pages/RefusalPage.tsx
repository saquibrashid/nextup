/**
 * `RefusalPage` (TASK-028) - the three states in which nextup renders NOTHING
 * of itself: refused, expired, and unable to sign you in.
 *
 * `specs/ux-states.md` §2.10 (401), §2.11 (403) and PRD US-001 AC-4/AC-5.
 *
 * ⚠ **No nav, no list data, no partial app UI.** §2.11 states that in those
 * words, and it is the reason this page renders its own landmarks instead of
 * sitting inside `AppShell`: US-001 AC-4 is described in the architecture
 * handover as the highest-value test in the product, and its failure mode is
 * that the app looks perfectly healthy while showing one person's watchlist to
 * another tenant member. A refusal that still rendered the nav would be a
 * refusal that had already leaked the shape of the owner's data.
 *
 * ⚠ There is no route for this page and it must never get one. It is rendered
 * INSTEAD of the router when the API refuses, so it cannot be reached by typing
 * a URL, and there is no self-service path out of it (NFR-015).
 *
 * ⚠ Sign-in and sign-out are platform operations (Container Apps Easy Auth,
 * ADR-0002). They are plain links to `/.auth/*`, never `fetch` calls and never
 * client-side auth logic - the app contains zero authentication code, and
 * `T-SEC-011` fails if that changes.
 */

import type { JSX } from 'react';

import {
  IDP_FAILURE_BODY,
  IDP_FAILURE_TITLE,
  REFUSAL_NOT_ALLOWED_BODY,
  REFUSAL_NOT_ALLOWED_TITLE,
  SESSION_ENDED_TITLE,
  SIGN_IN_AGAIN_LABEL,
  SIGN_OUT_LABEL,
} from '../copy';

/** `specs/ux-states.md` §2.10 - Easy Auth's sign-in endpoint for the Entra provider. */
export const SIGN_IN_URL = '/.auth/login/aad';

/** `specs/security.md` §2 / `apps/api/src/routes/me.ts` - Easy Auth's sign-out endpoint. */
export const SIGN_OUT_URL = '/.auth/logout';

export type RefusalReason =
  /** 403 `NOT_ALLOWED` - authenticated, but not on the allow-list (US-001 AC-4). */
  | 'not-allowed'
  /** 401 `UNAUTHENTICATED` - the session ended (US-001 AC-6, ux-states §2.10). */
  | 'session-expired'
  /** The IdP is unreachable or returned an error (US-001 AC-5). */
  | 'idp-failure';

export interface RefusalPageProps {
  readonly reason: RefusalReason;
  /**
   * The signed-in email, shown on a 403 only (§2.11).
   *
   * ⚠ Display only. An email is never an authorisation input anywhere in
   * nextup (`specs/security.md` §2.2, `T-SEC-015`); it is here so the owner can
   * see WHICH account was refused, which is the difference between "nextup is
   * broken" and "I am signed in as the wrong account".
   */
  readonly signedInEmail?: string | null;
  /**
   * Where **Sign in again** points. Defaults to the bare Easy Auth endpoint.
   *
   * ⚠ §6.18 requires the review's 401 to return the owner to *this URL*, which
   * the bare endpoint does not do — it lands them on `/`, i.e. the list, with
   * their review apparently gone. The caller passes the URL the client already
   * built (`signInUrl(currentPath)`), so the `post_login_redirect_uri` is
   * constructed in exactly one place.
   */
  readonly signInHref?: string;
  /**
   * An extra sentence under the title, for a cause that has more to say than
   * the title alone (§6.18). Rendered verbatim; never assembled here.
   */
  readonly reassurance?: string;
}

export function RefusalPage({
  reason,
  signedInEmail = null,
  signInHref = SIGN_IN_URL,
  reassurance,
}: RefusalPageProps): JSX.Element {
  const isRefused = reason === 'not-allowed';

  const title = isRefused
    ? REFUSAL_NOT_ALLOWED_TITLE
    : reason === 'session-expired'
      ? SESSION_ENDED_TITLE
      : IDP_FAILURE_TITLE;

  const body = isRefused
    ? REFUSAL_NOT_ALLOWED_BODY
    : reason === 'idp-failure'
      ? IDP_FAILURE_BODY
      : null;

  return (
    <div className="refusal" data-testid="refusal-page" data-reason={reason}>
      <main>
        {/*
          role="alert" per specs/ux-states.md §1: an error surface is announced,
          and focus/announcement is how a screen-reader user learns the app did
          not load rather than being left on an empty page.
        */}
        <section role="alert" aria-labelledby="refusal-title">
          <h1 id="refusal-title">{title}</h1>
          {body === null ? null : <p>{body}</p>}
          {reassurance === undefined ? null : (
            <p data-testid="refusal-reassurance">{reassurance}</p>
          )}

          {isRefused && signedInEmail !== null && signedInEmail !== '' ? (
            <p className="refusal__account">
              Signed in as <span data-testid="refusal-email">{signedInEmail}</span>
            </p>
          ) : null}

          {/*
            Exactly one action, and it differs by cause: a refused account must
            SIGN OUT (signing in again returns the same refusal, which would
            read as a broken loop), while an expired session or a failed IdP
            must SIGN IN. Offering both would invite the wrong one.
          */}
          {isRefused ? (
            <a className="tap-target" href={SIGN_OUT_URL} data-testid="refusal-action">
              {SIGN_OUT_LABEL}
            </a>
          ) : (
            <a className="tap-target" href={signInHref} data-testid="refusal-action">
              {SIGN_IN_AGAIN_LABEL}
            </a>
          )}
        </section>
      </main>
    </div>
  );
}
