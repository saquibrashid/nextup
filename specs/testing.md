---
createdAt: 2026-08-10T20:12:02-04:00
createdBy: spec-writer
revisedAt: 2026-08-10T21:07:17-04:00
revisedBy: solution-architect
revision: 2
phase: 8
status: complete
elevated: true
sourceOfTruth: artifacts/PRD.md (all 39 stories, 241 acceptance criteria)
---

# specs/testing.md — nextup

> ### ⚠ REVISION 7 (2026-08-11) — `A45`: clipboard paste is the primary ingest path
>
> Owner correction, verbatim: *"for screenshots, I'm generally expecting that
> I will take a screen grab and paste it into the app directly rather than
> saving it to my device first and then uploading it to the app."*
> **⚠ ADD, NOT SWAP — file upload stays fully supported**, and
> **`T-PASTE-010` exists solely to fail if it is quietly displaced.**
>
> | Test | Asserts |
> |---|---|
> | **`T-PASTE-001`** | The desktop `paste` listener attaches images — and stays out of the way of text pastes into inputs, and unmounts |
> | **`T-PASTE-002`** | The iOS button calls `clipboard.read()` **inside** the click handler; a pre-batch paste is held, not dropped |
> | **AC-14** | **`T-PASTE-003`** | **Successive pastes APPEND to the ONE open batch** — the existing multi-image model, no second batch |
> | **AC-14** | **`T-PASTE-004`** | Drag-and-drop as the third affordance |
> | **AC-13** | **`T-PASTE-005`** | The pasted-image naming/identity rule, and `ingestSource` provenance |
> | **AC-17** | **`T-PASTE-006`** | Magic-byte sniffing still rules on pasted bytes — `Blob.type` is never trusted |
> | **AC-17** | **`T-PASTE-007`** | Ceilings, the pre-decode pixel guard and 30-day retention apply identically to pasted images |
> | **AC-15** | **`T-PASTE-008`** | Every clipboard failure renders **and re-offers** — **no surviving spinner** |
> | **AC-16** | **`T-PASTE-009`** | No clipboard API (non-HTTPS / old browser) → the button is **not rendered**; upload unaffected |
> | **AC-16** | **`T-PASTE-010`** | **The add-not-swap regression guard** — the file-upload journey, incl. HEIC, still passes |
> | **AC-17** | **`T-IMG-023`** | The HEIC transcode is **conditional on the sniffed format** and **still present** for uploads |
> | **AC-14** | **`T-UI-014`** | All three affordances present, labelled and keyboard-reachable |
> | **AC-17** | **`T-SEC-033`** | The **upload** path's EXIF strip is not weakened by the paste path's free stripping |
> | **AC-17** | **`T-RET-014`** | NFR-019's 30 days applies identically to a pasted image |
>
> **§10 gains the iOS-Safari-paste row**: the native callout cannot be
> automated, so it is named explicitly with a compensating manual device
> check, following that section's existing convention.
>
> ⚠ **The AC count is NOT changed in this pass** — the PRD is being revised
> for `A45` in parallel and is not visible here. See §10's opening note.

> **This is the most important spec in the set (NFR-003).** The implementer is
> GitHub Copilot in autopilot mode (ASM-028/029). **Tests are its only feedback
> signal** — it cannot ask a question, and the owner's review capacity
> (RSK-017) is the project's binding constraint. A behaviour without a test is
> a behaviour the agent cannot know it has broken.

> ### ⚠ REVISION 2 (2026-08-10T21:07) — the extractor's determinism story changed
>
> ADR-0001 Revision 2 replaced the single OCR extractor with a **hybrid**:
> a sampled multimodal model (`gpt-4.1`) as the primary reader, plus
> Azure AI Vision `Read` OCR as a mandatory deterministic cross-check.
> **The primary reader's output is not reproducible.**
>
> **What did NOT change — and must not be weakened:**
> - **CI is still 100 % offline, free and byte-deterministic on every PR.**
> - The pipeline determinism gate is still **exactly 1.0, non-negotiable**
>   (`T-STUB-001`). It now covers `crossCheck()` as well (`T-AI-034`).
> - No test ever calls a live model in CI.
>
> **What DID change:** stage-1 *quality* measurement moved out of CI into a
> **manual, band-asserted live suite** (§4A). The full specification is
> `specs/ai.md` §9.
>
> **The rule:** *never assert exact string equality, exact ordering or exact
> counts against a live model response.* Determinism is asserted against
> **recordings**; quality is asserted as **bands over 3 runs**.

**Every one of the PRD's 241 acceptance criteria is mapped in §9.** *(Lineage: A42 added US-004 AC-7 HEIC-accepted-and-transcoded and AC-8 EXIF-stripped; A43 added AC-9/AC-10/AC-11. The headline figure was mis-stated as 230 then 232 along the way — see the reconciliation note below for the binding count and its arithmetic.)* The
**11 that are not fully machine-verifiable are named explicitly in §10**,
with the compensating check for each. Nothing is quietly skipped.

