# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`TASK-002` — test harness.** `vitest.workspace.ts` defines the five Vitest
  projects (`unit`, `integration`, `web`, `golden`, `infra`) using the test
  layout in `specs/testing.md` §11 verbatim; `vitest.config.ts` carries the §1
  per-path coverage thresholds; `apps/web/vitest.config.ts` adds the jsdom +
  Testing Library component environment; `playwright.config.ts` adds the
  Chromium and Mobile Safari e2e projects. New scripts: `test:a11y`, `golden`,
  `test:infra`, and `format:check` is now enforced in CI.
- **The `T-META-004` test-ID naming rule** (`tools/eslint-rules/test-id-naming.js`),
  surfaced to ESLint through an in-repo workspace plugin
  (`tools/eslint-plugin-nextup`) so no third-party rule loader is needed
  (NFR-004). It requires every `it`/`test` title to start with a `T-` id,
  rejects dynamically-computed titles (an id CI cannot read statically is not
  an id), and flags duplicate ids within a file. `describe` is exempt. Verified
  both by `RuleTester` (21 cases) and by running real ESLint against an
  intentionally mis-named test — `TASK-002`'s exit criterion.
- Repository scaffolded from the nextup specification set: community health
  files, baseline TypeScript monorepo (`apps/web`, `apps/api`,
  `packages/domain`), Bicep infrastructure skeletons, CI workflow, and the full
  documentation and specs under `docs/` and `specs/`. No application logic yet —
  implementation is driven by [docs/backlog.md](docs/backlog.md), starting at
  `TASK-001`.
- Root `devDependencies` (`typescript`, `eslint`, `@typescript-eslint/*`,
  `eslint-config-prettier`, `prettier`, `vitest`, `@types/node`) and web
  `@types/react` / `@types/react-dom`, plus `package-lock.json`. The scripts and
  config files already referenced these tools but never declared them, so
  `npm run lint`, `typecheck`, `test:*` and `build` all failed on a clean clone.
  `TASK-001`'s exit criterion — `npm ci && npm run lint && npm run build` on a
  clean clone — now passes.

### Fixed

- **`prettier --check` had never passed on this repository** (40 files,
  including the original scaffold's own `README.md` and `package.json`). It was
  declared as a script but wired into no gate, so the failure was invisible;
  `TASK-003` would have inherited a lint job that could not go green. The tree
  is now formatted, `package-lock.json` / `playwright-report/` / `test-results/`
  are prettier-ignored, and CI runs `format:check` as an explicit step so a
  failure names its cause instead of hiding inside eslint output.
- **`tests/unit/` and `tests/integration/` contradicted the authoritative test
  layout.** `specs/testing.md` §11 places unit tests inside the workspace they
  cover (`packages/domain/test/`, `apps/api/test/unit/`) and integration tests
  in `apps/api/test/integration/`. The two stray scaffold directories are
  removed; had they survived, Vitest's include globs and the spec would have
  disagreed silently and new tests would have landed in a directory nothing
  runs.

- **`docs/backlog.md` TASK-017 and TASK-047 led with superseded PostgreSQL
  instructions.** Both are on the critical path and both named the retained,
  superseded chapters (`data-model.md` §15.3 / §15.6), `postgres:16-alpine`,
  `pg_trgm` GIN and `EXPLAIN` in their *primary* text, correcting to Azure SQL
  only in an appended `↳ R4` clause. A literal top-to-bottom implementer would
  have built the wrong DDL, the wrong indexes and the wrong test container.
  The current (R4/R7) design is now the primary instruction and the PostgreSQL
  text is demoted to a struck-through history line — the same in-place
  treatment already applied to TASK-006 and TASK-141 (review finding `F-006`).
- **CI could never pass its SQL Server wait step.** `.github/workflows/ci.yml`
  and `specs/testing.md` §3.3a both invoked `/opt/mssql-tools18/bin/sqlcmd`
  as a runner command, but that binary exists only *inside* the mssql service
  container — Microsoft client tools were removed from the `ubuntu-24.04`
  runner image. The step now reaches `sqlcmd` via `docker exec` into the
  service container, and the spec is corrected in place with the unrunnable
  original retained struck-through. `T-INFRA-006` is widened to assert the
  step is *runnable*, not merely *present* — the original was present and
  unrunnable, so a presence-only assertion would go green while CI went red.

### Notes

- `--passWithNoTests` has been **removed from `test:unit`** now that the
  `T-META-004` rule tests exist — the unit suite can no longer pass vacuously.
  It remains on `test:int`, `test:web`, `golden` and `test:infra` because those
  suites genuinely have no tests yet (they arrive with `TASK-017` and later).
  **Each flag must be dropped by the task that lands that suite's first test**,
  not inherited forward: a suite that passes with zero tests is the single
  easiest way for CI to be green while asserting nothing.
- The Vitest `golden` project excludes `**/goldenLive.spec.ts`. That exclusion
  is load-bearing, not tidiness — the live variant calls the real extraction
  providers and costs money (`specs/testing.md` §4A).
- `npm audit --omit=dev` reports **0 vulnerabilities**; the 6 findings in a full
  `npm audit` are all dev-only (esbuild/vite transitive). `TASK-004` owns the
  audit gate and should scope it accordingly rather than forcing a breaking
  `vite@8` upgrade for a dev-server advisory that never ships.
