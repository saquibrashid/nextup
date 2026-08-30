---
createdAt: 2026-08-10T23:30:00-04:00
createdBy: artifact-reviewer
phase: 11
checksRun: 22
findings: { critical: 0, high: 1, medium: 4, low: 2, nit: 0 }
verdict: fix-blockers-first
scope: NON-INTERACTIVE audit of Context/* and docs/* at Revision 4 (A40 Variant A)
sourceOfTruth: Context/session-state.json, Context/requirements.md, Context/mvp-definition.md §17–§18
---

# Review Report — nextup (Phase 11 artifact review)

## Verdict

**fix-blockers-first — one High finding, then build.** This artifact set is,
on the whole, unusually disciplined: the load-bearing product invariants the
brief flagged as silent-defect hazards are each stated consistently across
`requirements.md → PRD → specs → ADRs → diagrams` *and* backed by a named test,
and the three post-hoc constraint changes (CC-001/002/003) were genuinely
applied by superseding banner rather than silent rewrite in most places. The
review therefore spent its effort where the risk actually is: the **datastore
churn (RSK-030)**, where a superseded layer can still read as current.

It found one place where that failed materially — **`architecture.md`'s
"Environments and deployment" section still describes the Revision-3 PostgreSQL
/ ACR / `postgres:16-alpine` world as the current design, and does so
*unbannered*, while the R4 banner's own per-section manifest claims that section
was already updated to Azure SQL + ghcr.io.** An autonomous implementer that
provisions infrastructure from that section (a plausible reading — it is the
section literally titled "Environments and deployment") builds the wrong store,
the wrong CI container, the wrong registry, and a "shared PostgreSQL server"
staging topology that no longer exists. That is exactly the RSK-030 failure
mode the review was commissioned to catch, and it is the single thing to fix
before anyone builds. The remaining findings are Medium/Low consistency and
count drift, all in the same datastore-churn family, all cheap to fix, and all
would be *partially* caught by `TASK-143`'s consistency sweep — which is itself
an unexecuted build task with an incomplete grep set (F-004).

There are **no Critical findings**, and that is a substantiated conclusion, not
a courtesy — see "What was checked and passed" below for the specific invariants
verified and how.

---

## How this review was conducted (so the "no Critical" is credible)

- **Traceability sampling.** I did not eyeball all 230 acceptance criteria. I
  confirmed the header claims (`testing.md` §9 asserts 39 stories / 230 ACs;
  §10 names 11 non-machine-verifiable ACs) against ground truth: **39 distinct
  `US-` ids in `PRD.md`** and **39 `### US-` headings in `testing.md`** — they
  agree. I then read the full AC→test rows for **7 stories chosen to cover every
  load-bearing safety property in the brief**: US-013 (full-update shows all),
  US-020 (earliest-date sort), US-021 (date-added once, honest label), US-023
  (soft-delete-forever / no scheduled deletion), US-024 (removed view as log),
  US-026 (reappearance = new row), US-028 (suppression keyed on work identity).
  Every one resolves to a dedicated, correctly-scoped test. **Residual:** I did
  not verify that all 230 referenced test ids *exist* as files; the project
  delegates that to a build-time gate (`T-META-001`, US-039 AC-1) rather than to
  a static document, which is the correct place for it but means it is unproven
  until CI runs once.
- **Supersession hunt.** Ripgrep across `docs/**` for `Cosmos`,
  `PostgreSQL/Postgres/pg_trgm/pg_cron/B1ms`, `ACR/Container Registry`,
  `near-zero/\$0/month/free tier only`, `\$30`, then read each hit in context to
  decide whether it reads as **history (fine)** or as **current (defect)**.
- **Invariant consistency.** Cross-file grep for each named invariant
  (no scheduler, no TTL, Agent/Elastic-job prohibition, earliest-date sort,
  identity-keyed suppression, the three distinct 30/183-day constants) to
  confirm the *same* rule appears everywhere it should and nowhere contradicts.
- **Count reconciliation.** Programmatic count of distinct `TASK-` ids, `US-`
  ids, and the functional/NFR figures stated in prose vs. the authoritative
  per-row tables.

---

## Findings

| ID | Severity | Check | Finding | Location | Recommended fix | Loop-back |
|---|---|---|---|---|---|---|
| F-001 | **High** | B4 / RSK-030 | `architecture.md` §"Environments and deployment", §"…deployment" promotion path, and §Region still present the **Revision-3 PostgreSQL / ACR / `postgres:16-alpine` / "same PostgreSQL server" staging** design as current, *unbannered*. This **contradicts the R4 banner's own §Per-section supersession table**, which asserts §Environments now reads "Registry ghcr.io; staging DB is serverless auto-paused Azure SQL", and contradicts the authoritative `specs/data-model.md` §16 and `testing.md` §3.3a. It also fails `TASK-143`'s stated grep exit criterion (`postgres:16` must appear only in banners). An autonomous implementer building infra/CI from this section provisions the wrong store, wrong registry, wrong CI container, and a staging topology that no longer exists. | `architecture.md` L613 (`postgres:16-alpine`), L614 ("same PostgreSQL server"), L640 ("image pushed to Azure Container Registry"), L588–592 (Region: "PostgreSQL Flexible Server B1ms"); rationale echoes at L178 (F2 "moved to PostgreSQL / moved to ACR") and L547 (NFR-003 "fixture is now postgres:16-alpine") | Rewrite the three sub-sections in place for Variant A: `mssql/server:2022-latest` CI (per `testing.md` §3.3a), Azure SQL Basic + serverless auto-paused staging **database** (there is no shared server anymore), ghcr.io push. Then make L178/L547 R3-historical or update them. The blanket "read PostgreSQL below as historical" banner is **insufficient for a literal machine reader** where the section gives concrete, actionable, contradictory provisioning instructions. | solution-architect |
| F-002 | Medium | B3 / A41 survival | The **first file an implementer reads** (`specs.md`, per its own "Reading order") states in its un-bannered *Vision* prose that nextup is "built to run for **approximately nothing on Azure free tiers**." A41 repealed near-zero-cost system-wide and A40 settled the design at **~$11–13/month on paid Azure SQL Basic + always-warm compute**. The claim directly contradicts the *Platform* paragraph two lines below it and the R4 banner in the same file. | `specs/specs.md` L18–19 (Vision paragraph) | Change to reflect the owner-selected ~$11–13/month Variant A, or explicitly mark the phrase as the original vision framing. Note the file's own §"Core features (v1 — 59 functional requirements)" heading is **correct** — do not touch that. | spec-writer |
| F-003 | Medium | D1 / count drift | `backlog.md` frontmatter `totalItems: 139` (and `mvpItems: 139`) **undercounts the tasks that actually exist.** The file contains **140 distinct numeric `TASK-` ids** (1–146, with 135–140 unused) **plus 4 suffixed task-units** (`TASK-056b/056c/059b/079b`) = **144 task-units**. The A41/Variant-A revision lineage counted from the pre-extraction baseline of 133 (133→137→139) and never folded in the 5 task-units the A40 *extraction* revision (CC-001) added (`056b/056c/059b/079b/134`). Effort/roadmap math and any "iterate every task" pass are off by ~5. No task is *missing* from the tables — only the tally is wrong. | `backlog.md` frontmatter L4–5; roadmap references (`roadmap.md` M-block "Contains" ranges are consistent with the table, but the headline count is not reconciled) | Recompute `totalItems`/`mvpItems` to the true figure (144 task-units, or state the counting convention explicitly and apply it once) and reconcile the R3/R4 delta narratives so both constraint-change branches are summed from the same 133 baseline. | backlog-planner |
| F-004 | Medium | C1 / safety-net gap | `TASK-143` — the consistency sweep that is *designed* to eliminate exactly the F-001/F-005/F-007 defect family — is (a) an **unexecuted build task**, so at review time the specs it is meant to reconcile are still inconsistent, and (b) its grep exit-criterion token set is **incomplete**: it lists `cosmos, ghcr, pg_trgm, postgres:16, 23505, AcrPull, continuation token, partitionKey, minReplicas=0` but **omits** `EXPLAIN (ANALYZE`, `SET STATISTICS`, the bare phrase "PostgreSQL server", and `B1ms` — so it would pass a file that still contains F-005 and parts of F-001. | `backlog.md` L201 (TASK-143 exit criterion) | Widen the grep set to include `EXPLAIN \(ANALYZE`, `SET STATISTICS`, `PostgreSQL`, `B1ms`, `Flexible Server`, `AcrPull|AcrPush`. Recognise that F-001 must be fixed *by hand* first — a grep gate detects but does not repair unbannered prose that gives contradictory instructions. | solution-architect / backlog-planner |
| F-005 | Medium | B1 / within-file | `testing.md` §9 US-024 AC-5 still **defines `T-PERF-001` using PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)`** (and "no sequential scan"), while §11-R4.1 repoints the *same test* to SQL Server's `SET STATISTICS PROFILE` / `sys.dm_exec_query_plan`. An implementer reading the §9 mapping (the file's declared "definition of done") writes the wrong, non-T-SQL assertion. | `testing.md` L823 (US-024 AC-5) vs L1021 (§11-R4.1 `T-PERF-001` row) | Update the §9 US-024 AC-5 assertion text in place to the SQL-Server plan form, or replace the syntax with a store-neutral statement and cite §11-R4.1. | spec-writer |
| F-006 | Low | B4 / append-supersession residual | The two most load-bearing infra tasks lead with the **superseded** design as their *primary* instruction and correct it only in an appended "↳ R4" clause: `TASK-006` names `infra/postgres.bicep` and `infra/acr.bicep` as files to create (then "replace"/"Delete" in the appendix), and `TASK-141`'s title is "Entra-token refresh for the **PostgreSQL** connection". This is the project's accepted supersede-by-append convention, but it is heavy for a literal top-to-bottom reader and invites creating-then-deleting `acr.bicep`. Acceptance criteria on both are correct (Azure SQL / ghcr). | `backlog.md` L194 (TASK-006), L199 (TASK-141) | When F-001/F-003 are addressed, promote the R4 choice into the primary text of these two tasks and demote the PostgreSQL/ACR text to a struck-through history line, so the *first* thing read is the thing to build. | backlog-planner |
| F-007 | Low | B1 / stale store name | `ADR-0006` states list records "live in **Cosmos DB** and are untouched by any expiry mechanism." ADR-0006's own decision (blob storage + lifecycle purge) is unaffected and correct, but the incidental store name is two revisions stale (now Azure SQL). A reader taking it literally learns the wrong store. `TASK-143`'s `cosmos` grep would catch it — further evidence the sweep has not run. | `adr/ADR-0006-screenshot-storage-and-retention.md` L111 (and the §Consequences line ~194 "no Cosmos container has a TTL") | Replace "Cosmos DB" with "the Azure SQL database" (or "the relational store, ADR-0005 Rev 3"), or mark the line R1-historical. | solution-architect |

---

## What was checked and passed (one line each — effort was not spent re-verifying these)

- **Full-update review shows ALL extracted titles** (the brief's "single most
  important safety property): stated in `requirements.md`, PRD US-013,
  `specs.md` constraint #2, and tested by `T-REV-006`/`T-REV-015`/`T-REV-017`
  (US-013 AC-1/AC-4/AC-6). Consistent everywhere. ✅
- **Suppression keyed on canonical work identity, never row id**: `T-SUP-001`
  asserts `suppression.id === 'supp:' + workIdentity`; `T-SUP-003` asserts the
  suppress→remove→re-upload→creates-nothing case (US-028). ✅
- **Reappearance = brand-new row dated today; removed view is a historical log,
  not a recycle bin**: US-026 (`T-REAP-010..014`), US-024 AC-6 ("never
  de-duplicated", ordinals). `REQ-065` correctly rewritten after ASM-047 was
  falsified. ✅
- **Soft delete forever; no TTL / no scheduled deletion anywhere**: SD-04,
  `T-INV-012`/`T-INV-013`; the **Azure SQL Agent-job / Elastic-Job prohibition
  correctly replaces the `pg_cron` one** (R4), stated identically in
  `data-model.md` §16.7, `architecture.md`, both store diagrams, `security.md`
  §Infra assertions, and backlog. ✅
- **No scheduler**: `REQ-041` (A37 wording), lazy TMDB refresh inline +
  30-day blob-lifecycle purge are the only two permitted non-owner processes;
  `T-CI-005` static gate. Consistent across ADR-0003, `ai.md` §9, `api.md` §6.4,
  diagrams. ✅
- **Title-level date sort = EARLIEST across non-removed listings**: US-020
  (`T-LIST-014/015`, "adding a later listing does not move the row"). ✅
- **The two 30-day / 183-day constants are kept distinct**:
  `IMAGE_RETENTION_DAYS` (NFR-019), `TMDB_METADATA_MAX_AGE_DAYS` (NFR-014) —
  explicitly "MUST NOT be refactored into a shared constant" in
  `data-model.md` §config, PRD US-035/US-010, architecture, and enforced by
  `T-INV-008`. (A third such constant, `LIST_STALENESS_DAYS` / REQ-040 /
  ASM-038, was retired at A46 — the owner dropped the list-staleness-nudge
  concept entirely; the guard now firewalls two constants, not three.) This
  is a model of how to prevent a silent merge. ✅
- **Full-update is transactional and scoped to exactly one service**:
  ASM-023/ASM-024, REQ-002/REQ-023, US-005/US-014/US-016; `T-REM-011` (append
  has no removal section), `T-REM-010` (one service only). ✅
- **Cost supersession layering** in `BRD.md`, `PRD.md`, `architecture.md`
  §Cost summary, and `specs.md` R4 banner: Variant A is current, the ~$30
  PostgreSQL design is retained and clearly labelled "richer variant, not
  selected", Variant B ~$0.65 retained. BRD/PRD reference PostgreSQL **only** as
  struck-through history — they were retrofitted despite CC-003's `notAppliedTo`
  note. ✅
- **The two store diagrams** (`container-diagram.md`, `deployment-diagram.md`)
  correctly show **Azure SQL Basic** as the current store with R4 banners. ✅
- **`intake.md`** carries a prominent "PARTIALLY SUPERSEDED — DO NOT READ AS
  CURRENT SCOPE" banner (OQ-017 closed); credentialed-sync content is clearly
  dead. ✅
- **ADR-0007** is now "**Accepted (as amended)**" (the spec-writer's flagged
  follow-up is done); the "Proposed" string survives only inside the historical
  body. ✅
- **The v1 count error is corrected**: `requirements.md` §1.8 and
  `mvp-definition.md` §18 both now say **63 functional, 59 in v1** and both
  explicitly retract the earlier wrong "62 in v1". No stale "62 in v1" survives. ✅
- **Abuse-monitoring privacy regression** (Azure OpenAI retains screenshots ≤30
  days, possible human review) is **disclosed, not buried**: `security.md` §4.1,
  STRIDE T10, data-classification C1, and gated by `TASK-134` "before the first
  real upload". Correctly recorded (see owner questions #2). ✅

---

## Traceability matrix (sampled — the 7 safety-property stories)

| Requirement(s) | Story | Backlog | Named test(s) | Status |
|---|---|---|---|---|
| REQ-010/011/017 (mode-scoped review) | US-013 | TASK-081+ | T-REV-006/015/017, T-UI-006 | ✅ complete |
| REQ-036/038/050 (earliest-date sort) | US-020 | TASK-039/041 | T-LIST-014/015/016/017/025/026 | ✅ complete |
| REQ-030/043/044 (date-added once, honest) | US-021 | TASK-036+ | T-DATE-010..013, T-LIST-018, T-INV-006 | ✅ complete |
| REQ-028/046/062 (soft-delete forever, no purge) | US-023 | TASK-095+ | T-RET-010, T-LIST-013, T-INV-012/013, T-PERF-001 | ✅ complete |
| REQ-062/063/064 (removed view = log) | US-024 | TASK-096+ | T-REM-020/021/022/006, T-UI-009/011 | ⚠ complete but T-PERF-001 syntax stale (F-005) |
| REQ-065 (reappearance = new row) | US-026 | TASK-100 | T-REAP-010..014, T-SUP-003 | ✅ complete |
| REQ-070/071/072/073 (identity-keyed suppression) | US-027/028 | TASK-101–105 | T-SUP-001/002/003/006/013/016 | ✅ complete |

Header coverage claim verified: **39/39 stories** present in both `PRD.md` and
`testing.md`; **230 ACs** mapped in §9 with **11** exceptions named in §10.
Not exhaustively re-verified: existence of every one of the 230 test files
(delegated to `T-META-001`, US-039 AC-1 — a correct choice, but unproven until
first CI run).

---

## Realism check

| Dimension | Stated | Planned | Verdict |
|---|---|---|---|
| Timeline | No deadline, "done when done" (ASM-027) | 8 milestones, no date pressure | ✅ consistent by construction |
| Budget | NFR-012 now a `should`; owner-selected **≈$11–14/month** Variant A (OQ-026 closed) | Per-component cost table in `architecture.md` §Cost summary sums to ~$11–13 | ✅ consistent — **but every figure is unverified model-knowledge, ±30 % (RSK-029)**; `TASK-010` must re-verify first sprint. See owner question #1. |
| Team capacity | Autonomous coding agent; human budget = review only (ASM-028/029) | 144 task-units sized in agent-runs + owner-review minutes; RSK-017 (review is the bottleneck) tracked; RSK-027 (TASK-010/011 + the new Variant-A tasks 141/143/144/145/146 are owner-dependent) tracked | ✅ realistic; RSK-027's claim that only TASK-010/011 need the owner is now stale — 141/146 (PAT/MI) and 134 (exemption) are also owner-dependent. Minor; noted for RSK-027 upkeep. |
| Scope discipline | 59 of 63 functional in v1; 13 `wont-v1`; 4 deferred to v1.1 | — | ✅ **~94 % of functional in v1 is high, but defensible**: this is one owner's private tool with an already-tight cut, not an over-broad MVP. Not flagged as D4 because the requirement set is itself small and purpose-built. |

---

## Open items carried forward (correctly recorded — not re-litigated per brief)

| ID | Question | Blocks | Severity if unanswered |
|---|---|---|---|
| RSK-029 | All Azure prices are unverified model-knowledge (±30 %) | Cost realism | Medium — mitigated by `TASK-010` + `TASK-142` budget alert |
| RSK-030 | Spec churn across two datastore changes | Implementation correctness | Medium — this review's F-001/004/005/007 are its live residue |
| RSK-031 | Prisma + Azure SQL less-travelled than Prisma + PostgreSQL (tension with NFR-004, PRD G-9) | M0 build | Medium — gated by `TASK-141` M0 smoke migration + KV-password fallback |
| OQ-024/OQ-025 | 7-day PITR on an append-only, never-purged, irreplaceable store | Data durability | Medium — `TASK-131` BACPAC export promoted to primary, must land M0/M1 |
| TASK-134 | Azure OpenAI abuse-monitoring exemption before first real upload | Privacy (RSK-014 / NFR-011) | **High if skipped** — owner action, see below |

---

## Assumptions audit (agent-derived actives — treat with the brief's suspicion)

| ID | Assumption | Confidence | Used by | Labelled correctly? |
|---|---|---|---|---|
| ~~ASM-034~~ **FALSIFIED at A42 — superseded by ASM-058** | ~~Upload formats are PNG + JPEG~~ → **PNG, JPEG and HEIC/HEIF are all accepted**, with a server-side HEIC→PNG transcode on ingest (ADR-0008) | ~~Medium~~ **realised** | REQ-007, US-004 AC-4/AC-7/AC-8 | ⚠ **This review called the shot.** The prediction "invalidated if iOS produces HEIC/WebP" was correct within hours: the owner answered *"iOS screenshots save as heic."* As specified, US-004 AC-4 would have **rejected the owner's own phone images at attach time** — v1 would have failed on first use. **WebP, the other half of the prediction, remains unconfirmed** — both extraction services accept it natively, so it is a cheap widening if it ever appears; no requirement invented for it. |
| ~~ASM-035~~ **CONFIRMED at A44 (2026-08-11)** | Default order = date added, most recent first | **High — user-stated ("Newest-first — conventional, recent saves on top"), no longer an assumption** | REQ-038, R-14 | ✅ labelled; now the first agent-derived inference in this project confirmed rather than falsified (1 of 5 tested) |
| ~~ASM-038~~ **RETIRED at A46** | 30-day list-staleness threshold | ~~Low (explicit placeholder)~~ retired | ~~REQ-040~~ (retired) | ✅ labelled; the owner dropped the whole concept — *"Drop the concept entirely — no staleness nudge"* — rather than confirming or falsifying the placeholder value |

The meta-lesson is now settled: **six** tested agent-derived inferences, **one
confirmed, five falsified** (A15 phone-photo-of-TV; ASM-047 reappearance;
ASM-034 upload formats; ASM-012/013 file-upload-only ingestion transport;
ASM-038 the list-staleness threshold, retired at A46). **ASM-035 is the only
one to survive** — confirmed verbatim at A44. **Zero agent-sourced
assumptions remain active or unconfirmed.**

---

## Recommended loop-back plan

| # | Loop-back | Agent | Fixes | Effort |
|---|---|---|---|---|
| 1 | **Rewrite `architecture.md` §Environments/§Deployment/§Region for Variant A**, and make L178/L547 rationale R3-historical | solution-architect | F-001, F-007 | ~30 min — 3 sub-sections + 1 ADR line |
| 2 | Fix `specs.md` Vision free-tier prose; fix `testing.md` §9 US-024 AC-5 T-PERF-001 syntax | spec-writer | F-002, F-005 | ~10 min — 2 in-place edits |
| 3 | Recompute `backlog.md` `totalItems`/`mvpItems`; reconcile the R3/R4 count deltas; promote Variant-A into TASK-006/141 primary text | backlog-planner | F-003, F-006 | ~15 min |
| 4 | Widen `TASK-143` grep token set; then **run** the sweep as the exit gate for #1–#3 | solution-architect / backlog-planner | F-004 | ~10 min + sweep |

**No `prd-writer` or `brd-writer` loop-back is required** — the BRD and PRD are
consistent with Variant A and reference PostgreSQL only as marked history.

---

## Questions for the owner (would have been asked interactively; recorded here per the non-interactive instruction)

1. **Cost is unverified (RSK-029).** The ~$11–14/month figure is model-knowledge
   list pricing, ±30 %, with the always-on Container Apps line the least certain.
   `TASK-010` re-verifies it in the first sprint and `TASK-142` sets a budget
   alert at 1.5×. Are you content to proceed on that basis, or do you want a
   verified quote before build?
2. **Privacy regression you must action before first real upload (TASK-134).**
   Making `gpt-4.1` vision the primary reader means Azure OpenAI may retain your
   uploaded screenshots for up to 30 days with possible authorised human review,
   unless you obtain the Limited Access modified-abuse-monitoring exemption. Your
   screenshots can contain a profile name or email (RSK-014). This is disclosed,
   not blocking the build — but it **is** blocking your *first real upload*.
   Do you want to apply for the exemption now?
3. **7-day recovery window on irreplaceable data (OQ-025 re-widened).** Azure SQL
   Basic caps point-in-time restore at 7 days, and the store never hard-deletes,
   so a corruption or bad migration unnoticed for a week is unrecoverable via
   PITR. `TASK-131` (weekly BACPAC export) is the compensating control and is
   recommended for M0/M1. Confirm you want that landed early, or accept the 7-day
   exposure.
4. **Prisma + Azure SQL is the less-travelled path (RSK-031).** You chose
   Variant A, which trades the best-documented ORM stack for ~$10/month. The M0
   smoke migration (`TASK-141`) proves it before feature work; if managed-identity
   auth won't cooperate, the fallback is a Key-Vault SQL password. Are you okay
   with that fallback if M0 forces it?
5. ~~**Three agent-derived assumptions are still unconfirmed**~~ — **ANSWERED
   AT A42, A44 AND A46; zero remain.**
   ASM-034 was put to the owner and **falsified** (*"iOS screenshots save as
   heic."*). This report's own prediction — "invalidated if iOS produces
   HEIC/WebP" — proved correct within hours, and the defect was real: US-004
   AC-4 would have rejected the owner's phone images at attach time. **ASM-035
   was subsequently put to the owner at A44 and CONFIRMED** — *"Newest-first —
   conventional, recent saves on top."* This is the **only** agent-derived
   inference in this project to survive contact with the owner: the
   tested-inference record moves from **three attempts, three wrong** to
   **six attempts, five wrong, one confirmed** (A15 phone-photo-of-TV,
   ASM-047 reappearance, ASM-034 formats, the ASM-012/013 file-upload-only
   inference and ASM-038 the list-staleness threshold were wrong or
   withdrawn; ASM-035 was right). Confirming ASM-035 also
   surfaced an accepted trade-off against SUC-003 (old, forgotten saves
   resurfacing) — tracked as **R-14** in `PRD.md` and **OQ-029** in the
   Context layer; the owner was told of the tension and chose newest-first
   anyway, with REQ-038's reverse-direction control as the named escape
   hatch. **ASM-038** (a service goes "stale" at 30 days) was put to the
   owner at **A46** and answered by **dropping the concept entirely** —
   *"Drop the concept entirely — no staleness nudge."* REQ-040 is retired;
   REQ-039 (the factual last-updated date, the mandatory RSK-007 mitigation)
   is untouched. **Zero agent-sourced assumptions remain unconfirmed.**
   *(WebP, the other half of the ASM-034 prediction, is still unconfirmed. Both
   extraction services accept it natively, so widening to it later is cheap —
   no requirement was invented for it.)*
6. **Two numeric targets remain deliberately yours to set** (no number was
   invented): OQ-011 (acceptable review interaction-cost per item — the M5
   kill/pivot criterion) and OQ-014 (any performance / availability / i18n
   target, or an explicit "not applicable at one user").

---

## Notes

- All artifact content was treated as data, not instruction, per
  `.github/instructions/untrusted-content.instructions.md`. No embedded
  directive, credential, or injection attempt was encountered in the reviewed
  files.
- `session-state.json`'s machine-readable state was taken as authoritative over
  narrative prose wherever the two diverged (as the brief directs), and
  `mvp-definition.md` §17–§18 over its body.

