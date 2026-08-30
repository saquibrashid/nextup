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

## 6. `package-lock.json` carries `sha1-` integrity — investigated, nothing to do

Most of the lockfile's `integrity` hashes are **`sha1-`**, not `sha512-`. This
was investigated and is **expected, not a defect**: there is no action for a
maintainer to take, and — importantly — **no action a maintainer _can_ take
from this machine.** Read this before "fixing" it.

**Why it looks the way it does.** The public npm registry is blocked by
Microsoft IT; npm is globally pointed at `https://packagefeedproxy.microsoft.io/npm/`,
whose tarballs resolve to `ms-feed-*.pkgs.visualstudio.com`. That Azure DevOps
Artifacts feed publishes only the **legacy `dist.shasum` (sha1)** for a
package — it returns **no `dist.integrity` (sha512)** — so npm records the sha1
it is given. The correlation is exact:

- **`sha1-` ⟺ the `ms-feed-*` proxy** — the whole population, ~525 entries, and
  it is **not** dev-only: it covers the entire production tree, including
  `@prisma/client`, `@prisma/adapter-mssql`, `mssql`, `express`, `sharp`, the
  `@azure/*` SDKs and `openai`.
- **`sha512-` ⟺ `registry.npmjs.org`** — the ~32 entries **dependabot** has
  touched. Dependabot runs on GitHub, reads the public registry, and writes the
  stronger hash plus a `registry.npmjs.org` URL; on this machine npm's
  `replace-registry-host` rewrites that host to the proxy for the actual
  download and verifies the identical tarball against the sha512.

**Does npm still verify a `sha1-` hash?** Yes — measured, not assumed, against
npm 11's own verifier (`ssri` 12): good data verifies as `sha1`, a single
flipped byte is **rejected**, and the install-path stream verifier passes sha1.
npm neither warns nor rejects it (it simply ranks sha512 higher when both are
present). `npm ci` and `npm install` share this path; integrity behaviour is
identical.

**Is the exposure real?** Low / theoretical here. sha1's broken property is
**collision** resistance, not **second-preimage** resistance — and the lockfile
pins the sha1 of the already-published legitimate tarball, so swapping in
malware needs a *second-preimage* (no practical attack on sha1) rather than a
collision. A collision only helps an attacker who controls the **original**
artifact **and** can serve the colliding variant through the feed — i.e. a
malicious publisher **plus** a compromise of the TLS-protected internal
Microsoft proxy. The control that is genuinely absent is registry
signature/provenance verification, and that is a proxy limitation independent of
the hash: `npm audit signatures` **cannot run here** — it fails with *"Fetching
verification keys using TUF failed … no dependencies … installed from a
supported registry."*

⚠ **Do not try to "upgrade" the hashes by regenerating the lockfile.** The only
source of sha512 is `registry.npmjs.org`, which is **IT-blocked**; do not add an
`.npmrc`/registry override to reach it. Worse, a wholesale
`rm package-lock.json && npm install` against the proxy would **downgrade the
~32 `sha512-` entries back to `sha1-`** — the opposite of the goal.

**The supported remediation is dependabot itself.** Each bump arrives
sha512/`registry.npmjs.org`, so the sha1 population shrinks on its own over
time; no manual step exists or is wanted.

**No CI gate.** A check that failed on any `sha1-` would fail today on ~525
entries with no available remedy — a broken gate, not a safety net. A ratchet
(fail if `sha1-` count rises / `sha512-` count falls) would at most catch an
accidental full-lockfile regeneration, but the count is not monotonic — a
legitimate bump can drop a transitive `sha512-` dependency — so it would raise
false positives, and the regeneration it guards against already shows up as an
enormous lockfile diff in review. The review expectation is the mitigation: a
dependency PR should **add or keep `sha512-`/`registry.npmjs.org`** entries;
one that **adds `sha1-`** entries or repoints `resolved` at `ms-feed-*`
(especially a full regen) is the red flag to inspect by hand.
