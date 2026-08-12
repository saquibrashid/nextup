/**
 * Playwright config (TASK-002) — the ~5% of the pyramid that only exists in a
 * browser: the value loop, the two irreversible paths, the 320px floor and
 * the axe scans (`specs/testing.md` §6).
 *
 * Two projects, both required by §8 job 8: Chromium and a Mobile Safari
 * device profile. Mobile Safari is not optional decoration — nextup is
 * mobile-first at a 320px floor and the iOS clipboard path (ADR-0009) behaves
 * differently from desktop.
 *
 * ⚠ The real-device iOS paste check (TASK-165 / `T-PASTE-011`) CANNOT run
 * here. It needs a physical iPhone, a real clipboard and a human tap on a
 * system callout. `specs/testing.md` §10 names it as an honest hole in the
 * NFR-003 automated gate rather than pretending emulation covers it.
 */

import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.NEXTUP_E2E_PORT ?? 4173);
const baseURL = process.env.NEXTUP_E2E_BASE_URL ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',

  // CI is the gate, so a flake must not pass by luck: no retries locally,
  // and a single retry in CI only to absorb genuine infrastructure noise.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,

  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 13'] } },
  ],
});
