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

### Vitest 5 (`vitest`, `@vitest/coverage-v8`) — the runtime half is DONE

`vitest@5` peer-requires `@types/node@^22.0.0 || >=24.0.0`. The install fails
`ERESOLVE` before a single test runs, which is why **all twelve CI jobs go red
at once** rather than one suite failing — read that signature as "the tree did
not install", not "the test suite broke".

The Node major is pinned in four coupled places, and they move together or not
at all:

| Where | Value |
| --- | --- |
| `.nvmrc` | `22` — every CI job reads it via `node-version-file` |
| `package.json` | `"engines": { "node": ">=22 <23" }` |
| `Dockerfile` | `ARG NODE_IMAGE=node:22-alpine@sha256:c610fcdf…` (digest-pinned deliberately) |
| `package.json` | `@types/node@^20.14.10` — **still on 20, deliberately** |

⚠ **Bumping `@types/node` alone is worse than leaving this held**, not a
partial step towards it: type definitions ahead of the runtime describe APIs
the deployed container does not have, so the failure moves out of `tsc` and
into production. Types *behind* the runtime is the safe direction, which is why
the first three rows moved without the fourth.

**The runtime moved to Node 22 in three steps, and step 2 is the one still
outstanding:**

1. **Done** — the runtime pins (`.nvmrc`, `engines`, the `Dockerfile` digest)
   moved to 22 in a single commit that changed **no lockfile**. That is what
   made it verifiable while the proxy lag in §7 blocks a local `npm ci`.
2. **Done** — the production deploy on Node 22 succeeded (the staging smoke
   suite and the new revision's own smoke run both passed before traffic
   shifted), which was the recorded exit criterion, so the holds in
   `.github/dependabot.yml` were released: `jsdom` and
   `@testing-library/jest-dom` outright, and `@types/node` **capped at
   `>=23`** rather than deleted. ⚠ **Deleting that entry would have been
   wrong** — an uncapped `@types/node` floats to the newest major, which is
   ahead of the runtime and is the exact failure the hold existed to prevent.
   Capping by *version* instead of by *update-type* lets the 20 → 22 bump
   through while still refusing 23+, and `T-INFRA-018d` fails CI if the cap is
   ever circumvented. ⚠ Let **Dependabot** regenerate the lockfile, not a local
   `npm install`: its runner resolves against `registry.npmjs.org` and writes
   `sha512-` integrity, and a local install here would write internal-proxy
   URLs into a public repo (§6).
3. **Then** rebase the held `vitest@5` PR, which installs cleanly once
   `@types/node` is on 22.

⚠ `deploy` runs on **every push to `main`**, so each of these merges ships an
image. Step 1 shipped a new base image — the verification for it is the
held-revision smoke suite (`T-CI-009o`–`q`) on the deploy run, not CI.

~~Superseded (runtime now on 22): "Node **20** is pinned in four coupled
places… **Unblocked by** a deliberate Node 20 → 22 upgrade, which is worth
doing on its own merits — **Node 20 reached end of life on 2026-04-30** and
receives no further security patches."~~

### jsdom 30 (`jsdom`) — HELD, and **not** for the reason the red PR suggests

PR #405 (`jsdom` 25.0.1 → 30.1.2) was investigated twice and held both times.
⚠ **The two failures look identical from the PR page — both are "jobs 4 and 6
are red" — and they are completely unrelated.** Do not assume the second is a
recurrence of the first.

