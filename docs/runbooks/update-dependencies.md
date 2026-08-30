# Runbook — updating a dependency

**Applies to:** any change to `package.json` / `package-lock.json` in any
workspace, including every dependabot pull request.

---

## 1. The one step that is not obvious

After **any** version change, regenerate the third-party notices:

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

⚠ **This is why every dependabot pull request is red.** Dependabot bumps the
version, but it cannot run the generator, so the audit job fails on *every*
bump — including a security patch. **A red dependabot check is almost always
this, not a real failure.** Confirm before assuming the bump is at fault:

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
with notices regenerated once:

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
  on its own branch, where a failure names the bump that caused it.
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
