/**
 * Root Vitest config — global options that apply across the workspace
 * projects defined in `vitest.workspace.ts` (TASK-002).
 *
 * Coverage thresholds are the ones in `specs/testing.md` §1, per path. They
 * are a FLOOR, not a goal: the real gate is the AC->test mapping enforced by
 * T-META-001 (TASK-126). A high coverage number over the wrong assertions is
 * exactly the false comfort this project cannot afford.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Only first-party source counts; fixtures and configs would inflate it.
      include: ['packages/domain/src/**', 'apps/api/src/**', 'apps/web/src/**'],
      exclude: ['**/*.d.ts', '**/dist/**'],
      thresholds: {
        'packages/domain/src/**': { statements: 95, branches: 90 },
        'apps/api/src/**': { statements: 90, branches: 85 },
        'apps/web/src/**': { statements: 70, branches: 60 },
      },
    },
  },
});
