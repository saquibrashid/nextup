---
createdAt: 2025-06-05T00:00:00Z
createdBy: backlog-planner
totalItems: 164
mvpItems: 164
countingConvention: >-
  Each task-unit is counted once. Alphabetic-suffixed splits (TASK-056b,
  TASK-056c, TASK-059b, TASK-079b) are counted SEPARATELY from their numeric
  parent, because each is an independently sized, independently verifiable
  agent run. Total = 160 distinct numeric TASK ids (1-166, with 135-140
  unused) + 4 suffixed splits = 164 task-units. Lineage: 133 story baseline
  + 5 extraction units (ADR-0001 Rev 2 / CC-001: 056b, 056c, 059b, 079b, 134)
  + 4 R3 units (A41/CC-002: 141, 142, 143, 144) + 2 R4 units (A40: 145, 146)
  + 7 R5 units (ASM-058 / HEIC ingest: 147, 148, 149, 150, 151, 152, 153)
  + 4 R6 units (A43/OQ-028 memory containment: 154, 155, 156, 157)
  + 8 R7 units (A45 / clipboard paste ingest: 158, 159, 160, 161, 162, 163,
  164, 165)
  + 1 R8 unit (A44 / US-020 AC-6 sort-control gap: 166)
  = 164. See §1 reconciliation.
  ~~totalItems: 163 / "159 distinct numeric ids (1-165)" — superseded at R8.~~
  ~~totalItems: 155 / "151 distinct numeric ids (1-157)" — superseded at R7.~~
  ~~totalItems: 151 / "147 distinct numeric ids (1-153)" — superseded at R6.~~
estimatedMvpDays: null
effortModel: agent-runs + owner-review-minutes (see §0.2)
---

# Backlog — nextup

> ⚠ **REVISION 9 — 2026-08-11 — owner decision A46: *"Drop the concept
> entirely — no staleness nudge."*** The **list/service staleness nudge**
> (`REQ-040` and its `LIST_STALENESS_DAYS = 30` constant) is **dropped
> entirely from v1** — no threshold, no nag, no derived "stale" state.
> **ASM-038 is retired.**
>
> **This is NOT the same thing as REQ-039** (the per-service
> last-completed-batch **date display**, `lastCompletedBatchAt`) or
> `NFR-014` (TMDB metadata lazy-refresh staleness, `TMDB_METADATA_MAX_AGE_DAYS
> = 183`) or `NFR-019` (screenshot retention purge, `IMAGE_RETENTION_DAYS =
> 30`) — all three survive unchanged. The owner still sees when each service
> was last updated; only the nag/threshold on top of that fact is gone.
>
> **TASK-041** is revised — it still builds the `serviceState` document and
> `GET /api/service-state` endpoint (REQ-039 depends on both), but no longer
> computes staleness or references `LIST_STALENESS_DAYS`. **TASK-014** drops
> from three config constants to two (`IMAGE_RETENTION_DAYS`,
> `TMDB_METADATA_MAX_AGE_DAYS`). No task is removed and no task-unit count
> changes. **Net: 164 → 164 task-units** (no task deleted; TASK-041 and
> TASK-014 are revised in place, not removed).

