/**
 * Request augmentation for the auth chain (`specs/api.md` §1).
 *
 * `principal` is set by `requirePrincipal`, `ownerId` by `attachOwnerScope`.
 * Both are optional on the type because Express hands the same `Request` shape
 * to middleware that runs BEFORE them — including the error handler, which
 * must be able to run when the chain refused the request.
 *
 * ⚠ Optional here does NOT mean "check it in every handler". A handler only
 * ever runs after the chain has completed, so `ownerId` is always present by
 * then; `requireOwnerId(req)` below turns that guarantee into a value without
 * scattering non-null assertions (which would each be a place someone could
 * later delete the middleware and still compile).
 */

import type { Request } from 'express';

import type { Principal } from '../auth/principal.js';
import type { OwnerId } from '../repository/ownerData.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
      ownerId?: OwnerId;
    }
  }
}

/**
 * @returns the owner id the chain attached.
 * @throws if it is absent, which can only mean a route was mounted outside the
 * chain. Throwing produces a 500 through the error envelope — correct, because
 * the alternative is a query with no owner filter, i.e. serving another
 * owner's data. `T-SEC-029` exists to catch that at build time instead.
 */
export function requireOwnerId(req: Request): OwnerId {
  if (req.ownerId === undefined) {
    throw new Error(
      'ownerId is missing — this route was mounted outside attachOwnerScope. ' +
        'Register it on the api router in apps/api/src/routes/index.ts.',
    );
  }
  return req.ownerId;
}

export {};
