# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **`TASK-016` — `packages/domain/src/derive.ts`** (`T-INV-009`, `T-INV-010`,
  12 tests). `deriveTitleState` and `deriveSortDateAdded`: the only place
  `title.state` and `title.sortDateAdded` are computed.
  - **`deriveSortDateAdded` takes the EARLIEST date, not the latest**, and that
    is what makes adding an already-saved work on a *second* service leave the
    row where it is (US-020 AC-4) instead of jumping it to the top as though it
    were new — while removing the earliest listing legitimately recomputes it
    (AC-5). Dates are compared **as text**: `YYYY-MM-DD` sorts chronologically,
    and parsing to `Date` would let a local timezone move a listing across a day
    boundary and quietly reorder the list.
  - **`deriveTitleState([])` throws.** `[].every(...)` is `true`, so the natural
    implementation reports an impossible title (invariant I-3) as `removed`
    rather than failing — the safer of two wrong answers, but still wrong.
  - **Invariant I-4 is enforced in `titleSchema`, not only in the repository.**
    No fixture, backfill or hand-built response can put a title into circulation
    whose state or sort position disagrees with its own listings; that
    disagreement raises nothing, it just puts a row in the wrong place or shows
    a title as active when every listing is gone. *(The refinements guard
    `listings.length === 0` because Zod runs every refinement even after
    `min(1)` has failed, and the derivation throws on an empty array by design.)*
  - `T-INV-009` greps `packages/domain/src`, `apps/api/src` and `apps/web/src`
    for a second implementation. It carries **two self-checks**: one asserting
    the scan actually reaches source files (a broken path would make the greps
    pass over an empty set — green while asserting nothing) and one asserting
    the patterns *do* fire on a verbatim copy of the spec's reference
    implementation.

- **`TASK-013` — `packages/domain/src/ids.ts`.** ULID generation, the
  deterministic variant, and a monotonic factory for tests (`T-DM-004`, 11
  tests). Hand-rolled rather than taking the `ulid` package: the variant this
  project actually depends on (`deterministicId`) is not something that package
  offers, so we would own half the scheme anyway — and owning half an id scheme
  is worse than owning all of it. Crockford base32 is a lookup table; the part
  that *is* a cryptographic primitive is delegated to `@noble/hashes`.
  - **`deterministicId` derives its timestamp segment from the hash, not the
    clock.** A clock-derived prefix would make the id depend on *when* a retry
    ran, which is exactly the variable that must not matter — `REQ-005`/`REQ-006`
    resumability turns on a retry after a crash mid-apply **overwriting** the
    rows the first attempt wrote rather than inserting a second set. Random ids
    would duplicate silently, and only under conditions that are hardest to
    reproduce. `T-DM-004g` pins this.
  - An empty seed **throws**. Hashing `''` would hand every caller with a
    missing id the *same* id — a duplicate-overwrite that presents as data loss.

- **`TASK-015` — `normaliseTitleText` and the two `workIdentity` builders**
  (`T-DM-001`, the table test `specs/data-model.md` §2.2 makes mandatory, plus
  `T-DM-002`). They live in the same file as `WORK_IDENTITY_RE` deliberately:
  §2.2 requires exactly **one** normalisation implementation, and splitting it
  across files is how a second one appears.
  - **No year enters the hash (SD-05).** A year is present on some captures of a
    tile and absent on others, so folding it in splits one work into two
    identities on the exact axis the scheme exists to hold together — and does
    it **invisibly**, as a silently bypassed suppression. `extractedYear` stays
    on the candidate as a TMDB match hint only.
  - `T-DM-002g` **pins the digest of `'Dune'`**, independently verified against
    Node's own `crypto.createHash('sha256')`. If the hash, the slice or the
    normaliser ever changes, every stored `unmatched:*` identity and every
    suppression keyed on one is orphaned. That must be a deliberate, migrated
    decision — so it has to break a test first.

- **`TASK-014` — `apps/api/src/config.ts`: two constants, permanently two**
  (`T-INV-008`). `IMAGE_RETENTION_DAYS = 30` (NFR-019) and
  `TMDB_METADATA_MAX_AGE_DAYS = 183` (NFR-014) are numerically similar and
  semantically unrelated: one is a privacy commitment stated to the owner in
  `/about`, the other an invisible cache-freshness threshold. Unified, a future
  change to a caching policy silently rewrites a stated retention promise — a
  diff that reads as housekeeping. The test asserts two separate literal
  declarations, neither derived from the other, and **no shared call site**.
  - It also asserts there is **no third** day-constant and no
    `LIST_STALENESS_DAYS`. The list-staleness nudge was retired outright at
    `A46`; re-introducing the constant would smuggle back a feature the owner
    explicitly dropped. What survives is the factual per-service last-updated
    date (`REQ-039`) — show the fact, never nag about it.

- **`@noble/hashes`** is the second (and, for the domain, last expected) runtime
  dependency: audited, zero transitive dependencies, and **isomorphic**. That
  last property is the requirement, not a bonus — `packages/domain` is imported
  by the SPA as well as the API, so `node:crypto` would break the browser
  bundle, and `crypto.subtle` is async where these functions must be sync.

### Fixed

