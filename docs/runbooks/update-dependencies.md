# Runbook — updating a dependency

**Applies to:** any change to `package.json` / `package-lock.json` in any
workspace, including every dependabot pull request.

---

## 1. The one step that is not obvious

After changing the version of a **production** dependency, regenerate the
third-party notices:

```powershell
npm run notices        # rewrites THIRD-PARTY-NOTICES.md
```

and commit the result **in the same commit as the lockfile change**.

`T-LICENSE-001` (the `audit` CI job, `tools/check-licences.mjs --check`)
compares `THIRD-PARTY-NOTICES.md` against the installed tree and fails with:

```
Licence check failed:
  - THIRD-PARTY-NOTICES.md is out of date. Run `npm run notices` and commit the result.
```

⚠ **The gate covers the PRODUCTION tree only, and the distinction is the whole
diagnostic value of this section.** `collectRuntimePackages()` filters
`!meta.dev` (`tools/check-licences.mjs:102`) because dev dependencies are never
distributed, so nothing about them belongs in a notices file. Therefore:

- a bump of a **production** dependency (`@azure/identity`, `openai`,
  `@prisma/client`, …) turns the audit job red until notices is re-run —
  **and dependabot cannot run the generator**, so that PR can never go green
  on its own. A security patch will sit unmerged behind a check that looks
  like a real failure.
- a bump of a **dev** dependency (`eslint`, `vite`, `vitest`, `globals`,
  `@testing-library/*`, …) does **not** touch notices at all. **If a dev-only
  bump is red, it is a real failure — go and read it.** Do not wave it through
  as "just the notices thing"; that assumption is how a genuinely breaking
  tooling upgrade gets merged.

Confirm which case you are in before assuming anything:

```powershell
$env:GH_CONFIG_DIR = "$HOME\.ghprofiles\gh-personal"
gh run view <run-id> --json jobs --jq '.jobs[]|select(.conclusion!="success")|.name+" :: "+(.steps[]|select(.conclusion=="failure")|.name)'
```

⚠ **Do not relax the gate to make the queue drain.** `THIRD-PARTY-NOTICES.md`
is the artefact that states what third-party code ships in this product; a
check that tolerated drift would let it quietly stop being true, and nothing
else in the repository would notice. The missing piece is the regeneration
step, not the check.

## 2. Draining the dependabot queue

The queue does not drain itself. Land the safe bumps together, in one commit,
with notices regenerated once (harmless for a dev-only batch, and correct the
moment one production package is in it):

```powershell
npm install --no-audit --no-fund <pkg>@<version> [...]   # add --save-dev for dev deps
npm run notices
```

Then close the superseded dependabot PRs by referencing them in the commit or
PR body — dependabot closes its own PR once the same version reaches `main`.

**Bumps that must NOT be batched this way:**

- **A major version of a runtime dependency.** `@prisma/adapter-mssql`
  6 → 7 changes the database adapter, and nothing in the unit or web suites
  touches a real database. It needs the integration project against
  `mcr.microsoft.com/mssql/server:2022-latest` (`specs/testing.md` §3.3a),
  on its own branch, where a failure names the bump that caused it. ⚠ **That
  investigation has been done and the answer was no** — see §5, and do not
  redo it from scratch.
- **A type package that pairs with a runtime package.** Bump `@types/mssql`
  with the adapter, never apart from it: types that disagree with the
  implementation are worse than types that lag it, because `tsc` will
  cheerfully prove the wrong thing.
- **A GitHub Action.** Actions are pinned to commit SHAs by `check:deps`, live
  only in `.github/workflows/**`, and need no notices regeneration — let
  dependabot merge those itself once rebased.

## 3. Gates to run before pushing a dependency change

```powershell
npm run typecheck
npm run lint
npm run check:licences     # T-LICENSE-001
npm run check:deps         # the runtime allow-list (NFR-004) + action SHA pinning
npx vitest run --project unit --project web --project meta --project infra
```

⚠ **`check:deps` is the gate that refuses a new runtime dependency**, not a
formality. Telemetry and analytics packages are forbidden outright (product
invariant 10) and adding one fails CI. Every genuinely new runtime dependency
must be justified against NFR-004 in the pull request; a version bump of an
already-allow-listed package needs no justification.

## 4. If a bump breaks something

Revert the single package rather than the whole batch:

```powershell
npm install --no-audit --no-fund <pkg>@<previous-version>
npm run notices
```

Then re-run the gates in §3. Do not pin a transitive dependency by hand in
`package-lock.json` — the next `npm install` will undo it silently.

## 5. Held bumps — investigated, and deliberately not taken

A bump that was tried and rejected is **more valuable written down than a bump
nobody looked at**, because the next person to see the red PR will otherwise
spend the same day rediscovering it. Every entry here names the evidence and
the condition that would change the answer.

### Prisma 7 (`prisma`, `@prisma/client`, `@prisma/adapter-mssql`) — HELD

Measured on a full v7 branch against a real
`mcr.microsoft.com/mssql/server:2022-latest`, not reasoned about:

- **The runtime is fine.** All 36 integration files / 550 tests pass on v7 —
  the batch-close and undo transactions, the filtered unique indexes, the
  `CHECK` constraints, the `Latin1_General_100_BIN2` collation. The
  load-bearing duplicate-refusal mapping still works: v7 surfaces the SQL
  Server `2627`/`2601` duplicate as Prisma `P2002`, and `isUniqueViolation()`
  catches it. **"It does not work" is not the objection.**
- ⚠ **The objection is the production dependency tree.** On v7,
  `@prisma/client` pulls `prisma` into the **production** tree, which pulls
  **`mysql2` and `pg`** — a MySQL driver and a PostgreSQL driver shipped in a
  SQL-Server-only application (NFR-004). One of them, **`seq-queue@0.0.5`** via
  `mysql2`, declares **no `license` field at all** (confirmed against the
  registry packument, not merely read off the gate's output), so
  `T-LICENSE-001d` goes red — correctly. An unlicensed package in the
  production tree of a **public** repository is a legal exposure, not a gate
  annoyance. ⚠ **Do not silence it with a notices exception.**
- The mechanical work is real but small, and already scouted: v7 rejects
  `url = env("DATABASE_URL")` in `prisma/schema.prisma` (`P1012`) and wants a
  root `prisma.config.ts`; `prisma migrate diff --from-schema-datasource`
  became `--from-config-datasource` in `ci.yml`; and the v7 CLI no longer
  auto-loads env vars, so the migrate steps must be given their environment
  explicitly. **No `PrismaClient` construction site needs rewriting** — this
  repo has passed a driver adapter since ADR-0005 Rev 3.
- ⚠ Worth knowing before anyone debugs it: on v7 a **`CHECK`-constraint
  violation is mislabelled** as `Foreign key constraint violated on the
  constraint: <ck_name>`. Harmless to the tests, which assert rejection, and
  actively misleading in a log.

There is no pressure to take it. v6 carries no advisory, and the audit
exception in `tools/check-audit.mjs` exists precisely because npm's suggested
"fix" for `GHSA-ggr8-5vv4-36mx` is a prisma **downgrade**.

**Unblocked by:** `mysql2`/`pg` leaving the v7 production tree, or Prisma making
them optional. That is what removes the licence regression; the schema and
config migration is then a day's work rather than a blocker.

**Enforced by** the `ignore` entries in `.github/dependabot.yml`, which now
cover all three `prisma`-group members plus `@types/mssql`. ⚠ The adapter was
originally **missing** from that list, which is the only reason a v7 adapter PR
could be raised while the other two were held: an ignore that covers two of a
group's three members holds nothing.
