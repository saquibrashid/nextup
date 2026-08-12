/**
 * TASK-023 — the Express application (`specs/api.md` §1).
 *
 * One process serves both the API and the built SPA: one image, one origin,
 * one port (ADR-0003). Because there is only one origin, a cross-origin
 * request is not possible, so there is NO CORS middleware here and none may be
 * added — `T-API-001` asserts no `Access-Control-Allow-Origin` header is ever
 * emitted. Adding CORS "to be safe" would create the very cross-origin surface
 * its absence removes.
 *
 * The API is mounted before the static handler so an asset can never shadow a
 * route, and the SPA fallback is mounted last so client-side routing works on
 * a hard refresh.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { type Express } from 'express';

import { type PrincipalReader, readPrincipal } from './auth/principal.js';
import { mountApi } from './routes/index.js';

/**
 * Where the built SPA lives. In the container the web build is copied next to
 * the API build; in a local `npm run build` it sits in the workspace. Both
 * resolve to the same relative position, so `node dist/index.js` behaves
 * identically in either place.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultWebRoot = path.resolve(here, '..', '..', 'web', 'dist');

export interface CreateAppOptions {
  /**
   * How to read the caller's identity. Defaults to the real Easy Auth header
   * adapter.
   *
   * ⚠ This seam exists so local development can inject a synthetic principal
   * WITHOUT any dev-only code being reachable from — or even present in — the
   * production build. It is dependency injection, deliberately not a runtime
   * flag such as `if (process.env.NODE_ENV !== 'production')`: a flag ships the
   * bypass and leaves one environment variable between an attacker and an
   * arbitrary identity. See `apps/api/dev/README.md` and `T-SEC-019`.
   */
  readPrincipal?: PrincipalReader;
  webRoot?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const webRoot = options.webRoot ?? process.env.NEXTUP_WEB_ROOT ?? defaultWebRoot;

  // Express advertises itself by default; there is no reason to tell the
  // internet which server this is.
  app.disable('x-powered-by');

  // Container Apps terminates TLS and proxies, so the client address and
  // protocol arrive in forwarded headers. Trusting exactly one hop is correct
  // here: `true` would trust a client-supplied chain.
  app.set('trust proxy', 1);

  // ── API ────────────────────────────────────────────────────────────────
  // Mounted BEFORE the static handler so an asset can never shadow a route.
  mountApi(app, options.readPrincipal ?? readPrincipal);

  // ── SPA ────────────────────────────────────────────────────────────────
  app.use(express.static(webRoot, { index: false }));

  // Client-side routing: every non-API path renders the shell.
  app.use((_req, res) => {
    res.sendFile(path.join(webRoot, 'index.html'));
  });

  return app;
}