- **`T-META-004` rejected every table test.** `it.each(table)(title, fn)` is two
  calls: the rule matched the inner `it.each(table)` — reporting its data array
  as a "dynamic title" — and did not match the outer call, which is the one that
  actually declares the test and carries the title. So a correctly-named table
  test failed lint while its title went unchecked. `specs/data-model.md` §2.2
  makes a table test **mandatory** for `T-DM-001`, so the rule was pushing
  authors off the spec. Both halves are now handled, with four cases added to
  the rule's own suite — including two `invalid` ones, so exempting the *table*
  call cannot quietly exempt the *test*.

- **`TASK-012` — shared domain types (`packages/domain/src/**`).** The six
  document types from `specs/data-model.md` §3 as pure TypeScript interfaces
  (`types.ts`), the enums as `as const` tuples (`enums.ts`), and Zod mirrors
  (`schemas.ts`) tied to the interfaces with `satisfies z.ZodType<T>` so a
  drifting schema is a **compile** error, not a runtime surprise. `zod@^4` is
  the one new runtime dependency (`NFR-004`: mainstream, no transitive deps).
  - **`TitleState` is `'active' | 'removed'` — there is deliberately no
    `'suppressed'`.** Suppression is a separate `Suppression` document keyed on
    `workIdentity` (`REQ-071`). A title-scoped flag would appear to work and
    then silently stop the first time a title reappears, because a reappearance
    is a **brand-new row** (`L1`/`A33`). `T-DM-021a/b` assert both halves.
  - **`ingestSource` is `'paste' | 'upload' | 'drop'` — all three** (ADR-0009).
    Paste was *added* to file selection, not swapped in; `T-DM-025a/b` round-trip
    each and reject a fourth so the set cannot be quietly trimmed.
  - `uploadedFormat` admits `heic`/`heif` but the stored `format` does **not**:
    HEIC is transcoded to lossless PNG on ingest (`REQ-077`, ADR-0008), so a
    persisted `format: 'heic'` means the transcode was skipped. `T-DM-025d`
    fails if the schema stops distinguishing them.
  - Every schema is `.strict()`: an unknown key is an **error**, not stripped.
    Stripping hides a producer/consumer mismatch until it matters (`T-DM-020c`).
  - `packages/domain/test/placeholder.spec.ts` and its `PLACEHOLDER` export were
    deleted, exactly as the note below required, now that real types have landed.
    Domain coverage is **100/100**, above the 95/90 floor.

- **`TASK-009` — offline getting-started.** `docker-compose.test.yml` (SQL
  Server 2022 + Azurite, mirroring the CI service containers exactly, so a
  failure reproduces locally instead of only on a runner) and
  `docs/getting-started.md`. After a one-time `npm ci` and image pull,
  `npm run test:unit && npm run test:int` runs with **no network** — `NFR-003`
  makes CI the implementer's only feedback loop, so the loop must not depend on
  a network that might be down.
  - The compose health check carries the same two traps CI does, documented in
    place: `sqlcmd` is at `/opt/mssql-tools18/bin/` (not `/opt/mssql-tools/`)
    and needs `-C`. Without the wait, `prisma migrate deploy` fails
    intermittently — the flaky gate `NFR-003` cannot tolerate.
  - **§6 states that HTTPS is a _functional_ dependency, not merely a transport
    control** (`A45`, ADR-0009 §Compliance). `navigator.clipboard` is absent on
    `http://`, so opening the dev server from a phone at
    `http://<LAN-IP>:5173` shows **no "Paste screenshot" button at all** — a
    failure that looks like a missing feature rather than a missing
    certificate. Names the two supported ways to exercise paste (staging over
    HTTPS, or a trusted HTTPS tunnel) and the desktop-listener exception.
  - README: corrected the CI badge URL, refreshed the stale "Next up:
    TASK-001" status, and added the offline test loop and the HTTPS warning.

- **`TASK-144` — `T-MIG-001`, the destructive-migration gate.**
  `tools/check-migrations.ts` scans `prisma/migrations/**` for `DROP TABLE`,
  `ALTER TABLE ... DROP COLUMN`, `TRUNCATE TABLE`, `DROP INDEX`,
  `DROP CONSTRAINT` and an `sp_rename` column rename (`specs/testing.md`
  §11-R4.2 — there is no `DROP TYPE` in SQL Server). `REQ-028` says data is
  never lost, and a migration is the one place it is lost quietly: Prisma
  generates `DROP COLUMN` from a field rename, a diff that reads like a rename
  and behaves like a deletion.
  - **There is no escape hatch, deliberately.** A genuinely necessary
    destructive migration is an owner decision made in the open, so removing
    the gate has to be a visible diff.
  - The twelve `T-MIG-001a`–`l` cases **feed the checker deliberate
    violations** rather than only observing a clean tree. Before `TASK-017`
    there are no migrations at all, so a gate that did nothing would pass just
    as loudly. Verified additionally by dropping a real
    `ALTER TABLE ... DROP COLUMN` migration on disk and watching CI's infra
    job go red.
  - SQL comments are blanked rather than removed, so a destructive statement
    quoted in a comment does not fail the build while reported line numbers
    still point at the real statement.

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
- ~~`packages/domain/test/placeholder.spec.ts` (`T-SCAFFOLD-001`) exists only to
  hold the §1 95% domain coverage floor armed while `src/index.ts` is still a
  placeholder. **Delete it when `types.ts` lands**~~ — **done in TASK-012**;
  the file and `PLACEHOLDER` are gone, and `packages/domain/test/schemas.spec.ts`
  now holds the floor with real assertions (domain coverage is 100/100).
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