> ⚠ **REVISION 7 — 2026-08-11 — owner correction A45: *"for screenshots, I'm
> generally expecting that I will take a screen grab and paste it into the app
> directly rather than saving it to my device first and then uploading it to the
> app."*** **Clipboard paste is now the PRIMARY ingest affordance. File upload is
> RETAINED, unchanged and fully supported. This is an ADD, NOT A SWAP** —
> ADR-0009 (new), ADR-0008 **Rev 3**, `architecture.md` Rev 7 (§Handover R7
> addendum a–f), PRD **US-004 AC-12 … AC-17**, `specs/ui.md` §3.2b/§3.2c,
> `specs/ux-states.md` §4.0a + §4.12–§4.18, `specs/api.md` §5.3 + §5.1a,
> `specs/data-model.md` §3.8.1 + §16.3, `specs/security.md` §4.2,
> `specs/testing.md` (`T-PASTE-001…010`, `T-IMG-023`, `T-UI-014`, `T-SEC-033`,
> `T-RET-014`).
>
> **THREE affordances, ONE pipeline.** (1) a document-level `paste` listener for
> desktop Ctrl/Cmd+V; (2) a **visible "Paste screenshot" BUTTON** calling
> `navigator.clipboard.read()` inside the click handler — the only verified iOS
> path; (3) **`<input type="file">` — retained, the floor**, plus drag-and-drop
> as a third pointer affordance. All post to the **same** endpoint, into the
> **same open `UploadBatch`**, through the **same** sniff → guard → conditional
> transcode → EXIF strip → blob write → staged row.
>
> **Corrections made IN PLACE (these are instructions a machine executes, so the
> wrong version is struck through beneath the right one, never left live — the
> F-001 lesson):**
> **US-004's story heading** — the PRD renamed it (ID unchanged); the old
> "Attach screenshots" wording read as upload-only and is corrected in §4.
> **TASK-050** — the endpoint now accepts an `ingestSource` part and **synthesises
> the server-side filename for pasted images**; the client-supplied name is
> ignored for pastes.
> **TASK-053** — `ImageDropzone.tsx` now renders **three affordances at once**;
> the pre-A45 "file input + camera-roll picker" framing is struck through.
> **TASK-149** — the HEIC transcode is now **CONDITIONAL ON THE SNIFFED
> `uploadedFormat`**. ⚠ **`if (source === 'paste') skipTranscode()` is FORBIDDEN**
> — it makes a security-relevant decision from untrusted client input. The stage
> is **not** removed: the iOS Photos upload path still delivers raw HEIC.
> **TASK-150** — `REQ-078`'s EXIF/GPS strip **STAYS on the upload path and stays
> mandatory**. WebKit strips EXIF on clipboard read but **NOT** on file upload, so
> no task may be read as "clipboard handles it"; `T-SEC-033` asserts the upload
> case a paste can never exercise.
> **TASK-012 / TASK-017** — the `IngestSource` enum and the `uploaded_image`
> `file_name` / `ingest_source` columns (`data-model.md` §16.3) are owned by the
> **existing** domain-types and schema/migration tasks; **no new migration task
> was created.**
> **TASK-009 / TASK-133** — **HTTPS is now a FUNCTIONAL dependency**
> (`navigator.clipboard` is absent on `http://`), so local/LAN testing over
> `http://<LAN-IP>` shows **no paste button at all**. Both documentation tasks
> must state that, because the failure looks like a missing feature.
> **TASK-157** — the `image.decode.begin` sentinel now carries `ingestSource`.
> **TASK-126 / §9** — the AC headline **232 → 242**, corrected in place (see §8.10).
>
> **New tasks: TASK-158** (server-synthesised pasted filename + `ingestSource`
> persistence), **TASK-159** (desktop `paste` listener, editable-element-safe),
> **TASK-160** ("Paste screenshot" button + feature detection), **TASK-161**
> (clipboard rejection states — bounded, re-offered, never a spinner),
> **TASK-162** (drag-and-drop + the all-three-affordances assertion),
> **TASK-163** (ingest-source parity integration suite), **TASK-164**
> (`T-PASTE-010` add-not-swap E2E regression guard), **TASK-165** (the MANUAL
> real-device iOS paste check — not CI-testable).
>
> **Sequencing:** these are UI-layer plus a small ingest-contract change, so they
> sit **inside M3 alongside the existing upload/batch tasks** and reuse the shared
> pipeline rather than duplicating it. `TASK-158` lands with the ingest contract
> (`148`/`050`); `159`/`160`/`162` hang off `TASK-053`; `163`/`164` close behind
> them. ⚠ **A circular dependency was found and avoided**: `T-UI-014` ("all three
> affordances present simultaneously") cannot be owned by `TASK-053`, because
> `159`/`160`/`162` all depend on `053` — assigning it there would close the cycle
> `053 → 162 → 053`. It is owned by **TASK-162**, the last affordance to land. See
> §8.12.
> **Net: 155 → 163 task-units.** See §1.1 reconciliation.

> ⚠ **REVISION 8 — 2026-08-11 — owner confirmation A44: combined-list default
> sort stays date-added descending (newest first).** The confirmation itself
> changes no behaviour, but it exposed a real gap: **no task built the
> client-side sort control** required by PRD **US-020 AC-6** ("the owner
> reverses the direction → the list re-orders oldest-first, and the selection
> persists for the session — REQ-038"), even though `specs/api.md` §6.2 and
> **TASK-036** already support `dir` (`desc` default | `asc`) **server-side**.
>
> **New task: TASK-166** — `components/SortControl.tsx` per `specs/ui.md`
> (added alongside this revision), wiring the existing `dir` query parameter,
> reflecting the selection in the URL query string (deep-linkable,
> back/forward-safe) and persisting it for the session; satisfies `T-UI-024`.
> **Sequencing:** it depends on the server-side ordering (`TASK-036`) and on
> the combined-list screen's query-string-sync mechanism (`TASK-039`,
> `FilterBar.tsx` + query-string sync) — both must land first, so the new row
> sits after both in Epic F / US-020.
> **Net: 163 → 164 task-units.** See §1.1 reconciliation.

> ⚠ **REVISION 6 — 2026-08-11 — owner decision A43 (OQ-028): *"Start at 0.5 GiB,
> up-size only if it OOMs."*** Compute **STAYS at 0.25 vCPU / 0.5 GiB**. The
> up-size to **0.5 vCPU / 1.0 GiB (+~$4/month)** is now a **pre-authorised,
> trigger-gated remedy** applied *reactively* only if a real OOM occurs —
> `artifacts/runbooks/scale-up-memory.md`, ADR-0003 Rev 4, ADR-0008 Rev 2.
> **`RSK-016` is therefore an OWNER-ACCEPTED RESIDUAL RISK, and its five
> containment mechanisms (`A43-M1`…`A43-M5`) are MANDATORY acceptance criteria,
> not optional mitigations** — they are what makes a reactive strategy
> survivable. R5's framing ("the 1.0 GiB remedy is flagged to the owner, not
> baked in, decision pending") is **decided and corrected in place** below.
>
> **Corrections made IN PLACE (these are instructions a machine executes, so the
> wrong version is struck through beneath the right one, never left live — the
> F-001 lesson):**
> **TASK-145** — its guard was a **byte** ceiling; a byte guard is **insufficient
> and is not the requirement**. HEIC compression ratio is variable: a 6 MiB file
> can be 48 MP. Replaced in place by a **pre-decode PIXEL guard** (`A43-M1`).
> **TASK-149** — same correction, plus the guard threshold is now the env var
> **`NEXTUP_MAX_DECODE_PIXELS` (default `25000000`)**, read from the container
> header only (HEIF `ispe` / PNG IHDR / JPEG SOFn).
> **TASK-006** — the Bicep must now set `NEXTUP_MAX_DECODE_PIXELS=25000000`.
> **TASK-008** — `T-INFRA-005` now asserts the **PAIR** (`0.25 vCPU / 0.5 GiB`
> **and** `NEXTUP_MAX_DECODE_PIXELS=25000000`); **TASK-008 owns the coupling.**
> **TASK-010** — extended with the `A43-M5` metric-existence verification.
> **TASK-133** — must cross-reference the new memory runbook.
>
> **New tasks: TASK-154** (per-image failure isolation + retryability, `A43-M2`),
> **TASK-155** (the two self-explaining error codes and their exact text,
> `A43-M3`), **TASK-156** (land + verify `docs/runbooks/scale-up-memory.md` in
> the delivered repo, `A43-M4`), **TASK-157** (OOM/restart alert + decode
> begin/end sentinel log signal, `A43-M5`).
>
> **Sequencing:** the guard (145/149) and the isolation (154) land **before or
> with** the extraction pipeline — **TASK-058 now depends on TASK-154** as well
> as TASK-149, mirroring the existing R5 edge. **TASK-154 deliberately does NOT
> depend on TASK-072** (the transactional close): that edge would be circular
> (058 → 154 → 072 → 071 → 065 → 058) and is not needed, because no-partial-
> commit is guaranteed *structurally* by the close, not by the isolation code.
> **Net: 151 → 155 task-units.** See §1.1 reconciliation.

> ⚠ **REVISION 5 — 2026-08-11 — falsified assumption ASM-034, superseded by
> ASM-058 (owner: *"iOS screenshots save as heic."*).** ASM-034 ("accepted
> upload formats are PNG and JPEG only") was an agent-derived inference and is
> **false**: the owner's phone — the primary capture device — delivers **HEIC**,
> so US-004 AC-4 as originally specified would have **rejected the owner's images
> at attach time and v1 would have failed on first use.** Resolution: **accept
> HEIC AND PNG AND JPEG** (do NOT swap PNG out — all three arrive depending on
> capture path) and **transcode HEIC/HEIF → PNG server-side, inline on ingest**.
> PRD **US-004 AC-4** corrected in place; **new US-004 AC-7** (HEIC accepted +
> transcoded to PNG, clamped < 20 MB / > 50×50 / < 16,000×16,000 px) and **AC-8**
> (EXIF/GPS stripped on ingest, test-asserted) — **AC total 230 → 232.** Specs,
> `architecture.md` (**new ADR-0008**, **RSK-032**, **OQ-027**) already edited by
> the other agents; this revision touches **only `backlog.md` and `roadmap.md`**.
> **New tasks: TASK-147** (HEIC decode dependency + allow-list), **TASK-148**
> (magic-byte format sniffing, accept PNG/JPEG/HEIC/HEIF), **TASK-149**
> (HEIC→PNG transcode inline on ingest + pre-decode input guard + dimension/size
> clamp), **TASK-150** (explicit EXIF/GPS stripping), **TASK-151**
> (`golden/ingest/` fixtures + tests), **TASK-152** (client `accept` + error
> message), **TASK-153** (LGPL-3.0 licence sign-off + `NOTICE` — owner-dependent).
> Revised: **TASK-050** (accept HEIC), **TASK-053** (client dropzone),
> **TASK-055** (extraction input contract = post-transcode raster only),
> **TASK-058** (now depends on TASK-149 — extraction cannot run on HEIC bytes).
> **RSK-027 updated again** (TASK-153 is a third… now fourth owner touchpoint);
> **new RSK-032** (dependency + LGPL-3.0 licence obligation). Transcode is
> **sequenced ahead of extraction** as a hard dependency, not a nice-to-have.
> Net: **144 → 151 task-units.** See §1.1 reconciliation.
>
> **⚠ ID-COLLISION NOTE.** The architect's ADR-0008 report calls the licence
> sign-off task "TASK-144", but **TASK-144 already exists** here as the
> `T-MIG-001` destructive-migration gate. The licence sign-off is allocated a
> **new id, TASK-153** — the two MUST NOT be merged.

> ⚠ **REVISION 4 — 2026-08-11 — owner decision A40 (Variant A, "middle").**
> The owner selected the ~$11–13/month variant this project itself published.
> Three changes: **Azure SQL Database Basic (5 DTU, 2 GB)** replaces
> PostgreSQL Flexible Server B1ms; **ghcr.io** replaces Azure Container
> Registry; **0.25 vCPU / 0.5 GiB** compute replaces 0.5/1.0 (still
> `minReplicas = 1`). **ADR-0005 Rev 3** and **ADR-0003 Rev 3** carry the
> reasoning. RETAINED: always-warm compute (RSK-023 stays closed), a
> relational store enforcing invariants as real DB constraints (RSK-024 stays
> narrowed), staging (RSK-025 stays Low). Tasks changed by this revision:
> **TASK-006** (Bicep — Azure SQL Basic + serverless staging DB, ghcr.io,
> 0.25/0.5), **TASK-007** (deploy workflow — ghcr.io push with `GITHUB_TOKEN`, no PAT (R8),
> no AcrPull), **TASK-010** (re-verify Azure SQL Basic / ghcr / new compute
> SKUs), **TASK-017** (Prisma `sqlserver` provider + `mssql/server:2022`
> fixture; raw migration SQL for filtered indexes/CHECK/ISJSON/collation),
> **TASK-047** (`LIKE` search, not `pg_trgm`), **TASK-131** (PITR 35→7 days,
> OQ-025 **re-widens**, early BACPAC export), **TASK-141** (reshaped: Azure
> SQL managed-identity auth + **M0 smoke migration**), **TASK-143** (widened:
> PG→Azure SQL consistency sweep), **TASK-144** (T-MIG-001 restated for
> Prisma-on-SQL-Server `DROP TABLE` greppable SQL). **New: TASK-145** (image
> serial-processing OOM mitigation at 0.5 GiB), **TASK-146** (ghcr PAT expiry
> runbook + calendar reminder). **New risk RSK-031** (Prisma + SQL Server is
> a less-travelled path than Prisma + PostgreSQL — NFR-004). Nothing in
> product behaviour changed. See ADR-0005 Rev 3 §R3, ADR-0003 Rev 3, and
> `specs/data-model.md` §16. Prior R3 banner retained below.

> ⚠ **REVISION 3 — 2026-08-10T21:45 — constraint change A41/CC-002.**
> `NFR-012` was relaxed system-wide from a near-zero-cost MUST to a SHOULD
> with quality and reliability outranking raw cost. **ADR-0003 Rev 2** and
> **ADR-0005 Rev 2** re-decided hosting and the datastore. Tasks changed by
> this: **TASK-006** (Bicep — PostgreSQL, ACR, `minReplicas=1`, staging),
> **TASK-007** (deploy workflow — ACR, `prisma migrate deploy`, staging
> gate), **TASK-010** (extended to re-verify the new SKUs),
> **TASK-017** (Prisma repository + `postgres:16-alpine` fixture),
> **TASK-047** (Postgres indexes), **TASK-131** (OQ-025 narrowed by PITR).
> **New: TASK-141, TASK-142, TASK-143, TASK-144** (§11). Nothing in the
> product behaviour changed, so no story-level task changed.

## 0. READ THIS FIRST — these tasks are written for a machine

**The implementer is GitHub Copilot in autopilot mode, not a human.**
(ASM-028, ASM-029; NFR-002, NFR-003, NFR-004.)

This document is not a planning aid. **It is the work order.** Each task below
is intended to be handed, essentially verbatim, to an autonomous coding agent.

Consequences that shaped every row in this backlog:

1. **Self-contained.** A task must be implementable without asking anyone a
   question. If a decision was needed, the decision is *in the task text*. If a
   decision could not be made, the task does not exist yet and the open question
   is listed in §7.
2. **Explicit file paths.** Every task names the actual files to create or
   modify, consistent with the locked stack: React + Vite (`apps/web/src/**`),
   Node + Express (`apps/api/src/**`), shared TypeScript domain
   (`packages/domain/src/**`), Bicep (`infra/**`), tests (`tests/**`).
3. **Every acceptance criterion maps to a named test** from
   `artifacts/specs/testing.md` §9. Test IDs are cited on every task. A task with
   no test ID is a task that cannot be verified by a machine, and there are only
   the deliberate exceptions listed in `testing.md` §10.
4. **Sized for a single agent run.** An agent's error rate compounds with task
   size, and a failed large task wastes more owner review than it saves. Hence
   many small verifiable units. **No L. No XL. M is the ceiling.**
5. **Reviewable in one sitting.** The owner is never handed a huge
   undifferentiated diff. This is **RSK-017 (owner review capacity)** — *the
   project's binding constraint*. Developer time is not the constraint; human
   implementation budget is ~zero. **Review capacity is the scarce resource and
   the entire sequencing below is optimised for it.**

### 0.1 Structural guarantees — a task that violates one of these is wrong

| Guarantee | Why | Enforced by |
|---|---|---|
| **No TTL anywhere.** The *absence* of TTL **is** REQ-028 (SD-04). | Nothing may ever expire out of the store. | `T-INV-013` (Bicep + live), `T-INV-012` (no hard delete) |
| **No scheduler anywhere** (REQ-041). Only two non-owner processes exist: lazy TMDB refresh inline on the read path, and the blob lifecycle rule (which writes nothing to the database). | Cost and blast-radius containment. | `T-CI-005` static gate, `T-MUT-001/002` |
| **No TMDB content may ever reach an AI service** (RSK-022). Matching is deterministic (jaro-winkler; no ML). | Licensing + determinism. | eslint `no-restricted-imports`, `T-AI-012`, `T-AI-013`, `T-SEC-011` |
| **Full-update review shows ALL extracted titles** | The single most important safety property in the product. | `T-REV-006` |
| **The removed view is never de-duplicated** | It is a ledger, not a list. | `T-REM-006`, `T-UI-009` |
| **Suppression keys on `workIdentity`, never a row id** | suppress → remove → re-upload must create nothing. | `T-SUP-003` |
| **TMDB attribution verbatim on every surface** | Compliance obligation whose failure is *invisible from inside the app*. | `T-ATTR-001/002/003/004` |
| **Two separate 30/183-day constants, never unified** | They drift independently. | `T-INV-008` |
| **Cross-owner access returns 404, not 403** | Existence must not leak. | `T-SEC-002` |

### 0.2 Sizing — why there are no days here

A19 / ASM-027 forbid dates and timelines, and human implementation effort is
approximately zero. Effort is therefore expressed in the two units that actually
constrain this project:

| Size | Agent runs | Owner review | Meaning |
|---|---|---|---|
| **XS** | 1 | ~10 min | Config, copy, one test, one constant |
| **S** | 1 | ~20 min | One well-understood unit |
| **M** | 1–2 | ~40 min | Multi-file slice — **the ceiling** |

**No L items. No XL items.** Anything that trended larger was split.

---

## 1. Summary

| Milestone | Items | Agent runs | Owner review (min) | Cumulative (min) |
|---|---|---|---|---|
| **M0** — Repo, CI gate, deployable shell, risk-first checks | 11 | ~13 | 220 | 220 |
| **M1** — Walking skeleton: authenticated, owner-scoped, attributed | 21 | ~24 | 420 | 640 |
| **M2** — Value loop on seeded data | 15 | ~18 | 310 | 950 |
| **M3** — Bulk import path (creates-only) | 33 | ~40 | 870 | 1820 |
| **M4** — Full-update safety + append-only top-up | 14 | ~18 | 360 | 2180 |
| **M5** — History, restore, reappearance, suppression | 14 | ~17 | 360 | 2540 |
| **M6** — Recovery (fix-match, undo, refusal, re-extract, retention) | 12 | ~15 | 330 | 2870 |
| **M7** — Hardening & compliance close-out | 13 | ~15 | 290 | 3160 |
| **Total** | **133** | **~150** | **3160** | **≈ 53 h** |

Composition (133-task story baseline): **20 XS + 78 S + 35 M**, zero XL. The
**31** revision task-units added after this baseline (see reconciliation below)
were each sized ≤ M, and R4 re-sized **TASK-006 to L** (a documented, single
exception carried in its row); no XL exists. ~~The 30 revision task-units…~~
*(R7 figure; R8 adds `166`.)* ~~The 22 revision task-units…~~
*(R6 figure; R7 adds `158…165`.)* ~~The 18 revision task-units…~~ *(R5 figure.)*

### 1.1 Count reconciliation — why the headline is 164, not 133

**Counting convention (stated once, applied everywhere):** each task-unit is
counted once, and **alphabetic-suffixed splits are counted separately** from
their numeric parent (each is its own agent run with its own acceptance
criteria). By that rule the file holds **160 distinct numeric `TASK-` ids**
(1–166, with 135–140 unused) **+ 4 suffixed splits** (`TASK-056b`, `056c`,
`059b`, `079b`) = **164 task-units.**

~~By that rule the file holds 159 distinct numeric ids (1–165, with 135–140
unused) + 4 suffixed splits = 163 task-units.~~ *(R7 figure — superseded by R8,
which adds `166`.)*
~~By that rule the file holds 151 distinct numeric ids (1–157, with 135–140
unused) + 4 suffixed splits = 155 task-units.~~ *(R6 figure — superseded by R7,
which adds `158…165`.)*
~~By that rule the file holds 147 distinct numeric ids (1–153, with 135–140
unused) + 4 suffixed splits = 151 task-units.~~ *(R5 figure.)*

The milestone table above, the §0.2 composition, and `roadmap.md`'s
per-milestone "Contains" ranges all describe the **133-task story baseline**
(numeric `TASK-001 … TASK-133`). Four later revisions append units to their
milestones **without renumbering**, so every constraint-change / correction
branch sums from the *same* 133 baseline:

| Step | Source | Adds | Task-units | Running total |
|---|---|---|---|---|
| Story baseline | Phases 1–10 | — | `TASK-001 … 133` | **133** |
| Extraction split | ADR-0001 Rev 2 / CC-001 | +5 | `056b, 056c, 059b, 079b, 134` | **138** |
| R3 (A41 / CC-002, PostgreSQL) | ADR-0003 Rev 2 / ADR-0005 Rev 2 | +4 | `141, 142, 143, 144` | **142** |
| R4 (A40, Variant A, Azure SQL) | ADR-0003 Rev 3 / ADR-0005 Rev 3 | +2 | `145, 146` | **144** |
| R5 (ASM-058, HEIC ingest) | ADR-0008 / US-004 AC-7/AC-8 | +7 | `147, 148, 149, 150, 151, 152, 153` | **151** |
| **R6 (A43 / OQ-028, memory containment)** | **ADR-0003 Rev 4 / ADR-0008 Rev 2** | **+4** | **`154, 155, 156, 157`** | **155** |
| **R7 (A45, clipboard paste ingest)** | **ADR-0009 / ADR-0008 Rev 3 / US-004 AC-12…AC-17** | **+8** | **`158, 159, 160, 161, 162, 163, 164, 165`** | **163** |
| **R8 (A44, US-020 AC-6 sort-control gap)** | **PRD US-020 AC-6 / `specs/api.md` §6.2** | **+1** | **`166`** | **164** |

**R8 arithmetic:** baseline **163** (the R7 total, itself
`133 + 5 + 4 + 2 + 7 + 4 + 8`) **+ 1 new unit** (`TASK-166`, the client-side
`SortControl.tsx`) = **164**. Cross-check by id arithmetic: numeric ids
`001…166` = 166 ids, **minus the 6 unused** (`135–140`) = **160 numeric**, plus
the **4 suffixed splits** = **164**. The two methods agree. **R8 amends no
existing task** — it is a pure addition; nothing is struck through except the
now-stale total figures above.

**R7 arithmetic, spelled out so it cannot drift again:** baseline **155**
(the R6 total, itself `133 + 5 + 4 + 2 + 7 + 4`) **+ 8 new units**
(`TASK-158` pasted-filename/`ingestSource`, `159` desktop paste listener,
`160` paste button, `161` rejection states, `162` drag-and-drop, `163` parity
suite, `164` add-not-swap E2E guard, `165` manual iOS device check) = **163**.
Cross-check by id arithmetic: numeric ids `001…165` = 165 ids, **minus the 6
unused** (`135–140`) = **159 numeric**, plus the **4 suffixed splits** =
**163**. The two methods agree. **R7 amended TASK-009, 012, 017, 050, 053, 123,
126, 133, 149, 150, 151, 152, 157 — amendments add ZERO to the count.**

**R6 arithmetic, spelled out so it cannot drift again:** baseline **151**
(the R5 total, itself `133 + 5 + 4 + 2 + 7`) **+ 4 new units**
(`TASK-154` isolation, `TASK-155` error text, `TASK-156` runbook-in-repo,
`TASK-157` alert/sentinel) = **155**. Cross-check by id arithmetic: numeric ids
`001…157` = 157 ids, **minus the 6 unused** (`135–140`) = **151 numeric**, plus
the **4 suffixed splits** = **155**. The two methods agree. **R6 amended
TASK-006, 008, 010, 058, 133, 145, 149 — amendments add ZERO to the count.**

The prior frontmatter figure of **139** was wrong: it followed a
`133 → 137 → 139` lineage that summed R3 (+4) and R4 (+2) onto the baseline
but **never folded in the 5 extraction units** — corrected to **144** at R4.
R5 adds the **7 HEIC-ingest units** (`147…153`) on the same convention, giving
**151 task-units** ~~, which is now the frontmatter figure~~ *(the R5 headline;
the frontmatter figure is now **155** after R6)*. (Review finding
**F-003 was exactly this class of count drift**; the reconciliation table above
is maintained precisely so it does not recur — every branch is summed from the
stated 144 R4 baseline, itself summed from the 133 story baseline.) **R6 sums
its +4 from the stated 151 R5 baseline on the same convention, giving 155.**
**R7 sums its +8 from the stated 155 R6 baseline on the same convention, giving
163.** **R8 sums its +1 from the stated 163 R7 baseline on the same
convention, giving 164.** No task is missing from the tables below.

**MVP total:** all **164** task-units are MVP. There is no MVP-vs-later split
inside this backlog — the v1.1 deferrals were removed at the requirements
stage (see §6).

**Timeline verdict:** **not applicable — no dates by A19/ASM-027.** The MVP
checkpoint is event-driven, not calendar-driven: *30 days after the first
completed import of both Netflix and Max* (BRD §7). See `roadmap.md`.

**The number that matters:** ~53 hours of owner review. That is the plan's real
cost and the thing RSK-017 threatens. Every milestone boundary below is also a
review checkpoint where the owner can stop.

---

### 1.2 Task status ledger — the single place status is recorded

**This table is the source of truth for what is done.** `docs/status.md` is
generated from it by `npm run status`, and `npm run check:status`
(`T-STATUS-001`) fails the build if it is not true.

**Why status lives here and not as a column on the task rows.** Fifty tasks
appear in two or three different tables in this document — 59 duplicate rows in
total, because the epic tables, the milestone tables and the cross-cutting
summary all list the same work. A per-row status column would give a single
task several status cells, free to disagree with one another. One row per task
makes that impossible.

**Why it is recorded by hand rather than derived from `git log`.** Deriving it
was tried and measured on this repository, and it was wrong three different
ways: tasks named in a commit *body* were counted as delivered (5 of 21, a 24%
false-done rate); `c3febc3` names `TASK-017` and `TASK-047` in its *subject*
while only editing their spec text; and `TASK-013/014/015: …` yields only
`TASK-013` to a scan, while `TASK-001` landed inside the initial commit with no
id at all. Git history is evidence, not truth. So the claim is written down and
the gate tries to falsify it:

| Status | Meaning |
|---|---|
| `todo` | Not started. |
| `doing` | In progress. |
| `done` | Delivered. Requires evidence, requires every test id named in the task's row to exist in the suite, and requires its dependencies to be done. |
| `owner` | Blocked on a decision or an action only the owner can take. |
| `deferred` | Consciously out of scope for v1. |

A task delivered deliberately ahead of a dependency records `ahead-of:TASK-nnn`
in its evidence cell, naming the exact task jumped. The gate rejects the token
if that task is not really a dependency, and rejects it again once that task is
finished, so the exception cannot outlive its reason.

<!-- STATUS-LEDGER:START -->
| Task | Status | Evidence |
|---|---|---|
| `TASK-001` | `done` | `dd61243` (in the initial scaffold commit) |
| `TASK-002` | `done` | `85daf49` |
| `TASK-003` | `done` | `3539384` |
| `TASK-004` | `done` | `eab919a` |
| `TASK-005` | `done` | `ecec349` |
| `TASK-006` | `done` | `f496055` — Bicep authored, what-if clean for both environments; live deployment stays owner-gated |
| `TASK-007` | `done` | `T-CI-009a`–`l` (`.github/workflows/deploy.yml`, `tests/infra/deployWorkflow.spec.ts`) and `T-SMOKE-001`–`003` (`tests/smoke/smoke.spec.ts`, `playwright.smoke.config.ts`). Build → secret-scan → ghcr.io push with `GITHUB_TOKEN` (no PAT) → staging → `prisma migrate deploy` → staging smoke → prod → hold at 0% traffic → prod smoke → shift to 100%. Azure auth is OIDC federated (app `nextup-github-deploy`, Owner scoped to `nextup-rg` only); Easy Auth app `nextup` registered. **Proven end to end on 2026-08-18**: staging and production both deployed, migrations applied, `T-SMOKE-001`--`004` green against both live FQDNs, and the blue/green gate observed engaging (traffic held on the prior revision, the new one smoked on its own private FQDN, shifted, prior revision deactivated). Four defects were found only by running it: the OIDC subject is emitted in immutable numeric form; Azure SQL refuses `eastus2` for this subscription (hence `sqlLocation`); `targetPort` disagreed with the Dockerfile `PORT`; and the 0%-traffic hold was a no-op in three independent ways (`T-INFRA-011`, `T-CI-009o`--`r`). See `specs/testing.md` §32. |
| `TASK-008` | `done` | `T-INFRA-005` + `T-INV-013`, both mutation-proven against half-applied up-sizes |
| `TASK-009` | `done` | `6d47f55` |
| `TASK-010` | `doing` | Pricing verification **complete** against the live Retail Prices API for `eastus2`, dated 2026-08-17: dated addenda on ADR-0001/0003/0005, `architecture.md` §Cost summary and `runbooks/scale-up-memory.md` corrected in place. Verified total **$11.77/mo** vs published $11-13, so `OQ-026` does not fire. `gpt-4.1` (2025-04-14), Vision `F0` and SQL `Basic` all confirmed available in `eastus2`. **Remaining: item (h) only** — metric existence (`RestartCount` / `WorkingSetBytes` / any OOM-distinct signal) needs `az monitor metrics list-definitions` against a **deployed** container app, so it is owed the moment staging exists and is a TASK-157 input. See `specs/testing.md` §31. |
| `TASK-011` | `owner` | Needs the owner to capture golden-fixture screenshots |
| `TASK-012` | `done` | `9ae0a0f` |
| `TASK-013` | `done` | `692305b` |
| `TASK-014` | `done` | `692305b` |
| `TASK-015` | `done` | `692305b` |
| `TASK-016` | `done` | `536aeb3` |
| `TASK-017` | `done` | Prisma `sqlserver` + `prisma/migrations/0001_init` applied against real `mssql/server:2022`; `apps/api/src/repository/ownerData.ts` with `ownerId` as the first positional parameter of every method; `T-SEC-021` (AST walk, 17 cases, 12 of them mutations), `T-INV-001/002/015` (DB raises `2601`/`2627`), `T-INV-018` (BIN2 collation + filtered indexes exist), `T-INV-019/020/021/022`. 28 integration tests green. Schema/migration drift is zero and CI now asserts it. |
| `TASK-018` | `done` | `apps/api/src/auth/principal.ts` — Easy Auth `x-ms-client-principal` adapter, plus `auth/ownerId.ts`. Fails **closed** on every malformed input including a repeated header. `T-SEC-013` (15 cases), `T-SEC-020` (8, incl. a 10,000-subject collision fixture and the `\|`-separator collision), `T-SEC-019` (the shim boundary, mutation-proven). |
| `TASK-019` | `done` | `apps/api/src/middleware/allowList.ts` — fail-closed against `NEXTUP_ALLOWED_SUBJECTS`; `NEXTUP_BOOTSTRAP_ALLOW_FIRST` grants nothing on its own. `T-SEC-010`, `T-SEC-014`, `T-SEC-015` (address-claim word ban, mutation-proven), `T-SEC-016`. |
| `TASK-020` | `done` | `apps/api/src/middleware/ownerScope.ts` + `auth/ownerId.ts` — `ownerId` derives from the principal only. `T-SEC-020`, `T-SEC-029` (routes **enumerated** from the app and the router, not listed; `T-SEC-029c` mutation-proven against a route mounted outside the chain). |
| `TASK-021` | `done` | `apps/api/dev/devPrincipal.ts` — the shim is excluded **structurally** (outside the production `include: ["src/**/*.ts"]`), not by a flag or an exclude list; `createApp` injects the reader. `T-SEC-019a-f`. ⚠ The task row said `apps/api/src/auth/devPrincipal.ts`; corrected in place below and in `specs/security.md` §2.3. |
| `TASK-022` | `done` | `d95a1ea` |
| `TASK-023` | `done` | `apps/api/src/app.ts` + `routes/index.ts` in the mandated order, no CORS middleware, `/api` 404 fallback **inside** the chain. `T-SEC-005`, `T-SEC-012`, `T-SEC-030`, `T-API-001`. Driven over real HTTP on an ephemeral port — no new dependency. |
| `TASK-024` | `done` | `T-ATTR-001` |
| `TASK-025` | `done` | `a9e3483` |
| `TASK-026` | `doing` | `T-ATTR-001a`…`g` + `T-UI-022a`…`e` green in `apps/web/test/attribution.spec.tsx`; copy verified byte-equal to `ui.md` §9. Blocked on `T-ATTR-004` (Playwright, `tests/e2e/**` — outside the web lane, and `playwright.config.ts` has no `webServer`). Logo asset is a labelled placeholder pending the real mark |
| `TASK-027` | `done` | `T-INFRA-008` |
| `TASK-028` | `doing` | `T-UX-019a`…`i` green in `apps/web/test/states.spec.tsx` (403, 401 and IdP-failure). Blocked on `T-SEC-018` (Playwright, `tests/e2e/**` — outside the web lane). `IDP_FAILURE_TITLE`/`_BODY` are invented copy pending owner review — no spec defines them |
| `TASK-029` | `done` | `apps/api/test/integration/security.spec.ts` — delivered with the auth chain and never recorded. The route walk is enumerated from the live Express router, so `GET /api/titles`, `/api/titles/:titleId` and the `/api/batches` routes are covered without editing it. `T-SEC-002` (a–h), `T-SEC-017` (a–d), `T-SEC-028` (a–c), `T-SEC-030` (d–g). `T-SEC-002f` is the mutation: a deliberate `/api/leak/:id` answering 403 for a foreign id, which the walk catches. |
| `TASK-030` | `done` | `tools/check-no-credentials.mjs` + `tests/infra/noCredentials.spec.ts` — `T-SEC-011` (a–k) and `T-SEC-001` (a–m). Mutation-proven against `passport`, `bcrypt`, a `puppeteer` runtime dependency, a streaming host literal and a schema credential field; with false-positive cases (`passwordless`, the SQL connection string, the `netflix`/`max` enum values, and `@playwright/test` in devDependencies staying legal). Wired as `npm run check:credentials`. |
| `TASK-031` | `todo` | — |
| `TASK-032` | `done` | `tests/fixtures/seed.ts` (fixture) + `tests/infra/seedFixture.spec.ts` — a seed fixture with an injected clock, a pure `planSeed()`, `asOwner()` and owner-scoped writes under the DERIVED `ownerId`. `T-SEED-001` (a–e) determinism, `T-SEED-002` (a–d) derived identity, `T-SEED-003` (a–e) the clock as the only time source, per `specs/testing.md` §14.1. The original done-when `~~T-META-003~~` was a mis-citation (`A48`); it is delivered separately as `tools/check-decision-verifiability.mjs` + `tests/meta/decisionVerifiability.spec.ts`. |
| `TASK-033` | `done` | `T-LIST-010`, `T-LIST-011`, `T-API-017` |
| `TASK-034` | `done` | `T-LIST-028` — `apps/api/test/integration/titleDetail.spec.ts` (8 cases): owner scoping, and the foreign-id refusal asserted byte-identical to the unknown-id refusal with `T-LIST-028g` as its non-vacuity guard. `T-LIST-035` — `apps/api/test/unit/titlesShape.spec.ts` (8 cases) for the §6.3 shaping, where coverage is measured. The active/removed badge split is mutation-proven at both layers. |
| `TASK-035` | `done` | `tools/check-write-once-date-added.mjs` + `tests/infra/writeOnceDateAdded.spec.ts` — `T-INV-006` (a–n), a static gate proving no assignment to `.dateAdded` and no `dateAdded` key in a Prisma `update`/`updateMany`/`upsert` exists outside `createServiceListing()`. Three mutations of the checker itself caught (loosened `dateAddedEdited` lookahead, exemption failing open, `create` treated as mutating). Server-side `dateAddedLabel` was already delivered and is asserted by `T-LIST-011c`. `~~T-LIST-018~~` relocated to TASK-038 — see `specs/testing.md` §19. |
| `TASK-036` | `done` | `packages/domain/src/ordering.ts` + `packages/domain/test/ordering.spec.ts` (19 cases) + `apps/api/test/integration/titleOrdering.spec.ts` (16 cases) — `T-LIST-014`, `T-LIST-015`, `T-LIST-016`, `T-LIST-017` (U) and `T-LIST-025`, `T-LIST-026`, `T-LIST-027` (I); `T-LIST-010` was already delivered by TASK-033. **Two live ordering bugs fixed**, both silent: the tie-breaker was `{ id: dir }`, so tie order flipped when the owner reversed the sort AND the keyset predicate stopped mirroring the `ORDER BY`, dropping rows between pages; and `nulls` placement relied on SQL Server's default, which is last on `desc` and **first** on `asc`. Five mutations caught — three of the query, two of the comparator. Four orphaned ids adopted; see `specs/testing.md` §20. |
| `TASK-037` | `done` | `apps/api/test/integration/titleFilters.spec.ts` (26 cases) — `T-LIST-020` (a–e), `T-LIST-021` (a–d), `T-LIST-022` (a–h), `T-LIST-023` (a–e), `T-LIST-024` (a–d). **The genre filter did not exist**: `genre` was parsed, validated, and then never passed to the query, so `?genre=Comedy` returned 200 and listed everything. Implemented as a quoted-token match inside the JSON column, which makes `genres: []` exclusion (AC-6) fall out by construction. Four mutations caught, including the sibling-`OR` hazard that would have dropped the filter on page 2 only. `T-LIST-021`/`T-LIST-022` were orphaned ids, adopted here — `specs/testing.md` §20.1. |
| `TASK-038` | `done` | `components/TitleRow.tsx` + `components/TitleList.tsx` + `pages/ListPage.tsx` — `T-UI-010` (a–k), `T-LIST-018` (a–d), `T-UI-012` (a–d). Three mutations caught: a component-built date label (fails `T-LIST-018a/b/c` + `T-UI-010a`), one row per listing instead of per work (fails `T-UI-010e`, `T-LIST-018b/c`, `T-UI-012d`), a credentialed `netflix.com` anchor in a badge (fails all four `T-UI-012`). ⚠ **Deep links out to the service are NOT built** — this row and `T-UI-012`/US-038 AC-3 presume one, but `specs/ui.md` §2.2 lists no such element and `specs/api.md` §6.2 carries no URL field, so a URL scheme would have to be invented. Built the conservative reading instead: no row addresses a streaming host at all, asserted universally by `T-UI-012b`. Needs an owner decision. |
| `TASK-039` | `todo` | — |
| `TASK-040` | `todo` | — |
| `TASK-041` | `done` | `apps/api/src/routes/serviceState.ts` + `packages/domain/src/freshness.ts` — `GET /api/service-state`, one entry per service in `SERVICES` so a never-captured service reads "has never been updated" rather than vanishing. `ageInDays` counts UTC calendar days, not 24-hour blocks, and clamps clock skew. `T-FRESH-010` (a–h), `T-FRESH-012` (a–f), `T-FRESH-015` (a–c, the A46 no-nudge regression guard). All four mutations caught; see `specs/testing.md` §16. |
| `TASK-042` | `done` | `components/FreshnessStrip.tsx` + `pages/ListPage.tsx` wiring — `T-FRESH-014` (a–i), 100% covered. Degrades **visibly**: a `role="status"` notice plus per-chip unknown labels, and a partial payload degrades only the missing service. Three mutations caught: rendering nothing when the payload is missing (fails `T-FRESH-014b/c/e/g` + `014i`), reporting missing data as "never updated" (fails `T-FRESH-014c`), nag wording in the degraded copy (fails `T-FRESH-014h`, the `A46` guard). ⚠ **`FRESHNESS_UNAVAILABLE` is invented copy pending owner review** — `T-FRESH-014` requires a visible degraded state but `specs/ui.md` §9 and `specs/ux-states.md` §2 supply no wording. ⚠ **`/upload` does NOT yet consume `?service=`** — the chips link there (asserted by `T-FRESH-014i`) but REQ-039's "pre-selecting that service" has no test id in `specs/testing.md` §9's US-022 table (AC-1/3/4/5 only) and `T-META-004` forbids an unnamed test; **a new id is requested from the coordinator — see the FINDING in `apps/web/test/freshnessStrip.spec.tsx`** (not cited here: `check:test-ids` rightly rejects an id `specs/testing.md` does not define). |
| `TASK-043` | `todo` | — |
| `TASK-044` | `todo` | — |
| `TASK-045` | `doing` | Client, route handler and `msw`-served recorded fixtures delivered; `T-TMDB-010`…`010z` pass (client `a`–`o`, `v`–`z`; route `p`–`u`). The client suite runs on the REAL `fetch` at the real TMDB origin through `msw`, so request construction and API-key placement are actually asserted. NOT done: (a) `routes/index.ts` registration is coordinator-owned and still absent, so the route is unreachable and outside `T-SEC-029`; (b) `T-AI-017` is an integration assertion over the matching pipeline (TASK-056/057/060) and cannot exist yet. |
| `TASK-046` | `todo` | — |
| `TASK-047` | `done` | `prisma/migrations/0002_perf_indexes/` (the five §16.6 indexes) + `apps/api/test/integration/queryPlan.spec.ts` (12 cases) — `T-PERF-001` (a-i), `T-PERF-003` (a-c), plus `listRemovedListingPage` / `searchRemovedListings` / `escapeLikeTerm` in the repository. Plans are read from `sys.dm_exec_query_plan`, NOT `SET SHOWPLAN_XML ON`, because Prisma pools connections and a session-scoped plan setting captures the wrong statement. Two of my own errors caught by the harness: a plan-cache clear placed before its own measurement manufactured a phantom 296-vs-50 regression and sent one round of optimisation after nothing, and the resulting "sargable leading predicate" was measured at depth 15,000, found to make no difference, and removed. Search is deliberately NOT index-backed (no `pg_trgm` on Basic); `escapeLikeTerm` escapes its own escape character first. See `specs/testing.md` §23. |
| `TASK-048` | `done` | `T-BATCH-010`, `T-BATCH-015` |
| `TASK-049` | `done` | `T-UI-003a`…`j` green in `apps/web/test/uploadStep1.spec.tsx`; mutation-proven against a defaulted mode and against revealing the consequence on selection |
| `TASK-050` | `done` | `T-IMG-002`, `T-IMG-006`, `T-IMG-010`, `T-IMG-012`, `T-IMG-018`, `T-IMG-023`, `T-PASTE-003`, `T-PASTE-005`, `T-PASTE-006`, `T-PASTE-007`, `T-SEC-003`, `T-RET-014`; ~~`T-IMG-013`~~ |
| `TASK-051` | `todo` | — |
| `TASK-052` | `todo` | — |
| `TASK-053` | `done` | `components/ImageDropzone.tsx` — `T-UI-004` (a–e), `T-UX-041` (a–e), `T-UX-042` (a–f). All three affordances render at once (paste button when `navigator.clipboard.read` exists, `Choose files` always, drop target); one `addFiles` path with the source reported but never branched on. Validation is lenient — empty **and** `application/octet-stream` types are accepted and left to the server sniff. Four mutations caught: HEIC dropped from `accept` (`T-UI-004a`), hard-filtering on `File.type` (`T-UI-004d`), the paste affordance replacing rather than joining file selection (`T-UX-041a/b/c`), rejections hiding the accepted list (`T-UX-042a/e`). New copy constants `UNSUPPORTED_FORMAT_REJECTION`, `IMAGE_ACCEPT_ATTRIBUTE`, `CHOOSE_FILES_LABEL`, `HEIC_PREVIEW_PLACEHOLDER` — quoted from `specs/ui.md` §3.2 prose, which §9 has no rows for. `PasteCapture` (TASK-160) and the drop target's full behaviour (TASK-162, `T-UI-014`) fill the slots; the ceiling messages are rendered here but the ceiling-copy test id named on TASK-162 is not defined in specs/testing.md, so it is reported as a spec defect rather than cited here. |
| `TASK-054` | `done` | `apps/api/src/services/batchLifecycle.ts` — the transition table, `submitBatch`, `discardBatch`, `assertBatchMutable`, plus `transitionUploadBatchStatus` (the conditional write). Routes `POST /api/batches/:batchId/submit` (§6.14) and `/discard` (§6.23). `T-BATCH-017a`…`h` (table totality, one-way-ness, discardable set), `T-BATCH-019a`…`d` (the submit endpoint's status codes), `T-BATCH-018a`…`c` (atomic transition — `018a` mutation-verified after its first form proved vacuous), `T-BATCH-013a`…`d` (immutability: the guard **and** the absence of a mutating route), `T-BATCH-006a`…`f` (a discarded batch writes nothing, retains images, releases the ceiling). ⚠ **The three close/reconciliation ids this row originally cited are NOT delivered here** — they belong to TASK-072 and no close endpoint exists yet; see `specs/testing.md` §24.3. Two spec gaps reported in §24.2. |
| `TASK-055` | `done` | `packages/domain/src/extraction/` (contract + degraded projections) + `apps/api/src/extraction/` (recordings, `StubExtractor`, factory). `T-STUB-001a`…`r`, incl. the three fault tokens and byte-identical output over three runs. |
| `TASK-056` | `done` | `AzureVisionExtractor` (`apps/api/src/extraction/azureVisionExtractor.ts`) + offline `msw` contract suite (`T-AI-033a`–`s`, recordings in `tests/fixtures/msw/vision/`) + static boundary gates (`T-AI-009a`–`j`, `T-AI-010a`–`d`). Retry/timeout policy is implemented LOCALLY with an injectable `sleep` and the SDK's own retry pipeline disabled, because two retry layers compose multiplicatively against a 5,000/month free tier. ⚠ In standalone `azure-vision-read` mode `extract()` always reports `crossCheck: 'llm-unavailable'` — the primary reader is deliberately not called, so the read genuinely was never corroborated, and reporting `ok` would let a strictly-worse read propose mass removals. The ADR-0001 Rev 1 revert path therefore runs in degraded mode (§2.2a) and withholds removals. `T-AI-009` request half + `T-AI-010` land here; the `LlmVisionExtractor` half of `T-AI-033` is TASK-056b. |
| `TASK-056b` | `done` | `LlmVisionExtractor` (`apps/api/src/extraction/llmVisionExtractor.ts`) + committed prompt/schema (`prompts.ts`) + offline `msw` contract suite (`T-AI-033t`–`an`, recordings in `tests/fixtures/msw/aoai/`) and the `openai` half of the boundary gate (`T-AI-010e`–`g`). ⚠ Three judgement calls, all load-bearing. (1) `finish_reason: 'length'` is checked BEFORE the body is parsed — the truncation fixture carries *valid JSON with one complete tile*, so a parse-first implementation returns one title and looks entirely successful. (2) A schema-invalid or non-JSON body is TERMINAL, not retried: §2.2's retry set is explicit and exclusive (429/5xx/network only), and at `temperature: 0` with a fixed seed and strict Structured Outputs a repeat is near-deterministic, so retrying would spend the batch ceiling to get the same answer. (3) In standalone `llm-vision` mode `extract()` reports `crossCheck: 'ocr-unavailable'`, which — deliberately unlike TASK-056's `llm-unavailable` — still PERMITS removals: the primary, higher-quality reader did run, so a title's absence is evidence. SDK retry is disabled (`maxRetries: 0`) and §2.2's policy implemented locally with an injectable `sleep`, for the same multiplicative reason as TASK-056. |
| `TASK-056c` | `todo` | — |
| `TASK-057` | `todo` | — |
| `TASK-058` | `todo` | — |
| `TASK-059` | `todo` | — |
| `TASK-059b` | `todo` | — |
| `TASK-060` | `todo` | — |
| `TASK-061` | `todo` | — |
| `TASK-062` | `todo` | — |
| `TASK-063` | `todo` | — |
| `TASK-064` | `todo` | — |
| `TASK-065` | `todo` | — |
| `TASK-066` | `todo` | — |
| `TASK-067` | `todo` | — |
| `TASK-068` | `todo` | — |
| `TASK-069` | `todo` | — |
| `TASK-070` | `todo` | — |
| `TASK-071` | `todo` | — |
| `TASK-072` | `todo` | — |
| `TASK-073` | `todo` | — |
| `TASK-074` | `todo` | — |
| `TASK-075` | `todo` | — |
| `TASK-076` | `todo` | — |
| `TASK-077` | `todo` | — |
| `TASK-078` | `todo` | — |
| `TASK-079` | `todo` | — |
| `TASK-079b` | `todo` | — |
| `TASK-080` | `todo` | — |
| `TASK-081` | `todo` | — |
| `TASK-082` | `todo` | — |
| `TASK-083` | `todo` | — |
| `TASK-084` | `todo` | — |
| `TASK-085` | `todo` | — |
| `TASK-086` | `todo` | — |
| `TASK-087` | `todo` | — |
| `TASK-088` | `todo` | — |
| `TASK-089` | `todo` | — |
| `TASK-090` | `todo` | — |
| `TASK-091` | `todo` | — |
| `TASK-092` | `todo` | — |
| `TASK-093` | `todo` | — |
| `TASK-094` | `todo` | — |
| `TASK-095` | `todo` | — |
| `TASK-096` | `todo` | — |
| `TASK-097` | `todo` | — |
| `TASK-098` | `todo` | — |
| `TASK-099` | `todo` | — |
| `TASK-100` | `todo` | — |
| `TASK-101` | `done` | `T-SUP-001`, `T-SUP-010`, `T-SUP-012`, `T-SUP-013`, `T-SUP-014` |
| `TASK-102` | `done` | `components/SuppressDialog.tsx` — `T-UX-085` (a–f), `T-UX-022` (a–l). The row is reported `pending` while the request is in flight and `suppressed` only once the server has persisted it, so a rejected request cannot leave a hidden row behind — `T-UX-085a` asserts `suppressed` is never reported **at all** on the failure path, which an optimistic-hide-then-reconcile implementation would not satisfy even though it ends on `present`. Undo goes back through the `suppressionId` the server returned (`supp:<workIdentity>`), never a row-scoped key (REQ-071); an idempotent 200 offers Close only, because nothing changed. Five mutations caught: optimistic hide before persistence (`T-UX-085a/e`, `T-UX-022d`), undo failure showing the row again (`T-UX-022f`), an idempotent 200 rendered as a fresh hide (`T-UX-022g`), the same 200 still offering Undo (`T-UX-022g`), and the undo affordance removed (`T-UX-022b/c/d/e/f/k`). Four invented copy constants live in the component, not `copy.ts`, each with a ⚠ FINDING note — see the spec defects below. |
| `TASK-103` | `todo` | — |
| `TASK-104` | `todo` | — |
| `TASK-105` | `todo` | — |
| `TASK-106` | `todo` | — |
| `TASK-107` | `todo` | — |
| `TASK-108` | `todo` | — |
| `TASK-109` | `todo` | — |
| `TASK-110` | `todo` | — |
| `TASK-111` | `todo` | — |
| `TASK-112` | `todo` | — |
| `TASK-113` | `todo` | — |
| `TASK-114` | `todo` | — |
| `TASK-115` | `todo` | — |
| `TASK-116` | `todo` | — |
| `TASK-117` | `todo` | — |
| `TASK-118` | `todo` | — |
| `TASK-119` | `todo` | — |
| `TASK-120` | `todo` | — |
| `TASK-121` | `done` | `fdd5519` — `tools/check-mutating-routes.mjs`, `T-MUT-001` (a–j), `T-MUT-002` (a–f). The 18 mutating routes each map to one of the eight REQ-041 owner-initiated operations or carry an explicit non-list-state reason; mutation-proven with an unregistered `POST /titles/:id/auto-confirm` and a `jobs/reconcile.ts` calling a guarded operation. |
| `TASK-122` | `done` | `dde3dc5` — `tools/check-outbound-hosts.mjs`, `T-SEC-031` (a–i) and the outbound half of `T-SEC-009` (`k`). Exactly three destinations: TMDB, Azure OpenAI, Azure AI Vision. Mutation-proven by widening the list to four, shrinking it below three, and planting an unlisted host in source. The telemetry and streaming hostnames the spec needs are assembled from fragments rather than added to another gate's exemption list. |
| `TASK-123` | `todo` | — |
| `TASK-124` | `todo` | — |
| `TASK-125` | `todo` | — |
| `TASK-126` | `todo` | — |
| `TASK-127` | `todo` | — |
| `TASK-128` | `done` | `c64b7b5` — `tools/egress-guard.mjs`, `T-CI-007` (a–n). Patches `fetch`, `http.request` and `https.request`; loopback and the compose service names stay reachable; mutation-proven with a `fetch` and a raw `https.request` to an external host. ⚠ Installed per-suite, not globally: global wiring needs `setupFiles` in `vitest.config.ts`, which no lane may edit — see the finding below. |
| `TASK-129` | `todo` | — |
| `TASK-130` | `todo` | — |
| `TASK-131` | `todo` | — |
| `TASK-132` | `todo` | — |
| `TASK-133` | `todo` | — |
| `TASK-134` | `owner` | Needs the owner to APPLY to Microsoft for Azure OpenAI modified abuse monitoring — an approval, not code. `docs/parallel-execution-plan.md` §3 already lists it as owner-dependent; the ledger said `todo`, which advertised it to lane agents as startable work. |
| `TASK-141` | `owner` | Needs a REAL Azure SQL database: the gating deliverable is an M0 smoke migration applied against one. Blocked behind the same owner-gated Azure boundary as TASK-007. |
| `TASK-142` | `done` | `T-INFRA-009` (`infra/budget.bicep`, `tests/infra/infra.spec.ts`). **Deployed live**: `az deployment sub create` succeeded, `az consumption budget list` returns `nextup-monthly / 13.0 / Monthly`, alerts at 100% and 150% to the owner by email. Email-only by design — no action group, webhook or automated remediation (TASK-142, `REQ-028`). `tools/check-infra.mjs` now drift-gates two templates. Also `T-SEC-034` (`tools/check-audit.mjs`): the production audit gate now suppresses by named, self-deleting exception after GHSA-ggr8-5vv4-36mx turned `main` red with an unfixable advisory whose npm-suggested "fix" is a prisma **downgrade**. See `specs/testing.md` §31. |
| `TASK-143` | `todo` | — |
| `TASK-144` | `done` | `eb07409` — a CI grep gate over `prisma/migrations/**` |
| `TASK-145` | `doing` | **Pixel guard DELIVERED, serial processing OUTSTANDING.** `packages/domain/src/pixelGuard.ts` (pure verdict table, `specs/api.md` §5.0.1), `apps/api/src/images/readDimensions.ts` (PNG IHDR / JPEG SOFn / HEIF `ispe`, header-only, ≤64 KiB, no decoder), `apps/api/src/images/decodeGuard.ts` (`assertDecodable`, the entry point TASK-149 names) and `maxDecodePixels()` in `apps/api/src/config.ts` (request-time read). `T-IMG-017a`-`l`, `T-IMG-022a`-`d`, `T-IMG-025a`-`g` — 23 unit cases, mutation-tested in six directions, six of six caught. Module-naming divergence between `specs/api.md` §5.0/§5.0.1/§5.0.3 and the backlog **resolved rather than guessed** (`specs/testing.md` §26.3a). ⚠ **Still to do before this row goes `done`:** the `concurrency = 1` half — strictly serial image processing with buffers released between images — which needs `apps/api/src/jobs/runExtraction.ts` (TASK-057/058) to exist before there is anything to set concurrency on or to measure peak RSS across. Recorded, not quietly counted as delivered (`specs/testing.md` §26.2b). |
| `TASK-146` | `done` | `docs/ghcr-pat.md` written. **No PAT is needed at all** — a fine-grained PAT cannot authenticate to `ghcr.io` and a classic one is account-wide, so the package is public and CI pushes with `GITHUB_TOKEN` (R8). Closed out with TASK-007: the `deploy.yml` link and the pre-push image secret-scan are in place, and the visibility flip is confirmed by the property that actually matters — an **unauthenticated** manifest GET against `ghcr.io/saquibrashid/nextup` returns 200, and both live Container Apps pull it with no `registries` block and no credential. |
| `TASK-147` | `done` | HEIC decode chain (`heic-convert` → `heic-decode` → `libheif-js`, LGPL-3.0, decode-only) + `sharp` installed; `T-DEP-001` runtime allow-list, `T-DEP-002` encoder ban and `T-DEP-003` prebuilt-only added to `tools/check-deps.mjs`; `T-LICENSE-001` now green against the REAL tree, completing TASK-153's other half. Three corrections found at implementation: (a) `sharp@0.34` carried high-severity libvips CVEs and would have been blocked by `npm audit` in CI — pinned `^0.35.3`, 0 vulnerabilities; (b) `sharp` is Apache-2.0 with LGPL-3.0-or-later libvips binaries, **not MIT** as the spec claimed — corrected in `specs/security.md` §8 and the TASK-147 row; (c) **the runtime container stage installed with `--omit=optional`, which excludes all 25 sharp platform binaries** — proven by building the image both ways (`require('sharp')` threw "Could not load the sharp module using the linuxmusl-x64 runtime"), fixed with a `COPY --from=build` and guarded by `T-INFRA-007`. |
| `TASK-148` | `done` | `apps/api/src/images/sniffFormat.ts` + `T-IMG-024a`-`p` (16 unit cases). `UPLOAD_FORMATS`, `uploadedFormat` and the format error codes already existed from TASK-012, so this task is the sniffer itself. Two findings recorded in `specs/testing.md` §25.3: (a) the spec and the backlog name different module paths for this file AND for the TASK-145 pixel guard - the guard divergence is still unbuilt and should be settled before TASK-149 imports it; (b) a printable-ASCII guard in the brand reader was proven unfalsifiable by mutation and removed rather than left under a test that could not fail. The two ids the Done-when column originally named are integration properties of the upload endpoint and are already owned by TASK-050 - struck through, not relocated. |
| `TASK-149` | `done` | **ahead-of:TASK-145** — TASK-145's pixel-guard half is delivered and is what this task depends on; its remaining half is serial EXTRACTION, which belongs to TASK-057/058 and is not on this path. `apps/api/src/images/transcode.ts` + `apps/api/test/unit/transcode.spec.ts` (21 cases), claims table in `specs/testing.md` §29. `transcodeHeicToPng` calls `assertDecodable` as its first statement, decodes with `heic-convert` to **lossless PNG**, maps a catchable WASM allocation failure to `IMAGE_DECODE_OOM` (503) and everything else to `IMAGE_DECODE_FAILED` (415), and re-asserts the header dimensions against the decoded raster. Wired to the route by `DEFAULT_STAGES`; `UNBUILT_STAGES` survives as an alias so §28's citation resolves. Three findings in §29.3: (a) `ispe` ignores `irot`, so a correct decode legitimately **transposes** the dimensions - reading §5.1 step 4 literally would reject ordinary rotated camera-roll uploads, the exact case A42 exists to support; (b) the stored ceiling is not the upload ceiling - a lossless PNG transcode of a compliant 10 MiB HEIC was **unrepresentable in its own schema**, and the domain schema case had encoded the bug, so `MAX_STORED_IMAGE_BYTES` was separated and that case corrected in place; (c) wiring a stage that can genuinely fail turned a per-file failure into a **whole-request** failure - `ingestOne` now catches `AppError` only (REQ-080/081, `T-IMG-023k`/`l`). The real-fixture legs of `T-IMG-013/015/016` stay with **TASK-151**: `T-DEP-002` forbids a HEIC encoder in the tree, so nothing here can generate HEIC bytes and a committed fixture is the only route. |
| `TASK-150` | `done` | `stripAllMetadata()` in `apps/api/src/images/transcode.ts`, wired into `DEFAULT_STAGES.stripMetadata` so it runs for **every** accepted image from **every** source, outside the HEIC condition — never selected by `ingestSource`. `apps/api/test/unit/stripMetadata.spec.ts` (10 cases) plus an integration case that uploads a GPS-bearing JPEG over HTTP and re-reads the **stored blob out of Azurite**, so the claim is about what landed in the store rather than what a seam returned; it uses the **upload** path deliberately, because WebKit strips EXIF on clipboard read but not on file upload and a pasted fixture would pass whatever our code did. Removal is **structural** — whole JPEG segments and whole PNG chunks are copied or dropped, never re-encoded — so surviving CRCs stay valid and no pixel changes; a JPEG re-encode to launder metadata would be lossy, which NFR-012a forbids. `APP0` (JFIF) and `APP2` (ICC) are kept on purpose: the ICC profile decides how the image renders and identifies nobody. Unparseable streams fail closed. Six mutations verified, each caught by its named case. Claims, non-claims and two findings in `specs/testing.md` §30; §28.2 and §29.2 corrected in place now that REQ-078 is discharged. §30.2 records honestly that the **real-HEIC-with-GPS** leg named in `specs/security.md` §4.2 stays with **TASK-151** — the encoder ban means nothing in this tree can generate HEIC bytes, so a committed fixture is the only route. Finding: the integration JPEG fixture was a 29-byte header stub that stopped mid-`SOF0` and the strip correctly refused it as truncated; the fixture was wrong, not the refusal. |
| `TASK-151` | `todo` | — |
| `TASK-152` | `todo` | — |
| `TASK-153` | `done` | `d6796b3` — owner approved the LGPL-3.0 obligation; gate proven on synthetic fixtures |
| `TASK-154` | `todo` | — |
| `TASK-155` | `todo` | — |
| `TASK-156` | `todo` | — |
| `TASK-157` | `todo` | — |
| `TASK-158` | `done` | `packages/domain/src/pastedFileName.ts` + `T-PASTE-005a`-`s` (19 unit cases). `INGEST_SOURCES`/`IngestSource` already existed from TASK-012, so this task is the synthesiser alone. The INTEGRATION half of `T-PASTE-005` (round-trip of `ingestSource`, server-assigned `seqInBatch`, `blobPath` free of any client name) belongs to TASK-050 — see `specs/testing.md` §27.2. |
| `TASK-159` | `todo` | — |
| `TASK-160` | `todo` | — |
| `TASK-161` | `todo` | — |
| `TASK-162` | `todo` | — |
| `TASK-163` | `todo` | — |
| `TASK-164` | `todo` | — |
| `TASK-165` | `owner` | Needs a real iOS device to verify the clipboard paste path |
| `TASK-166` | `todo` | — |
| `TASK-167` | `done` | this commit — the ledger, the gate and `docs/status.md` |
<!-- STATUS-LEDGER:END -->


## 2. Critical path

The items that determine when the MVP is demonstrable. Everything not on this
list can slip without moving the end.

1. **TASK-001** monorepo scaffold →
2. **TASK-003** CI gate (12 blocking jobs) — *an autonomous agent's only feedback signal; nothing else may start before this is green* →
3. **TASK-006 / TASK-007** Bicep infra + deploy pipeline (deployable shell) →
4. **TASK-012 / TASK-017** domain types + owner-scoped repository →
5. **TASK-018 → TASK-023** principal, allow-list, owner scope, error envelope, middleware order →
6. **TASK-033** `GET /api/titles` read path →
7. **TASK-054** batch state machine →
8. **TASK-148 / TASK-149** ingest format sniffing + **HEIC→PNG transcode inline on ingest, CONDITIONAL ON THE SNIFFED FORMAT (R7) and behind the pre-decode PIXEL guard** — *hard dependency: extraction cannot run on HEIC bytes, so the transcode stage precedes the extraction pipeline* → **TASK-154** per-image failure isolation (`A43-M2` — on the path because `TASK-058` depends on it) →
9. **TASK-057 / TASK-058** extraction pipeline →
10. **TASK-060** deterministic TMDB matching →
11. **TASK-065 / TASK-071** review response + close →
12. **TASK-074** provenance model *(built here, early, per PRD §12.1 — US-032/US-033 cannot be correct without it)* →
13. **TASK-072** atomic-by-visibility close + resumability →
14. **TASK-081** full-update mode contract (`T-REV-006`) →
15. **TASK-083 / TASK-086 / TASK-088** removals computation, confirmation, transition →
16. **TASK-103** suppression gate before record creation →
17. **TASK-112 / TASK-114** batch undo + refusal payload →
18. **TASK-126** `T-META-001` AC↔test mapping gate →
19. **TASK-130** `T-E2E-001` complete.

**Off-critical-path but scheduled early on purpose (risk-first):**
**TASK-010** (verify ADR-0001 Rev 2 pricing and `gpt-4.1` region/quota),
**TASK-011** (OQ-024 capture-surface evidence, **no longer a gate**) and
**TASK-134** (Azure OpenAI abuse-monitoring exemption). All three are
cheap, all three are owner-dependent, and TASK-134 must land before the
first real screenshot is uploaded. They sit in M0 for that reason.

**⚠ NOT on the critical path, and deliberately so (R7 / `A45`): the clipboard
paste tasks (`TASK-158 … 165`).** Paste is the owner's *preferred* affordance,
but **file upload is a complete ingest path on its own** (US-004 AC-16), so no
paste task gates extraction, review or close. What that means in practice: if
`TASK-159`/`160` slip, the MVP is still demonstrable — it is simply one tap
worse per screenshot. **The one paste task that must not be skipped is
`TASK-164`** (`T-PASTE-010`, the add-not-swap regression guard), because its
whole purpose is to fail if the upload journey is ever displaced by the paste
work. **`TASK-165` (the manual real-device iOS check) is scheduled inside the
`TASK-010` verification sprint** and is owner-dependent (`RSK-027`).

> **Backlog delta from ADR-0001 Revision 2 (2026-08-10T21:07):**
> new `TASK-056b` (LLM extractor, M), `TASK-056c` (cross-check merge +
> hybrid, M), `TASK-059b` (artwork-read review card, S), `TASK-079b`
> (manual live quality suite, S), `TASK-134` (abuse-monitoring
> exemption, XS). Revised: `TASK-010`, `TASK-011`, `TASK-055`,
> `TASK-056`, `TASK-057`, `TASK-058`, `TASK-059`, `TASK-078`,
> `TASK-079`, `TASK-084`, `TASK-122`, `TASK-133`.
> **Net: 133 → 138 tasks**, ~4 added task-units in M3, no task exceeds
> size **M** (BP-02 holds).

---

## 3. Milestone M0 — Repo, CI gate, deployable shell, risk-first checks

**Nothing here is feature work.** An autonomous implementer with no CI gate is an
implementer with no feedback signal, so the gate comes first.

| Task | Story | Description (files) | Size | Depends on | Done when |
|---|---|---|---|---|---|
| TASK-001 | US-039 | npm-workspaces monorepo: `package.json` (workspaces `packages/domain`, `apps/api`, `apps/web`), root `tsconfig.base.json` + per-workspace `tsconfig.json` (strict, `noUncheckedIndexedAccess`), `eslint.config.cjs` (flat config — ESLint 10 removed `.eslintrc.*` support; ~~`.eslintrc.cjs`~~), `.prettierrc`, `.editorconfig`, `.gitignore`. | S | — | `npm ci && npm run lint && npm run build` succeeds on a clean clone |
| TASK-002 | US-039 | Test harness: `vitest.config.ts` per workspace, `playwright.config.ts`, npm scripts `lint`, `typecheck`, `test:unit`, `test:int`, `test:web`, `test:e2e`, `test:a11y`, `golden`. Enforce the `T-META-004` test-ID naming rule via an eslint rule in `tools/eslint-rules/test-id-naming.js`. | S | 001 | `T-META-004` passes on an intentionally mis-named test |
| TASK-003 | US-039 | `.github/workflows/ci.yml` with the **12 blocking jobs** from `testing.md` §8, all required, none `continue-on-error`. | M | 002 | All 12 jobs run and block merge; a deliberately broken test fails the PR |
| TASK-004 | US-036 | Supply-chain gates: gitleaks job, `npm audit --audit-level=high`, dependency allow-list script `tools/check-deps.mjs` forbidding any telemetry/analytics package. | XS | 003 | `T-SEC-009` passes; adding `posthog-js` fails CI |
| TASK-005 | US-039 | `Dockerfile` — multi-stage, single image serving the built SPA **and** the Express API from one process; `.dockerignore`. | S | 001 | Image builds; container serves `/` and `/api/me` on one port |
| TASK-006 **(REVISED, R3; R4 — R4 is current)** | US-039 | **Build to Variant A (A40). Create `infra/main.bicep` + `infra/sqldb.bicep` + `infra/storage.bicep` + `infra/aca.bicep` — there is NO `infra/postgres.bicep` and NO `infra/acr.bicep`.** ACA environment + **two** apps (prod `minReplicas=1`, **`0.25 vCPU / 0.5 GiB`**, `maxReplicas=2` for revision transitions with **no scale rule**; staging `minReplicas=0`). **Datastore = Azure SQL: an Azure SQL logical server + `nextup` database on Basic (5 DTU, 2 GB, 7-day PITR)** and a **`nextup_staging` database on the serverless (auto-pause) tier** (billed per-database, ≈$0.50/mo — **there is no shared server**). **No Azure SQL Agent-job and no Elastic-job may exist anywhere** (REQ-028). **No `pg_trgm`** — search is `LIKE` (TASK-047). **DB auth = managed identity preferred, SQL-login password in Key Vault as the defined fallback**, surfaced as a KV-referenced ACA secret. **Image comes from `ghcr.io`** — there is **no `AcrPull` grant**; the registry credential is **NONE — the package is public and ACA pulls anonymously** (R8; see `docs/ghcr-pat.md`). ~~R4: the registry credential is a fine-grained PAT (`read:packages`) held as an ACA secret (TASK-146).~~. Private blob containers `screenshots` and `screenshots-staging`, each with a 30-day lifecycle rule and **soft delete / versioning / PITR explicitly DISABLED**. Log Analytics; system-assigned managed identities with least-privilege RBAC (the staging identity has **NO** grant on the production database or blob container). Two `.bicepparam` files, one per environment. No HA, no scale rule, no TTL. **↳ R6 (A43): the prod container template MUST also set the environment variable `NEXTUP_MAX_DECODE_PIXELS=25000000` alongside `cpu: json('0.25')` / `memory: '0.5Gi'`. These two values are a PAIR and must never be changed independently** — raising the guard without the memory removes the only thing stopping a bad image killing the container; raising the memory without the guard buys $4/month of nothing. The pairing is test-enforced by `T-INFRA-005` (TASK-008) and the sanctioned way to change both together is `docs/runbooks/scale-up-memory.md` (TASK-156). <br> ~~**↳ Superseded history (R3, PostgreSQL — DO NOT BUILD):** `infra/main.bicep` + `infra/postgres.bicep` + `infra/storage.bicep` + `infra/aca.bicep` + `infra/acr.bicep`; prod `0.5 vCPU / 1.0 GiB`; Azure Database for PostgreSQL Flexible Server B1ms, 32 GiB, single zone, NO HA, 35-day PITR, Entra-only auth with password auth DISABLED, `pg_trgm` only and `pg_cron` NOT installed, databases `nextup` and `nextup_staging`; Azure Container Registry Basic with `AcrPull` for both app identities and NO admin user.~~ <br> ~~**↳ Superseded history (pre-R3, Cosmos — DO NOT BUILD):** Cosmos NoSQL free tier, container `owner-data`, partition key `/ownerId`.~~ | **L** *(was M)* | 005 | `az deployment ... --what-if` clean for both environments; `T-INFRA-005` SKU pinning passes (Azure SQL Basic + serverless staging + ghcr + **the pair `0.25 vCPU / 0.5 GiB` AND `NEXTUP_MAX_DECODE_PIXELS=25000000`**); `T-INFRA-002` asserts blob soft delete/versioning are off; **no Agent-job / Elastic-job / TTL property anywhere in the compiled ARM** |
| TASK-007 **(REVISED, R3; R4)** | US-039 | `.github/workflows/deploy.yml`: build → **push to Azure Container Registry** (OIDC federated credential, no stored Azure secret) → **deploy to STAGING** (`az deployment group create` + **`prisma migrate deploy`**) → **staging smoke suite (`T-SMOKE-*`)** → deploy to prod → new revision at 0% traffic → prod smoke suite → shift traffic to 100%. Rollback is a revision switch. **`prisma migrate dev` and `prisma db push` MUST NOT appear in any workflow.** ~~push to ghcr.io.~~ **↳ R8 (FACTUAL CORRECTION, supersedes R4 below):** the push target is ghcr.io via `docker/login-action`, authenticating with the **built-in `GITHUB_TOKEN`** — **no PAT of any kind**. ACA pulls the **public** package anonymously. `deploy.yml` must also **secret-scan the built image before the push step** and link `docs/ghcr-pat.md` in a comment. ~~R4 (A40): the push target returns to ghcr.io — `docker/login-action` with a fine-grained PAT (`read:packages` for pull on ACA; `write:packages` for the CI push identity), NOT the Azure OIDC/`AcrPush` path.~~ Everything else (staging-first, `prisma migrate deploy`, smoke gates, `T-MIG-001` block, no `migrate dev`/`db push`) is unchanged. ~~**Honest give-up:** the PAT is a quiet-expiry credential (see TASK-146).~~ **(R8: no PAT exists, so there is no quiet-expiry credential on this path.)** | **M** *(was S)* | 006 | A commit to `main` deploys through staging first; a failing staging smoke suite blocks production; `T-MIG-001` blocks a destructive migration before either; **the deploy uses a ghcr.io login, not `AcrPush`** |
| TASK-008 **(REVISED, R6)** | US-023 | `tests/infra/sku.spec.ts` (`T-INFRA-005`) and `tests/infra/no-ttl.spec.ts` (`T-INV-013`: no TTL in Bicep **and** none on the live container). **`T-INFRA-005` asserts the compute/guard PAIR, and TASK-008 OWNS THAT COUPLING (`A43`):** parse `infra/aca.bicep` (and the compiled ARM) and assert **both** `cpu == 0.25` / `memory == '0.5Gi'` **and** `NEXTUP_MAX_DECODE_PIXELS == '25000000'`. **Add a third, explicitly-named assertion that the two move together — the allowed combinations are a closed set: `(0.25, '0.5Gi', '25000000')` or `(0.5, '1.0Gi', '50000000')`. Any other combination FAILS the test with the message "compute size and NEXTUP_MAX_DECODE_PIXELS must move together — see docs/runbooks/scale-up-memory.md".** This failing test is the drift detector, and it is a feature: it is what forces the reactive up-size (`A43`) to be taken correctly and completely rather than half-applied. <br> ~~`T-INFRA-005`: free/consumption SKUs asserted (compute size only).~~ *(Pre-R6 — superseded: asserting the size without the guard value allows exactly the half-applied change this test exists to catch.)* | S | 006 | `T-INFRA-005` (including the pair assertion and the closed combination set), `T-INV-013`; a deliberate edit raising **only** `memory` to `1.0Gi`, or **only** `NEXTUP_MAX_DECODE_PIXELS` to `50000000`, fails CI with the coupling message |
| TASK-009 | US-039 | `README.md` + `docs/getting-started.md`: clone → `npm ci` → `docker compose -f docker-compose.test.yml up` → run the whole suite **offline**. | XS | 002 | A clean machine can run `npm run test:unit && npm run test:int` with no network |
| TASK-010 **(EXTENDED, R3; R4)** | US-039 | **Verify the WHOLE cost model against live Azure pricing, not just extraction.** Phase 7 and the A41 re-decision both ran without web access, so **every figure in `architecture.md` §Cost summary is model knowledge** (`RSK-029`). Confirm, in the chosen region: (a) **PostgreSQL Flexible Server B1ms compute + 32 GiB storage + backup** — the largest single line and the least certain; (b) **ACA Consumption idle/active rates at `0.5 vCPU / 1.0 GiB` with `minReplicas=1`**, and whether the monthly free grant applies to an always-on replica — **this is the single least certain figure in the model**; (c) **ACR Basic**; (d) **`gpt-4.1` deployment availability, quota and token prices**, SKU `Standard` PAYG never PTU; (e) **Azure AI Vision Read F0** allowance and regional availability; (f) Blob storage; (g) **Azure SQL Basic (~$5)** as the published cost-down lever, so the leaner variant is quoted from a real number. Record findings as a dated addendum to `adr/ADR-0001-*.md` **and to `adr/ADR-0003-*.md` and `adr/ADR-0005-*.md`**, and **update `architecture.md` §Cost summary in place**. **↳ R4 (A40):** the selected design **IS** Variant A now, so the load-bearing figures shift: (a) becomes **Azure SQL Database Basic (5 DTU, 2 GB) prod** — verify it is a flat ~$5/mo and that Basic still exists (Microsoft has signalled DTU-model changes); (a2) **serverless staging DB** idle/auto-pause billing; (b) ACA idle rate at **`0.25 vCPU / 0.5 GiB`** with `minReplicas=1`; (c) is now **ghcr.io = $0** (confirm free for private packages at this volume); the PostgreSQL/ACR lines move to the *richer variant* addendum. Published total to confirm ≈ **$11–14/mo**. **↳ R6 (A43), additional verification owed here — this is metric existence, not pricing:** (h) confirm whether **`RestartCount` ("Replica Restart Count") and `WorkingSetBytes` ("Memory Working Set Bytes") exist as alertable Azure Monitor metrics for `Microsoft.App/containerApps`**, and **whether ANY OOM-distinct signal exists at all** (an `OOMKilled` metric, or a container-termination-*reason* dimension equivalent to Kubernetes' `reason: OOMKilled`). `architecture.md` §Observability records "Azure Container Apps does NOT surface OOM-kill distinctly" at **medium-high confidence, UNVERIFIED — web retrieval was unavailable to the architect**. **If a genuine OOM-distinct signal does exist, say so in the addendum: TASK-157 must then adopt it as the primary signal and demote replica-restart to a backstop.** Also price (i) the `A43-M5` alert rules (~$0.10/metric rule/month, ~$0.50/month for a 5-minute log-search alert; published as ~$0.60–1.00 total) and (j) the **up-sized** ACA rate at `0.5 vCPU / 1.0 GiB`, because that is the pre-authorised remedy and its "+~$4/month" figure is quoted to the owner in `runbooks/scale-up-memory.md`. | **S** *(was XS)* | — | Every figure carries a dated, sourced number; `architecture.md` §Cost summary is updated; **if the verified total exceeds the published estimate by more than 50%, raise it to the owner in `Context/open-questions.md` under OQ-026 rather than absorbing it** |
| TASK-141 **(REVISED, R3; R4 — R4 is current)** | US-039 | **DB auth + M0 smoke migration for the Azure SQL connection.** **First and gating deliverable is an M0 smoke migration:** apply the full initial migration against a real **Azure SQL Basic** database using the chosen auth path **before any feature work**, because Prisma's `sqlserver` managed-identity story is less-established than PostgreSQL's (**RSK-031**). Auth path is **managed identity preferred**. On the MI path the app authenticates to Azure SQL with an Entra access token (SQL Server access-token auth via `mssql` / Prisma `sqlserver`), and tokens expire — so implement **token refresh in the connection factory** so a long-lived process does not start failing after roughly an hour. `T-SEC-028` fast-forwards an expiry and asserts reconnection. **This is a known trap: a naive implementation passes every test on day one and fails silently in production overnight.** If MI auth cannot be made to work reliably in M0, fall back to the **SQL-login password in Key Vault** (which does NOT auto-expire, so token-refresh becomes unnecessary) and record the decision. `T-SEC-028` applies only on the MI path. <br> ~~**↳ Superseded history (R3, PostgreSQL — DO NOT BUILD): Entra-token refresh for the PostgreSQL connection.** The app authenticated to Postgres with an Entra access token as the password (`specs/security.md` §7); refresh was implemented in the Postgres connection factory.~~ | S | 006, 017 | **M0 smoke migration green against real Azure SQL Basic**; if MI: `T-SEC-028` green, no hard-coded token lifetime; if password fallback: the credential is a KV-referenced ACA secret and `T-SEC-028` is marked N/A with the reason |
| TASK-142 **(new, R3)** | US-039 | **Azure budget alert** on the subscription at **1.5× the published monthly total** in `architecture.md` §Cost summary, plus a second informational alert at 1.0×. Email the owner. Costs nothing, and converts `RSK-029` (real but unverified spend) from an unmonitored risk into a monitored one. **Do not add auto-shutdown or any automated remediation** — an automated action against this subscription could take the product offline or, worse, delete something (`REQ-028`). | XS | 006 | Budget and both alert rules exist in Bicep; a `what-if` shows them; no automated remediation action is configured |
| TASK-143 **(REVISED, R3; R4)** | US-039 | **Consistency sweep after the datastore change (`RSK-030`).** The A41 revision superseded parts of `specs/data-model.md` (§1, §3 physical shapes, §5.4, §7.3, §10, §13 → §15), and revised `api.md`, `testing.md`, `security.md`, `specs.md`, `ui.md` and four diagrams. Verify that **every superseded section carries its banner**, that no unbannered section contradicts §15, that no artefact still instructs an implementer to provision Cosmos or ghcr.io, and that entity names still match `diagrams/data-model-erd.md` exactly. Also action the two small follow-ups this revision named: **rename `ColdStartNotice` → `SlowResponseNotice`** and soften its copy (`specs/ui.md` §10 — the component is kept but its name is now a lie about the cause). **↳ R4 (A40): widen the sweep to the PostgreSQL → Azure SQL delta.** The authoritative chapter is now **`specs/data-model.md` §16** (§15 PostgreSQL retained, marked superseded). Verify: no unbannered section still names PostgreSQL, `pg_trgm`, Postgres error `23505`, `postgres:16-alpine`, ACR/`AcrPull`, or `$1/$2` positional params as *current*; every one appears only inside a banner, strikethrough, or historical note. Confirm the three invariants still express as filtered unique indexes in §16.4, and that error codes **2627/2601** (not 23505) and the **mssql/server:2022** CI container are consistent across `testing.md`, `api.md`, `security.md`. **⚠ Scope of this gate: a grep gate _detects_ contradictions; it does not _repair_ them.** Unbannered prose that gives a contradictory *instruction* (e.g. F-001) must be fixed **by hand** — the sweep cannot rewrite it. Treat TASK-143 as a **regression guard for the future**, not a backlog of known-outstanding inconsistencies (F-001/F-002/F-005/F-007 were already fixed by hand in the Phase 11 review pass). | S | — | A grep across `artifacts/**` for **`cosmos`, `ghcr` (outside R4 banners), `pg_trgm`, `postgres:16`, `23505`, `AcrPull\|AcrPush`, `continuation token`, `partitionKey`, `minReplicas=0`, `EXPLAIN \(ANALYZE`, `SET STATISTICS`, `PostgreSQL`, `B1ms`, and `Flexible Server`** returns only banner text, struck-through text and deliberate historical references. (This token set matches the widened R4 banner list in `architecture.md` exactly.) |
| TASK-144 **(REVISED, R3; R4)** | US-039 | **`T-MIG-001` — the destructive-migration gate.** CI greps `prisma/migrations/**` for `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` and `DROP TYPE` and fails the build on a match. `REQ-028` forbids losing data, and a migration is the one place an autonomous implementer can lose it quietly and irreversibly — **Prisma will cheerfully generate a `DROP COLUMN` from a renamed field**. Highest-value single test added by this revision (`specs/testing.md` §11.2). **↳ R4 (A40):** the grep still targets `prisma/migrations/**` (Prisma stays, provider `sqlserver`), but the destructive **T-SQL** forms differ: also match `DROP INDEX`, `ALTER TABLE ... DROP COLUMN`, `ALTER TABLE ... DROP CONSTRAINT`, and `sp_rename`-based column renames that hide a drop. Note there is **no `DROP TYPE`** in SQL Server (enums are `CHECK` constraints), so that token is replaced by `DROP CONSTRAINT`. `specs/testing.md` §11.2 (R4) carries the exact pattern list. | XS | 006 | A deliberately destructive migration (incl. `ALTER TABLE ... DROP COLUMN` and `DROP CONSTRAINT`) fails CI with a message naming the file and the statement |
| TASK-145 **(new, R4; REVISED, R6 — R6 is current)** | US-039 | **Contain OOM at 0.5 GiB during image processing (`RSK-016` — now an OWNER-ACCEPTED RESIDUAL RISK under `A43`/`OQ-028`, which makes this task MANDATORY, not a nice-to-have).** In the extraction worker (`apps/api/src/jobs/runExtraction.ts`) and the ingest path, process a batch's images **strictly serially** (`concurrency = 1`, down from 2) and **release each image's buffers before loading the next**. No parallel image decode. <br> **↳ R6 CORRECTION, IN PLACE — the guard is a PIXEL guard, not a byte guard (`A43-M1`).** Implement `apps/api/src/images/decodeGuard.ts` exposing `assertDecodable(header: Buffer): {width, height}`, which reads dimensions from the **container header only** — HEIF **`ispe` box**, PNG **IHDR**, JPEG **SOFn** — and **rejects BEFORE any decode buffer is allocated** when: `width × height > NEXTUP_MAX_DECODE_PIXELS` (env var, **default `25000000`**, read once at startup); or `width > 16000 \|\| height > 16000 \|\| width < 50 \|\| height < 50` (Azure AI Vision Read 4.0 bounds — such an image could not be extracted even if it decoded); or **the header is unparseable** (never "decode and find out"). The byte ceiling is **retained as a first cheap filter only — it is NOT the guard.** `NEXTUP_MAX_DECODE_PIXELS` **moves with container memory, always** (25 MP ⇄ 0.5 GiB, 50 MP ⇄ 1.0 GiB) — coupling test-enforced by `T-INFRA-005` (TASK-008). <br> ~~**Superseded R4 instruction — DO NOT BUILD THIS:** "enforce a **per-image byte ceiling checked BEFORE base64-encoding** (reject/queue oversized inputs rather than loading them)" *as the OOM guard*.~~ **Why it is wrong:** HEIC's compression ratio is highly variable, so **bytes do not predict raster size — a 6 MiB HEIC can be 48 MP** and decode to hundreds of MB. A byte guard passes exactly the file that kills the container. <br> Directly protects `NFR-012a`. Does NOT touch the extractor's model choice (ADR-0001 Rev 2 is untouched). **Honest, disclosed limitation: at 0.5 GiB, 48 MP iPhone Pro captures ARE refused** — cleanly, with a named reason and a documented remedy (TASK-155, TASK-156), but they are refused. | S | 017, 033 | **`T-IMG-017a`-`l`** (unit half — the decision table and `assertDecodable`), **`T-IMG-022a`-`d`** (`NEXTUP_MAX_DECODE_PIXELS` default + request-time read), **`T-IMG-025a`-`g`** (the header readers) — `specs/testing.md` §26.1. <br> ⚠ **The peak-RSS/`concurrency=1` criterion below is NOT yet met and this row stays `doing` until it is:** it needs the extraction worker (TASK-057/058), which does not exist. See `specs/testing.md` §26.2b. <br> A test feeds a batch of max-size images and asserts peak RSS stays under a set ceiling with `concurrency=1`; **a 48 MP header stub is rejected by `assertDecodable` with ZERO decode allocation (peak RSS asserted flat across the call)**; an unparseable header is rejected, not decoded; a 24 MP image passes; **no test relies on a byte ceiling as the OOM guard** and no test relies on parallel image processing |
| TASK-146 **(new, R4)** | US-039 | **ghcr.io PAT lifecycle runbook (`RSK-031`/registry give-up).** **↳ R8 (TASK-146, FACTUAL CORRECTION — this supersedes the R4 text above):** a **fine-grained PAT does NOT work with `ghcr.io`** — GitHub Packages supports **classic** PATs only, and a fine-grained token returns 403. Once fine-grained is off the table the only working token is account-wide (`read:packages` cannot be scoped to one repo), so **the package is PUBLIC and there is NO registry credential at all**: CI pushes with the built-in `GITHUB_TOKEN`, and ACA pulls a public image anonymously. This REMOVES the registry half of `RSK-031` rather than mitigating it. See `docs/ghcr-pat.md`. Create `docs/ghcr-pat.md` documenting: the credential-free design and **why a fine-grained PAT cannot be used**, the one-time step to make the package public plus an **anonymous `docker pull` verification**, the image-pull failure symptom and its diagnosis order, and — **retained as a fallback only** — the classic-PAT path with generation at the longest permitted expiry, Key Vault storage, rotation ordering, and a dated calendar reminder. ~~R4: Dropping ACR's managed-identity pull reintroduces a quiet-expiry credential: a fine-grained PAT scoped `read:packages` (pull) and a separate `write:packages` push identity.~~ The failure mode is a deployment that breaks weeks later with an auth error for no code reason — the runbook names that symptom explicitly so it is diagnosable. | XS | 006, 007 | `docs/ghcr-pat.md` exists with generation, storage, rotation and a dated reminder; no PAT is committed or required; `deploy.yml` links to it in a comment and secret-scans the image before push (both land with TASK-007) |
| TASK-011 | US-006 | **OQ-024 capture-surface check (owner, ~10 minutes).** Owner captures one screenshot of each surface — Netflix phone, Netflix web, Max phone, Max web — and records whether each renders titles as **text** or as **artwork only**. **Rev 2: this NO LONGER GATES the extraction investment** (the primary reader handles artwork), but the captures become golden fixtures and the answer calibrates the §9 recall expectations. | XS | — | Evidence file per surface in `Context/evidence/`; captures added to `tests/fixtures/golden/images/` |
| TASK-134 | US-036 | **Apply for Azure OpenAI modified abuse monitoring / limited-access data processing**, so the owner's screenshots are not retained for 30 days or exposed to human reviewers. Until granted, document the exposure in `specs/security.md` §8 and in the owner-facing privacy note. | XS | 006 | Exemption applied for and its status recorded; the privacy note is accurate either way |

**Why TASK-011 is no longer a gate:** ADR-0001 Revision 2 made the
primary reader a multimodal model that identifies works from box
artwork, so **`RSK-021` dropped from High to Low**. The extraction
pipeline is no longer built on the assumption that titles are rendered
as text. TASK-011 stays in M0 because it is ten owner-minutes and it
supplies real golden fixtures — not because M3 depends on the answer.

---

## 4. Epics → stories → tasks

Epic and story IDs are from `artifacts/PRD.md`. **Every task traces to a user
story ID.** Test IDs are from `artifacts/specs/testing.md` §9.

> ### ⚠ Story→requirement traces are SYNCED FROM THE PRD — the PRD wins
>
> The `Traces to: US-0NN (…)` line under each story below is a **convenience
> copy**. `artifacts/PRD.md` is the **single authoritative source** for
> story→requirement traceability. If the two ever disagree, **the PRD is right
> and this file is stale.**
>
> **Corrected in full at `A44` (R8).** All 38 of these lines had gone stale:
> they were generated against an **earlier requirement numbering**, before the
> amendment passes inserted and renumbered requirements, and were never
> resynced — while the PRD's were maintained throughout. Most had degenerated
> into a near-sequential walk of REQ-001…REQ-068 that no longer corresponded to
> anything.
>
> This was not cosmetic. Four stories pointed at **`wont-v1`** requirements —
> most starkly **US-020 ("Sort it") → REQ-049**, which is *"credentialed login
> to, or automated retrieval from, any streaming service"*, a capability
> **proven non-viable and explicitly excluded**. Per **ASM-029** these artifacts
> are the implementation input for an autonomous coding agent, so a trace
> pointing at excluded scraping scope is a live hazard, not a typo.
>
> Non-requirement annotations (`SD-04`, `SD-12 WCAG 2.1 AA`, `testing.md §5`,
> the `A43`/`A45` AC notes, `NFR-012a` on US-006) were **preserved**.

### Epic A — Access & identity

#### US-001 — Only I can get in
Traces to: US-001 (NFR-015, NFR-016, NFR-017) · Milestone M1 · Depends on: TASK-006

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-018 | `apps/api/src/auth/principal.ts` — adapt the Easy Auth `x-ms-client-principal` header into a `Principal`. No auth library, no password handling. | S | 017 | `T-SEC-013` |
| TASK-019 | `apps/api/src/middleware/allowList.ts` — **fail-closed** against `NEXTUP_ALLOWED_SUBJECTS`; explicit bootstrap mode when unset-and-empty. | S | 018 | `T-SEC-010`, `T-SEC-014`, `T-SEC-015`, `T-SEC-016` |
| TASK-021 | `apps/api/dev/devPrincipal.ts` — dev shim excluded from production builds by the **directory boundary**: it sits outside `apps/api/tsconfig.json`'s `include: ["src/**/*.ts"]`, so the production compiler cannot emit it, and `createApp` takes the reader as an injected parameter so nothing under `src/` names it. Not a runtime flag, and not an exclude list (a denylist protects the files you thought of, never the next one). | S | 018 | `T-SEC-019` |
| ~~TASK-021~~ | ~~`apps/api/src/auth/devPrincipal.ts` — dev shim **excluded at compile time** from production builds (not a runtime flag).~~ ⚠ Superseded: a file inside `src/` can only be excluded by a list, and the cited `tsconfig.build.json` / esbuild `external` mechanism does not exist in this repo (`apps/api` builds with plain `tsc --build`). See `specs/security.md` §2.3. | S | 018 | `T-SEC-019` |
| TASK-027 | Easy Auth configuration in `infra/aca.bicep`: Entra ID provider, redirect to the requested path, deep-link preservation across sign-in, sign-out route. **Zero auth code in the app.** | S | 006, 019 | `T-INFRA-008` — the `authConfigs` resource exists and is shaped **closed** (named `current`, `platform.enabled`, `RedirectToLoginPage`, secret held by reference, **no `excludedPaths`**), asserted against the compiled ARM with every rule mutation-proven. ~~`T-AUTH-001`, `T-AUTH-002`, `T-AUTH-003`~~ — struck through **only as CI's definition of done**: all three are level `E` (Playwright against a deployed revision) and cannot run in CI, so citing them here would leave this task with no machine-verifiable exit criterion. They remain the **deployment-time** definition of done. Reasoning, and the smoke-test contradiction found while building this: `specs/testing.md` §18. |
| TASK-028 | `apps/web/src/pages/RefusalPage.tsx` + 401 and IdP-failure states; copy from `ui.md` §9. | S | 025, 019 | `T-SEC-018`, `T-UX-019`, `T-UX-025` |
| TASK-031 | `tests/smoke/deployed.spec.ts` — post-deploy smoke run against the 0%-traffic revision. | S | 007, 027 | `T-SMOKE-001`, `T-SMOKE-003` |

#### US-002 — Everything I store is mine alone
Traces to: US-002 (NFR-001, NFR-008) · Milestone M1 · Depends on: TASK-012

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-012 **(REVISED, R7)** | `packages/domain/src/types.ts`, `schemas.ts` (Zod), `enums.ts` — every document type, discriminated unions, no `any`. **↳ R7 (`A45`, `data-model.md` §3.1/§3.8): add `export const INGEST_SOURCES = ['paste','upload','drop'] as const` and `export type IngestSource = typeof INGEST_SOURCES[number]` to `enums.ts`, and add `fileName: string` (1..255, non-empty) and `ingestSource: IngestSource` to the `UploadedImage` type and its Zod schema.** `ingestSource` is **write-once provenance** — model it so nothing can update it after ingest — and is kept distinct from `uploadedFormat` (what the bytes are) exactly as `uploadedFormat` is kept distinct from the stored `format`. | M | 001 | Typecheck + `T-DM-*` schema round-trip tests; **(R7)** the `UploadedImage` schema round-trips `fileName` and all three `ingestSource` values and rejects a fourth |
| TASK-017 **(REVISED, R3; R4; R7 — R7 is current; the primary text below IS the thing to build)** | **Build to Azure SQL (A40 / ADR-0005 Rev 3). The authoritative DDL is `specs/data-model.md` §16.3 — NOT §15.3, which is the retained, superseded PostgreSQL chapter.** `prisma/schema.prisma` generated from the §16.3 T-SQL DDL (nine tables, the **filtered** unique indexes of §16.4, the `CHECK` constraints) + the initial migration + `apps/api/src/repository/ownerData.ts` — **`ownerId` is the first positional parameter of every method**, applied as an `owner_id` filter on every read and write. Prisma **stays** (`datasource db { provider = "sqlserver" }`), but **the SQL-Server-specific DDL — filtered unique indexes (§16.4), `CHECK` constraints, `ISJSON`, `Latin1_General_100_BIN2` collation on identity/key columns — lives in RAW migration SQL**, not in Prisma model attributes (Prisma's `sqlserver` modeling is thinner). `docker-compose.test.yml` uses **`mcr.microsoft.com/mssql/server:2022-latest`** (`ACCEPT_EULA=Y`, `MSSQL_SA_PASSWORD`, ~2 GB, health-wait — see `testing.md` §3.3a), with migrations applied before the suite; `sqlcmd` is at `/opt/mssql-tools18/bin/sqlcmd` and needs `-C` — **and that path exists only INSIDE the container, so a CI step must reach it via `docker exec` (§3.3a), never as a bare runner command.** Upsert uses **explicit UPDATE-then-INSERT-if-zero-rows, NOT `MERGE`** (SQL Server `MERGE` has correctness sharp edges). Unique-violation assertions are **`2627`/`2601`**. ~~`parseOrThrow` on every read~~ — Prisma's generated types are the read contract; Zod stays at the API boundary only. <br> **↳ R7 (`A45`) — the two new `uploaded_image` columns are owned HERE; NO new migration task was created.** Per `specs/data-model.md` §16.3, `uploaded_image` gains **`file_name NVARCHAR(255) NOT NULL`** with `CONSTRAINT ck_image_file_name CHECK (LEN(LTRIM(RTRIM(file_name))) > 0)` — display only, **never used to compose `blob_path`** — and **`ingest_source NVARCHAR(16) NOT NULL`** with `CONSTRAINT df_image_ingest_source DEFAULT 'upload'` and `CONSTRAINT ck_image_ingest_source CHECK (ingest_source IN ('paste','upload','drop'))`. Both live in the **raw migration SQL** alongside the other SQL-Server-specific DDL, not in Prisma model attributes. **The migration is ADDITIVE — `ALTER TABLE ... ADD` plus the CHECK constraints; no column is dropped and no row is rewritten, so `T-MIG-001` (TASK-144) is unaffected.** The `'upload'` default is deliberate and is a **true statement about history**: every row predating A45 did arrive by upload. `retain_until` is untouched — 30 days applies identically to a pasted image. <br> ~~**↳ Superseded history (R3, PostgreSQL — DO NOT BUILD):** DDL from `specs/data-model.md` §15.3; `docker-compose.test.yml` with `postgres:16-alpine` + Azurite; unique-violation assertions `23505`.~~ | **L** *(was M)* | 012 | Integration suite green offline against **mssql/server:2022**; a method without `ownerId` fails typecheck; `T-INV-001/002/015` assert the **database** raises `2627`/`2601`; `T-SEC-021` fails any Prisma `where` without `ownerId` |
| TASK-020 | `apps/api/src/middleware/ownerScope.ts` + `apps/api/src/auth/ownerId.ts` — derive `ownerId` from the principal; never from a request body or query. | S | 018 | `T-SEC-020`, `T-SEC-029` |
| TASK-023 | `apps/api/src/app.ts` — Express app with the **mandated middleware order** `requirePrincipal → requireAllowList → attachOwnerScope → routes → errorEnvelope`; `apps/api/src/routes/index.ts` route registry; **no CORS middleware**. | S | 019, 020, 022 | `T-SEC-005`, `T-API-001` |
| TASK-029 | `apps/api/test/integration/security.spec.ts` — route-enumerated allow-list coverage; cross-owner access returns **404, not 403**. | S | 023 | `T-SEC-017`, `T-SEC-002`, `T-SEC-028`, `T-SEC-030` |

### Epic B — Capture & import

#### US-003 — Start an import
Traces to: US-003 (REQ-002, REQ-003, REQ-058) · Milestone M3 · Depends on: TASK-023

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-048 | `POST /api/batches` in `apps/api/src/routes/batches.ts` — creates a `draft` batch with `service` and `mode` (`full-update` \| `append-only`); one open batch per owner. | S | 023, 017 | `T-BATCH-010`, `T-BATCH-015`, `T-API-003` ⚠ **corrected in place at implementation. The struck-through id below is defined NOWHERE in `specs/testing.md` — it appeared only in this file. The defined tests for this endpoint's behaviour are `T-BATCH-010` (US-003 AC-1, no default mode) and `T-BATCH-015` (US-005 AC-5, second open batch → 409 naming the open batch). `T-API-003` was ALSO a phantom — cited by this row AND by `packages/domain/src/errorCodes.ts`, implemented nowhere — and was implemented as part of this task; see `specs/testing.md` §11.2.** ~~`T-BATCH-001`~~ |
| TASK-049 | `apps/web/src/pages/UploadPage.tsx` step 1 — service + mode selection as two explanatory cards, not a bare radio. | S | 025, 048 | `T-UI-003` |

#### US-004 — Add multiple screenshots to one batch — by paste, by file upload, or by drag-and-drop
~~*US-004 — Attach screenshots*~~ — **superseded at R7 (`A45`): the old heading
named only one of three input paths and read as upload-only. The story ID is
unchanged; only the title moved (PRD US-004).**

Traces to: US-004 (REQ-001, REQ-004, REQ-007, NFR-001, NFR-006, NFR-011, NFR-012, NFR-020 · **A43 / OQ-028** (AC-9, AC-10, AC-11) · **A45** (AC-12 … AC-17)) · Milestone M3 · Depends on: TASK-048

> ⚠ **R7 (`A45`) — READ BEFORE IMPLEMENTING ANY ROW BELOW.** Ingestion is
> **three affordances converging on ONE pipeline**: a document-level `paste`
> listener (desktop), a visible **"Paste screenshot" button** →
> `navigator.clipboard.read()` (the verified iOS path), and
> **`<input type="file">` — retained, fully supported, the floor** — plus
> drag-and-drop. **Any task text, here or downstream, asserting that ingestion
> is file-upload-only is WRONG.** Paste **appends** to the existing open
> `UploadBatch`: **no new entity, no new endpoint, no second batch model, no
> auto-submit** (`api.md` §5.3.1). Two rules that are security-relevant, not
> stylistic: **(1)** the transcode branch keys on the **sniffed**
> `uploadedFormat`, **never** on `ingestSource`; **(2)** `REQ-078`'s EXIF strip
> **stays on the upload path** — WebKit's free stripping on clipboard read
> covers **one of three** affordances and is **not** the control.

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-050 **(REVISED, R5; R7 — R7 is current)** | `POST /api/batches/:batchId/images` — multipart; **accept PNG, JPEG AND HEIC/HEIF, each identified by MAGIC BYTES, never by extension and never by `Content-Type`** (iOS sends `application/octet-stream` for HEIC — see TASK-148). Reject anything outside the `UPLOAD_FORMATS` set with a per-file reason. HEIC/HEIF is accepted here and handed to the transcode stage (TASK-149); PNG/JPEG pass straight through. Ceilings 40 images/batch, 10 MiB/image, 60 MiB/batch, 10 files/request; partial acceptance with per-file rejection reasons. Record `uploadedFormat` (as received) distinct from the stored `format` (post-transcode). <br> **↳ R7 ADDITION (`A45`, `api.md` §5.3.1) — this ONE route serves ALL THREE ingest affordances.** Accept an **`ingestSource` multipart field per file**, value in `{'paste','upload','drop'}`, defaulting to `'upload'` when absent; persist it write-once on `uploadedImage` (`data-model.md` §3.8, TASK-017). **Assign `seqInBatch` server-side in receipt order under the same write that inserts the row** (two concurrent pastes cannot collide), and for `ingestSource === 'paste'` **ignore any client-supplied filename entirely and call `synthesisePastedFileName()` (TASK-158)**; for `upload`/`drop` keep the device name, falling back to the same synthesiser with the `uploaded-`/`dropped-` prefix when it is empty or whitespace-only, so `fileName` is **never** empty. ⚠ **`ingestSource` is provenance ONLY. It MUST NOT influence validation, ceilings, the sniff, the pre-decode guard, the transcode branch, the EXIF strip, retention or storage** — it is untrusted client input and a pasted image is trusted exactly as little as an uploaded one. **There is NO `/paste` route, no JSON+base64 variant, and a paste NEVER creates a batch or submits one.** | M | 048, 148, 158 | `T-IMG-006 ~~T-IMG-001~~`, `T-IMG-002`, `T-IMG-010 ~~T-IMG-003~~`, ~~`T-IMG-013`~~ **(mis-cited — that id requires the HEIC→PNG TRANSCODE, which is TASK-149's, and TASK-149 already cites it. This route accepts and sniffs HEIC but hands it to a stage that does not exist yet; see `specs/testing.md` §28.2.)**, `T-IMG-012 ~~T-API-006~~`; **(R7)** `T-PASTE-003` (three successive pastes → ONE batch, ordinals `01`/`02`/`03`, exactly one `POST /api/batches` in the flow), `T-PASTE-005` (naming + `ingestSource` persisted, never inferred from the filename prefix), `T-PASTE-006` (`Blob.type` never trusted), `T-PASTE-007` (every ceiling and the guard apply identically to pasted images) |
| TASK-051 | `DELETE /api/batches/:batchId/images/:imageId` — pre-submit draft images only; **the sanctioned I-7 hard-delete exemption**, documented inline. | XS | 050 | `T-IMG-006`, `T-INV-012` |
| TASK-052 | `GET /api/images/:imageId` — authenticated stream, correct content type, no-store, `410 Gone` after purge. | S | 050 | `T-SEC-003`, `T-IMG-004` |
| TASK-053 **(REVISED, R5; R7 — R7 is current)** | `apps/web/src/components/ImageDropzone.tsx` — **set the file input `accept` to include HEIC/HEIF (`image/heic,image/heif,.heic,.heif`) alongside PNG/JPEG** so the owner's phone images are selectable in the first place; per-file rejection display; running totals against ceilings. Client `accept` is a convenience filter only — server magic-byte sniffing (TASK-050/148) remains authoritative. <br> **↳ R7 (`A45`, `ui.md` §3.2 / §3.2b, `ux-states.md` §4.3) — this component now renders THREE affordances, ALL VISIBLE AT ONCE**, and owns the shared submit path they all use: append `File`s to one `FormData` and `POST /api/batches/:batchId/images` with the correct `ingestSource`. **The client MUST NOT branch on ingest source for validation, preview, ceilings or error handling** — one path, three entry points. Render `DROPZONE_IDLE_LABEL` (*"Paste a screenshot, choose files, or drag them here — PNG, JPEG or HEIC, up to 10 MB each, 40 per batch."*) as the idle copy, and mount the slots for the paste button (TASK-160) and the drop target (TASK-162); **on viewports ≤ 640 px the paste slot sits directly ABOVE "Choose files", and "Choose files" is ALWAYS visible beside it — never replaced, never behind a menu.** Validate **leniently**: an unknown or empty `File.type`/`Blob.type` is accepted and left to the server sniff. A pasted image is always PNG, so it renders a normal client thumbnail — the HEIC placeholder case cannot arise on that path. <br> ~~**Superseded pre-A45 framing — DO NOT BUILD THIS:** "`ImageDropzone.tsx`: drag-and-drop plus a file input plus a mobile camera-roll picker", i.e. the upload affordances only.~~ **Why it is wrong:** it enumerates only file-selection routes and makes paste — the owner's *primary* interaction — look unsupported. ⚠ **This is an ADD: the file input keeps every capability it had, including HEIC.** | S | 050 | `T-UI-004`, `T-UX-042 ~~T-UX-005~~`, `T-UX-041`; **(R7)** the idle copy is `DROPZONE_IDLE_LABEL` and still enumerates PNG, JPEG **and** HEIC and the ceilings; the file input is present and functional with `navigator.clipboard` deleted. **~~`T-UI-014`~~ (all three affordances present simultaneously) is owned by TASK-162, NOT by this task — asserting it here would require depending on 159/160/162, which depend on this task (see §8.12).** |
| TASK-147 **(new, R5)** | **Add the HEIC decode dependency and register it on the supply-chain allow-list.** Add `heic-convert` (ISC → `heic-decode` ISC → `libheif-js` **LGPL-3.0**, decode-only, pure JS/WASM — **no native build**, runs on the standard Linux container) and keep prebuilt `sharp` (**Apache-2.0 — ⚠ corrected in place at implementation: NOT MIT, and its `@img/sharp-libvips-*` binaries are LGPL-3.0-or-later, so `sharp` carries the same notice obligation as `libheif-js`. ~~MIT~~**) for the downstream resize/clamp/metadata step. **`x265` / any HEIC *encoder* must NOT be pulled in** (decode-only keeps the licence floor at LGPL-3.0, not GPL). Add the exact package + licence rows to the `tools/check-deps.mjs` allow-list per `specs/security.md` §4.2, so CI does not fail the new dependency and so an unexpected GPL/encoder transitive is rejected. **This task does NOT approve the LGPL obligation — that is the owner's call in TASK-153.** | S | 004 | `npm ci` resolves with no native build step; `check-deps.mjs` passes with `heic-convert`/`heic-decode`/`libheif-js` allow-listed; a test asserts no `x265`/HEIC-encoder package is present |
| TASK-148 **(new, R5)** | **Sniff the real image format from magic bytes and gate on the `UPLOAD_FORMATS` set.** `apps/api/src/images/sniffFormat.ts` — detect PNG, JPEG and HEIC/HEIF from the leading bytes (HEIC/HEIF = ISO-BMFF `ftyp` brand check: `heic`/`heif`/`heix`/`hevc`/`mif1`/`msf1`), **explicitly ignoring the request `Content-Type`** because iOS Safari sends `application/octet-stream`. Add the `UPLOAD_FORMATS` const and the `uploadedFormat` field (distinct from stored `format`) per `specs/data-model.md`. Return the new `IMAGE_DIMENSIONS_UNSUPPORTED` / format-rejection error codes through the error envelope. **This is the input contract for both TASK-050 and the transcode stage.** | M | 012, 147 | **`T-IMG-024a`-`p`** (`specs/testing.md` §25.1) - a JPEG whose declared type is ignored is classified `jpeg`; a HEIC is classified from its `ftyp` brand whatever the filename says; a non-image is `null`; all four `UPLOAD_FORMATS` members are reachable (the add-not-swap guard); and the sniff takes bytes and nothing else, so no declared type can reach the decision. <br> ~~`T-IMG-006`~~, ~~`T-IMG-001`~~, ~~`T-IMG-013`~~ - **struck through, not relocated:** both are integration properties of `POST /api/batches/:batchId/images` (TASK-050, not built) and are ALREADY cited on that row, so the citations here were duplicates. A pure sniffer cannot assert a 415 envelope or a stored transcode result; claiming them would let an unbuilt endpoint report as verified. See `specs/testing.md` §25.2. |
| TASK-149 **(new, R5; REVISED R6; REVISED R7 — R7 is current)** | **Transcode HEIC/HEIF → PNG server-side, INLINE in the upload request (NOT a background job), before the image is stored.** `apps/api/src/images/transcode.ts` per `specs/api.md` §5.1: decode HEIC with `heic-convert`, re-encode to **lossless PNG**, optionally chain prebuilt `sharp` for the raster clamp; store the PNG as the canonical `format`. **Inline-on-ingest is deliberate — it does NOT violate REQ-041 (no background process changes user-visible LIST state):** the transcode is part of the synchronous upload request and touches no LIST state. Enforce the Read-OCR ceilings after transcode: **< 20 MB, > 50×50, < 16,000×16,000 px** → reject over-bounds with `IMAGE_DIMENSIONS_UNSUPPORTED`. **Separate, load-bearing acceptance criterion (own AC): a PRE-DECODE input guard that reads the HEIC container's declared pixel dimensions and REJECTS implausibly large images BEFORE allocating any decode buffer** — a legal ~10 MiB HEIC can be ~40–48 MP and decode to ~160–195 MB raw RGBA (up to ~⅔ GiB with the WASM copy + PNG encode buffer), which can OOM the 0.5 GiB container. Guard first, allocate second. Process serially (aligns with TASK-145 `concurrency=1`). <br> **↳ R6 CORRECTION, IN PLACE (`A43-M1`) — the load-bearing AC above is now precise and delegated:** the transcode path **MUST call `assertDecodable()` from `apps/api/src/images/decodeGuard.ts` (TASK-145) as its first statement, before `heic-convert` is invoked, before any buffer is allocated, and before the blob write.** Threshold = **`NEXTUP_MAX_DECODE_PIXELS`, default `25000000`**, dimensions read from the **HEIF `ispe` box / PNG IHDR / JPEG SOFn header only**. A guard rejection returns **`IMAGE_TOO_LARGE_TO_DECODE`** and a decode that runs out of memory returns **`IMAGE_DECODE_OOM`** — both distinct from **`IMAGE_DECODE_FAILED`** (corrupt/truncated), with exact text owned by TASK-155. **Wrap the `heic-convert` call so a WASM linear-memory allocation failure surfacing as a catchable `RangeError`/abort becomes `IMAGE_DECODE_OOM` for that one image rather than an unhandled crash** (ADR-0008 R2.4 — this is the *common* OOM path and it produces no container restart). <br> ~~**Superseded R5 phrasing — DO NOT IMPLEMENT AS WRITTEN:** "a PRE-DECODE input guard that reads the HEIC container's declared pixel dimensions and REJECTS *implausibly large* images".~~ "Implausibly large" is not a machine-executable threshold; the live rule is the explicit `NEXTUP_MAX_DECODE_PIXELS` comparison above, and it applies to **PNG and JPEG as well as HEIC**, not to HEIC alone. <br> **↳ R7 CORRECTION, IN PLACE (`A45`, ADR-0008 Rev 3, `architecture.md` R7 addendum (a)) — the transcode is now CONDITIONAL, and the condition is LOAD-BEARING.** Wrap the decode in exactly `if (uploadedFormat === 'heic' \|\| uploadedFormat === 'heif') { transcode() }`, where `uploadedFormat` is the value returned by the **magic-byte sniff** (TASK-148). PNG/JPEG take the skip branch and are stored as received (still guarded, still metadata-stripped). ⚠ **`if (ingestSource === 'paste') skipTranscode()` — or any other branch keyed on the ingest source — is FORBIDDEN and must not appear in the diff.** `ingestSource` is untrusted client input, and this is a security-relevant decision that must be made from the bytes. A pasted image *is* always `image/png` in practice (WebKit exposes only four clipboard representations), so it takes the skip branch **for free, as a consequence of a verified platform fact — not as an optimisation we implemented.** ⚠ **The transcode stage is NOT removed and MUST NOT be removed:** the iOS **Photos file-upload** path still delivers raw HEIC, and deleting the stage would re-break the exact case A42 fixed. The pre-decode pixel guard, the size ceilings and the metadata strip run on **every** image regardless of source. <br> ~~**Superseded R5/R6 phrasing — corrected, not deleted:** the transcode described as running unconditionally on the ingest path.~~ **Why it is wrong:** it wastes the WASM decode on PNGs that are already the target format, and — more importantly — it left the condition unstated, which is how `ingestSource` gets used as the discriminator by an implementer looking for one. | M | 148, 145 | `T-IMG-013` (HEIC → valid PNG), `T-IMG-015` (corrupt/truncated HEIC fails gracefully, no crash/OOM), `T-IMG-016` (dimension bounds enforced); **an implausibly-dimensioned HEIC is rejected by the pre-decode guard before any decode buffer is allocated (peak RSS asserted under ceiling)**; **(R6) a header stub declaring `8064 × 5952` (48.0 MP) is rejected with `IMAGE_TOO_LARGE_TO_DECODE` and zero decode allocation while `NEXTUP_MAX_DECODE_PIXELS=25000000`, and the SAME stub is ACCEPTED once the env var is `50000000` (proving the guard is the env var, not a hard-coded constant)**; **(R7) `T-IMG-023` — a pasted PNG skips the transcode (the `heic-convert` test double is NOT invoked) and is stored byte-identically; a HEIC arriving by FILE UPLOAD IS still transcoded (`format: 'png'`, `uploadedFormat: 'heic'`); and the structural half — a HEIC submitted with `ingestSource: 'paste'` (a lying client) is transcoded ANYWAY, proving the branch reads `uploadedFormat` and not `ingestSource`** |
| TASK-150 **(new, R5; REVISED R7)** | **Strip EXIF/GPS on ingest as an explicit, tested step — do not rely on it happening incidentally.** In the transcode/normalise path (`apps/api/src/images/transcode.ts`), guarantee the stored PNG carries **no EXIF, no GPS, no XMP** (heic-convert re-encodes from raw RGBA and drops it; `sharp` strips metadata by default — assert the result, don't assume it). Applies to the transcode output AND to PNG/JPEG that passed straight through. Per `specs/security.md` §4.2 (privacy posture; 30-day image retention). <br> **↳ R7 (`A45`, `api.md` §5.1a, `architecture.md` R7 addendum (b)) — THE EXIF TRAP, stated so it cannot be inferred away.** **WebKit strips EXIF on CLIPBOARD READ but does NOT strip it on FILE UPLOAD.** The free stripping therefore covers **one of three** ingest affordances, and it is a *belt* — **`REQ-078`'s explicit, tested strip is the *braces* and STAYS on the upload path, mandatory and unconditional.** ⚠ **The strip MUST run on every accepted image regardless of `ingestSource`, and MUST NOT be made conditional on it.** ⚠ **An implementer or reviewer who deletes this step because "pasted screenshots have no EXIF anyway" has removed the privacy control from the one route that actually needs it** — and no task text anywhere may be read as "the clipboard handles it". `T-SEC-032` **must be asserted against an UPLOADED image carrying real EXIF/GPS**; asserting it only against a pasted PNG **passes vacuously and proves nothing about our code**. | S | 149 | `T-SEC-032` — a real device HEIC **uploaded via the file input** with GPS EXIF is ingested and the stored blob is asserted to contain no EXIF/GPS/XMP; **(R7)** `T-SEC-032` additionally runs for a pasted PNG and an uploaded JPEG, and **`T-SEC-033`** asserts the HEIC-upload-with-GPS case specifically — the case the paste path can never exercise; a diff that makes the strip conditional on `ingestSource` fails |
| TASK-151 **(new, R5; REVISED R7)** | **Build the `golden/ingest/` fixture set and wire the ingest tests.** Add `tests/fixtures/golden/ingest/` with: a real HEIC (with EXIF/GPS), a truncated/corrupt HEIC, an over-dimension HEIC (or its declared-dimension header stub), a HEIC mislabelled `application/octet-stream`, plus PNG/JPEG controls. Wire `T-IMG-013`, `T-IMG-015`, `T-IMG-016`, `T-SEC-032` against them per `specs/testing.md`. Fixtures must be redistributable and committed. <br> **↳ R7 (`A45`) — three more fixtures the paste work needs, all delivered by THIS task so the fixture set stays in one place:** (a) a **PNG "clipboard blob"** fixture used as the pasted-bytes input; (b) a **PDF whose `Blob.type` claims `image/png`** (the lying-client case for `T-PASTE-006`); (c) a **HEIC carrying real GPS EXIF, exercised through the FILE-UPLOAD path**, which is the fixture `T-SEC-033` needs and the one a pasted image can never provide. | S | 149, 150 | `T-IMG-013`, `T-IMG-015`, `T-IMG-016`, `T-SEC-032` all run green offline against `golden/ingest/`; **(R7)** `T-SEC-033`, `T-PASTE-006` and `T-IMG-023` also resolve their fixtures from `golden/ingest/` and run green offline |
| TASK-152 **(new, R5; REVISED R7)** | **Client-side format validation + error copy.** `apps/web/src/**` — reject obviously-unsupported files before upload and show the `specs/ui.md` error message for the format/dimension cases (including the transcode-failure and `IMAGE_DIMENSIONS_UNSUPPORTED` server responses). The message must not tell the owner their **HEIC** is unsupported — HEIC IS supported. Client validation is advisory; the server remains authoritative. <br> **↳ R7 (`A45`, `ui.md` §3.2):** the same copy and the same validation apply to **pasted and dropped** items — **no separate message, no separate code path, no exemption** (`ux-states.md` §4.18). A rejected pasted image is named by its **server-synthesised** filename (*"pasted-20260811-154233-03.png is 48.0 MP"*), so the client must render the server's `rejected[]` `fileName` verbatim rather than any local label. Validation stays **lenient** on `Blob.type`/`File.type` — unknown or empty types go to the server. **The clipboard-specific failure copy (`PASTE_*` constants) is NOT this task — it is TASK-161.** | XS | 053 | `T-UI-004`, `T-UX-042 ~~T-UX-005~~`; the error copy names dimension/format limits and never rejects HEIC as a format; **(R7)** a rejected pasted image is displayed under its synthesised name |
| TASK-154 **(new, R6 — `A43-M2`)** | **Per-image failure isolation and retryability — one bad image fails ONE image.** Files: `apps/api/src/routes/batches.ts` (attach handler), `apps/api/src/images/transcode.ts`, `apps/api/src/jobs/runExtraction.ts`, `apps/api/test/integration/ingestGuard.spec.ts`. A guard rejection (`IMAGE_TOO_LARGE_TO_DECODE`), a decode failure (`IMAGE_DECODE_FAILED`) or an out-of-memory condition (`IMAGE_DECODE_OOM`) **fails that image and only that image**: it appears in the attach response's `rejected[]` naming that one file with its own code; **every other image in the same request proceeds and stays staged**; the batch **stays open and re-attachable**. **Preserve the ordering `transcode → blob write → staged row`** so an interruption leaves either nothing or an orphan blob that no row references — **never a row pointing at a missing blob**. Orphan blobs are collected by the 30-day lifecycle purge (`NFR-019`); **write no compensating-cleanup code** (one fewer thing to get wrong). **Retryability after the up-size:** re-attaching the same file after `NEXTUP_MAX_DECODE_PIXELS` is raised must succeed and produce a normal staged image. ⚠ **Scope boundary, deliberate:** *no-partial-commit is guaranteed STRUCTURALLY by the one-transaction visibility flip at review-close (TASK-072), not by this task's error handling* — so **this task MUST NOT depend on TASK-072** (that edge would be circular: 058 → 154 → 072 → 071 → 065 → 058). It asserts the property at ingest/extraction level only. ⚠ **`REQ-074` reconciliation, stated so it is not re-derived (ADR-0008 R2.2):** a guard rejection or a decode OOM stores **nothing**, so `REQ-074` re-extraction **cannot** help and the file must be **re-attached**; only an OOM on an **already-stored** image is a `REQ-074` case, and only inside the 30-day `NFR-019` window. | M | 050, 149, 054 | `apps/api/test/integration/ingestGuard.spec.ts`: a 5-image request where image 3 trips the guard yields **4 accepted + 1 in `rejected[]`**, the batch is still `draft`/open, and **no visible LIST state row exists**; the same file re-attaches successfully after `NEXTUP_MAX_DECODE_PIXELS` is raised; an injected decode throw at the blob-write boundary leaves **no staged row referencing a missing blob**; no compensating-cleanup path exists in the diff |
| TASK-155 **(new, R6 — `A43-M3`)** | **The self-explaining memory error: two new codes and their exact text. NO BLIND DEBUGGING.** Files: the closed error-code enum (`apps/api/src/middleware/errorEnvelope.ts` / `AppError`, TASK-022), `apps/api/src/images/transcode.ts`, and the client error copy (`apps/web/src/**`, alongside TASK-152). Add **`IMAGE_TOO_LARGE_TO_DECODE`** and **`IMAGE_DECODE_OOM`** to the closed enum. Both messages **must name memory/decode as the cause and cite `docs/runbooks/scale-up-memory.md`**; the text is **verbatim ADR-0008 R2.3** with the runtime values interpolated — actual megapixels and `width × height`, the **current container memory**, the **current `NEXTUP_MAX_DECODE_PIXELS` as MP**, the remedy `0.5 vCPU / 1.0 GiB (+~$4/month)`, the reassurance that **no other image in the batch was affected and nothing was committed**, and the instruction to **re-attach after up-sizing**. ⚠ **`IMAGE_DECODE_FAILED` (corrupt or truncated file) MUST NOT mention memory or the up-size** — more memory will never fix it, and conflating the two sends the owner to buy capacity they do not need. **The two must stay distinguishable in the log AND in the UI.** | S | 022, 149, 152 | A guard rejection and a simulated decode OOM each render text containing the megapixel figure, the container size, `+~$4/month` and the string `runbooks/scale-up-memory.md`; a **corrupt-HEIC test asserts the message contains NEITHER "memory" NOR "up-size" NOR the runbook path**; all three codes are in the closed enum and `T-API-002` still passes |
| TASK-158 **(new, R7 — `A45`)** | **Server-synthesised identity for a pasted image + `ingestSource` provenance.** Files: `packages/domain/src/pastedFileName.ts` (new), `packages/domain/src/enums.ts` (the `INGEST_SOURCES` const + `IngestSource` type — see TASK-012), `apps/api/src/routes/batches.ts` (call site), `packages/domain/test/pastedFileName.spec.ts`. Implement exactly `synthesisePastedFileName(seqInBatch: number, uploadedFormat: UploadFormat, pastedAt: Date): string` per `specs/data-model.md` §3.8.1, returning **`pasted-<YYYYMMDD>-<HHMMSS>-<NN>.<ext>`**: `<YYYYMMDD>-<HHMMSS>` from **server receipt time in UTC**, zero-padded, **never client time**; `<NN>` = `seqInBatch` zero-padded to **2** digits (`01`..`40`); `<ext>` derived from the **SNIFFED** `uploadedFormat` (`png`→`.png`, `jpeg`→`.jpg`, `heic`→`.heic`, `heif`→`.heif`), **never from the declared MIME type**. Uniqueness within a batch comes from `<NN>` alone — the timestamp is for the human. The same function serves `drop`/`upload` with the prefixes **`dropped-`/`uploaded-`** when the device name is empty or whitespace-only, so `fileName` is **never** empty. ⚠ **`fileName` is DISPLAY/PROVENANCE ONLY and MUST NEVER be used to compose `blobPath`** — `blobPath` stays `${ownerId}/${batchId}/${id}.${ext}` from server ULIDs alone, for all three sources (`security.md` T4). ⚠ **`ingestSource` MUST NOT be inferred from the filename prefix** — the prefix is display copy that may be re-worded; the column is the datum. Pure and deterministic: an injected clock, no `Date.now()` inside. | S | 012, 148 | `T-PASTE-005`: the format matches `pasted-\d{8}-\d{6}-\d{2}\.(png\|jpg\|heic\|heif)` exactly; **two images pasted in the same second get different names**; the extension follows the sniff and not the declared type; `blobPath` contains no part of any client-supplied name for any source; an empty device name falls back to `uploaded-`/`dropped-`; `ingestSource` round-trips as `paste`/`upload`/`drop` |
| TASK-159 **(new, R7 — `A45`, primitive 1 — desktop)** | **The document-level `paste` listener — and it MUST NOT hijack text paste.** Files: `apps/web/src/components/PasteCapture.tsx` (new), mounted by `apps/web/src/pages/UploadPage.tsx` and the open-draft attach area; `apps/web/test/pasteCapture.spec.tsx`. Attach `document.addEventListener('paste', …)` **on mount and REMOVE it on unmount** — a global always-on handler would swallow pastes into the fix-match / TMDB search inputs. Handler order is normative (`ui.md` §3.2b, `api.md` §5.3.3): **(1)** if `event.target` is inside an `<input>`, `<textarea>` or any `contenteditable`, **return immediately WITHOUT `preventDefault()`**; **(2)** read `event.clipboardData.files` plus `items` filtered to `kind === 'file'` and a `type` beginning `image/`; **(3)** if **zero** images were found, return **without** `preventDefault()` — a text-only paste is left entirely alone and is **not an error**; **(4)** otherwise `preventDefault()` and append **every** image found (a multi-image clipboard is not truncated to one) to the open batch via the TASK-053 submit path with `ingestSource: 'paste'`. ⚠ **Do NOT call `navigator.clipboard.read()` on this path** — the data arrives synchronously on the event, so this primitive needs **no permission, no prompt and no secure context**, and `read()` here would be a strict regression (Firefox 127+, adds a prompt). ⚠ **Do NOT add a hidden `contenteditable` trap** — prohibited: it is an obsolete workaround that breaks the §10.2 focus order and screen readers. | M | 053, 050 | `T-PASTE-001`, all four assertions in one test: a synthetic `paste` with a PNG in `clipboardData.files` attaches it and calls `preventDefault()`; an event whose `target` is an `<input>` returns **without** `preventDefault()` (**text pasting into TMDB search still works** — this is the load-bearing negative case); a text-only paste returns without `preventDefault()`; **the listener is removed on unmount** and a paste after navigating away attaches nothing |
| TASK-160 **(new, R7 — `A45`, primitive 2 — iOS)** | **The visible "Paste screenshot" BUTTON — a button, not a gesture.** Files: `apps/web/src/components/PasteButton.tsx` (new), rendered by `components/ImageDropzone.tsx` (TASK-053); `apps/web/src/copy/*` for `PASTE_BUTTON_LABEL` / `PASTE_IOS_HINT`; `apps/web/test/pasteCapture.spec.tsx`. Render a real `<button>` labelled **"Paste screenshot"** (`PASTE_BUTTON_LABEL`) **alongside — never instead of — the file control**, with `PASTE_IOS_HINT` (*"Take a screenshot, tap Copy on the preview, then tap here."*) beneath it on a touch viewport. Its click handler calls **`await navigator.clipboard.read()` SYNCHRONOUSLY INSIDE the handler** — **no `setTimeout`, no `await` and no state update before the `read()` call**, because outside transient activation the promise rejects immediately. Take the first `ClipboardItem` whose `.types` includes `image/png`, `await item.getType('image/png')`, wrap it in a `File` and post it with `ingestSource: 'paste'` through the TASK-053 submit path. **Feature-detect and HIDE:** if `typeof navigator.clipboard?.read !== 'function'` — **which includes every `http://` origin, where `navigator.clipboard` is simply absent** — **do not render the button at all** (not disabled, not broken); `ux-states.md` §4.16. **§4.0a:** a paste arriving **before** service/mode are chosen is **held client-side and attached once the batch exists** — never silently dropped, and it never creates or submits a batch itself. ⚠ **Do NOT build a "don't ask again" control** — iOS shows the callout **per invocation and never remembers it**; there is nothing to remember. ⚠ **Do NOT implement the iOS path as a document-level `paste` listener or a long-press affordance** (`architecture.md` R7 addendum (c)). Accessibility: ≥ 44×44 px, in tab order, keyboard-activatable. | M | 053, 158 | `T-PASTE-002` (`read()` called synchronously inside the click handler — asserted: no `await`/timer precedes it; the resolved `image/png` blob is posted with `ingestSource: 'paste'`; a pre-batch paste is **held**, not dropped), `T-PASTE-009` (with `navigator.clipboard` deleted, `queryByRole('button', {name: /paste screenshot/i})` is **null**, while "Choose files" and the drop target remain fully functional) |
| TASK-161 **(new, R7 — `A45`)** | **Clipboard rejection is the EXPECTED case: bounded, explained, re-offered — NEVER a spinner and NEVER an auto-retry.** Files: `apps/web/src/components/PasteButton.tsx` (the rejection mapping), `apps/web/src/copy/*` (the four constants), `apps/web/test/pasteCapture.spec.tsx`. Wrap the `clipboard.read()` promise so that **every** settlement maps, **within the same tick**, to exactly one of four states with its exact copy (`ui.md` §9, `ux-states.md` §4.13–§4.15): `NotAllowedError` → **`PASTE_DENIED_BODY`**; resolves with zero items → **`PASTE_EMPTY_BODY`**; resolves with items but none carrying `image/*` → **`PASTE_NOT_IMAGE_BODY`**; rejects with a bare `DOMException` (**the abandoned case — a stray tap, a tab switch or backgrounding Safari silently rejects it**) → **`PASTE_ABANDONED_BODY`**. **After every one of the four the button is re-enabled and re-offered, and the copy names the still-available upload path.** ⚠ **THE LOAD-BEARING RULE: no pending/spinner element may outlive the promise.** There is **no timeout state** — the promise always settles, so a timeout would be dead code masking a bug. ⚠ **No automatic retry, ever** — a `read()` outside a fresh user gesture rejects by design, so an auto-retry produces a silent failure loop. The batch is **untouched** by any rejection: still open, still holding every previously added image, no list state changed. | S | 160 | `T-PASTE-008`: four cases, each rendering its distinct constant, each leaving the button **enabled**; **after ANY rejection no pending/spinner element remains in the DOM**; no timer-based retry exists in the diff |
| TASK-162 **(new, R7 — `A45`, affordance 3)** | **Drag-and-drop, plus the all-three-affordances assertion.** Files: `apps/web/src/components/ImageDropzone.tsx` (drop handlers), `apps/web/test/pasteCapture.spec.tsx`. Make the **whole `/upload` attach area** a drop target (`onDragOver` → `preventDefault()`, `onDrop` → read `event.dataTransfer.files`), behaving **identically** to a file-input selection except that `ingestSource: 'drop'` is sent. While a drag is over the target show `DROPZONE_ACTIVE_LABEL` (*"Drop screenshots here"*) with a **visible border change — colour is never the sole carrier** (`ui.md` §10.2). A dragged **non-image** and a dragged **folder** are refused **by name** with the standard per-file message. **Not a mobile path and not pretended to be** — silently inert on touch is correct, not a gap. **This task also owns `T-UI-014`** — the assertion that the paste button, the file input and the drop target are **all in the DOM simultaneously**, all labelled and keyboard-reachable — **because it is the last of the three affordances to land**; putting that assertion on TASK-053 would require 053 to depend on 159/160/162, which all depend on 053 (§8.12). | S | 053, 159, 160 | `T-PASTE-004` (a `drop` with two PNGs attaches both with `ingestSource: 'drop'`; `dragover` renders `DROPZONE_ACTIVE_LABEL`; a dragged non-image and a dragged folder are refused by name); **`T-UI-014`** (all three affordances in the DOM at once with service and mode chosen, the paste button ≥ 44×44 px and in tab order, `DROPZONE_IDLE_LABEL` naming all three routes and still enumerating PNG/JPEG/HEIC and the ceilings, `PASTE_IOS_HINT` on a touch viewport, and a successful paste announced in the `aria-live="polite"` region) |
| TASK-163 **(new, R7 — `A45`)** | **The ingest-source parity suite: prove all three affordances are treated identically by the server.** Files: `apps/api/test/integration/ingestSources.spec.ts` (new), `packages/domain/test/pastedFileName.spec.ts` (integration half). This is the test task that stops the three entry points diverging in validation — the defect ADR-0009 names as "real and easy". Assert, using the TASK-151 fixtures: **(a)** three successive pastes produce **ONE** batch with three images, ordinals `01`/`02`/`03` in receipt order, **exactly one `POST /api/batches`** in the whole flow, and a paste after a file upload lands in the **same** batch alongside it; **(b)** a pasted blob declaring `image/png` whose bytes are a **PDF** → **415 `UNSUPPORTED_IMAGE_FORMAT`**, and one declaring `application/octet-stream` whose bytes are a valid PNG → **accepted**, `uploadedFormat: 'png'` — `Blob.type` is never trusted for any decision; **(c)** every ceiling and guard applies identically to pasted images — a pasted 48 MP PNG → **413 `IMAGE_TOO_LARGE_TO_DECODE`** with the decoder never constructed, an 11 MB paste → **413 `IMAGE_TOO_LARGE`**, the 41st image → **400 `TOO_MANY_IMAGES`** whether pasted or uploaded; **(d)** `image.decode.begin` carries `ingestSource`; **(e)** `retainUntil` on a pasted row is `uploadedAt + 30 days` exactly as for an uploaded one, written once and never updated, purged by the same lifecycle rule, returning the same `IMAGES_PURGED` behaviour on re-extract afterwards. | M | 050, 149, 150, 158, 160, 162 | `T-PASTE-003`, `T-PASTE-006`, `T-PASTE-007`, **`T-RET-014`**; the suite runs green **offline** against `golden/ingest/` |
| TASK-164 **(new, R7 — `A45`)** | ⚠ **THE ADD-NOT-SWAP REGRESSION GUARD — the single most important task in this revision.** Files: `tests/e2e/uploadPathRegression.spec.ts` (new). Assert that the **complete file-upload journey still passes AFTER paste ships**: attach **by file input** → extract → review → close, end to end. Asserted alongside it: the **file input still exists on `/upload`**; its `accept` **still admits PNG, JPEG AND HEIC**; and a **HEIC file upload is still accepted and still transcoded** to PNG. **This test exists to FAIL if paste quietly displaces upload** — which is the A42-shaped mistake this whole pass exists to avoid, and which no other test in the suite would catch. It is **not** a duplicate of `T-E2E-001`: `T-E2E-001` may legitimately be re-pointed at the fastest ingest path one day; this one is pinned to the file input **by design and must never be re-pointed**. Add a header comment in the spec file saying exactly that. | S | 080, 160, 162 | **`T-PASTE-010`** green; deleting the file input, narrowing its `accept`, or removing the HEIC transcode each make it **fail** (verified by a deliberate local edit before merge) |
| TASK-165 **(new, R7 — `A45`; ⚠ MANUAL, owner-dependent — the honest hole in the automated gate)** | **The real-device iOS paste check — the one thing CI cannot do.** Deliverable: an evidence note in `docs/evaluation/ios-paste-<date>.md`. **Why it cannot be automated (`testing.md` §10, A45 row):** WebKit's paste callout is **native platform UI drawn outside the page** — no WebDriver or Playwright can see or tap it; Playwright's bundled WebKit is **not** iOS Safari, so passing there would prove nothing; the permission is granted per invocation and **never remembered**, so there is no state to pre-seed; and the promise is rejected by any stray tap, which is exactly what a harness does. **Procedure, run on a real iPhone against STAGING over HTTPS** (⚠ **NOT over `http://<LAN-IP>` — `navigator.clipboard` is absent there and the button will simply not exist**, which looks like a missing feature rather than a missing certificate): **(1)** take a screenshot → tap **Copy** on the transient preview → open nextup → open a batch → tap **"Paste screenshot"** → tap **Paste** on the system callout → confirm the image appears in the batch under a `pasted-…` name; **(2)** repeat and **deliberately tap elsewhere mid-callout**, then confirm the UI **re-offers** rather than hanging. ⚠ **If only one half is ever run, run half (2)** — the abandoned-promise path is the one that produces a hung screen. Record the iOS version, the Safari version, both outcomes and a screenshot of the re-offer state. **A failure here does NOT block the MVP** — file upload is a complete path (US-004 AC-16) — but it MUST be recorded honestly, not skipped. | XS | 007, 160, 161 | `docs/evaluation/ios-paste-<date>.md` exists, records the iOS/Safari versions and **both** outcomes, and is linked from `specs/testing.md` §10's A45 row; **scheduled inside the TASK-010 verification sprint** (`RSK-027` — this is the **fifth** owner touchpoint) |
| TASK-063 | `packages/domain/src/overlap.ts` — intra-batch overlap collapse, two-pass, per **SD-02**. | S | 057 | `T-AI-007` |

#### US-005 — Batch lifecycle
Traces to: US-005 (REQ-005, REQ-006) · Milestone M3 · Depends on: TASK-048

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-013 | `packages/domain/src/ids.ts` — ULID generation, `deterministicId`, monotonic test-ULID helper. | XS | 001 | `T-DM-004` |
| TASK-054 | `apps/api/src/services/batchLifecycle.ts` — the state machine `draft → submitted → extracting → in-review → applied → undone`, plus `extraction-failed` and `discarded`; submit; discard; one-open-batch enforcement. | M | 048, 013 | `T-BATCH-017`, `T-BATCH-018`, `T-BATCH-019`, `T-BATCH-013`, `T-BATCH-006` ⚠ **corrected in place at TASK-054: the three struck-through ids immediately below are RECONCILIATION and CLOSE properties (§9 US-016/US-021) belonging to TASK-072 — no close endpoint exists at this task, and claiming them here would let an unbuilt reconciliation pipeline report as verified. They are re-cited on TASK-072; see `specs/testing.md` §24.3. `T-BATCH-017`/`018` are new ids defined in §24.1 because nothing asserted the transition table itself or the atomicity of a status change.** ~~`T-BATCH-011`, `T-BATCH-012`, `T-BATCH-014`~~ ⚠ **corrected in place at TASK-048: the ids struck through below are defined nowhere in `specs/testing.md` — both appeared only in this file.** ~~`T-BATCH-001`, `T-BATCH-002`~~ |
| TASK-072 **(done-when EXTENDED, A48)** | **Atomic close by visibility flip** (not one transaction) + crash resumability. **↳ This is the ONLY writer of `serviceState.lastCompletedBatchAt` — `upsertServiceState` exists in the repository but is called from nowhere until this task lands, which is why `T-FRESH-013` cannot be satisfied before it.** ↳ **Also owns `T-BATCH-014` (close applies additions, corrections and confirmed removals together) and `T-BATCH-011`/`T-BATCH-012` (reconciliation touches only the batch's service), relocated from TASK-054 at TASK-054 — see `specs/testing.md` §24.3.** | M | 071, 074 | `T-BATCH-003`, `T-BATCH-005`, `T-FRESH-013`, `T-BATCH-011`, `T-BATCH-012`, `T-BATCH-014` |
| TASK-073 | `packages/domain/src/reconcile.ts` — a pure function called **once** over the union of affected works. | S | 072 | `T-BATCH-004` |

### Epic C — Extraction

#### US-006 — Turn screenshots into candidate titles
Traces to: US-006 (REQ-008; **NFR-012a**) · Milestone M0/M3 · Depends on: TASK-011 *(evidence only — no longer a gate)*

> **⚠ Hard dependency (R5): the HEIC→PNG transcode stage (TASK-149) precedes
> this entire epic.** Extraction operates on the stored **PNG/JPEG raster only**
> — it never receives HEIC bytes, because ingest transcodes HEIC to PNG before
> storage (Azure OpenAI vision and Azure AI Vision Read both reject HEIC). This
> is a technical ordering constraint, not a preference: TASK-058 depends on
> TASK-149 so the edge is enforced, not merely implied.
>
> **⚠ Extended at R6 (`A43`): TASK-058 ALSO depends on TASK-154** (per-image
> failure isolation). The memory containment must land **before or with** the
> extraction pipeline, not after it — an extraction runner built before
> isolation exists will be built assuming a decode failure is a batch failure,
> and retro-fitting that is more expensive than ordering it correctly.
> **TASK-154 must NOT be given a dependency on TASK-072** (transactional
> close): that edge closes a cycle `058 → 154 → 072 → 071 → 065 → 058`. It is
> also unnecessary — no-partial-commit is a structural property of the close,
> not something TASK-154 implements.

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-011 | *(see M0)* OQ-024 capture-surface check. **No longer a gate** (ADR-0001 Rev 2); supplies golden fixtures. | XS | — | Evidence + fixtures |
| TASK-055 **(REVISED, R5)** | `packages/domain/src/extraction/TitleExtractor.ts` interface (with `inferredTitle`, `basis`, `ocrSupport`, `provider`, `boxSource`) + `apps/api/src/extraction/factory.ts` + `StubExtractor` with fault injection (`__llm_down__`, `__ocr_down__`, `__truncated__`), selected by `NEXTUP_EXTRACTOR` (default `hybrid`). **Input contract: the extractor consumes only the stored PNG/JPEG raster produced by the ingest transcode stage (TASK-149); HEIC/HEIF is out of contract and never reaches an extractor** (both readers reject it — see epic note above). | S | 012 | `T-STUB-001` |
| TASK-056 | `apps/api/src/extraction/azureVisionExtractor.ts` — Read F0, managed identity, timeouts, bounded retries, no PII in logs. **Still shipped: it is the cross-check leg and the one-config-value revert to ADR-0001 Rev 1.** | S | 055 | `T-AI-010 ~~T-AI-001~~`, `T-AI-033 ~~T-AI-002~~`, `T-AI-009` |
| **TASK-056b** | **`apps/api/src/extraction/llmVisionExtractor.ts` — Azure OpenAI `gpt-4.1`, managed identity, pinned model version, `temperature: 0`, `seed`, strict JSON Schema Structured Outputs, committed prompts in `prompts.ts`. Handles `finish_reason: 'length'` as an ERROR, content-filter refusals, 429/5xx retries, 60 s timeout. No prompt or image content in logs.** | **M** | **055** | **`T-AI-033`, `T-AI-040`, `T-AI-011b`, `T-AI-044`** |
| **TASK-056c** | **`packages/domain/src/extraction/crossCheck.ts` — the pure deterministic merge: geometry-scoped support classification (`exact`/`partial`/`none`), OCR orphan recovery, box selection, total ordering. Plus `hybridExtractor.ts` issuing both legs in parallel and the degraded-mode paths.** | **M** | **056, 056b** | **`T-AI-034`, `T-AI-039`, `T-AI-032`, `T-AI-036`** |
| TASK-057 | `packages/domain/src/extraction/cleanup.ts` + `chromeTerms.ts` — stage-2 cleanup; **grouping and chrome rules apply to `ocr-only` items only**; new verdicts `inferred-unverified` and `unreadable-tile`; UI chrome is **classified, never silently dropped**; every line carries a verdict. | M | 056c | `T-AI-004 ~~T-AI-003~~`, `T-AI-004`, `T-AI-030 ~~T-AI-005~~`, `T-AI-043 ~~T-AI-006~~`, `T-AI-043` |
| TASK-058 **(REVISED, R5; R6)** | `apps/api/src/jobs/runExtraction.ts` — inline job runner (**no queue, no scheduler**), concurrency 2, 15-min batch ceiling, progress reporting, `extraction-failed`, **`degradedExtraction` handling**, retry-extraction, `estimatedCostUsd` in `extractionStats`. **Reads the transcoded PNG/JPEG only** — depends on TASK-149 so HEIC bytes can never reach the readers. **↳ R6 (`A43-M2`): an image whose extraction fails on memory fails THAT image only** — per TASK-154, on which this task now depends. ⚠ **The `concurrency 2` above is the extraction-call concurrency (two reader legs); IMAGE processing is `concurrency = 1` per TASK-145 and that is not negotiable at 0.5 GiB — do not "optimise" it back to 2.** | M | 056c, 057, 054, 149, 154 | `T-BATCH-007`, `T-EXT-010 ~~T-AI-008~~`, `T-AI-036`, `T-CI-005` |
| TASK-059 | `apps/web/src/pages/BatchStatusPage.tsx` — polling, per-image progress, failure states, **degraded/cross-check-unavailable banners** (LLM latency makes this screen visible for minutes). | S | 058 | `T-UX-007`, `T-UX-008` |
| **TASK-059b** | **Review-card rendering for `inferred-unverified` — the proposed title shown **beside its cropped tile thumbnail**, with the "read from the artwork — check this" flag; and `unreadable-tile` shown as a thumbnail with a "search for this" action into manual entry.** | **S** | **058, 067** | **`T-AI-041`** |
| TASK-067 | `POST /api/batches/:batchId/candidates` manual entry + UI fallback for the artwork-only case. | S | 065 | `T-AI-023`, `T-UI-012` |
| TASK-077 | Zero-yield image surfacing (`ZERO_YIELD_IMAGE_RATIO = 0.5`) and low-yield detection with banners. | S | 058 | `T-AI-020`, `T-AI-021` |

### Epic D — Matching & identity

#### US-007 — Match candidates to real works
Traces to: US-007 (REQ-009, REQ-029) · Milestone M2/M3 · Depends on: TASK-045

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-045 | `apps/api/src/clients/tmdbClient.ts` + `GET /api/tmdb/search` + msw fixtures + `TMDB_UNAVAILABLE` handling. | S | 023 | `T-TMDB-010 ~~T-TMDB-001~~`, `T-AI-017 ~~T-TMDB-002~~` |
| TASK-060 | `packages/domain/src/matching/tmdbMatcher.ts` — **deterministic** scoring (jaro-winkler), `MATCH_AUTO_THRESHOLD = 0.92`, `MATCH_REVIEW_FLOOR = 0.70`, alternatives list, year hint. **No ML, no AI call.** | M | 045 | `T-TMDB-010 ~~T-AI-009~~`, `T-AI-010`, `T-AI-011` |
| TASK-061 | TMDB metadata allow-list storage — a Zod schema that **rejects** unlisted fields rather than stripping them. | S | 060 | `T-TMDB-004`, `T-TMDB-013 ~~T-DM-011~~` |
| TASK-062 | **Rule A structural enforcement (RSK-022):** eslint `no-restricted-imports` forbidding any AI SDK from the matching path, plus a network-shaped test asserting no TMDB-derived string leaves for an AI host. | S | 060 | `T-AI-012`, `T-AI-013`, `T-SEC-011` |

#### US-028 — Work identity
Traces to: US-028 (REQ-071; **AC-6′ and AC-7 added in phase 8**) · Milestone M1/M5 · Depends on: TASK-012

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-015 | `packages/domain/src/identity.ts` — `normaliseTitleText`, `workIdentityForTmdb`, `workIdentityForUnmatched`, `WORK_IDENTITY_RE`. Identity is `tmdb:{movie\|tv}:{id}` or `unmatched:<sha256(normalised)[0:16]>`; **year is excluded from the hash (SD-05)**. | S | 012 | `T-DM-001` (table test) |
| TASK-103 | **Suppression gate before record creation** — a single point read on `workIdentity`; no prefix scan, no branch by match state. suppress → remove → re-upload creates nothing. | M | 101, 071 | `T-SUP-003` |
| TASK-104 | **AC-6′:** unmatched works are suppressible; store `identityStability: 'unstable'` and render the caveat copy from `ui.md` §9. | S | 103 | `T-SUP-006` |
| TASK-105 | Suppressed works are excluded from the removal set and from open-batch review. | S | 103, 083 | `T-SUP-004`, `T-SUP-016` |

### Epic E — Review & apply

#### US-009 — Know what's new versus already there
Traces to: US-009 (REQ-010) · Milestone M3

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-064 | `packages/domain/src/classify.ts` — new vs already-present per service. | S | 060, 063 | `T-CLS-010 ~~T-CLS-001~~`, `T-CLS-011 ~~T-CLS-002~~`, `T-CLS-012 ~~T-CLS-003~~` |

#### US-008 — Nothing is silently lost
Traces to: US-008 (REQ-012) · Milestone M3

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-068 | Unmatched handling UI + `unresolvedKept` recorded on close — an unmatched candidate is **kept**, never discarded. | S | 065, 071 | `T-UNM-012 ~~T-REV-009~~`, `T-UX-063 ~~T-AI-024~~` |

#### US-012 — Review the batch and apply it
Traces to: US-012 (REQ-013, REQ-014, REQ-016, REQ-017, REQ-018) · Milestone M3 · Depends on: TASK-064

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-065 | `GET /api/batches/:batchId/review` — sections `additions`, `unmatched`, `probablyNotTitles`; shape exactly per `api.md` §6.17. | M | 064 | `T-REV-010 ~~T-REV-001~~`, `T-UX-063 ~~T-REV-002~~`, `T-AI-004 ~~T-REV-003~~` |
| TASK-066 | `PATCH /api/batches/:batchId/candidates/:candidateId` — disposition changes, `reclassifyAsTitle`, confirm-all. | S | 065 | `T-REV-011 ~~T-REV-004~~`, `T-REV-010` |
| TASK-069 | `apps/web/src/pages/ReviewPage.tsx` + `components/CandidateCard.tsx` + sticky action bar + section empty states. | M | 065 | `T-REV-013 ~~T-UI-005~~`, `T-UX-061 ~~T-UX-010~~`, `T-UX-011` |
| TASK-070 | **SD-11a** confirm-all control, **SD-11c** list virtualisation, **SD-11e** sessionStorage-persisted dispositions. | S | 069 | `T-UI-013`, `T-PERF-002` |
| TASK-071 | `POST /api/batches/:batchId/close` — `PENDING_ADDITIONS` guard, apply confirmed and corrected candidates, return a summary. | M | 066, 054 | `T-REV-012 ~~T-BATCH-008~~`, `T-REV-011` |

#### US-013 — The review reflects the mode I chose
Traces to: US-013 (REQ-011, REQ-057) · Milestone M4 · Depends on: TASK-071

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-081 | Mode contract in the review response: in **full-update**, `alreadyOnYourList` is **present and complete**; in append-only it is omitted. **The review shows ALL extracted titles.** | M | 071 | **`T-REV-006`**, `T-UI-006` |
| TASK-082 | "Already on your list" section — collapsed by default with a **visible count**, read-only. | S | 081 | `T-UI-014` |
| TASK-092 | Discrepancy visibility: what was extracted but is not on the list, and vice versa, is shown rather than reconciled silently. | XS | 081 | `T-REV-017` |
| TASK-093 | Append-only review scope — known items and removals are **absent from the DOM**, not merely hidden. | S | 081 | `T-REM-011` |
| TASK-129 | 500-candidate review performance + virtualisation check. | S | 070, 081 | `T-PERF-002` |

#### US-014 — Removals are computed, not guessed
Traces to: US-014 (REQ-015, REQ-019, REQ-073) · Milestone M4

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-083 | `packages/domain/src/removals.ts` — full-update removals, **service-scoped**, excluding already-removed and suppressed works. | M | 081 | `T-REM-010 ~~T-REM-001~~`, `T-REM-013 ~~T-REM-002~~`, `T-SUP-004 ~~T-REM-003~~` |
| TASK-084 | Low-yield **withholding** of the removal set + `LOW_YIELD_FULL_UPDATE` copy, **and the same withholding for `degradedExtraction: true` batches**. A bad read must never propose mass removal. | S | 083, 077 | `T-AI-021`, `T-AI-022`, `T-AI-036` |

#### US-015 — Removals require deliberate confirmation
Traces to: US-015 (REQ-020, REQ-021, REQ-055) · Milestone M4

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-085 | `PATCH /api/batches/:batchId/removals` — tick/untick; **ticked by default**. | S | 083 | `T-UI-007`, `T-REM-014 ~~T-REM-004~~` |
| TASK-086 | Close requires `confirmRemovals`; `components/RemovalConfirmDialog.tsx`; **no per-row remove affordance anywhere**. | M | 085, 071 | `T-REV-005`, `T-UI-008` |
| TASK-087 | Zero-member removal group handling + partial-failure prevention. | S | 086 | `T-REM-015`, `T-REV-007` |

#### US-016 — Removal changes state, never deletes
Traces to: US-016 (REQ-022, REQ-023, REQ-027) · Milestone M4

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-088 | Listing removal transition + `provenance.removed` + blast-radius containment (removing on one service never touches another). | M | 086, 074 | `T-REM-012`, `T-REM-016`, `T-REM-017`, `T-REM-018`, `T-REM-019` |

#### US-017 — Undo a removal group
Traces to: US-017 (REQ-056) · Milestone M4

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-090 | `POST /api/removal-groups/:groupId/undo` — restores the group, reports `heldBack`, is safe when already reversed. | M | 088 | `T-REM-020`, `T-REM-021` |
| TASK-091 | Undo affordance shown immediately after confirmation + an undo entry written to the batch record. | S | 090 | `T-UX-065 ~~T-UI-015~~`, `T-UX-013` |

### Epic F — The list itself (the value loop)

#### US-018 — See my combined list
Traces to: US-018 (REQ-024, REQ-025, REQ-026, REQ-031) · Milestone M2 · Depends on: TASK-023

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-033 | `GET /api/titles` — active and visible only, suppression anti-join, service badges, cursor pagination. | M | 017, 023 | `T-LIST-010 ~~T-LIST-001~~`, `T-LIST-011 ~~T-LIST-002~~`, `T-API-017 ~~T-API-004~~`, `T-LIST-012`, `T-LIST-013`, `T-LIST-019` (US-018 AC-3/4/6 — adopted; they were orphans, and AC-4 was unimplemented: `specs/testing.md` §22) |
| TASK-034 | `GET /api/titles/:titleId`. | XS | 033 | `T-LIST-028`, `T-LIST-035 ~~T-LIST-003~~` |
| TASK-038 | `apps/web/src/pages/ListPage.tsx` + `components/TitleList.tsx` + `TitleRow.tsx` — badges, poster, **deep links out to the service**. | M | 033, 025 | `T-UI-010 ~~T-UI-001~~`, `T-UI-010 ~~T-UI-002~~`, `T-UI-012 ~~T-LINK-001~~`, `T-LIST-018` (relocated from TASK-035 — the rendered-label assertion needs `TitleRow.tsx`, which lands here; see `specs/testing.md` §19.3) |
| TASK-040 | Two **distinct** empty states (nothing imported yet vs everything filtered out) + a load-failure error state. | S | 038 | `T-UX-012 ~~T-UX-001~~`, `T-UX-014 ~~T-UX-002~~`, `T-UX-018 ~~T-UX-003~~` |

#### US-019 — Filter it
Traces to: US-019 (REQ-032, REQ-033, REQ-034) · Milestone M2

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-037 | Filters by service, type, genre — **AND across dimensions, OR within**; a work with `genres: []` matches no genre filter. | S | 033 | `T-LIST-020 ~~T-LIST-006~~`, `T-LIST-021`, `T-LIST-022`, `T-LIST-023 ~~T-LIST-007~~`, `T-LIST-024 ~~T-LIST-008~~` |
| TASK-039 | `components/FilterBar.tsx` + query-string sync + zero-match state. | S | 037, 038 | `T-UI-016`, `T-UX-013 ~~T-UX-004~~` |

#### US-020 — Sort it
Traces to: US-020 (REQ-036, REQ-038) · Milestone M1/M2

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-016 | `packages/domain/src/derive.ts` — `deriveTitleState`, `deriveSortDateAdded` (earliest `dateAdded` across **non-removed** listings). | S | 012 | `T-INV-009`, `T-INV-010` |
| TASK-036 **(done-when EXTENDED, A48; EXTENDED AGAIN — see `specs/testing.md` §20)** | Ordering with a `title.id` ascending tie-breaker, nulls last, `dir` parameter. | S | 016, 033 | `T-LIST-016 ~~T-LIST-009~~`, `T-LIST-010`, `T-LIST-014`, `T-LIST-015`, `T-LIST-017`, `T-LIST-025`, `T-LIST-026`, `T-LIST-027` |
| TASK-166 **(new, R8 — `A44`; `must` as of `A47` — NOT optional scope)** | `components/SortControl.tsx` (spec: `specs/ui.md`) — the client-side control AC-6 needs. Wires the existing `GET /api/titles` `dir` parameter (`desc`/newest-first default \| `asc`/oldest-first); reflects the selection in the URL query string so it is deep-linkable and back/forward-safe; persists the selection for the session (US-020 AC-6). Date-added label stays honest per **REQ-061** — it is the date the title entered *nextup*, never the streaming service's own saved date. | S | 036, 039 | `T-UI-024` |

#### US-021 — Know when something was added
Traces to: US-021 (REQ-030, REQ-060, REQ-061) · Milestone M2

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-035 | **Server-side** `dateAddedLabel` + a write-once guard on `dateAdded`. | S | 033 | `T-INV-006` ~~`T-LIST-018`~~ (relocated to TASK-038: layer C, needs the unbuilt `TitleRow.tsx` — `specs/testing.md` §19.3) |

#### US-022 — Know how fresh each service is
Traces to: US-022 (REQ-039) · Milestone M2

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-041 **(REVISED, R9 — `A46`; done-when CORRECTED, A48)** | `serviceState` document + `GET /api/service-state` — per-service `lastCompletedBatchAt` (REQ-039) and the never-updated case. **↳ R9 (A46): the staleness computation and `LIST_STALENESS_DAYS` are DROPPED — the document/endpoint now serve the last-completed-batch date only, no derived "stale" state.** | S | 017, 014 | `T-FRESH-010`, `T-FRESH-012`, `T-FRESH-015` ~~`T-LIST-014`, `T-LIST-015`~~ |
| TASK-042 | `components/FreshnessStrip.tsx` + a degraded state when service state is unavailable. | XS | 041 | `T-FRESH-014 ~~T-UI-017~~` |

#### US-010 — Metadata stays current without a scheduler
Traces to: US-010 (REQ-076, NFR-014) · Milestone M2

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-043 | **Lazy** TMDB refresh inline on read paths, `TMDB_METADATA_MAX_AGE_DAYS = 183`, `metadataStale` flag, 5-second budget, never blocking the response beyond it. | M | 045, 033 | `T-TMDB-004 ~~T-TMDB-005~~`, `T-TMDB-016 ~~T-TMDB-006~~`, `T-CI-005` |

### Epic G — Attribution & compliance

#### US-011 — TMDB attribution
Traces to: US-011 (NFR-013) · Milestone M1/M2 · **Compliance obligation — failure is invisible from inside the app**

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-024 | `GET /api/me` returning the attribution payload. | XS | 023 | `T-ATTR-001 ~~T-API-005~~` |
| TASK-026 | `apps/web/src/components/TmdbAttribution.tsx` + `apps/web/src/copy.ts` (exact constants from `ui.md` §9) + `/about`. | S | 025 | `T-ATTR-001`, `T-ATTR-004` |
| TASK-046 | Playwright assertion of verbatim attribution on **all nine routes**. | XS | 026, 038 | `T-ATTR-002`, `T-ATTR-003` |

### Epic H — History, removal ledger, suppression

#### US-024 — The removed view
Traces to: US-024 (REQ-062, REQ-064, NFR-018) · Milestone M2/M5 · **Never de-duplicated**

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-047 **(REVISED, R3; R4 — R4 is current; the primary text below IS the thing to build)** | **Build to Azure SQL (A40). The authoritative index set is `specs/data-model.md` §16.6 — NOT §15.6, which is the retained, superseded PostgreSQL chapter.** The §16.6 indexes in a Prisma migration (`title_list_default`, `listing_removed_view`, `listing_by_title`, `batch_change_by_batch`, `candidate_by_batch`) + **keyset pagination** in the repository + a query-plan harness that uses **`SET STATISTICS IO` / the actual execution plan — NOT `EXPLAIN`**. **There is NO `pg_trgm` GIN index**: Azure SQL Basic has no trigram index, so fuzzy search over the removed view becomes **`LIKE N'%term%' COLLATE Latin1_General_100_CI_AI`** evaluated per-query — **not index-backed, and it loses typo tolerance**. Escape the `%`, `_` and `[` metacharacters and **parameterize the term (SQLi)**. Keyset listing pagination is **unaffected** (still index-backed). Full-Text Search is a named escalation, **not built now**. **`OFFSET` MUST NOT be used** — it degrades with history size and would break the exact `NFR-018` claim these indexes exist to defend. <br> ~~**↳ Superseded history (R3, PostgreSQL — DO NOT BUILD):** the index set of `specs/data-model.md` §15.6 plus a `pg_trgm` GIN index on `tmdb_name` and `normalised_text`, with an `EXPLAIN`-based query-plan harness.~~ ~~Composite indexes in `infra/cosmos.bicep` + a query-cost harness.~~ | **S** *(was XS)* | 006, 033 | `T-PERF-001` (index seek, rows-read bounded by page size, **no table scan** on `service_listing`), `T-PERF-003`; the search `LIKE` is parameterized and its metacharacters escaped |
| TASK-095 | Removed-view query with ordinals, search, and service filter. | M | 088, 047 | `T-REM-021 ~~T-REM-005~~`, `T-REM-006`, `T-REM-022 ~~T-REM-007~~` |
| TASK-096 | `apps/web/src/pages/RemovedPage.tsx` + `REMOVED_VIEW_SUBTITLE` + empty and error states. | S | 095 | `T-UI-009`, `T-UI-011` |
| TASK-097 | 20 000-row scale fixture + RU scale-invariance assertion. | S | 095 | `T-PERF-001` |

#### US-025 — Restore something removed
Traces to: US-025 (REQ-063) · Milestone M5

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-098 | `POST /api/listings/:listingId/restore` with 409s: `WORK_SUPPRESSED`, `DUPLICATE_WORK_IDENTITY`, `LISTING_NOT_REMOVED`. | M | 095, 101 | `T-RES-013 ~~T-REM-008~~`, `T-RES-014 ~~T-REM-009~~`, `T-REM-010` |
| TASK-099 | Restore UI + the un-suppress-first flow. | S | 098 | `T-UX-014`, `T-RES-016 ~~T-UI-018~~` |

#### US-026 — Reappearance
Traces to: US-026 (REQ-065) · Milestone M5

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-100 | A reappearing work creates a **new** Title dated today; the old removed row stays **byte-identical**. | M | 095, 071 | `T-REAP-010`, `T-REAP-011`, `T-REAP-012`, `T-REAP-013`, `T-REAP-014` |

#### US-027 — Not interested
Traces to: US-027 (REQ-070) · Milestone M5

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-101 **(PATH + DONE-WHEN CORRECTED, `A48`)** | `suppression` document + `POST /api/titles/:titleId/suppress` — idempotent, **per-work not per-listing**. **↳ The route takes a TITLE id and derives the WORK identity; `specs/api.md` §6.6 and the `check:mutating-routes` registry are authoritative and both say `/api/titles/:titleId/suppress`. ~~`POST /api/works/:workIdentity/suppress`~~ never existed.** | S | 015, 017 | `T-SUP-001`, `T-SUP-010`, `T-SUP-012`, `T-SUP-013`, `T-SUP-014` ~~`T-SUP-002`~~ |
| TASK-102 | `components/SuppressDialog.tsx` + immediate undo + rollback on failure. | S | 101 | `T-UX-085`, `T-UX-022` |

#### US-029 — See and reverse suppressions
Traces to: US-029 (REQ-072) · Milestone M5

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-106 | `GET /api/suppressions` + unsuppress — the suppression record is **never deleted**; `restoredAnything: false` when nothing came back. | S | 101 | `T-SUP-020 ~~T-SUP-007~~`, `T-SUP-021 ~~T-SUP-008~~` |
| TASK-107 | `apps/web/src/pages/NotInterestedPage.tsx` + `UNSUPPRESS_CONFIRM_BODY` + error state. | S | 106 | `T-UI-010` |

### Epic I — Provenance

#### US-031 — Every change is attributable
Traces to: US-031 (REQ-068) · Milestone **M3 (early, per PRD §12.1)** · Depends on: TASK-071

> **Built early on purpose.** PRD §12.1 flags that US-032 and US-033 *cannot be
> correct* without provenance. It is therefore built with Epics B/D, not late in
> Epic J.

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-074 | Provenance model + `createdByBatchId` + `provenance.created`. **Close fails atomically if provenance cannot be written.** | M | 071 | `T-PROV-001`, `T-PROV-010 ~~T-PROV-002~~`, `T-PROV-011 ~~T-PROV-003~~` |
| TASK-075 | `provenance.modified` for in-review corrections; out-of-batch edits record `batchId: null`. | S | 074 | `T-PROV-012 ~~T-PROV-004~~`, `T-PROV-013 ~~T-PROV-005~~` |
| TASK-076 | `GET /api/batches` + `apps/web/src/pages/BatchHistoryPage.tsx` + batch-detail provenance view. | S | 074 | `T-UX-093 ~~T-UI-019~~`, `T-BATCH-016 ~~T-BATCH-009~~` |

### Epic J — Recovery

#### US-030 — Fix a wrong match
Traces to: US-030 (REQ-066) · Milestone M6

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-109 | `POST /api/titles/:titleId/fix-match` — preserves listings, dates, and sort position; 409s enumerated. | M | 074, 060 | `T-FIX-010 ~~T-FIX-001~~`, `T-FIX-002`, `T-FIX-003` |
| TASK-110 | **SD-06** suppression migration on identity change + `FIXMATCH_SUPPRESSION_MIGRATED` (this is US-028 **AC-7**). | S | 109, 101 | `T-FIX-005`, `T-FIX-005 ~~T-SUP-009~~` |
| TASK-111 | `components/FixMatchDialog.tsx` + a TMDB-unavailable state. | S | 109 | `T-UI-020`, `T-UX-033 ~~T-UX-015~~` |

#### US-032 — Undo a whole batch
Traces to: US-032 (REQ-067) · Milestone M6 · Depends on: TASK-074

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-112 | `isCreatesOnly` predicate + creates-only undo with **DISCARD** semantics (SD-03 — the sole sanctioned hard delete besides pre-submit draft images) + `serviceState` revert. | M | 074 | `T-UNDO-001`, `T-UNDO-002`, `T-UNDO-003` |
| TASK-113 | `laterOwnerEdits` detection → refusal rather than a partial undo. | S | 112, 075 | `T-UNDO-004` |

#### US-033 — When undo refuses, tell me exactly why
Traces to: US-033 (REQ-075) · Milestone M6

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-114 | Refusal payload: full enumeration, `truncated: false`, per-item remedies, `currentState`. **Nothing is written on a refusal.** | M | 113 | `T-UNDO-006 ~~T-UNDO-005~~`, `T-UNDO-007` |
| TASK-115 | A 400-title mixed fixture proving the enumeration is complete and untruncated. | S | 114 | `T-UNDO-006` |
| TASK-116 | Full-screen refusal repair panel with `UNDO_REFUSAL_*` copy and per-title actions. | M | 114 | `T-UX-097 ~~T-UI-021~~`, `T-UX-097 ~~T-UX-016~~` |

#### US-034 — Re-extract after a bad pass
Traces to: US-034 (REQ-074) · Milestone M6

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-117 | Derived re-extract batch + `IMAGES_PURGED` refusal when the source images are gone; **the suppression gate still applies**. | M | 112, 103, 118 | `T-BATCH-010`, `T-RET-014` |

#### US-035 — Screenshot retention
Traces to: US-035 (NFR-019, NFR-011, NFR-020) · Milestone M1/M6

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-014 **(REVISED, R9 — `A46`)** | `apps/api/src/config.ts` — **two separate constants**, never unified: `IMAGE_RETENTION_DAYS = 30`, `TMDB_METADATA_MAX_AGE_DAYS = 183`. **↳ R9 (A46): `LIST_STALENESS_DAYS` is DROPPED (list-staleness nudge retired) — down from three constants to two.** | XS | 001 | `T-INV-008` |
| TASK-118 | `retainUntil` + availability derivation + 410 semantics for purged images. | S | 052, 014 | `T-IMG-004`, `T-IMG-005` |
| TASK-119 | Blob lifecycle rule test + proof that purging images **preserves every record**. | S | 118, 006 | `T-INFRA-004`, `T-RET-011`, `T-RET-012`, `T-RET-013` |
| TASK-120 | `IMAGE_RETENTION_STATEMENT` + `/about` copy: retention, never-delete, no-analytics. | XS | 026, 118 | `T-ATTR-004`, `T-UI-022` |

### Epic K — Platform, safety, and the shell

#### US-036 — No background processes, no secrets in the repo
Traces to: US-036 (REQ-041, NFR-005) · Milestone M0/M2/M7

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-167 **(new)** | **Task status ledger + gate + generated report.** `docs/backlog.md` §1.2 records one status row per task; `tools/check-status.mjs` validates it and regenerates `docs/status.md`; `npm run check:status` runs in CI. The gate refuses `done` when a test the task names is absent from the suite, when evidence is missing, or when a dependency is unfinished without an explicit `ahead-of:TASK-nnn` token. **Status is recorded, not derived from `git log`:** deriving it was measured on this repository and was wrong three ways — commit-body mentions counted as delivered (24% false-done), `c3febc3` names TASK-017 and TASK-047 in its subject while only editing spec text, and `TASK-013/014/015:` scans as one task while TASK-001 has no id at all. | S | 002 | `T-STATUS-001` |
| TASK-004 | *(see M0)* gitleaks + `npm audit` + dependency allow-list. | XS | 003 | `T-SEC-009` |
| TASK-044 | `tests/infra/no-scheduler.spec.ts` — static gate against timers, cron, and queue triggers. | XS | 043 | `T-CI-005` |
| TASK-121 | Mutating-route registry checked against the REQ-041 closed enumeration. | S | 023 | `T-MUT-001`, `T-MUT-002` |
| TASK-153 **(✅ OWNER APPROVED)** | **✅ SIGNED OFF — see the status ledger §1.2 and `CHANGELOG.md`.** The owner approved carrying the LGPL-3.0 HEIC codec and shipping the notice. `NOTICE` and `THIRD-PARTY-NOTICES.md` exist, and `T-LICENSE-001` (`specs/testing.md` §9A, `tests/infra/licences.spec.ts`) is green and wired into CI. **The remaining half is TASK-147’s to complete:** the notice file lists what actually ships, so `libheif-js` appears in it only once the dependency is installed — at which point the gate requires it and fails the build if it is absent. Original task text retained in the row below. | XS | 147 | Delivered at `d6796b3`; `T-LICENSE-001` |
| TASK-153 **(new, R5 — OWNER-DEPENDENT)** | **Owner licence sign-off for the LGPL-3.0 HEIC codec + add a `NOTICE` file.** The HEIC decode dependency introduces `libheif-js` (**LGPL-3.0**, weak copyleft, used unmodified, decode-only). Compatibility with this **MIT** repo is conditional on **retaining the LGPL notice**. A licence decision is **not an agent's to make**, so this task requires the owner to (a) approve carrying an LGPL-3.0 dependency in the shipped MIT app, and (b) confirm the `NOTICE` / THIRD-PARTY text. The agent prepares `NOTICE` + `THIRD-PARTY-NOTICES.md` (per `specs/security.md` §4.2) listing `libheif-js` LGPL-3.0 (unmodified, replaceable) for the owner to sign off. ⚠ **ID-collision: the architect's ADR-0008 report calls this "TASK-144", but TASK-144 is the destructive-migration gate — this is TASK-153; do NOT merge them.** Note: **OQ-027** (retain vs discard the original HEIC after verified transcode) is a separate open question, not resolved by this task. | XS | 147 | Owner has recorded approval (or rejection) of the LGPL-3.0 obligation; `NOTICE` + `THIRD-PARTY-NOTICES.md` exist and list `libheif-js` LGPL-3.0; if rejected, an alternative decode path is raised to the owner rather than shipped silently |

#### US-037 — It works on my phone and is accessible
Traces to: US-037 (NFR-006, NFR-007; SD-12 WCAG 2.1 AA) · Milestone M1/M7

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-025 | `apps/web/src/AppShell.tsx` + nav + router with all **nine** routes stubbed + `NotFoundPage.tsx`. | S | 001 | `T-UI-023` |
| TASK-123 **(REVISED, R7)** | Viewport suite at 320 / 1024 / 280 px. **↳ R7 (`A45`): include the three ingest affordances at 320 px** — the "Paste screenshot" button ≥ 44×44 px and in tab order, `PASTE_IOS_HINT` visible beneath it on a touch viewport, and **"Choose files" still visible beside it, never displaced** (`ui.md` §3.2b placement rule). | M | 038, 069, 096, 162 | `T-A11Y-001`, `T-A11Y-002`, `T-A11Y-013`, `T-A11Y-015`; **(R7)** all three affordances operable at 320 px |
| TASK-124 | axe-core suite across all nine routes — **zero serious or critical**. | S | 123 | `T-A11Y-012 ~~T-A11Y-003~~` … `T-A11Y-012` |
| TASK-125 | Offline states across every surface, per `ux-states.md` §11 checklist. | M | 123 | `T-UX-023`, `T-UX-024` |

#### US-038 — No streaming credentials, no automation of the services
Traces to: US-038 (NFR-009, NFR-010) · Milestone M1/M7

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-030 | Static assertions: no auth library, no password handling, no streaming credential or automation dependency. | XS | 023 | `T-SEC-011`, `T-SEC-001` |
| TASK-122 | No-telemetry assertion + outbound host allow-list (**TMDB, Azure OpenAI and Azure AI Vision only — exactly three hosts**). | S | 004 | `T-SEC-009`, `T-SEC-031` |

#### US-023 — Nothing is ever deleted
Traces to: US-023 (REQ-028; SD-04) · Milestone M0/M4/M7

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-008 | *(see M0)* SKU pinning + **the R6 compute/guard PAIR assertion (`0.25 vCPU / 0.5 GiB` ⇄ `NEXTUP_MAX_DECODE_PIXELS=25000000`)** + **no-TTL** infra tests. | S | 006 | `T-INFRA-005`, `T-INV-013` |
| TASK-089 | `apps/api/test/integration/no-hard-delete.spec.ts` — static **and** behavioural, with the two documented exemptions. | XS | 088 | `T-INV-012` |
| TASK-131 **(REVISED, R3; R4)** | **OQ-025 response, now narrowed:** PostgreSQL Flexible Server provides **35-day point-in-time restore** (five times the Rev 1 window), so this task is no longer the only line of defence — but PITR is not owner-controlled and does not survive loss of the subscription. Still deliver `scripts/export-owner-data.ts` — a **manually run** export of all owner data + a restore runbook in `docs/restore.md` that documents **both** paths (PITR to a *new* server first, compare, then repoint). Never scheduled. Never deletes. **↳ R4 (A40): OQ-025 RE-WIDENS.** Azure SQL Basic PITR is **7 days, not 35** — one-fifth the R3 window. Since REQ-028 makes the store append-mostly and **irreplaceable** (nothing is ever hard-deleted; no TTL), a corruption or bad migration unnoticed for a week is **unrecoverable via PITR**. Therefore the **manual export is promoted from safety-net to primary line of defence and MUST land EARLY (M0/M1)**: recommend a **weekly BACPAC export to blob** (still manually invoked or via a documented step — NOT an Agent job, which REQ-028 forbids) plus the `scripts/export-owner-data.ts` path. `docs/restore.md` documents PITR-to-a-new-DB (7-day window) and the BACPAC restore. LTR (long-term retention) is a named escalation. | S | 017, 044 | `T-EXPORT-001`; `T-CI-005` still green; the runbook covers the **7-day** PITR window and the manual/BACPAC export; **no scheduled Agent job exists** |

#### US-039 — The build, the gate, and the proof
Traces to: US-039 (NFR-002, NFR-003, NFR-004, NFR-012; testing.md §5) · All milestones

| Task | Description | Size | Depends on | Done when |
|---|---|---|---|---|
| TASK-001 | Monorepo scaffold. | S | — | clean-clone build |
| TASK-002 | Test harness + `T-META-004` naming rule. | S | 001 | `T-META-004` |
| TASK-003 | CI: 12 blocking jobs. | M | 002 | all 12 required |
| TASK-005 | Dockerfile / single image. | S | 001 | image serves SPA + API |
| TASK-006 | Bicep infra (**R4:** Azure SQL Basic + serverless staging DB, ghcr.io, 0.25/0.5). | **L** | 005 | what-if clean, no TTL, no Agent job |
| TASK-007 | Deploy workflow with a traffic-gated revision (**R8:** ghcr.io push with `GITHUB_TOKEN`; no PAT). | **M** | 006 | smoke gates traffic |
| TASK-009 **(REVISED, R7)** | README + offline getting-started. **↳ R7 (`A45`, ADR-0009 §Compliance): the getting-started MUST state that HTTPS is a FUNCTIONAL dependency, not merely a transport control.** `navigator.clipboard` is **absent** on `http://`, so running the dev server and opening it from a phone at **`http://<LAN-IP>:5173` shows NO "Paste screenshot" button at all** — and the failure looks like a missing feature, not a missing certificate. Say so in one explicit sentence, name the two supported ways to exercise the paste path (**staging over HTTPS**, or a trusted HTTPS tunnel), and note that the **desktop Ctrl/Cmd+V listener is unaffected** because it needs no secure context. Production is HTTPS-only via Container Apps ingress, so this is a local-development hazard only — called out rather than discovered. | XS | 002 | suite runs offline; **(R7)** the README names the `http://` clipboard limitation, the two HTTPS-based ways to test paste, and the desktop-listener exception |
| TASK-010 **(EXTENDED, R3; R4)** | **Verify the whole cost model** — **R4 Variant A: Azure SQL Basic (~$5) prod, serverless staging DB (~$0.50), ACA idle at `0.25 vCPU / 0.5 GiB` `minReplicas=1`, ghcr.io ($0)**, `gpt-4.1` region/quota/prices, Vision F0, Blob — against live Azure pages (`RSK-029`). The PostgreSQL/ACR lines move to the richer-variant addendum. | **S** | — | dated addenda on ADR-0001/0003/0005 + `architecture.md` §Cost summary updated |
| TASK-134 | **Azure OpenAI modified abuse monitoring exemption** (30-day screenshot retention). | XS | 006 | applied for; privacy note accurate either way |
| TASK-022 | `middleware/errorEnvelope.ts` + `AppError` + a **closed** error-code enum. | S | 012 | `T-API-002`, `T-SEC-007` |
| TASK-032 **(DONE-WHEN CORRECTED, `A48`)** | `tests/fixtures/seed.ts` deterministic seed + `asOwner` helper + injected clock. | S | 017 | `T-SEED-001`, `T-SEED-002`, `T-SEED-003` ~~`T-META-003`~~ |
| TASK-078 | Golden fixture set: **12** images (incl. `blank-no-content-01.png` and `truncated-titles-01.png`) + **recorded LLM responses** + recorded OCR + expected output + `manifest.json`. ⚠ `max-artwork-only-01.png` now has a **non-zero** `expectedTitleCount` and is the RSK-021 fixture; `blank-no-content-01.png` takes over the low-yield role. | M | 057 | `T-AI-030` inputs exist |
| TASK-079 | Golden metric gates (recall ≥ 0.95, false ≤ 0.10, **fabrication ≤ 0.05**, **omission recovery = 1.0**, artwork recall ≥ 0.80) + **manual-only** `golden:record` **and `golden:live`** scripts. | S | 078 | `T-AI-030`, `T-AI-031`, `T-AI-032`, `T-AI-035`, `T-AI-039`, `T-CI-004` |
| **TASK-079b** | **`tests/extraction/goldenLive.spec.ts` — the manual band-asserted live suite (L1–L7 in `specs/testing.md` §4A): 3 runs per image, recall floors, Jaccard stability ≥ 0.95, fabrication ≤ 0.05, cost ≤ $0.50, report written to `docs/evaluation/`. Excluded from `npm run test` and from every workflow.** | **S** | **079** | **`T-CI-004`; a committed baseline report exists** |
| TASK-080 | **`T-E2E-001` steps 1–4** (upload → extract → match → review). | M | 071 | `T-E2E-001` partial green |
| TASK-094 | **`T-E2E-001` step 5** (reconcile with removals). | S | 088 | steps 1–5 green |
| TASK-108 | **`T-E2E-001` steps 6–7** (suppression, removed view). | S | 103, 096 | steps 1–7 green |
| TASK-126 **(REVISED, R7)** | `T-META-001` AC↔test mapping gate + `T-META-002/003/004`. **↳ R7 (`A45`): the AC headline is now 241 (**R9/`A46`**: 242 − US-022 AC-2, deleted with the staleness nudge)** (PRD US-004 gained AC-12…AC-17). | M | all feature tests | every one of the **242** ACs maps to a passing named test, or to one of the documented `testing.md` §10 exceptions — **now 12, the twelfth being the iOS-Safari clipboard-paste interaction, whose compensating manual check is owned by TASK-165**. ~~every one of the 232 ACs…~~ *(R5 figure — superseded: the true count was 236 after A43 and is 242 after A45; see §8.10)* |
| TASK-127 | Coverage thresholds in CI: domain 95/90, api 90/85, web 70/60. | XS | 126 | CI fails below threshold |
| TASK-128 | `T-CI-007` — no network egress during CI. | XS | 003 | `T-CI-007` |
| TASK-130 | **`T-E2E-001` steps 8–10** (attribution, a11y, full re-run at 320 px). | S | 124, 108 | **`T-E2E-001` complete** |
| TASK-132 | Errata reconciliation: record **AC-6′** and **AC-7** in PRD traceability; correct the "62 in v1" headline in `Context/requirements.md` §1.8 and `Context/mvp-definition.md` §18 to **59**. | XS | — | counts agree across documents |
| TASK-156 **(new, R6 — `A43-M4`)** | **Land and VERIFY the memory up-size runbook in the delivered repo: `docs/runbooks/scale-up-memory.md`.** The authored source is `artifacts/runbooks/scale-up-memory.md`; this task is about it **existing in the shipped repo and being accurate against the REAL deployed infrastructure**, which the artifact version could only assume. Copy it, then **correct every placeholder in place against reality**: the Container App name and resource group (the artifact assumes `nextup` / `rg-nextup` — verify with `az containerapp list -o table` and fix if different), the Bicep file path (`infra/aca.bicep`) and the exact `resources: { cpu: json('0.25'), memory: '0.5Gi' }` block it tells the reader to edit, the env-var line `NEXTUP_MAX_DECODE_PIXELS`, and the `T-INFRA-005` test path (`tests/infra/sku.spec.ts`). **Verification is READ-ONLY — run `az containerapp show` and `az deployment group create --what-if`; DO NOT actually apply the up-size** (that is a cost change, taken only when the trigger fires). **Two gaps in the artifact version that this task MUST close, not copy:** (1) it does not tell the reader to **raise the `nextup-prod-memory-pressure` alert threshold from 400 MiB to 800 MiB** after up-sizing — without that the leading indicator fires constantly at the new size; add it as a step in §2 and to the §5 rollback; (2) the §7 escalation to `1.0 vCPU / 2.0 GiB` must state explicitly that it is **NOT owner-approved** and needs the owner's agreement. Link it from `README.md` and from a comment beside the `resources:` block in `infra/aca.bicep`. | XS | 006, 007, 008 | `docs/runbooks/scale-up-memory.md` exists; **every resource name, file path and test path in it resolves in this repo/subscription** (checked, not assumed); the `az containerapp show` command in §3 runs and returns the current size; the alert-threshold step and the "not owner-approved" §7 caveat are present; `infra/aca.bicep` and `README.md` link to it; **no up-size was actually applied** |
| TASK-157 **(new, R6 — `A43-M5`)** | **Make the OOM OBSERVED, not inferred: the decode sentinel log + the alert rules.** Without this the `A43` trigger ("up-size only if it OOMs") never fires and the owner simply experiences a flaky app. Two halves, both required. **(a) Application sentinel (`apps/api/src/images/transcode.ts`, `apps/api/src/jobs/runExtraction.ts`):** immediately **before** allocating, log `image.decode.begin` with `{batchId, imageId, filename, width, height, megapixels, declaredBytes, **ingestSource** (R7, `A45` — `'paste'`\|`'upload'`\|`'drop'`; an **operational** attribute of an owner-initiated request, **not** product analytics, so `NFR-005` is not engaged)}`; on success log `image.decode.end` with peak RSS. **A `begin` with no matching `end` names the exact image that died — it is the ONLY signal that does, which is why it is primary.** No image bytes and no PII in the log. **(b) Alert rules in Bicep** (`infra/alerts.bicep`, alongside TASK-142's budget alert; email the owner; **no automated remediation of any kind — `REQ-028`**): **`nextup-prod-decode-abandoned`** — a **`ContainerAppConsoleLogs` log-search alert**, 5-minute frequency, firing on any `image.decode.begin` with no `image.decode.end` for the same `imageId` within 5 minutes (also match the V8 text `JavaScript heap out of memory`); **`nextup-prod-replica-restart`** — metric alert on **`RestartCount`**, aggregation **Total > 0** over 5 minutes, severity 2 (deploys will trip it; accepted at one deploy per session); **`nextup-prod-memory-pressure`** — metric alert on **`WorkingSetBytes`**, **Average > 400 MiB** over 5 minutes, severity 3 (**raise to 800 MiB if the up-size is taken — TASK-156 owns that runbook step**). ⚠ **Read this before choosing the primary signal:** **Azure Container Apps is believed NOT to expose OOM-kill as a distinct signal** — no `OOMKilled` metric and no termination-reason dimension. That belief is **medium-high confidence and UNVERIFIED** (web retrieval was unavailable to the architect). **Verifying it is part of THIS task, jointly with TASK-010(h): if a genuine OOM-distinct signal does exist, adopt it as the primary signal and demote replica-restart to a backstop; if `RestartCount` does not exist, the sentinel and `WorkingSetBytes` still carry the design — record the finding as a dated addendum to `adr/ADR-0003-hosting-and-compute.md`.** ⚠ **Both failure paths must be covered and neither alone suffices:** a WASM allocation failure inside `libheif-js` is often a **catchable** `RangeError` → `IMAGE_DECODE_OOM`, one failed image, **no restart at all**; a kernel OOM kill is the opposite — a restart with no application error. An alert design resting on restarts alone misses the common case. Every alert notification must name `docs/runbooks/scale-up-memory.md`. Cost ~**$0.60–1.00/month**, unverified (`RSK-029`). | M | 006, 010, 142, 149 | A unit test asserts `image.decode.begin`/`end` pair on success and a **`begin` with no `end`** on an injected decode failure, with no image bytes or PII in either line; the three alert rules exist in Bicep and appear in `--what-if`; each notification body contains the runbook path; **no automated remediation action is configured** (`T-CI-005` still green); the metric-existence verification is recorded as a dated ADR-0003 addendum stating what was found |
| TASK-133 **(REVISED, R6; R7)** | Production readiness: rollback runbook, incident playbook, config checklist (`NEXTUP_ALLOWED_SUBJECTS`, `NEXTUP_EXTRACTOR`, **`NEXTUP_AOAI_ENDPOINT` / `NEXTUP_AOAI_DEPLOYMENT` / `NEXTUP_AOAI_MODEL`**, TMDB key, Vision endpoint, **`NEXTUP_MAX_DECODE_PIXELS` — which the checklist must flag as PAIRED with the container memory size and never editable alone**). **Must include the one-value revert to ADR-0001 Rev 1 (`NEXTUP_EXTRACTOR=azure-vision-read`) and a note that a model downgrade for cost reasons violates NFR-012a.** **↳ R6: cross-reference `docs/runbooks/scale-up-memory.md` (TASK-156) from the incident playbook** as the documented, pre-authorised response to an OOM — do **not** duplicate its content here, and do **not** describe an OOM as an incident to be debugged; it is a decided remedy (`A43`). **↳ R7 (`A45`): the config checklist must carry HTTPS/ingress as a FUNCTIONAL dependency, not just a transport control** — if ingress ever serves the app over plain HTTP the "Paste screenshot" button **disappears** (`navigator.clipboard` is absent), the owner loses the primary affordance silently, and the symptom looks like a UI bug. Name that symptom explicitly so it is diagnosable, and note that upload and the desktop Ctrl/Cmd+V listener keep working, which is exactly why the failure is quiet. | S | 007, 156 | `docs/runbooks/*.md` exist and are accurate; the config checklist carries `NEXTUP_MAX_DECODE_PIXELS` with its pairing warning **and the HTTPS/clipboard functional dependency with its symptom**; the incident playbook links to the memory runbook |

---

## 5. Cross-cutting work

These are not features, and they are the most commonly under-planned category.
Each is a real task above, listed here so it cannot be quietly skipped.

| Task | Description | Size | Milestone | Why it's needed |
|---|---|---|---|---|
| TASK-001/002/003 | Scaffolding, harness, CI gate | S/S/M | M0 | The agent's only feedback signal |
| TASK-005/006/007 | Container, IaC, deploy pipeline | S/L/M | M0 | No staging environment exists — CI and a traffic-gated revision are the whole safety net |
| TASK-009 | README / getting-started | XS | M0 | The owner must be able to run the suite offline |
| TASK-010 | **Live pricing verification of the FULL cost model** (**R4:** Azure SQL Basic, serverless staging, ACA always-on at 0.25/0.5, ghcr.io=$0, AOAI, Vision, Blob) | **S** | M0 | Neither phase 7 nor the A41/A40 re-decisions had web tools; **every figure is model knowledge (`RSK-029`)**, and the **R4 Variant A total is ~$11–14/mo** of real money (richer PostgreSQL variant ~$30) |
| TASK-141 | **DB auth + M0 smoke migration** (managed-identity preferred, KV password fallback) | S | M0 | **R4:** Prisma `sqlserver` MI path is less-established (`RSK-031`) — prove the migration against real Azure SQL Basic before feature work |
| TASK-142 | **Budget alert at 1.5× the published total** | XS | M0 | Converts unverified spend (`RSK-029`) into monitored spend |
| TASK-144 | **`T-MIG-001` destructive-migration gate** | XS | M0 | `REQ-028` is most easily violated by a Prisma-generated `DROP COLUMN` / `DROP CONSTRAINT` |
| TASK-167 | **Task status ledger + `T-STATUS-001` gate** | S | M0 | `docs/backlog.md` is the work order but recorded no status; git history proved unusable as a substitute, so the claim is written down and gated |
| TASK-143 | **Post-revision consistency sweep** (`RSK-030`) | S | M0 | **R4** widened it: the PG→Azure SQL change superseded parts of six specs and every store-naming diagram |
| TASK-145 **(R6)** | **Serial image processing + the pre-decode PIXEL guard at 0.5 GiB** (`RSK-016`, owner-accepted residual) — ~~byte guard~~ **corrected to a pixel guard: bytes do not predict raster size** | S | **M2** ~~M1~~ | `A43-M1`. The R4 compute cut is now the *confirmed* as-designed size (`A43`), so the guard is what makes it survivable. **Milestone corrected at R6: TASK-145 depends on TASK-033, which is M2, so it cannot be M1. It must still land before TASK-149 (M3), which it does.** |
| TASK-154 **(new, R6)** | **Per-image failure isolation + retryability** — one bad image fails one image, never the batch | M | M3 | `A43-M2`. Must land **before or with** the extraction runner (`TASK-058` depends on it) |
| TASK-155 **(new, R6)** | **`IMAGE_TOO_LARGE_TO_DECODE` / `IMAGE_DECODE_OOM` — the self-explaining error that names memory and cites the runbook** | S | M3 | `A43-M3`. `RSK-016`'s real complaint was never "it OOMs", it was "the failure is undiagnosable" |
| TASK-156 **(new, R6)** | **`docs/runbooks/scale-up-memory.md` landed in the repo and verified against real infra** | XS | M3 | `A43-M4`. A pre-authorised remedy nobody can find is not a remedy |
| TASK-157 **(new, R6)** | **OOM/restart alert + `image.decode.begin/end` sentinel log** | M | M3 | `A43-M5`. "Up-size only if it OOMs" requires *knowing* that it OOMed; ACA exposes no OOM-distinct metric, so the primary signal is one we emit |
| TASK-008 **(R6)** | **`T-INFRA-005` — the compute/guard PAIR assertion** | S | M0 | **Owns the coupling.** Raising memory alone wastes $4/mo; raising the guard alone removes the crash protection |
| TASK-146 | **ghcr.io PAT lifecycle runbook** (`RSK-031`) | XS | M0 | The dropped ACR managed-identity pull reintroduces a quiet-expiry credential |
| TASK-147 | **HEIC decode dependency + allow-list** (`heic-convert`/`libheif-js` LGPL-3.0, decode-only) | S | M3 | ASM-058: the phone delivers HEIC; without a decoder v1 fails on first use |
| TASK-148/149 | **Magic-byte format sniffing + HEIC→PNG transcode inline on ingest** (`RSK-032`) | M/M | M3 | Both readers reject HEIC; transcode is a hard dependency AHEAD of extraction |
| TASK-150 | **Explicit EXIF/GPS stripping on ingest** (`T-SEC-032`) | S | M3 | Privacy posture + 30-day retention; must be tested, not incidental |
| TASK-151 | **`golden/ingest/` fixture set** | S | M3 | The only objective proof HEIC ingest works and stays working |
| TASK-152 | **Client `accept` + format error copy** | XS | M3 | Without HEIC in `accept`, the owner cannot even select their phone images |
| TASK-153 | **LGPL-3.0 licence sign-off + `NOTICE`** (owner-dependent, `RSK-032`) | XS | M3 | A licence decision is the owner's, not an agent's; MIT-compat needs the NOTICE |
| TASK-158 **(new, R7)** | **Server-synthesised pasted filename + `ingestSource` provenance** (`data-model.md` §3.8.1) | S | M3 | A clipboard image has **no name**; three pastes would collide on one meaningless label in an error model that works by naming the file |
| TASK-159 **(new, R7)** | **Desktop document-level `paste` listener — scoped so it does NOT hijack text paste** | M | M3 | The owner's primary interaction on the laptop, at zero permission cost. The editable-element guard is the one genuine tension in the design |
| TASK-160 **(new, R7)** | **"Paste screenshot" BUTTON + `navigator.clipboard.read()` + feature detection** | M | M3 | The **only verified** iOS path for a non-editable page; feature-detected so a browser that cannot paste never shows a button that cannot work |
| TASK-161 **(new, R7)** | **Clipboard rejection states — bounded, re-offered, never a spinner, never auto-retry** | S | M3 | On iOS **rejection is the EXPECTED case**: any stray tap, tab switch or backgrounding silently rejects the promise. A naive implementation looks like a hang (`RSK-033`) |
| TASK-162 **(new, R7)** | **Drag-and-drop + `T-UI-014` all-three-affordances assertion** | S | M3 | The third affordance, and the only place `T-UI-014` can live without closing a dependency cycle (§8.12) |
| TASK-163 **(new, R7)** | **Ingest-source parity integration suite** (`T-PASTE-003/006/007`, `T-RET-014`) | M | M3 | Three entry points, one validator — **divergence in validation is the real and easy defect** ADR-0009 names |
| TASK-164 **(new, R7)** | ⚠ **`T-PASTE-010` — the ADD-NOT-SWAP regression guard** | S | M3 | It exists **solely to fail** if the file-upload journey, HEIC included, is ever displaced by paste. Nothing else in the suite would catch that |
| TASK-165 **(new, R7)** | **MANUAL real-device iOS paste check** (`docs/evaluation/`) — owner-dependent | XS | M3 | The native callout is platform UI outside the page; **CI cannot test it**, and pretending otherwise would be the dishonest option (`testing.md` §10) |
| TASK-011 | **OQ-024 capture-surface check** | XS | M0 | **No longer a gate** (RSK-021 High→Low under ADR-0001 Rev 2); ten owner-minutes that yield real golden fixtures |
| TASK-134 | **Azure OpenAI abuse-monitoring exemption** | XS | M0 | The one genuine privacy regression introduced by ADR-0001 Rev 2 |
| TASK-017/032 | Repository + deterministic fixtures | M/S | M1 | Every later test depends on these |
| TASK-022 | Error envelope + closed error-code enum | S | M1 | Error handling infrastructure, not per-route improvisation |
| TASK-026/046 | **TMDB attribution** | S/XS | M1/M2 | A compliance obligation whose failure is invisible from inside the app |
| TASK-040/125 | Empty, loading, error, and offline states | S/M | M2/M7 | `ux-states.md` §11 checklist |
| TASK-047/097 | Indexes + scale fixtures | S/S | M2/M5 | Query cost must be scale-invariant (**R4:** `LIKE` search not `pg_trgm`) |
| TASK-078/079 | Golden fixtures + metric gates | M/S | M3 | The only objective measure of extraction quality |
| TASK-123/124 | Viewports + accessibility pass | M/S | M7 | SD-12, WCAG 2.1 AA |
| TASK-126/127/128 | Meta gates + coverage + no-egress | M/XS/XS | M7 | Proves the **241**-AC mapping holds ~~232~~ *(R5 figure — see §8.10)* |
| TASK-131 | **Manual export + restore runbook (OQ-025)** | S | M7 | REQ-028 forbids deletion but provides no owner-controlled backup |
| TASK-132 | Errata reconciliation | XS | M7 | Documents currently disagree (see §8) |
| TASK-133 | Runbooks, incident playbook, config checklist | S | M7 | Deployment and environment config |

---

## 6. Deferred (v1.1+)

Deferred at the requirements stage; **not** decomposed here. See `roadmap.md`.

| Item | Traces to | Deferred because | Revisit trigger |
|---|---|---|---|
| Multi-user / sharing | REQ-035 | Single-owner product; adds an authorisation surface with no MVP payoff | A second real user exists |
| Bulk edit of the review pass | REQ-037 | SD-11a confirm-all covers the ergonomic need at MVP volume | Checkpoint 1 shows the review pass is intolerable *and* the cause is per-row editing |
| **Batch undo across later edits** | REQ-059 | Correctness is unresolved | **Reinstating REQ-059 reopens decision D3 and OQ-023.** Do not reinstate without reopening both |
| Additional streaming services (7 more) | REQ-069 | Netflix + Max prove the loop; each service adds a capture-surface unknown | Checkpoint 1 passes and a third service is actually used |
| Owner-controlled backup/export **UI** | OQ-025 | TASK-131 delivers the script and runbook; a UI is not MVP | The owner runs the script more than twice |

---

## 7. Risks to the plan

| Risk | Affected items | Impact | Mitigation |
|---|---|---|---|
| **RSK-017 — owner review capacity (binding constraint)** | All 133 | ~53 h of review is the plan's real cost | No item exceeds M; milestone boundaries are stop points; the value loop lands at M2 so payoff precedes the heaviest review block |
| **RSK-033 (new, R7 — `A45`) — the primary ingest affordance is brittle on the primary device** | TASK-159, **TASK-160, TASK-161**, TASK-164, TASK-165 | Two exposures. **(a) Brittleness (`verified`):** iOS shows its paste callout **per invocation and never remembers it** — one deliberate extra tap per screenshot, forever — and **any stray tap, tab switch or backgrounding SILENTLY REJECTS the promise** with no error dialog, so a naive implementation looks like a hang. **(b) One unverified platform fact:** whether iOS shows a paste callout over **non-editable** content after WebKit PR #38127 could not be established from any primary source. | **(b) is neutralised BY CONSTRUCTION, not by hope** — the design routes around the question instead of betting on it: the **button + `clipboard.read()`** path (TASK-160) is `verified` on iOS 13.4+ *regardless* of the answer, and the desktop `paste` listener (TASK-159) is `verified` on desktop *regardless*. If the answer turns out to be "yes", TASK-160 is merely *redundant on newer iOS* — never wrong. **(a) is handled in the UI, not engineered away** (TASK-161: detect, explain, re-offer; no spinner outlives the promise; no auto-retry). **The structural mitigation is the one that matters: file upload is RETAINED as the floor (TASK-164 guards it), so both exposures degrade to a working universal path rather than to a broken product.** The iOS path is **not CI-testable** — TASK-165 is the honest manual compensating check, and the gap is recorded, not faked |
| **RSK-026 (new) — M3 review concentration** | TASK-048…080 | M3 alone is ~870 min (~28% of total) | M3 is deliberately split into 33 small units; M2 delivers demonstrable value first so the owner enters M3 already convinced |
| **RSK-027 (updated R5; R7) — owner-dependent tasks** | TASK-010, TASK-011, TASK-146, **TASK-153 (R5)**, **TASK-165 (R7)** | The agent cannot complete these alone. | **Reduced by ADR-0001 Rev 2:** TASK-011 no longer gates M3, so a stall costs evidence, not the extraction investment. Both TASK-010 and TASK-011 remain XS and in M0. ~~**R4 added a third owner touchpoint: TASK-146** (mint a ghcr.io fine-grained PAT + expiry reminder — an agent cannot create a credential on the owner's GitHub account).~~ **⚠ R8 REMOVES this owner touchpoint: no PAT is minted at all** — a fine-grained PAT cannot authenticate to `ghcr.io`, and rather than fall back to an account-wide classic token the package is made **public**, so CI pushes with `GITHUB_TOKEN` and ACA pulls anonymously. The only residue is a **one-time package-visibility flip after the first successful push**, which the agent can perform with `gh` and which creates no credential. **⚠ R5 adds a FOURTH owner touchpoint: TASK-153 — approving the LGPL-3.0 licence obligation of the HEIC codec is a legal decision that is not an agent's to make** (the agent prepares the `NOTICE`/THIRD-PARTY text; the owner signs off). TASK-141's M0 smoke migration is NOT owner-dependent (it runs against infra the pipeline provisions), nor are TASK-143/144/145/147/148/149/150/151/152. **⚠ R6 adds NO fifth owner touchpoint** — TASK-154/155/156/157 are all agent-executable (the owner's one decision, `OQ-028`, has already been made; TASK-157's alert simply emails the address TASK-142 already uses). **⚠ R7 DOES add a fifth owner touchpoint: TASK-165** — the real-device iOS paste check needs a physical iPhone, a real clipboard and a human tap, and **no agent can run it**. It is XS (~5 minutes), it is **not** a gate (upload is a complete path, so a stall costs evidence rather than the feature), and it should be batched with the TASK-010/011 verification sprint. TASK-158…164 are all agent-executable. **Orchestrator: carry the TASK-146, TASK-153 AND TASK-165 additions to `session-state.json`.** |
| **RSK-021 — artwork-only capture surfaces** | Epic C | ~~If surfaces are artwork-only, OCR extraction is the wrong approach~~ | **Severity High → Low (ADR-0001 Rev 2).** The primary reader identifies works from poster art; `T-AI-035` gates artwork recall ≥ 0.80. TASK-011 is now evidence-gathering, not a gate |
| **RSK-028 (new) — fabrication by the primary reader** | TASK-056b, 056c, 057, 059b, 079 | A fluent, plausible, wrong title is indistinguishable from a correct one in a review pass | Four layers: the OCR cross-check flag (`T-AI-032`), the tile thumbnail beside every unsupported title (`T-AI-041`), deterministic TMDB matching as a plausibility filter, and a measured fabrication ceiling of 0.05 in CI and in the live suite. **Never mitigated by runtime filtering** (`T-AI-042`) |
| **RSK-022 — TMDB content reaching an AI service** | TASK-060, 062 | Licensing and determinism | Structural: eslint import ban + network-shaped test **now covering both inference hosts**, not a code-review convention. Scope clarified: the rule binds TMDB content, not screenshot pixels (ADR-0001 R2.4) |
| **RSK-029 (R3; R4 updated) — unverified cost model, now on REAL money** | TASK-010, TASK-142 | **R4 (A40):** the selected Variant A design costs ~**$11–14/month** (was ~$30 under the R3 PostgreSQL design) on figures recalled from model knowledge with **no web verification** (±30%; the ACA always-on idle rate at 0.25/0.5 and whether Azure SQL Basic is still ~$5 are the least certain). Still real money vs Rev 2's ~$0.65. | `TASK-010` verifies every line against the **Variant A** SKUs; `TASK-142` sets a budget alert at 1.5×; `architecture.md` §Cost summary keeps the **richer variant (~$30)** and **Variant B (~$0.65)** documented so the owner can move deliberately |
| **RSK-024 — free-tier dependence** | — | **NARROWED (R3, still narrowed R4).** Only one free tier remains in the design: **Azure AI Vision F0**. **R4 adds ghcr.io ($0) for the registry** — free but a quiet-expiry PAT (see RSK-031/TASK-146), not a managed identity. The Cosmos free tier is gone; the invariant-enforcement half of the old RSK-024 stays closed by the relational store. | `TASK-010` confirms F0 and ghcr availability; ADR-0001 Rev 2 specifies the Vision fallback |
| **RSK-030 (R3; R4 widened) — datastore change churn** | TASK-143 | Cosmos → PostgreSQL (R3) then **PostgreSQL → Azure SQL (R4)** each superseded parts of `specs/data-model.md`, `api.md`, `testing.md`, `security.md`, `specs.md` and the store/registry-naming diagrams. An implementer reading a superseded section without its banner builds the wrong thing. | Every superseded section carries an explicit banner; `TASK-143` (widened in R4) is the sweep that verifies it; **`specs/data-model.md` §16 is now authoritative** (§15 PostgreSQL retained as superseded) |
| **RSK-031 (new, R4) — Prisma + SQL Server is a less-travelled path** | TASK-017, TASK-141, TASK-146 | Prisma + PostgreSQL is the most-documented ORM path for an autonomous coding agent (NFR-004); **Prisma + Azure SQL / `sqlserver` provider is less so**, especially for managed-identity auth. A less-travelled path means more agent trial-and-error and higher chance of a silent wrong turn. The ghcr.io PAT (registry give-up) is a related quiet-expiry credential. | **Prisma STANDS** (argued in ADR-0005 Rev 3): `sqlserver` provider is GA; SQL-Server-specific DDL (filtered indexes, CHECK, ISJSON, BIN2 collation) lives in **raw migration SQL** off Prisma's thinner modeling path. **M0 smoke migration** (TASK-141) proves the auth+migration path before feature work; **KV-password fallback** if MI auth is unreliable; **ghcr PAT runbook** (TASK-146) makes the expiry diagnosable |
| **RSK-032 (new, R5) — HEIC dependency + LGPL-3.0 licence obligation** | TASK-147, TASK-149, TASK-153 | The HEIC fix introduces a new decode dependency (`heic-convert` → `libheif-js`, **LGPL-3.0**, decode-only). Two exposures: (a) a licence obligation on an MIT repo — weak copyleft, satisfied by retaining the NOTICE and keeping the codec replaceable and unmodified, but the sign-off is the **owner's**; (b) a transitive-dependency risk that a GPL `x265` *encoder* creeps in. | **(a)** TASK-153 puts the LGPL sign-off + `NOTICE` to the owner (owner-dependent, RSK-027). **(b)** TASK-147 pins decode-only and the `check-deps.mjs` allow-list rejects any `x265`/HEIC-encoder transitive. `libheif-js` is pure JS/WASM (no native build), so no container-toolchain risk. **OQ-027** (retain vs discard the original HEIC after verified transcode; default = discard) is raised in `architecture.md`, not decided here. |
| **RSK-016 (re-elevated R4; carried R5; ⚠ R6 — now an OWNER-ACCEPTED RESIDUAL RISK, not an open one)** | TASK-145, TASK-149, **TASK-154, TASK-155, TASK-156, TASK-157, TASK-008, TASK-006** | The 0.25 vCPU / **0.5 GiB** compute plus HEIC decode makes OOM a live risk: a legal ~10 MiB HEIC can be ~40–48 MP and decode to ~160–195 MB raw RGBA, up to ~⅔ GiB with the WASM copy + PNG encode buffer — enough to OOM the container. **The owner was shown this priced and chose it anyway (`A43` / `OQ-028`, verbatim: *"Start at 0.5 GiB, up-size only if it OOMs."*).** The residual impact — **48 MP captures are refused at 0.5 GiB, and a real OOM costs one import attempt plus a manual up-size** — is knowingly accepted. | **Status: OWNER-ACCEPTED RESIDUAL. Because the strategy is REACTIVE, the mitigations are MANDATORY acceptance criteria, not optional hardening — they are the entire reason the reactive choice is survivable.** Five, all in the plan: **`A43-M1`** pre-decode **PIXEL** guard before any allocation (TASK-145 / TASK-149); **`A43-M2`** one-image blast radius, no partial commit, retryable after up-size (TASK-154); **`A43-M3`** an error that names memory and points at the remedy (TASK-155); **`A43-M4`** the runbook in the repo (TASK-156); **`A43-M5`** the alert + sentinel so the trigger is observed, not inferred (TASK-157). The up-size to **0.5 vCPU / 1.0 GiB (+~$4/mo)** is **PRE-AUTHORISED and trigger-gated** — apply it only on a real OOM, via `docs/runbooks/scale-up-memory.md`, moving `NEXTUP_MAX_DECODE_PIXELS` **with** it (TASK-008 enforces the pair). <br> ~~**⚠ CONDITIONAL / FLAGGED, NOT BAKED IN:** the priced remedy is 0.5 vCPU / 1.0 GiB (+~$4/mo). That is a cost change and therefore the owner's decision — **it is being put to them** and is NOT applied to TASK-006 or the cost model here. If the owner approves it, TASK-006 compute reverts to 1.0 GiB.~~ *(R4/R5 text — **superseded and now factually wrong**: the question was put and ANSWERED. TASK-006 compute does **not** revert; 0.25/0.5 is the confirmed as-designed size and 1.0 GiB is a reactive remedy, not a pending approval.)* |
| **Agent error compounding on large tasks** | The 35 M-sized items | A failed M wastes ~40 min of review | M is the hard ceiling; no L or XL exists in this backlog |
| **Test-ID attribution inconsistency for RSK-022** | TASK-062, TASK-126 | `testing.md` §6 cites `T-AI-012/013`, other documents cite `T-SEC-011` for the same rule | TASK-126 (`T-META-001`) forces reconciliation; TASK-062 implements all three |

---

## 8. Contradictions found while planning

Recorded rather than silently resolved.

1. **US-028 AC-6 → AC-6′.** Phase 8 amended US-028 (AC-6′, and a new AC-7 for the
   SD-06 suppression migration). AC-7 originates in the spec and has **no
   corresponding PRD acceptance criterion**. → TASK-132 (record), TASK-104 /
   TASK-110 (implement).
2. **"62 requirements in v1" is wrong.** `Context/requirements.md` §1.8 and
   `Context/mvp-definition.md` §18 both carry the headline "62 in v1"; with
   REQ-035, REQ-037, REQ-059 and REQ-069 deferred, the correct count is **59**.
   → TASK-132.
3. **ADR-0007 status drift.** `architecture.md` records ADR-0007 as `Proposed`;
   phase 8 moved it to `Accepted (as amended)`. → TASK-132.
4. **RSK-022 test-ID attribution is inconsistent across documents** (see §7).
   → TASK-062 + TASK-126.
5. **(R6, FIXED IN PLACE) The OOM guard was specified as a BYTE guard.** TASK-145
   (R4) and ADR-0008 R1 both specified a per-image **byte** ceiling as the
   pre-decode OOM protection. That is **wrong, not merely imprecise**: HEIC's
   compression ratio is variable, so a 6 MiB file can be 48 MP and a byte guard
   passes exactly the file that kills the container. Corrected **in place** on
   TASK-145 and TASK-149 to a **pixel guard** (`NEXTUP_MAX_DECODE_PIXELS`), with
   the byte ceiling demoted to a first cheap filter. The wrong instruction is
   struck through beneath the right one, never left live (**the F-001 lesson**).
6. **(R6, FIXED IN PLACE) The RSK-016 row said the up-size decision "is being put
   to the owner" and that "TASK-006 compute reverts to 1.0 GiB" if approved.**
   Both statements became false the moment `OQ-028` was answered: the decision
   was made, and it was to **stay** at 0.5 GiB. Left live, that row would have
   told an implementer to await a decision that had already been taken, or to
   revert TASK-006 on approval that will never come in that form. Rewritten in
   §7; the superseded text is struck through beneath it.
7. **(R6, GAP FOUND IN AN INPUT — closed by TASK-156)** `artifacts/runbooks/
   scale-up-memory.md` tells the operator to change the container size and
   `NEXTUP_MAX_DECODE_PIXELS`, but **never tells them to raise the
   `nextup-prod-memory-pressure` alert threshold from 400 MiB to 800 MiB** —
   `architecture.md` §Observability names this as a gap. After an up-size the
   leading indicator would fire permanently and be muted, destroying the one
   signal that gives advance warning. TASK-156 must close it, not copy it.
8. **(R6, CIRCULAR DEPENDENCY AVOIDED)** The obvious edge "TASK-154 depends on
   TASK-072" (because the no-partial-commit guarantee lives in the transactional
   close) closes the cycle **058 → 154 → 072 → 071 → 065 → 058**. It was **not
   added**: the guarantee is *structural*, so TASK-154 asserts it at
   ingest/extraction level and needs no edge to the close. Recorded here because
   the A42 pass introduced a cycle of exactly this shape.
9. **(R6, MILESTONE CORRECTED IN PLACE) TASK-145 was labelled M1 but depends on
   TASK-033, which is M2.** A milestone label is an instruction about ordering,
   so it was corrected to **M2** in §5 rather than banner-noted. It still lands
   before TASK-149 (M3), so no sequencing property changes.
10. **(R7, COUNT DRIFT FOUND AND FIXED IN PLACE — the fourth occurrence) This
   backlog said "232 acceptance criteria"; the true figure was 236 before A45
   and is 242 after it.** `232` was the R5 (A42/HEIC) figure and was never
   updated when A43 added US-004 AC-9/AC-10/AC-11. The orchestrator reconciled
   the number to **236** in `specs/testing.md` at R6; the PRD then added **six**
   more at A45 (US-004 AC-12…AC-17), giving **236 + 6 = 242**. An AC count is an
   *instruction* to `T-META-001` about how many mappings must exist, so it was
   corrected **in place** in TASK-126, §5 and §9, with the wrong figure struck
   through. ⚠ **`specs/testing.md` still states 236 in four places and says so
   deliberately** — it was written in parallel and could not see the PRD's six.

    > **(R9/`A46`) Superseded — the live figure is now `241`, and the
    > `testing.md` caveat above is spent.** A46 deleted **US-022 AC-2** along
    > with the staleness-nudge concept, taking **242 − 1 = 241**.
    > `specs/testing.md` was reconciled to **241** in the same pass, so it no
    > longer lags the PRD. **This is the fifth AC-count drift.** The count is an
    > *instruction* to `T-META-001` about how many mappings must exist, which is
    > why it is corrected in place every time rather than annotated — and why
    > `T-META-001`, not any headline number in prose, is the actual safety net.
   **That is the orchestrator's reconciliation to make, not this document's**;
   the discrepancy is reported here rather than silently "fixed" in a file this
   role does not own. (Findings **F-003**, the A42 pass and the A43 232/230/236
   drift were all this same class of error, which is why the arithmetic in §1.1
   is now shown explicitly on every branch.)
11. **(R7, CORRECTED IN PLACE) The US-004 story heading said "Attach
   screenshots".** The PRD renamed the story at A45 (**ID unchanged**) to *"Add
   multiple screenshots to one batch — by paste, by file upload, or by
   drag-and-drop"*, because the old title named only one of three input paths.
   A heading that mis-describes the story's scope is an instruction an agent
   reads before it reads anything else, so it was corrected in place in §4 with
   the old wording struck through — not banner-noted.
12. **(R7, CIRCULAR DEPENDENCY FOUND AND AVOIDED — the second of this shape)**
   The obvious placement for **`T-UI-014`** ("the paste button, the file input
   and the drop target are all present, labelled and keyboard-reachable") is
   **TASK-053**, which owns `ImageDropzone.tsx`. That closes the cycle
   **053 → 162 → 053** (and equally 053 → 159/160 → 053), because all three
   affordance tasks depend on 053 for the shared submit path and the layout
   slots. `T-UI-014` is therefore owned by **TASK-162**, the last affordance to
   land, and TASK-053's row says so explicitly so a future editor does not
   "tidy" it back. The A42 pass and the R6 pass each introduced a cycle of
   exactly this shape; this is the third time the pattern has been caught, and
   the pattern is always the same — *a cross-cutting assertion placed on the
   foundational task instead of the last dependant.*
13. **(R7, THE INSTRUCTION THAT WAS WRONG EVERYWHERE — corrected, not
   annotated)** Every pre-A45 task that described ingestion described it as
   **file upload only** (TASK-050's multipart contract, TASK-053's "dropzone +
   file input + camera-roll picker", TASK-149's unconditional transcode, and the
   US-004 heading). That was an **agent-derived default that was never checked
   with the owner** — the same failure shape as ASM-034 at A42. All four are
   corrected **in place** with the superseded text struck through beneath the
   live text. ⚠ **The correction is an ADD: nothing about the file-upload path
   was removed, narrowed or deprecated**, and `TASK-164`/`T-PASTE-010` exists to
   fail if a later change makes it so.
14. **(R7, A TRAP THAT LOOKS LIKE A SIMPLIFICATION — recorded so nobody
   "optimises" it back)** Two invitations to write wrong code arise from A45,
   and both would look like tidying: **(a)** keying the HEIC transcode on
   `ingestSource` (`if (source === 'paste') skipTranscode()`) instead of on the
   sniffed `uploadedFormat` — it makes a security-relevant decision from
   untrusted client input, and `T-IMG-023` asserts a **HEIC sent with
   `ingestSource: 'paste'` is transcoded anyway**; **(b)** deleting the EXIF
   strip because "pasted screenshots have no EXIF" — WebKit strips EXIF on
   clipboard read but **not** on file upload, so that deletes the control from
   the only route that needs it, and `T-SEC-033` asserts the HEIC-upload-with-
   GPS case a paste can never exercise. Both are written into TASK-149 and
   TASK-150 as prohibitions, not preferences.

---

## 9. Traceability

All 39 stories are covered. No story resisted decomposition.

| Story | Tasks | Milestone(s) |
|---|---|---|
| US-001 | 018, 019, 021, 027, 028, 031 | M1 |
| US-002 | 012, 017, 020, 023, 029 | M1 |
| US-003 | 048, 049 | M3 |
| US-004 | 050, 051, 052, 053, 063, 147, 148, 149, 150, 151, 152, **154, 155**, **158, 159, 160, 161, 162, 163, 165** *(R7 — `A45` AC-12…AC-17)* | M3 |
| US-005 | 013, 054, 072, 073 | M1, M3 |
| US-006 | 011, 055, 056, 057, 058, 059, 067, 077 | M0, M3 |
| US-007 | 045, 060, 061, 062 | M2, M3 |
| US-008 | 068 | M3 |
| US-009 | 064 | M3 |
| US-010 | 043 | M2 |
| US-011 | 024, 026, 046 | M1, M2 |
| US-012 | 065, 066, 069, 070, 071 | M3 |
| US-013 | 081, 082, 092, 093, 129 | M4, M7 |
| US-014 | 083, 084 | M4 |
| US-015 | 085, 086, 087 | M4 |
| US-016 | 088 | M4 |
| US-017 | 090, 091 | M4 |
| US-018 | 033, 034, 038, 040 | M2 |
| US-019 | 037, 039 | M2 |
| US-020 | 016, 036, 166 | M1, M2 |
| US-021 | 035 | M2 |
| US-022 | 041, 042 | M2 |
| US-023 | 008, 089, 131 | M0, M4, M7 |
| US-024 | 047, 095, 096, 097 | M2, M5 |
| US-025 | 098, 099 | M5 |
| US-026 | 100 | M5 |
| US-027 | 101, 102 | M5 |
| US-028 | 015, 103, 104, 105 | M1, M5 |
| US-029 | 106, 107 | M5 |
| US-030 | 109, 110, 111 | M6 |
| US-031 | 074, 075, 076 | **M3 (early)** |
| US-032 | 112, 113 | M6 |
| US-033 | 114, 115, 116 | M6 |
| US-034 | 117 | M6 |
| US-035 | 014, 118, 119, 120 | M1, M6 |
| US-036 | 004, 044, 121, 153 | M0, M2, M7, M3 |
| US-037 | 025, 123, 124, 125 | M1, M7 |
| US-038 | 030, 122 | M1, M7 |
| US-039 | 001, 002, 003, 005, 006, 007, 009, 010, 022, 032, 078, 079, 080, 094, 108, 126, 127, 128, 130, 132, 133, **141, 142, 143, 144, 145, 146** *(R3/R4 units — omitted from this row by oversight before R6; each row above already states `US-039`)*, **156, 157**, **164** *(R7 — the add-not-swap E2E guard)* | all |

**Uncovered requirements:** none. All 59 v1 functional requirements and all
**241** acceptance criteria are reachable ~~232~~ *(R5 figure — the true count
was 236 after A43 and 242 after A45's US-004 AC-12…AC-17, and is **241** after
A46 deleted US-022 AC-2 with the staleness nudge; see §8.10)*;
`T-META-001` (TASK-126) is the machine gate
that proves it, and the **12** non-machine-verifiable ACs enumerated in
`testing.md` §10 are the only permitted exceptions ~~11~~ *(the twelfth is the
iOS-Safari clipboard-paste interaction, added at A45, whose compensating manual
device check is owned by **TASK-165**)*.

**A45 test coverage, task by task** — so no new test ID is orphaned:

| Test | Owning task |
|---|---|
| `T-PASTE-001` desktop `paste` listener, editable-element-safe, unmounts | **TASK-159** |
| `T-PASTE-002` iOS button calls `read()` inside the click handler; pre-batch paste held | **TASK-160** |
| `T-PASTE-003` successive pastes APPEND to the one open batch | **TASK-050** (contract) + **TASK-163** (suite) |
| `T-PASTE-004` drag-and-drop | **TASK-162** |
| `T-PASTE-005` synthesised name + `ingestSource` provenance | **TASK-158** |
| `T-PASTE-006` the sniff still rules on pasted bytes | **TASK-163** |
| `T-PASTE-007` ceilings, pixel guard and retention identical for pastes | **TASK-163** |
| `T-PASTE-008` every clipboard failure renders **and re-offers**; no surviving spinner | **TASK-161** |
| `T-PASTE-009` no clipboard API → button not rendered; upload unaffected | **TASK-160** |
| **`T-PASTE-010` the ADD-NOT-SWAP regression guard** | **TASK-164** |
| `T-IMG-023` transcode conditional on the **sniffed** format, and still present | **TASK-149** |
| `T-UI-014` all three affordances present, labelled, keyboard-reachable | **TASK-162** (see §8.12) |
| `T-SEC-033` the upload path's EXIF strip is not weakened | **TASK-150** (fixture from **TASK-151**) |
| `T-RET-014` 30-day retention identical for a pasted image | **TASK-163** |
| *(manual)* iOS Safari callout, end to end | **TASK-165** — `testing.md` §10 |

**The 11 non-negotiable core tests** (`testing.md` §6) and their owning tasks:

| Core test | Task |
|---|---|
| `T-SEC-002` cross-owner → 404 | TASK-029 |
| `T-SEC-010` allow-list fail-closed | TASK-019 |
| `T-REV-006` full-update shows all extracted titles | **TASK-081** |
| `T-REV-005` removals require explicit confirmation | TASK-086 |
| `T-SUP-003` suppression keyed on `workIdentity` | **TASK-103** |
| `T-REM-006` removed view never de-duplicated | TASK-095 |
| `T-INV-012` no hard delete | TASK-089 |
| `T-INV-013` no TTL anywhere | TASK-008 |
| `T-CI-005` no scheduler anywhere | TASK-044 |
| `T-ATTR-001` TMDB attribution verbatim | TASK-026 |
| `T-AI-012` / `T-AI-013` no TMDB content to any AI service | TASK-062 |

**`T-E2E-001`** (upload → extract → match → review → reconcile → suppress →
removed view → attribution → a11y → 320 px) is a **first-class staged
deliverable**, not an afterthought: TASK-080 (steps 1–4), TASK-094 (step 5),
TASK-108 (steps 6–7), TASK-130 (steps 8–10).
