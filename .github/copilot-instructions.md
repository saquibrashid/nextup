# Copilot instructions — nextup

**Read this before writing any code.** You are the implementer. These documents
are not a planning aid for a human who will apply judgement — **they are the
work order, and nobody will second-guess them for you** (ASM-028, ASM-029).
Build what the specs say, in the order the backlog says, and make every
acceptance criterion pass its named test.

---

## 1. What nextup is

> Sign in as the owner, upload screenshots of your Netflix and Max saved lists
> in append-only or full-update mode, confirm what was read from them, and see
> one deduplicated combined list — one row per title, a badge per service —
> that you can filter and sort and that never loses anything without asking you
> first.

Single owner. No credentials to streaming services, no scraping, no automated
requests to any streaming service — **ever**. The feeder is screenshots the
owner uploads; an OCR/vision pipeline extracts titles and merges them under the
owner's review.

## 2. The stack — concrete, fixed where the architecture fixes it

| Layer         | Choice                                                                                                                         | Notes                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| Language      | **TypeScript**, end to end, `strict` + `noUncheckedIndexedAccess`                                                              | ADR-0004                 |
| Repo          | **npm-workspaces monorepo**: `packages/domain`, `apps/api`, `apps/web`                                                         | TASK-001                 |
| Front end     | **React + Vite** SPA (`apps/web/src/**`)                                                                                       | ADR-0004                 |
| API           | **Node + Express** (`apps/api/src/**`), single process also serving the built SPA                                              | ADR-0004, TASK-005       |
| Shared domain | Pure TypeScript in `packages/domain/src/**` (types in `types.ts`)                                                              | data-model.md            |
| ORM           | **Prisma, provider `sqlserver`**                                                                                               | ADR-0005 Rev 3           |
| Database      | **Azure SQL Database, Basic** (5 DTU, 2 GB, 7-day PITR)                                                                        | ADR-0005 Rev 3           |
| Staging DB    | a **separate serverless auto-paused Azure SQL database** — there is **no shared server**, Azure SQL bills per database         | ADR-0003 Rev 3           |
| Compute       | **Azure Container Apps**, 0.25 vCPU / 0.5 GiB, **`minReplicas = 1`** (always warm)                                             | ADR-0003 Rev 3           |
| Registry      | **`ghcr.io`** (a fine-grained PAT, `read:packages`) — **NOT** Azure Container Registry                                         | ADR-0003 Rev 3, TASK-146 |
| Extraction    | Azure OpenAI **`gpt-4.1`** vision (primary) **+** Azure AI Vision **Read F0** OCR (deterministic cross-check)                  | ADR-0001 Rev 2           |
| Screenshots   | **Azure Blob Storage**, private container, **30-day lifecycle purge**                                                          | ADR-0006                 |
| Auth          | **Container Apps built-in auth (Easy Auth)** with a federated Entra IdP; allow-list in middleware. Zero application auth code. | ADR-0002                 |
| Tests         | **Vitest** (unit + integration) and **Playwright** (e2e)                                                                       | testing.md               |

**SQL-Server-specific DDL** (filtered unique indexes, `CHECK`, `ISJSON`,
`Latin1_General_100_BIN2` collation) lives in **raw migration SQL**, not in
Prisma's schema modelling. See ADR-0005 Rev 3 and `specs/data-model.md` §16.

The CI integration store is **`mcr.microsoft.com/mssql/server:2022-latest`**
as a service container (`ACCEPT_EULA=Y`, `MSSQL_SA_PASSWORD`,
`MSSQL_PID=Developer`, ~2 GB RAM, explicit health-wait, `sqlcmd` at
`/opt/mssql-tools18/bin/sqlcmd` **with `-C`**). The exact config is
`specs/testing.md` §3.3a — **follow it, do not improvise.** A health check
copied from the web that omits `-C` or uses `/opt/mssql-tools/` silently never
passes.

## 3. Where the specs live, and which is authoritative for what

