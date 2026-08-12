/**
 * `GET /api/me` — who the caller is, from the server's point of view
 * (`specs/api.md` §6.1).
 *
 * SCOPE. TASK-023 needs one real route to prove the chain end to end, and the
 * container's acceptance check (TASK-005) fetches this path. The response here
 * is a strict SUBSET of §6.1: `attribution` is added by TASK-024 together with
 * `packages/domain/src/attribution.ts` and `T-ATTR-001`, which asserts the API
 * value, the constant and the rendered DOM text are byte-equal. Do not inline
 * the disclaimer string here — one source, verbatim, never re-typed.
 */

import type { Router } from 'express';

import { requireOwnerId } from '../middleware/requestContext.js';

/** Easy Auth's sign-out endpoint. Platform-owned; the app implements no logout. */
export const SIGN_OUT_URL = '/.auth/logout';

export function registerMeRoutes(router: Router): void {
  router.get('/me', (req, res) => {
    res.json({
      ownerId: requireOwnerId(req),
      // Display only — see the note on `Principal.email`. It is echoed back so
      // the UI can show who is signed in; it is never an authorisation input.
      displayName: req.principal?.email ?? null,
      signOutUrl: SIGN_OUT_URL,
    });
  });
}
