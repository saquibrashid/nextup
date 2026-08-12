/**
 * Root Vitest config (TASK-002) — coverage policy plus the project split
 * behind `test:unit`, `test:int`, `test:web`, `golden`, `test:infra` and the
 * `meta` job.
 *
 * Project layout follows `specs/testing.md` §11 verbatim: unit tests live
 * INSIDE the workspace they cover (`packages/domain/test/`,
 * `apps/api/test/unit/`), integration tests in `apps/api/test/integration/`,
 * component tests in `apps/web/test/`, and the cross-cutting suites under
 * `tests/`.
 *
 * `tests/e2e/` is absent on purpose — that is Playwright's job (`test:e2e`),
 * not Vitest's. `tests/smoke/` is also absent: it runs against a DEPLOYED
 * revision from the deploy workflow, never as part of `npm test`.
 *
 * Coverage thresholds are the per-path numbers in `specs/testing.md` §1. They
 * are a FLOOR, not a goal: the real gate is the AC→test mapping enforced by
 * `T-META-001`. A high coverage number over the wrong assertions is exactly
 * the false comfort this project cannot afford.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Only first-party source counts; fixtures and configs would inflate it.
      include: ['packages/domain/src/**', 'apps/api/src/**', 'apps/web/src/**'],
      exclude: [
        '**/*.d.ts',
        '**/dist/**',
        // Process entrypoints: they only bootstrap (listen / mount) and have
        // no branches to assert. Their behaviour is covered by the e2e and
        // smoke suites, which exercise a real running process. Scoped to the
        // two entry files ON PURPOSE — never widen this to `src/**`.
        'apps/api/src/index.ts',
        'apps/web/src/main.tsx',
      ],
      thresholds: {
        'packages/domain/src/**': { statements: 95, branches: 90 },
        'apps/api/src/**': { statements: 90, branches: 85 },
        'apps/web/src/**': { statements: 70, branches: 60 },
      },
    },

    projects: [
      {
        // ~55% of the pyramid, < 10s. Pure domain logic, no I/O, no container.
        test: {
          name: 'unit',
          environment: 'node',
          include: [
            'packages/domain/test/**/*.spec.ts',
            'apps/api/test/unit/**/*.spec.ts',
            'tools/**/*.spec.ts',
          ],
        },
      },
      {
        // ~30%, < 3min. Real mssql/server:2022 + Azurite; migrations applied
        // first (specs/testing.md §3.3a). Never mocked — the properties under
        // test are owner scoping, constraints and transactions, which a mock
        // cannot have.
        test: {
          name: 'integration',
          environment: 'node',
          include: ['apps/api/test/integration/**/*.spec.ts'],
          // A real engine plus migrations is slower than the unit default.
          testTimeout: 30_000,
          hookTimeout: 60_000,
          // Integration tests share one database; parallel files would race.
          fileParallelism: false,
        },
      },
      './apps/web/vitest.config.ts',
      {
        // The extractor golden suite — OFFLINE, replayed recordings only.
        // `goldenLive.spec.ts` is excluded here and never runs in CI: it calls
        // the live providers and COSTS MONEY (specs/testing.md §4A).
        test: {
          name: 'golden',
          environment: 'node',
          include: ['tests/extraction/**/*.spec.ts'],
          exclude: ['**/goldenLive.spec.ts'],
        },
      },
      {
        // Static assertions over Bicep and migrations: T-INFRA-*, T-INV-013,
        // T-MIG-001. No Azure subscription required.
        test: {
          name: 'infra',
          environment: 'node',
          include: ['tests/infra/**/*.spec.ts'],
        },
      },
      {
        // T-META-001: every acceptance criterion maps to a named test that
        // exists. This is the job that catches a spec growing past its suite.
        test: {
          name: 'meta',
          environment: 'node',
          include: ['tests/meta/**/*.spec.ts'],
        },
      },
    ],
  },
});
