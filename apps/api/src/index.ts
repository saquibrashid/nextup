// @nextup/api — Node + Express API. In production this same process also serves
// the built SPA from apps/web: one image, one process, one port (ADR-0003,
// specs/api.md §1). There is no CORS configuration and none may be added —
// with a single origin a cross-origin request is simply not possible, and
// `T-API-001` asserts no `Access-Control-Allow-Origin` header is ever emitted.
//
// SCOPE (TASK-005). This is the container shape only. Routes, middleware order,
// owner scoping, batch atomicity and the full error envelope are specified in
// specs/api.md and built by their own backlog tasks with their own named tests.
// Do not add routes here without them.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';

const port = Number(process.env.PORT ?? 3000);

/**
 * Where the built SPA lives. In the container the web build is copied next to
 * the API build; in a local `npm run build` it sits in the workspace. Both
 * resolve to the same relative position, so `node dist/index.js` behaves
 * identically in either place.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = process.env.NEXTUP_WEB_ROOT ?? path.resolve(here, '..', '..', 'web', 'dist');

export function createApp(): express.Express {
  const app = express();

  // Express advertises itself by default; there is no reason to tell the
  // internet which server this is.
  app.disable('x-powered-by');

  // ── API ────────────────────────────────────────────────────────────────
  // Mounted BEFORE the static handler so an asset can never shadow a route.

  app.get('/api/me', (_req, res) => {
    // FAIL CLOSED. specs/api.md §6 — every route returns 401 UNAUTHENTICATED
    // without a valid principal. The real principal adapter (TASK-018) and the
    // allow-list middleware (TASK-019, `T-SEC-010`) replace this; until they
    // land the honest answer is "no principal, no access", never a permissive
    // placeholder that someone later forgets to close.
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Sign in to continue.',
      },
    });
  });

  // Any other /api/* path is a genuine 404 rather than the SPA shell, so a
  // typo in a fetch surfaces as an error instead of a page of HTML parsed as
  // JSON.
  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'No such resource.' },
    });
  });

  // ── SPA ────────────────────────────────────────────────────────────────
  app.use(express.static(webRoot, { index: false }));

  // Client-side routing: every non-API path renders the shell.
  app.use((_req, res) => {
    res.sendFile(path.join(webRoot, 'index.html'));
  });

  return app;
}

/* c8 ignore start — bootstrap only; exercised by the e2e and smoke suites. */
if (process.env.NEXTUP_NO_LISTEN !== '1') {
  createApp().listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`nextup listening on :${port} (spa root: ${webRoot})`);
  });
}
/* c8 ignore stop */
