/**
 * TASK-018/TASK-020 — steps 1 and 3 of the chain (`specs/api.md` §1):
 * `requirePrincipal` then, after the allow-list, `attachOwnerScope`.
 *
 * ⚠ `attachOwnerScope` is the ONLY place an owner id enters a request. Every
 * handler reads `req.ownerId`; none of them may read an owner id from a body,
 * a query string or a path parameter, because a caller who can name the owner
 * can read any owner's data (`T-SEC-006`, `T-SEC-029`). The value is derived
 * from the authenticated principal and nothing else.
 *
 * The two are separated because their failures differ: no principal is 401
 * (sign in), a principal outside the allow-list is 403 (signed in, refused).
 * Collapsing them would tell a refused caller to sign in again forever.
 */

import type { NextFunction, Request, Response } from 'express';

import { deriveOwnerId } from '../auth/ownerId.js';
import type { PrincipalReader } from '../auth/principal.js';
import { AppError } from '../errors/AppError.js';

/**
 * Step 1. Reads the platform header into `req.principal`, or refuses.
 *
 * Takes the reader as a parameter so local development can substitute one
 * without a runtime branch in shipped code (see `apps/api/dev/`). The
 * production call site passes the real reader and nothing else can reach this.
 */
export function makeRequirePrincipal(readPrincipal: PrincipalReader) {
  return function requirePrincipal(req: Request, _res: Response, next: NextFunction): void {
    const principal = readPrincipal(req.headers);
    if (principal === null) {
      // 401 with a JSON envelope, never an HTML sign-in page: an /api/* caller
      // is fetch(), and a redirect would surface as "unexpected token <" in
      // the console instead of a handled error (`T-SEC-008`).
      next(new AppError('UNAUTHENTICATED', 401, 'Sign in to continue.'));
      return;
    }
    req.principal = principal;
    next();
  };
}

/** Step 3. Derives the owner id and attaches it. */
export function attachOwnerScope(req: Request, _res: Response, next: NextFunction): void {
  const principal = req.principal;
  if (principal === undefined) {
    // Only reachable if the chain is mounted out of order. Refuse rather than
    // continue: continuing means an unscoped query.
    next(new AppError('UNAUTHENTICATED', 401, 'Sign in to continue.'));
    return;
  }
  req.ownerId = deriveOwnerId(principal);
  next();
}