| Source                 | Authoritative for                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/backlog.md`      | **The work order.** What to build, in order. Tasks sized in agent-runs + owner-review-minutes, not developer-days. Start at the top.                            |
| `docs/PRD.md`          | The **acceptance criteria** (230 of them). What "done" looks like from the user's side.                                                                         |
| `specs/testing.md`     | **The most important spec (NFR-003).** Carries the full **AC → named-test mapping**. Every AC maps to a named test; **that mapping is the definition of done.** |
| `specs/*.md`           | Implementation detail — data model, API surface, AI pipeline, UI, UX states, security.                                                                          |
| `docs/architecture.md` | System design and the cost model.                                                                                                                               |
| `docs/adr/`            | _Why_ each load-bearing decision is what it is.                                                                                                                 |

**Work is driven by `docs/backlog.md`, in order.** The first task is
**TASK-001** (npm-workspaces monorepo scaffold). A task with no test ID cannot
be machine-verified — the only exceptions are named in `specs/testing.md` §10.

## 4. Load-bearing invariants — rules you must not violate

These become **silent defects** if implemented loosely. Each has bitten this
project's design already; treat them as hard rules.

1. **Suppression ("not interested") is keyed on canonical WORK IDENTITY, not
   row id** (REQ-071). A reappearing title becomes a brand-new row, so a
   row-scoped suppression flag is silently bypassed on the next capture — it
   would appear to work, then quietly stop. Key it on `workIdentity`.
2. **Full-update review shows ALL extracted titles, not just new ones.** A
   failed extraction of a known title must never be misread as a removal. **This
   is the single most important safety property in the product.**
3. **Full-update is transactional and scoped to exactly ONE service.** One
   batch close = one transaction, one service.
4. **Soft delete forever. No TTL, no scheduled deletion, anywhere.** The
   _absence_ of such a mechanism **is** REQ-028. **Azure SQL Agent jobs and
   Elastic Jobs are prohibited.** `T-INV-013` / `T-MIG-001` guard this.
5. **No scheduler may change user-visible LIST state** (membership, ordering,
   service badges). The only permitted background work is **metadata-only lazy
   refresh on access** and the **30-day blob purge** (REQ-041 as reworded at
   A37). Exactly two non-owner processes may exist (`T-CI-005`).
6. **Title-level date sort = EARLIEST date-added across the title's listings.**
   The default direction is **newest-first** (`dir=desc`, REQ-038, confirmed by
   the owner at A44), and the **oldest-first reverse control is `must`, not
   optional** (promoted at `A47`). Do **not** trim `components/SortControl.tsx`
   (TASK-166) as nice-to-have scope: it is the sole escape hatch for the
   knowingly-accepted newest-first-vs-SUC-003 trade-off, and OQ-029's revisit
   path depends on it shipping in v1.
7. **Reappearance = a brand-new row dated today** (L1/A33). The removed view is
   a historical **log**, not a recycle bin — it will legitimately hold several
   rows for the same work over time. Restore is an explicit user action only,
   never an automatic consequence of reconciliation.
8. **Two 30-ish-day constants that must never be merged (REQ-040 retired at
   `A46`):** `IMAGE_RETENTION_DAYS = 30` (NFR-019, screenshot retention) vs
   `TMDB_METADATA_MAX_AGE_DAYS = 183` (NFR-014, lazy metadata refresh). Declare
   them separately in `apps/api/src/config.ts` and never let one import the
   other's call site; `T-INV-008` enforces it. ⚠ **There is no list-staleness
   constant.** `LIST_STALENESS_DAYS` was deleted with the staleness nudge —
   if you find a reference to it, it is stale documentation, not a TODO.
   ~~Superseded: "NFR-019 image retention (user-decided, real) vs ASM-038
   staleness threshold (an unconfirmed placeholder)."~~
   8a. **There is NO staleness nudge, and you must not add one (`A46`).** The owner
   dropped the concept outright: no staleness threshold, no nag, no derived
   `stale` state, no "you haven't updated in N days" prompt, no re-capture
   reminder. ⚠ **But the factual per-service last-updated date STAYS** —
   **REQ-039 (`must`)** is the mandatory mitigation for **RSK-007** (the list
   silently going out of date without the owner noticing). `FreshnessStrip`
   renders _"Netflix updated today"_, _"Max updated 47 days ago"_, _"Max has
   never been updated"_, and tapping it still opens `/upload` with that service
   pre-selected. **Show the fact; never nag about it.**
   ⚠ **"Stale" is overloaded — do not pattern-match on the word.** The TMDB
   `metadataStale` flag and its 183-day lazy refresh (NFR-014) are a _different,
   still-required_ feature. Deleting them because they say "stale" breaks the
   metadata pipeline.
9. **NFR-012a: extraction is quality-first.** A cost-motivated downgrade of
   extraction quality is **non-compliance, not an optimisation.**
10. **No telemetry, no analytics, no credentials, no scraping, no automated
    requests to streaming services.** The dependency allow-list
    (`tools/check-deps.mjs`, TASK-004) forbids telemetry/analytics packages;
    adding one fails CI.
11. **Uploads accept PNG _and_ JPEG _and_ HEIC/HEIF — all three (REQ-007,
    ASM-058).** ⚠ **This is not a swap and the list must not be "tidied".** iOS
    _screenshots_ are normally PNG, iOS _camera photos_ default to HEIC, an iOS
    Safari file input can deliver any of the three, and the laptop-web capture
    path produces PNG. Dropping any one of them breaks a real capture path —
    an earlier PNG/JPEG-only spec would have rejected the owner's own phone
    images on first use. Determine format by **magic bytes, never by the
    declared `Content-Type`** (iOS commonly sends `application/octet-stream`).
12. **HEIC/HEIF must be transcoded server-side to lossless PNG on ingest
    (REQ-077, ADR-0008), before storage and before extraction.** No extraction
    service accepts HEIC and only Safari renders it, so there is no
    client-side path. Transcode is **inline in the upload request** — it is
    user-initiated and therefore does **not** engage the no-background-process
    rule in invariant 5. Lossless PNG, **not** a lossy JPEG re-encode:
    degrading the image degrades extraction, which invariant 9 forbids. Keep
    images processed **serially** and reject implausible pixel dimensions
    _before_ allocating a decode buffer — memory is 0.5 GiB and OOM here is
    live risk RSK-016.
13. **Strip EXIF/XMP metadata — including GPS and device model — from every
    uploaded image on ingest (REQ-078), and assert it with a test.** HEIC
    carries location data. Do not rely on a library stripping it incidentally;
    prove it.
14. **Memory size and the decode guard are ONE setting in two places
    (REQ-079).** The container runs at **0.25 vCPU / 0.5 GiB** with
    `NEXTUP_MAX_DECODE_PIXELS=25000000`. The owner chose deliberately to start
    small and up-size **reactively** (`docs/runbooks/scale-up-memory.md`,
    +~$4/month) — so **do not pre-emptively raise the memory** "to be safe",
    and **never change one of the two values without the other** in the same
    commit. The only permitted pairs are `(0.25, 0.5Gi, 25000000)` and
    `(0.5, 1.0Gi, 50000000)`; `T-INFRA-005` fails CI on anything else.
    The guard is a **pixel** guard read from the image header — ⚠ **a byte-size
    ceiling is NOT a substitute and must not be implemented as one**: HEIC
    compression varies wildly and a 6 MiB file can decode to 48 MP.
15. **A memory/decode failure must fail ONE IMAGE, never the batch
    (REQ-080/081).** No partial commit; the rest of the batch still processes;
    the failed file stays retryable. Handle **both** failure paths — a
    **catchable** WASM `RangeError` (no restart, an error is raised) **and** a
    kernel OOM kill (restart, no error ever raised). Handling only one misses
    the likelier case. The message must name **memory** as the cause and link
    the runbook; the separate corrupt-file code must mention **neither**.

16. **There are THREE ingest affordances, not one (REQ-001/REQ-004, ADR-0009):
    clipboard paste (primary), file selection, and drag-and-drop.** ⚠ **Paste
    was ADDED, not swapped in — file selection must remain a complete path**
    (the laptop screenshot path and the iOS Photos path both need it), and
    `T-PASTE-010` is an e2e regression guard that fails if it is displaced.
    Two different primitives are required and both must be built: the **`paste`
    event** (Ctrl/Cmd+V) on desktop, and a **visible "Paste screenshot"
    button** calling `navigator.clipboard.read()` **synchronously inside the
    click handler** on iOS. A document-level listener alone is _not_ a working
    iOS design. Scope the desktop listener so it does **not** hijack text paste
    when an editable element is focused. All three affordances **append to the
    same open `UploadBatch`** — no new entity, no auto-submit.
17. **The HEIC transcode is CONDITIONAL, and the condition is the SNIFFED
    format — never the ingest source.** `if (ingestSource === 'paste')
skipTranscode()` is **forbidden**: it is currently equivalent, but it makes
    a security-relevant decision from untrusted client input. The transcode is
    **not deleted** — the iOS Photos path still delivers raw HEIC. The metadata
    strip and the pre-decode pixel guard sit **outside** the condition and run
    for every image from every source.
18. **The EXIF trap.** WebKit strips EXIF on clipboard read but **NOT** on file
    upload, so REQ-078's explicit strip **must stay on the upload path**. A test
    for it must use an **uploaded** EXIF-bearing image, or it passes vacuously
    while GPS data flows in through the other route.
19. **HTTPS is a functional dependency, not just a security one.**
    `navigator.clipboard` is absent on `http://` — over a plain LAN IP the paste
    button will simply not be there. Do not debug that from scratch.

20. **If you were given a LANE, you own only that lane's paths.** Multiple
    agents may be building this repo in parallel — see
    `docs/parallel-execution-plan.md`. When your opening prompt names a lane:
    - **Write only inside the paths listed for your lane** in §4.2 of that
      document. Do not create, edit or delete anything outside them, however
      obviously broken it looks.
    - **A shared file is a HARD STOP, not an obstacle to route around.** The
      contended set is listed in §6 of that document and includes
      `packages/domain/src/enums.ts` (the closed error-code enum),
      `apps/api/src/middleware/errorEnvelope.ts`, `apps/api/src/app.ts`
      (middleware order), `apps/api/src/routes/batches.ts`, `infra/aca.bicep`,
      `.github/workflows/ci.yml`, every workspace manifest, and
      `prisma/schema.prisma` + `prisma/migrations/**`. If your task needs one
      changed: **stop and report the change you need.** Do NOT make it, and do
      NOT duplicate the file, shadow it, or add a parallel implementation to
      avoid touching it — a divergent second copy is worse than a blocked task.
    - **Migrations are never yours** unless you are lane A. Concurrent
      migration files apply in filename/timestamp order, which is _not_
      dependency order.
    - **Do not edit `specs/**` or `docs/**` to agree with your code.** The
      specs are the input to your work, not an output of it. A spec that looks
      wrong is a finding to report.
    - **Rebase onto `main`; never merge `main` in, and never touch another
      lane's branch.**
    - **If you finish early, stop.** Do not pick up the critical path or
      another lane's tasks to be helpful. Unrequested cross-lane work is the
      single most expensive thing you can do here.

## 5. How to read revision banners (the F-001 lesson — applies to you too)

Several documents carry revision banners: the datastore changed twice
(**Cosmos → PostgreSQL → Azure SQL**) and hosting changed too. Rule:

- **The latest revision section is authoritative.** Struck-through and
  "retained verbatim / historical" text is **dead** — do not build it. If a
  document names PostgreSQL, `pg_trgm`, ACR/`AcrPull`, Postgres error `23505`,
  or `postgres:16-alpine` as _current_, you are reading a superseded section.
  Current is **Azure SQL, `ghcr.io`, error `2627`/`2601`, `mssql/server:2022`**.
- **When YOU edit a document where text is an INSTRUCTION a machine executes
  top-to-bottom, correct it _in place_ and put any superseded version _below_
  it, struck through.** Supersede-by-banner (a note at the top pointing
  elsewhere) is for **rationale and design narrative only**, never for an
  executable instruction — that is exactly the F-001 defect this project hit.

## 6. Guardrails while working

- **No secrets in the repo.** `.env.example` carries placeholders only. Real
  values are Container Apps secrets / Key Vault references. Database auth
  prefers managed identity (secretless); the fallback is a Key-Vault SQL login.
- **Migrations are the one place data is lost quietly.** Prisma will generate a
  `DROP COLUMN` from a renamed field. `T-MIG-001` greps `prisma/migrations/**`
  and fails on `DROP TABLE`, `ALTER TABLE ... DROP COLUMN`, `DROP INDEX`,
  `DROP CONSTRAINT`, `TRUNCATE`, and `sp_rename` column renames.
- **Every new runtime dependency** must be justified against NFR-004
  (mainstream, well-documented) in the PR. The intended set is small — see
  `specs/security.md`.
- **CI is the only gate.** If it is not asserted by a named test, it is not
  done.
