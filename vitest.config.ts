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

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * `@nextup/domain` resolves to SOURCE under test, not to `dist`.
 *
 * Two reasons, both load-bearing. (1) The `test:unit` CI job runs `npm ci` then
 * `npm run coverage` with NO build step, so `packages/domain/dist` does not
 * exist there and every API test importing the package fails to resolve —
 * verified by deleting `dist` locally and watching the suite go red. (2)
 * Without it, API tests would exercise a BUILT copy of the domain: coverage
 * would credit none of it, and a stale `dist` would let tests pass against code
 * no longer in the repository.
 *
 * Vitest does not inherit a root `resolve` into `projects`, so it is applied
 * per project.
 */
const domainAlias = {
  '@nextup/domain': fileURLToPath(new URL('./packages/domain/src/index.ts', import.meta.url)),
};

export default defineConfig({
  resolve: { alias: domainAlias },

  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Only first-party source counts; fixtures and configs would inflate it.
      // Extensions are explicit: vitest 4 widened what an unqualified `src/**`
      // matches, and started reporting the `.gitkeep` placeholders that hold
      // the empty web directories as 0%-covered source files. Harmless while
      // web has no code, but it would have quietly dragged the web threshold
      // below its floor the moment real components landed — a failure that
      // would have looked like a coverage regression in new code.
      include: [
        'packages/domain/src/**/*.{ts,tsx}',
        'apps/api/src/**/*.{ts,tsx}',
        'apps/web/src/**/*.{ts,tsx}',
      ],
      exclude: [
        '**/*.d.ts',
        '**/dist/**',
        // Process entrypoints: they only bootstrap (listen / mount) and have
        // no branches to assert. Their behaviour is covered by the e2e and
        // smoke suites, which exercise a real running process. Scoped to the
        // two entry files ON PURPOSE — never widen this to `src/**`.
        'apps/api/src/index.ts',
        'apps/web/src/main.tsx',
        // The owner-scoped repository layer (TASK-017). Excluded because it is
        // measured by the WRONG suite, not because it is untested: coverage is
        // bound to CI job 4 (`test:unit`), which has no database, while every
        // line here is exercised by the `integration` project against a real
        // mssql/server:2022 (specs/testing.md §3.3a). Counting it in the unit
        // run would report 0% for thoroughly-tested code and force the floor
        // down for everything else — the exact false signal §1 warns about.
        //
        // This exclusion is NOT a licence to leave repository code untested.
        // `T-INV-023` fails if any file here is not imported by an integration
        // spec, so deleting the tests re-breaks the build rather than quietly
        // granting an exemption. Keep it scoped to this directory.
        'apps/api/src/repository/**',
      ],
      thresholds: {
        'packages/domain/src/**': { statements: 95, branches: 90 },
        'apps/api/src/**': { statements: 90, branches: 85 },
        'apps/web/src/**': { statements: 70, branches: 60 },
      },
    },

    projects: [
      {
        resolve: { alias: domainAlias },
        // ~55% of the pyramid, < 10s. Pure domain logic, no I/O, no container.
        test: {
          name: 'unit',
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          include: [
            'packages/domain/test/**/*.spec.ts',
            'apps/api/test/unit/**/*.spec.ts',
            'tools/**/*.spec.ts',
          ],
        },
      },
      {
        resolve: { alias: domainAlias },
        // ~30%, < 3min. Real mssql/server:2022 + Azurite; migrations applied
        // first (specs/testing.md §3.3a). Never mocked — the properties under
        // test are owner scoping, constraints and transactions, which a mock
        // cannot have.
        test: {
          name: 'integration',
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
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
        resolve: { alias: domainAlias },
        // The extractor golden suite — OFFLINE, replayed recordings only.
        // `goldenLive.spec.ts` is excluded here and never runs in CI: it calls
        // the live providers and COSTS MONEY (specs/testing.md §4A).
        test: {
          name: 'golden',
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          include: ['tests/extraction/**/*.spec.ts'],
          exclude: ['**/goldenLive.spec.ts'],
        },
      },
      {
        resolve: { alias: domainAlias },
        // Static assertions over Bicep and migrations: T-INFRA-*, T-INV-013,
        // T-MIG-001. No Azure subscription required.
        test: {
          name: 'infra',
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          include: ['tests/infra/**/*.spec.ts'],
        },
      },
      {
        resolve: { alias: domainAlias },
        // T-META-001: every acceptance criterion maps to a named test that
        // exists. This is the job that catches a spec growing past its suite.
        test: {
          name: 'meta',
          environment: 'node',
          setupFiles: ['./vitest.setup.ts'],
          include: ['tests/meta/**/*.spec.ts'],
        },
      },
    ],
  },
});
