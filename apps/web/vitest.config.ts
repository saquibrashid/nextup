/**
 * Component tests for the SPA (TASK-002) - ~10% of the pyramid, < 30s.
 *
 * These own the screen states in `specs/ux-states.md`: copy constants,
 * section presence/absence, and ticked-by-default behaviour. jsdom is enough
 * for all of it; anything that genuinely needs a browser (the 320px floor,
 * clipboard permissions, axe scans) belongs in Playwright instead.
 */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // `@nextup/domain` resolves to SOURCE, matching every project in the
      // root config. Without this the web project resolves through
      // `node_modules` to `packages/domain/dist`, which `npm ci` never builds
      // — so the suite passes on a developer machine that happens to have a
      // stale `dist` and fails on CI with "Failed to resolve import".
      //
      // This was latent until the first `apps/web/src` file imported the
      // package: the dependency was declared in `apps/web/package.json` but
      // never used, so nothing exercised the resolution path.
      '@nextup/domain': fileURLToPath(
        new URL('../../packages/domain/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.spec.{ts,tsx}'],
    // ⚠ ORDER IS LOAD-BEARING. The root setup installs the network egress
    // guard (`T-CI-007`) by wrapping `fetch`/`http.request`; anything that
    // legitimately intercepts requests — `msw` for TMDB — must be installed
    // AFTER it, so the interceptor sits above the guard and a faked request
    // never reaches it. Reverse the order and the guard wraps the interceptor
    // instead, blocking the very requests the fakes exist to serve.
    setupFiles: ['../../vitest.setup.ts', './test/setup.ts'],
  },
});
