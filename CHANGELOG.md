# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`TASK-005` — the production container.** `Dockerfile` (multi-stage) and
  `.dockerignore`: **one image, one process, one port** serving the built SPA
  and the Express API (ADR-0003, `specs/api.md` §1) — the packaging reason the
  API carries no CORS configuration at all. The base image is pinned **by
  digest**, not by tag, in both stages (`specs/security.md` §8): a tag is
  mutable, so a tag-pinned build that passed CI is not the build that ships.
  CI job 12 no longer skips when the `Dockerfile` is absent — it builds the
  image, runs it, and asserts the exit criterion (`/` returns the SPA shell,
  `/api/me` returns a 401 envelope rather than the shell) plus a check that no
  build tooling survived into the runtime image.
  - `apps/api/src/index.ts` is now a real Express server. `/api/me` **fails
    closed** with `401 UNAUTHENTICATED` (`specs/api.md` §6) until the principal
    adapter (`TASK-018`) and the allow-list (`TASK-019`) land. A permissive
    placeholder here is the kind of thing that is never noticed again; the
    route must never return 200 without a principal. Unknown `/api/*` paths
    return a 404 envelope rather than the SPA shell, so a mistyped `fetch`
    surfaces as an error instead of HTML parsed as JSON.
  - Removed `peerDependencies.eslint` from `tools/eslint-plugin-nextup`. A peer
    dependency is **not** marked `dev` in the lockfile, so `npm ci --omit=dev`
    kept installing all of ESLint (3.9 MB) into the production image. The root
    already devDepends on ESLint and the plugin is private and never published,
    so the peer declaration bought nothing and cost a runtime dependency.
  - `.dockerignore` excludes `*.tsbuildinfo`. `tsc --build` is incremental: a
    stale host build-info copied into the context makes it declare the project
    up to date and **emit nothing**, so `dist` never appears — the exact
    failure hit while building this task.
  - `NPM_REGISTRY` is a build arg defaulting to the public registry, for
    networks where npmjs.org is unreachable. The default must stay public:
    GitHub-hosted runners cannot resolve an internal proxy, and an internal URL
    committed as the default would break CI and publish internal infrastructure.

- **`TASK-004` — supply-chain gates.** `tools/check-deps.mjs` enforces NFR-005
  as a CI allow-list rather than a review convention: no telemetry/analytics/APM
  package in **any** `package.json` (the seven vendors `specs/security.md` §8
  names, plus their scoped and suffixed variants), no third-party `<script src>`
  in any `index.html`, and no hard-coded analytics host in source — because a
  `fetch()` beacon is the same defect with none of the dependency-diff
  visibility. Wired into CI job 3 and asserted by `T-SEC-009a`–`j`, including
  `TASK-004`'s exit criterion (adding `posthog-js` fails) and a check that the
  script actually **exits non-zero**, since a checker that finds violations and
  exits 0 blocks nothing.
- **`T-CI-006` — every GitHub Action is now pinned to a full commit SHA**, not
  a tag. A tag is mutable: `@v2` can be re-pointed at new code by anyone who
  can push to that repository, in a workflow that holds `GITHUB_TOKEN`. The
  same script enforces it, so a new unpinned action fails CI. This test had no
  owning backlog task; it is squarely a supply-chain gate, so it lands here.
- **`TASK-003` — CI, the only gate.** `.github/workflows/ci.yml` now runs the
  **twelve blocking jobs** of `specs/testing.md` §8 — `lint`, `secrets`
  (gitleaks), `audit`, `test:unit`+coverage, `test:int` (mssql/server:2022 +
  Azurite), `test:web`, `golden`, `test:e2e` (Chromium + Mobile Safari),
  `test:a11y`, `infra` (Bicep build + `T-INFRA-*`/`T-INV-013`/`T-MIG-001`),
  `meta` (`T-META-001`) and `build`. **No job carries `continue-on-error`**;
  an advisory job in a one-reviewer project is a job nobody reads. Verified by
  parsing the workflow (exactly 12 jobs, zero `continue-on-error`), by a real
  run in which all twelve passed, and by confirming a deliberately failing test
  turns the gate red.
