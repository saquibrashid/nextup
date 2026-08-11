# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

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

- `test:unit` / `test:int` / `test:web` currently carry `--passWithNoTests` as
  a deliberate stopgap: no test files or per-workspace `vitest.config.ts` exist
  yet. `TASK-002` owns the test harness and should remove these flags as soon
  as the first real tests land, so the suite cannot pass vacuously.
