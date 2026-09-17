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

/**
 * The shell is revalidated on every navigation; the hashed bundles never are.
 *
 * ⚠ Exported so `T-API-031` asserts the POLICY rather than a string it also
 * wrote. The two values are a matched pair: weakening the first silently pins
 * the owner to an old deploy, and weakening the second costs a round trip per
 * asset per navigation for no benefit whatever.
 */
export const SHELL_CACHE_CONTROL = 'no-cache';
export const HASHED_ASSET_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/**
 * ⚠ The `immutable` half is claimed ONLY for `/assets`, because that is the
 * only directory Vite content-hashes. `favicon.svg`, `robots.txt` and anything
 * else dropped into `public/` keep their stable names across builds, so an
 * immutable year would make them unreplaceable for a year.
 */
export function cacheControlFor(filePath: string): string {
  const segments = filePath.split(/[\\/]/);
  return segments.includes('assets') ? HASHED_ASSET_CACHE_CONTROL : SHELL_CACHE_CONTROL;
}

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
  /*
   * ⚠ THE SHELL AND THE HASHED ASSETS NEED OPPOSITE CACHE POLICIES, AND
   * `express.static`'s DEFAULT GIVES BOTH THE SAME ONE. Out of the box every
   * response carried `Cache-Control: public, max-age=0`, so the immutable,
   * content-hashed bundles were revalidated on every single navigation while
   * `index.html` — the one file whose staleness hides a whole deploy — was
   * given no stronger instruction than "revalidate if you feel like it".
   *
   * ⚠ THIS IS NOT A PERFORMANCE TWEAK. It is why "the fix did not land" is a
   * question that can be asked at all: the shell names the bundle by hash, so
   * a shell served from cache pins the owner to the PREVIOUS deploy's CSS and
   * JS indefinitely, on a URL that never changes and with a server that is
   * already serving the new bytes. Nothing on screen distinguishes that from a
   * deploy that silently failed — the owner reported exactly that on
   * 2026-09-17, minutes after a deploy that had in fact succeeded.
   *
   * `no-cache` is NOT `no-store`: the shell is still cached and still served
   * from disk, it is merely revalidated first, so the normal response is a 304
   * against the ETag Express already emits. `immutable` on `/assets` is safe
   * precisely because Vite puts the content hash in the filename — a changed
   * file is a different URL, so there is nothing to invalidate.
   */
  app.use(
    express.static(webRoot, {
      index: false,
      setHeaders: (res, filePath) => {
        res.setHeader('Cache-Control', cacheControlFor(filePath));
      },
    }),
  );

  // Client-side routing: every non-API path renders the shell.
  app.use((_req, res) => {
    res.setHeader('Cache-Control', SHELL_CACHE_CONTROL);
    res.sendFile(path.join(webRoot, 'index.html'));
  });

  return app;
}
