/**
 * TASK-023 — the API route registry (`specs/api.md` §1).
 *
 * ⚠ The mounting order below is a REQUIREMENT, not an implementation detail:
 *
 *     requirePrincipal → requireAllowList → attachOwnerScope → routes → errorEnvelope
 *
 * Each step depends on the one before it, and every reordering fails silently
 * rather than loudly. Move `attachOwnerScope` after the routes and handlers
 * see no owner id; move it before `requireAllowList` and a refused caller still
 * gets an owner scope attached; drop `requirePrincipal` and everything runs as
 * nobody. None of those produce an error at start-up, which is exactly why
 * `T-SEC-005` asserts a request cannot reach a handler without passing every
 * step, and `T-SEC-029` asserts no route is registered outside this router.
 *
 * Every route MUST be registered on `apiRouter`. A route mounted directly on
 * the app would bypass all three guards.
 */

import { type Express, Router } from 'express';

import { requireAllowList } from '../middleware/allowList.js';
import { errorEnvelope } from '../middleware/errorEnvelope.js';
import { attachOwnerScope, makeRequirePrincipal } from '../middleware/ownerScope.js';
import type { PrincipalReader } from '../auth/principal.js';
import { AppError } from '../errors/AppError.js';
import { registerMeRoutes } from './me.js';

/** Builds the router carrying every owner-scoped route. */
export function createApiRouter(): Router {
  const apiRouter = Router();
  registerMeRoutes(apiRouter);
  return apiRouter;
}

/**
 * Mounts the whole `/api` surface in the mandated order.
 *
 * The 404 fallback is inside the chain on purpose: an unknown `/api/*` path
 * must answer with the JSON envelope, not fall through to the SPA shell. A
 * typo in a fetch should surface as a handled 404, never as a page of HTML
 * being parsed as JSON.
 */
export function mountApi(app: Express, readPrincipal: PrincipalReader): void {
  app.use('/api', makeRequirePrincipal(readPrincipal));
  app.use('/api', requireAllowList);
  app.use('/api', attachOwnerScope);
  app.use('/api', createApiRouter());

  app.use('/api', (_req, _res, next) => {
    next(new AppError('NOT_FOUND', 404, 'No such resource.'));
  });

  app.use('/api', errorEnvelope);
}

/** The order asserted by `T-SEC-005`; exported so the test cannot drift. */
export const MIDDLEWARE_ORDER = [
  'requirePrincipal',
  'requireAllowList',
  'attachOwnerScope',
  'routes',
  'errorEnvelope',
] as const;