**Round 1 — `TypeError: Cannot read properties of undefined (reading '_bytes')`
— FIXED, not held.** jsdom 30.1 moved `Blob` internals behind private fields
while vitest's jsdom-compat shim still read `_bytes`. 10 tests failed, every
one of them on an ingest path (`pasteCapture`, `imageDropzone`, `guidedUpload`,
`uploadCheckpoint`, `captureIntake`), because **every ingest affordance renders
a preview** — so the cluster is a symptom of product invariant 16, not a hint
that ingest is broken. The innermost nextup frame was
`components/ScreenshotPreview.tsx` calling `URL.createObjectURL`, which is
**correct as written**. The real fix was upstream and one patch away:
`vitest@5.0.3`, "Support Blob on jsdom 30.1" (vitest-dev/vitest#11379), taken
in #420. ⚠ The obvious-looking local fixes were both wrong and were rejected:
mocking `URL.createObjectURL` in the web setup would have blinded every ingest
preview assertion while turning the suite green, and pinning jsdom to 30.0.x
would have traded an ordering problem for a permanent pin with no exit
criterion.

**Round 2 — accessible-name whitespace — THIS is the hold.** With vitest 5.0.3
in place the `_bytes` failures vanished and a different, smaller set appeared:
5 tests, one root cause.

```
Expected element to have accessible name:
  Filters 4 active
Received:
  Filters4 active
```

jsdom **>= 28** drops the separator space between a text node and an adjacent
inline element when an accessible name is computed, so
`All<span class="sr-only"> statuses</span>` (`FilterBar.tsx`, three sites) is
named `Allstatuses`. accname 1.2 step 2I says to append with a space, and
Chrome, Firefox and Safari all do.

⚠ **The markup is correct, and the same CI run proves it.** On the identical
commit that failed `4 · test:unit + coverage` and `6 · test:web`
(`T-PHONE-005a`, `T-PHONE-005b`, `T-UX-145c`, `T-TOOLBAR-002b`,
`T-AVREV-009a`), **`9 · test:a11y` passed** — that suite is Playwright driving
real browsers. A split of that exact shape — jsdom red, real browsers green, on
one commit — is evidence that **the test engine is wrong**, and reshaping
`FilterBar.tsx` to satisfy it would make the real-browser accessible name worse
in order to make a non-conformant simulation agree.

**No dependency bump clears this**, which is the part most likely to be
rediscovered the hard way: the space logic lives in `dom-accessibility-api`,
not in jsdom. Its latest release (0.7.1, 2025-11-27) is a trusted-publishing
change containing no fix, and `@testing-library/dom@10.4.1` pins
`dom-accessibility-api@^0.5.9`, so 0.7.x is not even reachable from this tree.
Bumping testing-library will not help.

Upstream `jsdom/jsdom#4091` is closed `not_planned`, **but on process grounds**
— "this issue uses a third-party library (`@testing-library/dom`), which we
cannot provide support for… please consider opening a new issue… with no
third-party libraries involved" — **not on the merits**. The behaviour is
unadjudicated, not rejected, so a clean no-third-party repro is a live path to
reopening it.

The ignore in `.github/dependabot.yml` is capped at `versions: ['>=28']`
rather than by update-type, the same way `@types/node` is: 26 is known good
(the upstream report reproduces clean on 26.1.0), so the cap stays as small as
the evidence supports.

**UNBLOCKED BY:** jsdom restoring accname 1.2 step 2I space separation, or
`dom-accessibility-api` no longer depending on the old `display` default *and*
`@testing-library/dom` widening its pin far enough to take that release. To
re-test, raise the cap, let Dependabot rebase the bump, and watch those five
named tests specifically.


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
it is given. The correlation **was** exact, and §6a has since broken it — read
this as the origin story, and §6a for what the lockfile looks like now:

- **`sha1-` ⟺ the `ms-feed-*` proxy** — the whole population, ~525 entries, and
  it is **not** dev-only: it covers the entire production tree, including
  `@prisma/client`, `@prisma/adapter-mssql`, `mssql`, `express`, `sharp`, the
  `@azure/*` SDKs and `openai`.
- **`sha512-` ⟺ `registry.npmjs.org`** — the ~32 entries **dependabot** has
  touched. Dependabot runs on GitHub, reads the public registry, and writes the
  stronger hash plus a `registry.npmjs.org` URL; on this machine npm's
  `replace-registry-host` rewrites that host to the proxy for the actual
  download and verifies the identical tarball against the sha512.

⚠ **Do not use the first bullet as a test for anything today.** The 442
`ms-feed-*` URLs were rewritten to `registry.npmjs.org` (§6a) without touching
their hashes, so `sha1-` and a public `resolved` URL now coexist on the same
entry. **A `sha1-` hash no longer implies a proxy URL**, and an audit that
assumes it does will mis-report a healthy lockfile.

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

### 6a. ⚠ A `resolved` URL pointing at `ms-feed-*` LOCKS DEPENDABOT OUT

⚠ **This is a different defect from the `sha1-` hashes above, it is NOT
cosmetic, and it does not heal on its own — it actively stops the remediation
in the previous paragraph from working.**

The `integrity` hash and the `resolved` URL fail in different ways. A `sha1-`
hash still verifies (measured above). A `resolved` URL naming
`ms-feed-N.pkgs.visualstudio.com` is a **private registry** as far as
dependabot is concerned, and dependabot has no credential for it, so it gives
up on the whole update:

```
Dependabot can't authenticate to a private package registry.
Because of this, Dependabot cannot update this pull request.
```

⚠ **CI going green proves nothing about this.** The `1es-public` feed is
anonymously readable, so GitHub runners install from it perfectly happily. The
only visible symptom is dependabot PRs that will not rebase or recreate, and
`Dependabot Updates` workflow runs that end in `failure` — never a red check
on the PR itself. Read a dependabot PR that refuses to rebase as *this*, not as
a merge-conflict problem.

**How it gets in.** A local `npm install` on a Microsoft-managed machine
resolves through the proxy and rewrites `resolved` for every package it
touches. Committing that lockfile publishes internal feed URLs to a public
repository **and** disables dependabot for every affected package. This
happened once already and was found only after four bumps silently stopped
updating.

**The repair — mechanical, and the one lockfile edit that is allowed here.**
Rewrite the host prefix only. No `npm install`, no version change, and
crucially **no `integrity` change**: it is the same tarball at its public
address, so the recorded hash stays valid.

```powershell
$p   = 'package-lock.json'
$raw = [System.IO.File]::ReadAllText($p)
$new = [regex]::Replace(
  $raw,
  'https://ms-feed-[0-9]+\.pkgs\.visualstudio\.com/1es-public/_packaging/npm-public/npm/registry/',
  'https://registry.npmjs.org/')
[System.IO.File]::WriteAllText($p, $new)
node -e "require('./package-lock.json'); console.log('parsed OK')"
```

Verify before pushing — **every changed line must be a `resolved` line**, and
the two integrity populations must be untouched:

```powershell
git diff -U0 -- package-lock.json |
  Select-String '^[+-][^+-]' | ? { $_.Line -notmatch '^\s*[+-]\s*"resolved":' }
# must print nothing
```

⚠ **This does NOT fix the `sha1-` hashes and must not be expected to** — only a
real install against the public registry can, which is what §6 explains is
impossible from here. The two problems share a cause and have different
remedies.

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

## 7. `npm ci` fails with a 404 for a version that certainly exists

**Symptom.** A clean install of `main` dies on one package:

```
npm error 404 Not Found - GET https://packagefeedproxy.microsoft.io/npm/@typescript-eslint/visitor-keys/-/visitor-keys-8.70.0.tgz
npm error 404  Cannot find the file visitor-keys-8.70.0.tgz in package '@typescript-eslint/visitor-keys 8.70.0' in feed 'npm-public'
```

**This is not a misconfiguration, and there is no npm setting that fixes it.**
npm is already pointed at the proxy (`registry` =
`https://packagefeedproxy.microsoft.io/npm/`, `replace-registry-host=npmjs`),
which is exactly what IT prescribes — §6 explains why. The cause is that the
proxy **lags upstream**: dependabot resolves against the public registry on a
GitHub runner and commits a lockfile naming a version published minutes
earlier, and the internal feed has not mirrored it yet.

Confirm it is a sync gap rather than a bad lockfile entry — the proxy's own
packument is the evidence:

```powershell
npm view "@typescript-eslint/visitor-keys" versions --prefer-online --json | Select-Object -Last 4
# ..., "8.69.0", "8.69.1-alpha.0"   <- 8.70.0 is simply absent
```

⚠ **The feed does not fetch on demand.** A direct `GET` of the version
document, `npm view <pkg>@<version>`, and `npm pack <pkg>@<version>` were all
tried and all 404 — none of them warms the cache. **Waiting is the fix.**

⚠ **`npm install` is NOT a workaround.** It re-resolves, but the root
`package.json` pins the same family (`@typescript-eslint/eslint-plugin@^8.70.0`),
so resolution fails again — this time as `notarget`.

**What must NOT be done:**

- **Do not add an `overrides` entry** pinning the transitive package back to a
  version the proxy happens to hold. It would be committed, it would apply to
  CI and to production builds, and it pins a linting toolchain backwards for
  everyone to work around one machine's cache.
- **Do not commit a regenerated lockfile** produced to get past it — see §6:
  a proxy-side regeneration downgrades `sha512-` entries to `sha1-`.
- **Do not point npm at `registry.npmjs.org`.** It is IT-blocked and
  unreachable; the TLS handshake fails.

**CI is unaffected.** GitHub-hosted runners install from the public registry,
so a PR blocked locally still goes green — verify there rather than locally.

**To keep working meanwhile**, install from the manifests as they were *before*
the bump that introduced the unmirrored version, then put the current ones
back. `node_modules` ends up a few dev-dependency versions behind `main`, which
is adequate for running the suites:

```powershell
$before = "<sha of the commit before the offending bump>"
git checkout $before -- package.json package-lock.json apps/api/package.json apps/web/package.json packages/domain/package.json
npm ci --no-audit --no-fund
git checkout HEAD -- package.json package-lock.json apps/api/package.json apps/web/package.json packages/domain/package.json
npx prisma generate     # npm ci wipes the generated client; without this
                        # `npm run typecheck` reports TS7006 on Prisma.DMMF
```

⚠ `git status` **must be clean afterwards.** The whole point of the second
`checkout` is that the older manifests never reach a commit.

