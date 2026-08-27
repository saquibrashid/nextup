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
- Fault injection is keyed on the **sha256 of the image bytes**, exactly like
  the recordings above — **not on a filename** (corrected in place, A48).
  Each fault has a dedicated fixture whose bytes hash to a registered sentinel:
  `fail_error` → throws; `fail_429` → throws a 429-shaped error; `slow` →
  exceeds the per-image timeout; **`llm_down` → LLM leg fails, OCR leg
  succeeds (degraded mode); `ocr_down` → OCR leg fails, LLM leg succeeds;
  `truncated` → LLM returns `finish_reason: 'length'`.**

  > ⚠ ~~*"Fault injection by filename convention: `__fail_error__.png` →
  > throws…"*~~ — **superseded.** `TitleExtractor.extract(imageBytes,
  > mimeType)` receives **only bytes and a MIME type**; it is handed no
  > filename and, by `T-PASTE-005`, the stored name is synthesised server-side
  > anyway, so a client-supplied name reaches nothing. The filename convention
  > was therefore not merely awkward — it was **unimplementable against the
  > interface in §2.3**, and any attempt to honour it would have meant widening
  > `extract()` to take a name it must never trust.
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
| AC-2 | I | **`T-AI-004`** | Every candidate is reachable in the review response; all verdicts represented (incl. `inferred-unverified`, `unreadable-tile`); nothing dropped. <br> ⚠ **The unit half is delivered by TASK-057** (`packages/domain/test/cleanup.spec.ts`, `a`–`u`); the `I`-typed review-response half waits on TASK-059. <br> **TWO DEFECTS IN `specs/ai.md` §3.2, RESOLVED IN CODE AND REPORTED, NOT EDITED:** (1) the step order runs the **length gate (2) before "model declined" (7b)**, so every `unreadable-tile` — `rawText: ''`, `inferredTitle: null`, therefore `matchText: ''` — is stamped `chrome-suspected` and buried in §3.3's collapsed "Probably not titles" group, contradicting 7b's "**Never dropped**" and §3.3's main-list thumbnail. The loss is invisible: the tile is technically still on screen, in the group the owner is least likely to open. `unreadable-tile` is therefore decided **first** (`T-AI-004d`). (2) Step 4 says "**> 60 %**" and names `1h 52m` and `S2:E4`; both compute to **exactly 0.60** (3 of 5 non-space characters), so the strict `>` catches **neither of its own two examples** — implemented `>=` (`T-AI-004j`). <br> **Verdict precedence is unspecified in §3.2** and was chosen explicitly: `unreadable-tile` > `chrome-suspected` > `inferred-unverified` > `low-confidence` > `title-candidate`, with `inferred-unverified` deliberately **above** `low-confidence` against the numeric step order, because 7a is the RSK-028 fabrication mitigation and drives a **mandatory thumbnail** (`T-AI-041`) whereas 7 drives a sentence (`T-AI-004e`). <br> A year is **never lifted when nothing would remain** — *1917*, *2012*, *1984* — which would both empty `matchText` into step 8's chrome group and hand the §4.2 matcher a year it invented, costing 0.15 against the real release year. Both failures are silent (`T-AI-004o`, `T-AI-004u`). |
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
| — | U | **`T-FRESH-015`** | **A46 regression guard:** the freshness labels state a FACT and never nag |

*(A46: US-022 AC-2 — the `LIST_STALENESS_DAYS` nudge, `T-FRESH-011` — is
deleted entirely; the list-staleness nudge concept is dropped from v1 and
REQ-040/ASM-038 are retired. The AC numbering intentionally skips AC-2 here —
AC-3/AC-4/AC-5 keep their original labels, this is not an error to "fix".)*

*(`T-FRESH-015` is deliberately **not** attached to an AC. It asserts an
ABSENCE, so no acceptance criterion can carry it: A46 deleted AC-2 rather than
reworded it, which leaves the retired concept guarded by nothing. Every other
test here would still pass if `serviceFreshnessLabel` were reworded from
"Max updated 47 days ago" into "Max updated 47 days ago — time to update?",
because they all assert the parts that stay. `T-FRESH-015` is the only thing
standing between the retired nudge and a quiet return, so it asserts the
forbidden wording directly and asserts that the phrasing does not change with
age — a threshold cannot be reintroduced without a visible failure.)*

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
| AC-2 | I | **`T-UNDO-010`** | The SD-03 discard module directly: the discard is REFUSED by `fk_change_listing` unless the provenance and candidate pointers are detached first; the detached rows themselves survive with their non-pointer columns intact (REQ-028, US-032 AC-3), and both deletes are owner-scoped |

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
| AC-2 | S | **`T-CI-005`** | Exactly three non-owner processes exist: lazy TMDB refresh, the blob lifecycle rule, and the lazy IMDb rating refresh (Epic M). No timer/cron/worker. ~~Superseded (Epic M): "Exactly two non-owner processes exist: lazy TMDB refresh and the blob lifecycle rule."~~ |
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
                               bakeoff.spec.ts           # A48 — T-AI-045d/e/f (§9.7 decision rule)
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
tests/smoke/                   smoke.spec.ts
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
                                …, infra.spec.ts         # TASK-006 — T-INFRA-001a…g, T-INFRA-002a…m, T-INFRA-003a…c
                                …, sku.spec.ts           # TASK-008 — T-INFRA-005a…r (§9A)
                                …, easyAuth.spec.ts      # TASK-027 — T-INFRA-008a…n (§9A)
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
| **`T-API-017`** | A tampered or unparseable pagination cursor returns **400 `INVALID_CURSOR`**, never a silent reset to page 1. ⚠ **This row's id was the literal placeholder `~~T-API-01x~~`** — an `x` where the digit should be, sitting unremarked in a table of real ids. It was never resolved, so the one test defining what a bad cursor does could not be cited by the backlog (`TASK-033` cited the invented `T-API-004` instead) and could not be found by anyone searching for it. Numbered `T-API-017` at the TASK-048 reconciliation sweep. |
| **`T-INV-018`** (new, TASK-017) | **The live database's default collation is `Latin1_General_100_BIN2`, and all three filtered unique indexes report `has_filter = 1`.** ⚠ Both halves are load-bearing. Prisma's `create()` joins a `DECLARE @generated_keys table([id] NVARCHAR(200))` variable back to the inserted row; a table variable takes the **database default** collation, so on a `CI_AS` database that join meets the `BIN2` `[id]` column and **every insert fails with `Msg 468`** — measured, 24 of 25 integration tests. The index half catches the `QUOTED_IDENTIFIER` trap in `T-INV-015` at its source, so a missing filtered index fails HERE loudly instead of making `T-INV-001/002/015` pass vacuously. |
| **`T-INV-019`** (new, TASK-017) | `upload_batch.degraded_extraction`, `low_yield` and `cross_check` **survive the storage round trip** and default to `false`/`NULL`, never to `NULL`/`true`. Extraction and review are separate requests and each flag forces `computeRemovals: false` (`specs/ai.md` §2.2/§8.2), so a flag lost in storage lets a failed extraction be misread as a removal — product invariant 2. |
| **`T-INV-020`** (new, TASK-017) | The **database** rejects an unsupported `service`, an unknown batch `mode`, and non-JSON in the JSON columns. ⚠ Includes the E-3 pair: `extraction_stats` holds an object and correctly rejects a bare scalar under `ISJSON(x) = 1`, while `batch_change.prev_value`/`next_value` hold scalars and require `ISJSON(x, VALUE) = 1`. Conflating the two rolled back every full-update batch close. |
| **`T-INV-021`** (new, TASK-017) | `upsertServiceState` is an explicit **UPDATE-then-INSERT-if-zero-rows**, never `MERGE` and never Prisma's `upsert()` (both carry SQL Server's documented concurrency defects). Also asserts `last_completed_batch_at IS NULL` survives as "never updated" (US-022 AC-3) rather than collapsing to an epoch date. |
| **`T-INV-022`** (new, TASK-017) | `listCandidatesForBatch` returns **every** candidate in the batch, including `discarded` ones, and takes **no filter parameter at all**. Product invariant 2: full-update review must show ALL extracted titles, or a failed extraction is silently reinterpreted as a removal. The collapse loser is retained with `collapsed_into_candidate_id` set (SD-02, REQ-012). |
| **`T-INV-023`** (new, TASK-017) | The coverage **exclusion list** may not become an untested-code loophole. `apps/api/src/repository/**` is excluded from the §1 thresholds because coverage is bound to CI job 4 (`test:unit`), which has no database, while that code is exercised in full by the `integration` project (§3.3a) — counting it in the unit run would report 0% for well-tested code and drag the floor down for everything else. The risk is what the exclusion permits *later*: once a directory is outside the thresholds, code added to it, or tests deleted from it, still pass every coverage gate, and the exclusion silently changes meaning from "measured elsewhere" to "not measured at all". So `T-INV-023b` fails if any excluded repository module is not imported by an integration spec, and `T-INV-023c` fails if the exclusion list ever grows beyond the two process entrypoints and this one directory. |
| **`T-INV-024`** (new, TASK-017) | The domain enums in `packages/domain/src/enums.ts` and the `CHECK (col IN (...))` constraints in `prisma/migrations/**` are two copies of the same truth, and neither generates the other. Both drift directions fail quietly: a value added to the enum but not the constraint typechecks, passes every unit test, and throws a raw constraint violation the first time a real row carries it; a value added to the constraint but not the enum lets a column hold a state the domain cannot name, so exhaustive `switch` statements silently stop being exhaustive for that row. The constraint→enum map is written out explicitly rather than inferred from column names, because an inferred mapping would skip the pairs it failed to match and report success by checking nothing. `T-INV-024b` asserts a missing constraint is reported rather than compared against an empty list. |
| **`T-SEC-021`** (implemented, TASK-017) | Walks the **TypeScript AST** of `apps/api/src/repository/**` and fails on any Prisma call whose `where` omits `ownerId` at its top level, any create whose `data` omits it, and any use of `findUnique`/`update`/`delete`/`upsert` (which take a unique selector and *cannot* carry `ownerId`). A literal grep cannot do this — `where: { ownerId, id }` and `where: { id }` are both just text. 12 of its 17 cases feed it source that DOES contain the violation, because a checker that always returns `[]` satisfies the real-source case perfectly. |
| **`T-INFRA-002` (extended)** | The storage account has **blob soft delete, container soft delete, versioning and point-in-time restore all DISABLED.** Enabling any of them looks like good practice, costs pennies, and would **silently retain the owner's screenshots past 30 days while every other test still passes** — breaking `NFR-019` invisibly (ADR-0006 A41 note). This is a trap, and the test is the tripwire. |
| **`T-SMOKE-*` (staging tier, new)** | A post-deploy smoke suite run against **staging** before production (architecture §Environments): authenticated request succeeds, allow-list refuses a non-listed subject, the app reaches the database, the app pulls its image, and a synthetic batch closes. It exists because staging exists (ADR-0003 R2.4) and because these are precisely the failures no emulator can rehearse. |
| **`T-SEC-013`** (implemented, TASK-018) | `readPrincipal` fails **closed** on every malformed `x-ms-client-principal`: absent, empty, non-base64, base64 of non-JSON, a JSON non-object, an array, missing `iss`, missing subject, and a **repeated** header (Node presents it as an array — two candidate identities is not a situation to pick a winner from). ⚠ Base64 is **round-trip validated**, because `Buffer.from(s, 'base64')` ignores out-of-alphabet characters instead of throwing, so arbitrary text "decodes" and mojibake containing `{` would otherwise reach `JSON.parse`. Requires **both** `iss` and a subject: `ownerId` derives from both, and an unstable `ownerId` silently orphans every row — indistinguishable from data loss, and invisible to any test using a single identity. |
| **`T-SEC-020`** (implemented, TASK-018) | `deriveOwnerId` is deterministic, is not the raw subject, and does not collide across a 10,000-subject fixture (§2.4). `T-SEC-020f` specifically pins the **`\|` separator**: without it `('https://a/', 'bc')` and `('https://a/b', 'c')` concatenate identically and two different principals become the **same owner**. |
| **`T-SEC-014` / `T-SEC-016`** (implemented, TASK-019) | The allow-list is **fail-closed**: an unset or empty `NEXTUP_ALLOWED_SUBJECTS` refuses everyone (and warns once), `NEXTUP_BOOTSTRAP_ALLOW_FIRST` grants nothing on its own and is honoured only when it equals exactly `'true'`, and matching is exact — no prefix, no case-folding, no substring. |
| **`T-SEC-015`** (implemented, TASK-019) | Authorisation matches **subject ids, never addresses**. A static gate over `allowList.ts` and `ownerScope.ts` failing on `email`, `upn` or `preferred_username` — ⚠ **including inside comments**, so those two files are written to avoid the words entirely; do not "improve" a comment there. Addresses are re-assignable and re-usable by a directory, so an address-keyed allow-list can hand a departed identity's data to a new holder. `T-SEC-015c` feeds the pattern a known violation, because a pattern that matches nothing passes the real source perfectly. |
| **`T-SEC-019`** (implemented, TASK-018) | The dev principal shim never reaches production — see `specs/security.md` §2.3. The boundary is **structural**: the shim lives in `apps/api/dev/`, outside the production `include: ["src/**/*.ts"]`, so the compiler cannot emit it and `createApp` takes the reader as an injected parameter so nothing under `src/` names it. ⚠ `T-SEC-019d` **deletes `dist` and passes `tsc --build --force`**; both are load-bearing. `tsc --build` is incremental, and this test was observed to **PASS while scanning a stale `dist`** with a shim sitting in `src` — and `tsc` never removes an output whose source has been deleted, so an un-cleaned `dist` is history rather than the current build. It asserts **named** expected outputs, not `length > 0`: a skipped build can leave a few files behind and still look busy. |
| **`T-SEC-005` / `T-SEC-012` / `T-SEC-030` / `T-API-001`** (implemented, TASK-020/021/023) | The mounted chain, driven over **real HTTP on an ephemeral port** using Node's built-in `fetch` — no `supertest`, so no new dependency (NFR-004) and higher fidelity: a 401 that is really an HTML redirect, or a library-default CORS header, are both invisible when asserting against a mocked `res`. Asserts 401 vs 403 stay **distinct** (no principal = sign in; principal outside the allow-list = signed in and refused — collapsing them loops a refused user through sign-in forever), that the JSON error envelope is used throughout, and that the `/api` **404 fallback sits INSIDE the chain** after `attachOwnerScope`, so an unknown path returns 401 to an unauthenticated caller rather than confirming which paths exist. |
| **`T-DEP-001`** (implemented, TASK-147) | **Every DIRECT runtime dependency is on the allow-list in `tools/check-deps.mjs`, mirroring `specs/security.md` §8.** NFR-004 calls the runtime set "deliberately small", which was prose a reviewer had to enforce by hand while skimming a manifest diff. Scoped to direct `dependencies` in the workspace manifests: `devDependencies` are excluded (not distributed, and gating the test tooling would make every lane fight this file) and the transitive tree is excluded deliberately — pinning it would fail on every patch bump, and transitive risk is already covered by `T-LICENSE-001` and `T-DEP-002`. **Implementation found §8 incomplete:** it enumerated the API dependencies and silently omitted the SPA's own `react`/`react-dom`/`react-router-dom` and `@noble/hashes`, all of which have shipped since TASK-005/013. §8 corrected in place. |
| **`T-DEP-002`** (implemented, TASK-147) | **No HEIC/H.26x ENCODER anywhere in the tree, transitives included.** The decode chain (`heic-convert` → `heic-decode` → `libheif-js`, carrying `libde265`) is decode-only, and that is the ONLY reason this MIT repository's licence floor is weak copyleft rather than GPL-2.0: `x265` is GPL and patent-encumbered. Scans `package-lock.json`, because the realistic failure is not `npm i x265` but a patch bump pulling an encoder in three levels down. **`T-DEP-002c` is the load-bearing NEGATIVE control:** it asserts `libheif-js`, `heic-decode` and `libde265` are NOT matched. A pattern broadened to "anything mentioning heif" bans the DECODER, removing HEIC upload support (ASM-058) while still looking like a working gate — mutation-proven in both directions. |
| **`T-DEP-003`** (implemented, TASK-147) | The decode chain installs from **prebuilt** artefacts with no native compile step (TASK-147's exit criterion). Asserts `heic-convert`/`heic-decode`/`libheif-js` are present and declare **no install script** (pure JS/WASM, so nothing can invoke node-gyp), and that prebuilt sharp binaries exist for **both** libc targets. Also guards `T-DEP-002` against passing vacuously: with the decode chain removed, "no encoder present" would still be true and would assert nothing. |
| **`T-INFRA-007`** (implemented, TASK-147) | **The runtime container stage copies `node_modules/@img` from the build stage for as long as it installs with `--omit=optional`.** sharp ships all 25 of its native libvips binaries as **OPTIONAL** dependencies, so `--omit=optional` installs sharp WITHOUT the binary it needs. Nothing fails at build time — **verified by building both images: with the COPY, `sharp.versions.vips` reports 8.18.3; without it, `require('sharp')` throws "Could not load the sharp module using the linuxmusl-x64 runtime"** at the first image upload (REQ-077), in production, on the owner's first HEIC photo. Asserted as Dockerfile text so it runs in the unit job with no Docker daemon, and conditioned on the flag so removing `--omit=optional` is also a valid fix. |

| **`T-API-003`** (implemented, TASK-048) | **The error-code enumeration is CLOSED (`specs/api.md` §8).** A source scan over `apps/api/src/**` asserts every `new AppError('CODE'` literal is a member of `ERROR_CODES`. ⚠ **This id was a phantom until TASK-048**: `packages/domain/src/errorCodes.ts` claimed in its own header that `T-API-003` asserted this, and `docs/backlog.md` named it as a done-when test, but it was defined in no spec and implemented in no file — so the invariant its comment advertised was in fact unguarded, and a route could have invented a code that reached the owner as an untranslated failure. The scan is static rather than runtime because a runtime assertion only sees codes on paths a test happens to exercise, which excludes the rarely-hit branch that most needs checking. `T-API-003b` is the negative control: it pins a **multi-line** `new AppError(` call so a regex that silently stopped matching cannot pass vacuously. The second half of the original claim — *every member has at least one test* — is deliberately NOT asserted yet: most codes belong to endpoints that do not exist, so it would fail for the whole of M3. It is added when the last code-throwing endpoint lands. |

| **`T-META-005`** (implemented, TASK-048 follow-up) | **Every test id `docs/backlog.md` cites is DEFINED in this file.** `tools/check-test-ids.mjs`, run in CI job 3. Upstream of `T-STATUS-001`: that gate asks whether a *done* task's tests are implemented, this one asks whether the cited ids are real at all — which matters for every task, including those not started. ⚠ **When added, 89 of the 276 ids the backlog cited (32%) were defined nowhere here.** The cause was systematic, not random: this file's §9 tables were renumbered (`T-LIST-001`/`002` → `T-LIST-010`…`027`; `T-REM-001`…`005` → `T-REM-006`/`010`…`022`; `T-AI-001`…`003` → `T-AI-004`/`007`/`010`…`044`) and `docs/backlog.md` was never reconciled, so a third of the work order pointed at nothing. Three ids had already reached code: `T-BATCH-001`, `T-BATCH-002` and `T-API-003` were cited as done-when tests, `T-API-003` was additionally advertised in `packages/domain/src/errorCodes.ts` as a guard that existed, and none of the three was implemented anywhere. **This is the failure NFR-003 exists to prevent**: a row whose "Done when" names a nonexistent test has no definition of done, so the implementer invents one and every other gate passes against an assertion nobody specified. `~~struck-through~~` ids are ignored, so an in-place correction can keep the superseded id visible without failing CI. |

### 11.3 Deleted

| Test / fixture | Why |
|---|---|
| Cosmos DB Emulator service in `docker-compose.test.yml` | Replaced by **`mcr.microsoft.com/mssql/server:2022-latest`** (§3.3a). ~~Replaced by `postgres:16-alpine` (§3.3).~~ ⚠ This row records a deletion made in R1→R3, and its replacement was itself replaced in R4. Corrected in place rather than left as a historical note, because §11.3 carries no revision banner and a reader arriving here has no signal that the right-hand column is two revisions stale. |
| Any assertion about `visible`, the visibility protocol, or the `visible = true OR createdByBatchId IN (...)` predicate | The mechanism no longer exists (`specs/data-model.md` §15.5). |
| Any assertion that a Bicep SKU is free | Superseded by SKU pinning; `NFR-012` is a SHOULD now. |

### 11.4 What did NOT change, and why that matters

Every behavioural test in §5–§9 — all 241 acceptance criteria — is
**untouched**. The domain did not change; only the store beneath it did.
That is the intended shape of this revision, and if a future change to the
datastore forces edits to behavioural tests, that is a signal the storage
decision has leaked into the domain and should be reviewed rather than
accommodated.


## 12. Tests defined by the backlog reconciliation sweep (TASK-048 follow-up)

`T-META-005` found that **98 of the 276 test ids `docs/backlog.md` cited were
defined nowhere in this file** (32%, then 36% once the gate stopped counting
prose mentions as definitions — see below). Most were casualties of the §9
renumbering and were corrected in the backlog in place, pointing at the test
that really asserts the behaviour.

The ids below could **not** be corrected that way, for one of two reasons, and
are defined here instead. The distinction matters: it is the difference between
"the work order pointed at the wrong test" and "the behaviour has no test at
all", and only the second is a gap in the definition of done.

⚠ **A definition is a table cell that NAMES a test — not any mention of the id.**
`tools/check-test-ids.mjs` originally counted every occurrence, which made it
self-defeating: §11.2's entry recording that `T-BATCH-001`, `T-BATCH-002` and
`T-API-004` were invented ids contains those ids, so **writing down that a
phantom was a phantom silently promoted it to "defined"** and removed it from
the report. Three ids vanished from the offender list the moment the finding was
recorded, and nine more were hidden the same way. The gate now recognises a
definition only in a cell that holds ids and their markup, nothing else.

### 12.1 Already implemented, never listed here

These are real, passing tests. The backlog cited them correctly all along; this
file simply never recorded them, so `T-META-005` reported them as phantoms.
**The fix is here, not in the backlog** — a test that exists and passes is not a
phantom, and re-pointing the backlog at some other id would have discarded
working coverage and left `packages/domain` asserting behaviour no spec claimed.

| Test | Asserts |
|---|---|
| **`T-DM-001`** | `normaliseTitleText` is idempotent, empties whitespace-only input without collapsing to a space, does not strip an article-only title, and **appends no year (SD-05)**. Implemented in `packages/domain/test/identity.spec.ts` (TASK-015). The year exclusion is load-bearing: a year in the identity input would make the same work under two release-year sources into two different works, silently defeating suppression (product invariant 1). |
| **`T-DM-004`** | ULID generation and `deterministicId`: 26 Crockford base32 characters, the alphabet excludes `I`/`L`/`O`/`U`, ids sort lexicographically by time, distinct ids within one millisecond, an out-of-range timestamp **throws rather than truncating**, `deterministicId` is stable for a seed and independent of the clock, and the monotonic test helper stays ordered across a millisecond boundary. Implemented in `packages/domain/test/ids.spec.ts` (TASK-013). Also asserts the Web Crypto and `TextEncoder` absence paths **throw rather than falling back** — a silent fallback to `Math.random()` would make ids predictable and non-unique at once. |
| **`T-INV-009`** | `deriveTitleState` and `deriveSortDateAdded` each exist in **exactly one place**. A static scan over the source (`packages/domain/test/derive.spec.ts`, TASK-016) that fails on a second implementation, with `T-INV-009c`/`d` proving the scan reaches real files and fires on a real re-implementation. A duplicated derivation is the classic way two surfaces disagree about whether a title is removed while every unit test passes. |
| **`T-INV-010`** | Derived title fields: a title is `removed` only when **every** listing is removed; a title with no listings **throws** rather than reporting removed; `sortDateAdded` is the **earliest** date across non-removed listings; adding a work on a second service does not move the row (US-020 AC-4); removing the earliest listing recomputes the value (AC-5); a fully removed title has `sortDateAdded: null` (AC-7); dates compare lexicographically **so no timezone can shift a day**; and the schema refuses a title whose derived fields disagree. Implemented in `packages/domain/test/derive.spec.ts` (TASK-016). ⚠ This is the unit-level counterpart of `T-LIST-014`/`015`/`017` and `T-REM-018`, which assert the same behaviour through the API. The sweep briefly re-pointed TASK-016 at those ids — which would have discarded eight passing assertions and marked a finished task incomplete. **A test that exists and passes is not a phantom; the spec was the thing missing.** |

### 12.2 Genuine coverage gaps found by the sweep

No existing test asserts these behaviours. They are defined here **before** the
citing task is built, because the spec is the definition of done and the backlog
is not: a task allowed to invent its own test id is a task that grades its own
homework (NFR-003).

| Test | L | Asserts |
|---|---|---|
| **`T-LIST-028`** | I | `GET /api/titles/:titleId` returns the single canonical work with its active listings and badges, poster, type, year and date-added, scoped to the owner; an unknown or other-owner id returns **404, never 403** — distinguishing "absent" from "forbidden" tells an unauthorised caller which ids exist. US-018's other integration tests assert list-level shape only, and the one per-row-content test (`T-UI-010`) is a component test, the wrong layer for an endpoint. |
| **`T-RES-016`** | C | The removed view renders a Restore control per removed row and, when the work is **suppressed**, drives the un-suppress-first flow rather than failing with a bare 409. US-025 holds integration tests only (`T-RES-010`…`015`); the restore UI and its un-suppress-first interaction had no component test. ⚠ Restore stays an **explicit user action** (product invariant 7) — this test must never assert an automatic restore. |
| **`T-BATCH-016`** | I | `GET /api/batches` returns the owner's batch history — id, service, mode, status, dates — newest first and owner-scoped. The `T-BATCH-*` family holds `003`–`006` and `010`–`015`; the batch-list endpoint had no test at all. |
| **`T-UI-016`** | C | `FilterBar` renders the service, type and genre controls and syncs the selected filters to the URL query string **in both directions**, so a filtered list is deep-linkable and survives reload. `T-UX-013` covers only the zero-match state. |
| **`T-UI-020`** | C | `FixMatchDialog` renders the TMDB search input and results and lets the owner select a new match, wired to the fix-match action. The only US-030 component test (`T-UX-033`) covers the TMDB-unavailable branch; the normal search-and-select path was asserted at integration level only. |
| **`T-UI-022`** | C | `/about` renders `IMAGE_RETENTION_STATEMENT` and the never-delete and no-analytics copy **byte-equal to the named constants**. US-035's tests are all integration retention and purge tests; nothing asserted the page that tells the owner what the product does with their images. Byte-equality, not "contains", because a reworded retention promise is a different promise. |
| **`T-UX-007`** | C | `BatchStatusPage` polls the batch and renders per-image progress and per-image failure states **without navigating away**. LLM latency makes this screen visible for minutes (`ADR-0001`), so it is a primary surface, not a spinner. `T-EXT-010` asserts progress at integration level — the wrong layer for the page. |
| **`T-UX-008`** | C | `BatchStatusPage` renders the degraded / cross-check-unavailable banner when either extraction leg is missing. `T-AI-036` asserts the degraded batch outcome at integration level and states a banner is shown, but no component test proves the page actually renders one. ⚠ Whenever this banner shows, full-update removals are withheld (`specs/ai.md` §2.2) — product invariant 2 — so a banner that silently fails to render hides the reason the owner's removals disappeared. |
| **`T-UX-011`** | C | `ReviewPage` renders a sticky action bar that stays visible while the candidate list scrolls. With a long review list the confirm and close actions would otherwise scroll out of reach on a phone (US-037). |
| **`T-UX-023`** | E | Each primary surface — list, upload, review, removed, suppressions, batches, about — renders a **distinct offline state**, not a blank page and not the generic load-failure error. `ux-states.md` §11 requires it per surface; US-037 held only responsive and a11y tests. |
| **`T-UX-024`** | E | On reconnect each surface recovers — retry or refetch — **without losing in-progress owner input**. The pair with `T-UX-023`: an offline state that clears by discarding a half-finished review is a data-loss bug wearing an error message. |
| **`T-UX-025`** | C | The **403 refusal** renders full-page: the copy, the signed-in email and a sign-out control, with **no list data, no nav and no partial UI**. `ux-states.md` §2.11 pairs the state with `T-SEC-010`, which asserts the API refusal — not that the SPA renders a refusal instead of an empty list. Without this, a 403 that silently renders an empty list looks to the owner exactly like a list that lost everything. |

> ⚠ **CORRECTION (TASK-024 review, raised by the web lane).** The two offline
> entries above were first published here as **`T-UX-020`** and **`T-UX-021`**,
> and `docs/backlog.md` TASK-125 cited them under those ids. Both were already
> taken: `specs/ux-states.md` §2 allocates `T-UX-010`–`T-UX-022` **contiguously**
> to the fourteen list-surface states, where **`T-UX-020` is the 403 refusal
> (§2.11)** and **`T-UX-021` is the row-action submitting state (§2.13)**.
> Offline already has its own id there (`T-UX-003`, §2.12).
>
> The systematic, dense allocation in `ux-states.md` is the original and wins;
> the offline pair is renumbered to `T-UX-023`/`T-UX-024`, and TASK-125 is
> re-pointed to match. This is the same defect class as the phantom ids §12
> removed, arriving from the opposite direction: an id that is *defined twice*
> lets one task's green test discharge a different task's acceptance criterion.
> **Enumerate a family for free numbers before naming a test.**
>
> ~~`T-UX-020` — offline state per surface. `T-UX-021` — reconnect recovery.~~

| **`T-AI-023`** | I | `POST /api/batches/:batchId/candidates` creates an owner-supplied candidate on an **open** batch — the manual-entry fallback for the artwork-only tile that carries no readable text — returns it in the review response, and rejects entry on a closed batch. `T-UNM-010` covers actions on an *unmatched* candidate, not creation of a new one, and `T-AI-041` covers only rendering the untitled tile. |

### 12.3 Defined in a SISTER spec, never imported here

The sixth and least obvious class the sweep found. These ids are not invented
and not renumbered: they are anchored under their own id in `specs/ai.md`,
`specs/ui.md`, `specs/ux-states.md` or in this file's own **prose**, and the
backlog cites them correctly. What was missing is a cell in a mapping table
here.

That matters because of NFR-003: **this file carries the AC → named-test
mapping and is the definition of done.** A test specified only in a sister
document is a test no one is accountable for delivering — it appears in a
design discussion, never in a work order's exit criteria, and every gate stays
green while it is never written. So the fix is to import the id here, not to
teach `T-META-005` to read every spec: widening the gate would make four
documents jointly authoritative and remove the single place a reviewer can
check what "done" means.

| Test | L | Asserts | Anchored in |
|---|---|---|---|
| **`T-API-002`** | U | The error envelope's shape — `{ error: { code, message, correlationId? } }` — is what every failure returns, and a thrown non-`AppError` is reported as `INTERNAL_ERROR` without leaking a stack. **Already implemented and passing** in `apps/api/test/unit/errorEnvelope.spec.ts` (TASK-022), cases `a`–`h`. | implemented, unspecced |
| **`T-META-004`** | S | Every `it(...)` title starts with a `T-` id, as a static string. **Already implemented and passing** in `tools/eslint-rules/test-id-naming.spec.ts` (TASK-002). Described in §11 prose but never given a table cell — so the rule that makes every other id traceable was itself untraceable. | §11 prose |
| **`T-AI-009`** | U | The Read extractor requests `features=['Read']` only, and the extractor result type carries **no service field** — `'netflix'`/`'max'` appear nowhere under `extraction/` (`specs/ai.md`). Service attribution is the owner's, declared on the batch; an extractor that guessed it could relabel a title onto a service the owner never uploaded. <br> **`g`/`h` (new, TASK-057) — the ONE exemption, and the property that buys it.** `specs/ai.md` §3.2 step 3 lists the chrome vocabulary verbatim and it **includes `hbo max`, `max` and `netflix`**, because those words are printed on the screenshots: an OCR orphan of a Netflix page header reads exactly `NETFLIX`, and dropping the terms turns it into a `title-candidate` — a false title, the rate `T-AI-030` measures. That is a real conflict with RULE B, and it is resolved by **exempting `packages/domain/src/extraction/chromeTerms.ts` by path — never by moving the file out of the scanner's reach**, which would defeat the ban rather than answer it. RULE B bans the READER being told which service it is looking at; a fixed vocabulary of on-screen words prompts nothing and branches on nothing. `g` makes that verifiable rather than asserted: the exempt file **imports nothing**, and a module with no imports has no reader, no request and no batch in scope, so it cannot be made service-conditional without first failing this case. `h` proves the import scan catches a planted import. `d` additionally asserts the exempt path still exists, so a rename cannot make the exemption vacuous. | `specs/ai.md` |
| **`T-AI-010`** | S | `azureVisionExtractor.ts` is the **only** file permitted to import the Vision SDK (`specs/ai.md` §305). Confining the SDK to one adapter is what keeps `packages/domain` pure and the matcher deterministic (`NFR-012a`, ADR-0001). | `specs/ai.md` |
| **`T-AI-033`** | I | The stage-1 provider-contract suite: the **real** `LlmVisionExtractor` and `AzureVisionExtractor` driven offline against committed HTTP recordings (§3.1a) — schema parsing, strict-schema rejection, 429/5xx retry timing, timeouts, content-filter refusals and both degraded paths. Offline, so it runs in CI without a key and without cost.  **Landing in two halves. The `AzureVisionExtractor` half is TASK-056** (`apps/api/test/unit/extraction/azureVisionExtractor.spec.ts`, recordings in `tests/fixtures/msw/vision/`): valid-result parsing, box normalisation and edge clamping, the mean-of-words line confidence, 429/5xx/transport retry timing at 1 s/4 s, non-retry of 4xx, the timeout kind, and the two **"a response we cannot use is never an empty one"** cases — a 200 with no `readResult` and a 200 with no image dimensions both reject, because an unread image reported as "no text" is, in full-update mode, a wave of removals. **The `LlmVisionExtractor` half is TASK-056b** — strict-schema rejection, the service-field rejection, `finish_reason: 'length'` and content-filter refusals all belong to a reader that does not exist yet, and squatting them earlier would make the suite green for behaviour nothing implements. | §3.1a prose |
| **`T-CI-004`** | S | Neither `golden:live` nor `golden:record` is referenced by **any** workflow file (§4A). Both spend real money against real providers; a well-meaning "run the golden set in CI" would bill the owner per push and, worse, re-record the baseline the gates are measured against. | §4A prose |
| **`T-AI-045` (new, TASK-168)** | S | The **primary-reader bake-off protocol** of `specs/ai.md` §9.7 is enforced as structure, not as good intentions. `a` the two arms differ **only** in deployment name — prompt, schema, `detail`, `max_tokens`, `temperature` and `seed` are byte-identical, because a prompt tuned for one arm turns a model comparison into a prompt comparison and nothing in the numbers would reveal it. `b` both arms score against the **same** `expected/` and the same `ocr/`; a per-model answer key would let a challenger be graded on an easier exam. `c` `llm/` recordings are model-scoped, so recording a challenger cannot overwrite the incumbent's evidence — the failure mode is silent and irreversible, and it destroys the only baseline the comparison needs. `d` the decision function is **pure and total** over the §9.7 table, defaults to the incumbent on any mixed result, and treats cost strictly as a tie-breaker (`NFR-012a`); mutation-proven by feeding it a challenger that is cheaper and worse and requiring the incumbent to survive. `e` a sub-two-title delta is reported as **"no measured difference"** on a 12-image corpus, not as a win. `f` neither the bake-off script nor its recorder is referenced by any workflow file — same reason as `T-CI-004`, which it extends. | `specs/ai.md` §9.7 |
| **`T-CI-007`** | I | An outbound-blocking proxy observes **zero** requests during the CI test run. Egress in CI means a test is really an integration test against someone else's service: it fails on their outage, passes on their cached response, and quietly breaks the offline guarantee `T-AI-033` depends on.  **`o`–`r` (added with TASK-056): the guard hooks `fetch` AND `http.request`/`https.request`, and the two are not equivalent. `msw` mocks `fetch` by REPLACING it, so a mocked fetch never reaches the guard at all — which is why the TMDB suite needed nothing here. It cannot do that for `http.request`: to hand back a `ClientRequest` it must call the real one, having swapped the socket underneath, so the guard sees a request to a public hostname that no packet will ever leave for. The Azure SDKs speak `https.request` (`@azure/core-rest-pipeline`), so without a seam a fully-recorded, offline extractor suite is indistinguishable from a live one — `T-AI-033` could not exist. `registerMockedHost()` records such an attempt as `mocked`, never as `blocked`. The seam is only safe while it is narrow, so all three properties are asserted: `o` it works, `p` deregistration restores blocking (a registration that outlived its `msw` server would wave a REAL call through, silently, for the rest of the run), and `r` nothing outside `tests/fixtures/msw/**` calls it.** | §2 prose |
| **`T-E2E-001`** | E | The full owner journey — sign in → upload → extract → match → review → confirm → see the combined list — specified end to end in §5 and called there **"the single most valuable test in the suite"**. It was cited by five backlog tasks (`TASK-080`, `094`, `108`, `130`, `164`) as their exit criterion while having no table cell anywhere. | §5 |
| **`T-INFRA-001` (a…g)** | S | **Least-privilege RBAC across every grant the template issues.** `a` the committed template has no violation; `b` the blob grant is scoped to a **container**, never the storage account — an account-scoped grant hands the staging identity read/write on every production screenshot while every other test still passes; `c` mutation-proves `b`; `d` mutation-proves that deleting a grant is caught. **`e`–`g` added with TASK-010**, when the Azure OpenAI and Azure AI Vision grants arrived and the original "exactly one role assignment" shape stopped holding: `e` the two Cognitive Services grants are account-scoped and carry only the inference roles (**Cognitive Services OpenAI User**, **Cognitive Services User**); `f` mutation-proves that a promotion to a management role such as **Cognitive Services OpenAI Contributor** is caught — that role can create and delete model deployments, which is enough to swap the pinned model out from under the golden corpus with no commit and no test run (`NFR-012a`, invariant 9); `g` mutation-proves a grant escaping to resource-group scope is caught. ⚠ The role guid is **not on the `roleAssignment` resource**: both grant modules take it as a parameter, so the compiled nested template holds `[subscriptionResourceId(…, parameters('roleDefinitionId'))]` and the literal sits in a top-level template **variable**, behind `[variables(…)]`. A check that reads the assignment finds no guid at all and passes **vacuously**, so the allow-list carries an explicit vacuity guard that fails when it resolves nothing. | TASK-006, TASK-010, `specs/security.md` §6 |
| **`T-INFRA-004`** | S | The Bicep 30-day blob-lifecycle purge rule **exists and is correctly shaped** (§3.4, `NFR-019`). Pairs with `T-INFRA-002`, which asserts soft delete and versioning are OFF: a correct lifecycle rule plus soft delete still retains the owner's screenshots past 30 days, so neither test is sufficient alone. | §3.4 prose |
| **`T-INFRA-008` (new, TASK-027)** | S | The Bicep **Easy Auth `authConfigs` resource exists and is shaped CLOSED**: named `current`, `platform.enabled = true`, `unauthenticatedClientAction = RedirectToLoginPage`, the Entra provider enabled against a `login.microsoftonline.com` issuer, the client secret held only as a **secret reference** whose name matches a declared `secrets` entry, and **no `excludedPaths` of any kind**. Same relationship to `T-AUTH-001/002/003` that `T-INFRA-004` has to the purge behaviour: those three are level `E` and need a deployment, so without this cell TASK-027 has **no CI-verifiable definition of done at all**. Every failure it catches deploys successfully and looks normal to the owner — `excludedPaths: ['/api/*']` in particular exposes the whole list at the platform edge while `T-SEC-010`/`T-SEC-014` and every other allow-list test still pass, because application code never runs. | ADR-0002, `specs/security.md` §2.1 |
| **`T-INFRA-009` (new, TASK-142)** | S | The **subscription budget and its two alert thresholds** exist in Bicep and **only ever send email**: exactly one `Microsoft.Consumption/budgets`, category `Cost`, `timeGrain Monthly`, exactly two notifications at **100 %** (informational) and **150 %** (action required), both enabled, both `Actual`, both with a recipient — and **no `actionGroups`, `contactGroups`, `contactRoles`, `webhooks` or `actions` on either**. The last clause is the one that matters: an action group can invoke an automation runbook, so wiring one to a billing threshold turns "you have spent $20" into "stop the container app" — it deploys cleanly, it looks responsible, and it would be added by someone being helpful. TASK-142 forbids it in terms ("no auto-shutdown or any automated remediation") and `REQ-028` forbids automatic deletion. Thresholds are **percentages of one amount** so the 1.0× and 1.5× figures cannot drift apart; a second budget would let them. | TASK-142, `REQ-028` |
| **`T-SEC-034` (new, TASK-142)** | S | The **production audit gate suppresses by named exception, never by blanket**. `tools/check-audit.mjs` collects only **high and critical** advisories, ignores bare-string `via` edges (they are dependency paths, not advisories — inventing an id from one makes the gate permanently and unfixably red), fails on **any advisory not explicitly listed**, and — the half that matters — fails on **any listed exception that is no longer reported**. An allow-list that only suppresses is a permanent hole that outlives its reason; this one deletes itself the moment upstream ships a fix. `d` requires every entry to carry an id, a date and a justification over 200 characters, because the point of the list is the reasoning, not the silence. `f` asserts CI actually **calls** the gate and has not reverted to a bare `npm audit --omit=dev`, and `g` that the non-blocking full-tree report survives so dev-tooling findings stay visible. ⚠ Accepted exception `GHSA-ggr8-5vv4-36mx`: npm reports its "fix" as `prisma@6.12.0`, which is a **downgrade** from the installed `6.19.3` presented in the same field as an upgrade. | TASK-142, `NFR-004` |
| **`T-INFRA-011` (new, TASK-007)** | S | The container app **can actually hold traffic**. `a`: `activeRevisionsMode` is `Multiple` — Single is the **default**, so this is what writing nothing gets you, and in Single mode only one revision may carry a weight, making every blue/green step in `deploy.yml` fail with *"configured for single revision"* — but only the **last** one, after the smoke suite has already reported green. `b`: traffic is pinned to `holdRevisionName` when one is supplied; an unconditional `latestRevision: true` makes **ARM itself** promote the new revision to 100% during the deployment, **before `prisma migrate deploy` runs**, so the hold, the smoke suite and the shift all operate on a revision that is already live. `c`: the bootstrap branch still weights `latestRevision`, or a first deployment produces an app with **no reachable revision** and no previous one to fall back to. ⚠ Both `a` and `b` were absent on the first real production deployment and neither absence produced a failing signal: the template built, validated, deployed and ran. | TASK-007, ADR-0003 |
| **`T-INFRA-010` (new, TASK-007)** | S | The **ingress `targetPort` equals the port the container actually listens on** (`ENV PORT` / `EXPOSE` in the Dockerfile). Cross-file, and every signal that should catch a mismatch reports success: `az bicep build` and `az deployment group validate` both pass (either value is a legal port), `az deployment group create` reports **Succeeded**, the revision provisions, and the container logs `listening on :3000`. The only evidence is `startup probe failed: connection refused` in the container-app system log and an app that answers **nothing at all** — the smoke suite times out rather than failing an assertion, so it reads as a flaky or slow deployment, not a broken one. ⚠ This shipped: `targetPort: 8080` against a container bound to `3000`. `d` binds the rule in **both** directions, since editing the Dockerfile alone is the likelier half; `e` catches a Dockerfile whose own `ENV PORT` and `EXPOSE` disagree, leaving no single answer to "which port?"; `f` fails on an undeclared port rather than silently having nothing to compare. | TASK-007, ADR-0003 |
| **`T-CI-009` (new, TASK-007)** | S | The **deployment pipeline cannot skip its own gates**. `deploy.yml` is asserted for ORDER and PROHIBITIONS, both invisible in review: production `needs: [build, staging]` (`a`); no `prisma migrate dev` and no `prisma db push` anywhere (`b`, run against a **comment-stripped** copy so the ban does not fire on the text explaining it); `migrate deploy` twice (`c`); ghcr.io with `GITHUB_TOKEN` and no `azurecr.io`/`AcrPush` (`d`); the image secret-scan **precedes** the push (`e`) and the build itself does not push (`f`, or the scan is bypassed entirely); production traffic shifts **after** the production smoke suite (`g`); staging smoke precedes the production job (`h`); every action pinned to a 40-char SHA (`i`); the migration gate re-runs in the deploy pipeline (`j`); `cancel-in-progress: false` (`k`); the ghcr note is linked (`l`). Each banned edit leaves a workflow that still reads plausibly and still goes green.  **`o`–`q` (added after the first production run, which failed at its final step): `o` the held revision is read **before** `az deployment group create` — ARM applies the traffic block as part of the deployment, so a hold computed afterwards holds a revision that is already serving the owner, and the two orderings read identically in a diff; `p` the production smoke suite targets the **new revision's own FQDN**, because the app FQDN is exactly what remains pinned to the OLD revision, so smoking it tests known-good code and reports green for a revision nobody contacted (this is what the first run did); `q` the superseded revision is **deactivated after the shift and only if the shift happened** — prod runs `minReplicas = 1`, so a revision left Active bills a replica for ever and the gate would double the standing cost on every deploy, while an `if: always()` would tear down the revision still serving the owner when the shift failed.**  `r`: the read distinguishes **two different empty results** — the command *failing* (the app does not exist: a real bootstrap) from a successful read whose weighted entry has a **null `revisionName`**, which is what both Single revision mode and the bicep bootstrap branch produce on a **live, serving** app. Conflating them skips the hold on running production and logs *"first deployment"* while doing so; on the first real prod run it also skipped the deactivation, leaving a second replica billing indefinitely. | TASK-007, `REQ-028` |
| **`T-SMOKE-004` (new, TASK-007)** | E | The **sign-in route works**, asserted because the other three `T-SMOKE-*` cases prove only that nothing is reachable — which is equally true of a deployment where signing in is **impossible**. A wrong client id, a deleted app registration or a malformed provider block all present as "everything is refused", indistinguishable from "correctly secured" to a suite that only asserts refusal. `/.auth/login/aad` must return **302 to `login.microsoftonline.com`** with a `redirect_uri` belonging to **this** deployment, so a copy-pasted callback from the other environment fails too. | TASK-007, ADR-0002 |
| **`T-SMOKE-001`** | E | An authenticated request against the freshly deployed **staging** revision succeeds. The `T-SMOKE-*` family was defined only as a **glob** in §11.2, which no id-level gate can resolve — `T-SMOKE-003` was already enumerated as a real cell, so the family was half-addressable and the missing half looked like a phantom. | §11.2 glob |
| **`T-SMOKE-002` (defined here at `A48`)** | E | The **SPA root is behind the same boundary as `/api`** — `GET /` against the deployed revision is refused by the platform, not served. Implemented in `tests/smoke/smoke.spec.ts` since TASK-007 and **defined nowhere**, which `check:test-ids` could not surface: that gate walks backlog → spec, so an id that is implemented and cited by no task is invisible to it in both directions (found by lane D, `A48`). The criterion is its own: a deployment that protected `/api` but served the shell openly leaks nothing on its own, and is exactly the shape a misconfiguration takes on the way to leaking. | TASK-007, ADR-0002 |
| **`T-UI-004`** | C | `ImageDropzone` names **PNG, JPEG and HEIC** in its accept list and its copy (`specs/ui.md`). ⚠ Load-bearing per product invariant 11: without HEIC in `accept`, an iOS file picker greys out the owner's own camera photos and the failure looks like a broken phone, not a missing format. Deliberately distinct from `T-UI-014`, which TASK-162 owns. | `specs/ui.md` |
| **`T-UX-041`** | C | The empty dropzone shows **all three** ingest affordances — paste, file selection and drag-and-drop (`specs/ux-states.md` §4.3). Product invariant 16: paste was added, not swapped in, and a tidied-up single-affordance dropzone silently removes a working capture path. | `specs/ux-states.md` §4.3 |
| **`T-UX-042`** | C | Partial acceptance on `/upload`: accepted files show running totals while rejected files are listed **individually with a per-file reason** (`specs/ux-states.md` §4.4). Product invariant 15 at the UI layer — one bad image must fail alone and stay retryable, which the owner can only act on if told which file and why. | `specs/ux-states.md` §4.4 |
| **`T-A11Y-012`** | E | The axe-core suite runs across **all nine routes** with zero serious or critical violations (§9A). §9A prose already treats this id as the cross-route a11y suite; the backlog cited it as the loose range `T-A11Y-003 … T-A11Y-012`, of which only the upper bound was ever a real id. | §9A prose |

### 12.4 Genuine gaps, defined under the id the backlog already cites

Free slots in their families, so the cited id is kept and given a meaning here
rather than renumbering the work order for no benefit.

| Test | L | Asserts |
|---|---|---|
| **`T-BATCH-007`** | I | The inline extraction runner honours its operational ceilings: image concurrency **2**, a **15-minute** batch ceiling, and `estimatedCostUsd` recorded in `extractionStats`. `T-EXT-010` covers progress and `T-AI-036` the degraded path; nothing asserted the limits that stop a runaway batch from exhausting the 0.5 GiB container (`RSK-016`). |
| **`T-PERF-003`** | I | The `batch_change_by_batch` and `candidate_by_batch` queries resolve by **index seek, not scan**, under the §16.6 indexes, and pagination is **keyset** — no `OFFSET`. `T-PERF-001` covers only the list and removed views. On Azure SQL Basic (5 DTU) a scan that is invisible at 50 rows is a timeout at 5,000. |
| **`T-EXPORT-001`** | I | `scripts/export-owner-data.ts` writes every owner row to a restorable artefact, is **never scheduled** and **never deletes** — and `docs/restore.md` documents the 7-day PITR and BACPAC paths. ⚠ Must not become a background job: product invariant 5 permits exactly three non-owner processes (Epic M raised it from two), and `T-CI-005` fails if a fourth appears. `REQ-028` forbids deletion but gives the owner no backup of their own, which is what this closes (`OQ-025`). |

---

## 13. Tests added by TASK-033 (`GET /api/titles`)

⚠ **These ids were chosen because they were FREE, not because they were
convenient.** The first draft of this suite reached for `T-LIST-016`,
`T-LIST-018`, `T-LIST-024`, `T-LIST-025`, `T-LIST-026` and `T-LIST-027`, all of
which are already assigned in §9 to **TASK-035, TASK-036 and TASK-037** — three
tasks that have not been started. Shipping under those ids would have made
`check:status` report the ordering, labelling and filtering work as complete,
which is the same defect the §12 sweep existed to remove, arriving from the
opposite direction. **Check a family for free numbers before naming a test.**

The ids below therefore assert what TASK-033 actually built, and the §9 rows
for `T-LIST-016`/`018`/`024`/`025`/`026`/`027` remain **unimplemented and still
owned by their own tasks**.

| Test | L | Assertion |
|---|---|---|
| **`T-LIST-029`** | U | The `GET /api/titles` query contract: newest-first by default (REQ-038/A44), `dir=asc` accepted, unknown `sort`/`dir` refused, repeatable filters de-duplicated and bounded, Express's nested-object query form refused rather than coerced, and **no owner id is ever read from the query string** (`T-SEC-006`). |
| **`T-LIST-030`** | I | Ordering and keyset pagination end to end: default newest-first, `dir=asc` reverses, **paging visits every row exactly once with no gaps**, rows sharing a date are neither skipped nor repeated across pages, the last page reports `nextCursor: null`, and an empty list is a 200 with `[]` rather than a 404. |
| **`T-LIST-031`** | U | The list-item shape: every documented field present, badges carrying service + listing id + date, an **unmatched** title falling back to its raw extracted text, `name` never `undefined`, and a missing date yielding a `null` label rather than an invented one. |
| **`T-LIST-032`** | U | `tmdb_genres` parsing never defaults a genre: `[]` stays `[]` (US-019 AC-6), a **corrupt** blob yields `[]` rather than a 500 that would take the owner's whole list down, and non-string entries are dropped. |
| **`T-LIST-033`** | U | A stored date renders as its own calendar day. Guards the off-by-one that a local-time getter produces on any host west of UTC — a date that is simply wrong and that nobody would connect to a timezone. |
| **`T-LIST-034`** | U | `dateAddedLabel()` always contains **"to nextup"** (REQ-061), never renders a bare `Added <date>`, renders every month as a name, does not shift with the host timezone, and **refuses** a malformed date rather than rendering "Invalid Date". ⚠ This is the DOMAIN half. `T-LIST-018` (layer C, TASK-035) still owns the assertion that every **rendered** label carries the marker, and remains unimplemented. |
| **`T-LIST-035`** | U | The DETAIL-item shape (§6.3, TASK-034): the list item's fields plus `removedListings[]`, `createdByBatchId` and `createdAt`. ⚠ Its load-bearing case is the **active/removed split** — `badges` must be built from the active listings alone even though the handler is handed all of them, or a service that no longer holds the title gets its badge back in the one view that shows the removal beside it. `removedAt` is a **timestamp**, not a date, because the removed view is an ordered log (REQ-028) in which two removals on one day must stay distinguishable. `T-LIST-028` (layer I) owns the endpoint's owner-scoping and its 404-never-403 refusal. |
| **`T-API-018`** | U | `limit` is bounded 1..200, defaults to 50, and out-of-range is **refused rather than clamped** — clamping returns a page the caller did not ask for and gives no hint why the remaining rows are missing. |

`T-API-017` (§11.2) gained its implementation here, at both layers: the decoder
is unit-tested (`T-API-017a`–`k`) and the refusal is asserted through the real
app (`T-API-017l`–`o`).

⚠ **The re-encode comparison in `decodeCursor` is load-bearing.** Node's base64
decoder is lenient, so a tampered cursor frequently decodes to the same bytes
as the original and sails through a shape-only check. Mutation-tested:
removing it fails `T-API-017i` and nothing else, which is exactly the point —
without that one assertion, "tampered" becomes undetectable for every input
that happens to parse.

---

## 14. Tests defined by the CI-sealing sweep and the TASK-032 correction (`A48`)

### 14.1 `T-SEED-001` – `T-SEED-003` — TASK-032's real done-when

**TASK-032's "Done when" cited `T-META-003`, and that was a mis-citation.**
TASK-032 builds `tests/fixtures/seed.ts` (a deterministic seed, an `asOwner`
helper and an injected clock); `T-META-003` asserts that every decision claimed
as verifiable resolves to a test id that exists in *this* file. The two are
unrelated, and that is precisely **why `T-META-003` went unwritten for so
long** — the task that was supposed to deliver it could not, so the status gate
correctly refused the task and nobody could tell which of the two was wrong.
`T-META-003` has since been delivered independently (`tools/check-decision-verifiability.mjs`).

A "Done when" that cannot be satisfied by doing the task is worse than a
missing one: it looks like coverage, so nobody goes looking.

| id | L | Assertion |
|---|---|---|
| **`T-SEED-001`** | U | Seeding twice from the same seed value produces byte-identical rows — ids, `dateAdded` values and ordering included. A fixture that is *nearly* deterministic produces tests that fail once a week and get retried rather than read. |
| **`T-SEED-002`** | U | `asOwner` stamps the **owner principal** derived by `ownerId.ts`, not a literal — so a change to owner derivation breaks the fixture loudly instead of leaving the suite asserting against an owner that no longer exists. |
| **`T-SEED-003`** | U | The injected clock is the **only** source of time in seeded rows: with the clock frozen, no seeded timestamp equals the real wall clock. `Date.now()` reached for directly inside the seed is the defect this catches, and it is invisible until a date-boundary test fails at midnight. |

### 14.2 The egress guard is now installed globally, not per-suite

`tools/egress-guard.mjs` existed and was proven correct by
`tests/infra/noEgress.spec.ts`, but **nothing switched it on**: the root
`vitest.config.ts` had no `setupFiles`, so `T-CI-007` proved the guard *works*
while proving nothing about whether the run was actually sealed. It was not.
A throwaway spec fetching `api.themoviedb.org` reached the live network in
196 ms.

`vitest.setup.ts` now installs it in **every** root project and in the web
project. Two properties are load-bearing:

* **`tests/infra/noEgress.spec.ts` is excluded by name.** It installs and
  uninstalls the guard deliberately and asserts `isEgressGuardInstalled()` in
  both states; pre-installing underneath it would break the very test that
  proves the guard works.
* **Ordering in `apps/web/vitest.config.ts` is deliberate.** The root setup
  runs **before** `./test/setup.ts`, so an interceptor such as `msw` installs
  *above* the guard and a faked request never reaches it. Reversed, the guard
  would wrap the interceptor and block the requests the fakes exist to serve.

⚠ **Known limitation, deliberately not chased.** The guard patches
`globalThis.fetch` and the `node:http` / `node:https` **module objects**. A
named ESM import — `import { request } from 'node:http'` — binds to a snapshot
taken at instantiation and **bypasses the guard**; verified, not assumed. This
is not fixable from the guard: builtin ESM namespace bindings are read-only.
The static gate `npm run check:outbound` (`T-SEC-031`) is what covers that
route, by refusing any source file that contacts a host outside the
three-destination allow-list. **Do not treat the runtime guard as sufficient on
its own** — the two gates are complementary and both must stay.

---

## 15. TASK-101 — suppression (`POST /api/titles/:titleId/suppress`)

### 15.1 The second done-when mis-citation (`A48`)

TASK-101's "Done when" cited **`T-SUP-002`**, which is US-028 AC-2: *a
suppressed work in a later batch is filtered before any record is created.*
That is the **extraction gate** (`specs/ai.md` §5) — it needs a batch, an
extraction pass and reconciliation, none of which TASK-101 builds and none of
which it depends on (deps are 015 and 017). `T-SUP-003`, its sibling in the
same story, is already correctly assigned to **TASK-103**; `T-SUP-002` belongs
with it.

This is the **second** occurrence of the same defect class in one sweep — see
§14.1 for TASK-032. Both share a shape worth naming: **a task whose done-when
names a test that the task's own dependencies cannot satisfy.** It is not
detectable by `check:test-ids` (the id exists) nor by `check:status` (the
ledger is consistent), because both check that the id is *real*, not that it is
*reachable*. The visible symptom is a test nobody writes, in a task nobody can
close.

TASK-101 is re-pointed to the five tests it can actually discharge:
`T-SUP-001`, `T-SUP-010`, `T-SUP-012`, `T-SUP-013`, `T-SUP-014`.

⚠ **`T-SUP-011` (US-027 AC-2) is deliberately NOT claimed and is currently
unowned.** It requires the work to be absent from *"the combined list and any
review pass"*. The list half is asserted here as `T-SUP-011a`, but the review
half needs an open batch's review, which TASK-105 builds. **Do not mark
`T-SUP-011` discharged on the strength of the list half alone** — that would
repeat exactly the defect this section documents. Whichever task delivers
review must claim it.

### 15.2 Suffixes added

| id | L | Assertion |
|---|---|---|
| `T-SUP-001a` | I | The response key is `supp:` + the work identity, spelled out independently of the constant that produces it |
| `T-SUP-001b` | I | **Neither the title id, the listing id nor the batch id appears in the stored key or identity** — product invariant 1 as an assertion |
| `T-SUP-001c` | I | A foreign owner's title answers **404, not 403**, and writes nothing |
| `T-SUP-001d` | I | An unknown title id answers 404 and writes nothing |
| `T-SUP-001e` | U | `suppressionIdFor` maps identity → `supp:<identity>` for `tmdb:movie`, `tmdb:tv` and `unmatched` |
| `T-SUP-001f` | U | It is **pure** — no clock, no randomness, no counter. Were it not, the route would mint a new document per press and idempotency would go with it while every single-call test still passed |
| `T-SUP-001g` | U | Distinct identities never collide; `tmdb:movie:1` vs `tmdb:tv:1` is the pair a scheme dropping the media type would merge |
| `T-SUP-001h` | U | A **row id is refused, not silently accepted** — a ULID, an already-prefixed id, and malformed identities all throw |
| `T-SUP-010a` | I | The suppression row is created active, owner-scoped, with `unsuppressedAt` null |
| `T-SUP-010b` | I | The display snapshot is **frozen by copy**, so the suppressed view renders after the title is gone (US-029 AC-1) |
| `T-SUP-010c` | I | An **unmatched** title can be suppressed (OQ-015 closed) and snapshots its raw text |
| `T-SUP-010d`–`f` | U | `toDisplaySnapshot` for matched, unmatched, and the metadata-less last resort |
| `T-SUP-011a` | I | The work leaves the **combined list** (the list half of AC-2 only — see the warning above) |
| `T-SUP-012a` | I | Title and **both** listings keep `state: 'active'` and a null `removedAt`; nothing is deleted (REQ-028) |
| `T-SUP-013a` | I | A repeat press is 200, reports `alreadySuppressed: true`, and leaves exactly one row |
| `T-SUP-013b` | I | A repeat press **does not rewrite `suppressedAt`** |
| `T-SUP-013c` | I | Re-suppressing a **lifted** suppression re-arms the same document rather than creating a second |
| `T-SUP-014a` | I | Suppressing a two-badge title hides the **whole row** |
| `T-SUP-014b` | I | A **different** work on the same services is untouched |

### 15.3 What the mutation testing showed

`T-SUP-001` is strongly pinned: keying the suppression on the title id instead
of the work identity fails **six** tests across both layers.

⚠ **Idempotency is guarded by two defences that MASK EACH OTHER under
mutation, and this is deliberate.** Removing *either* the already-active early
return in the route *or* the `active: false` predicate in
`reactivateSuppression` leaves all 249 tests green — the surviving defence
covers for the other (the create then fails on the unique index and is caught
as idempotent). Removing **both** fails `T-SUP-013`, so the property is
genuinely asserted and the suite is not vacuous.

The consequence to know before refactoring: **no single test names the
mechanism.** If you delete one defence the suite will tell you nothing, and the
next person to delete the second will see a failure whose cause is two commits
old. Keep both, or replace them with one mechanism and say so here.

`T-SUP-014b` exists because `T-SUP-014a` alone is satisfied by a suppression
scoped to the **service** rather than the work — that would empty the list
entirely and still pass. The two are only meaningful together.

### 15.4 A trap for integration suites

The owner id **must be read from `GET /api/me`, never constructed**. It is a
one-way function of the principal (`ownerId.ts`), so a literal such as
`asOwnerId(\`${ISSUER}|${SUBJECT}\`)` seeds rows under an owner no request is
ever scoped to. Every assertion then fails as a **404 that looks exactly like a
routing bug** — the handler is fine, the fixture is invisible. `titles.spec.ts`
already carried the warning; this suite hit it anyway.

---

## 16. TASK-041 (freshness) — and the mis-citation pattern, third occurrence

### 16.1 The third mis-cited done-when

TASK-041 cited **`T-LIST-014`, `T-LIST-015`** — US-020 **sort-date** tests
(`sortDateAdded` = earliest `dateAdded` across non-removed listings). They have
nothing to do with `serviceState` or REQ-039. Corrected to **`T-FRESH-010`,
`T-FRESH-012`, `T-FRESH-013`, `T-FRESH-015`**, which is what §9's US-022 table
had all along.

That makes **three in one sweep**, and the shape is identical every time:

| Task | Cited | What the cited test actually is |
|---|---|---|
| TASK-032 (seed fixture) | `T-META-003` | A spec-hygiene meta test. Unrelated. |
| TASK-101 (suppress route) | `T-SUP-002` | The *extraction* gate — needs a batch and reconciliation. |
| TASK-041 (serviceState) | `T-LIST-014/015` | US-020 sort-date, a different user story. |

**The pattern is: a task whose done-when names a test its own dependencies
cannot satisfy.** The failure mode is not a wrong id — it is a test nobody
writes, inside a task nobody can close, because the only honest way to satisfy
the cited id is to build a different task first.

⚠ **Neither `check:test-ids` nor `check:status` can see this.** Both confirm the
id is *real*; neither confirms it is *reachable from this task*. The id exists,
the row parses, the gates stay green, and the work silently cannot be finished.
Three occurrences is a pattern, not bad luck — **a gate for this class is worth
building**: for each task, assert that every cited test id appears in a §9 row
whose user story is reachable from that task's own dependency closure.

### 16.2 The orphans this exposed, and why TASK-016 is NOT their home

Striking `T-LIST-014/015` from TASK-041 left them cited by no task at all, so
US-020 AC-1/AC-4/AC-5 had no owner. They are re-homed to **TASK-036**
(`todo` — ordering, `dir`, tie-breaker), which is the task that makes
`sortDateAdded` observable *through the API*.

⚠ **Not TASK-016.** §1545 records that an earlier sweep tried exactly that and
it would have discarded eight passing assertions and reopened a finished task.
TASK-016 owns the **unit-level** derivation and is closed by `T-INV-009`/
`T-INV-010`; `T-LIST-014/015` assert the same behaviour **through the list
endpoint**. Same behaviour, two levels, two owners — that is deliberate, and
collapsing them loses the level that catches a correct derivation wired into
the wrong query.

### 16.2a The fourth instance — caught in the act, on this very task

TASK-041's corrected done-when initially read `T-FRESH-010`, `T-FRESH-012`,
**`T-FRESH-013`**, `T-FRESH-015`. That was about to repeat the pattern §16.1
had just finished documenting.

§9 defines `T-FRESH-013` at level **I** as *"abandoned/failed batches never
update `serviceState`"* — an assertion about the **write** path. TASK-041 builds
the **read** endpoint. `upsertServiceState` exists in the repository but is
**called from nowhere**: nothing writes `serviceState` at all until the
transactional close (**TASK-072**) lands. So the property is not merely
unproven, it is currently **unfalsifiable** — every batch, applied or
abandoned, leaves the date untouched, so a test would pass for the wrong
reason and go on passing until TASK-072 quietly broke it.

`T-FRESH-013` is therefore re-homed to **TASK-072**, the only writer, and the
read-path assertion originally labelled `T-FRESH-013a` is renamed
**`T-FRESH-012f`**.

⚠ **The tell is worth internalising, because the id was not obviously wrong** —
unlike the other three it was in the right user story, the right feature, and
the right numeric family. What gave it away was checking whether anything could
*make it fail*. **An id whose behaviour has no writer yet is a passing test that
asserts nothing**, and it is far more dangerous than an obviously mismatched
citation, because it goes green immediately and nobody looks again.

**Before citing a test id, find the code path that would make it fail. If there
is none, the id belongs to the task that will build that path.**

### 16.3 `T-FRESH-015` — guarding an absence

A46 **deleted** US-022 AC-2 rather than rewording it, which is what left the
retired staleness nudge guarded by nothing. Every other US-022 test asserts the
parts of the label that stay, so all of them still pass if
`serviceFreshnessLabel` is reworded from `"Max updated 47 days ago"` into
`"Max updated 47 days ago — time to update?"`.

`T-FRESH-015` therefore asserts the **forbidden wording directly**, and asserts
that the phrasing does not change with age so no threshold can be reintroduced
without a visible failure. Mutation-proven: that exact reword fails
`T-FRESH-010e`, `T-FRESH-015a` and `T-FRESH-015b`.

It is attached to no AC on purpose — an absence has no acceptance criterion.
That is also why it is listed explicitly in §9's US-022 table with `—` in the
AC column, so `check:decisions` cannot report it as an unmapped stray.

### 16.4 The enumeration drives the response, not the store

`GET /api/service-state` returns **one entry per service in `SERVICES`**, never
one per stored row. A never-captured service must arrive as
`lastCompletedBatchAt: null` → `"Max has never been updated"`.

⚠ The SPA renders one chip per array entry, so a service omitted because it has
no row makes its chip **vanish** — and a missing chip reads as "nothing to
report" rather than "never updated", which is the precise misreading US-022
AC-3 exists to prevent. Mutation-proven: filtering to stored services only
fails **four** tests (`T-FRESH-012c/012d/012e`, `T-FRESH-013a`).

⚠ The mixed case is the one that hides the bug. A handler mapping over the store
returns a single entry and still passes every single-service assertion, so
`T-FRESH-012d` captures one service and asserts the *other* is present.

### 16.5 `ageInDays` counts calendar days, not 24-hour blocks

Computed on **UTC day boundaries**. A batch completed at 23:00 and read at 01:00
is **1 day**, which is what the owner sees on a calendar; the naive
`(now - from) / 86400000` reports **0** and labels it "today". Mutation-proven
(`T-FRESH-010b`, `T-FRESH-010c`).

Clamped at zero: clock skew between the database and the container can put
`lastCompletedBatchAt` marginally in the future, and *"updated -1 days ago"* is a
bug report. Mutation-proven (`T-FRESH-010d`).

### 16.6 Suffix table

| Id | Where | Asserts |
|---|---|---|
| `T-FRESH-010a-d` | `packages/domain/test/freshness.spec.ts` | `ageInDays`: same-day, calendar boundary, month boundary, skew clamp |
| `T-FRESH-010e-f` | same | label wording; `1 day` is singular |
| `T-FRESH-010g-h` | `apps/api/test/unit/serviceState.spec.ts` | date + batch id surfaced; `now` injected so `ageDays` is deterministic |
| `T-FRESH-012a-b` | `packages/domain/test/freshness.spec.ts` | `null` → "never updated"; display name capitalised |
| `T-FRESH-012c-e` | `apps/api/test/unit/serviceState.spec.ts` | every service present; one captured does not mask the other; unknown stored service ignored |
| `T-FRESH-012f` | same | an empty store yields nulls — no date is invented |
| `T-FRESH-015a-b` | `packages/domain/test/freshness.spec.ts` | A46: no nag wording; phrasing constant with age |
| `T-FRESH-015c` | `apps/api/test/unit/serviceState.spec.ts` | A46: the payload's key set is exact — no `stale` flag can be added silently |

---

## 17. The integration harness must name CI's database, not "nextup"

`apps/api/test/integration/harness.ts` fell back to
`database=nextup` when `DATABASE_URL` was unset, while CI creates and uses
**`nextup_test`**. Corrected to `nextup_test`.

This is worth a section because of how it fails. CI creates its database with
an explicit `COLLATE Latin1_General_100_BIN2`; a database created any other way
— `prisma migrate` against a fresh name, a stray `CREATE DATABASE`, a developer
following a README — silently gets the **server default**,
`SQL_Latin1_General_CP1_CI_AS`.

On such a database Prisma's `create()` joins its
`DECLARE @generated_keys table([id] NVARCHAR(200))` variable, which takes the
**database default** collation, back against the **BIN2** `[id]` column. Every
insert then fails with **Msg 468, "Cannot resolve the collation conflict"**.

⚠ **The symptom points at the wrong layer.** Observed locally: **74 integration
failures**, every stack ending at `ownerData.ts:118` via `batches.ts:89`. It
reads unmistakably as an application bug in the batch-create path, and two
separate lanes independently reported it as one. Nothing in that output names
provisioning. The only test that tells the truth is **`T-INV-018a`** — *"the
database default collation is `Latin1_General_100_BIN2`"* — and it is a single
line buried among seventy-odd others.

**If `T-INV-018a` fails, stop and fix the DATABASE. Every other failure in that
run is downstream of it and none of them should be investigated.**

Two databases on one server is what made this survive: `nextup_test` existed
with the correct collation *and* `nextup` existed with the default, so the
server looked healthy, `docker ps` looked healthy, and the collation query
returned the right answer — as long as you asked about the right database. The
harness default was the only thing choosing the wrong one.

Diagnosis order for a wall of 468s:

```sql
SELECT name, collation_name FROM sys.databases;
```

Every database the tests touch must read `Latin1_General_100_BIN2`. Recreate
any that does not — the collation cannot be changed in place once BIN2 columns
exist:

```sql
CREATE DATABASE [nextup_test] COLLATE Latin1_General_100_BIN2;
```

---

## 18. TASK-027 (Easy Auth) — a level-`E` "Done when", and what CI can honestly assert

TASK-027's own "Done when" column names `T-AUTH-001`, `T-AUTH-002` and
`T-AUTH-003`. All three are level **`E`**: Playwright driving a real sign-in
against a **deployed** revision. None of them can run in CI, and `tests/e2e/`
is empty, so citing them on a task marked `done` would have meant one of two
things — either `check:status` fails (the honest outcome), or somebody writes
three files named after them that assert something else entirely and every
gate goes green. That second outcome is exactly the failure `check-test-ids`
was built for, arriving through a different door.

Applying §16.2a — *before citing a test id, find the code path that would make
it FAIL* — the answer for `T-AUTH-001/002/003` is "a browser talking to
Azure", which no CI job has. So they are **struck through** in the backlog's
"Done when" cell (the convention: corrected in place, the superseded text
retained and dead) and **`T-INFRA-008`** takes their place as the assertion
CI actually runs. The `E`-level three remain the deployment-time definition of
done and are named in the struck-through text so they are not lost.

This is the same shape as `T-INFRA-004`, which asserts the blob-lifecycle
**rule exists and is correctly shaped** rather than asserting that a blob was
purged 30 days later. Configuration is what an infrastructure task delivers,
and configuration is assertable.

### 18.1 Why every mutation in `easyAuth.spec.ts` is silent

`tests/infra/easyAuth.spec.ts` feeds `authPolicyViolations()` a deliberately
broken template for each rule. What makes the file worth its length is that
**every one of those mutations deploys successfully** and leaves an app that
behaves normally for the owner:

| Mutation | What the owner sees | What is actually true |
|---|---|---|
| `platform.enabled: false` | Signs in fine — the browser still has a cookie | Everyone else does too |
| `unauthenticatedClientAction: 'AllowAnonymous'` | Nothing changes | The app is public |
| name is not `current` | Deployment succeeds | Easy Auth reads one config per app and **ignores the rest without an error** |
| `excludedPaths: ['/api/*']` | Sign-in still required for pages | The entire list is readable unauthenticated |
| a literal `clientSecret` | Works | A credential is committed to a **public** repository |
| `clientSecretSettingName` drifts from the `secrets` entry | *(this one is loud)* | Nobody can sign in, including the owner |

The `excludedPaths` row is the important one. It is evaluated at the platform
edge, **before any application code runs**, so `T-SEC-010`, `T-SEC-014`,
`T-SEC-016` and every other allow-list test still pass — the middleware they
exercise is simply never reached. ADR-0002 names this class ("it fails
silently, because everything appears to work for the owner"); this is a second
instance of it that the ADR does not name, and it is not reachable from any
application-level test.

`T-INFRA-008e` exists for a smaller reason: the obvious implementation of the
name check is a substring test for `current`, which passes `currentish`. The
compiled ARM name is an expression — `[format('{0}/{1}', …, 'current')]` — so
splitting on `/` is also wrong (the format string contains one). The check
matches the **quoted literal**.

### 18.2 ✅ RESOLVED at TASK-007, then CORRECTED against a live deployment

**Correction (2026-08-18, first real staging deployment).** The resolution
below asserted a **302**. That is wrong for Container Apps, and it was wrong on
the basis of a plausible inference rather than an observation. Measured against
a correctly configured live revision (`RedirectToLoginPage`, `excludedPaths`
null, provider enabled):

```
$ curl -s -D - https://<fqdn>/api/titles
HTTP/1.1 401 Unauthorized
www-authenticate: Bearer realm="<fqdn>" authorization_uri="https://login.microsoftonline.com/common/oauth2/v2.0/authorize" resource_id="<clientId>"
x-ms-middleware-request-id: 5bf0eb83-...
<empty body>
```

**Container Apps Easy Auth answers 401 with a `WWW-Authenticate` challenge, not
a 302** — and it does so regardless of the `Accept` header, so this is not the
usual browser-versus-API branch. `/.auth/login/aad` is what returns the 302.
`unauthenticatedClientAction: RedirectToLoginPage` remains correct and stays;
it governs the sign-in route, not the API challenge.

This matters more than a status code, because the old assertion's own stated
purpose was to detect `/api/*` being added to `excludedPaths` — and **a status
code cannot detect that at all**: `401` is *also* exactly what the application
returns when it sees no principal. Had the spec's 302 assertion been "fixed"
later by relaxing it to 401, the suite would have gone green while the owner's
list was being served at the edge.

`T-SMOKE-001`/`002`/`003` therefore assert the response is **from the
platform**, which the application cannot imitate:

| Marker | Why the app cannot produce it |
| --- | --- |
| `x-ms-middleware-request-id` | Stamped by the Easy Auth middleware. |
| `www-authenticate` naming `login.microsoftonline.com` and the Entra app | The app has no client id and issues no challenge. |
| **A zero-length body** | Every application refusal carries the JSON error envelope. |

`T-SMOKE-004` was added at the same time. The other three prove that *nothing
is reachable*, which is also true of a deployment where **sign-in is
impossible** — a wrong client id, a deleted app registration or a broken
provider block all present as "everything is refused". Asserting only refusal
cannot tell a secured deployment from a bricked one, so `T-SMOKE-004` asserts
`/.auth/login/aad` returns 302 to the Microsoft IdP **with a callback URI
belonging to this deployment**.

Verified: 4/4 pass against staging.

~~Superseded — the ADR-0002 reasoning below stands; only the expected status
code was wrong.~~

~~**Resolution (2026-08-17, TASK-007 — this section's own condition for closing
was "the smoke suite is TASK-007's deliverable"; it now exists).** Option (a)
below is taken. `RedirectToLoginPage` **stays**, and `T-SMOKE-001` is
re-specified to assert **302 to `login.microsoftonline.com`**, implemented in
`tests/smoke/smoke.spec.ts`.~~

Option (b) was rejected on ADR-0002 grounds: switching to `Return401` would
put a sign-in redirect back into application code, which is the exact thing
"zero application auth code" exists to prevent. Nothing in the SPA currently
depends on a 401 from the edge, so (a) costs nothing.

⚠ The assertion is now **load-bearing in the opposite direction**: a 401 or a
200 from `/api/titles` at the edge is the signature of `/api/*` having been
added to `excludedPaths`, i.e. the owner's list published to the internet.
`T-SMOKE-001` failing that way is not a broken test.
~~Corrected above: the platform's own refusal IS a 401, so the signature of an
`excludedPaths` bypass is a 401 **carrying a body and no platform headers** —
not the status code.~~

~~Superseded — retained for the reasoning, which is still correct:~~

~~`specs/security.md` §2.1 fixes the mechanism as
`unauthenticatedClientAction: RedirectToLoginPage`, and TASK-027 is built to
it. But §11.2 defines **`T-SMOKE-001`** as *"unauthenticated `/api/titles`
returns 401 JSON"* against the deployed revision — and Easy Auth's redirect
action is **global**. It has no per-path variant, so an unauthenticated
`/api/titles` at the edge answers **302 to the Microsoft sign-in page**, not
`401 JSON`. `T-SMOKE-001` as written cannot pass against a correctly
configured deployment.~~

Both halves are individually right and only one of them can hold:

- `RedirectToLoginPage` is what makes US-001 AC-1 a platform property.
- A JSON API answering a fetch with an HTML redirect is a real defect for the
  SPA, and `T-SEC-005` asserts 401-vs-403 stay distinct **inside the
  application chain** — which is unaffected, because that suite runs the
  Express app directly, with no Easy Auth in front of it.

⚠ **Do not "fix" this by adding `/api/*` to `excludedPaths`.** That is the
bypass in the table above; it would make `T-SMOKE-001` pass by publishing the
owner's list. The two real options are (a) keep `RedirectToLoginPage` and
re-specify `T-SMOKE-001` to assert a 302 to `login.microsoftonline.com`, or
(b) switch to `Return401` and have the SPA navigate to
`/.auth/login/aad?post_login_redirect_uri=…` itself — which reintroduces a
piece of application auth code ADR-0002 exists to avoid.

Left open deliberately rather than decided here: the smoke suite is
**TASK-007**'s deliverable, it does not exist yet, and inventing its behaviour
from an infrastructure task is how a spec acquires a contradiction it cannot
later see. Recorded so TASK-007 meets it as a decision instead of a bug.
### 18.3 `T-INFRA-005m` was a proxy, and TASK-027 broke it

`T-INFRA-005m` asserted `configuration.secrets` was **empty**. That was never
the property it was named for — it was a proxy for *"no registry credential"*
that happened to hold because the app had **no secrets at all**. Easy Auth's
client secret is the first legitimate one (ADR-0002 makes it mandatory), so
the assertion failed the moment TASK-027 landed.

This is the shape to watch for: a guard that passes for a reason narrower than
its name, whose two obvious exits are both wrong. Deleting it drops a real
protection (`ghcr-token` is exactly the credential ADR-0003 R8 removed);
"fixing" the code to satisfy it would mean not configuring Easy Auth, or
smuggling the secret somewhere it does not belong.

It is now narrowed to the property that survives: `registries` is empty (so no
secret **can** feed a registry — `T-INFRA-005r` covers the other half), and the
secret **inventory is closed** — exactly one, and it is the one the authConfig
references by name. `T-INFRA-005s` is the new mutation: a `ghcr-token`
arriving alongside the Easy Auth secret, which is how the regression would
really happen, and which the `registries` check alone does not see because the
credential appears before the entry that uses it.
### 18.4 The ledger's blind spot runs in BOTH directions

`check-status.mjs` falsifies *"done but the tests are absent"*. It cannot
falsify the opposite — **done work still recorded as `todo`** — because a
task with no claim has nothing to check.

That direction is not harmless. `docs/status.md` §"Ready to start" is what
tells an agent which work is unblocked, so a delivered task sitting at `todo`
is actively advertised as available. TASK-029 and TASK-030 were both fully
implemented (`apps/api/test/integration/security.spec.ts`, 23 cases including
the route-enumeration walk and its own mutation; `tools/check-no-credentials.mjs`
with 24 cases and four false-positive guards) and both were listed as ready.
An agent picking either up would have rewritten a passing, mutation-proven
suite from scratch — and the second version would have looked exactly as
green.

Both are corrected. The general rule: **when a task's named tests all exist
and pass, the ledger is wrong, not the suite.** Check the ledger against the
suite before starting anything the ready list offers, not after.
---

## 19. TASK-035 — `dateAdded` is write-once (`T-INV-006`)

### 19.1 The sole writer is `createServiceListing`, not `createListing`

§9's AC-6 row above and `packages/domain/src/types.ts` both name the exempt
writer **`createListing`**. No such function exists. The real sole writer is
**`createServiceListing()`** in `apps/api/src/repository/ownerData.ts`, and
`tools/check-write-once-date-added.mjs` encodes that name (`ALLOWED_WRITER`).

The drift is recorded here rather than repaired in §9 because the spec is the
input to the work, not an output of it — but a reader comparing the two must
know which one the gate actually enforces. **If `createServiceListing` is ever
renamed, the exemption evaporates rather than silently widening to the whole
file**: `functionBodyRange()` returns `null` when the function is absent and
the caller treats that as "nothing is exempt". `T-INV-006e` is that guard.

### 19.2 What the static gate cannot see, and what covers the gap

`T-INV-006` reasons about source text. It catches `.dateAdded =` and a literal
`dateAdded` key inside a Prisma `update` / `updateMany` / `upsert`. It **cannot**
see a value reaching an update through a spread of a variable —
`softDeleteServiceListing` writes `data: { state: 'removed', ...removal }`, so a
`dateAdded` added to that object's type would pass the scan.

That residual path is covered behaviourally by **`T-DATE-011`** (seeing the same
listing in a later batch does not change `dateAdded`). **Neither test replaces
the other**; deleting either leaves a real hole, and the static half is the one
that fails at the moment the offending line is written rather than at the moment
a second capture happens to exercise it.

⚠ The adjacent field **`dateAddedEdited`** (REQ-059, always `false` in v1 per
`T-INV-007`) is legitimately assignable. A prefix match on `.dateAdded` fires on
it, and the cheapest way to silence that false positive is to weaken the real
rule. The assignment pattern therefore carries an explicit negative lookahead,
and `T-INV-006f` fails if it is ever dropped.

### 19.3 `T-LIST-018` was mis-cited to TASK-035 — a dependency-ordering defect

TASK-035's "Done when" named `T-LIST-018` (layer **C**: *every **rendered** date
label contains "to nextup"*). TASK-035 is a server-side task. The component that
renders the label — `apps/web/src/components/TitleRow.tsx` — is built by
**TASK-038**, which was still `todo` when TASK-035 came up; `ListPage.tsx` was a
seven-line stub. There was therefore **no rendered label in the product that
`T-LIST-018` could have failed on**, and any implementation of it at TASK-035
would have had to invent the component it asserts against, or assert against a
fixture — passing without testing the product.

This is a sixth mis-citation, and a **new shape**: the id is correct and the
level is correct; the *dependency* is wrong. TASK-035's row lists `033` only.

Resolution follows the TASK-027 precedent: `~~T-LIST-018~~` is struck in place in
TASK-035's row and relocated to **TASK-038's**, where the component lands. The
domain half is already delivered and asserted by `T-LIST-034`, and the
server-side `dateAddedLabel` half of TASK-035's description is delivered and
asserted by `T-LIST-011c` — so nothing is lost by the move, only correctly
placed.

Neither `check:test-ids` (are the cited ids defined?) nor `check:decisions` (are
the decisions' tests defined?) nor `check:status` (do a done task's tests exist?)
detects this class: every id involved is real, defined and at a plausible level.
Six occurrences now. A gate for it remains the highest-value meta-work unbuilt.
---

## 20. TASK-036 — list ordering (US-020)

### 20.1 Four ordering ids were owned by no task at all

`T-LIST-017`, `T-LIST-025`, `T-LIST-026` and `T-LIST-027` are defined in §9 —
they carry US-020's AC-2, AC-6 and AC-7 — and were cited in `docs/backlog.md`
by **no task whatsoever**. A grep of the work order for each returned nothing.

That is a **seventh** finding and a second new shape. The previous six were
*mis-citations*: a task pointing at the wrong id. This is the inverse — a
defined, acceptance-criterion-bearing test that no task claims, so no agent
will ever be asked to write it. It is strictly worse, because a mis-citation
at least stops the wrong task from closing, whereas an orphan is invisible:
every gate passes, the ledger reaches 100%, and three acceptance criteria are
simply never implemented.

⚠ **No gate detects this, and `check:test-ids` in particular cannot.** That
gate walks from the backlog to this file — *are the ids the work order cites
real?* An orphan is real; nothing cites it. The mirror walk (from §9's AC
tables back to the backlog: *does every id with an AC row have an owning
task?*) does not exist. `check:decisions` is a different mirror again — it
walks the A-decision tables, not §9. **This is now the highest-value unbuilt
gate, and it should be built to look in the §9 → backlog direction**; the
mis-citation class and the orphan class would both fall out of the same walk.

Resolution follows §17's precedent for the orphaned `T-LIST-014/015`: the four
are adopted into **TASK-036**, which is the task that makes ordering
observable through the API, and its "Done when" is extended a second time.
`T-LIST-026`'s partner `T-UI-024` stays with TASK-166 — that is the
affordance-existence half and needs the unbuilt `SortControl.tsx`.

### 20.2 Two live bugs, both silent, both in the default path

The backlog row for TASK-036 already said *"`title.id` ascending tie-breaker,
nulls last"*. The implementation shipped with TASK-033 did neither, and every
test in the suite passed.

**(a) `orderBy: [{ sortDateAdded: dir }, { id: dir }]`.** It reads as
symmetric and correct. It is not: the tie-breaker **flips with the sort
direction**, so reversing the list reshuffles every group of rows sharing a
date. A first import gives *every* title the same date (`T-DATE-012`), so the
tied group is typically the whole list, not a corner case.

Worse, the same `dir`-dependent operator was used in the **keyset predicate**.
A keyset must mirror its `ORDER BY` exactly. With `ORDER BY … id ASC` and a
predicate asking for `id < cursor.id`, page 2 of a tied group is **empty** —
rows vanish, no error is raised, and the owner sees a short list. Losing rows
silently is the one failure this product is designed against. `T-LIST-026e`
walks a five-row tied group two at a time and asserts all five arrive exactly
once; it fails under the original code.

**(b) Null placement was left to the dialect.** SQL Server sorts `NULL`
**first** on `ASC` and **last** on `DESC`. So "nulls last" was free in the
default direction and wrong the moment the owner used the oldest-first
control — which product invariant 6 makes `must`, not optional. The fix states
it explicitly (`nulls: 'last'`); `T-LIST-027b` is the guard. ⚠ Prisma's
generated types offer `nulls` for every connector, so accepting the option is
**not** evidence the connector emits it — SQL Server has no `NULLS LAST`
syntax and needs a `CASE` expression. That it works was verified against a
live SQL Server before being relied on, and `T-LIST-027b` keeps verifying it.

### 20.3 Why a comparator exists for an order computed in SQL

`packages/domain/src/ordering.ts` does not order the list — ordering in the
application would mean reading every row before paging, which §3 forbids. It
exists because the rule has three parts (key, tie-breaker, null placement)
that SQL states *implicitly*, in dialect defaults invisible at the call site.
Writing it once as a total order gives the integration suite something to
check the database against, instead of a hand-written expected sequence that
agrees with whatever the author believed.

⚠ The cross-check alone would be vacuous if the comparator broke the same way
the query did, so every case that compares the two **also pins one concrete
property directly**. Both halves are mutation-proven independently: three
mutations of the query (tie-breaker follows `dir`, keyset follows `dir`,
`nulls` dropped) and two of the comparator (nulls first, tie-break
descending), each caught by the cases named for it.
---

## 21. TASK-037 — list filters (US-019)

### 21.1 The orphan count is six, not four — and it hid a missing feature

`T-LIST-021` (type filter) and `T-LIST-022` (genre filter) are defined in §9
and were, like the four in §20.1, cited by **no task**. TASK-037's row named
only `T-LIST-020`, `T-LIST-023` and `T-LIST-024`. Both are adopted into
TASK-037.

⚠ **This orphan pair concealed an entirely unimplemented feature.** The genre
filter was parsed and validated in `titlesQuery.ts` — repeatable, trimmed,
length-bounded, de-duplicated — and then **never passed to the query**. The
handler simply did not forward it. So `?genre=Comedy` validated, returned
**200**, and listed every title. There was no test for the genre filter
because the id that would have owned one belonged to no task.

A filter that silently does nothing is worse than one that errors: the owner
reads the unfiltered list as the filtered answer. `T-LIST-022a` is the case
that catches it, and it fails against the previous code.

This is the concrete cost of the orphan class, and it strengthens §20.1's
conclusion: the missing **§9 → backlog** gate is not spec hygiene, it is the
difference between a feature existing and not.

### 21.2 Why the genre match is a quoted token and not `OPENJSON`

Genres are one JSON array in an `NVARCHAR(MAX)` column (`specs/data-model.md`
§16). The literal reading of that storage is
`EXISTS (SELECT 1 FROM OPENJSON(tmdb_genres) WHERE value IN (…))`. It is not
used, because Prisma cannot express a raw fragment inside `where`: adopting it
means hand-writing the *entire* page query — keyset predicate, suppression
anti-join, and the listings `include` — in raw SQL. That is a far larger
surface to get wrong than one quoted token, and the keyset predicate is
precisely the part of this query that has already produced a silent
row-dropping bug once (§20.2).

The filter therefore matches the token `"Name"`, **with its JSON quotes**,
inside the stored text. Three consequences, each with a named guard:

- **The quotes are load-bearing.** Matching the bare name `Drama` also matches
  a title whose only genre is `Dramatic Arts`. `T-LIST-022c` fails if they are
  dropped — a wrong row appearing in a filtered list, which is the least
  visible kind of bug.
- **`genres: []` is excluded by construction.** `"[]"` contains no token, so
  AC-6 needs no special case that could later be forgotten (`T-LIST-024`).
  `T-LIST-024c` separately asserts the payload still reports `[]`, so nothing
  can satisfy the exclusion by quietly defaulting a genre instead.
- **Matching is case- and accent-SENSITIVE**, because the column collates
  `Latin1_General_100_BIN2`. That is correct here — the values come from
  TMDB's fixed vocabulary and the filter bar offers them from the owner's own
  data — but it is a behaviour, not an accident, so `T-LIST-022d` records it.

`GENRE_FORBIDDEN_CHARS` in `titlesQuery.ts` is part of the implementation, not
tidiness. Prisma's `contains` compiles to `LIKE '%value%'` and does **not**
escape LIKE metacharacters, so `?genre=%` would match every title and read as
a filter that had found everything; and `"` or `\` are JSON escapes, which are
stored escaped and so could never match, giving a silent empty result. No TMDB
genre contains any of them. `T-LIST-022f`/`022g` are the guards.

### 21.3 ⚠ Two `OR` predicates cannot be sibling keys

The genre filter is an `OR` across the requested genres. The keyset predicate
is **also** an `OR`. Written as sibling spreads into one Prisma `where`
object —

```ts
...(genres.length > 0 ? { OR: [...] } : {}),
...keyset,                                  // ← replaces the OR above
```

— the second `OR` key silently **replaces** the first. The visible effect is
that page 1 filters and page 2 does not: the owner scrolls and unrelated
titles appear. Nothing errors, and the bug is invisible to any test that does
not page a filtered list. They are combined under `AND` instead, and
`T-LIST-022h` pages a filtered six-row set two at a time; it fails under the
sibling-spread form.

⚠ This hazard is a property of the object literal, not of these two
predicates. **Any future filter expressed with `OR` must join the `AND` array
rather than be spread alongside it.**
---

## 22. The orphan class, measured (TASK-033 reopened)

### 22.1 84 of 347 defined test ids were owned by nobody

`check-test-ids.mjs` walks **backlog → spec**: *are the ids the work order
cites real?* Nothing walked the other way. §20.1 and §21.1 each recorded that
the mirror was the highest-value unbuilt gate; `tools/check-orphan-tests.mjs`
is that gate, and the first run measured the problem:

| | count | share |
| --- | --- | --- |
| ids DEFINED in this document | 347 | — |
| cited by no task in `docs/backlog.md` | 84 | 24% |
| ...and implemented by no suite either | 63 | 18% |

The 63 are the dangerous set: an acceptance criterion with a written test id
that nobody has been asked to build and nobody has built. It fails no gate, it
blocks no task, and the ledger reaches 100% without it. They include every one
of US-021's date-added criteria (`T-DATE-010`-`013`), all five undo criteria
(`T-UNDO-008`-`012`), all five reappearance criteria (`T-REX-010`-`014`) and
all five grouping criteria (`T-GRP-010`-`014`).

⚠ **`T-DATE-011` is among them, and this document cited it as coverage.** §19.2
states that the residual path the write-once static scan cannot see "is covered
behaviourally by `T-DATE-011`". It is not: `T-DATE-011` does not exist. A spec
claiming coverage from a phantom is the same defect as a backlog row citing
one, and it is why the mirror gate had to exist rather than being a tidiness
exercise.

The 63 are listed in `BASELINE_ORPHANS` so the gate can fail on anything **new**
without blocking on a 63-way assignment that would have to guess which task
owns each criterion — and a guess there reproduces the mis-citation class this
project has already hit seven times. ⚠ **The baseline is a ratchet: it may only
shrink.** `T-META-006e` fails if it grows, because "add it to the list" is
otherwise always the cheapest way to make the gate pass, and that reinstates
exactly the silence it exists to break. `resolvedBaselineIds()` reports which
entries have become owned and can be struck.

### 22.2 `T-LIST-013` is double-defined

Line 960 defines it as US-018 AC-4, *"A work with no active listings has no
row"*. Line 1026 assigns the **same id** to US-019 AC-2, *"Hidden from the
list, present in the removed view"*. These are different assertions with
different dependencies — the second needs a removed-view endpoint that does not
exist yet.

This is the second instance of the class (`T-SEC-028` is the first: §9 line 744
vs TASK-141's row). The US-018 sense is implemented in
`apps/api/test/integration/titleGrouping.spec.ts`. **The removed-view half needs
its own id, on the removed-view task** — not this one, which is now closed
against a different meaning.

### 22.3 US-018 AC-4 was not implemented

Writing the orphan produced a live bug on the first run, which is the whole
argument for the gate. `listTitlePage` filtered on `Title.state = 'active'` and
never required a live listing, so a work whose only listing had been removed
**stayed in the list as a row with zero badges** — `badges` derive from active
listings, so it rendered as a title belonging to no service at all.

The fix requires at least one active listing in the query. ⚠ It deliberately
does **not** lean on `Title.state`: that flag is written by the reconciliation
pipeline, so trusting it makes the list's correctness depend on another
component remembering to write a field. `T-LIST-013c` pins the discriminating
case — one removed and one active listing **keeps** its row — because "no
active listings" and "has a removed listing" agree on the simple case and
differ on the one that matters, and the wrong one silently deletes
half-removed works from the owner's list.

### 22.4 The sibling-key hazard has a second form

§21 recorded that two `OR` predicates cannot be sibling keys in a Prisma
`where` — the second silently replaces the first. The same trap applies to
**any** repeated key, and the AC-4 fix walked straight into it: the service
filter already occupies `listings`, so adding the general "has an active
listing" condition as a second `listings` key would have silently disabled the
service filter.

It is therefore expressed as **one** `listings` key with two branches, not two
keys. Mutation-verified: restoring the sibling form fails five existing cases
(`T-LIST-020a`, `020c`, `023a`, `023c`, `023d`). The general rule for this
schema: **before adding a key to a Prisma `where`, check whether a conditional
spread above it already sets that key.**
---

## 23. Query plans, and two errors the harness caught in itself (TASK-047)

### 23.1 Why the plan is read from the cache, not from the session

§9 offers `SET STATISTICS PROFILE ON` / `sys.dm_exec_query_plan`, and §11-R4.1
also mentions `SET SHOWPLAN_XML ON`. **Only the DMV route works here.**
`SHOWPLAN` must be the only statement in its batch and applies to a SESSION;
Prisma pools connections, so the session you set it on is not reliably the
session your query runs on, and the plan you capture is not reliably the plan
you meant. `sys.dm_exec_query_plan` is connection-independent.

Three things make the DMV route trustworthy, and each was needed:

1. **The lookup query must exclude itself.** It names `dm_exec_query_stats`, so
   without a `NOT LIKE` guard it reliably captures its own plan and every
   assertion becomes a statement about the harness.
2. **`UPDATE STATISTICS` after bulk-seeding.** The optimiser reasons from
   statistics, not from rows. Without it the plan can be chosen against an
   estimate of one row — a seek that was picked *because the table looked
   empty* is the exact opposite of a scale assertion.
3. **Both scan forms must be excluded.** `service_listing` has a clustered
   primary key, so a full read appears as a **Clustered Index Scan** and the
   `Table Scan` operator never appears however bad the plan is. Asserting only
   the latter is vacuous.

### 23.2 Two errors in the harness, and what they cost

⚠ **A plan-cache clear placed between running a query and reading its cost.**
`total_logical_reads` is cumulative per cached plan, so the cache has to be
cleared *between* measurements — but clearing it *before* reading the first
measurement returned 0, and the comparison silently degraded into an assertion
against a hard-coded floor. It reported the deep page at 296 logical reads
against a "first page" of 0, i.e. a phantom regression.

That phantom sent a full round of optimisation after a problem that did not
exist: a leading `removed_at <= @cursor` predicate was added to
`listRemovedListingPage` on the widely repeated claim that the bare keyset `OR`
is not sargable on SQL Server, and a confident comment was written explaining
the 296-vs-50 improvement it had made. **It had made none.** Mutating it out
left every case green. It was then measured properly — cursor taken from row
15,000 of 20,000, both forms, plan cache honestly isolated — and the two are
indistinguishable. The predicate and the comment were both removed.

**The rule this repository already had, restated where it bit:** a guard is not
a guard until it has been seen to fail. That applies to *performance* changes
exactly as it applies to tests, and a plausible mechanism plus a number that
moved is not evidence when you have not checked which of the two produced the
number.

⚠ **`T-PERF-001d` originally compared page 1 with page 2.** That tests nothing:
both are cheap under every plan, including one that collapses deep in the list.
It now takes its cursor from row 15,000. The fixture reaches that row with
`OFFSET`, deliberately — the ban is on the PRODUCT paging that way, and a test
that cannot construct the state it is checking is not a test. Mutation-verified:
defeating the keyset predicate makes the "page" return all 20,000 rows.

### 23.3 The index set is built exactly as §16.6 names it, including the one that is useless

`candidate_by_batch (owner_id, batch_id)` is a strict **prefix** of
`extraction_candidate_owner_batch_disposition (owner_id, batch_id,
review_disposition)`, which `0001_init` already created. It therefore serves no
seek the existing index does not, and costs a write on every candidate insert.

It is built anyway, because §16.6 is the authoritative index set and a spec
that looks wrong is a finding to report, not something to quietly not build.
**Reported here as that finding.** Retiring it — or the three narrower init
indexes the §16.6 forms supersede — requires `DROP INDEX`, which `T-MIG-001`
fails the build on (§16.8, additive-only). That is the correct default: an
index is dropped by an explicit reviewed change, never as a side effect of a
performance migration.

### 23.4 `prisma/migrations/migration_lock.toml` was missing

`prisma migrate deploy` tolerates its absence, which is why nobody noticed, but
`prisma migrate diff --from-migrations` cannot determine the connector without
it and **drift detection silently does not work**. Added with
`provider = "sqlserver"`.

### 23.5 Search: what was actually lost

`escapeLikeTerm` escapes its own escape character **first**. Escaping it last
turns `!%` into `!!%` — a literal `!` followed by a live wildcard — so the
guard leaks exactly the metacharacter it exists to neutralise
(`T-PERF-001h`).

Escaping is a **correctness** control, not only a safety one: `LIKE` treats
`%`, `_` and `[` as syntax, so searching for `100%` unescaped matches every
row. Parameterisation is the separate SQL-injection control, and both are
required — escaping without parameterisation is still injectable,
parameterisation without escaping still returns wrong answers
(`T-PERF-001g`, `T-PERF-001i`).

The search is **not** index-backed and `T-PERF-001` does not assert that it is:
a leading wildcard cannot use a B-tree and Azure SQL Basic has no `pg_trgm`
analogue. Fuzzy matching and typo tolerance are gone. Full-Text Search is the
named escalation and is an ADR-level decision.
---

## 24. The batch state machine (TASK-054)

### 24.1 New test ids

| Test | L | Asserts |
|---|---|---|
| **`T-BATCH-017`** | U | The transition table in `apps/api/src/services/batchLifecycle.ts` is **total** over `BATCH_STATUSES`, names only real statuses as targets, leaves **no open status a dead end**, and **never leads from a terminal status back to an open one**. The discardable set is exactly the three §6.23 names. Every existing `T-BATCH-*` id asserts an OUTCOME of a transition; nothing asserted the table that decides which transitions exist, so a missing or extra edge would have surfaced only as whichever endpoint happened to be tested next. |
| **`T-BATCH-018`** | I | A status change is applied **conditionally on the source status, in the same statement that writes the new one**. Two concurrent transitions from the same observed status change exactly one row. Without this, `submitBatch` is a read-modify-write across an `await`: two simultaneous submits both observe `draft`, both pass the guard, and one batch is extracted twice. |
| **`T-BATCH-019`** | I | `POST /api/batches/:batchId/submit` (§6.14) answers **202** with `imageCount`, `submittedAt` and `pollAfterMs`; **400 `NO_IMAGES`** on an empty batch, **without moving it**; **409 `BATCH_NOT_DRAFT`** on a second submit, carrying the states the transition is legal from; and **404, never 403**, for another owner's batch. §9 assigns ids to submit's *consequences* (`T-BATCH-013` immutability, `T-EXT-*` extraction) but none to the endpoint's own status codes, so the 202 body and the `NO_IMAGES` refusal were unowned. ⚠ The `NO_IMAGES` refusal is cheap protection for product invariant 2: an extraction over zero images can only report zero candidates, and in `full-update` zero candidates is indistinguishable downstream from a service whose list is genuinely now empty. |

⚠ **`T-BATCH-018a` was vacuous in its first form, and the mutation is what
found it.** It originally fired two simultaneous `POST /submit` requests and
asserted `[202, 409]`. That passed — and passed **identically** with the
`status: from` predicate deleted from the query, because the adversarial
interleaving never occurred: both handlers `await` a load before writing, and
the second load resolved after the first write, so the JavaScript-level check
refused it. **A window that does not open cannot be proven closed.** The case
now drives `transitionUploadBatchStatus` directly from one already-read state,
which is the shape of the bug; `T-BATCH-018c` keeps the end-to-end version but
is explicitly labelled as NOT the discriminating case.

⚠ **`T-BATCH-018c` was also intermittently red for a reason that was not a
race at all, and the diagnosis belongs in the record.** It failed with
`[202, 202]`, and the second `202` was **correct behaviour**: request A wins
the `draft → submitted` transition and answers 202, `beginExtraction` then
drives the batch to `extraction-failed` within microseconds because CI
configures no reader (`T-BATCH-019a` asserts exactly that status), and if
request B's load resolves after all of that, B observes `extraction-failed` —
from which `submitted` is a **lawful retry** (§6.16), not a duplicate submit.
Both `UPDATE`s therefore genuinely matched a row, with **different `from`
values**, which is why neither the row-count plumbing nor the `status: from`
predicate was ever implicated. The case now suppresses the fire-and-forget
extraction for itself only, so the request still travels the whole
route → service → SQL Server path; **`T-BATCH-018d`** is its non-vacuity
guard, running with extraction live to pin that a post-failure resubmit is
still accepted — so `018c`'s 409 can only come from the concurrency guard.

| Id | Kind | Property |
| --- | --- | --- |
| **`T-BATCH-018d`** | I | A submit issued **after** an extraction has failed is accepted (202), because `extraction-failed → submitted` is retry (§6.16) and deliberately re-enters the same batch. This is the non-vacuity guard for `T-BATCH-018c`'s extraction suppression: without it, a suppression that disabled the submit path rather than only the job would leave `018c` green and meaningless. |

### 24.2 What TASK-054 found in the specs

**(a) `T-BATCH-013` has no request to send.** §9 defines it as "changing
`service`/`mode` after submit → 409 `BATCH_IMMUTABLE`", but **no route in
`specs/api.md` §4 accepts a change to either field.** Immutability is enforced
today by the *absence* of an endpoint. Asserting only `assertBatchMutable`
would prove a guard nothing calls, so the test has two legs: the guard refuses
in every non-`draft` status, **and** no registered route can accept the change
(`T-BATCH-013c`, which fails the moment someone adds a `PATCH /api/batches/:batchId`
without wiring the guard). `T-BATCH-013d` is `013c`'s non-vacuity guard.

**(b) §6.23 names no error code for an illegal discard.** Every other batch
endpoint names one — `BATCH_NOT_DRAFT`, `BATCH_NOT_FAILED`,
`BATCH_NOT_IN_REVIEW`, `BATCH_NOT_APPLIED`. Discard has none, and §8 forbids
inventing one. `BATCH_IMMUTABLE` is used because it is the only member of the
closed enumeration that means "this batch can no longer be changed". **Reported,
not silently patched** — a code chosen here is a UI remedy chosen here.

**(c) "Terminal" and "dead end" are different words and this file conflated
them.** The first draft of `T-BATCH-017c` asserted that the statuses with no
outgoing edge are exactly `TERMINAL_BATCH_STATUSES`. It failed immediately:
`applied` is terminal — the owner may start another batch — and still
transitions, to `undone` (§6.25). Terminal means *no longer blocks a new
batch*. The property that must hold is **one-way-ness**: a terminal status can
never lead back to an open one, or the owner ends up with two open batches and
two full-update reconciliations that can interleave (product invariant 3).

### 24.3 What TASK-054 does NOT claim

`T-BATCH-011`, `T-BATCH-012` and `T-BATCH-014` are cited by the backlog row for
this task and are **not** implemented by it. All three are properties of
reconciliation and close — "reconciliation touches only the batch's service",
"close applies additions, corrections and confirmed removals together" — which
are TASK-072/073's, and no close endpoint exists yet. Squatting them here would
let an unbuilt reconciliation pipeline report as verified. The row cites the
ids it actually delivers and the three remain owned by the tasks that will
build them.
---

## 25. Magic-byte format sniffing (TASK-148)

`apps/api/src/images/sniffFormat.ts`, asserted by
`apps/api/test/unit/sniffFormat.spec.ts`. The module decides
`uploadedFormat` from the leading bytes of an uploaded, pasted or dropped
image, per `specs/api.md` §5.

### 25.1 New id

| Id | Level | Asserts |
|---|---|---|
| **`T-IMG-024`** (`a`-`p`) | U | The sniff classifies PNG, JPEG and the HEIF family from magic bytes alone. `a` PNG signature; `b` every legitimate JPEG second marker (`E0`/`E1`/`DB`/`EE`/`FE`), because pinning the fourth byte to `E0` rejects every Exif photo an iPhone writes; `c` every HEIF-family major brand, with `heic` and `heif` kept distinct; `d` a HEIF brand found only in the COMPATIBLE list (a burst frame or Live Photo still declares `mif1`/`msf1` as major with `heic` only among the compatible brands); `e` **an `ftyp` box with no HEIF-family brand is REJECTED** - the discriminating case for `c`/`d`, without which an MP4 classifies as a HEIC and video bytes reach the image decoder; `f` non-images (PDF, ZIP, GIF, HTML) are `null` and never coerced to a default; `g` empty, short and truncated buffers return `null` and never throw, so one hostile file cannot fail the whole multipart request (REQ-080/081); `h` **the structural assertion** - `sniffUploadFormat` has arity 1, so there is no parameter through which a declared `Content-Type`/`Blob.type` could reach the decision; `i` a box size larger than the buffer never reads past the end; `j` a brand beyond the DECLARED box size is not claimed by the file; `k` an illegal or `largesize` box length is refused rather than misparsed; `l` a corrupted brand byte defeats the match; `m` **all four members of `UPLOAD_FORMATS` are reachable** - the add-not-swap guard, and the only case here that fails if the format list is "tidied"; `n` `SNIFF_BYTES` is large enough for the `ftyp` shapes classified; `o`/`p` `isAcceptedUploadFormat` accepts exactly `UPLOAD_FORMATS`. |

### 25.2 What TASK-148 does NOT claim

`T-IMG-006` (a non-image is 415 and named in `rejected[]`) and `T-IMG-013` (a
HEIC declared `application/octet-stream` is accepted and transcoded to a valid
lossless PNG) are cited by the backlog row for this task. Both are
**integration** properties of `POST /api/batches/:batchId/images`, which is
TASK-050 and does not exist. Both are **already cited on TASK-050's row**, so
no relocation is needed - the citations on TASK-148 are duplicates and are
struck through there. Claiming them from a pure sniffer would let an unbuilt
endpoint report as verified.

### 25.3 Findings recorded while building it

**(a) Spec/backlog path divergence, reported not resolved.** `specs/api.md` §5
names the module `apps/api/src/images/format.ts`; the backlog row for TASK-148
names `apps/api/src/images/sniffFormat.ts`. The backlog is the work order, so
`sniffFormat.ts` is what exists. The same divergence appears for the pixel
guard - `specs/api.md` §5.0 names `apps/api/src/images/pixelGuard.ts` and
`packages/domain/src/pixelGuard.ts`, while the backlog row for TASK-145 names
`apps/api/src/images/decodeGuard.ts` with an `assertDecodable()` entry point.
**TASK-145 has not been built, so this one is still cheap to settle** - it
should be settled before it is, or the transcode in TASK-149 will import a path
that the spec says is somewhere else.

**(b) A dead guard, caught by mutation.** The first draft of `readBrand`
validated that each of the four bytes was printable ASCII, and `T-IMG-024l`
appeared to cover it. Deleting the check changed no verdict: every brand
produced is compared against a fixed set of seven printable ASCII literals, so
a non-printable byte can never match anything. The check was removed and the
reason recorded on `readBrand`, because a test that appears to cover an
unfalsifiable guard reports assurance that does not exist. `T-IMG-024l` is
retained for what it genuinely asserts - that the compatible-brand scan matches
exact bytes and nothing looser - and says so.

**(c) `heic` vs `heif` is presentational and must stay that way.** Both are in
`UPLOAD_FORMATS`, both take the transcode branch in TASK-149, and nothing
downstream may branch between them. The distinction is kept only because
`uploadedFormat` is persisted and surfaces in error text, where reporting the
brand family the file actually declares is worth more than a single label.

---

## 26. The pre-decode pixel guard (TASK-145)

Three modules, one decision. `packages/domain/src/pixelGuard.ts` is the pure
verdict table (`specs/api.md` §5.0.1), `apps/api/src/images/readDimensions.ts`
reads dimensions out of a container header without decoding (§5.0.3), and
`apps/api/src/images/decodeGuard.ts` composes them behind `assertDecodable()`.
Asserted by `apps/api/test/unit/pixelGuard.spec.ts`, the path
`specs/testing.md` §11 already names.

### 26.1 Ids

| Id | Level | Asserts |
|---|---|---|
| **`T-IMG-017`** (`a`-`l`, UNIT HALF) | U | The decision table and the entry point. `a` a 48 MP header is refused `IMAGE_TOO_LARGE_TO_DECODE` at 25 MP; `b` **the SAME header is accepted at `50000000`** - the discriminating case, without which a guard hard-coded to reject `8064x5952` passes `a`; `c` a 24 MP image passes; `d` an unparseable header is REJECTED, never decoded to find out; `e` both axis bounds at both ends; `f` **an axis violation is reported BEFORE a budget violation** when both hold, because telling the owner to up-size the container cannot help an image Read 4.0 would refuse at any size; `g` the budget boundary is strictly greater-than; `h` **no decoder is IMPORTED by either guard module** (see §26.3(b)); `i` the thrown `AppError` carries the per-reason status (413/400/415); `j` the memory refusal names `memory` and cites the runbook and the corrupt-file refusal names NEITHER (`A43-M3`); `k` a passing header returns its declared dimensions; `l` `inspectDecodable` reports the same verdict without throwing, which is the shape a per-file loop needs (REQ-080/081). |
| **`T-IMG-022`** (`a`-`d`) | U | `a` `NEXTUP_MAX_DECODE_PIXELS` defaults to `25000000`; `b` it is **read at request time**, not captured at import - the discriminating case, since a module-level `const` would pin the value to whatever the environment held at first load and every other assertion here would still pass; `c` the guard honours the configured value end to end; `d` an empty, non-numeric, zero, negative or non-integer value falls back to the default rather than disabling the guard or crashing the process at startup. |
| **`T-IMG-025`** (`a`-`g`, NEW) | U | The header readers. `a` PNG `IHDR`, non-square, not transposed; `b` JPEG `SOFn` across baseline `C0`, extended `C1` and progressive `C2`, with **height before width** - the classic bug here, and silent, because the pixel-budget product is identical either way; `c` `DHT`/`JPG`/`DAC` sit inside the `SOF` marker range and are skipped; `d` **the LARGEST `ispe` is taken, never the first** - a real iPhone file lists the thumbnail first, so a first-match reader waves a 48 MP master through; `e` a single-`ispe` HEIF still reads, so `d` is not passing by accident; `f` unparseable, truncated, empty and unrecognised headers return `null` and never throw; `g` a zero-size or under-length ISO-BMFF box terminates instead of looping - the failure mode there is a hang, not a wrong answer, so termination is what is asserted. |

Mutation-tested in six directions, all six caught: JPEG width/height swapped;
`ispe` first-match instead of maximum; budget checked before axis bounds;
budget boundary `>=` instead of `>`; an unparseable header accepted; and a
decoder import added to `readDimensions.ts`.

### 26.2 What TASK-145 does NOT claim

**(a) The integration half of `T-IMG-017` - NOW DELIVERED by `T-IMG-018`.** A
413 envelope from `POST /api/batches/:batchId/images` needed the upload
endpoint, which has since landed (TASK-050), and the guard's behaviour there is
asserted end to end in `apps/api/test/integration/ingestGuard.spec.ts`
(`T-IMG-018c`-`h`, TASK-154): a per-file `rejected[]` entry, a 413 status, the
same file accepted once the budget is raised, and mixed failure kinds reported
individually.

**⚠ `T-IMG-018h` IS SCOPED TO THE INGEST PATH, NOT TO THE WHOLE ROUTE FILE.**
As first written it read `batchImages.ts` end to end and asserted the file
contained no `.remove(` anywhere. That was correct only for as long as the
file held nothing but the ingest route. TASK-051 added
`DELETE /batches/:batchId/images/:imageId` to the same file — the **one
sanctioned hard delete** (`data-model.md` I-7), which removes the blob
deliberately and must — and the whole-file scan failed against a correct
implementation. The two claims were never in tension: `T-IMG-018h` is about
**compensating cleanup on a failure path**, and the DELETE handler is a
user-initiated deletion of a pre-submit draft image. The test now slices the
route at the DELETE handler and scans only what precedes it, guards that the
slice really does contain the POST handler and `ingestFiles(` (so a
mis-derived boundary cannot pass vacuously), and asserts the tail **does**
contain the `remove` — so the narrowing cannot silently absorb a compensating
delete that drifts down into it. Mutation-checked: a `store.remove(...)`
inserted into the POST handler is still caught.

This is worth stating as a general rule: **a structural test that scans a
whole file is implicitly asserting what else that file is allowed to
contain.** It will fail the first time an unrelated but legitimate feature
lands beside its subject, and the failure looks like a defect in the new
feature rather than an over-broad assertion in the old test.

~~Superseded: "needs the upload endpoint, which is TASK-050 and does not
exist."~~

**(b) Serial image processing (`concurrency = 1`) - NOW DELIVERED, see
`T-IMG-026`.** TASK-145's row also requires the extraction worker to process a
batch's images strictly serially and release each buffer before loading the
next. That worker is `apps/api/src/jobs/runExtraction.ts` (TASK-057/058), and
it now exists and is wired, so the half is built and asserted in
`apps/api/test/unit/serialImageProcessing.spec.ts`. TASK-145 is `done`.

~~Superseded: "That worker ... does not exist, so there is nothing to set
`concurrency` on and no batch to feed a peak-RSS assertion. The guard is the
half that TASK-149 blocks on and it is complete; the serial-processing half is
recorded as outstanding on the TASK-145 row rather than quietly counted as
delivered."~~

### 26.2b Ids for the serial-processing half

| Id | Type | What it pins |
| --- | --- | --- |
| **`T-IMG-026`** (`a`-`g`, NEW) | U | Serial image processing in `runExtraction` (REQ-079, REQ-080/081, `RSK-016`). `a` `EXTRACTION_IMAGE_CONCURRENCY` is `1`, stated on its own so a change fails with an obvious message; `b` **at most one image's bytes are live at any instant across a batch** - the load-bearing claim; `c` **the instrument can actually observe an overlap**, driving the same ports in parallel by hand, without which `b` would report `1` against a fully parallel worker too; `d` every `load` is immediately followed by its own `record`; `e` the `image.decode.begin`/`end` sentinels are matched and never interleaved (`A43-M5` - a `begin` with no `end` is the only signal naming which image killed the container, and interleaving would make it unreadable in exactly the incident it exists for); `f` a contained per-image failure does not break the serial discipline or leak the live count (REQ-080/081); `g` peak RSS across a 24-image batch of 32 MiB rasters stays under a **384 MiB** ceiling. |

Mutation-tested in two directions, both caught: hoisting the loads into a
`Promise.all` prefetch (caught by `b`, `d`, `f` and `g`); and deleting the
`image.decode.end` sentinel (caught by `e`).

**Why the primary claim is OVERLAP and not megabytes.** The obvious test - run
a batch, assert `rss` stays under N MB - is a GC race wearing an assertion's
clothes. Node frees a buffer's backing store when the collector gets round to
it, not when the last reference dies. Measured on this worker's actual shape,
serial peak growth varied between **65 MiB and 160 MiB across otherwise
identical runs**. A ceiling tuned to the low end fails on an unrelated pull
request, and the fix everyone reaches for is to raise it until it stops
complaining - at which point it asserts nothing. So the deterministic property
is asserted directly, and `g`'s ceiling is kept as a deliberately coarse
cross-check **sized from measurement**: serial growth *plateaus* at ~160 MiB and
stays there as the batch size rises (that plateau is V8's collection threshold,
not the batch), while parallel growth scales linearly and reaches ~770 MiB at 24
images. 384 MiB sits 2.4x above the plateau and 2x below the parallel figure.
**If `g` ever fails, the first thing to check is whether the worker started
holding every image's bytes - not whether the ceiling needs raising.**

### 26.3 Findings recorded while building it

**(0a) An RSS assertion over unwritten buffers passes against everything.**
The first `T-IMG-026g` allocated 24 x 32 MiB `Uint8Array`s and never touched
them. Untouched pages are not resident, so **RSS moved by ~0 MiB for the serial
AND the parallel case** - measured at 10.7 MiB serial versus 0.1 MiB parallel,
i.e. the wrong way round and both meaningless. The harness now writes each
buffer, at which point the two separate cleanly (65-160 MiB versus ~385 MiB at
12 images). Any future memory test in this repo has to write what it allocates
or it is measuring nothing.

**(0b) The buffer-lifetime instrument had the wrong release point, and it
failed in the SAFE-LOOKING direction.** The tracker first decremented its live
count in `recordItems`. But `recordItems` is skipped entirely when an image
fails in a contained way, so the counter leaked one per failed image and
`T-IMG-026f` reported an overlap of **2 against a perfectly serial worker**.
The release point is `reportProgress`, the one call the loop makes on both the
success and the contained-failure path, exactly once per image. Worth stating
because the failure was a false positive - had the leak been one image smaller
it would have read as a pass.

**(0c) A `loadImageBytes` failure is batch-fatal by design, and only the
decode step is contained.** `T-IMG-026f` was first written throwing
`IMAGE_TOO_LARGE_TO_DECODE` from `loadImageBytes` and failed, because
`runExtraction` handles only `IMAGES_PURGED` there and rethrows the rest.
That is correct and deliberate, not a REQ-080/081 breach: a blob that cannot be
fetched leaves an image **unread**, and in full-update mode an unread image is
indistinguishable from a shelf of titles the owner deleted - the same reasoning
the `IMAGES_PURGED` branch already carries. Containment is scoped to the
decode/read step (`imageScopedFailure`), which is also where the pixel guard's
own failures would surface. Recorded so the asymmetry is not "fixed" later by
someone reading REQ-080/081 alone.
**(a) Module naming - resolved, not guessed.** `specs/api.md` §5.0 names
`apps/api/src/images/pixelGuard.ts` for the guard, §5.0.1 names
`packages/domain/src/pixelGuard.ts` for the pure decision and §5.0.3 names
`apps/api/src/images/readDimensions.ts` for the header read; the backlog row
for TASK-145 names `apps/api/src/images/decodeGuard.ts` exposing
`assertDecodable(header)`. The backlog is the work order and TASK-149's row
mandates calling `assertDecodable()` from `decodeGuard.ts` **by name**, so that
is the entry point. The pure decision is in the domain exactly where §5.0.1
puts it and the header read is exactly where §5.0.3 puts it, so there is one
implementation and not two. This closes the divergence reported at §25.3(a).

**(b) A vacuous structural test, caught before it shipped.** The first draft of
`T-IMG-017h` `vi.mock`ed `heic-convert` and asserted it was never called. That
proves nothing: **a module nothing imports can be mocked and "not called"
forever**, so the assertion would have passed identically against an
implementation that delegated the HEIC branch to the decoder - the exact trap
§5.0.3 warns about. It now reads both guard modules' sources and asserts no
decoder appears among their imports, with a non-vacuity check that the import
regex is finding anything at all. Mutation-verified: adding
`import convert from 'heic-convert'` to `readDimensions.ts` fails it.

**(c) A PNG signature compared four bytes from offset 1.** The detection read
`P`, `N`, `G` and the following `0x0D` as a four-character tag and compared it
to `'PNG'`, so every PNG returned `null` and would have been rejected `415`.
Caught by `T-IMG-025a` on the first run. Worth recording because the sniffer in
TASK-148 uses a full eight-byte signature comparison and this module had
quietly reimplemented the check a shorter way.

**(d) A malformed `NEXTUP_MAX_DECODE_PIXELS` falls back rather than throwing.**
`specs/api.md` §5.0.2 types it `z.coerce.number().int().positive()`, which on a
mistyped value would throw. Throwing at startup takes the whole app down over a
typo; throwing at request time fails an upload with an error the owner cannot
act on. Both are worse than falling back to the value the container is actually
sized for, so `maxDecodePixels()` falls back and `T-IMG-022d` pins it. **The
one behaviour that is NOT acceptable - silently disabling the guard, e.g. by
treating an unparseable value as `Infinity` - is what that case exists to
prevent.**

---

## 27. The synthesised file name (TASK-158)

`specs/data-model.md` §3.8.1 is normative. `packages/domain/src/pastedFileName.ts`
is pure and takes an injected clock, so `T-PASTE-005a`-`s` (19 cases in
`packages/domain/test/pastedFileName.spec.ts`) need no container.

### 27.1 What TASK-158 claims

`T-PASTE-005` **unit half only.** The function produces
`pasted-<YYYYMMDD>-<HHMMSS>-<NN>.<ext>` from server UTC time and the 1-based
batch ordinal; `drop`/`upload` keep the device name and fall back to the
`dropped-`/`uploaded-` prefixes; the extension follows the SNIFFED format
(`jpeg` maps to `.jpg`, not `.jpeg`); `paste` ignores any client-supplied name
entirely.

### 27.2 What it does NOT claim

The **integration half** of `T-PASTE-005` -- that `ingestSource` and the
synthesised `fileName` actually round-trip through
`POST /api/batches/:batchId/images` and are persisted write-once, that
`seqInBatch` is assigned server-side in receipt order under the insert, and
that `blobPath` contains no part of any client-supplied name -- belongs to
**TASK-050** and is asserted in `apps/api/test/integration/ingestSources.spec.ts`
(§11). TASK-158 supplies the function; it cannot assert its own call site.

### 27.3 Findings

**(a) A UTC assertion made from a fixed instant is vacuous in CI.**
`T-PASTE-005f` pins a 23:30 UTC instant so that a `getHours()` implementation
produces a different string. That discriminates on a developer host in an
offset timezone -- and **not at all in CI**, where the container is UTC and
`getHours() === getUTCHours()`. The mutation was caught locally (Eastern) and
would have passed on the only machine whose verdict counts. `T-PASTE-005s`
closes it host-independently by reading the module source and asserting no
non-UTC date accessor appears, with a non-vacuity check that the six `getUTC*`
calls are actually present. Both directions mutation-verified.

**(b) `fileName` is `NVARCHAR(255)`; a device name is not.**
`specs/data-model.md` §3.8.1 says the device name is kept, and says nothing
about length. A browser will happily supply a 400-character name, which then
fails the zod ceiling or the insert -- a real file from a real device, rejected
for a reason the owner cannot act on. `resolveFileName()` truncates to
`MAX_FILE_NAME_LENGTH` preserving the extension; `T-PASTE-005p` asserts the
result satisfies `uploadedImageSchema.shape.fileName`. Reported as a spec gap,
not a spec change.

---

## 28. The ingest endpoint (TASK-050)

`POST /api/batches/:batchId/images` -- ONE route, THREE affordances
(`specs/api.md` §6.12, §5.3.1; `A45`). Two suites:
`apps/api/test/unit/ingest.spec.ts` (21 cases, the pipeline in
`apps/api/src/images/ingest.ts`) and
`apps/api/test/integration/ingestSources.spec.ts` (19 cases, the path §11
names, against a real `mssql/server:2022` and a real Azurite). Two further unit
suites carry the branch arms **and the coverage**:
`apps/api/test/unit/batchImagesRoute.spec.ts` (10 cases, repository and store
mocked) and `apps/api/test/unit/blobStore.spec.ts` (8 cases,
`@azure/storage-blob` mocked). ⚠ `npm run coverage` scores only the `unit` and
`web` projects, so a route proven ONLY in integration scores ~6% against the
`apps/api/src/**` floor -- it fails the gate. That is why those two suites
exist, and they must not be deleted as "duplicates" of the integration run.

### 28.1 What TASK-050 claims

| Id | Where | Claim |
| --- | --- | --- |
| `T-IMG-002a`-`d` | U + I | Partial acceptance. A valid file beside an invalid one is **201**, the bad one is named in `rejected[]`, and the failed file is the ONLY one missing from storage. |
| `T-IMG-006a`-`f` | U + I | A non-image is `415` and named per file; the ordinal is consumed by a rejected file too; `blobPath` carries no part of any client name. |
| `T-IMG-010a`-`j` | U + I | Per-file rejection reasons; ceilings; byte totals accumulate across requests and match the stored rows. **`i`/`j`: the whole-batch ceiling is measured in UPLOADED bytes** — a batch whose STORED bytes exceed it still accepts, and the 413 reports the uploaded total. |
| `T-IMG-012a`-`f` | U + I | `uploadedFormat` (as received) is recorded distinct from the stored `format`. **`e`/`f`: `uploadedByteSize` (what the device sent) is recorded distinct from `byteSize` (what is stored)**, which diverge across the transcode AND the metadata strip — they are never assumed equal. |
| `T-IMG-018a`-`b` | U | Files are processed **serially**, never concurrently, and one failure never removes an accepted file. |
| `T-IMG-023a`-`e` | U + I | The transcode is conditional on the **sniffed format**, never on `ingestSource`; the metadata strip runs for every image outside that condition; images attach to a **draft** batch only (`409 BATCH_NOT_DRAFT`, `404` for a batch that is not the owner's). |
| `T-PASTE-003a`-`b` | I | Three successive pastes append to the **one** open batch with ordinals `01`/`02`/`03`; paste, drop and upload land in the same batch and are counted together. |
| `T-PASTE-005t`-`w` | I | The integration half §27.2 left open: `ingestSource` and the synthesised `fileName` round-trip and are persisted; provenance is read from the FIELD, never inferred from a filename prefix; an absent value defaults to `upload` and an unknown one is refused. |
| `T-PASTE-006a`-`c` | U + I | The declared `Content-Type` is never trusted in either direction. |
| `T-PASTE-007a`-`c` | U + I | Every ceiling applies identically to pasted images. |
| `T-SEC-003a`-`b` | I | No `blobPath`, URL or SAS in any response -- asserted against the **raw serialised body**, because the leak guarded against is a future `...spread`. |
| `T-SEC-003c`-`h` | U | The container is created **private** (no `access` argument), and a missing store configuration refuses the upload by name -- naming **both** variables, so the reader is not steered towards the account-key path ADR-0006 forbids. |
| `T-SEC-003i`-`p` | U | **A48.** `AZURE_STORAGE_BLOB_ENDPOINT` selects the managed-identity path and **wins over a connection string when both are set** -- the order is the security property, since a connection string carries an account key and the other order would let one stray variable silently downgrade production while everything kept working. `createIfNotExists` is **not** called against a real account (the container is made by `storage.bicep` and the grant is scoped to it, so the call is redundant at best and a 403 on first upload at worst). The container name comes from `AZURE_STORAGE_CONTAINER`, falling back to `screenshots` when unset **or blank**; hard-coding it made `rbac.bicep`'s per-container scoping inert, because staging asked for production's container by name every time. |
| `T-RET-014a`-`d` | U + I | `retainUntil` is stamped at ingest from `IMAGE_RETENTION_DAYS` alone; a purged blob reads as `null` rather than throwing, and `remove` is idempotent. |
| `T-IMG-020a`-`b` | U | The memory refusal names memory, renders **MEGApixels** to one decimal place and cites the runbook; the unsupported-format refusal names neither. |

### 28.1a What TASK-051 claims (`DELETE /api/batches/:batchId/images/:imageId`)

The **one sanctioned hard delete in the product** (`specs/data-model.md` I-7,
`specs/api.md` §6.13). Everything else is soft delete forever (REQ-028).

| Id | Where | Claim |
| --- | --- | --- |
| `T-IMG-006g`-`i` | U | The happy path. `g` **204**, with both the blob and the row gone. `h` the **blob is removed BEFORE the row**, asserted as an order and not merely as two calls -- the reverse orphans the bytes forever, since nothing then knows the blob exists. `i` a failed blob delete leaves the row in place, so a retry can still finish the job. |
| `T-INV-012a`-`e` | U | The scope of the exemption, at the route. `a` each of the five non-`draft` statuses answers **409 `BATCH_NOT_DRAFT`** and deletes nothing; `b` the **draft check runs BEFORE the image lookup**, so a submitted batch cannot be probed for which image ids it holds; `c` an image id belonging to a different batch is a 404; `d` a missing batch is a 404 and never reaches the image; `e` the `:batchId` from the path is the one actually queried -- non-vacuity a handler ignoring the param would otherwise satisfy. |
| `T-INV-012g`-`j` | S | The source-tree half of REQ-028, in `tests/infra/hardDelete.spec.ts`. `g` every hard delete of a persisted row is sanctioned; `h` the sanctioned entry is **real**, not a stale allow-list line pre-authorising whatever is written next to it; `i` the sanctioned delete is guarded by a draft check **at its call site**, which the repository function cannot enforce on its own; `j` non-vacuity in both directions -- the scan matches Prisma model deletes and does **not** match `Map`/`Set`/`Headers` deletes. |

Mutation-tested in four directions, all four caught: the draft guard removed
from the handler (7 cases fail); the blob/row delete order swapped
(`T-IMG-006h`, `i`); a `title.delete` added **inside the sanctioned file**
(`g`, `j`); and the sanctioned delete itself removed (`h`, `j`).

**Why `T-INV-012` exists, and why it is keyed on file AND model.** `T-INV-013`
proves only the infrastructure half of REQ-028 -- no TTL, no Agent job, no
scheduled deletion -- while its own wording promises "`DELETE` in exactly one
module", which nothing implemented. Until now soft-delete-forever was enforced
against Bicep and against nothing a developer would actually write: a hard
delete is one plausible line, it typechecks, its tests pass, and the row it
removes was the only copy. The exemption is keyed on `file::modelAccessor`,
**not on file alone**, because `ownerData.ts` holds all forty-odd repository
functions -- a file-scoped exemption silently pre-authorises a `title.delete`
written beside it. That is precisely what the third mutant did, and what the
first version of this gate failed to catch.

**The scan is deliberately narrowed to Prisma model accessors.** A bare
`/\.delete\(/` also matches `Map.delete`, `Set.delete` and
`URLSearchParams.delete` -- `startExtraction.ts` already calls
`inFlight.delete(batchId)` -- and a gate that fires on those acquires an
allow-list within a week and stops meaning anything. The accessor list is
derived from `prisma/schema.prisma` at run time, so a new model is covered
without anyone remembering to extend it.

**Finding.** TASK-051's Done-when cites `T-IMG-006`, but `T-IMG-006a`-`f`
belong to TASK-050 and concern non-image **415** sniffing, which has nothing
to do with deletion. Rather than invent a prefix, the deletion cases were
appended as `g`-`i`; the id is therefore shared across two tasks. Recorded,
not corrected.

### 28.2 What it does NOT claim

**`T-IMG-013` is NOT claimed by TASK-050, and was struck from its row.** It
requires a HEIC to be *accepted, transcoded to PNG and stored*. The sniff half
is asserted here (`T-IMG-012`/`T-PASTE-006`); the transcode half lands with
**TASK-149** and is claimed in **§29**.
~~*Superseded (TASK-149 has landed): "`UNBUILT_STAGES.transcode` in
`apps/api/src/routes/batchImages.ts` **throws** -- deliberately, because
storing an un-transcoded HEIC would violate the `format in {png,jpeg}`
invariant."*~~ The stage is real now; `UNBUILT_STAGES` survives as an **alias**
of `DEFAULT_STAGES` so this section's citation still resolves.

**REQ-078 IS NOW DISCHARGED (TASK-150).** `DEFAULT_STAGES.stripMetadata` calls
`stripAllMetadata()`; `T-SEC-032a`--`m` and `T-SEC-033a`--`g` assert it, and
`T-SEC-032g` reads the **stored blob back out of Azurite** rather than trusting
the response. See §30. ⚠ Note `T-SEC-033g`: the HEIC leg is **vacuous** with
respect to the strip (the transcode re-encodes), so the strip's own evidence is
`T-SEC-032m`, on the JPEG path.

~~*Superseded (TASK-150 has landed): "`DEFAULT_STAGES.stripMetadata` is a
**pass-through**, so EXIF/XMP -- including GPS -- is currently NOT stripped.
The seam exists and is asserted to be called for every image (`T-IMG-023b`), so
**TASK-150** is a one-line wiring change; until it lands this is a live gap,
recorded here rather than only in a code comment."*~~

**`IMAGE_DECODE_OOM` is mapped but was UNREACHABLE at TASK-050.**
`statusForRejection()` maps it to **503, not 500** -- a capacity condition with
a known one-command remedy, after which the identical request succeeds
(`specs/api.md` §5.2.3). Nothing in the pipeline emitted that code, because it
is raised by the decoder, which arrived with **TASK-149**; `T-IMG-015e`/`f` now
assert it. Recorded so nobody "simplifies" the 503 to a 500 on the grounds that
no test names it.

The `T-PASTE-003` **e2e** leg -- three real Ctrl/Cmd+V events in a browser
producing exactly one `POST /api/batches` -- belongs to TASK-159+. The
integration leg above proves the server side of the same claim.

### 28.3 Findings

**(a) A megapixel field that holds pixels compiles, passes every comparison,
and renders `25000000.0 MP`.** `NEXTUP_MAX_DECODE_PIXELS` is a raw pixel count;
`megapixels`/`maxMegapixels` in the guard verdict are what `specs/api.md` §6.12
puts in `details` and §5.2.4 renders to one decimal place. `pixelGuard.ts`
assigned the budget straight through, and **two existing cases in
`apps/api/test/unit/pixelGuard.spec.ts` had encoded the bug** (`megapixels:
47_996_928`). It shipped in `fb213b4`. Only an assertion on the RENDERED value
catches it; `T-IMG-017k` now asserts `48.0`/`25.0`. This amends §26. The
comparison stays in pixels; only reported values convert.

**(b) A multipart part with no filename is a FIELD, not a file.** Modelling a
paste as `form.append('files', blob, '')` makes the request look **empty** to
multer, and the test fails `400 VALIDATION_FAILED` for a reason that has
nothing to do with pasting. Pasted fixtures use a plausible name; that the name
is ignored is what `T-PASTE-005t` asserts.

**(c) `FormData` strips path segments before the request is sent.** A traversal
fixture named `../../etc/passwd.png` arrives as `passwd.png`, so a test written
that way asserts the **client's** normalisation and would pass against a server
that composed paths from the client name. `T-SEC-003b` keeps the marker in a
percent-encoded form that survives the wire.

**(d) A green local integration run does NOT prove the CI emulator agrees.**
`docker-compose.test.yml` starts Azurite with `--skipApiVersionCheck`; the CI
job started it as a **service container**, which cannot pass command
arguments, so it ran without the flag. `@azure/storage-blob` sends a service
version newer than the emulator knows, and **every** blob write failed with
`RestError: The API version … is not supported by Azurite` -- surfacing as
`INTERNAL_ERROR` on the upload route, which reads as an application bug. It was
invisible locally in both directions: the flag had always been present here and
absent there. Reproduced by running a flagless Azurite on a second port
(19 failures), then re-running with the exact CI command line (19 passed).
Azurite is now a **step** in `ci.yml`, and both argument lists carry a comment
saying they must stay identical. **The general lesson: any test dependency
configured in two places is a place CI and local silently diverge, and the
first symptom will point at the application.**

**(e) An interrupted mutation run can leave a mutation in the file, and the
next battery then measures the wrong baseline.** A prior run of this suite left
the "strip inside the transcode branch" mutation in `ingest.ts`; the following
battery reported two extra failures in **every** cell, which reads as noise
rather than as a broken baseline. Every battery here now asserts the baseline
is green **first**. Recorded because the failure mode is silent in the
direction that matters: a mutation left in a file that no test covers would
have been committed.
## 29. The HEIC/HEIF transcode (TASK-149)

`apps/api/src/images/transcode.ts`, asserted by
`apps/api/test/unit/transcode.spec.ts` (21 cases). The stage is injected into
the pipeline through `IngestStages.transcode` and wired to the route by
`DEFAULT_STAGES` in `apps/api/src/routes/batchImages.ts`.

### 29.1 What it claims

| Test | Level | Claim |
|---|---|---|
| `T-IMG-013a`-`d` | U | HEIC and HEIF decode to a PNG whose signature is asserted; the decoder is handed the ORIGINAL bytes and asked for **`PNG`**, never a lossy format (NFR-012a); the decoded raster's dimensions are what the row records. |
| `T-IMG-015a`-`d` | U | A decoder failure, an empty result and a result that is not a readable PNG all become `IMAGE_DECODE_FAILED` **415** -- gracefully, with no crash -- and the refusal names **neither memory nor the runbook** (`T-IMG-020`'s standing constraint: more memory cannot fix a truncated file). |
| `T-IMG-015e`-`g` | U | A **catchable WASM allocation failure** becomes `IMAGE_DECODE_OOM` **503**, naming memory and citing `docs/runbooks/scale-up-memory.md`; four real Emscripten/V8 wordings are recognised; and a `RangeError` that is **not** about memory is still `IMAGE_DECODE_FAILED`. |
| `T-IMG-016a`-`b` | U | `assertDecodable` runs as the FIRST statement: a 48.0 MP header is refused with `IMAGE_TOO_LARGE_TO_DECODE` and the decoder is **never invoked**, and the SAME header is accepted once `NEXTUP_MAX_DECODE_PIXELS=50000000` -- proving the ceiling is the env var, not a constant. |
| `T-IMG-016c`-`e` | U | A raster that contradicts the header is `IMAGE_DECODE_FAILED` (§5.1 step 4, a secondary consistency check -- never `IMAGE_TOO_LARGE_TO_DECODE`); an under-size image is refused pre-decode. |
| `T-IMG-016d` | U | A **transposed** raster is accepted. See 29.3(a). |
| `T-IMG-023h`-`l` | U | The branch is the caller's and reads the **sniffed** format: transcoding a PNG is a programming error, not an `AppError`; a HEIC labelled `ingestSource: 'paste'` by a lying client is transcoded anyway; a transcode failure fails **one image**, never the batch; and a non-`AppError` propagates instead of blaming the image. |
| `T-DM-025e`-`f` | U | A stored PNG larger than the 10 MiB **upload** ceiling is representable; one beyond the whole-batch ceiling is not. See 29.3(b). |

Every claim above was mutation-verified in both directions: removing the
`assertDecodable` call, requesting `JPEG` instead of `PNG`, deleting the
raster/header comparison, disabling the out-of-memory classifier, and removing
the per-file `AppError` catch each fail their named case and pass with it
restored.

### 29.2 What it does NOT claim

**No test here decodes a REAL HEIC, and that is a constraint rather than an
omission.** `T-DEP-002` forbids a HEIC **encoder** anywhere in the dependency
tree (patent exposure and a GPL licence floor), so **nothing in this repository
can produce HEIC bytes**. A real decode therefore requires a **committed**
fixture, which is **TASK-151** -- whose row already wires `T-IMG-013`,
`T-IMG-015` and `T-IMG-016` against `tests/fixtures/golden/ingest/`. The
injected decoder buys what a well-formed fixture cannot: the out-of-memory path
and the header-lie path.

**The KERNEL out-of-memory kill is not asserted and cannot be.** It restarts
the container and raises no catchable error, so no in-process assertion can
observe it (ADR-0008 R2.4). The pre-decode pixel guard exists precisely because
that path cannot be handled; `T-IMG-016a` is its assertion.

~~*Superseded (TASK-150 has landed): "**REQ-078 is still NOT discharged** -- see
§28.2. A PNG or JPEG that skips the transcode still carries its EXIF today."*~~
The transcode's incidental metadata loss (it re-encodes from a raw raster) is
**still not** what discharges REQ-078 -- incidental is exactly what TASK-150
forbids relying on, and the explicit strip in §30 runs for every image from
every source, transcoded or not.

### 29.3 Findings

**(a) `ispe` ignores `irot`, so a correct decode can legitimately transpose the
dimensions.** The HEIF `ispe` box records the STORED extent; libheif applies
the `irot`/`imir` transform properties when it decodes. A portrait iPhone photo
stored 4032x3024 with a 90-degree rotation therefore decodes to 3024x4032.
Reading §5.1 step 4 literally -- *"any mismatch between the header-declared
dimensions and the decoded raster is itself a rejection"* -- **rejects ordinary
camera-roll uploads, the exact case A42 exists to support.** The transposed
pair is accepted explicitly, and it costs nothing the guard cared about: the
pixel COUNT is identical either way, and a genuine header lie changes the
count and is still caught. `T-IMG-016d`.

**(b) The upload ceiling and the stored ceiling are different numbers.**
`uploadedImageSchema.byteSize` was bounded by `MAX_IMAGE_BYTES` (10 MiB), which
is the ceiling on what the **device sends**. The stored blob for a HEIC is its
**lossless PNG** transcode and is routinely several times larger, so a
compliant 10 MiB HEIC could be stored and then be **unrepresentable in its own
schema**. Nothing would have found that until a real phone photo arrived, since
no fixture in the tree is a real HEIC. `MAX_STORED_IMAGE_BYTES` is now a
separate constant, and `T-DM-025e` -- which had encoded the bug by asserting
that anything over 10 MiB is rejected -- was corrected in place.

**(c) A per-file stage that THROWS silently converts a per-file failure into a
whole-request failure.** `ingestOne` did not catch stage errors, because no
stage could fail while the transcode was a stub. Wiring a real decoder made
`IMAGE_DECODE_OOM` and `IMAGE_DECODE_FAILED` propagate out of `ingestFiles`,
which would have failed the **batch** on one bad screenshot -- REQ-080/081, and
invariant 15 of the build instructions. The catch is scoped to `AppError`
deliberately: an Azure outage or a `TypeError` is not a verdict about one
image, and reporting it as one tells the owner to re-export a file that is
perfectly fine. `T-IMG-023k` and `T-IMG-023l` are the pair.

## 30. The EXIF/XMP/GPS metadata strip (TASK-150)

`stripAllMetadata()` in `apps/api/src/images/transcode.ts`, wired into
`DEFAULT_STAGES.stripMetadata`. REQ-078, `specs/security.md` §4.2.

### 30.1 What it claims

`T-SEC-032a`--`f` and `T-SEC-033a`--`d` (`apps/api/test/unit/stripMetadata.spec.ts`)
plus `T-SEC-032g` (`apps/api/test/integration/ingestSources.spec.ts`), extended
by `T-SEC-032h`--`m` and `T-SEC-033e`--`g` (`tests/extraction/**`, §30.1a):

- **JPEG**: `APP1` (EXIF **and** XMP), `APP12`, `APP13` (IPTC) and `COM` are
  removed. `APP0` (JFIF) and `APP2` (ICC) are **kept** -- the ICC profile
  decides how the image renders and identifies nobody, so dropping it is a
  quality regression wearing a privacy badge (NFR-012a).
- **PNG**: `eXIf`, `tEXt`, `zTXt`, `iTXt` and `tIME` are removed.
- **The raster is untouched.** Removal is **structural** -- whole segments and
  whole chunks are copied or dropped, never re-encoded -- so surviving CRCs
  stay valid and no pixel changes. A JPEG re-encode to launder metadata would
  be lossy, which NFR-012a forbids.
- **It fails closed.** A stream that cannot be walked raises
  `IMAGE_DECODE_FAILED` rather than storing bytes whose contents were never
  established.
- **It runs for every image from every source**, outside the HEIC condition
  (`T-IMG-023b`), so a PNG that skips the transcode is still stripped.
- `T-SEC-032e` is a **non-vacuity guard**: it asserts the fixtures really do
  carry `Exif\0\0` and a GPS payload to begin with. Without it every "absent"
  assertion would pass against a strip that did nothing.
- `T-SEC-032g` uploads a GPS-bearing JPEG over **HTTP** and re-reads the
  **stored blob from Azurite**, so the claim is about what landed in the store,
  not about what a unit-level seam returned.

#### 30.1a The committed-fixture leg (TASK-151, `tests/extraction/**`)

Registered here because they are asserted in the tree and were previously
defined nowhere -- `check:test-ids` does not catch that, since it gates only
ids **cited from the backlog**.

| Id | Type | What it asserts |
|---|---|---|
| `T-SEC-032h` | S | **Non-vacuity.** The synthetic fixtures really do carry a GPS payload before anything strips it. The sibling of `T-SEC-032e`, for the `tests/extraction` fixture set. |
| `T-SEC-032i` | S | Every metadata chunk is removed from the PNG and the **image** chunks survive. |
| `T-SEC-032j` | S | `APP1`/`APP13`/`COM` are removed from the JPEG and the **ICC profile survives** -- dropping it is a quality regression wearing a privacy badge (NFR-012a). |
| `T-SEC-032k` | I | The bytes that reach the **blob store** carry no GPS -- asserted on what landed, not on a seam's return value. |
| `T-SEC-032l` | S | The **owner's own iOS screenshot** is a **JPEG** with an EXIF block, no GPS and no device model. ⚠ **The format is the finding** -- see §30.3. |
| `T-SEC-032m` | I | Uploaded, that real screenshot lands with its EXIF removed **and its pixels intact** (SOS present, length preserved). ⚠ **This is where the strip's real evidence lives**: the JPEG is stored as a JPEG with no re-encode, so `stripAllMetadata` is the only thing removing `APP1`. |
| `T-SEC-033e` | S | **Non-vacuity.** The owner-supplied HEIC really does carry a GPS sub-IFD and a device model. |
| `T-SEC-033f` | I | Driven through the **file-upload** path (invariant 18, never paste) it lands in the blob store with no metadata at all. |
| `T-SEC-033g` | I | ⚠ **A deliberate vacuity proof.** The same real HEIC with the strip replaced by an **identity function** still stores clean, because the transcode re-encodes. This is why `T-SEC-033f` must not be read as discharging REQ-078 on its own. |

### 30.2 What it does NOT claim

**`T-SEC-033`'s spec-mandated leg -- a REAL HEIC upload carrying GPS -- is
asserted by `T-SEC-033e`--`g` in `tests/extraction/ingestRealDevice.spec.ts`
(TASK-151, landed).** Nothing in this repository can *generate* HEIC bytes:
`T-DEP-002` forbids a HEIC **encoder** anywhere in the tree, and prebuilt
`sharp` has no HEIF encode. A real HEIC decode therefore needs a **committed
fixture**, which TASK-151 supplied -- the owner's own iPhone file, with only
its lat/lon rationals overwritten by a public landmark. `T-SEC-033a`--`d`
continue to assert the fail-closed behaviour and the wiring.

⚠ **But that leg is VACUOUS with respect to the strip, and `T-SEC-033g`
exists to say so out loud.** The transcode decodes to a raster and re-encodes,
so metadata cannot survive it and the stored blob is clean *whether or not*
`stripAllMetadata` ever runs. `T-SEC-033g` re-runs the same real fixture with
the strip replaced by an identity function and shows the blob is still clean.
The strip's own evidence therefore has to come from the **PNG and JPEG** paths,
where bytes pass through un-re-encoded -- which is `T-SEC-032m`.

~~Superseded: "`T-SEC-033`'s spec-mandated leg ... is not asserted here, and
belongs to TASK-151 ... This is a genuine divergence from `specs/security.md`
§4.2 and is recorded as one." TASK-151 has landed; the divergence is closed.~~

**The paste path's free stripping is NOT coverage.** WebKit strips EXIF on
`navigator.clipboard.read()` but **not** on file upload. A test asserting "no
EXIF in the stored blob" against a **pasted** image passes whatever our code
does. `T-SEC-032g` deliberately uses the **upload** path (invariant 18).

**Video/audio containers, and PNG chunk types not listed above, are out of
scope.** Only `png` and `jpeg` reach this stage -- the transcode has already
converted everything else.

### 30.3 Findings

**(a) The integration JPEG fixture was a 29-byte header stub that stopped
mid-`SOF0`.** It was sufficient while nothing walked the file; the strip does
walk it, and correctly refused it as truncated, which surfaced as a `415` on a
test expecting `201`. The **fixture** was wrong, not the refusal -- storing
bytes whose structure was never established is the thing REQ-078 exists to
prevent. `jpegBytes()` now emits a complete `SOI/APP0/SOF0/SOS/EOI` stream.

**(b) The strip must not recompute PNG CRCs.** Copying whole chunks verbatim
keeps every surviving CRC correct by construction. A filter that rebuilt
chunks would have to recompute them, and a wrong CRC turns a privacy control
into a corruption bug that only some decoders notice.

**(c) ⚠ The "iOS screenshots are normally PNG" rationale is FALSIFIED, and the
conclusion it supports is unaffected.** `ASM-058` and invariant 11 argue for
accepting all three formats partly from the premise that iOS *screenshots* are
PNG while *camera photos* are HEIC. The owner's own screenshot fixture
(TASK-151, asserted by `T-SEC-032l`) is **JPEG**, with an EXIF block, no GPS
and no device model. The correct conclusion is **strengthened, not weakened**:
accept PNG **and** JPEG **and** HEIC, and determine the format by **magic
bytes only** -- never by the declared `Content-Type`, and never by inferring it
from the ingest source. There is no capture path whose output format can be
predicted. `specs/security.md` and the ASM-058 rationale should be corrected in
place to reason from *unpredictability* rather than from a per-path format map.

## 31. The Azure boundary — budget guardrail and cost verification (TASK-142, TASK-010)

The first tasks that touch a real subscription and real money.

### 31.1 What TASK-142 claims

`infra/budget.bicep` + `infra/budget.bicepparam`, asserted by `T-INFRA-009a`--`i`
in `tests/infra/infra.spec.ts` against the committed `infra/budget.json`.

- One subscription budget, `Monthly`, amount = the published total, with
  notifications at **100 %** (informational) and **150 %** (action required).
- **Email only.** No action group, contact group, contact role, webhook or
  action on either notification. `T-INFRA-009e` sweeps all five keys.
- Thresholds are **percentages of a single amount**, so 1.0x and 1.5x cannot
  drift apart. `T-INFRA-009g` fails if a second budget appears.
- **Deployed and verified live**, not merely written: `az deployment sub create`
  succeeded and `az consumption budget list` returns `nextup-monthly / 13.0 /
  Monthly`.

`tools/check-infra.mjs` now compiles **two** templates rather than one, so the
budget gets the same drift gate `main.bicep` has. A subscription-scoped
template cannot be a module of a resource-group-scoped one -- Bicep scope
nesting only goes downward -- so this is a second `az deployment sub create`,
which is also the correct order: **the guardrail exists before the first
billable resource.**

### 31.2 What TASK-010 claims

Every figure in `docs/architecture.md` §Cost summary is now checked against the
**live Azure Retail Prices API** for `eastus2`, dated **2026-08-17**, with
dated addenda on **ADR-0001**, **ADR-0003** and **ADR-0005**.

**Verified total $11.77/month against a published band of $11-13.** The
`OQ-026` escalation rule (>50 % over) does not fire.

### 31.3 What it does NOT claim

**Item (h) -- metric existence -- is NOT verified and cannot be yet.** Whether
`RestartCount` and `WorkingSetBytes` exist as alertable metrics for
`Microsoft.App/containerApps`, and whether any OOM-distinct signal exists at
all, requires listing metric definitions against a **deployed** container app.
It is owed the moment staging exists, and it is a **TASK-157** input.
`architecture.md`'s claim that ACA does not surface OOM-kill distinctly
therefore remains **UNVERIFIED** and is still labelled so.

**A budget alert is not a spend limit.** It emails; it does not cap. That is
deliberate -- capping would mean automated remediation, which TASK-142 and
`REQ-028` both forbid.

### 31.4 Findings

**(a) The total was right by CANCELLATION, not because the lines were right.**
Compute came in at **$4.30** against a published ~$5-8 and absorbed two
overages. Anyone checking only the bottom line would have concluded the model
was sound and moved on.

**(b) The pre-authorised up-size costs +$5.92/month, not the +~$4 quoted to the
owner** -- 48 % low. Corrected in `architecture.md` and in
`docs/runbooks/scale-up-memory.md`, in place, with the old figure struck
through. The decision does not change at the true price; the owner meeting it
on a bill would have been the problem.

**(c) Alert rules cost $1.70/month, not $0.60-1.00** -- 70-183 % over. A
log-search alert at 5-minute frequency is **$1.50**, fifteen times a metric
rule's $0.10. The estimate priced them alike.

**(d) `autoPauseDelay` had no test, and it is the most expensive one-line
deletion in the repository.** Serverless GP_S Gen5 is **$0.521758/vCore-hour**;
at the 0.5-vCore minimum a staging database that never pauses costs
**~$190/month -- 16x the entire system**. Deleting the property deploys
cleanly, serves staging perfectly, and is invisible until the bill.
`T-INFRA-005t`--`w` now guard it, including `w`, which proves the rule does
**not** fire on the Basic prod database -- a rule unsatisfiable for prod would
be "fixed" by deleting it.

**(e) Azure OpenAI no longer bills under `serviceName eq 'Azure OpenAI'`.** The
retail API files these meters under **`Foundry Models`**. A verification query
written against the old name returns **zero rows**, which reads like "the model
is unavailable in this region" rather than "your filter is stale" -- and would
push a reviewer toward an unnecessary region change or model downgrade.

**(f) An integer-division output understated the alert threshold.** The budget
template first reported `monthlyTotalUsd * 3 / 2` as **$19**, where the
threshold Azure evaluates is **$19.50**. Bicep integer maths truncated it. The
output now reports the base amount plus percentages, because a number that is
50 cents wrong is exactly the number a reader would quote.

### 31.5 The audit gate (`T-SEC-034`)

A new advisory landed on `main` between two green commits and turned CI red
without anything in the repository changing: **GHSA-ggr8-5vv4-36mx**, stack
exhaustion in `deepmerge-ts`, reached as
`@prisma/client -> prisma -> @prisma/config -> deepmerge-ts`.

It is a **real** high-severity finding in the production tree, and our
classification was already correct -- `@prisma/client` is the runtime
dependency and `prisma` is a devDependency; `prisma` arrives in the production
tree because `@prisma/client` itself depends on it. There was nothing to
reclassify.

It is also **unfixable**: `deepmerge-ts` has no patched version (latest 7.1.5,
the advisory covers `*`). That left three bad options -- block every commit
indefinitely, weaken `--audit-level` and lose the whole class of finding, or
take the suggested fix.

**The suggested fix is a trap.** npm reports
`fixAvailable: { name: 'prisma', version: '6.12.0' }` against an installed
**6.19.3**. It is a **downgrade**, reported in the same field, with the same
wording, as an upgrade. `npm audit fix --force` would have moved the datastore
layer seven minor versions backwards to silence a warning.

So the blocking step now runs `tools/check-audit.mjs`, which allow-lists
**individual advisory ids** with a written justification and fails on anything
else -- and **fails on a listed exception that is no longer reported**. That
second rule is the whole design: a suppression nobody removes is a permanent
hole, so this one forces its own deletion once upstream publishes a fix rather
than quietly becoming policy.

Reachability, recorded because it is what makes the exception acceptable: the
vulnerable code is the Prisma **CLI config loader**, running at build and
migrate time against our own committed config. `@prisma/client` does not load
`@prisma/config` at runtime, and no owner-supplied input -- screenshots
included -- reaches a config merge. Exploitation needs attacker-controlled
cyclic input, which does not exist on any path in this product.

**Finding: a shebang makes a `.mjs` gate untestable.** `#!/usr/bin/env node`
passes `node --check` but makes Vite's parser throw `SyntaxError: Invalid or
unexpected token` **with no file or line**, at import, reported against the
*spec* file. The gate was correct; only the first line was wrong. It is
removed, and no other `tools/*.mjs` gate carries one.

## 32. The deployment pipeline (TASK-007)

`.github/workflows/deploy.yml`, asserted by `T-CI-009a`--`r` in
`tests/infra/deployWorkflow.spec.ts`, and `T-SMOKE-001`--`003` in
`tests/smoke/smoke.spec.ts` (Playwright, `playwright.smoke.config.ts`).

### 32.1 What it claims

Build -> secret-scan the built image -> push to **ghcr.io** with the built-in
`GITHUB_TOKEN` -> deploy **staging** -> `prisma migrate deploy` -> **staging
smoke suite** -> deploy **production** -> migrate -> hold the new revision at
**0 % traffic** -> **production smoke suite** -> shift to 100 %.

Azure auth is an **OIDC federated credential**; no Azure secret is stored.
Registry auth is `GITHUB_TOKEN`; **no PAT exists on this path** (a fine-grained
PAT cannot authenticate to ghcr.io at all -- `docs/ghcr-pat.md`).

The order assertions are the point. `T-CI-009e` fails if the scan moves after
the push, `T-CI-009g` if traffic shifts before the smoke suite, `T-CI-009h` if
staging smoke stops preceding production, and `T-CI-009a` if production stops
needing `staging`. Each of those edits leaves a workflow that still reads
plausibly top to bottom and still goes green.

### 32.2 What it does NOT claim

**There is no authenticated happy-path smoke case, deliberately.** Signing in
requires an interactive Entra login as the owner, which cannot run unattended
without storing owner credentials -- precisely what ADR-0002 exists to avoid.
A smoke suite that required them would trade the product's central security
property for a green tick. The suite proves the inverse instead: that nothing
is reachable **without** signing in, which is the property a deployment can
actually break. §11.2's "authenticated request succeeds" wording is therefore
**not** implemented as written, and this is the reason.

### 32.3 Findings

**(a) A prohibition test fires on the comment explaining the prohibition.**
`T-CI-009b` bans `prisma migrate dev` and initially failed against
`deploy.yml`'s own comment saying why it is banned. The cheapest way to make
that pass is to **delete the explanation**, leaving the rule in place and its
reasoning gone. The checks now run against a comment-stripped copy.

**(b) The build must not push.** `docker/build-push-action` with `push: true`
would publish the image before the secret-scan step is ever reached -- leaving
the scan present, passing, and controlling nothing. `T-CI-009f` pins
`push: false`. Scanning after the push is also not a fix: ghcr retains the
layer even after the tag is deleted.

**(c) `cancel-in-progress` is false on purpose.** Cancelling a deployment
part-way through a migration or a traffic shift leaves the environment in a
state nobody chose. `T-CI-009k` guards it.

### 32.1 The SQL region is separate from every other region (`T-CI-009m`/`n`)

`az deployment group create` failed at the `sqldb` module with
`ProvisioningDisabled`: **Azure SQL refuses new logical servers in whole
regions, per subscription and without notice.** On 2026-08-18 this subscription
could not create a server in `eastus2`, `eastus` or `westus2`, while
`centralus` and `westus3` accepted one. Every other resource deployed into
`eastus2` without complaint, so `infra/main.bicep` gained a `sqlLocation`
parameter rather than relocating working infrastructure to follow one service.

Three properties of this failure make it worth two tests rather than a comment:

1. **`az deployment group validate` does not catch it.** Validation does not
   consult regional capacity, so the template validates cleanly in a region that
   then rejects the write. The pre-flight check that exists specifically to
   avoid a CI round-trip is blind to it.
2. **It fails late and partially.** Log Analytics, storage, the managed
   environment and the container app were all created before the SQL module
   failed, so the symptom is a half-built environment, not a rejected template.
3. **The obvious tidy-up restores it.** Two region parameters where one would
   "do" is exactly the kind of thing a later reader collapses.

`T-CI-009m` asserts each of the two deploy jobs passes `sqlLocation`
**individually**, not that the file contains it at least once — passing it in
staging only would satisfy a count and then fail production, the one environment
with no later stage to catch anything.

`T-CI-009n` exists because `T-CI-009m` alone is satisfiable while fully
reintroducing the bug: `SQL_LOCATION: $LOCATION` and `SQL_LOCATION: eastus2`
both keep the parameter present and both send SQL back to a region that refuses
it. All three mutations -- alias, equal literal, and dropping it from the
production job only -- were confirmed to fail.

**Cost note.** The move is not free but is close to it: prod's SQL **Basic** tier
is `.16`/day in both regions, so the verified `.90`/month is unchanged.
Staging's serverless vCore rate is `.63`/hour in `centralus` against
`.52` in `eastus2` (+21%); with `autoPauseDelay` in force staging bills
essentially nothing, but the **worst case if `autoPauseDelay` is ever deleted
rises from ~`` to ~``/month** (`T-INFRA-005t`--`w`).

---

## 33. Waiting to stream (v1.1) — where its test ids live, and why not here

The v1.1 rental-discovery epic (PRD Epic L, US-040 - US-043, REQ-082 - REQ-087,
ADR-0010) has a complete id-to-AC mapping already written. It lives in
**ADR-0010 section 6**, not in this document.

That is deliberate. `check:orphans` (`T-META-006e`) fails on any id defined
here that no backlog task owns and no suite implements, and it is correct to:
per section 21.1, a defined-but-unbuilt acceptance criterion is the failure
mode where every gate passes, the ledger reaches 100%, and the behaviour is
simply absent. Defining a whole epic's ids here before the epic is scheduled
would manufacture exactly that state.

**When Epic L is promoted, move those tables into this document in the same
change that adds its tasks to `docs/backlog.md`** - the two must land
together, so the ids are never defined without an owner. Do **not** route
around the gate by adding them to `BASELINE_ORPHANS`; that list may only
shrink.

One consequence is already recorded in ADR-0010 section 6.3 and is worth
repeating here, because it lands on a gate this document owns: **`T-CI-005` asserts that
exactly **three** non-owner-initiated processes exist (raised from two by
Epic M, which added the IMDb rating refresh).** The availability refresh is a
**fourth**, so `T-CI-005` goes red the moment Epic L lands. The correct
response is to **amend the count to four** - naming the refresh, and asserting it is metadata-only and access-triggered - alongside
`PRD.md` US-036 AC-2 and product invariant 5. The wrong response is to relax
the gate into counting nothing in particular: its entire value is that the
number is exact and small.


## 34. Database authentication (TASK-141)

**Implemented by:** `apps/api/test/unit/sqlConnection.spec.ts`.

### 34.1 Why these are `T-SEC-035` and not `T-SEC-028`

TASK-141's backlog row cites **`T-SEC-028`** for its token-refresh assertion.
That id was **already taken**: §9 line 744 defines `T-SEC-028` as US-002 AC-1,
*"Every domain type declares required `ownerId`"*, and it is implemented under
that meaning in `apps/api/test/integration/security.spec.ts`. §22.1 records the
collision; this is where it is resolved.

Reusing the id would have silently retired one of the two meanings - the suite
would still be green, and the owner-stamping assertion or the auth assertion
would quietly stop being checked. **The TASK-141 sense is therefore `T-SEC-035`**
(the `T-SEC-0xx` family reached 034). The backlog row is corrected in place.

### 34.2 What is asserted

| Id | L | Assertion |
|---|---|---|
| `T-SEC-035a` | U | Parses server, port and database from a credential-free URL |
| `T-SEC-035b` | U | Parses a URL carrying a SQL login |
| `T-SEC-035c` | U | Port defaults to 1433 when omitted |
| `T-SEC-035d` | U | `encrypt` defaults to **true** when omitted |
| `T-SEC-035e` | U | `trustServerCertificate` defaults to **false** when omitted |
| `T-SEC-035f` | U | A brace-quoted value containing `;` survives parsing |
| `T-SEC-035g` | U | Parameter names are case-insensitive |
| `T-SEC-035h` | U | A non-`sqlserver://` URL is rejected |
| `T-SEC-035i` | U | A URL naming no database is rejected |
| `T-SEC-035j` | U | A non-numeric port is rejected, not silently defaulted |
| `T-SEC-035k` | U | A URL with a credential selects the SQL-login path |
| `T-SEC-035l` | U | A URL with no credential selects the managed-identity path |
| `T-SEC-035m` | U | A user with no password is managed identity, not a half-login |
| `T-SEC-035n` | U | `user=;password=` (an unset deploy secret) is *absent*, not a credential |
| `T-SEC-035o` | U | The MI path sets `azure-active-directory-default` and no user/password |
| `T-SEC-035p` | U | The MI path **never** uses `azure-active-directory-access-token` |
| `T-SEC-035q` | U | The SQL-login path carries the credential and sets no Entra auth |
| `T-SEC-035r` | U | `encrypt` / `trustServerCertificate` reach the driver options |
| `T-SEC-035s` | U | Idle connections drain (`pool.min = 0`), so reconnection re-authenticates |
| `T-SEC-035t` | U | The module hard-codes **no** token lifetime and starts no refresh timer |
| `T-SEC-035u` | U | The log-safe description never reveals the credential |
| `T-SEC-035v` | U | `createSqlAdapter` returns a `sqlserver` driver-adapter factory |
| `T-SEC-035w` | U | A bad URL surfaces as a configuration error from the factory |

### 34.3 The trap `T-SEC-035p` and `T-SEC-035t` exist for

TASK-141 warns that "a naive implementation passes every test on day one and
fails silently in production overnight". The naive implementation is concrete:
tedious offers `azure-active-directory-access-token`, which takes a token
**string**. Fetch one at startup, hand it over, and the pool reuses it for its
lifetime - so the app works perfectly for about an hour after each deploy and
then starts failing, at a time nobody is deploying.

`azure-active-directory-default` hands the **credential** to the driver, which
calls it during each connection's login. There is consequently **no token
lifetime for this code to know, cache, or get wrong**, which is why the
correct implementation contains no refresh timer at all - and why `T-SEC-035t`
asserts the *absence* of one. A refresh timer here would be a guess at a value
the identity provider owns.

`pool.min = 0` (`T-SEC-035s`) is the other half and is **not** a tuning choice:
a token is acquired at LOGIN, so a connection that is never closed never
re-authenticates.

### 34.4 What is deliberately not asserted here

**That the managed identity can actually log in.** That needs Azure, an Entra
token and the database grant from `docs/runbooks/database-access.md`; it cannot
run in CI, where the store is a local `mssql/server:2022` container with SQL
auth. The integration suite therefore exercises the **SQL-login** branch of the
same code path - same adapter, same driver, same parser - and the
managed-identity branch is covered by unit assertions on the configuration plus
the deployed smoke check.

**The M0 smoke migration.** It is not a test in this document because it is a
pipeline step: `prisma migrate deploy (prod)` in `.github/workflows/deploy.yml`.
It has been applying `prisma/migrations/**` against the real **Azure SQL Basic**
database on every deploy, which is TASK-141's gating deliverable. It runs on
Prisma's built-in `sqlserver` connector with the SQL admin login, **not** through
the driver adapter - see `apps/api/src/db/connection.ts` for why that split is
correct rather than a leftover.

---

## 35. IMDb ratings (Epic M, ADR-0011)

Epic M was specified at ADR and REQ level; this section is the AC → named-test
mapping, which is the definition of done (NFR-003).

### 35.1 The ids

| Id | Level | What it asserts | AC |
|---|---|---|---|
| `T-OMDB-001` | U | The client requests OMDb at all, and only over HTTPS | REQ-089 |
| `T-OMDB-002` | U | `"Response":"False"` is a FAILURE despite HTTP 200 — status-code-only handling sees success | REQ-093 |
| `T-OMDB-003` | U | Transport failure raises `OmdbUnavailableError`, and one retry is attempted | REQ-093 |
| `T-OMDB-004` | U | The lookup is keyed `?i=<imdb_id>`. A `?t=` title query is **never** issued | US-046 AC-1 |
| `T-OMDB-005` | U | The daily budget is module-scoped and rolls over from the clock, so **no reset job exists** | REQ-093, US-036 AC-2 |
| `T-OMDB-006` | U | A rating parses to tenths; `"N/A"`, `0` and `>10` all become `null` | REQ-091 |
| `T-OMDB-007` | U | An unparseable body degrades to the absent state rather than throwing | REQ-091 |
| `T-IMDB-001` | U | Staleness: `fetchedAt === null` means "never asked", not "no rating" | REQ-090 |
| `T-IMDB-002` | U | Selection is bounded per request and dedupes by IMDb id | REQ-093 |
| `T-IMDB-003` | U | Tenths round-trip exactly, and `null` survives both directions | REQ-091 |
| `T-IMDB-004` | U | The refresh is serial, never throws, and stops the pass on transport failure | REQ-093 |
| `T-IMDB-005` | U | A write names **only** the two rating columns, and the module exports no sort helper | REQ-095, US-036 AC-2 |
| `T-IMDB-006` | U | `GET /api/imdb/lookup`: the chain, not-found distinct from unrated, no `?t=` fallback, `inList`, and that the module **writes nothing** | US-045 AC-1, US-045 AC-2, US-045 AC-3, US-045 AC-4, US-045 AC-5 |
| `T-IMDB-007` | U | The access-triggered refresh persists through the narrow writer, never rejects, survives a failing write, and no-ops without a key | REQ-090, REQ-093 |
| `T-IMDB-008` | U | Display: one decimal place, `8` renders `8.0`, and `null` renders **the words** — never `0` | US-044 AC-3, US-044 AC-4 |
| `T-IMDB-009` | U | `imdb_id` is read from `external_ids` FIRST, so a **series** resolves at all | REQ-094 |
| `T-ATTR-006` | U | The OMDb provenance line names OMDb, denies IMDb endorsement, and renders on **every** route | ADR-0011 D-1a |

⚠ `T-IMDB-009` is **not** `T-TMDB-011`, which §17 L851 already defines as an
integration test for stored match metadata. Reusing it would have let
`check-status` report an unbuilt integration assertion as delivered.

### 35.2 What is deliberately not asserted here

**That OMDb returns the right number.** That is OMDb's correctness, not ours,
and pinning a live rating in a test would make the suite fail the day a film's
score moves. What IS asserted is that the number is keyed on `imdb_id`
(`T-OMDB-004`) — the property that makes it the *right film's* number.

**A rating sort.** There is none, by decision (REQ-095, OQ-A), and its absence
is what keeps the lazy refresh legal under REQ-041. `T-IMDB-005b` asserts the
service module exports no sort or rank helper.

---

## 36. SPA data access (Epic N, ADR-0012)

⚠ **This section exists because of a green suite on an app that fetched
nothing.** Every web test injects props into a component. That measures
component correctness and says nothing whatever about product integration —
`T-A11Y-001` (no horizontal scroll at 320 px) and `T-A11Y-012` (axe-core)
both pass comfortably on an empty document, because an empty document has no
overflow and no contrast failures. The assertions below are the ones whose
absence was invisible.

All of these live in **`apps/web/test/`** (§11 — not `tests/web/`, which no
Vitest project collects).

### 36.1 The ids

| Id | Level | What it asserts | Req |
|---|---|---|---|
| `T-DATA-001` | U | No component calls `fetch` directly — the check is over `apps/web/src/**` source, so it holds for screens not yet written | REQ-097 |
| `T-DATA-002` | U | **Every data screen actually issues a request on mount**, asserted against a mocked client | REQ-096 |
| `T-DATA-003` | U | **Every** client method sends `credentials: 'same-origin'` — enumerated over the exported surface, not sampled on one call | REQ-097 |
| `T-DATA-004` | U | A 401 redirects to `/.auth/login/aad` with the current path as `post_login_redirect_uri`, and renders no error | REQ-098 |
| `T-DATA-005` | U | A 403 renders the refusal screen, and is distinct from both 401 and a transport failure | REQ-099 |
| `T-DATA-006` | U | A failed read states nothing has changed and offers retry; **no automatic retry or backoff is issued** | REQ-100 |
| `T-DATA-007` | U | Filter/sort/pagination derive from the query string; no component mirrors them into state | REQ-101 |
| `T-DATA-008` | U | Mutations are issued from event handlers only — no mutating call occurs on mount under `StrictMode` | REQ-102 |
| `T-DATA-009` | U | Status polling stops at a terminal state, on unmount, and while `document.hidden` | REQ-103 |
| `T-DATA-010` | U | The envelope `message` is rendered verbatim — no client-side code→copy table | REQ-104 |

### 36.2 Why `T-DATA-008` mounts under `StrictMode`

React 19 **double-invokes effects in development** and `main.tsx` mounts inside
`<StrictMode>`. A `POST` placed in a mount effect therefore fires **twice** —
two batches, two extraction runs — and the doubling **disappears in a
production build**, so it would surface first in the owner's real data rather
than in any test. Asserting under `StrictMode` is what makes the violation
observable at all; a plain `render()` would pass on the broken code.

### 36.3 What is deliberately not asserted here

**Cache coherence and revalidation.** There is no cache to be coherent (D-1),
and REQ-041 forbids background revalidation outright.

**That a screen re-fetches after a mutation.** Mutating flows navigate or
re-request explicitly at the call site; there is no invalidation graph to
verify.

---

## 37. The stylesheet and design tokens (Epic O, ADR-0004 Rev 2)

⚠ **This section exists because the project had no CSS at all.** The owner
opened a fully working, fully signed-in application and reported it as broken.
Nothing failed; nothing was styled.

These live in **`apps/web/test/`**, except `T-CSS-005`, which is exercised in
`tests/e2e/**` where a real engine applies the media query.

### 37.1 The ids

| Id | Level | What it asserts | Req |
|---|---|---|---|
| `T-CSS-001` | U | Every class name used in `apps/web/src/**` is defined in the stylesheet, and every defined rule is used — both directions, so a rename breaks the build rather than the page | ADR-0004 R2-A |
| `T-CSS-002` | U | **`main.tsx` imports the stylesheet.** Without this every other id here passes on an unstyled document | ADR-0004 R2-A |
| `T-CSS-003` | U | No hex literal and no `px` breakpoint appears in a rule body — colours and breakpoints come from `:root` only | §13.2 |
| `T-CSS-004` | U | The WCAG ratio of every token pair, **computed from the token values**: ≥ 4.5:1 for text, ≥ 3:1 for UI boundaries | NFR-011, §10.2 |
| `T-CSS-005` | E2E | `prefers-reduced-motion: reduce` is honoured | §10.2 |

### 37.1a ⚠ `tests/e2e/` WAS EMPTY, AND TWO REQUIRED CHECKS MEASURED NOTHING

Until Epic O landed, `tests/e2e/` contained a `.gitkeep` and nothing else,
while `package.json` ran both jobs with `--pass-with-no-tests`:

```
"test:e2e":  "playwright test --pass-with-no-tests",
"test:a11y": "playwright test tests/e2e/a11y.spec.ts --pass-with-no-tests",
```

So **two of the twelve required checks reported green over zero tests**, and
`T-A11Y-001` and `T-A11Y-012` — cited as done-when evidence by other tasks —
had no implementation at all. `playwright.config.ts` also had **no
`webServer`**, so there was nothing for a test to open even had one existed.
This is the same vacuous-green class as §36's `T-DATA-002` and §37's
`T-CSS-002`, and together they are how an application with **no stylesheet and
no data fetching** passed 12/12 and was handed to the owner, who reported the
page as broken.

⚠ **`--pass-with-no-tests` HIDES A DELETED SUITE AS EFFECTIVELY AS A MISSING
ONE.** It is retained only because `tests/e2e/` is legitimately empty on some
branches; the protection is `T-CI-008`'s location gate plus the fact that
every id in §37.1 is now cited by a task, so `check:orphans` and
`check:test-ids` both fail if one loses its implementation.

⚠ **AN a11y ASSERTION MUST FIRST PROVE THE PAGE RENDERED AND IS STYLED.** A
320 px overflow check and an axe scan both pass *perfectly* on a blank or
unstyled document — there is no overflow to find and no rendered colour pair
to fail on, so each is satisfied by exactly the state it exists to prevent.
`tests/e2e/a11y.spec.ts` therefore asserts a token-derived computed
`background-color` and a non-empty axe `color-contrast` **pass** count before
it asserts anything else. Verified by mutation: removing the one-line
stylesheet import from `main.tsx` fails **10 of the 12** tests in that file.

⚠ **NEVER STRING-MATCH A COMPUTED CSS DURATION.** Chromium serialises
`0.01ms` as `1e-05s` and WebKit as `0.00001s`; a string test written against
one engine reports the other as broken while the CSS is identical. Parse it.

⚠ **AN INVENTED FIXTURE PRODUCES A REAL-LOOKING FAILURE.** The first draft of
the `service-state` stub guessed `{ service, lastUpdatedAt }` instead of the
route's actual projection, leaving `label` undefined and rendering a link with
**no accessible name** — a genuine `link-name` violation caused entirely by
the test. E2E fixtures are copied from the route that produces them.

### 37.2 Why `T-CSS-004` computes ratios instead of trusting `axe-core`

`axe-core` only evaluates a pair that a rendered page happens to use, so a
token that is momentarily unused — or used only on a screen the a11y test does
not visit — is never checked. A token file is precisely where a "slightly
nicer" grey gets substituted.

⚠ **This is not hypothetical: four of the five ratios in §13.2's first draft
were wrong**, in both directions. `#d1d5db` was asserted at "≥ 3:1" and is
**1.47:1** — failing by more than half while looking like an entirely normal
border — and `#6b7280` was rejected as failing at "4.28:1" when it in fact
**passes** at 4.83:1. Non-text contrast is the trap, because a boundary that
is clearly visible can still be nowhere near the threshold. Eyeballing does
not detect either error; arithmetic does.

### 37.3 What is deliberately not asserted here

**Visual appearance.** No screenshot baselines. One owner, two viewports, and
a screenshot suite fails on font-rendering differences between a laptop and CI
far more often than it catches a real regression.

**That Tailwind is absent.** The dependency allow-list (`tools/check-deps.mjs`)
already governs what may be installed; a second assertion would duplicate it.