- **`TASK-002` — test harness.** `vitest.config.ts` defines the six Vitest
  projects (`unit`, `integration`, `web`, `golden`, `infra`, `meta`) using the
  test layout in `specs/testing.md` §11 verbatim and carries the §1 per-path
  coverage thresholds; `apps/web/vitest.config.ts` adds the jsdom + Testing
  Library component environment; `playwright.config.ts` adds the Chromium and
  Mobile Safari e2e projects. New scripts: `test:a11y`, `golden`, `test:infra`,
  `test:meta`, `coverage`, and `format:check` is now enforced in CI.
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

### Changed

- **Vite 5 → 7 and Vitest 2 → 3**, so that `npm audit --audit-level=high` (§8
  job 3) can pass honestly. The advisory chain rooted in `esbuild <= 0.24.2`
  and `vite <= 6.4.2`; the alternative was scoping the audit to `--omit=dev`,
  which would have switched the gate off rather than fixed the finding. Under
  Vitest 3 the project split moved from the deprecated `vitest.workspace.ts`
  into `test.projects` in `vitest.config.ts`.
- **`T-META-004` now accepts an optional lowercase suffix on a test id**
  (`T-SEC-009a`, `T-SEC-009b`) and treats suffixed variants as distinct. The
  specs already use the form (`T-AI-010b`), and without it a single acceptance
  criterion needing several cases would collide with itself — pushing authors
  toward one giant test per criterion, the opposite of "a failure names exactly
  one thing". `specs/testing.md` §11 documents the form.

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

- `--passWithNoTests` has been **removed from `test:unit` and `test:infra`** now
  that both have real tests — neither can pass vacuously. It remains on
  `test:int`, `test:web`, `golden` and `test:meta`, and `--pass-with-no-tests`
  on `test:e2e` / `test:a11y`, because those suites genuinely have no tests yet
  (they arrive with `TASK-017` and later).
  **Each flag must be dropped by the task that lands that suite's first test**,
  not inherited forward: a suite that passes with zero tests is the single
  easiest way for CI to be green while asserting nothing.
- `tools/check-deps.mjs` exempts exactly two paths from its own host scan —
  itself and `tests/infra/supplyChain.spec.ts` — because a checker cannot name
  what it forbids without matching itself. **Do not widen this to "test files"
  as a class**; that would hand a future beacon somewhere to hide.
- `packages/domain/test/placeholder.spec.ts` (`T-SCAFFOLD-001`) exists only to
  hold the §1 95% domain coverage floor armed while `src/index.ts` is still a
  placeholder. **Delete it when `types.ts` lands** — it is not an acceptance
  criterion and must never be mistaken for one. A threshold switched off
  "until there is code" is a threshold that never comes back on.
- Coverage excludes exactly two files — `apps/api/src/index.ts` and
  `apps/web/src/main.tsx`. Both are process entrypoints that only bootstrap and
  are covered by the e2e and smoke suites. **Never widen this to `src/**`.**
- The Vitest `golden` project excludes `**/goldenLive.spec.ts`. That exclusion
  is load-bearing, not tidiness — the live variant calls the real extraction
  providers and costs money (`specs/testing.md` §4A). The `golden` CI job is
  also given no provider credentials, so a mistake fails loudly rather than
  billing quietly.
- One **low**-severity dev-only advisory remains (`esbuild` dev server on
  Windows, reachable only via `vite dev`). It is below the §8 job 3
  `--audit-level=high` threshold and ships in nothing.
- **Branch protection is a repository setting, not a file.** The §8 requirement
  that all twelve jobs block merge, plus linear history, must be configured on
  `main` in GitHub; CI cannot assert it about itself. **⚠ It is currently NOT
  configured**: GitHub rejects branch protection and rulesets on a *private*
  repository outside a paid plan (`403 — Upgrade to GitHub Pro or make this
  repository public`). Until the owner either upgrades or makes the repository
  public, the twelve jobs run and report but **do not mechanically block a
  merge**. This is the one part of `TASK-003` that code cannot deliver.
