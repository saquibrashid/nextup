/**
 * Playwright config for the POST-DEPLOY smoke suite (TASK-007).
 *
 * Separate from `playwright.config.ts` on purpose. That config starts a local
 * web server and drives real browsers against a build; this one starts
 * nothing and makes plain HTTP requests against an already-deployed revision
 * named by `SMOKE_BASE_URL`.
 *
 * Sharing one config would mean a smoke run could silently boot a LOCAL
 * server and pass against it while the deployment it was supposed to gate was
 * never touched — a green deploy gate that tested nothing.
 *
 * No browsers are launched, so CI needs no `playwright install`.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/smoke',
  testMatch: '**/*.spec.ts',

  // A smoke suite gates a deployment, so a flaky pass is worse than a slow
  // failure: no retries, and it must not be possible to ship a run that
  // contained a `.only`.
  retries: 0,
  forbidOnly: true,
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',

  // A freshly started revision may still be cold. Generous per-request
  // timeouts, but no retry loop that would mask a genuinely dead deployment.
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    ignoreHTTPSErrors: false,
    extraHTTPHeaders: { 'user-agent': 'nextup-smoke' },
  },
});