> ### ✅ AC COUNT RECONCILED BY THE ORCHESTRATOR — the number is **241** (R8/`A46`)
>
> This figure has now drifted **five** times (finding `F-003`; the `A42` pass;
> `A43`, where this file said `232` and `specs.md` said `230` and both were
> wrong; `A45`; and `A46`). It is re-counted **mechanically** against
> `artifacts/PRD.md` at every pass rather than incremented by hand, and the
> convention below is binding so the next reader can **re-derive** it instead
> of trusting it:
>
> **An acceptance criterion counts if it is a live table row in `PRD.md`
> matching `^| AC-<n>` within a `US-<nnn>` story. A row that explicitly
> *replaces* another (`AC-6′ (replaces AC-6)`, US-021) counts **once**, not
> twice. Struck-through rows do not count.**
>
> **R8 arithmetic:** **242** R7 rows − **1** deleted `US-022 AC-2` (the
> `LIST_STALENESS_DAYS` nudge, dropped entirely at `A46` — no staleness
> threshold, no nag, no derived "stale" state; `REQ-040`/`ASM-038` retired)
> = **241**. US-022 now runs AC-1, AC-3, AC-4, AC-5 — the numbering
> deliberately skips AC-2; that is not an error to "fix".
>
> *(R7 arithmetic, retained so the lineage is auditable: **243** raw `AC-`
> rows − **1** superseded `AC-6` displaced by `AC-6′` = **242**. Cross-check
> against the reconciled R6 baseline: **236 + 6** (US-004 `AC-12`…`AC-17`,
> the `A45` paste affordances) = **242**. Both methods agreed.)*
>
> *(R6 arithmetic, retained so the lineage is auditable: 237 raw − 1 = **236**
> = 39 stories × AC-1..AC-4 (156) + AC-5 ×37 + AC-6 ×27 incl. `AC-6′` + AC-7 ×10
> + AC-8 ×3 + US-004's `AC-9`/`AC-10`/`AC-11`.)*
>
> `T-META-001` — which fails CI on any AC with no mapped test — remains the
> real safety net, and the reason a stale headline number is embarrassing
> rather than dangerous. **Do not "fix" this number by editing one
> occurrence:** it appears in the front-matter `sourceOfTruth`, §2, §10's
> closing sentence, and §12.

> ### R6 (orchestrator) — the `A43` tests are mapped to the RIGHT acceptance criteria
>
> R5 filed its seven new tests under US-004 **AC-6/AC-7**, because the ACs they
> actually belong to did not exist yet when it ran. They do now. Re-pointed in
> §9, in place: **`AC-9`** ← `T-IMG-017`, `T-IMG-022` (pre-decode pixel guard);
> **`AC-10`** ← `T-IMG-018`, `T-IMG-019` (per-image isolation, incl. the
> catchable-`RangeError` path); **`AC-11`** ← `T-IMG-020`, `T-IMG-021`,
> `T-UI-013` (diagnostic error, decode sentinel, verbatim client render).
> `T-IMG-015` (corrupt HEIC) and `T-IMG-016` (header bounds) stay under `AC-7`,
> which is still where they belong.

> ### ⚠ REVISION 5 (2026-08-11) — `A43`/`OQ-028`: memory containment is now testable, mandatory core
>
> The owner answered `OQ-028` verbatim — **"Start at 0.5 GiB, up-size only if
> it OOMs."** Compute **stays 0.25 vCPU / 0.5 GiB**; the 1.0 GiB up-size is a
> **pre-authorised reactive remedy** (`runbooks/scale-up-memory.md`).
> `RSK-016` becomes an **owner-accepted residual risk**, and acceptance is
> **conditional on mitigations that are therefore acceptance criteria.**
> **These tests are what make the reactive strategy survivable — they are not
> optional and they ship first.**
>
> | Test | Asserts | Mandate |
> |---|---|---|
> | **`T-IMG-017`** | The pre-decode pixel guard rejects an oversized image **without the decoder ever being constructed** | `A43-M1` |
> | **`T-IMG-018`** | One bad image in a batch of four → batch completes, that file only reported, **no partial commit** | `A43-M2` |
> | **`T-IMG-019`** | The **catchable** `RangeError`/WASM-abort OOM path — one image fails, loop continues, no restart | ADR-0008 R2.4 |
> | **`T-IMG-020`** | The surfaced error **names memory and the runbook** — and `IMAGE_DECODE_FAILED` **does not** | `A43-M3` |
> | **`T-IMG-021`** | `image.decode.begin` / `image.decode.end` sentinel events, exact shape, paired by `imageId` | `A43-M5` |
> | **`T-IMG-022`** | `NEXTUP_MAX_DECODE_PIXELS` defaults to `25000000` and is honoured from config at request time | `A43-M1` |
> | **`T-UI-013`** | The client renders the diagnostic message **verbatim** and offers the remedy only for the memory codes | `A43-M3` |
> | **`T-INFRA-005`** *(extended)* | The **pair** `0.25 vCPU / 0.5 GiB` **and** `NEXTUP_MAX_DECODE_PIXELS=25000000` — they may never drift apart | ADR-0003 R4 |
>
> Corrected **in place** (superseded text struck through, never left live):
> `T-IMG-015` (now `IMAGE_DECODE_FAILED`, not `UNSUPPORTED_IMAGE_FORMAT`) and
> `T-IMG-016` (now a **pre-decode, header-read** bounds check).

> ### ⚠ REVISION 4 — the store is now Azure SQL Database (not PostgreSQL)
>
> The owner selected **Variant A** at `A40`: ADR-0005 Rev 3 replaced
> PostgreSQL B1ms with **Azure SQL Database Basic**. Every reference below
> to `postgres:16-alpine`, `pg_cron`, Postgres error `23505`, or the R3
> SKU pins is superseded as follows — the **domain tests are unchanged**;
> only the store fixture, error codes, container and SKU pins move:
>
> | Was (R3) | Now (R4) | Where |
> |---|---|---|
> | CI store `postgres:16-alpine` | **`mcr.microsoft.com/mssql/server:2022-latest`** service container (§3.3a) | §1, §2, §3.3, §5 |
> | Unique-violation `23505` | **Azure SQL `2601`/`2627`** | `T-INV-001/002`, `T-SEC-007` |
> | `T-MIG-001` greps `DROP TABLE/COLUMN/TRUNCATE/DROP TYPE` | **`DROP TABLE`, `ALTER TABLE ... DROP COLUMN`, `TRUNCATE TABLE`, `DROP INDEX`** (no `DROP TYPE` in SQL Server) | `T-MIG-001` |
> | `T-INV-013` "no `pg_cron`" | **"no Azure SQL Agent job, no Elastic Job"** + the rest | `T-INV-013` |
> | `T-INFRA-005` pins PG B1ms, ACR Basic, 0.5/1.0 | **pins Azure SQL Basic, ghcr.io, 0.25/0.5** | `T-INFRA-005` |
> | authoritative schema `data-model.md` §15 | **§16** (§15 retained) | throughout |
>
> `RSK-031` (Prisma + SQL Server is a less-travelled path) is why the CI
> container and the `M0` smoke migration below are **load-bearing**, not a
> formality. The mssql container is heavier than `postgres:16-alpine`; §3.3a
> specifies the exact config that makes it reliable in GitHub Actions.


---

## 1. The pyramid, and why this one

| Level | Count (target) | Runtime | What it owns |
|---|---|---|---|
| **Unit** (`vitest`) | ~55 % | < 10 s | Pure domain logic: normalisation, identity, derivation, reconciliation, scoring, cleanup heuristics, provenance shape, the undo predicate |
| **Integration** (`vitest` + **mssql/server:2022** *(R4 — was postgres:16-alpine in R3, Cosmos Emulator in R1)* + Azurite + stub extractor + recorded TMDB) | ~30 % | < 3 min | The API surface end to end inside the process: routes, middleware order, owner scoping, batch atomicity, retention, error envelopes |
| **Component** (`vitest` + Testing Library) | ~10 % | < 30 s | Screen states from `specs/ux-states.md`, copy constants, section presence/absence, ticked-by-default |
| **E2E** (`playwright`, Chromium + Mobile Safari viewport) | ~5 % | < 6 min | The value loop and the two irreversible paths; accessibility scans; the 320 px floor |

**Why weighted toward unit and integration, not e2e.** The defects that
actually threaten this product are *semantic*, not visual: a suppression keyed
on the wrong thing, a full-update review that hides known titles, a TTL
somebody added. Those are cheapest and most reliably caught at the domain and
API layers, where they can be asserted precisely and run in seconds — which
matters when an autonomous agent iterates dozens of times per task. E2E exists
for the small set of properties that only exist in the browser (§6).

**Coverage targets** (`vitest --coverage`, v8 provider), enforced in CI:

| Path | Statements | Branches |
|---|---|---|
| `packages/domain/src/**` | **95 %** | **90 %** |
| `apps/api/src/**` | **90 %** | **85 %** |
| `apps/web/src/**` | **70 %** | **60 %** |

Coverage is a floor, not a goal. **The AC mapping in §9 is the real gate**:
`T-META-001` parses `artifacts/PRD.md`, extracts every `US-nnn AC-n`, and
fails if any is absent from the mapping table in this file **or** if any test
id in the table does not exist in the suite. A new AC without a test cannot
merge.

---

## 2. Tooling

| Concern | Choice |
|---|---|
| Runner | **Vitest** (unit, integration, component) — same engine as Vite, one config, TypeScript native |
| Browser | **Playwright** (`@playwright/test`), Chromium + `Mobile Safari` device profile |
| Accessibility | `@axe-core/playwright` |
| Assertions | Vitest `expect`; `zod` schemas re-used as response assertions |
| Store | **`mcr.microsoft.com/mssql/server:2022-latest`** (service container) in CI, migrated with `prisma migrate deploy` *(R4 — was `postgres:16-alpine` in R3, Cosmos Emulator in R1; see §3.3a for the exact GitHub Actions config)*; **Azurite** for blob |
| HTTP fakes | `msw` for TMDB; **no network egress in CI** (`T-CI-007` asserts an outbound-blocking proxy sees zero requests) |
| Static | `tsc --noEmit`, `eslint`, `prettier --check` |
| Secrets | `gitleaks` |
| Load fixture | `tests/fixtures/seed.ts` — deterministic seeded data |

Commands (all runnable by the agent, all offline):

```
npm run lint          # eslint + prettier + tsc --noEmit
npm run test:unit
npm run test:int      # starts mssql + azurite via docker compose, waits for mssql health, then prisma migrate deploy
npm run test:web
npm run test:e2e
npm run test:a11y
npm run test          # everything above, in order
npm run golden        # the extractor golden suite (offline, replayed recordings) — CI
npm run golden:live   # MANUAL ONLY — 3 live runs per image, band assertions, COSTS MONEY. Never in CI.
npm run golden:record # MANUAL ONLY — refreshes the LLM + OCR recordings. Never in CI.
```

---

## 3. Determinism — how every external is faked

**The entire suite runs offline, with no Azure subscription, no TMDB key and no
cost.** This is a hard requirement: an autonomous agent that cannot run the
suite locally has no feedback signal at all.

### 3.1 Extraction — `StubExtractor` (both readers)

`apps/api/src/extraction/stubExtractor.ts` implements `TitleExtractor`
(`specs/ai.md` §2.3). Selected by `NEXTUP_EXTRACTOR=stub`.

- Keyed on the **sha256 of the image bytes**, it returns the recorded
  **LLM** response from `tests/fixtures/golden/llm/<name>.llm.json` **and**
  the recorded **OCR** response from `tests/fixtures/golden/ocr/<name>.ocr.json`,
  then runs them through the **real `crossCheck()`** — so the merge logic
  is exercised, not stubbed.
- An unknown hash returns both empty — the zero-yield case, so a forgotten
  fixture surfaces as the low-yield path rather than a crash.
- Fault injection by filename convention:
  `__fail_error__.png` → throws; `__fail_429__.png` → throws a 429-shaped
  error; `__slow__.png` → exceeds the per-image timeout;
  **`__llm_down__.png` → LLM leg fails, OCR leg succeeds (degraded mode);
  `__ocr_down__.png` → OCR leg fails, LLM leg succeeds;
  `__truncated__.png` → LLM returns `finish_reason: 'length'`.**
- **Byte-for-byte deterministic.** `T-STUB-001` runs the same batch three
  times and asserts identical `ExtractionCandidate` documents.
  `T-AI-034` asserts `crossCheck()` alone is a pure function over three runs.

**No test in CI ever calls Azure OpenAI or Azure AI Vision.** The live
providers are reached only by the manual §4A suite.

### 3.1a Stage-1 contract fakes — `msw` against recorded HTTP bodies

The **real** `LlmVisionExtractor` and `AzureVisionExtractor` are exercised
in CI against committed HTTP recordings in `tests/fixtures/llm/` and
`tests/fixtures/vision/` (`T-AI-033`). This is byte-deterministic because
the response is a recording. It covers schema parsing, strict-schema
rejection of unknown/service fields, `finish_reason: 'length'`, content
filter refusals, 429/5xx retry timing, timeouts, and both degraded paths.
Full case list: `specs/ai.md` §9.3.


### 3.2 TMDB — recorded fixtures via `msw`

`tests/fixtures/tmdb/*.json`, keyed on the normalised query string. Search and
detail responses are recorded once from the live API and committed. A query
with no fixture returns `{ results: [] }` — the unmatched path.
`__tmdb_unavailable__` in a query triggers a 503, driving US-007 AC-5.
**No test ever calls TMDB.**

### 3.3 The store — a real database, not a mock **(REVISION 4: Azure SQL)**

> ⚠ **R4 — CHANGED AGAIN.** R1 used the Cosmos Emulator; R3 used
> `postgres:16-alpine`; **R4 uses `mcr.microsoft.com/mssql/server:2022-latest`**
> because ADR-0005 Rev 3 selected Azure SQL Database Basic. The prose below
> is retained for the *reasoning* (a real store, not a mock), but every
> `postgres:16-alpine` reference now means the mssql service container of
> §3.3a, and the invariants are enforced by **filtered unique indexes** and
> **CHECK** constraints (`data-model.md` §16.4), which the mssql engine
> enforces identically to Azure SQL.

Integration tests run against a **real SQL Server engine** in
`docker-compose.test.yml` — the same engine Azure SQL Database runs —
because the properties that matter — **owner scoping, unique and check
constraints, transactional batch close, keyset pagination, the absence of
any scheduled deletion** — are properties of the store. A hand-written mock
would let all of them pass while broken.

**Why a real engine, not just a substitution.** `NFR-003` makes CI the
implementer's only feedback loop, so the fixture's reliability *is* the
loop's reliability. Three of the invariants in `data-model.md` §16.4 are
**database constraints**, so `T-INV-001`, `T-INV-002` and `T-INV-015`
assert that the *store* refuses the bad write — an assertion a mock could
not make.

- Migrations are applied with `prisma migrate deploy` (provider
  `sqlserver`) against the container before the suite runs. **The suite
  therefore also tests the migrations**, which is where `REQ-028` is most
  easily violated (see `T-MIG-001`).
- Each test file gets its own `ownerId`, so tests remain parallel-safe
  without a shared reset — unchanged.
- Tests that must assert transactional behaviour use a real transaction and
  a fault injector, not a mocked client (`T-BATCH-005`).

### 3.3a The mssql service container — exact GitHub Actions config **(R4)**

> **RSK-031 makes this load-bearing.** `mcr.microsoft.com/mssql/server:2022-latest`
> is heavier than `postgres:16-alpine`: it needs **~2 GB RAM**, an
> **`ACCEPT_EULA`** acknowledgement, a **strong `MSSQL_SA_PASSWORD`**, and a
> **health-wait** because it is not ready to accept connections the instant
> the container starts (typically ~10–30 s). A test job that runs
> `prisma migrate deploy` before the engine is ready fails intermittently —
> exactly the flaky-gate failure `NFR-003` cannot tolerate. This config was
> confirmed to work as a GitHub Actions **service container**.

```yaml
# .github/workflows/ci.yml  — the integration job
services:
  mssql:
    image: mcr.microsoft.com/mssql/server:2022-latest
    env:
      ACCEPT_EULA: "Y"
      MSSQL_SA_PASSWORD: "Str0ng!Passw0rd_ci"   # CI-only, non-secret, ephemeral
      MSSQL_PID: "Developer"                      # free edition for CI
    ports:
      - 1433:1433
    options: >-
      --health-cmd "/opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P \"$MSSQL_SA_PASSWORD\" -Q \"SELECT 1\" -b -o /dev/null"
      --health-interval 10s
      --health-timeout 5s
      --health-retries 12
      --health-start-period 30s
```

- **`sqlcmd` lives at `/opt/mssql-tools18/bin/sqlcmd` in the 2022 image and
  requires `-C`** (trust the self-signed dev cert). The older
  `/opt/mssql-tools/bin/sqlcmd` path and the un-`-C` invocation are the two
  most common reasons a copied-from-the-web health check silently never
  passes.
- ⚠ **That path exists ONLY INSIDE the mssql container, never on the runner.**
  The `--health-cmd` above is fine because Docker executes it *in* the
  container. A **job step**, however, runs on the **runner**, where Microsoft
  client tools are **not installed** — they were **removed from the
  `ubuntu-24.04` image** (i.e. from current `ubuntu-latest`). A wait step that
  calls `/opt/mssql-tools18/bin/sqlcmd` directly therefore fails immediately
  with *"No such file or directory"*, on every run. **This is the same
  class of defect as the `-C`/`mssql-tools` traps above — it just bites one
  layer out.**
- **An explicit wait step** backstops the service health check before
  migrations, because `services.*.options.--health-*` gates job start but a
  belt-and-braces wait catches the resume race. It reaches `sqlcmd` through
  **`docker exec` into the service container**, which needs nothing installed
  on the runner:

  ```yaml
  - name: Wait for SQL Server
    env:
      MSSQL_SA_PASSWORD: "Str0ng!Passw0rd_ci"
    run: |
      cid=$(docker ps --filter "ancestor=mcr.microsoft.com/mssql/server:2022-latest" --format '{{.ID}}' | head -n1)
      if [ -z "$cid" ]; then
        echo "mssql service container not found" && exit 1
      fi
      for i in $(seq 1 30); do
        if docker exec "$cid" /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -Q "SELECT 1" -b -o /dev/null; then
          echo "SQL Server is ready" && exit 0
        fi
        sleep 2
      done
      echo "SQL Server did not become ready" && exit 1
  ```

  *(The alternative — `apt-get install mssql-tools18` on the runner — also
  works but adds an install to every CI run and a network dependency that
  `NFR-003` would rather not have. `docker exec` is preferred.)*

  > ~~**Superseded (R4 original) — DO NOT COPY, it cannot work:**~~
  > ```yaml
  > - name: Wait for SQL Server
  >   run: |
  >     for i in $(seq 1 30); do
  >       /opt/mssql-tools18/bin/sqlcmd -C -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -Q "SELECT 1" -b && exit 0
  >       sleep 2
  >     done
  >     echo "SQL Server did not become ready" && exit 1
  > ```
  > ~~This ran `sqlcmd` on the **runner**, where the binary does not exist on
  > `ubuntu-24.04`. It also omitted `MSSQL_SA_PASSWORD` from the step `env:`,
  > so the variable expanded empty.~~
- **Test databases are created per run** (`CREATE DATABASE nextup_test`)
  against the `sa` login; `prisma migrate deploy` then runs the
  `sqlserver` migrations. Connection string mirrors `data-model.md` §16.1.1
  with `encrypt=true;trustServerCertificate=true` (CI self-signed cert only).
- **`T-INFRA-006` (new, R4):** the CI workflow contains the mssql service
  with `ACCEPT_EULA`, the `-C` health command, and the wait step — so an
  edit that drops the wait (reintroducing flakiness) is a reviewable diff.
  **It additionally asserts the wait step does NOT invoke
  `/opt/mssql-tools18/bin/sqlcmd` as a bare runner command** (it must go
  through `docker exec`, or install the tools first). Presence alone is not
  enough: the original R4 wait step was *present* and *unrunnable*, so a
  presence-only assertion went green while CI went red.
- **Alternative considered and rejected:** Azure SQL Edge
  (`mcr.microsoft.com/azure-sql-edge`) is lighter but is **deprecated/
  retiring** and lacks some T-SQL surface (e.g. certain `ISJSON`/collation
  behaviours), so it is not used. If the full image ever proves too heavy
  for the runner, the escalation is a self-hosted larger runner, not Edge.

### 3.4 Blob — Azurite

Real `@azure/storage-blob` against Azurite. The **lifecycle rule is not
emulated**, so retention is tested two ways: by manipulating `retainUntil`
(application boundary, `T-IMG-004`) and by asserting the Bicep rule exists and
is correctly shaped (`T-INFRA-004`).

### 3.5 Time

`vi.useFakeTimers()` plus an injected `clock: () => Date` on the repository.
**No test calls `Date.now()` directly.** Retention and the 183-day
TMDB ceiling are all tested by advancing the injected clock.

### 3.6 Identity

`NEXTUP_DEV_SUBJECT` drives the dev principal shim (`specs/security.md` §2.3).
`tests/helpers/asOwner(subject)` returns a supertest agent with the right
headers. Two fixed owners exist: `OWNER_A`, `OWNER_B` — used by every
cross-owner isolation test.

---

## 4. Golden fixtures (the extractor's regression net)

Fully specified in **`specs/ai.md` §9**. Summary of what **CI** enforces
(all offline, all replayed from recordings, all deterministic):

| Gate | Threshold | Test |
|---|---|---|
| Title recall (aggregate, **including** the artwork-only fixture) | ≥ **0.95** *(raised from 0.90 — see note)* | `T-AI-030` |
| False-title rate | ≤ 0.10 | `T-AI-030` |
| **Fabrication rate** — candidates with `ocrSupport: 'none'` that are neither expected nor TMDB-matched | ≤ **0.05** | **`T-AI-032`** |
| **Omission recovery** — an expected title present in the OCR recording but absent from the LLM recording is recovered as an `ocr-only` orphan | **1.0, non-negotiable** | **`T-AI-039`** |
| Chrome rejection | ≥ 0.80 | `T-AI-030` |
| Match accuracy | ≥ 0.90 | `T-AI-031` |
| **Determinism of stages 1c–5 across 3 runs** | **exactly 1.0** | `T-STUB-001`, **`T-AI-034`** |
| Artwork-only fixture recall (`max-artwork-only-01.png`) | ≥ **0.80**, all `basis: 'artwork'`, verdict `inferred-unverified` | **`T-AI-035`** |
| **`blank-no-content-01.png`** triggers the low-yield path | must | `T-AI-021`, `T-AI-022` |
| Degraded (LLM-unavailable) full-update withholds removals | must | **`T-AI-036`** |
| Truncated caption resolves to the complete work, `rawText` keeps the ellipsis | must | **`T-AI-043`** |
| Prompt-injection fixture cannot escape the schema | must | **`T-AI-044`** |
| `FABRICATION_RATE_CEILING` is never referenced at runtime | must | **`T-AI-042`** |

> ### ⚠ The two fixture changes an implementer will get wrong
>
> **1. `max-artwork-only-01.png` has swapped roles.** Under Revision 1 it
> had `expectedTitleCount: 0` and existed to prove the low-yield path
> fired. Under Revision 2 the primary reader is **expected to read it**,
> so its `expectedTitleCount` becomes the real number of works and it
> becomes the headline **`RSK-021`** fixture (`T-AI-035`, recall ≥ 0.80).
>
> **2. A new fixture, `blank-no-content-01.png`, takes over the low-yield
> role.** `T-AI-021`/`T-AI-022` must be **repointed at it**, not deleted
> and not left aimed at the artwork fixture. If they stay aimed at the
> artwork fixture they will fail, and the "fix" an agent will reach for
> is to lower the artwork gate — which silently undoes the entire point
> of ADR-0001 Revision 2.

The fixture set is **committed** (12 images; their recorded **LLM** and
**OCR** responses; their expected pipeline output). It runs offline on
every pull request. Because the LLM response is sampled, **refreshing the
recordings always produces a diff** — so the review question after a
refresh is *"did the §4 metrics move?"*, never *"is the diff empty?"*.

---

## 4A. The live quality suite — `npm run golden:live` — MANUAL ONLY

**This never runs in CI, never on a schedule, never in a hook.**
`T-CI-004` asserts neither `golden:live` nor `golden:record` is referenced
by any workflow file. It costs money and it is **allowed to be flaky** —
it is a human-run measurement whose output is a committed report, not a
merge gate.

It runs each golden image **N = 3 times** against the live `gpt-4.1`
deployment and the live Vision endpoint, and asserts **bands**:

| # | Assertion | Gate |
|---|---|---|
| L1 | Per-image title recall ≥ that image's `minRecall` | in **3 of 3** runs |
| L2 | Cross-run **set stability** — pairwise Jaccard of the normalised accepted-title sets | ≥ **0.95** |
| L3 | **Unstable titles** (present in < 3 of 3 runs) | ≤ **5 %** of expected titles, **each printed by name** |
| L4 | Fabrication rate per run | ≤ **0.05** |
| L5 | False-title rate per run | ≤ **0.10** |
| L6 | Artwork-only recall | ≥ **0.80** in 3 of 3 |
| L7 | **Cost of the whole run** from reported token usage | ≤ **$0.50** |

> **Prohibitions — these are the assertions that must not be written:**
> - ❌ `expect(result.items[0].inferredTitle).toBe('Dune')` — exact equality against live output
> - ❌ `expect(result.items).toHaveLength(24)` — exact count
> - ❌ any assertion on the **order** of live output; compare **sorted sets**
> - ❌ snapshot tests (`toMatchSnapshot`) over live output
> - ❌ adding `golden:live` to `ci.yml`
>
> **The permitted shapes:** recall/precision floors, Jaccard stability
> floors, rate ceilings, membership assertions over a sorted set, and
> cost ceilings.

Output is written to `docs/evaluation/golden-<ISO date>.md` and committed.
**A drop between two reports is the only early warning of model drift the
product has.**


---

## 5. The end-to-end journey test — a first-class deliverable

`tests/e2e/journey.spec.ts` — **`T-E2E-001`**, the single most valuable test in
the suite. It is not a smoke test; it is the product's specification executed.

```
GIVEN a signed-in, allow-listed owner with an empty list

 1  UPLOAD      create a full-update Netflix batch; attach 3 golden screenshots
                → assert both mode consequence sentences were visible before submit
 2  EXTRACT     submit; poll to 'in-review'
                → assert the combined list is STILL EMPTY (nothing written yet)
 3  REVIEW      → assert "New to your list (N)" is present and expanded
                → assert "Already on your list" is present, collapsed, count visible
                → assert "No longer on Netflix" is absent (nothing to remove yet)
                confirm all additions
 4  RECONCILE   close the batch
                → assert the combined list now shows exactly the confirmed titles,
                  one row per work, correct badges, correct dateAddedLabel
                → assert the freshness strip reads "Netflix updated today"

 5  SECOND PASS create a SECOND full-update Netflix batch from screenshots that
                OMIT one previously-confirmed title and ADD one new one
                → assert the review shows: 1 addition, the omitted title in
                  "No longer on Netflix", TICKED BY DEFAULT
                → assert every already-known title also appears under
                  "Already on your list"      ← REQ-057, the safety property
                untick nothing; close with confirmRemovals
                → assert the removed title is gone from the list
                → assert it appears in /removed with its original dateAdded
                → assert the "Undo these removals" affordance is offered

 6  SUPPRESS    mark a remaining title "not interested"
                → assert it leaves the combined list
                → assert it appears in /not-interested

 7  REAPPEAR    create a THIRD batch whose screenshots contain BOTH the removed
                title AND the suppressed title
                → assert the removed title appears as a NEW addition (L1/A33)
                → assert the suppressed title appears NOWHERE in the review
                close
                → assert /removed still holds the ORIGINAL removed row, unchanged
                → assert the reappeared title has TODAY's dateAdded
                → assert /removed now shows "Removal 1 of 1" ordinals correctly

 8  ATTRIBUTION → assert the TMDB disclaimer and logo are visible on every route
 9  A11Y        → assert zero serious/critical axe violations on every route
10  VIEWPORT    → the whole journey re-runs at 320x640 with no horizontal scroll
```

Steps 5 and 7 together are the product's core risk surface: mode-dependent
review scope, ticked-by-default removals, reappearance-as-new-row, and
identity-keyed suppression. If `T-E2E-001` passes, the four defects most likely
to destroy the owner's trust are absent.

---

## 6. The non-negotiable core (architecture §Handover 5)

These **sixteen** fail the build on their own. They are listed separately because
they guard properties whose failure is **silent**. *(Corrected in place, R5:
the heading said "eleven" while the table already held thirteen rows; R5 adds
three more. This is a count an implementer checks against, so it is fixed
rather than banner-superseded.)* ~~*"These eleven fail the build on their
own."*~~

| # | Property | AC | Test |
|---|---|---|---|
| 1 | An allow-listed-out identity gets **no data** — *"the highest-value test in the product"* | US-001 AC-4 | `T-SEC-010`, `T-SEC-017`, `T-SEC-018` |
| 2 | Full-update review shows **all** extracted titles | US-013 AC-6 | `T-REV-006` |
| 3 | The removed view is **not** de-duplicated | US-024 AC-6 | `T-REM-006` |
| 4 | Suppression is keyed on **work identity**, survives removal + reappearance | US-028 AC-3 | `T-SUP-003` |
| 5 | TMDB attribution present on every surface | US-011 AC-5 | `T-ATTR-001/002/003` |
| 6 | **No blob URL or SAS in any response** | US-036 AC-4 | `T-SEC-003` |
| 7 | **No mechanism exists that could expire or schedule deletion of list data** *(R3 — was "no TTL on any Cosmos container")* | US-023 AC-3 | `T-INV-013` |
| 8 | No hard delete outside creates-only undo | US-023 AC-5 | `T-INV-012` |
| 9 | Removals ticked by default, confirmed as one group | US-015 AC-1/AC-3 | `T-UI-007`, `T-UI-008` |
| 10 | The mixed-undo refusal enumerates **everything**, never truncated | US-033 AC-5 | `T-UNDO-006` |
| 11 | No TMDB content reaches any AI service | NFR-016 | `T-AI-012`, `T-AI-013` *(R2: `T-AI-013` now covers **both** inference hosts — Vision and Azure OpenAI)* |
| 12 | *(R2)* A title the extractor's primary reader omitted, but the OCR cross-check saw, is never silently lost | REQ-012 | **`T-AI-039`** |
| 13 | *(R2)* A degraded (OCR-only) full-update batch never proposes removals | US-014 AC-6 | **`T-AI-036`** |
| 14 | *(R5, `A43-M2`)* **A memory/decode failure on one image never partially commits or corrupts a batch** — the other images proceed, the list is unchanged until close | US-004 AC-6, US-005 AC-1 | **`T-IMG-018`** |
| 15 | *(R5, `A43-M1`)* **The pixel guard refuses BEFORE any decode buffer is allocated** — the decoder is never constructed. Without this, "reactive up-size" means the container dies first and explains nothing | US-004 AC-7 | **`T-IMG-017`** |
| 16 | *(R5, `A43-M3`)* **The failure is diagnosable** — the error names memory and cites `runbooks/scale-up-memory.md`, and the corrupt-file error does neither | US-004 AC-7 | **`T-IMG-020`**, **`T-UI-013`** |

> **Why three more entries in a list titled "non-negotiable".** The owner
> accepted `RSK-016` as a **residual** risk on the explicit condition that
> these mitigations exist (`A43`). They guard a failure that is otherwise
> **silent in the worst possible way**: an import dies mid-run, nothing
> explains why, and the remedy — already bought and documented — is never
> reached. Entry 15 is the one an implementer is most likely to "simplify"
> into a post-decode check, which would defeat its entire purpose.

---

## 7. Test data and fixtures

```
tests/fixtures/
  seed.ts                 # deterministic owners, titles, listings, batches
  golden/                 # specs/ai.md §9 — images, recorded LLM + OCR, expected output
    images/               # 12 images (incl. blank-no-content-01, truncated-titles-01)
    ingest/               # A42 — HEIC/HEIF ingest fixtures (real device files):
                          #   iphone-camera-01.heic (EXIF+GPS present, in-bounds),
                          #   iphone-hdr-screenshot-01.heic, heif-brand-01.heif,
                          #   corrupt-truncated-01.heic (decode must fail gracefully),
                          #   oversize-20000px-01.heic (dimension-bound reject),
                          #   and the PNG/JPEG regression pair (still-accepted)
                          # R5/A43 — pixel-guard fixtures (T-IMG-017/T-IMG-022):
                          #   guard-48mp-6mib-01.heic   8064x5952, ~6 MiB — the case
                          #     that PROVES a byte guard is not a pixel guard: it is
                          #     under the 10 MiB byte ceiling and 48 MP
                          #   guard-26mp-01.heic        just OVER 25 MP  — reject
                          #   guard-24mp-01.heic        just UNDER 25 MP — accept
                          #   guard-multi-ispe-01.heic  a 512x512 THUMBNAIL ispe plus
                          #     a 48 MP master ispe — the max-ispe rule (api.md
                          #     §5.0.3); taking the first ispe lets 48 MP through
                          #   guard-truncated-header-01.heic  ftyp ok, ispe missing
                          #     within 64 KiB — readDimensions() returns null -> 415
                          #   guard-progressive-01.jpg  SOF2 progressive JPEG — the
                          #     SOFn walk must not stop at DHT/SOS
                          #   guard-lying-header-01.png IHDR says 800x600, raster is
                          #     8000x6000 -> IMAGE_DECODE_FAILED (api.md §5.1 step 4)
                          # Fixtures over ~2 MiB are GENERATED by a committed script
                          # (tests/fixtures/generate-guard-images.ts), not committed
                          # as blobs — same rule as scale/ below.
    llm/                  # recorded gpt-4.1 responses
    ocr/                  # recorded Vision Read responses
    expected/
  llm/                    # specs/ai.md §9.3 — stage-1 contract HTTP recordings
                          #   valid / unknown-field / service-field / truncated /
                          #   refusal / 429 / injection-attempt
  vision/                 # stage-1 contract HTTP recordings for Read
  tmdb/                   # recorded TMDB search + detail responses
  scale/
    removed-20k.json      # 20,000 removed listings — NFR-018
    review-500.json       # a 500-candidate review pass — US-013 AC-5, US-037 AC-3
    mixed-batch-400.json  # a 400-title mixed changeset — US-033 AC-5
```

Rules:
- **Every fixture is deterministic.** No `faker` without a fixed seed, no
  `Date.now()`, no random ULIDs — `tests/helpers/ulid.ts` provides a
  monotonic counter-backed ULID factory.
- **Recorded model responses are fixtures, not oracles.** They are replayed
  byte-for-byte in CI. They are refreshed only by the manual
  `golden:record` task, and a refresh diff is expected to be non-empty.
- **Fixtures are built through the repository**, not written raw, so a fixture
  cannot encode a state the application could not produce (a `title` with a
  stale derived `state`, for example).
- The three scale fixtures are generated by a committed script, not committed
  as blobs, to keep the repository small.

---

## 8. CI — the only gate (RSK-025)

`.github/workflows/ci.yml`, on every push and pull request.

| # | Job | Blocks merge? |
|---|---|---|
| 1 | `lint` — `eslint`, `prettier --check`, `tsc --noEmit` across all workspaces | **yes** |
| 2 | `secrets` — `gitleaks` on tree and diff | **yes** |
| 3 | `audit` — `npm audit --audit-level=high` | **yes** (high/critical only) |
| 4 | `test:unit` + coverage thresholds (§1) | **yes** |
| 5 | `test:int` — **mssql/server:2022** + Azurite services, health-wait then migrations applied first (§3.3a) | **yes** |
| 6 | `test:web` — component tests | **yes** |
| 7 | `golden` — the extractor golden suite and its metric gates (§4), **offline, replayed recordings only** | **yes** |
| 8 | `test:e2e` — Playwright, Chromium + Mobile Safari, including `T-E2E-001` | **yes** |
| 9 | `test:a11y` — axe on all nine routes; **zero serious/critical** | **yes** |
| 10 | `infra` — Bicep build/what-if + `T-INFRA-*` + `T-INV-013` + **`T-MIG-001` (destructive-migration gate)** | **yes** |
| 11 | `meta` — `T-META-001` AC↔test mapping completeness | **yes** |
| 12 | `build` — production container image; includes `T-SEC-019` (no dev shim in `dist`) | **yes** |

**Every job blocks.** There are no advisory jobs, because an advisory job in a
one-reviewer project is a job nobody reads. Branch protection requires all
twelve green plus a linear history.

`.github/workflows/deploy.yml`, on push to `main` after CI passes: build and
push to ghcr.io → deploy a new Container Apps revision at 0 % traffic →
`tests/smoke/` against the new revision (`specs/security.md` §10) → shift
traffic to 100 %. **A smoke failure aborts the shift and leaves the previous
revision serving.** Rollback is one command.

---

## 9. Acceptance criteria → tests — the complete mapping

Levels: **U** unit · **I** integration · **C** component · **E** e2e ·
**S** static/infra · **M** manual (see §10).

### US-001 — Sign in with a federated identity provider
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | E | `T-AUTH-001` | Unauthenticated request to every route redirects to sign-in; no nextup content in the response |
| AC-2 | E | `T-AUTH-002` | Sign-in completes; deep link preserved; lands on the combined list |
| AC-3 | S | `T-SEC-011` | No auth library, no password field, no credential column anywhere |
| AC-4 | I/E | **`T-SEC-010` `T-SEC-017` `T-SEC-018`** | Allow-listed-out principal → 403 on every route; browser shows refusal; no `/api/titles` 200 in the network log |
| AC-5 | C | `T-UX-019` | IdP failure renders the sign-in-again state; no partial app UI |
| AC-6 | E | `T-AUTH-003` | Returning within session lifetime does not re-prompt; expiry yields the 401 state |

### US-002 — All data is owned by, and visible only to, the owner
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | U | `T-SEC-028` | Every domain type declares required `ownerId`; Zod rejects a document without it |
| AC-2 | I | `T-SEC-029` | Every route enumerated from the router is owner-scoped; a route without `attachOwnerScope` fails the test |
| AC-3 | I | **`T-SEC-002`** | Owner B requesting any of Owner A's ids receives **404**, never 403, on every id-bearing route |
| AC-4 | I | `T-SEC-030` | Missing/malformed principal header → 401 JSON envelope; no data |

### US-003 — Start a batch by naming exactly one service and one mode
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-BATCH-010` | `POST /api/batches` without `service` → 400; no default applied |
| AC-2 | C | `T-UI-003` | Both mode consequence sentences are in the DOM without interaction |
| AC-3 | I | `T-BATCH-011` | Full-update reconciliation touches only the batch's service |
| AC-4 | I | `T-BATCH-012` | Mixed-service screenshots still reconcile only the declared service |
| AC-5 | S/U | `T-AI-011` | `'netflix'`/`'max'` appear nowhere under `extraction/`; extractor result type has no service field |
| AC-6 | I | `T-BATCH-013` | Changing `service`/`mode` after submit → 409 `BATCH_IMMUTABLE` |

### US-004 — Upload multiple screenshots in one batch

> ⚠ **(A45) THE STORY TITLE IS NOW NARROWER THAN THE BEHAVIOUR.** Screenshots
> reach a batch by **paste (primary), file upload, or drag-drop** — see
> `api.md` §5.3. The tests below cover all three. **The AC numbering is NOT
> changed here** (see the note under the new-test table): the PRD is being
> revised in parallel for A45 and the orchestrator reconciles.

**(A45) New tests, allocated but deliberately NOT yet pinned to AC numbers.**
The PRD agent is adding A45 acceptance criteria in parallel and this pass
cannot see them, so these are listed here with their assertions and are
**mapped provisionally to US-004 AC-1/AC-4/AC-6** — the ACs that already cover
"images attach to one batch", "non-image rejected by sniff" and "partial
acceptance". **✅ ORCHESTRATOR (R7): re-pointed.** The PRD landed US-004
**`AC-12`…`AC-17`** and each test below now carries its real AC, exactly as R6
re-pointed the `A43` tests from AC-6/AC-7 to AC-9/AC-10/AC-11. Mapping:
**`AC-12`** (desktop Ctrl/Cmd+V) ← `T-PASTE-001`; **`AC-13`** (iOS paste
button) ← `T-PASTE-002`, `T-PASTE-005`; **`AC-14`** (paste appends to the open
batch) ← `T-PASTE-003`, `T-PASTE-004`, `T-UI-014`; **`AC-15`** (rejection
detected and re-offered) ← `T-PASTE-008`; **`AC-16`** (capability absent →
affordance hidden, upload still complete) ← `T-PASTE-009`, `T-PASTE-010`;
**`AC-17`** (one shared server pipeline; conditional-not-deleted transcode;
EXIF strip not discharged) ← `T-PASTE-006`, `T-PASTE-007`, `T-IMG-023`,
`T-SEC-033`, `T-RET-014`. `T-META-001` is the gate that fails if any A45 AC
ends up unmapped.

| AC | Test | L | Assertion |
|---|---|---|---|
| **AC-12** | **`T-PASTE-001`** | C | **The desktop `paste` listener.** A synthetic `paste` event on `document` carrying a PNG in `clipboardData.files` attaches it to the open batch and calls `preventDefault()`. **Three negative cases in the same test, all required:** an event whose `target` is an `<input>` returns **without** `preventDefault()` (text pasting into TMDB search still works); a **text-only** paste returns without `preventDefault()`; and the listener is **removed on unmount** (a paste after navigating away attaches nothing) |
| **AC-13** | **`T-PASTE-002`** | C | **The iOS button path.** Clicking **"Paste screenshot"** calls `navigator.clipboard.read()` **synchronously inside the click handler** (asserted: no `await` or timer precedes the call, so transient activation is intact); the resolved `ClipboardItem`'s `image/png` blob is posted with `ingestSource: 'paste'`. Also §4.0a: a paste before service/mode is chosen **holds** the image client-side and attaches it once the batch exists — it is never silently dropped |
| **AC-14** | **`T-PASTE-003`** | I/C | **Successive pastes APPEND to the open batch.** Three pastes in a row produce **one** batch with three images, `batchTotals.imageCount === 3`, server-assigned ordinals `01`/`02`/`03` in receipt order. **No second batch is created** (asserted: exactly one `POST /api/batches` in the whole flow), and a paste after a file upload lands in the **same** batch alongside it |
| **AC-14** | **`T-PASTE-004`** | C | **Drag-and-drop.** A `drop` carrying two PNGs attaches both with `ingestSource: 'drop'`; `dragover` renders `DROPZONE_ACTIVE_LABEL`; a dragged non-image and a dragged folder are refused **by name** with the standard per-file message |
| **AC-13** | **`T-PASTE-005`** | U/I | **Identity and naming.** `synthesisePastedFileName()` produces exactly `pasted-YYYYMMDD-HHMMSS-NN.<ext>` from **server** UTC time and the 1-based batch ordinal, zero-padded to 2; **two images pasted in the same second get different names**; the extension comes from the **sniffed** format, not the declared type. `blobPath` is composed from ULIDs only and contains **no part of any client-supplied name**, for all three sources. `ingestSource` is persisted as `paste`/`upload`/`drop` and **is not inferred from the filename prefix**. An `upload`/`drop` with an empty name falls back to `uploaded-`/`dropped-` and `fileName` is **never** empty |
| **AC-17** | **`T-PASTE-006`** | I | **The sniff still rules on pasted bytes.** A pasted blob declaring `image/png` whose bytes are a PDF → **415 `UNSUPPORTED_IMAGE_FORMAT`**; a pasted blob declaring `application/octet-stream` whose bytes are a valid PNG → **accepted**, `uploadedFormat: 'png'`. `Blob.type` is never trusted for any decision |
| **AC-17** | **`T-PASTE-007`** | I | **Every ceiling and guard applies identically to pasted images.** A pasted 48 MP PNG is refused **413 `IMAGE_TOO_LARGE_TO_DECODE`** by the pre-decode guard with the decoder never constructed (the `T-IMG-017` assertion, re-run on the paste path); an 11 MB paste → **413 `IMAGE_TOO_LARGE`**; the 41st image in a batch → **400 `TOO_MANY_IMAGES`** **whether it arrives by paste or upload**; `retainUntil` on a pasted row is `uploadedAt + 30 days` exactly like an uploaded one (NFR-019); `image.decode.begin` carries `ingestSource` |
| **AC-15** | **`T-PASTE-008`** | C | **Every clipboard failure state renders and RE-OFFERS.** Four cases, each asserting a distinct message and that the button is enabled afterwards: `read()` rejects `NotAllowedError` → `PASTE_DENIED_BODY`; resolves empty → `PASTE_EMPTY_BODY`; resolves with text only → `PASTE_NOT_IMAGE_BODY`; rejects with a bare `DOMException` (the abandoned-promise case) → `PASTE_ABANDONED_BODY`. **⚠ The load-bearing assertion: after ANY rejection no pending/spinner element remains in the DOM.** The UI must never appear to hang (evidence Q1e caveat 2) |
| **AC-16** | **`T-PASTE-009`** | C | **No clipboard API → the button is NOT RENDERED.** With `navigator.clipboard` deleted (the `http://`-origin and old-browser case), `queryByRole('button', { name: /paste screenshot/i })` is **null** — not disabled, not broken. **"Choose files" and the drop target are still present and fully functional**, and the `document` `paste` listener is still attached (it needs no secure context) |
| **AC-16** | **`T-PASTE-010`** | E2E | **⚠ THE ADD-NOT-SWAP REGRESSION GUARD.** The full journey — attach by **file input**, extract, review, close — still passes **after** paste ships. Asserted alongside it: the file input exists on `/upload`, its `accept` still admits **PNG, JPEG and HEIC**, and a **HEIC file upload** is still accepted and transcoded. This test fails if paste quietly displaces upload, which is the A42 mistake this pass exists to avoid |
| **AC-17** | **`T-IMG-023`** | U/I | **The transcode is conditional on the SNIFFED FORMAT — and still present.** A pasted PNG skips the transcode (asserted: the `heic-convert` test double is **not invoked**) and is stored byte-identically; **a HEIC arriving by FILE UPLOAD still IS transcoded** to PNG (`format: 'png'`, `uploadedFormat: 'heic'`); and — the structural half — the branch condition references `uploadedFormat` and **not** `ingestSource`, asserted by feeding a **HEIC with `ingestSource: 'paste'`** (a client lying, or a future platform change) and requiring it to be **transcoded anyway** |
| **AC-14** | **`T-UI-014`** | C | **All three affordances are present and reachable.** On `/upload` with service and mode chosen: the **"Paste screenshot"** button (44×44 px, in tab order), the file input, and the drop target are all in the DOM simultaneously; `DROPZONE_IDLE_LABEL` names all three routes **and** still enumerates PNG, JPEG and HEIC and the ceilings; `PASTE_IOS_HINT` renders on a touch viewport. A successful paste announces in the `aria-live="polite"` region |
| **AC-17** | **`T-SEC-033`** | S/I | **The upload path's EXIF strip is not weakened by the paste path's free stripping.** A **HEIC file upload carrying GPS EXIF** lands stripped in the blob (the case a paste can never exercise); asserted **in addition to** `T-SEC-032`, which now runs for a pasted PNG, an uploaded HEIC and an uploaded JPEG |
| **AC-17** | **`T-RET-014`** | I | **30-day retention is identical for pasted images.** A pasted `uploadedImage` has `retainUntil = uploadedAt + 30d`, written once and never updated, is purged by the same lifecycle rule, and returns the same `IMAGES_PURGED` behaviour on re-extract afterwards (NFR-019, US-034 AC-5) |

| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-IMG-010` | Multiple images attach to one batch; count and byte totals correct. **(A45) Extended: images arriving by paste, drop and upload all land in the SAME open batch and are counted together** — `T-PASTE-003` |
| AC-2 | I | `T-IMG-011` | Every image is persisted to blob and to an `uploadedImage` doc bound to the batch |
| AC-3 | I | **`T-IMG-002`** | Bytes served only via `GET /api/images/:id` with the mandated headers |
| AC-4 | I | `T-IMG-006` | Non-image (and a polyglot with mismatched magic bytes) → 415, named in `rejected[]`. **Regression (A42): PNG and JPEG uploads still accepted and stored unchanged** — the trap is "tidying" the format list and dropping one. **(A45) The sniff applies identically to PASTED bytes; `Blob.type` is never trusted** — `T-PASTE-006` |
| AC-5 | U/I | `T-AI-007` | Overlapping screenshots collapse to one candidate; `sourceImageIds` holds both |
| AC-6 | I | `T-IMG-012` | Partial upload failure: valid files accepted (201), invalid named individually; batch remains usable |
| AC-7 *(new, A42 — PRD agent adding)* | I | **`T-IMG-013`** | A **HEIC** upload (empty/`application/octet-stream` declared type, `ftyp` HEIF brand) is **accepted** by magic-byte sniff, transcoded to a **valid lossless PNG** that both extractors accept; `format='png'`, `uploadedFormat='heic'`; a **HEIF**-branded file is accepted the same way |
| AC-7 *(cont.)* | I | **`T-IMG-016`** | **(corrected in place, R5)** Dimensions ≤ 50 px or ≥ 16,000 px on an axis are rejected **`400 IMAGE_DIMENSIONS_UNSUPPORTED` from the HEADER, pre-decode** (`api.md` §5.0.1 condition 2), not from the decoded raster, and never silently downscaled (NFR-012a); an in-bounds image passes. The **existing** code is reused — no second code is introduced. ~~*R4 assertion: "**Post-transcode** dimensions … → 400 `IMAGE_DIMENSIONS_UNSUPPORTED`."*~~ — **superseded: a bounds check after the decode happens after the allocation that OOMs.** |
| **AC-11** *(cont., R5)* | C | **`T-UI-013`** | **The client does not hide the diagnosis.** For each of the three codes, `ImageDropzone` renders the server `message` **verbatim** in the DOM (no truncation, no "details" disclosure, no auto-dismissing toast), names the file, shows *"Nothing else in this batch was affected"*, and shows the **"How to fix this"** remedy link for the two **memory** codes **and not** for `IMAGE_DECODE_FAILED`. The accepted list and the enabled **"Extract titles"** button survive (`ui.md` §3.2a/§9) |
| AC-7 *(cont.)* | I | **`T-IMG-015`** | **(corrected in place, R5)** A **corrupt/truncated HEIC** fails **gracefully** — that file only → **415 `IMAGE_DECODE_FAILED`** in `rejected[]`, never a 500, never a whole-request failure, and **its message mentions neither memory nor the up-size**. ~~*R4 assertion: "→ 415 `UNSUPPORTED_IMAGE_FORMAT`".*~~ — **superseded (R5, ADR-0008 R2.3): a corrupt file and a capacity failure must stay distinguishable in the log and in the UI.** `UNSUPPORTED_IMAGE_FORMAT` still covers bytes that are not an accepted format at all, including an unparseable header |
| AC-8 *(new, A42 — PRD agent adding)* | S/I | **`T-SEC-032`** | The stored blob for a HEIC upload (and for PNG/JPEG) carries **no EXIF/XMP/GPS/device** metadata — decoded and **asserted**, not assumed |
| **AC-9** *(R5/`A43-M1`)* | U/I | **`T-IMG-017`** | **The pre-decode pixel guard refuses BEFORE allocating.** A 48 MP HEIC (`ispe` 8064 × 5952) is rejected with 413 `IMAGE_TOO_LARGE_TO_DECODE` **while a decoder test double injected in place of `heic-convert` is never constructed and never called** — the assertion is *"the decoder was not invoked"*, not merely *"the response was 413"*. Also: a 26 MP image is refused and a 24 MP image passes at the default `NEXTUP_MAX_DECODE_PIXELS=25000000`; a **6 MiB / 48 MP** HEIC proves the **byte ceiling alone would have let it through** (`api.md` §5.0) |
| **AC-9** *(cont., R5)* | U | **`T-IMG-022`** | `NEXTUP_MAX_DECODE_PIXELS` **defaults to `25000000` when unset**, is read from config **at request time** (not a module constant), and setting it to `50000000` makes the previously-refused 48 MP image pass — the runbook's up-size therefore actually works (`api.md` §5.0.2) |
| **AC-10** *(R5/`A43-M2`)* | I | **`T-IMG-018`** | **Per-image isolation, no partial commit.** A 4-file attach — two valid PNGs, one over-guard HEIC, one that OOMs in decode — returns **201** with `accepted.length === 2`, `rejected.length === 2` naming each file; `batchTotals` counts only the accepted; the batch is still `draft` and re-attachable; **and the combined list is byte-identical before and after** (nothing was committed). Then closing the batch applies **only** the two good images' candidates |
| **AC-10** *(cont., R5/path P1)* | I | **`T-IMG-019`** | **The catchable OOM path.** The decode double throws a `RangeError` (and, as a second case, an Emscripten `abort(OOM)`-shaped `Error`); `isDecodeOom()` classifies both as OOM → that file only gets `IMAGE_DECODE_OOM`, **the loop continues to the next image**, the process does **not** exit, and no other image is affected. A plain `Error('bad huffman code')` from the same double is classified `IMAGE_DECODE_FAILED` instead — the two must not collapse into one (`api.md` §5.2.2/§5.2.3) |
| **AC-11** *(R5/`A43-M3`)* | I/C | **`T-IMG-020`** | **The error is diagnostic.** The `IMAGE_TOO_LARGE_TO_DECODE` and `IMAGE_DECODE_OOM` messages each contain the substring **`memory`** *and* the substring **`runbooks/scale-up-memory.md`**, and match the verbatim text of `api.md` §5.2.4 / ADR-0008 R2.3 with the live values interpolated (actual MP, actual dimensions, the configured limit). **`IMAGE_DECODE_FAILED` contains NEITHER** — asserted negatively, because offering an up-size for a corrupt file sends the owner to buy capacity they do not need |
| **AC-11** *(cont., R5/`A43-M5`)* | I | **`T-IMG-021`** | **The decode sentinel events exist and pair up.** A successful decode emits `image.decode.begin` then `image.decode.end` with the **same `imageId`** and every field of `api.md` §9.1 present and correctly typed; a decode that throws still emits `end` (from `finally`) with `outcome: 'oom' \| 'failed'`; a **guard rejection emits no `begin` at all**; the event-name constants live in `packages/domain/src/logEvents.ts` and a grep asserts the alert query's literals match them (renaming one silently disables `nextup-prod-decode-abandoned`) |

### US-005 — A batch is a transaction: nothing changes until it is closed
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | **`T-BATCH-003`** | Submitted + extracted + not closed → combined list byte-identical to before |
| AC-2 | U | `T-BATCH-004` | `reconcile()` called exactly once for a 6-image batch, over the union |
| AC-3 | I | `T-BATCH-014` | Close applies additions, corrections and confirmed removals together |
| AC-4 | I | `T-BATCH-006` | An abandoned/discarded in-review batch writes nothing to the list |
| AC-5 | I | `T-BATCH-015` | A second open batch → 409 `OPEN_BATCH_EXISTS` naming the open batch |

### US-006 — Extract candidate titles from the uploaded screenshots
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-EXT-010` | Each image is processed; `progress.imagesDone` advances; per-image candidate counts recorded |
| AC-2 | I | **`T-AI-004`** | Every candidate is reachable in the review response; all verdicts represented (incl. `inferred-unverified`, `unreadable-tile`); nothing dropped |
| AC-3 | I/C | `T-AI-020` | A zero-yield image is named and thumbnailed, never silently skipped |
| AC-4 | I | `T-AI-014` `T-UX-053` | Extractor error → `extraction-failed`; list unchanged; images retained; retry offered |
| AC-5 | I/C | `T-UX-054` | 429 → `EXTRACTOR_UNAVAILABLE` message plus the manual-entry fallback path (US-009) is reachable |
| — | I | **`T-AI-036`** | *(R2)* LLM unavailable + OCR ok → degraded mode, batch completes, banner shown, full-update removals withheld |
| — | I | **`T-AI-039`** | *(R2)* A title the model omitted but OCR saw is recovered as an `ocr-only` orphan candidate — REQ-012 enforced against the model |
| — | I | **`T-AI-032`** | *(R2)* Fabrication rate ≤ 0.05; every unsupported inference is flagged `inferred-unverified` |
| — | C | **`T-AI-041`** | *(R2)* An `inferred-unverified` candidate renders its **tile thumbnail** beside the proposed title |
| — | I | **`T-AI-040`** | *(R2)* `finish_reason: 'length'` → `EXTRACTOR_ERROR`, never a partial tile list |
| — | S/I | **`T-AI-011b`** | *(R2)* The committed JSON Schema has no service/platform property; a response containing one is rejected |
| — | I | **`T-AI-044`** | *(R2)* A prompt-injection fixture still parses to the schema; no field escapes; no extracted text is ever interpreted |

### US-007 — Match each candidate to a TMDB work and store its metadata
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | U/I | `T-TMDB-010` | Matching queries TMDB with the normalised text; deterministic scoring |
| AC-2 | I | `T-TMDB-011` | Confirmed match stores exactly type, year, runtime, genres, poster path, tmdbId, fetchedAt |
| AC-3 | C | `T-UX-062` | Review card shows poster, name, year, type and the raw extracted text |
| AC-4 | U/C | `T-TMDB-012` | Ambiguous match returns top-5 alternatives inline, flagged `ambiguous` |
| AC-5 | I | **`T-AI-017`** | TMDB 503 → all candidates unmatched, batch still reaches `in-review`, banner shown, no failure |
| AC-6 | U | `T-TMDB-013` | Zod rejects any TMDB field outside the stored allow-list; nothing extra is persisted |

### US-008 — Unmatched candidates are surfaced, never silently discarded
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I/C | `T-UX-063` | Unmatched candidates render in their own section with raw text |
| AC-2 | I | `T-UNM-010` | All three actions available: search-and-match, keep as unidentified, discard |
| AC-3 | I | `T-UNM-011` | An unmatched candidate in full-update does not cause any removal proposal |
| AC-4 | I | `T-UNM-012` | Closing with unresolved unmatched keeps them as unmatched Titles; `unresolvedKept` counted |

### US-009 — Classify each matched candidate as new or already present
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | U | `T-CLS-010` | Classification is computed against active listings of the batch's service |
| AC-2 | U | `T-CLS-011` | A work active on the *other* service only classifies as `new` for this service |
| AC-3 | U | `T-CLS-012` | A `removed` listing for this service classifies as `new` (a new row will be created — L1) |
| AC-4 | I | `T-SUP-002` | A suppressed work is gated before classification and never appears |
| AC-5 | I | `T-CLS-013` | Matching failure → unmatched section, never a wrong classification |

### US-010 — Refresh TMDB metadata lazily, on access
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-TMDB-004` | Metadata older than 183 days refreshes on display; younger does not |
| AC-2 | I | `T-TMDB-014` | Refresh replaces only TMDB descriptive fields; listings, dates, ids untouched |
| AC-3 | I | `T-TMDB-015` | TMDB 404 on refresh → stored metadata retained, `metadataStale: true`, no deletion |
| AC-4 | I | `T-TMDB-016` | TMDB unreachable → view renders with stored data and the stale flag; 200, not 5xx |
| AC-5 | S | **`T-CI-005`** | No timer, cron, `setInterval`, queue trigger or scheduled workflow touches list state |

### US-011 — Display TMDB attribution wherever TMDB data appears
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | E | `T-ATTR-002` | Disclaimer visible on all nine routes without interaction |
| AC-2 | U/I | `T-ATTR-001` | Constant, API value and rendered DOM text are byte-equal to the required wording |
| AC-3 | E | `T-ATTR-004` | At 320 px the attribution is still fully visible and not truncated |
| AC-4 | C | `T-ATTR-005` | With the logo asset failing, the disclaimer text still renders |
| AC-5 | S | **`T-ATTR-003`** | The logo renders with a non-zero box on all nine routes; a build without it fails |

### US-012 — Review and confirm additions before anything is added
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-REV-010` | New-to-this-service candidates appear in `additions` |
| AC-2 | I | `T-REV-011` | Confirm / correct / discard all supported per item |
| AC-3 | I | **`T-REV-012`** | Close applies only `confirmed`/`corrected`; `pending` blocks with 409 `PENDING_ADDITIONS` |
| AC-4 | C | `T-REV-013` | Addition card shows poster, name, year, type |
| AC-5 | I | `T-REV-014` | Correcting to a work with an existing active listing → 409 `DUPLICATE_WORK_IDENTITY` unless confirmed |
| AC-6 | C | `T-UX-061` | Zero additions renders the explicit empty state, not a blank panel |
| AC-7 | I | `T-BATCH-006` | Abandoning the review writes nothing |

### US-013 — In full-update mode, show already-known titles too
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-REV-015` | Full-update review contains every extracted title, new and known |
| AC-2 | C | `T-REV-016` | "Already on your list" items are read-only, not actionable as additions |
| AC-3 | I | **`T-UI-006`** | Append-only review omits the section entirely (`omitted: true`, items empty) |
| AC-4 | I | `T-REV-017` | A known title missed by extraction appears in removals, **and** the known-titles section shows the rest — the discrepancy is visible |
| AC-5 | E | `T-PERF-002` | A 500-candidate review renders and stays interactive (virtualised); no horizontal scroll at 320 px |
| AC-6 | I/C | **`T-REV-006`** | An implementation that hides known items in full-update fails: the section and its count must be present |

### US-014 — Propose removals only from a closed full-update batch, for that service only
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-REM-010` | Full-update: absent active listings of that service are proposed for removal |
| AC-2 | I | `T-REM-011` | Append-only: no removals section exists in the response or the DOM |
| AC-3 | I | **`T-REM-012`** | A full-update for Netflix never proposes, alters or deletes a Max listing |
| AC-4 | I | `T-REM-013` | An already-`removed` listing is not proposed again |
| AC-5 | I | `T-SUP-004` | A suppressed work is excluded from the removal section (REQ-073) |
| AC-6 | I | **`T-AI-021`/`T-AI-022`** | Zero-candidate full-update (driven by **`blank-no-content-01.png`**, *not* the artwork fixture): removals withheld, `provenance.removed` empty, re-extract/discard offered. **`T-AI-036`** additionally covers the degraded-extraction case. |

### US-015 — Removals ticked by default, rescuable individually, confirmed as one group
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I/C | **`T-UI-007`** | Every removal arrives `ticked: true` and renders checked on first paint |
| AC-2 | I | `T-REM-014` | Unticking one rescues exactly that listing; others unaffected |
| AC-3 | I/C | **`T-UI-008`** | One group confirmation applies all ticked; no per-row remove control exists in the DOM |
| AC-4 | I | **`T-REV-005`** | Closing without `confirmRemovals` → 409 `REMOVALS_NOT_CONFIRMED`; nothing written |
| AC-5 | I | `T-REV-007` | Unticking all → zero-member group recorded; close succeeds; nothing removed |
| AC-6 | C | `T-UX-064` | The removals count is visible without expanding the section |
| AC-7 | I | `T-REM-015` | Injected mid-apply failure → group left unapplied in full; error states nothing changed |

### US-016 — Removal marks one service's listing removed and nothing else
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-REM-016` | Only the listing for service S transitions to `removed` |
| AC-2 | I | `T-REM-017` | A two-badge title keeps its other badge and stays in the list |
| AC-3 | U/I | `T-REM-018` | Last active listing removed → `title.state = 'removed'`, row hidden, record retained |
| AC-4 | I | **`T-INV-012`** | No hard delete occurs; `removed` is a state, not a deletion |
| AC-5 | I | `T-REM-019` | Append-only absence changes nothing |
| AC-6 | S/I | **`T-REM-012`** | No code path removes listings for a service other than the batch's; asserted structurally and behaviourally |

### US-017 — Undo a confirmed removal group
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | C | `T-UX-065` | The undo affordance is offered immediately after confirmation |
| AC-2 | I | `T-GRP-010` | Undo returns every listing to `active` with its **original** `dateAdded` |
| AC-3 | I | `T-GRP-011` | The group remains undoable later; it is not time-limited |
| AC-4 | I | `T-GRP-012` | A since-suppressed work is held back, named in `heldBack[]`, with an un-suppress link |
| AC-5 | I | `T-GRP-013` | A second undo → 409 `GROUP_ALREADY_REVERSED` |
| AC-6 | I | `T-GRP-014` | Injected failure → group left wholly unapplied; `{ applied: false }` |

### US-018 — One row per work, one badge per service holding it
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-LIST-010` | Exactly one row per canonical work |
| AC-2 | I | `T-LIST-011` | Two active listings → two badges on one row |
| AC-3 | I | `T-LIST-012` | A removed listing's badge is absent |
| AC-4 | I | `T-LIST-013` | A work with no active listings has no row |
| AC-5 | C | `T-UI-010` | The row shows poster, name, type, year, date-added label and badges |
| AC-6 | I | `T-LIST-019` | The same work confirmed in two batches for two services yields one row, two badges |
| AC-7 | C | `T-UX-012`/`T-UX-014` | Two distinct empty states: never-uploaded vs everything-removed |
| AC-8 | C | `T-UX-018` | Load failure renders an error that states nothing has changed, with Retry |

### US-019 — Filter by service, type and genre
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-LIST-020` | Service filter returns only titles with an active listing on that service |
| AC-2 | I | `T-LIST-021` | Type filter |
| AC-3 | I | `T-LIST-022` | Genre filter |
| AC-4 | I | `T-LIST-023` | AND across dimensions, OR within a dimension |
| AC-5 | C | `T-UX-013` | Zero-match filter state is visually and textually distinct from the empty list |
| AC-6 | I | **`T-LIST-024`** | A title with `genres: []` is excluded from genre-filtered results and included when unfiltered; never defaulted |
| AC-7 | E | `T-A11Y-001` | Filters fully operable at 320 px with no horizontal scroll |

### US-020 — Sort by date added, using the earliest listing date
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | U | **`T-LIST-014`** | `sortDateAdded` = earliest `dateAdded` across non-removed listings |
| AC-2 | I | `T-LIST-025` | Default order is `sortDateAdded` descending |
| AC-3 | U/I | **`T-LIST-016`** | Ties broken by `title.id` ascending; identical sequence across repeated renders |
| AC-4 | U | `T-LIST-014` | Adding a later listing does not move the row |
| AC-5 | U | `T-LIST-015` | Removing the earliest listing recomputes the value and may move the row |
| AC-6 | I/C | **`T-LIST-026`/`T-UI-024`** | Reversing direction re-orders deterministically, tie-breaker unchanged (`T-LIST-026`); the sort control itself renders on the combined list, defaults to "Newest first", and toggling it drives the reversal (`T-UI-024` — the affordance-existence check `T-LIST-026` alone cannot make) |
| AC-7 | U/I | **`T-LIST-017`/`T-LIST-027`** | `sortDateAdded: null` sorts last and never crashes the comparator (`T-LIST-017`); nulls stay last under **both** `dir=desc` and `dir=asc` (`T-LIST-027`) |

### US-021 — Date added is recorded once, never overwritten, labelled honestly
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-DATE-010` | Created listing's `dateAdded` = the batch's capture date |
| AC-2 | I | `T-DATE-011` | Seeing the same listing in a later batch does not change `dateAdded` |
| AC-3 | C | **`T-LIST-018`** | Every rendered date label contains "to nextup"; no bare "Added" label exists |
| AC-4 | I | `T-DATE-012` | A first-run backlog import gives every listing the same capture date; no screenshot date is read |
| AC-5 | I | `T-DATE-013` | A re-created work after removal carries today's date, not the original |
| AC-6 | S | **`T-INV-006`** | No assignment to `.dateAdded` outside `createListing` |

### US-022 — Show when each service's slice was last updated
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-FRESH-010` | Per-service last-completed date is displayed |
| AC-3 | I/C | `T-FRESH-012` | Never-updated renders "never updated", not an error |
| AC-4 | I | `T-FRESH-013` | Abandoned/failed batches never update `serviceState` |
| AC-5 | C | `T-FRESH-014` | If the dates cannot be computed, the list still renders and the strip degrades visibly |

*(A46: US-022 AC-2 — the `LIST_STALENESS_DAYS` nudge, `T-FRESH-011` — is
deleted entirely; the list-staleness nudge concept is dropped from v1 and
REQ-040/ASM-038 are retired. The AC numbering intentionally skips AC-2 here —
AC-3/AC-4/AC-5 keep their original labels, this is not an error to "fix".)*

### US-023 — Soft delete forever: nothing is ever hard-deleted or purged
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-RET-010` | After removal, every document still exists and is readable |
| AC-2 | I | `T-LIST-013` | Hidden from the list, present in the removed view |
| AC-3 | S | **`T-INV-013`** | **(R4)** No **Azure SQL Agent job, no Elastic Job**, no delete trigger, no scheduled job, no `TRUNCATE` in any migration, and `DELETE` in exactly one module; Bicep + source-tree + migrations assertion (`specs/data-model.md` §16.7). *(R3 wording: "no `pg_cron`"; the analogue is the Agent/Elastic-Job prohibition.)* |
| AC-4 | M/§10 | `T-PERF-001` | Growth is accepted; scale-invariance of the removed view is the enforceable half |
| AC-5 | S | **`T-INV-012`** | No hard delete outside the creates-only-undo call site and pre-submit draft images |

### US-024 — Browse the removed view as a historical log
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-REM-020` | Each removed listing appears with service, date-added and date-removed |
| AC-2 | C | `T-UI-011` | `REMOVED_VIEW_SUBTITLE` is rendered — the historical-log framing is present |
| AC-3 | I | `T-REM-021` | Title-text search matches matched and unmatched rows |
| AC-4 | I | `T-REM-022` | Service filter matches on the removed listing's service |
| AC-5 | I | `T-PERF-001` | **(R4)** At 20,000 removed listings, SQL Server's actual execution plan (`SET STATISTICS PROFILE ON` / `sys.dm_exec_query_plan`) shows an index seek whose rows-read is bounded by the page size, and no scan on `service_listing` — see §11-R4.1 for the concrete T-SQL plan form (supersedes the R3 Postgres `EXPLAIN (ANALYZE, BUFFERS)` phrasing). Strictly stronger than the Rev 1 RU-ratio proxy |
| AC-6 | I/C | **`T-REM-006`** / `T-UI-009` | Three removals of one work → three rows, with ordinals; **never de-duplicated** |
| AC-7 | C | `T-UX-071` | Never-removed empty state, distinct from a no-search-results state |
| AC-8 | C | `T-UX-072` | Load failure renders an error, not an empty view |

### US-025 — Restore a title from the removed view, explicitly
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-RES-010` | Restore returns the listing to `active` |
| AC-2 | I | **`T-RES-011`** | `dateAdded` is the original, not today |
| AC-3 | I | `T-RES-012` | The restored title takes its sort position from the restored date |
| AC-4 | I | `T-RES-013` | Restoring a suppressed work → 409 `WORK_SUPPRESSED` with the un-suppress remedy |
| AC-5 | I | `T-RES-014` | Restoring where a newer active title exists → 409 `DUPLICATE_WORK_IDENTITY` unless confirmed |
| AC-6 | I | `T-RES-015` | Restore failure leaves the row removed and reports that nothing changed |

### US-026 — A reappearing title becomes a brand-new title dated today
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | **`T-REAP-010`** | Reappearance creates a **new** Title/listing dated today |
| AC-2 | I | `T-REAP-011` | The old removed row is untouched — every field byte-identical |
| AC-3 | I | `T-REAP-012` | Owner edits on the old row (corrected match) do **not** carry over |
| AC-4 | I | `T-REAP-013` | The removed view holds the old row; the new row is in the combined list |
| AC-5 | I | **`T-SUP-003`** | A suppressed work that reappears creates nothing at all |
| AC-6 | I | `T-REAP-014` | No code path restores the old row automatically; `restoreListing` has exactly two call sites |

### US-027 — Mark a title as not interested
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-SUP-010` | A `Suppression` keyed on `workIdentity` is created |
| AC-2 | I | `T-SUP-011` | The work appears in neither the combined list nor any review pass |
| AC-3 | I | `T-SUP-012` | Nothing is deleted; listings remain in their prior state |
| AC-4 | I | `T-SUP-013` | Re-suppressing is idempotent; `suppressedAt` unchanged; 200 |
| AC-5 | I | `T-SUP-014` | Suppressing a two-badge title hides the whole row (per work, not per service) |
| AC-6 | C | `T-UX-085` | Persistence failure → the row returns and an error is shown; never a silent optimistic hide |

### US-028 — Suppression keyed on canonical work identity, checked before creation
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | U/I | `T-SUP-001` | `suppression.id === 'supp:' + workIdentity`; no row id anywhere in the key |
| AC-2 | I | `T-SUP-002` | A suppressed work in a later batch is filtered **before** any record is created |
| AC-3 | I | **`T-SUP-003`** | suppress → remove → re-upload → **no** Title, **no** ServiceListing, absent from review |
| AC-4 | I | `T-SUP-015` | A suppressed work later matched to a *different* TMDB work is not suppressed under the new identity — the behaviour is asserted, and fix-match migration (`T-FIX-005`) is the remedy |
| AC-5 | I | `T-SUP-016` | Suppressing while the work is in an open batch's review removes it from that review |
| AC-6′ | I/C | **`T-SUP-006`** | An unmatched title **can** be suppressed (OQ-015 closed); the suppressed view shows the stability caveat. *Supersedes the PRD's AC-6 — see `specs/data-model.md` §2.3.1* |

### US-029 — Browse and undo suppressions
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-SUP-020` | Every active suppression is listed with a renderable snapshot |
| AC-2 | I | `T-SUP-021` | Un-suppress sets `active: false`; the document is **not** deleted |
| AC-3 | I | `T-SUP-022` | Un-suppressing a work with active listings makes the row visible again |
| AC-4 | I/C | **`T-SUP-023`** | Un-suppressing a work whose listings are all removed restores **nothing**; the copy says so |
| AC-5 | C | `T-UX-022` | An undo affordance is offered immediately after suppressing |
| AC-6 | C | `T-UX-085` | Load failure renders an error, not an empty list |

### US-030 — Fix a wrong match without removing the title
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-FIX-010` | The owner can search TMDB and re-point the title |
| AC-2 | I | **`T-FIX-002`** | Title id, every `listingId` and every `dateAdded` are byte-identical after fix-match |
| AC-3 | I | `T-FIX-003` | Sort position is unchanged |
| AC-4 | I | `T-FIX-004` | Target already active → 409 `DUPLICATE_WORK_IDENTITY` with a keep-both option |
| AC-5 | I | `T-FIX-006` | Target suppressed → 409 `TARGET_WORK_SUPPRESSED` with the un-suppress remedy |
| AC-6 | C | `T-UX-033` | TMDB unavailable → the dialog reports it; nothing is changed |
| — | I | **`T-FIX-005`** | *(SD-06, new)* An active suppression on the old identity migrates to the new one and the response reports it |

### US-031 — Every change records the batch that caused it
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-PROV-010` | Created records carry `createdByBatchId` and appear in `provenance.created` |
| AC-2 | I | `T-PROV-011` | Removed listings carry `removedByBatchId` + `groupId` and appear in `provenance.removed` |
| AC-3 | I | `T-PROV-012` | In-review corrections appear in `provenance.modified` with the before-value |
| AC-4 | C | `T-UX-093` | The batch detail view shows created/modified/removed in full |
| AC-5 | I | `T-PROV-013` | Out-of-batch changes carry `batchId: null` and appear in no provenance array |
| AC-6 | I | **`T-PROV-001`** | If provenance cannot be written, the close fails atomically; nothing is persisted |

### US-032 — Undo an entire batch when it only created things
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | U/I | `T-UNDO-001` | `isCreatesOnly` is a pure predicate over provenance; undo is offered only when true |
| AC-2 | I | **`T-UNDO-002`** | After undo the list equals its pre-batch state exactly; `serviceState` reverts to the previous applied batch |
| AC-3 | I | `T-UNDO-003` | `status: 'undone'`; a second undo → 409 `BATCH_ALREADY_UNDONE` |
| AC-4 | I | **`T-UNDO-004`** | A creates-only batch whose title was since suppressed or fix-matched is **refused** and enumerated |
| AC-5 | I | `T-UNDO-008` | A batch that created nothing undoes successfully as a no-op |
| AC-6 | I | `T-UNDO-009` | Injected failure mid-undo → batch left applied, nothing partially reversed |

### US-033 — Refuse a mixed-changeset undo and enumerate what it touched
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-UNDO-010` | Any modify/remove in provenance → 409 `BATCH_NOT_CREATES_ONLY` |
| AC-2 | I | **`T-UNDO-006`** | Every created, modified and removed title is enumerated — asserted against a 400-title fixture |
| AC-3 | I | `T-UNDO-011` | Each entry carries a working remedy href of the correct kind |
| AC-4 | C | `T-UX-097` | Rendered as a full-screen repair panel using `UNDO_REFUSAL_*` copy constants, not an error toast (framing asserted via the constants — see §10) |
| AC-5 | I | **`T-UNDO-006`** | `truncated: false` always; all 400 ids present in one response |
| AC-6 | I | `T-UNDO-012` | A since-removed or since-suppressed title still appears, annotated with `currentState` |
| AC-7 | I | `T-UNDO-007` | Missing provenance → `reason: 'provenance-unavailable'`, refusal still actionable |

### US-034 — Re-extract a batch's images within the retention window
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | `T-REX-010` | Re-extract available while images are retained |
| AC-2 | I | `T-REX-011` | Results enter only through the review pass; nothing written directly |
| AC-3 | I | `T-REX-012` | A **new** batch with `derivedFromBatchId`, same service and mode; the original is unmodified |
| AC-4 | I | `T-REX-013` | Purged images → 410 `IMAGES_PURGED` with the retention explanation |
| AC-5 | I | `T-REX-014` | Re-extraction failure leaves the original batch and the list untouched |
| — | I | `T-SUP-017` | *(US-034 AC-6 in PRD numbering)* The suppression gate applies to re-extraction |

### US-035 — Retain screenshots for 30 days, then purge them automatically
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | I | **`T-IMG-004`** | At `retainUntil`, bytes are unavailable to the application (410) |
| AC-2 | I | `T-RET-011` | After purge, `uploadedImage`, candidates, batch, titles and listings all still exist |
| AC-3 | I | `T-RET-012` | Purge changes no list state; no application code participates |
| AC-4 | I | **`T-IMG-002`** | Bytes are only ever served authenticated, with the mandated headers |
| AC-5 | I | `T-RET-013` | An open batch whose images reach 30 days: purge proceeds; the batch reports `IMAGES_PURGED` rather than erroring |
| AC-6 | I | **`T-IMG-005`** | A missing blob is 410, never 500 |
| AC-7 | S | **`T-INV-008`** | The **two** 30-ish-day constants (`IMAGE_RETENTION_DAYS = 30`, `TMDB_METADATA_MAX_AGE_DAYS = 183`) are declared separately, as two exported declarations, and never share a call site. **↳ R9 (`A46`): was *three* — `LIST_STALENESS_DAYS` is retired with the staleness nudge, so a third constant must NOT be reintroduced to satisfy this row.** ~~The three 30-ish-day constants are declared separately and never share a call site~~ |

### US-036 — Nothing but the owner changes user-visible list state
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | S/I | `T-MUT-001` | Every mutating route maps to an entry in the REQ-041 enumeration, asserted from a committed list; a new mutating route fails until added |
| AC-2 | S | **`T-CI-005`** | Exactly two non-owner processes exist: lazy TMDB refresh and the blob lifecycle rule. No timer/cron/worker |
| AC-3 | S | `T-MUT-001` | An operation outside the enumeration cannot be registered |
| AC-4 | I | `T-MUT-002` | No auto-confirm, auto-restore or auto-suppress path exists: `restoreListing`, `createTitle` and `suppress` have only their sanctioned call sites |
| AC-5 | S | `T-CI-005` | No scheduled job, webhook, timer or background worker touches list state |
| AC-6 | S | **`T-SEC-009`** | No telemetry/analytics package or third-party script anywhere. **(R5 clarification, so nobody resolves this collision by deleting the sentinel:** the `image.decode.begin`/`end` events (`api.md` §9.1) are **stdout debug logs, not telemetry** — no SDK, no third party, no product instrumentation, no user content. `T-SEC-009` greps for *packages and scripts*, not for log lines, and `T-IMG-021` requires the sentinel. Both pass together.**)** |
| — | S | **`T-SEC-003`** | *(US-036 AC-4 in PRD numbering, storage half)* No blob URL or SAS in any response |

### US-037 — Work on a phone first and a laptop second
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | E | **`T-A11Y-001`** | No horizontal scroll on any of the nine routes at 320×640 |
| AC-2 | E | `T-A11Y-002` | Full journey usable at 1024 px; no function is desktop-only |
| AC-3 | E | `T-A11Y-013` | A long removals list at 320 px stays operable; checkboxes ≥ 44 px |
| AC-4 | E | `T-A11Y-014` | The US-033 refusal enumeration is readable and actionable at 320 px |
| AC-5 | E | `T-A11Y-015` | At 280 px the layout degrades gracefully — content reflows, nothing is unreachable |

### US-038 — Never hold streaming credentials or talk to a streaming service
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | S | **`T-SEC-001`** | No credential field, cookie jar or secret named for a streaming service in code, schema or config |
| AC-2 | I | **`T-SEC-031`** | Outbound calls during the full journey are only to the vision endpoint and TMDB; a request to any streaming domain fails the test |
| AC-3 | C | `T-UI-012` | Service deep links are plain `target="_blank" rel="noopener noreferrer"` anchors, carrying no credential or token |
| AC-4 | S | `T-SEC-001` | No automation dependency (`puppeteer`, `playwright` in runtime deps, HTTP client targeting a service domain) is present |
| AC-5 | I | `T-SEC-031` | Any server-side call to a streaming-service domain fails the suite |

### US-039 — Be buildable, verifiable and cheap
| AC | L | Test | Assertion |
|---|---|---|---|
| AC-1 | M/§10 | `T-META-001` | Machine-checkable half: every AC in the PRD appears in this mapping and every referenced test exists |
| AC-2 | S | **`T-META-002`** | The nine PRD-mandated invariants (§6 rows 1–5 plus US-016 AC-6, US-021 AC-6, US-026 AC-6, US-038 AC-5) each resolve to an existing, passing test |
| AC-3 | M/§10 | — | Technology mainstream-ness: settled in ADR-0004 against NFR-004; not machine-verifiable |
| AC-4 | M/§10 | `T-INFRA-005` **(REWRITTEN R3, RE-PINNED R4, PAIRED R5)** | **The "every SKU is free" assertion is deleted — NFR-012 is no longer a near-zero-cost MUST (A41/CC-002).** It is replaced by a **SKU pinning** test. **R4 pins (owner selected Variant A at A40):** the Bicep declares exactly **`Azure SQL Database Basic` (5 DTU, 2 GB — not Standard/GP, not zone-redundant, no failover group), the staging DB as `GP_S` serverless with auto-pause**, **`ACA Consumption` with `minReplicas=1, maxReplicas=2` and `0.25 vCPU / 0.5 GiB`**, **registry = `ghcr.io` (no ACR resource of any tier)**, `Vision F0`, and **Azure OpenAI `Standard` — never `ProvisionedManaged`**. **R5/`A43` — the pin is now a PAIR, and this is an instruction, not a note: `T-INFRA-005` asserts `cpu = json('0.25')` **AND** `memory = '0.5Gi'` **AND** the container env var `NEXTUP_MAX_DECODE_PIXELS = '25000000'` in `infra/aca.bicep`, and it FAILS if either side moves without the other** — including the up-sized pair `0.5` / `1.0Gi` / `50000000`, which it accepts as a matched set. A raised guard on a small container is strictly worse than no up-size at all, and the runbook changes both in one command (`runbooks/scale-up-memory.md` §2/§4, ADR-0003 R4). **R5 also pins the three `A43-M5` alert rules** (`nextup-prod-replica-restart`, `nextup-prod-memory-pressure`, `nextup-prod-decode-abandoned`) as declared resources — the reactive strategy has no trigger without them. Any change requires a visible, reviewable Bicep diff. **NFR-012a** exempts the extraction *unit price*, not the no-fixed-commitment rule. *(R3 pinned PostgreSQL B1ms + ACR Basic + 0.5/1.0 — superseded.)* The test now protects against BOTH silent overspend and silent under-provisioning |
| AC-5 | M/§10 | — | Extraction cost assessment: a first-sprint verification task (`TASK-010`, architecture §Handover 7) |
| AC-6 | S | `T-META-003` | Any decision claimed as verifiable resolves to a test id present in this file; unverifiable ones must appear in §10 |

---

## 9A. Structural tests not owned by a single acceptance criterion

A small number of tests guard structure that **several** acceptance criteria
silently depend on. They are listed here rather than under a user story
because attaching them to one arbitrary AC would misrepresent what fails when
they fail — and because `T-META-003` requires every id referenced by
`docs/backlog.md` to resolve to a definition in this file.

| Test | Task | Assertion |
|---|---|---|
| **`T-UI-023`** *(a–g)* | `TASK-025` | **The app shell and the nine-route table** (`specs/ui.md` §1). `ROUTES` holds exactly the nine specified paths (`a`); each renders its own distinct screen rather than falling through to the catch-all (`b`); `<header>`, `<nav>`, `<main>` and `<footer>` each appear **exactly once** on every route, per `ui.md` §10.2 (`c`); an unknown path renders `NotFoundPage` **with a working link back to `/`**, which the screen index names as that route's whole purpose (`d`); the three overlapping `/batches…` patterns do not shadow one another (`e`); the nav exposes the six top-level destinations (`f`); and the global footer landmark exists on every route, ready for the TMDB attribution `TASK-026` mounts into it (`g`). |
| **`T-LICENSE-001`** *(a–l)* | `TASK-153` | **The MIT licence and its retained-notice obligations** (`specs/security.md` §9, ADR-0008 §"Licence obligation"). `LICENSE` is MIT with a copyright line and both operative clauses (`a`); `README`, `NOTICE` and `LICENSE` agree (`b`); **`THIRD-PARTY-NOTICES.md` matches the installed production tree byte for byte** (`c` — the drift gate); every production dependency has a resolvable licence (`d`); **`LGPL-3.0` classifies as WEAK copyleft, never strong** (`e`); the full HEIC chain clears once `libheif-js` is listed (`f`); an LGPL dependency **missing** from the notices is caught (`g`); a **strong-copyleft** dependency is refused outright and listing it does not clear it (`h`); an unlicensed dependency cannot be cleared (`i`); the render is deterministic (`j`); and `NOTICE` records the approved obligation **and its decode-only scope** (`k`). `l` guards the one interaction that can deadlock CI — see below. |
| **`T-STATUS-001`** *(a–q)* | `TASK-167` | **The task status ledger and its gate** (`docs/backlog.md` §1.2). The backlog parses into tasks with a dependency graph, merging the 59 rows that list one task in several tables (`a`); the committed ledger and backlog agree and every `done` claim holds (`b`); a backlog task missing from the ledger (`c`) and a ledger row for a task that does not exist (`d`) are both caught; a status outside the closed set is caught (`e`); **`done` is refused when a test the task names is absent from the suite** (`f`) and accepted when it is present (`g`); `done` without evidence is caught (`h`); a task `done` before its dependency is caught (`i`) unless an explicit `ahead-of:TASK-nnn` token names it (`j`), and that token is itself rejected when it names a non-dependency (`k`) or when the named task has since landed (`l`); the ready-set excludes blocked tasks (`m`); the report is deterministic and matches the committed `docs/status.md` (`n`); the ledger covers every task (`o`); **a test id mentioned only in a comment or a fixture does not count as delivered** (`p`); and a base id is satisfied by its lettered variants but not the reverse (`q`). |

**Why the route set gets a test of its own.** Four later suites — `T-ATTR-002`,
`T-ATTR-003`, `T-A11Y-001` and `T-A11Y-012` — are each specified as running
across **"all nine routes"**, and each asserts something *across* the route set
rather than *about* it. They enumerate `ROUTES`, so a route missing from that
table does not fail them: they keep passing while no longer covering the
missing screen. `T-UI-023a` is the only place the count and the paths
themselves are the subject, which is what makes the other four honest.
`T-UI-023g` exists for the same reason at one remove — `ui.md` §8 warns that
attribution failure is **invisible from inside the product**, so the footer it
must live in is asserted from the moment the shell ships, not from the moment
the copy arrives.

**Why the licence gate is tested against synthetic packages.** The one
obligation this project knowingly carries — `libheif-js`, LGPL-3.0 — is
installed by **`TASK-147`**, which lands in M3. A gate written only against the
tree as it stands today would pass because there is no copyleft dependency in
it, and would first be exercised months later, at the exact point nobody is
thinking about licensing. `T-LICENSE-001e`–`i` therefore drive the classifier
and the checker with constructed package lists, including the real ADR-0008
chain, so the LGPL path is proven **before** the dependency arrives.

`T-LICENSE-001e` is the load-bearing one: **`"LGPL-3.0"` contains the substring
`"GPL-"`**, so a naive strong-copyleft match rejects `libheif-js` — removing
HEIC ingest entirely (`ASM-058`) on what reads like sound licence-compliance
reasoning. The reverse error is worse: treating all copyleft as acceptable lets
a GPL-3.0 package relicense this MIT repository. The two must be distinguished,
so the distinction is asserted directly.

**Why `T-LICENSE-001l` asserts a `.prettierignore` line.** `THIRD-PARTY-NOTICES.md`
is generated, and the drift gate compares it against a fresh render **byte for
byte**. Prettier reflows generated Markdown, so while the file sits inside
Prettier's scope the two gates cannot both be satisfied: `format:check` rewrites
it, `check:licences --check` then reports drift, and regenerating undoes the
formatting. This was **observed, not predicted** — both failed in turn during
`TASK-153`. It is worth a test because the obvious way out of the deadlock is to
loosen the byte comparison into a fuzzy one, and the byte comparison is the only
thing that gives the drift gate any teeth. The ignore line is the fix, so the
ignore line is what is asserted.

**Why status is asserted at all, and why not from `git log`.** `docs/backlog.md`
is the work order but records no status, so "what is done?" was answerable only
from memory. Deriving it from git history was tried and measured on this
repository, and it was wrong three separate ways: tasks named in a commit *body*
were counted as delivered (5 of 21, a 24% false-done rate); `c3febc3` names
`TASK-017` and `TASK-047` in its *subject* while only editing their spec text,
which subject-only parsing does not fix; and `TASK-013/014/015: …` yields only
`TASK-013` to a scan while `TASK-001` landed inside the initial commit with no
id at all, so work that IS done goes unseen. Git history is evidence, not truth.
The claim is therefore written down, and `T-STATUS-001` is the attempt to
falsify it.

**`T-STATUS-001p` is the one that gives the gate teeth, and it was found by
mutation rather than by reading.** The first implementation scanned whole spec
files for the test-id pattern, so marking `TASK-017` done passed cleanly: of the
two ids it names, `T-SEC-021` appears only inside a *comment* and `T-INV-001`
only inside a *string literal* in `tools/eslint-rules/test-id-naming.spec.ts`,
where sample test declarations serve as fixtures for the naming rule. 43 of 186
apparently-defined ids were mentions of this kind. Ids are now read only from
declarations that begin their own line — which is what separates a real test
from a fixture, since a fixture is always preceded on its line by the opening
quote of the string containing it.

**`T-STATUS-001q` is the counterweight.** Tightening `p` alone reported nine of
the fifteen delivered tasks as unfinished, because the backlog names an
acceptance criterion (`T-UI-023`) while the suite splits it into lettered cases
(`T-UI-023a`…`g`) exactly as `T-META-004` permits. A base id is therefore
satisfied by any of its variants — but not the reverse, so an id the spec pins to
a specific case must be present as that case. The suffix must be a *letter*: an
earlier length-only check made `T-UI-023` look like a variant of `T-UI-02`, which
would have let a mistyped trailing digit resolve to a different criterion.


---

## 10. Acceptance criteria that are NOT fully machine-verifiable

Named explicitly, as required, rather than quietly skipped. **Twelve of 241**,
plus the two `(R2)` rows and the `(R5)` hard-OOM row below, **plus the `(A45)`
iOS-paste row added at the end of this section.**

✅ **(R8) COUNT RECONCILED BY THE ORCHESTRATOR — `241`.** R5 and the A45 pass
both correctly **refused to guess** while the PRD was being revised in
parallel; that was the right call and it is why this note existed. The PRD's
six new `A45` criteria (US-004 `AC-12`…`AC-17`) landed and were
counted mechanically: **236 + 6 = 242**, cross-checked against 243 raw rows
minus the one superseded `AC-6′`. At `A46`, `US-022 AC-2` (the
`LIST_STALENESS_DAYS` nudge) was deleted along with the concept it tested,
taking the count to **242 − 1 = 241**. Updated in all four places (front-matter
`sourceOfTruth`, §2, this sentence, §12). The convention is in the banner at
the top of this document. `T-META-001` — every AC has a mapped test — is what
actually protects this.

| AC | Why not | Compensating check |
|---|---|---|
| US-001 AC-5 | The IdP being unreachable is a platform condition we cannot induce in CI | `T-UX-019` asserts the client-side state; `T-SMOKE-001` asserts the deployed behaviour for the reachable case |
| US-002 AC-4 | Token tampering is validated by Easy Auth, outside our process | `T-SMOKE-003` (forged principal header refused against the deployed revision) |
| US-023 AC-4 | "Storage growth over years is accepted" is a stance, not a behaviour | `T-PERF-001` enforces the enforceable half — scale-invariant query cost |
| US-024 AC-5 | "Usability remains acceptable" has no threshold; **OQ-014 is open and no number may be invented** | `T-PERF-001` (query-plan scale-invariance) + `T-A11Y-013` (operability at 320 px) |
| US-033 AC-4 | "Tone and framing treat the enumeration as a feature" is editorial | `T-UX-097` asserts the refusal renders as a full-screen repair panel with per-title action buttons, from named copy constants (`UNDO_REFUSAL_TITLE`, `UNDO_REFUSAL_BODY`) — the structural proxy for the framing |
| US-035 AC-6 (purge-failure half) | Blob lifecycle retry is an Azure platform behaviour | `T-IMG-005` asserts the application treats a still-present or already-absent blob correctly either way |
| US-036 AC-3 | "Any operation not in the enumeration is forbidden" quantifies over operations that do not exist | `T-MUT-001` asserts the closed list of registered mutating routes matches the committed REQ-041 enumeration exactly |
| US-038 AC-4 | A feature *proposal* being refused is a process outcome | `T-SEC-001` asserts no automation dependency has entered the tree |
| US-039 AC-1 | "The agent needs no clarification" can only be observed by running the build | `T-META-001` enforces the mapping; the real signal is the first implementation sprint |
| US-039 AC-3 | "Mainstream and well-represented" is a judgement | Settled in ADR-0004 against NFR-004; revisited only by a new ADR |
| US-039 AC-5 | Extraction cost cannot be measured without live usage | First-sprint verification task (`TASK-010`); `T-INFRA-005` pins the SKUs so a commitment-shaped change requires a visible Bicep diff; per-batch `estimatedCostUsd` and the §4A **L7** cost ceiling catch prompt/token regressions |
| **(R2) Stage-1 extraction quality** | A sampled model's output cannot be asserted for equality, and its real-world quality cannot be measured offline | **§4A**, a manual band-asserted live suite over 3 runs, whose report is committed to `docs/evaluation/`. CI still enforces determinism (1.0) and every quality gate over **recorded** responses. |
| **(R2) Fabrication in the wild** | A fabricated title that happens to resemble a real OCR line will not be flagged | Three independent, layered mitigations rather than one test: the OCR cross-check (`T-AI-032`/`T-AI-039`), deterministic TMDB matching as a plausibility filter, and the mandatory human review pass with the tile thumbnail shown (`T-AI-041`). Residual risk **RSK-028**, accepted and named in ADR-0001 R2.7. |

**Every other one of the 241 acceptance criteria maps to at least one named,
automated test.** *(R6: the number `236` is reconciled — see the
banner at the top of this document.** It was deliberately not changed in this
revision because the PRD is being revised in parallel; `T-META-001` (every AC
has a mapped test) is the gate that actually protects this, not the number.

**(R5) One more thing that is honestly not machine-verifiable in CI:**

| What | Why not | Compensating check |
|---|---|---|
| **The hard OOM-kill path (P2, `api.md` §5.2.2)** — a kernel/cgroup kill of the process | You cannot assert application behaviour in a process that no longer exists, and reproducing a cgroup OOM kill inside a GitHub Actions runner would be a flaky test in the one suite `NFR-003` says must never be flaky | Three layers instead: **(1)** `T-IMG-018` proves the *structural* property that makes P2 survivable — nothing is committed before review-close, so there is nothing to half-apply; **(2)** `T-IMG-021` proves the `begin`-without-`end` sentinel that *identifies* the killed image is emitted in the right place; **(3)** `T-INFRA-005` proves the `nextup-prod-replica-restart` and `nextup-prod-decode-abandoned` alert rules exist to observe it. The path itself is exercised **manually**, once, during the `TASK-010` verification sprint |

**(A45) The iOS Safari clipboard-paste interaction is honestly not verifiable
in CI either:**

| What | Why not | Compensating check |
|---|---|---|
| **The iOS Safari `navigator.clipboard.read()` paste, end to end** (`api.md` §5.3.2 primitive 2, `ui.md` §3.2b) — tapping **"Paste screenshot"**, WebKit presenting its **native single-option callout bar**, and the owner tapping *Paste* | **The callout is native platform UI drawn outside the page.** No WebDriver, Playwright or `webkit`-channel automation can see or tap it, and Playwright's bundled WebKit is **not** iOS Safari — passing there would prove nothing about the device. The permission is granted **per invocation and never remembered** (evidence Q1e caveat 1), so there is no state to pre-seed, and the promise is rejected by any stray tap or backgrounding (caveat 2), which is exactly what an automated harness does. | Four layers, three of them automated: **(1)** `T-PASTE-002` asserts the **contract** we control — `clipboard.read()` is called synchronously inside the click handler, and its resolved `ClipboardItem` is posted with `ingestSource: 'paste'` — using a stubbed `navigator.clipboard`; **(2)** `T-PASTE-008` asserts **every** rejection path renders a message and re-offers the button with **no surviving spinner**, which is the failure mode a real device would produce; **(3)** `T-PASTE-009` asserts the button is **not rendered** where the API is absent, so the unsupported case degrades to the upload path; **(4)** a **manual, single-item device check** during the `TASK-010` verification sprint, recorded in `docs/evaluation/` like the §4A live suite: *on a real iPhone over HTTPS — screenshot → Copy → tap "Paste screenshot" → tap the system callout's "Paste" → the image appears in the batch; then repeat and deliberately tap elsewhere mid-callout, and confirm the UI re-offers rather than hangs.* **If only one manual check is ever run, run the second half** — the abandoned-promise path is the one that produces a hung screen. |
| **The desktop `paste` path is NOT on this list** | Ctrl/Cmd+V into a `document` listener needs no permission and no native UI | Fully automated: `T-PASTE-001` (synthetic `paste` event with `clipboardData.files`), `T-PASTE-003`, `T-PASTE-004` |

---

## 11. Naming and layout

```
packages/domain/test/          identity.spec.ts, derive.spec.ts, reconcile.spec.ts, schemas.spec.ts,
                               pixelGuard.spec.ts        # R5 — T-IMG-017 (unit half), T-IMG-022
                               pastedFileName.spec.ts    # A45 — T-PASTE-005 (unit half)
apps/api/test/unit/            cleanup.spec.ts, matcher.spec.ts, undo.spec.ts, principal.spec.ts,
                               readDimensions.spec.ts,   # R5 — header-only parse, all 3 formats
                               decodeErrors.spec.ts      # R5 — isDecodeOom() classification (T-IMG-019 unit half)
apps/api/test/integration/     batches.spec.ts, titles.spec.ts, removed.spec.ts, suppressions.spec.ts,
                               images.spec.ts, security.spec.ts, provenance.spec.ts, retention.spec.ts,
                               ingestGuard.spec.ts,      # R5 — T-IMG-017/018/019/020/021
                               ingestSources.spec.ts     # A45 — T-PASTE-005/006/007, T-IMG-023, T-RET-014
apps/web/test/                 listPage.spec.tsx, reviewPage.spec.tsx, removedPage.spec.tsx,
                               attribution.spec.tsx, states.spec.tsx,
                               appShell.spec.tsx,        # TASK-025 — T-UI-023a…g (§9A)
                               pasteCapture.spec.tsx     # A45 — T-PASTE-001/002/003/004/008/009, T-UI-014
tests/e2e/                     journey.spec.ts, auth.spec.ts, a11y.spec.ts, viewport.spec.ts,
                               uploadPathRegression.spec.ts  # A45 — T-PASTE-010 (add-not-swap guard)
tests/extraction/              golden.spec.ts, crossCheck.spec.ts, providerContract.spec.ts,
                               goldenLive.spec.ts   # MANUAL ONLY — excluded from `npm run test`
tests/infra/                   bicep.spec.ts, ttl.spec.ts, rbac.spec.ts
tests/smoke/                   deployed.spec.ts
tests/meta/                    acMapping.spec.ts
```

Every test declares its id in its title so a CI failure names the AC directly:

```ts
it('T-SUP-003 · US-028 AC-3 · a suppressed work that reappears creates nothing', async () => { … });
```

`T-META-004` asserts every `it(...)` title in the suite starts with a `T-` id
and that ids are unique.

The id form is `T-<AREA>-<digits>` with an **optional lowercase suffix**:
`T-SUP-003`, `T-INV-013`, `T-AI-010b`. The suffix is how ONE acceptance
criterion carries several cases — `T-SEC-009a` the clean tree, `T-SEC-009b`
the caught violation — and suffixed variants count as **distinct** ids.
Without it, uniqueness would push every criterion into one giant test, which
is the opposite of "a CI failure names exactly one thing".

`T-META-004` also **rejects a dynamically-computed title**
(`it(\`${id} · …\`)` with a variable): an id CI cannot read statically is not
an id.

Test files live where §11's tree puts them, plus:

```
tests/meta/                    acMapping.spec.ts
tests/infra/                   …, supplyChain.spec.ts   # T-SEC-009, T-CI-006
                               …, licences.spec.ts      # TASK-153 — T-LICENSE-001a…l (§9A)
                                …, status.spec.ts        # TASK-167 — T-STATUS-001a…q (§9A)
                                …, infra.spec.ts         # TASK-006 — T-INFRA-001a…d, T-INFRA-002a…m, T-INFRA-003a…c
                                …, sku.spec.ts           # TASK-008 — T-INFRA-005a…r (§9A)
                                …, no-ttl.spec.ts        # TASK-008 — T-INV-013a…h (§9A)
                                …, test-locations.spec.ts # T-CI-008a…g (§9A) — no spec may live where no runner collects it
                                …, no-scheduler.spec.ts  # TASK-044 — T-CI-005 (static gate; was mis-specced as tests/ci/)
```

⚠ **This tree is enforced, not advisory (`T-CI-008`).** A `.spec.*` file placed
outside a path some runner collects **never executes**, and the suite stays
green — its assertions "pass" by never running. `npm run check:test-locations`
asks Vitest itself (`vitest list`) which files it collects and fails on any
spec that nobody owns; `tests/e2e/**` and `tests/smoke/**` are exempt because
Playwright owns them. Add a directory here **only** together with a Vitest
project that collects it.


---

## 11-R4. REVISION 4 ADDENDUM — tests re-pointed by the Azure SQL switch (A40)

> **The owner selected Variant A at `A40`;** ADR-0005 Rev 3 / ADR-0003 Rev 3
> moved the store from PostgreSQL to **Azure SQL Database Basic**, the
> registry to **ghcr.io**, and compute to **0.25/0.5**. The `NFR-003`
> philosophy is unchanged; only store-coupled specifics move. Behavioural
> tests (§5–§9) are again **untouched** — see §11.4, which applies equally.

### 11-R4.1 Changed

| Test | R4 change |
|---|---|
| `T-INV-001`, `T-INV-002` | Assert the DB raises **Azure SQL `2601`/`2627`** (unique index / unique constraint), not Postgres `23505`. Still database-enforced via filtered unique indexes (`data-model.md` §16.4). |
| `T-INV-013` | "No `pg_cron`" becomes **"no Azure SQL Agent job and no Elastic Job"** (plus the unchanged rest). Static analysis also greps Bicep/migrations for any Agent/Elastic-job creation (`data-model.md` §16.7). |
| `T-INFRA-005` | Re-pinned to **Azure SQL Basic + serverless auto-paused staging + ghcr.io (no ACR) + ACA 0.25/0.5**. See §9 US-039 AC-4. |
| `T-SEC-007` | The constraint-violation leak case now uses an **Azure SQL `2601`/`2627`** error, whose message carries the index/constraint name and the duplicated key — none of which may reach a response body. |
| `T-MIG-001` | Grep set restated for T-SQL: **`DROP TABLE`, `ALTER TABLE ... DROP COLUMN`, `TRUNCATE TABLE`, `DROP INDEX`** (there is no `DROP TYPE` in SQL Server; enums are CHECK constraints). See §11-R4.2. |
| `T-PERF-001` | Query-plan assertion uses SQL Server's **actual execution plan** (`SET STATISTICS PROFILE ON` / `sys.dm_exec_query_plan`) instead of Postgres `EXPLAIN (ANALYZE, BUFFERS)`; still asserts the listing first page is an index seek, no scan on `service_listing`. **Search (`LIKE`) is explicitly NOT asserted index-backed** — `pg_trgm` is gone (`data-model.md` §16.6). |

### 11-R4.2 Added

| Test | Asserts |
|---|---|
| **`T-INFRA-006` (new, R4)** | The CI workflow provisions the **`mcr.microsoft.com/mssql/server:2022-latest`** service container with `ACCEPT_EULA=Y`, the `sqlcmd -C` health command, and the explicit wait step (§3.3a). Dropping the wait — reintroducing the flaky-gate failure `NFR-003` forbids — is then a reviewable diff. **Also asserts the wait step reaches `sqlcmd` via `docker exec` (or an explicit tools install) rather than calling `/opt/mssql-tools18/bin/sqlcmd` directly on the runner, where it does not exist on `ubuntu-24.04`.** |
| **`T-MIG-002` (new, R4)** | The `M0` smoke migration is proven: a fresh Azure SQL Basic (or the mssql container) accepts `prisma migrate deploy` end-to-end and a `SELECT 1` round-trips. This is the concrete `RSK-031` mitigation — it fails **before** any feature work if `Prisma sqlserver` cannot migrate the schema or authenticate (`TASK-141`). |

### 11-R4.3 Deleted / superseded

| Test / fixture | Why |
|---|---|
| `postgres:16-alpine` service in `docker-compose.test.yml` / CI | Replaced by the mssql service container (§3.3a). |
| Postgres `23505` and `EXPLAIN (ANALYZE, BUFFERS)` assertions | Replaced by Azure SQL `2601`/`2627` and the SQL Server plan assertion above. |

---

## 11. REVISION 3 ADDENDUM — tests added, changed and deleted by A41/CC-002

> **Added 2026-08-10T21:45.** Constraint change **A41/CC-002** relaxed
> `NFR-012`; ADR-0003 Rev 2 and ADR-0005 Rev 2 re-decided hosting and the
> datastore. This section is the complete list of consequences for this
> document, so an implementer does not have to diff it. The **test
> philosophy of** `NFR-003` **is unchanged**: CI is the implementer's only
> feedback loop, so it stays offline, deterministic and fast.

### 11.1 Changed

| Test | Change |
|---|---|
| `T-INV-001`, `T-INV-002` | Now assert the **database** raises a unique violation — **`2601` (unique index) or `2627` (unique constraint)**, the Azure SQL codes, verified by execution against `mssql/server:2022-latest`. ~~PostgreSQL's `23505`.~~ The invariants became constraints (`specs/data-model.md` §16.4). |
| `T-INV-013` | Repointed from "no Cosmos TTL" to the five-part assertion in §16.7: **no SQL Agent job and no Elastic Job**, no delete trigger, no scheduled job, no `TRUNCATE` in any migration, `DELETE` in exactly one module. ~~"no `pg_cron`" — PostgreSQL, superseded; Azure SQL has no `pg_cron` to look for, so a grep for it would pass vacuously.~~ |
| `T-BATCH-005` | Rewritten. Kill the process mid-close and assert the list is **byte-identical to its pre-close state** — an uncommitted transaction leaves nothing — then assert a retry produces exactly one copy. Previously it asserted an invisible-but-resumable partial batch. |
| `T-PERF-001` | Query-plan assertion via **`SET STATISTICS IO, TIME ON` / `SET SHOWPLAN_XML ON`**, asserting an index seek rather than a scan. ~~`EXPLAIN (ANALYZE, BUFFERS)` — PostgreSQL-only syntax, superseded: SQL Server has no `EXPLAIN` statement and the test would not run at all.~~ Stronger than an RU-charge ratio and stable across machines. |
| `T-INFRA-005` | Rewritten from "every SKU is free" to **SKU pinning** (§9, US-039 AC-4). See the note there — enforcing a repealed constraint would have blocked the very upgrades A41 authorised. |
| `T-SEC-006` and the repository-signature test | **Promoted to load-bearing.** Owner scoping is a column filter, not a partition key, so nothing but these tests stands between a forgotten `WHERE` and a cross-owner read (`specs/api.md` §1.1). |
| `T-SEC-007` | Extended with a constraint-violation case: an Azure SQL **`2601`/`2627`** message carries the **index name, the table name and the duplicate key value**, and none of it may reach a response body. ~~"a Postgres `23505` carries the index name and conflicting values in `detail`".~~ |

### 11.2 Added

| Test | Asserts |
|---|---|
| **`T-MIG-001`** | **No migration in `prisma/migrations/**` contains `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` or `DROP TYPE`.** `REQ-028` forbids losing data and a migration is the one place it can be lost quietly and irreversibly — Prisma will happily generate a `DROP COLUMN` from a renamed field. **The highest-value single test added this revision.** |
| `T-INV-014` | Every table has an `owner_id` column and every index leads with it (`specs/data-model.md` §16.2). |
| `T-INV-015` | At most one **active** `suppression` per `(owner_id, work_identity)` — enforced by a **filtered** unique index (I-9). ~~"partial unique index" — PostgreSQL's name for it; SQL Server calls it *filtered* and the `CREATE` syntax differs.~~ ⚠ The harness must run with `QUOTED_IDENTIFIER ON` (`sqlcmd -I`), or the filtered index is **never created** and this test passes while asserting nothing. |
| `T-INV-016` | A non-empty `title.duplicate_ack_seq` is written in `createTitleAllowingDuplicate()` and nowhere else (§16.4). ~~"The acknowledged-duplicate `dup:` work-identity prefix is applied in `createTitleAllowingDuplicate()` and nowhere else."~~ ⚠ **That form passed vacuously**: it grepped for a `dup:` prefix that appears nowhere in the codebase, that `WORK_IDENTITY_RE` rejects, and that `title_match_coherent` rejects at the database (all verified). See `docs/task-017-schema-findings.md` §2 D-2. |
| `T-API-01x` | A tampered or unparseable pagination cursor returns **400 `INVALID_CURSOR`**, never a silent reset to page 1. |
| **`T-INFRA-002` (extended)** | The storage account has **blob soft delete, container soft delete, versioning and point-in-time restore all DISABLED.** Enabling any of them looks like good practice, costs pennies, and would **silently retain the owner's screenshots past 30 days while every other test still passes** — breaking `NFR-019` invisibly (ADR-0006 A41 note). This is a trap, and the test is the tripwire. |
| **`T-SMOKE-*` (staging tier, new)** | A post-deploy smoke suite run against **staging** before production (architecture §Environments): authenticated request succeeds, allow-list refuses a non-listed subject, the app reaches the database, the app pulls its image, and a synthetic batch closes. It exists because staging exists (ADR-0003 R2.4) and because these are precisely the failures no emulator can rehearse. |

### 11.3 Deleted

| Test / fixture | Why |
|---|---|
| Cosmos DB Emulator service in `docker-compose.test.yml` | Replaced by `postgres:16-alpine` (§3.3). |
| Any assertion about `visible`, the visibility protocol, or the `visible = true OR createdByBatchId IN (...)` predicate | The mechanism no longer exists (`specs/data-model.md` §15.5). |
| Any assertion that a Bicep SKU is free | Superseded by SKU pinning; `NFR-012` is a SHOULD now. |

### 11.4 What did NOT change, and why that matters

Every behavioural test in §5–§9 — all 241 acceptance criteria — is
**untouched**. The domain did not change; only the store beneath it did.
That is the intended shape of this revision, and if a future change to the
datastore forces edits to behavioural tests, that is a signal the storage
decision has leaked into the domain and should be reviewed rather than
accommodated.

