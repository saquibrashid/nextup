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

import { type Express, type NextFunction, type Request, type Response, Router } from 'express';
import express from 'express';

import { requireAllowList } from '../middleware/allowList.js';
import { errorEnvelope } from '../middleware/errorEnvelope.js';
import { attachOwnerScope, makeRequirePrincipal } from '../middleware/ownerScope.js';
import type { PrincipalReader } from '../auth/principal.js';
import { AppError } from '../errors/AppError.js';
import { registerBatchCandidateRoutes } from './batchCandidates.js';
import { registerBatchCloseRoutes } from './batchClose.js';
import { registerBatchRoutes } from './batches.js';
import { registerBatchImageRoutes } from './batchImages.js';
import { registerBatchRemovalRoutes } from './batchRemovals.js';
import { registerBatchReviewRoutes } from './batchReview.js';
import { registerBatchUndoRoutes } from './batchUndo.js';
import { registerImageRoutes } from './images.js';
import { registerImdbRoutes } from './imdb.js';
import { registerMeRoutes } from './me.js';
import { registerServiceStateRoutes } from './serviceState.js';
import { registerSuppressionRoutes } from './suppressions.js';
import { registerTitleRoutes } from './titles.js';
import { registerTmdbRoutes } from './tmdb.js';
import { TmdbClient } from '../clients/tmdbClient.js';
import { OmdbClient } from '../clients/omdbClient.js';

/**
 * Ceiling for a JSON request body.
 *
 * Every JSON body this API accepts is a handful of short fields; the large
 * payloads are images, and those arrive as `multipart/form-data` on §6.12
 * under their own ceilings (`specs/api.md` §5), which `express.json()` does
 * not touch. 64 KiB is generous for the former and refuses the latter long
 * before it can be buffered into a 0.5 GiB container (REQ-079).
 */
export const JSON_BODY_LIMIT = '64kb';

/**
 * Turns a body-parser failure into a domain error.
 *
 * `express.json()` throws on malformed JSON and on an oversized body, and both
 * arrive here as a generic `Error` — which `toAppError` would classify as
 * `INTERNAL_ERROR` and report as a **500**. A client that sends a truncated
 * body would be told the server broke, and the 500 path also logs a stack
 * trace and mints a correlation id for what is plainly a bad request.
 *
 * Both conditions are already members of the closed enumeration
 * (`specs/api.md` §8), so this maps them rather than inventing a code.
 */
export function mapBodyParserError(
  thrown: unknown,
  _req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const error = thrown as { type?: unknown; status?: unknown };

  if (error?.type === 'entity.too.large') {
    next(
      new AppError('PAYLOAD_TOO_LARGE', 413, 'That request was too large.', {
        limit: JSON_BODY_LIMIT,
      }),
    );
    return;
  }

  if (error?.type === 'entity.parse.failed' || error?.type === 'encoding.unsupported') {
    next(new AppError('VALIDATION_FAILED', 400, 'That request body could not be read as JSON.'));
    return;
  }

  next(thrown);
}

/** Builds the router carrying every owner-scoped route. */
export function createApiRouter(): Router {
  const apiRouter = Router();
  registerMeRoutes(apiRouter);
  registerBatchRoutes(apiRouter);
  // §6.17 — the review pass. Its own file: the batch lifecycle routes and the
  // review assembly share nothing but the batch id, and `batches.ts` is a
  // contended file that several lanes need to keep small.
  registerBatchReviewRoutes(apiRouter);
  registerBatchRemovalRoutes(apiRouter);
  // §6.18/§6.19 — per-candidate disposition, correction and the bulk confirm.
  // Needs a TMDB client for the `reclassifyAsTitle` re-match; same per-request
  // lifetime and the same reason as `registerTmdbRoutes` below.
  registerBatchCandidateRoutes(
    apiRouter,
    () => new TmdbClient({ apiKey: process.env['TMDB_API_KEY'] ?? '' }),
  );
  // §6.22 — close. Registered after the candidate routes it depends on so the
  // read order in this file matches the order the owner moves through them.
  registerBatchCloseRoutes(apiRouter);
  // §6.25 — creates-only undo (SD-03). Registered after close because it only
  // ever acts on a batch close has already applied.
  registerBatchUndoRoutes(apiRouter);
  // §6.12 — the ONE ingest route for paste, drop and file selection alike.
  registerBatchImageRoutes(apiRouter);
  // §6.27 — the ONE route that serves image bytes. No SAS, no blob URL.
  registerImageRoutes(apiRouter);
  registerTitleRoutes(apiRouter);
  registerSuppressionRoutes(apiRouter);
  registerServiceStateRoutes(apiRouter);
  // TASK-045 (`specs/api.md` §6.29). The client is built PER REQUEST on
  // purpose: its in-process search cache then dies with the request and can
  // never accumulate into a mirror of the TMDB catalogue, which US-007 AC-6
  // forbids. See `registerTmdbRoutes`.
  //
  // The §4.1 rate limit is NOT affected by that lifetime: the gate is module
  // scoped in `tmdbClient.ts`, so the 4-concurrent / 30 ms cap holds across
  // every request in this process regardless of how many clients exist.
  //
  // ~~Superseded: "⚠ Known consequence… the rate-limit gate is per-instance,
  // so a fresh client per request starts each one believing it is the only
  // caller and the cap is not enforced ACROSS requests. The fix belongs in
  // `tmdbClient.ts`." Fixed there; `T-TMDB-010` covers it.~~
  registerTmdbRoutes(
    apiRouter,
    () => new TmdbClient({ apiKey: process.env['TMDB_API_KEY'] ?? '' }),
  );
  // TASK-170 (REQ-092). Same per-request lifetime, same reason. The OMDb
  // client's DAILY BUDGET is unaffected by it: like `tmdbClient`'s rate gate,
  // the counter is module scoped, so 1,000/day holds across the process no
  // matter how many clients are built (`T-OMDB-005`).
  registerImdbRoutes(apiRouter, () => ({
    tmdb: new TmdbClient({ apiKey: process.env['TMDB_API_KEY'] ?? '' }),
    omdb: new OmdbClient({ apiKey: process.env['OMDB_API_KEY'] ?? '' }),
  }));
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

  // Body parsing sits INSIDE the chain, after authentication: an anonymous
  // caller's body is never buffered or parsed, so an unauthenticated request
  // costs nothing beyond the 401. `express.json()` only claims
  // `application/json`, so the multipart image route (§6.12) is untouched.
  app.use('/api', express.json({ limit: JSON_BODY_LIMIT }));
  app.use('/api', mapBodyParserError);

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
  'jsonBody',
  'mapBodyParserError',
  'routes',
  'errorEnvelope',
] as const;

/**
 * The prefix of `MIDDLEWARE_ORDER` that is security-critical, in order.
 *
 * Everything after `attachOwnerScope` is request handling; everything up to
 * and including it decides WHO the caller is and whether they may proceed.
 * Splitting the two means body parsing can be inserted or moved without
 * weakening the assertion that authentication comes first.
 */
export const SECURITY_MIDDLEWARE_ORDER = [
  'requirePrincipal',
  'requireAllowList',
  'attachOwnerScope',
] as const;
