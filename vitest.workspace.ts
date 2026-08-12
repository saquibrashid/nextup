/**
 * Vitest workspace — the project split behind `npm run test:unit`,
 * `test:int`, `test:web`, `golden` and the infra suite (TASK-002).
 *
 * Layout follows `specs/testing.md` §11 verbatim: unit tests live INSIDE the
 * workspace they cover (`packages/domain/test/`, `apps/api/test/unit/`),
 * integration tests in `apps/api/test/integration/`, component tests in
 * `apps/web/test/`, and the cross-cutting suites under `tests/`.
 *
 * `tests/e2e/` is absent on purpose — that is Playwright's (`test:e2e`), not
 * Vitest's. `tests/smoke/` is also absent: it runs against a DEPLOYED
 * revision from the deploy workflow, never as part of `npm test`.
 */

import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
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
    // first (specs/testing.md §3.3a). Never mocked - the properties under
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
    // The extractor golden suite - OFFLINE, replayed recordings only.
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
]);
