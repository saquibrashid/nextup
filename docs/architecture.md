---
createdAt: 2026-08-10T19:23:46-04:00
createdBy: solution-architect
phase: 7
revisedAt: 2026-08-11T13:15:00-04:00
revisedBy: solution-architect
revision: 8
status: complete
sourceOfTruth: artifacts/PRD.md, Context/requirements.md, Context/mvp-definition.md §17–§18
---

# Architecture — nextup

> ### ⚠ REVISION 8 — 2026-08-11T13:15 — `A46`: the list/service staleness nudge (REQ-040) is dropped entirely from v1.
>
> The owner's decision, verbatim: *"Drop the concept entirely — no
> staleness nudge."* `REQ-040` and its `LIST_STALENESS_DAYS = 30` constant
> are retired; `ASM-038` is retired. **This does not touch REQ-039** (the
> per-service last-completed-batch date shown by `serviceState` /
> `GET /api/service-state`), `NFR-014` (183-day TMDB metadata lazy
> refresh), or `NFR-019` (30-day screenshot retention purge) — all three
> survive unchanged. The surviving "never unify" rule now governs **two**
> constants, not three.

> ### ⚠ REVISION 7 — 2026-08-11T11:50 — `A45`: clipboard paste becomes the PRIMARY ingest affordance. File upload is RETAINED. This is an ADD, not a swap.
>
> **The owner corrected the expected capture interaction, verbatim:**
>
> > *"Also for screenshots, I'm generally expecting that I will take a
> > screen grab and paste it into the app directly rather than saving it to
> > my device first and then uploading it to the app."* (`A45`)
>
> Everything specified up to Revision 6 assumed **one** ingest affordance,
> `<input type="file">`. That was an agent-derived default, never tested
> against the owner — the same failure shape as the falsified `ASM-034`.
> **Any text in this file, or in any diagram, stating or implying that
> ingestion is file-upload-only is now WRONG and has been corrected in
> place, not annotated** (the F-001 rule; see below).
>
> ⚠ **FILE UPLOAD IS NOT REMOVED AND IS NOT DEGRADED.** Two live capture
> paths cannot be served by the clipboard at all: **the laptop
> save-then-upload path**, and **the iOS Photos path** (iOS screenshots
> auto-save to Photos and reach the clipboard only if the owner taps "Copy"
> on the transient preview; iOS *camera photos* default to HEIC and are
> never on the clipboard). **Upload is the floor.** Paste is an accelerant
> — ~3 taps against ~4 — not a replacement.
>
> **Platform facts are taken from `Context/evidence/clipboard-paste-support.md`
> (primary-source, retrieved 2026-08-11) and are AUTHORITATIVE. They are
> not re-derived here.** The five that shape the design:
>
> | # | Verified fact | Design consequence |
> |---|---|---|
> | 1 | **iOS Safari CAN paste an image — but not via a document-level `paste` listener.** The verified path is a **visible "Paste screenshot" BUTTON** whose click handler calls `navigator.clipboard.read()` (Safari 13.1 ⇒ **iOS 13.4+**, `image/png`). WebKit itself then shows a native single-option paste callout. | The iOS affordance is a **button**, not a gesture. A hidden `contenteditable` trap is **prohibited**. |
> | 2 | **Desktop browsers want the OPPOSITE primitive**: the `paste` event (Ctrl/Cmd+V), with **no prompt**, in all four browsers. `clipboard.read()` is *worse* on desktop (Firefox only got it in 127, and it prompts). | **BUILD BOTH.** One document-level `paste` listener **and** one button. |
> | 3 | **A pasted screenshot is ALWAYS `image/png`.** WebKit exposes exactly four clipboard representations; **HEIC cannot arrive by the paste path.** | **ADR-0008's transcode becomes CONDITIONAL on the sniffed type** — transcode **iff** sniffed HEIC/HEIF. ⚠ **NOT deleted** — the Photos upload path still delivers raw HEIC. |
> | 4 | ⚠ **TRAP: WebKit strips EXIF on clipboard read but NOT on file upload.** | **`REQ-078`'s explicit, tested metadata-strip STAYS on the upload path.** The paste path's free stripping covers **one of three** affordances and must never be read as making the control global. `T-SEC-032` asserted against a *pasted* image would pass **vacuously**. |
> | 5 | **HTTPS is mandatory** — `navigator.clipboard` is **absent** on `http://`. **Web Share Target is RULED OUT** on iOS (MDN BCD `safari`/`safari_ios` = `false`; WebKit bug 194593 still **NEW** after seven years). | Prod is fine (ACA managed cert). **Local-network phone testing over `http://<LAN-IP>` shows no paste button at all** — corrected in place in §Environments. **Do not design around the iOS Share Sheet.** |
>
> **iOS paste is brittle, and that is accepted, not hidden.** The callout is
> **per-invocation and never remembered** — one extra deliberate tap per
> screenshot, forever — and any stray tap, tab switch or backgrounding
> **silently rejects the promise**. The UI must detect rejection and
> **re-offer**, never hang. `RSK-033`, below.
>
> **Cost and architecture impact: small and FAVOURABLE, stated explicitly
> rather than left silent.** **No Azure line item changes; the direct cost
> delta is $0.** The favourable part is memory, not money: every screenshot
> arriving by paste is a PNG that **skips the WASM HEIC decode entirely** —
> the app's largest allocation and the direct driver of `RSK-016`. Fewer
> bytes are transcoded, so the OOM risk is **exercised less often**.
> ⚠ **Frequency is not severity: `RSK-016` stays Medium and owner-accepted,
> compute stays 0.25 vCPU / 0.5 GiB, `NEXTUP_MAX_DECODE_PIXELS` stays
> `25000000`, and `A43-M1`…`M5` stay MANDATORY.** One 48 MP HEIC from
> Photos still exercises every one of them. **Nothing in `A43` is relaxed
> by this revision.**
>
> **New ADR: [ADR-0009](adr/ADR-0009-dual-primitive-clipboard-ingest.md)** —
> dual-primitive clipboard ingest with upload retained. It is in the ADR
> index below. **ADR-0008 → Revision 3** (conditional-on-sniffed-type;
> neither weakened nor removed).
>
> **Per-section supersession manifest (R7):**
>
> | Section | R7 change | Kind |
> |---|---|---|
> | §Architecture at a glance | **Corrected IN PLACE** — "the owner uploads screenshots" was a live wrong statement of the primary interaction. | **Instruction** |
> | §Containers — Web UI row | **Corrected IN PLACE.** The UI now carries **three** ingest affordances (paste listener, paste button, file input). | **Instruction** |
> | §Containers — API + Domain row | **Corrected IN PLACE.** Transcode is **conditional on sniffed type**; one ingest entry point serves all three affordances. | **Instruction** |
> | §Technology selections — image-ingest row | **Corrected IN PLACE**; new **ingest affordances** row added. | **Instruction** |
> | §Key flows — *Ingest transcode* | **Renamed and rewritten**: *Ingest — three affordances, one pipeline*. Carries the sniff-branch rule and the EXIF trap. | **Instruction** |
> | §Security architecture — data classification, screenshots row | **Corrected IN PLACE** with the EXIF asymmetry. | **Instruction** |
> | §Environments and deployment | **Corrected IN PLACE**: the paste path cannot be tested over `http://<LAN-IP>`. | **Instruction** (test procedure) |
> | §Observability | New `source` attribute on the decode sentinel. | Instruction |
> | §Cost summary | **New note**: $0 delta, favourable memory effect, nothing in `A43` relaxed. | Rationale |
> | §Where this breaks | **New row**: clipboard unavailable / iOS < 13.4 / non-secure context. | Rationale |
> | §Deliberately deferred | **New row**: Web Share Target — **ruled out, NOT deferred**. | Rationale |
> | §Risks | **New `RSK-033`** (iOS paste brittleness + the unverified callout question). A matching assumption entry is **owed to `Context/assumptions.md`** (owned by another agent — named, not written). | Rationale |
> | §ADR table | **ADR-0008 → Rev 3; ADR-0009 ADDED.** | **Instruction** |
> | §Handover to `spec-writer` | **New R7 addendum** — six obligations. | Instruction |
> | Diagrams: `container-diagram`, `ai-pipeline`, `sequence-append-only-upload`, `sequence-full-update-batch` | **Redrawn**: two ingest affordances converging on one pipeline; conditional transcode. | **Instruction** (implementers copy diagram content) |
>
> **The F-001 rule applied to this revision.** Supersede-by-banner is used
> only for **rationale**. Every place the text was an **instruction a
> machine executes top-to-bottom** — the ingest affordance list, the
> transcode branch condition, the metadata-strip scope, the diagram
> content, the local-testing procedure — is **corrected in place**, with
> the superseded version struck through beneath it. **There is no live
> "upload is the only way in" instruction left anywhere in this file or in
> the diagrams.**
>
> **The residual uncertainty, recorded rather than smoothed over.** The
> researcher **could not verify** whether iOS shows a paste callout over
> **non-editable** content after WebKit PR #38127 (merged 2025-01-07; bug
> 75891 closed 2026-03-13). No primary source was found either way. **The
> design routes around the question rather than betting on it**: the
> button + `clipboard.read()` path is `verified` to work regardless.
> `RSK-033`, and an assumption entry owed to `Context/assumptions.md`.
>
> **Not reopened:** ADR-0001 (the extractor), ADR-0003 (compute size and
> the `A43` reactive strategy), ADR-0005 (Azure SQL Basic), ADR-0006,
> ADR-0008's Option A library choice and its `A43` containment, Variant A,
> `minReplicas = 1`. All Azure figures remain unverified ±30 % (`RSK-029`).

> ### ⚠ REVISION 6 — 2026-08-11T10:50 — `OQ-028` is CLOSED: the owner chose to **start at 0.5 GiB and up-size only if it OOMs**
>
> Revision 5 *surfaced* the HEIC-transcode memory question and explicitly
> refused to decide it, because it was a cost change. **The owner has now
> decided it, verbatim: _"Start at 0.5 GiB, up-size only if it OOMs."_
> (`A43`).**
>
> **`OQ-028` is CLOSED. The as-designed compute size STAYS
> 0.25 vCPU / 0.5 GiB.** The up-size to **0.5 vCPU / 1.0 GiB
> (+~$4/month → ~$15–18/month total)** is now the **documented, priced,
> pre-authorised remedy** — taken **reactively**, only when a real OOM
> occurs. It is **not** a rejected alternative and must never again be
> written as one.
>
> **The owner was told plainly that this failure can land mid-import, and
> accepted that.** So **`RSK-016` changes character, not severity: it is
> now an OWNER-ACCEPTED RESIDUAL RISK, not an open one.** The corollary is
> the important part and it is not optional:
>
> > **Because the strategy is "wait for it to break", the mitigations are
> > what make it survivable. They are MANDATORY, and they are acceptance
> > criteria, not advice.** A reactive strategy without a guard, without
> > blast-radius containment, without a self-explaining error and without
> > an observable signal is not a strategy — it is an unmonitored bet.
>
> **The five mandatory mechanisms (`A43-M1`…`A43-M5`):**
>
> | # | Mechanism | Why it is load-bearing | Where specified |
> |---|---|---|---|
> | **A43-M1** | **Pre-decode dimension/pixel guard.** Parse the HEIF `ispe` box (and the PNG/JPEG header) for width × height and **reject above `NEXTUP_MAX_DECODE_PIXELS` BEFORE allocating any decode buffer.** Default **25 MP at 0.5 GiB**, **50 MP at 1.0 GiB**. | **Explicitly retained by the owner even though the "mitigate and stay" option was not the one selected** — it is the thing that converts an unbounded crash into a bounded, explained refusal. Without it, "reactive" means "the container dies first and tells you nothing". | ADR-0008 R2.1; guard value moves **with** the memory size — runbook §2 |
> | **A43-M2** | **Failure is isolated to ONE image.** A guard rejection, a decode failure or an OOM fails **that image only**; the batch is never partially committed and never corrupted; every other image in the batch survives. | The owner must be able to up-size and retry **just the affected image**. Reconciled explicitly against `REQ-074` and the transactional full-update guarantee below. | §Key flows → *Ingest transcode*; ADR-0008 R2.2 |
> | **A43-M3** | **The surfaced error names memory/decode as the cause and points at the one-line remedy** (`IMAGE_TOO_LARGE_TO_DECODE` / `IMAGE_DECODE_OOM`, each citing `runbooks/scale-up-memory.md`). | **No blind debugging.** The `RSK-016` complaint was never "it runs out of memory", it was "the failure is undiagnosable". A named cause plus a named remedy is what removes that property. | ADR-0008 R2.3 (exact message text) |
> | **A43-M4** | **`artifacts/runbooks/scale-up-memory.md`** — the exact `az` command, the exact `infra/aca.bicep` change, confirmation, cost delta and rollback, executable in one step. | The person running it has just had an import die. It must not require thought. | **NEW FILE**, this revision |
> | **A43-M5** | **An OOM/restart alert and log signal**, so the event is **observed, not inferred.** | Otherwise the "if it OOMs" trigger never fires — the owner just experiences a flaky app. | §Observability, new subsection *"Knowing that it OOMed"* |
>
> ⚠ **Honest limitation on A43-M5, stated rather than papered over:**
> **Azure Container Apps does not surface OOM-kill as a distinct,
> queryable reason code** the way Kubernetes' `reason: OOMKilled` does.
> There is no `OOMKilled` metric and no documented termination-reason
> dimension. **No such metric is invented here.** The design uses the
> closest reliable proxies — **replica restart count**, **memory working
> set approaching the limit**, **system/console logs**, and an
> **application-emitted decode begin/end sentinel that names the image** —
> and the sentinel, not the platform, is what identifies *which* image
> died. Details, confidence and the verification owed: §Observability.
>
> **Per-section supersession manifest (R6):**
>
> | Section | R6 change | Kind |
> |---|---|---|
> | §Cost summary — Variant A compute row | **Corrected IN PLACE.** 0.25/0.5 is the **as-designed, owner-confirmed** size; 1.0 GiB named as the **documented remedy** with its price. | **Instruction** (sizing table) |
> | §Cost summary — the R5 "memory question the owner must see" note | Replaced by an R6 *decided* note; the R5 *surfaced-not-decided* text is retained **struck through** beneath it. | Rationale |
> | §Cost summary — richer-variant compute row | Annotated: its 0.5/1.0 GiB line is **also the remedy target**, not only history. | Instruction |
> | §Technology selections — hosting/compute row | **Corrected IN PLACE** with the remedy path and the guard env var. | Instruction |
> | §Key flows — *Ingest transcode* | Rewritten to carry A43-M1/M2/M3 and the `REQ-074` ⇄ transactional-commit reconciliation. | Instruction |
> | §Observability | **New subsection** *Knowing that it OOMed* (A43-M5), plus a new signal row. | Instruction |
> | §Where this breaks — the HEIC-OOM row | **Corrected IN PLACE**: mitigations mandatory, remedy pre-authorised, runbook linked. | Instruction |
> | §Risks — `RSK-016` | Re-framed as **owner-accepted residual**, mitigations mandatory. | Rationale + status |
> | §Deliberately deferred | **New row:** the up-size itself is not "deferred", it is **pre-authorised and trigger-gated**. | Rationale |
> | §ADR table — ADR-0003, ADR-0008 | Updated to Rev 4 / Rev 2. | Instruction |
> | R4 banner, "1.0 GiB extraction headroom" give-up row | Annotated **in place** — it is no longer a rejected variant. | Rationale |
>
> **The F-001 rule applied to this revision.** Supersede-by-banner is used
> only for **rationale and narrative**. Every place the text is an
> **instruction a machine executes top-to-bottom** — the sizing table
> rows, the Bicep parameter values, the `az` command, the guard env var,
> the alert condition — is **corrected in place**, with the superseded
> version struck through immediately beneath it. **There is no live wrong
> instruction anywhere in this file or in the runbook.**
>
> **Not reopened:** ADR-0001 (the extractor), ADR-0005 (Azure SQL Basic),
> ADR-0008's Option A library choice, `minReplicas = 1`, and the Variant A
> selection all stand. `NFR-012a` is untouched — this bounds memory, not
> model choice. All Azure figures remain unverified ±30 % (`RSK-029`).

> ### ⚠ REVISION 5 — 2026-08-11T10:05 — a falsified assumption added a new ingest stage: HEIC transcode
>
> **`ASM-034` ("accepted upload formats are PNG and JPEG only") was an
> agent-derived inference, never owner-confirmed, and it is FALSIFIED.**
> The owner stated verbatim *"iOS screenshots save as heic."* **`ASM-058`
> supersedes it: ingest accepts PNG *and* JPEG *and* HEIC/HEIF** — all
> three, because iOS delivers all three and **which one is NOT predictable
> from the capture path**. ⚠ This wording previously read *"screenshots
> normally PNG, camera photos default HEIC"*; that map was **falsified at
> TASK-151** — the owner's own iOS screenshot is **JPEG**. The conclusion is
> unchanged and strengthened: accept all three, and classify by **magic bytes
> only**, never by the declared `Content-Type` and never by the ingest source.
> **PNG is not swapped out.**
>
> **Why this is a new architectural stage, not a footnote.** Neither
> extraction service accepts HEIC/HEIF (Azure OpenAI vision:
> PNG/JPEG/WEBP/non-animated GIF; Azure AI Vision Read 4.0:
> JPEG/PNG/GIF/BMP/WEBP/ICO/TIFF/MPO, < 20 MB, > 50×50 / < 16,000×16,000 px),
> and only Safari renders HEIC client-side. So a **server-side HEIC/HEIF →
> lossless PNG transcode is REQUIRED before storage-for-analysis and before
> extraction**, with a **new dependency** (`heic-convert` → WASM
> `libheif-js`, decode-only). Full decision: **new ADR-0008.**
>
> | What changed | R5 |
> |---|---|
> | Accepted formats | PNG + JPEG **+ HEIC/HEIF** (ASM-058). Corrected **in place** wherever it was a live instruction (ADR-0006 follow-on; diagrams). |
> | Ingest pipeline | **New transcode stage** in the API/ingest path: HEIC/HEIF → **lossless PNG** (never lossy — `NFR-012a`), inline in the synchronous upload/attach request, **before the blob is written**. |
> | Dependency | `heic-convert` (ISC) → `heic-decode` (ISC) → `libheif-js` (**LGPL-3.0**, decode-only, WASM, no native build), optionally chained to prebuilt `sharp`. **No GPL `x265`.** LGPL-3.0 **notice obligation** on this MIT repo — `TASK-144`. New risk **`RSK-032`**. |
> | Privacy | HEIC carries EXIF/GPS/device model; **stripping on ingest is now an explicit, tested architectural responsibility** (`specs/security.md` §4.2, `T-SEC-032`), applied to every accepted image. |
> | Stored artefact | For a HEIC upload the stored blob is now a **derived PNG**, not the uploaded bytes — see **ADR-0006** for the 30-day purge (`NFR-019`) and re-extraction (`REQ-074`) consequences. Original HEIC **discarded after verified transcode** (spec default; retention is **OQ-027**, open). |
> | `REQ-041` | Transcode is **user-initiated upload work, not a background process**, and writes no list state — **explicitly outside** the closed enumeration. Stated so nobody later reads it as a violation. |
> | Memory (`RSK-016`) | **The real issue.** WASM HEIC decode materialises a full raw RGBA raster — the app's largest allocation — on the **0.25 vCPU / 0.5 GiB** container where `RSK-016` (OOM) is **live and Medium**. **Assessed honestly below (§Cost summary, §Where this breaks, §Risks) — a worst-case *legal* HEIC can OOM 0.5 GiB.** ~~The priced remedy (0.5 vCPU / 1.0 GiB, +~$4/mo) is **surfaced for the owner, not decided here.**~~ **→ R6/A43: DECIDED. Compute STAYS 0.25 / 0.5 GiB; the 1.0 GiB up-size is the pre-authorised REACTIVE remedy (`runbooks/scale-up-memory.md`), and the five A43 mitigations are mandatory.** |
> | `RSK-028` | The tile-thumbnail crop that makes fabrication reviewable now operates on **post-transcode PNG bytes** — confirmed below, because HEIC is not portably renderable client-side. |
>
> **Not reopened:** ADR-0001 (the extractor) and the Variant A cost choice
> (~$11–14/mo) stand. The only cost question in scope is the memory one,
> and it is *surfaced*, not decided. Right-sizing still binds (one user, no
> HA, no replica, no multi-region, no autoscaling). All Azure figures
> remain unverified ±30 % (`RSK-029`). Everything below this banner is
> Revision 4 text; where R4 or earlier text says "PNG and JPEG only" as a
> live instruction it has been corrected in place per the F-001 rule.

> ### ⚠ REVISION 4 — 2026-08-10T22:40 — the owner selected the ~$11–13/month "middle" variant (A40 = "2" = Variant A)
>
> Revision 3 published a per-component cost table (§Cost summary) at
> **~$30/month** with three named leaner variants, and — per `A41` — that
> table, not an abstract budget question, was the mechanism for closing
> `OQ-026`. **At `A40` the owner answered "2": Leaner Variant A, the
> "middle" ~$11–13/month option.** `OQ-026` is now **CLOSED** with that
> figure. This revision makes Variant A the *as-designed* architecture and
> demotes the ~$30 PostgreSQL design to a documented **richer variant**.
>
> **The three changes the owner selected — exactly, no more:**
>
> | # | Change | Was (R3) | Now (R4) | Saves | ADR |
> |---|---|---|---|---|---|
> | 1 | **Datastore** | Azure Database for PostgreSQL Flexible Server B1ms | **Azure SQL Database, Basic** (5 DTU, 2 GB) | ~$10 | ADR-0005 Rev 3 |
> | 2 | **Container registry** | Azure Container Registry Basic | **ghcr.io** | ~$5 | ADR-0003 Rev 3 |
> | 3 | **Compute size** | 0.5 vCPU / 1.0 GiB | **0.25 vCPU / 0.5 GiB** (still `minReplicas = 1`) | ~$4 | ADR-0003 Rev 3 |
>
> **RETAINED and non-negotiable (unchanged by this revision):**
> always-warm compute (`minReplicas = 1`, **`RSK-023` stays closed**); a
> **relational** store that enforces the product's invariants as **real
> database constraints** (**`RSK-024` stays narrowed**); and the
> **staging environment** (**`RSK-025` stays Low**).
>
> **GIVEN UP — stated plainly, per section, not glossed:**
>
> | Given up | Consequence | Where handled |
> |---|---|---|
> | The best-documented ORM path (`Prisma + PostgreSQL`) | `Prisma + Azure SQL` is GA but thinner — a real `NFR-004` concern | **New risk `RSK-031`** + mitigation (pin provider, name the connection string, M0 smoke migration). **ORM decision: Prisma STANDS** (ADR-0005 R3.3) |
> | `pg_trgm` fuzzy search for the removed view | `LIKE N'%…%'` (case-insensitive collation) — **exact substring only, no typo tolerance**, not index-backed | `specs/data-model.md` §16.6; Full-Text Search is the named escalation |
> | The fast, reliable CI container | `mssql/server:2022-latest` is heavier (~2 GB RAM, `ACCEPT_EULA`, health wait) — an `NFR-003` cost | Confirmed workable in GitHub Actions with an exact config: `specs/testing.md` §3.3 |
> | 35-day PITR → **7-day PITR** (Azure SQL Basic max) | For an append-only, never-purged, irreplaceable store (`REQ-028`), the recovery window shrinks 5× | ADR-0005 R3.5; `OQ-025` **re-widens**; export (`TASK-131`) recommended early; LTR named as escalation |
> | Managed-identity registry pull | The **ghcr.io PAT returns** — a credential that expires quietly and breaks a future deploy | ADR-0003 R3.1. **Azure SQL still supports Entra/MI auth**, so the *database* credential can stay secretless (conditional on M0 — ADR-0005 R3.4) |
> | 1.0 GiB extraction headroom | **OOM risk during extraction bursts returns** (`RSK-016`) | Mitigated by **serial image processing (concurrency = 1)** + pre-base64 size ceiling (ADR-0003 R3.2). **R6/A43: this is no longer a "given up" alternative. The owner has now seen the priced number, chosen deliberately to start at 0.5 GiB, and pre-authorised 1.0 GiB as the REACTIVE remedy (`runbooks/scale-up-memory.md`). Read this row as "deferred until triggered", not "rejected".** |
>
> **Per-section supersession:**
>
> | Section | R4 change |
> |---|---|
> | §Cost summary | **Rewritten.** "As designed" IS now Variant A (~$11–13). The ~$30 PostgreSQL design is a documented **richer variant**; Variant B (~$0.65 full revert) stays. |
> | §Containers | Owner data store → **Azure SQL Basic**; registry → **ghcr.io**; compute → 0.25 / 0.5 GiB. |
> | §Technology selections | Datastore, registry, compute rows updated; **Prisma retained** with `sqlserver` provider. |
> | §Data architecture | Store is Azure SQL; invariants are **filtered unique indexes**; 7-day PITR. Detail: `specs/data-model.md` §16. |
> | §Security architecture | DB credential secretless is now **conditional** (ADR-0005 R3.4); ghcr PAT returns; PITR 7-day. |
> | §NFR → mechanisms | `NFR-012` row updated (selected figure); `NFR-018` search mechanism updated. |
> | §Environments | Registry ghcr.io; staging DB is serverless auto-paused Azure SQL (~$0.50, not literal $0). |
> | §Where this breaks / §Deferred / §Risks | `RSK-031` new; `RSK-016`/`024`/`029`/`030` updated; `OQ-025` re-widens. |
>
> Everything below this banner is **Revision 3 text, retained visible**.
> Where a paragraph names PostgreSQL, B1ms, ACR, 0.5 vCPU / 1.0 GiB or
> 35-day PITR as the *as-designed* choice, read it as historically
> accurate for Revision 3 and superseded here. **`RSK-030` (datastore-
> change churn) applies again**; `TASK-143`'s consistency sweep is widened
> to cover this revision. The grep exit-criterion token set now also
> rejects, as unbannered as-designed claims: `PostgreSQL`,
> `Prisma + PostgreSQL`, `B1ms`, `Flexible Server`, `ACR`,
> `AcrPull|AcrPush`, `pg_trgm`, `postgres:16`, `EXPLAIN \(ANALYZE`,
> `SET STATISTICS` and `35-day` — in addition to the existing
> `cosmos, ghcr, 23505, continuation token, partitionKey, minReplicas=0`.
>
> ⚠ **Every Azure figure remains model-knowledge and UNVERIFIED
> (`RSK-029`).** `TASK-010` re-verifies, now including Azure SQL Basic and
> the serverless staging floor.

> ### ⚠ REVISION 3 — 2026-08-10T21:45 — the cost constraint was repealed system-wide, and three decisions changed
>
> Constraint change **A41 / CC-002** relaxed **`NFR-012` system-wide**
> from a hard MUST to a **SHOULD**: the system should still favour
> cost-efficiency, but **quality and reliability outrank raw cost**
> (`ASM-057` supersedes `ASM-010`). Several Revision 1 decisions were
> argued specifically against a near-zero-cost gate that no longer
> exists. Every one of them was re-opened and re-argued; some changed and
> some did not.
>
> | Decision | Was | Now | Verdict |
> |---|---|---|---|
> | **Datastore** (ADR-0005) | Cosmos DB for NoSQL, free tier | **Azure Database for PostgreSQL Flexible Server, B1ms** | **CHANGED.** The deciding objection to relational — auto-pause — was a property of a *free offer*, not of relational stores. |
> | **`minReplicas`** (ADR-0003) | `0`, scale-to-zero | **`1`, always warm** | **CHANGED.** Cold start attacked `SUC-001`; the only reason to accept it was price. |
> | **Container size** (ADR-0003) | 0.25 vCPU / 0.5 GiB | **0.5 vCPU / 1.0 GiB** | **CHANGED.** Extraction-burst headroom; OOM is an undiagnosable failure for an autonomous implementer. |
> | **Registry** (ADR-0003) | ghcr.io | **Azure Container Registry, Basic** | **CHANGED.** Deletes a secret and a PAT-expiry time bomb; the most-documented ACA path (`NFR-004`). |
> | **Staging environment** (ADR-0003) | None — blocked by the Cosmos free tier | **Exists** | **CHANGED.** Its blocker was removed by the datastore change. Marginal cost ≈ $0. |
> | **Extraction** (ADR-0001) | `gpt-4.1` vision + free OCR cross-check | *unchanged* | **STOOD.** Already argued quality-first under `NFR-012a`; nothing dearer buys anything measurable. |
> | **Identity** (ADR-0002) | Entra ID via built-in auth | *unchanged* | **STOOD.** Never a cost decision. Money cannot buy less authentication code than none. |
> | **Static Web Apps Standard** (~$9/mo) | Rejected | *still rejected* | **STOOD, and cost was not load-bearing.** It loses on `NFR-002`, and `minReplicas = 1` erased its only real advantage. |
> | **Screenshot storage** (ADR-0006) | Private blob + lifecycle purge | *unchanged, one prohibition added* | **STOOD.** And blob soft delete / versioning are now explicitly **forbidden** — they would silently break `NFR-019`. |
> | **VNet / private endpoints / WAF / HA / multi-region** | Rejected | *still rejected* | **STOOD.** Now affordable is not the same as warranted. |
>
> **New estimated cost: ~$30/month** (range ~$28–34), against ~$0.65
> before. A **per-component cost table with two leaner variants** is in
> **§Cost summary** below — and per `A41` that table, not an abstract
> question, is **the mechanism for closing `OQ-026`** (no budget ceiling
> has been stated, and none is invented here).
>
> **Risk movement.** `RSK-023` (cold start) **CLOSED**. `RSK-025` (no
> staging) **Medium → Low**. `RSK-024` (free-tier dependence)
> **narrowed** — only the Vision F0 allowance remains free-tier-dependent,
> and it has a priced fallback. **`RSK-029` raised** (new): monthly spend
> is now real and unverified.
>
> ⚠ **This was NOT licence to over-build, and it has not been treated as
> one.** nextup is a **single-user** app (`NFR-017`) with low,
> front-loaded usage. There is **no redundancy, no HA replica, no
> multi-region, no autoscaling rule, no queue, no scheduler, no VNet and
> no capacity planning** in this design, because none of it addresses a
> load or a threat that can exist here. Two of the five changes above —
> the datastore and the staging environment — **remove** moving parts
> (see ADR-0005 R2.3: batch close becomes one transaction and a bespoke
> visibility protocol is deleted). Complexity is a cost, and at this
> scale it is the larger one.

> ### ⚠ REVISION 2 — 2026-08-10T21:07 — the extraction choice changed
>
> Constraint change **A40** added **`NFR-012a`**: vision/OCR extraction
> is **exempt from the near-zero-cost constraint**, and **quality
> outranks cost for that component**. **ADR-0001 was re-opened on
> quality grounds and its decision changed.**
>
> **Extraction is now a hybrid: Azure OpenAI `gpt-4.1` multimodal vision
> as the primary reader, with Azure AI Vision `Read` OCR (F0) running on
> every image as a mandatory deterministic cross-check.**
>
> **Cost: ~$0.50–$0.70/month** steady state (~50 images), ~$1.40–$2.10
> in a bulk-import month, ~$0.56 for the one-off first import.
> ~~**Total system cost: ~$0.55–$0.75/month**, up from $0.02–$0.20.~~
> *(superseded by Revision 3 — see §Cost summary)*
>
> **`RSK-021` drops High → Low.** The largest residual risk in the
> architecture — that a capture surface renders titles as box artwork
> rather than text — is substantially de-risked, because the primary
> reader can identify a work from its poster art. **New risk `RSK-028`**
> (fabrication), Medium, mitigated by the OCR cross-check, deterministic
> TMDB matching, and the mandatory review pass.
>
> ~~**`NFR-012` still binds everything else**~~ — *superseded by
> Revision 3: `A41` relaxed `NFR-012` system-wide.* The Azure OpenAI
> deployment remains Standard pay-as-you-go, not PTU — that was a
> quality/predictability choice as much as a cost one, and it stands.
>
> Full reasoning: **ADR-0001 Revision 2**. The original Revision 1
> headline is retained immediately below, struck through, because two of
> its three reasons survived and still shape the design.

> ~~**Headline finding (Revision 1).**~~ *(superseded — retained for the record)*
>
> ~~**`OQ-005` is CLOSED. Extraction uses Azure AI Vision (Image Analysis
> 4.0) `Read` OCR on the F0 free tier. Projected inference cost:
> $0.00/month.** A worst-case month (~150 images) consumes about 3% of
> the 5,000-transaction free allowance.~~
>
> ~~**`NFR-012` HOLDS — and it holds under every option evaluated.** The
> most expensive credible alternative (a multimodal LLM at
> `gpt-4o-mini` rates) still lands **under $1/month**.~~ — *this
> observation is what made Revision 2 affordable.* The manual-entry
> fallback named in `mvp-definition.md` §18 is **not** required, the
> **locked cut line is not disturbed**, and per A40(e) the
> fallback-product framing is **retired**.

---

## Driving forces

The eight forces below actually shaped this design. Everything else was
a consequence.

| # | Force | Source | Design implication |
|---|---|---|---|
| F1 | ~~**Near-zero cost is a hard MUST**~~ → **cost-efficiency is a SHOULD; quality and reliability outrank raw cost** | NFR-012 *(relaxed system-wide by A41)*, NFR-012a, ASM-057, ASM-056 | **R3:** free tiers are no longer mandatory and no longer a gate that can reject a design. Managed services are selected where they materially improve reliability or quality — a real managed database instead of a data model contorted into a free tier, always-warm compute instead of a cold-start-prone consumption plan. Three options previously rejected **purely** on price were re-argued: **ACR Basic — now SELECTED**; **PostgreSQL Flexible — now SELECTED** (as the datastore); **SWA Standard — still rejected, on `NFR-002`, not price**. **F1b, the counterweight, and it is binding: this is not licence to over-build.** One user, no redundancy, no multi-region, no autoscaling, no capacity planning. Every dollar must buy a named quality or reliability property, and the per-component cost is published (§Cost summary). **F1a (A40): extraction is quality-first at any reasonable unit price.** |
| F2 | **The implementer is an autonomous coding agent; human budget ≈ 0** | NFR-002, NFR-004, ASM-028/029 | Mainstream, heavily-documented technology as a *technical* criterion. One language, one deployable, one test runner. **Zero authentication code.** Fewer moving parts beats better moving parts. **R2 concedes one moving part** — a second inference provider — and pays for it with an explicit determinism boundary (`specs/ai.md` §9.0). **R3 strengthened this force, and it is now the single most influential one:** it is why the datastore moved off Cosmos to a mainstream relational stack, why the registry moved off ghcr.io, and why a staging environment now exists (an autonomous implementer needs somewhere to fail that is not the owner's irreplaceable data). *(R3-historical specifics: the R3 datastore choice was `PostgreSQL` and the R3 registry choice was `ACR`. **Superseded at R4 (A40, Variant A): the datastore is Azure SQL Database Basic and the registry is ghcr.io** — the "mainstream, documented, one place to fail safely" reasoning is unchanged; only the products differ.)* |
| F3 | **The value loop must feel fast** — the owner must prefer nextup to opening Netflix | SUC-001, J-1 | No third-party call on the read path in the common case. An always-warm datastore with **no auto-pause resume**. Posters served direct from TMDB's CDN, never proxied. Client-side filter and sort. **R3: and now always-warm *compute* too (`minReplicas = 1`) — the last remaining stall on this path is gone. `RSK-023` is closed.** |
| F4 | **`REQ-041` is a closed enumeration** — nothing but the owner changes user-visible list state | REQ-041, PRD §7.4 | **No scheduler exists anywhere in the deployment.** The two permitted non-owner processes are implemented without one: lazy TMDB refresh runs inline on the read path; the screenshot purge is a storage lifecycle rule that writes nothing to the database. |
| F5 | **Nothing is ever hard-deleted; the removed view grows forever and must stay usable** | REQ-028, REQ-062, NFR-018 | Soft state on documents nothing deletes. No TTL configured on any datastore container. Partition-scoped, paginated, filtered queries so cost is bounded by page size, not by history size. |
| F6 | **Three title states must stay structurally distinct, and suppression must key on the WORK, not the row** | REQ-071, requirements.md §1.7 | Suppression is a **separate document keyed on canonical work identity**. It cannot be a field on `Title`, because a reappearance creates a new row (REQ-065) and a row-scoped flag would be bypassed silently on the next capture. |
| F7 | **Screenshots are personal data; possession of a URL must not be access** | NFR-011, NFR-019, NFR-020, RSK-014 | Private blob container, public **and** shared-key access disabled, bytes streamed through an authenticated owner-scoped route. **No blob URL or SAS token is ever emitted to a client.** 30-day lifecycle purge. |
| F8 | **TMDB is mandatory, free, attribution-bound, and capped at a 6-month cache** | NFR-013, NFR-014, REQ-076, OQ-004 | `tmdbFetchedAt` is a modelled attribute, not a cache detail. Refresh is lazy, on access, scoped to the rows being rendered. Attribution is a component with an automated test. **And a binding rule: no TMDB content may ever be sent to any AI service** (RSK-022). |

---

## Architecture at a glance

nextup is a single containerised TypeScript application — React SPA,
Express API and an in-process extraction worker in one image — running as
one **always-warm** Azure Container App, behind the platform's
built-in authentication. Owner data lives in a **managed Azure SQL
Database** (Basic tier, one small database, every row scoped by
`owner_id`) *(R4 — was PostgreSQL Flexible Server; the owner selected the
~$11–13/month Variant A)*; uploaded screenshots live in a
private blob container that no client can reach by URL and that purges
itself at 30 days.

The one flow that matters is: the owner **pastes a screen grab straight
into the app — or uploads image files** — of a service's saved list; an
extraction worker reads each image with a
**multimodal vision model, cross-checked by OCR**, matches the resulting
titles deterministically against TMDB, and stages candidates; the owner
reviews every candidate; and only then does a
single atomic write make the batch visible. Everything downstream — one
row per canonical work, service badges, filters, the removed view,
suppression — reads out of that one store.

There is **no scheduler, no queue and no background job that touches list
state**, by design: `REQ-041` guarantees that only the owner changes what
the owner sees, and the cheapest way to keep that guarantee is to not
build the machinery that would break it.

See `diagrams/context-diagram.md` and `diagrams/container-diagram.md`.

---

## Containers

| Container | Responsibility | Technology | Why | Scales by |
|---|---|---|---|---|
| **Web UI** | The combined list, the review pass, the removed and suppressed views, and **all three ingest affordances: a document-level `paste` listener (desktop Ctrl/Cmd+V), a visible "Paste screenshot" button calling `navigator.clipboard.read()` (the verified iOS path), and `<input type="file">` (retained, the floor)** *(R7, `A45`, ADR-0009)* ~~upload~~ | React 18 + TypeScript + Vite + Tailwind, served as static assets by the same process | Most-represented UI stack in training data (NFR-004). Tailwind puts the 320px/1024px obligations (NFR-006/007) in the markup where they are reviewable. **R7: the two platforms want opposite clipboard primitives, so both are built; the paste button is feature-detected on `navigator.clipboard?.read` + secure context and hidden otherwise, so a browser that cannot paste never shows a button that cannot work** | Not applicable — static assets |
| **API + Domain** | Owner scoping, batch lifecycle, review-pass application, list queries, lazy TMDB refresh, authenticated image streaming, **ONE ingest entry point shared by all three affordances: magic-byte sniff → pre-decode pixel guard → transcode IFF sniffed HEIC/HEIF → EXIF/GPS strip → blob write → staged row (R5/R6/R7)** | Node 20 + TypeScript + Express + **Prisma**, **`heic-convert` (WASM `libheif-js`, decode-only) + `sharp` for the transcode (R5)** | Same language as the UI, so domain types are shared verbatim and contract drift becomes a compile error (NFR-003). Express is maximally boring. **R3: Prisma replaces the hand-rolled Cosmos repository — the most-represented data layer in this ecosystem (NFR-004). R5: HEIC/HEIF is transcoded here, inline in the ingest request before the blob is written, because neither reader accepts HEIC and only Safari renders it (ADR-0008). R7: the transcode branch keys on the SNIFFED TYPE, never on the ingest source — pasted images are always `image/png` and take the skip branch for free (ADR-0008 R3.1)** | Container Apps replicas (never needed at one user) |
| **Extraction Worker** | **Vision-model read + OCR cross-check per image**, deterministic cross-check merge, deterministic TMDB matching, suppression gate, candidate staging, provenance | In-process job runner in the same container | Extraction is bursty and rare — a few dozen images a month. A separate deployable plus a queue would be more infrastructure than the workload justifies, and a standing scheduler is a hazard to REQ-041. **R2: the two inference calls are issued in parallel per image. R4: with compute back at 0.25 vCPU / 0.5 GiB, images are processed strictly SERIALLY (concurrency = 1 image in flight per batch) to bound memory and contain the OOM risk that the smaller size reintroduces (`RSK-016`, ADR-0003 R3.2)** | Would split out only if extraction outgrew the request lifecycle |
| **Owner data store** | Titles with their listings, suppressions, batches with reversal provenance, candidates, per-service freshness | **Azure SQL Database, Basic (5 DTU, 2 GB), single database `nextup`; serverless auto-paused `nextup_staging`; 7-day PITR** *(R4 — was PostgreSQL B1ms)* | **R4 (ADR-0005 Rev 3):** the owner selected Variant A to save ~$10. Still always-warm (Basic does not auto-pause), still relational, and the three highest-risk invariants stay **database constraints** via Azure SQL **filtered unique indexes**; batch close stays one transaction; `Prisma` (`sqlserver` provider) stays the ORM (`NFR-004` — ADR-0005 R3.3). **~$5/month** | Tier change (a Bicep property). No replica, no HA — deliberate at one user |
| **Screenshot store** | Uploaded image bytes for 30 days | Azure Blob Storage, private container, lifecycle rule | Cheapest durable byte storage; lifecycle management gives NFR-019 without any application code or timer. **R3: soft delete, versioning and PITR are explicitly DISABLED — they would silently retain bytes past 30 days and break NFR-019** | Bounded by the retention window — storage does not grow over time |
| **Container registry** | The one application image | **ghcr.io** *(R4 — was Azure Container Registry Basic)* | **R4 (ADR-0003 R3.1):** the owner selected Variant A to save ~$5. The ghcr.io **PAT returns** — a secret that expires quietly and can break a future deploy. Mitigated by longest-expiry PAT + a calendar reminder + a distinguishable auth-failure message, none of which removes the time bomb. **$0/month** | Irrelevant at one image |
| **Operational logs** | Request outcomes, errors, extraction results | Container Apps → Log Analytics, 5 GB/month free grant | Operability without a telemetry SDK. **No product-usage events anywhere** (NFR-005) | Free grant far exceeds need |
| **Operational logs** | Request outcomes, errors, extraction results | Container Apps → Log Analytics, 5 GB/month free grant | Operability without a telemetry SDK. **No product-usage events anywhere** (NFR-005) | Free grant far exceeds need |

---

## Technology selections

| Concern | Selected | Alternatives considered | Rationale | ADR |
|---|---|---|---|---|
| Vision / extraction | **Azure OpenAI `gpt-4.1` multimodal vision (primary) + Azure AI Vision `Read` OCR F0 (mandatory cross-check)** | OCR-only (Revision 1's choice, still shipped and selectable); Document Intelligence `prebuilt-read`; Tesseract in-container; PaddleOCR in-container; `gpt-4.1-mini` / `gpt-4o` / `gpt-4o-mini`; OCR-first-with-escalation | **Quality outranks cost here (`NFR-012a`).** The model groups tiles natively, completes truncated captions before they reach a matcher whose errors are invisible and durable, and — decisively — **identifies works from box artwork**, which drops `RSK-021` from High to Low. The free OCR leg runs on every image so the model's *unsupported* titles are flagged and its *omissions* are recovered — restoring the visible-failure property that made Revision 1 choose OCR. ~$0.50–$0.70/mo | **ADR-0001 (Rev 2)** |
| Identity provider | **Microsoft Entra ID via Container Apps built-in auth** | Google OIDC in app code; GitHub OAuth; Entra External ID (CIAM) | **Zero authentication code**, which is the highest-value property under NFR-002. Free. Same identity plane as managed identity. "No content before auth" becomes a platform property | **ADR-0002** |
| Hosting / compute | **Single Azure Container App, Consumption, `minReplicas = 1` (always warm), 0.25 vCPU / 0.5 GiB, `NEXTUP_MAX_DECODE_PIXELS=25000000`** *(R4 — owner took the ~$4 back; **R6/A43 — CONFIRMED as the as-designed size after the owner saw the priced OOM risk**)* | **0.5 vCPU / 1.0 GiB — NOT an alternative: the PRE-AUTHORISED REACTIVE REMEDY (+~$4/mo → ~$15–18 total, guard raised to `50000000`), see `runbooks/scale-up-memory.md`**; App Service Free F1; Static Web Apps + Functions; ACA Jobs + queue; a VM | One deployable, one origin, and no scheduler to violate REQ-041. **`minReplicas = 1` stays — the value loop has no cold start (`SUC-001`). At 0.5 GiB the extraction worker processes images serially and the ingest transcode is guarded by a pre-decode pixel check (A43-M1) to contain OOM (`RSK-016`, ADR-0003 R3.2/R4, ADR-0008 R2).** | **ADR-0003 (Rev 4)** |
| Application stack | **TypeScript end to end — React + Vite / Node + Express + Prisma (`sqlserver` provider, R4)** | Next.js; .NET 8 + React; Python FastAPI + React | One language, one type system, one test runner. Shared domain types make API drift a build failure. **R4: Prisma STANDS over Drizzle/Kysely on `NFR-004` training-data mass; the SQL-Server-specific DDL lives in raw migrations (ADR-0005 R3.3)** | **ADR-0004** |
| Datastore | **Azure SQL Database, Basic (5 DTU, 2 GB)** *(R4 — owner-selected Variant A; was PostgreSQL B1ms in R3)* | PostgreSQL Flexible Server B1ms (the R3 choice, now the documented richer variant, ~$15); Cosmos DB free tier (Rev 1); Azure SQL GP serverless without auto-pause (~$190 — rejected); Table Storage; SQLite on Azure Files | **R4: the owner reacted to the R3 cost table and chose the ~$10-cheaper relational store. Still always-warm, still constraint-enforcing via filtered unique indexes, still one-transaction close.** Give-ups (thinner ORM path, `LIKE` not `pg_trgm`, heavier CI, 7-day PITR) are named in the banner and ADR-0005 R3. **~$5/mo** | **ADR-0005 (Rev 3)** |
| Screenshot storage | **Private blob + authenticated streaming + lifecycle purge; soft delete/versioning explicitly DISABLED** | Short-lived user-delegation SAS; base64 in the database; no retention | NFR-020 satisfied by construction — no URL that works without a session is ever created. **R3: enabling blob soft delete would silently break NFR-019, so it is prohibited, not merely unconfigured** | **ADR-0006** |
| **Image ingest affordances** *(new, R7 — `A45`)* | **All three, converging on one pipeline: (1) document-level `paste` event listener (desktop Ctrl/Cmd+V, no prompt, all four browsers); (2) visible "Paste screenshot" button → `navigator.clipboard.read()` (iOS 13.4+, the only verified iOS path); (3) `<input type="file">` — RETAINED, the floor** | Paste listener only (broken on iOS — no way to initiate a paste over non-editable content); `clipboard.read()` button only (worse on desktop — Firefox 127+, adds a prompt); hidden `contenteditable` trap (**prohibited** — outdated workaround, damages accessibility); **PWA Web Share Target (RULED OUT — MDN BCD `safari`/`safari_ios` = `false`, WebKit bug 194593 still NEW)**; upload only (contradicts `A45`) | **The two platforms want opposite primitives, so both are built** — they share a decoder, a validator and a transport, so the incremental cost over either alone is one handler and one button. Upload is retained because the laptop save-then-upload path and the iOS Photos path cannot be served by the clipboard at all. $0 | **ADR-0009** |
| **Image ingest / HEIC transcode** *(new, R5; **conditional at R7**)* | **`heic-convert` (WASM `libheif-js`, decode-only) → lossless PNG, chained to prebuilt `sharp` for clamp + EXIF strip. R7: applied IFF the SNIFFED type is HEIC/HEIF** ~~applied unconditionally on the upload path~~ | `sharp` with source-built libvips+libheif; ImageMagick + HEIC delegate; client-side WASM conversion; **reject HEIC and tell the owner to change iPhone settings** (user-hostile, rejected) | Neither reader accepts HEIC/HEIF and only Safari renders it, so a server-side transcode is required (ASM-058). Pure JS/WASM = **no native build**, stock container; **decode-only avoids GPL `x265`**; licence floor **LGPL-3.0** with a notice obligation. Lossless PNG mandated by `NFR-012a`. **R7: pasted images are always `image/png` (WebKit exposes only four clipboard representations), so they take the skip branch — a CONSEQUENCE of a verified platform fact, not an optimisation. The stage is NOT removed: the iOS Photos upload path still delivers raw HEIC (ADR-0008 R3)** | **ADR-0008 (Rev 3)** |
| Work identity | **Single opaque `workIdentity`; `unmatched:<hash>` fallback** *(**Accepted as amended** in phase 8 — OQ-015 CLOSED; see `specs/data-model.md` SD-01/SD-05/SD-06. Amendment: the year is EXCLUDED from the fallback hash)* | Unmatched bucket with no identity; owner-assigned name; duplicate rows | One identity for dedup, suppression, reappearance and overlap collapse — honouring A34's "one decision, not two" | **ADR-0007** |
| Metadata source | TMDB | OMDb, Watchmode, JustWatch | Settled at OQ-004. Free non-commercial, ~40 req/s, mandatory attribution, 6-month cache ceiling | — (OQ-004) |
| CI/CD | GitHub Actions | Azure DevOps | Free, co-located with the repository and the implementing agent | ADR-0003 |
| Container registry | **ghcr.io (free)** *(R4 — owner took the ~$5 back; was ACR Basic in R3)* | Azure Container Registry Basic (the R3 choice, ~$5, managed-identity pull, no PAT) | **R4 (ADR-0003 R3.1): the owner selected Variant A. The ghcr.io PAT returns — a secret that expires quietly and can break a future deploy — reaccepted to save ~$5/mo, with mitigations that make it louder but do not remove it. Azure SQL still supports MI auth, so the *database* credential can stay secretless (ADR-0005 R3.4)** | **ADR-0003 (Rev 3)** |
| IaC | Bicep | Terraform, ARM JSON, portal clicks | First-party, declarative, in-repo, reviewable in a diff | ADR-0003 |
| Testing | Vitest + Playwright | Jest, Cypress | One runner for both halves; Playwright carries the NFR-006/007 viewport assertions | ADR-0004 |

---

## Data architecture

> ⚠ **REVISION 4.** The store is now **Azure SQL Database, Basic**, not
> PostgreSQL (ADR-0005 Rev 3) — the owner selected Variant A. The
> *domain* semantics below are unchanged and store-agnostic; the
> mechanisms remain database constraints, but the physical types,
> filtered-index syntax, collation and migration specifics move to
> `specs/data-model.md` **§16 (Azure SQL chapter, authoritative)**, which
> supersedes §15's PostgreSQL-specific physical detail (which supersedes
> the Cosmos §1/§3/§5.4/§7.3/§10/§13). Where a sentence below names
> PostgreSQL, `pg_trgm`, `jsonb` or 35-day PITR, read it as Revision 3
> and see §16 for the Azure SQL form.
>
> ⚠ **REVISION 3.** The store is now **PostgreSQL**, not Cosmos DB
> (ADR-0005 Rev 2). The *domain* semantics below are unchanged — they
> were always store-agnostic — but the mechanisms carrying them move from
> document conventions to database constraints. The full relational
> schema is `specs/data-model.md` **§15 (Revision 3 chapter)**, which
> supersedes that document's §1, the physical shapes in §3, §5.4, §7.3,
> §10 and §13.

**One managed PostgreSQL server, two databases (`nextup`,
`nextup_staging`), one schema, nine tables.** Every row carries
`owner_id`; every repository function takes `ownerId` as its first
positional parameter and every query filters on it (`NFR-008`). Tables:
`title`, `service_listing`, `suppression`, `upload_batch`,
`batch_change` (provenance), `removal_group`, `uploaded_image`,
`extraction_candidate`, `service_state`. `jsonb` is used **only** where
the payload is genuinely a document with no query obligation
(`match_candidates`, `bounding_boxes`, `extraction_stats`) — the
document model is kept exactly where it earns its place.

Five properties carry the domain's hard-won semantics:

**Ownership.** `owner_id` is on every row and leads every index. The
NFR-001 path to fewer than 20 identities is already built. What used to
be enforced by the *shape* of a partition key is now a convention plus a
single repository module — **a real, named give-up of the datastore
change**, and the reason no handler may build a query.

**Consistency and the batch boundary.** `REQ-005`/`REQ-006` are now
guaranteed by **one transaction**. PostgreSQL has no 100-operation cap,
so the whole batch close — creates, modifications, removals, provenance
and the `upload_batch.status = 'applied'` flip — commits or does not. The
Cosmos-era chunked-write/visibility protocol and its easily-forgotten
query predicate are **deleted** (ADR-0005 R2.3). A `visible` column is
retained for the review-staging phase, but it is no longer load-bearing
correctness machinery.

**Retention — a single, absolute asymmetry.** `title`,
`service_listing`, `upload_batch` and `extraction_candidate` are **never
deleted, never purged, never expired** (REQ-028). Relationally, `SD-04`
is *stronger* than it was: there is **no TTL, no `pg_cron`, no scheduled
job, no retention policy, and `DELETE` appears in exactly one module** —
the creates-only undo path (SD-03). ⚠ **R4: on Azure SQL the same
absolute prohibition binds Azure SQL Agent jobs and Elastic Jobs — no
scheduled/agent/elastic job that could expire or delete list data may
exist, exactly as `pg_cron` was forbidden.** The sole automatic deletion
in the system remains screenshot *bytes* at 30 days by a storage
lifecycle rule (NFR-019); the `uploaded_image` row survives and
availability is derived from `retain_until`. The two surviving
day-count constants — NFR-019's 30-day screenshot retention and
NFR-014's 183-day TMDB metadata age — are **unrelated, may diverge,
and MUST NOT be refactored into a shared constant.** *(R7/A46: the
former third constant, REQ-040's 30-day list-staleness threshold, is
retired — the list-staleness nudge concept was dropped entirely from
v1; only these two constants remain.)*

**Identity — and the invariants that are now constraints.** A single
opaque `work_identity` string (`tmdb:movie:438631` or
`unmatched:<hash>`) is the key for dedup (REQ-024), reappearance
(REQ-065), intra-batch overlap collapse (OQ-013) and — critically —
suppression (REQ-071). **The two highest-risk silent-failure modes in
the product are now database constraints rather than hopes:**

| Invariant | Was (Rev 1) | Now (Rev 3) |
|---|---|---|
| `I-1` — at most one visible, non-removed title per `(owner, work_identity)` | An application invariant asserted by `T-INV-001` | `CREATE UNIQUE INDEX … ON title (owner_id, work_identity) WHERE state <> 'removed' AND visible` |
| `I-2` — at most one listing per `(title, service)` | `T-INV-002` | `UNIQUE (title_id, service)` |
| Suppression uniqueness per work | Encoded into a document id, `supp:<workIdentity>` | `UNIQUE (owner_id, work_identity)` on `suppression` |

The tests remain — a constraint you never see fail is worse than one you
do — but they now assert that the *database* refuses, which is a far
stronger claim. See ADR-0007.

**Reversal provenance.** `batch_change` records what a batch created,
what it modified *with each pre-batch value*, and what it transitioned to
`removed` (REQ-068), discriminated by a `kind` column. `REQ-067`'s
creates-only test becomes `NOT EXISTS (… WHERE batch_id = $1 AND kind <>
'created')` and `REQ-075`'s refusal enumeration is a `GROUP BY kind`. It
is now also queryable in the other direction — *what has ever touched
this title* — which the Rev 1 JSON arrays could not answer without
scanning every batch document.

**Backup.** ~~**35-day point-in-time restore**~~ **R4: 7-day
point-in-time restore** (Azure SQL Basic maximum; PostgreSQL B1ms offered
35). Still not a user-controlled export, and now a materially shorter
safety net for a store that by design never deletes anything — so
`OQ-025` **re-widens** and the manual export (`TASK-131`) is recommended
for early promotion. **Long-term retention (LTR)** is the named
escalation. See ADR-0005 R3.5 and *Deliberately deferred*.

---

## Key flows

### The value loop — open the list, filter, deep-link out
`diagrams/sequence-value-loop.md` · REQ-024, REQ-026, REQ-031–038,
REQ-076, NFR-013

Browser → API → **PostgreSQL**, and nothing else in the common case. The
database is always warm (no auto-pause) **and so is the container
(`minReplicas = 1`, R3)** — there is no longer any start-up stall on this
path at all. Posters load direct from TMDB's CDN; filtering and sorting
are client-side over a few hundred rows. The `REQ-076` TMDB refresh is
bounded to the rows actually being rendered whose stored metadata has
passed the 6-month `NFR-014` ceiling — normally an empty set.
~~The honest weak point is container cold start at `minReplicas = 0`
(ADR-0003).~~ **R3: that weak point is gone — `RSK-023` is closed
(ADR-0003 R2.1).**

### Full-update batch — the destructive path
`diagrams/sequence-full-update-batch.md` · REQ-002, REQ-005, REQ-006,
REQ-019–023, REQ-055, REQ-057, REQ-058, REQ-071, REQ-073

The only flow that can remove something by inference. Service and mode
are chosen, never inferred (REQ-058). Suppression is checked *before
creation*. The review pass shows **every** extracted candidate including
already-known ones (REQ-057) — the product's most important safety
property, because it makes an extraction failure visible at the exact
moment it would otherwise cause data loss. Removals are ticked by
default, individually rescuable, group-confirmed and undoable
afterwards.

### Append-only upload — the routine path
`diagrams/sequence-append-only-upload.md` · REQ-011, REQ-022

Same pipeline, one mode flag. Absence carries no meaning, so there is no
disappeared section and already-present candidates are hidden — the
primary lever for keeping the recurring review cheap (`OQ-011`).
Append-only batches are always creates-only, so they are always
undoable.

### Creates-only batch undo, and the refusal
`diagrams/sequence-batch-undo.md` · REQ-067, REQ-068, REQ-075

A pure data test on provenance. **The refusal branch is a feature, not
an error path**: a mixed batch is refused with a full enumeration of what
it created, modified and removed, each with its available per-title
remedy.

### Ingest — three affordances, ONE pipeline *(R5; rewritten at R7, `A45`)*
`diagrams/sequence-full-update-batch.md`, `diagrams/sequence-append-only-upload.md`,
`diagrams/container-diagram.md`, `diagrams/ai-pipeline.md` ·
REQ-004, REQ-007, **REQ-078**, ASM-058/A42, **A45**, NFR-012a, NFR-019,
RSK-014, RSK-016 · **ADR-0008 (Rev 3), ADR-0009**

**There are THREE ways an image gets in, and exactly ONE pipeline it
lands on** *(R7 — ~~a single `<input type="file">` upload~~; that was an
agent-derived default, falsified by `A45`)*:

| # | Affordance | Where it works | Primitive |
|---|---|---|---|
| **1** | **Document-level `paste` listener** — Ctrl/Cmd+V | **Desktop** (Chrome, Edge, Safari, Firefox) — **no prompt**, the keystroke *is* the user's paste | `event.clipboardData.files` — data arrives synchronously; **`navigator.clipboard.read()` is NOT called on this path** |
| **2** | **Visible "Paste screenshot" button** | **iOS 13.4+** — the **only verified** iOS path for a non-editable page. WebKit shows a native single-option paste callout | `navigator.clipboard.read()` **inside the click handler** |
| **3** | **`<input type="file">` — RETAINED, the floor** | **Everywhere.** The **only** path for the laptop save-then-upload case and the **iOS Photos** case | Ordinary multipart upload |

⚠ **Affordance 3 is not legacy and is not deprecated.** iOS screenshots
auto-save to Photos and reach the clipboard **only** if the owner taps
"Copy" on the transient preview; iOS *camera photos* default to HEIC and
are never on the clipboard. **Upload is the only route for both, and it is
the only route that delivers raw HEIC** — which is precisely why ADR-0008
survives (ADR-0008 R3.2).

**A hidden `contenteditable` trap is prohibited**, and so is designing
around the iOS Share Sheet: **Web Share Target does not exist on iOS**
(MDN BCD `safari`/`safari_ios` = `false`; WebKit bug 194593 still NEW).

**The one pipeline, in order, identical for all three affordances:**

```
bytes → magic-byte sniff → pre-decode dimension/pixel guard (A43-M1)
      → transcode IFF sniffed HEIC/HEIF → EXIF/GPS/device-model strip
      → blob write → staged row
```

Format is decided by **magic bytes**, never by the declared
`Content-Type`, never by the `ClipboardItem` type string, never by a file
extension (iOS/Safari often sends `application/octet-stream` or an empty
type for `.heic`). A HEIC/HEIF image is **transcoded to lossless PNG
inside the synchronous ingest request, before the blob is written and
before extraction** — because neither reader accepts HEIC and only Safari
renders it. PNG/JPEG skip the decode and are stored as-is (still
metadata-stripped). Lossless PNG is mandated — a lossy re-encode would
degrade exactly the tile captions and artwork extraction depends on
(`NFR-012a`).

⚠ **The transcode branch keys on the SNIFFED TYPE, never on the ingest
source.** A pasted screenshot is **always `image/png`** — WebKit exposes
exactly four clipboard representations and HEIC is not among them — so the
paste path takes the skip branch **for free**, as a *consequence of a
verified platform fact, not as an optimisation*. Writing
`if (source === 'paste') skipTranscode()` is **wrong**: it trusts the
caller instead of the bytes. **The pre-decode pixel guard applies to
pasted images exactly as it does to uploaded ones — nothing is trusted
because of how it arrived.**

⚠ **The EXIF asymmetry — the single easiest thing to get wrong here.**
WebKit **strips EXIF on clipboard read** but **does NOT strip it on file
upload**. So the free stripping covers **one of three** affordances.
**`REQ-078`'s explicit, tested metadata strip stays on the upload path and
stays mandatory** (`T-SEC-032`, `specs/security.md` §4.2). Asserting
`T-SEC-032` against a *pasted* image would **pass vacuously** and prove
nothing about our code — it must be asserted against an **uploaded** image
carrying real EXIF/GPS.

Three design points this subsection exists to fix in the reader's mind:

- **Inline in the request, not deferred to the worker.** The stored
  artefact must already be a raster both readers accept, EXIF must be
  stripped before the bytes rest in the blob, and a bad-HEIC failure is
  surfaced synchronously in the ingest response (`rejected[]`, that one
  file named) at the moment the owner can re-pick — not as a mysterious
  extraction failure later. The user-visible cost is slightly slower HEIC
  ingest; that is the right trade.
- **This is not a background process (`REQ-041`).** All three affordances
  are user-initiated and write no list state, so ingest sits entirely
  outside the closed enumeration — the only permitted non-owner writers
  remain the metadata-only lazy TMDB refresh and the 30-day blob purge.
- **iOS paste is brittle, by design of the platform.** The callout is
  **per-invocation and never remembered** (one extra deliberate tap per
  screenshot, forever), and **any stray tap, tab switch or backgrounding
  silently rejects the promise**. Rejection is the **expected** case, not
  an exception path: the UI must detect it and **re-offer**, never hang
  and never show a stack trace (`RSK-033`, ADR-0009).

**`navigator.clipboard` is absent on `http://`** — HTTPS is a functional
dependency of affordance 2, not merely a transport control. See
§Environments and deployment for the local-testing consequence.

The memory consequence — a WASM HEIC decode is the app's largest
allocation, on a 0.5 GiB container where `RSK-016` OOM is live — is
assessed honestly in §Cost summary, §Where this breaks and §Risks.
**R7: paste reduces how OFTEN that decode runs, and changes nothing
else — `RSK-016` stays Medium and owner-accepted, and `A43-M1`…`M5` stay
mandatory.**

#### Memory containment at ingest — MANDATORY *(R6, `A43-M1`/`M2`/`M3`)*

At `A43` the owner chose to **stay at 0.25 vCPU / 0.5 GiB and up-size
only if it actually OOMs**. That choice is only survivable because of the
three mechanisms below. **They are acceptance criteria, not advice**, and
none of them may be dropped on the grounds that the "buy more memory now"
option was not the one selected — the owner specifically kept them.

**1. Pre-decode dimension/pixel guard (`A43-M1`) — refuse before you
allocate.** Before *any* decode buffer is allocated, read the declared
pixel dimensions out of the container header — the HEIF **`ispe`** box for
HEIC/HEIF, the IHDR for PNG, SOFn for JPEG — and evaluate:

- `width × height > NEXTUP_MAX_DECODE_PIXELS` → **reject**
  (**25 000 000 at 0.5 GiB**, **50 000 000 at 1.0 GiB**);
- `width > 16000 || height > 16000 || width < 50 || height < 50` →
  **reject** (the Azure AI Vision Read 4.0 bounds — such an image could
  not be extracted even if it decoded);
- header unparseable → **reject** as malformed, never "decode and find
  out".

The byte-size ceiling that already existed is **not** a substitute: HEIC's
compression ratio is variable, so bytes are a poor predictor of raster
size, and a 6 MiB HEIC can still be 48 MP. **Dimensions are the thing that
predicts the allocation, so dimensions are what is checked.** The guard
value **moves with the container size** and the runbook changes both in
one command — a raised guard on a small container is strictly worse than
no up-size at all.

**2. Blast radius is exactly one image (`A43-M2`).** A guard rejection, a
decode failure, or an out-of-memory condition **fails that image and only
that image**. It appears in the attach response's `rejected[]` naming that
one file; every other image in the request is processed normally; the
batch stays open and re-attachable. **No partial commit is possible and no
batch can be corrupted**, and that property does not depend on catching
the error — see the reconciliation below.

**3. The error names the cause and the remedy (`A43-M3`).** The surfaced
message must say *memory/decode*, not "upload failed", and must point at
`runbooks/scale-up-memory.md`. Exact text in ADR-0008 R2.3. **No blind
debugging**: `RSK-016`'s original complaint was never "it runs out of
memory", it was "the failure is undiagnosable by an autonomous
implementer". A named cause plus a named one-line remedy is what removes
that property.

#### Reconciling `REQ-074` with the transactional full-update guarantee *(R6)*

The owner's requirement — *"I must be able to retry the affected image
after up-sizing"* — touches two existing guarantees that could otherwise
be read as contradictory. They are reconciled here explicitly rather than
left ambiguous.

**The transactional guarantee is unaffected, structurally.** A batch
becomes user-visible in **one transaction at review-close**
(`diagrams/sequence-full-update-batch.md`). Ingest and extraction only
*stage*. Therefore a death at any point before close — a caught decode
error, or a hard OOM kill that takes the whole process with it mid-request
— **cannot half-apply a batch**, because there is nothing to half-apply:
no visible list state has been written. This holds even for the
uncatchable case, which is why it is stated as a structural property and
not as an error handler.

**Ordering that makes this true, and which must be preserved:** within a
single image's ingest, the transcode completes **before** the blob is
written, and the blob is written **before** the staged row referencing it.
An interruption can therefore leave (a) nothing, or (b) an orphan blob no
row references — never a row pointing at a blob that does not exist. Orphan
blobs are harmless and are collected by the 30-day lifecycle purge
(`NFR-019`); no compensating cleanup code is needed, which is one fewer
thing for an autonomous implementer to get wrong.

**Which retry path applies depends on whether the image was stored — and
this is the part that must not be assumed:**

| Failure | Image stored? | Retry path after up-sizing |
|---|---|---|
| Guard rejection (`IMAGE_TOO_LARGE_TO_DECODE`) | **No** — refused before allocation, and before the blob write | **Re-attach the file.** `REQ-074` **cannot** help: it re-extracts from *retained images*, and no image was retained |
| Decode OOM/failure (`IMAGE_DECODE_OOM` / `IMAGE_DECODE_FAILED`) | **No** — the transcode precedes the blob write (ADR-0008) | **Re-attach the file.** `REQ-074` does not apply |
| Hard OOM kill mid-request | **Possibly an orphan blob**, never a referenced one | **Re-attach the file.** Images already accepted into the open batch remain staged and are not lost |
| Extraction OOM on an **already-stored** image | **Yes** | **`REQ-074` re-extraction applies** — this is exactly the case it was designed for. No re-attach needed |

⚠ **`REQ-074`'s retry window is bounded by `NFR-019`'s 30-day purge.**
Re-extraction works only while the retained image still exists. An OOM
left unfixed for more than 30 days loses the retained artefact and forces
a re-attach from the phone. **This interaction is new with A43** (a
reactive strategy implies a delay between failure and fix) and is called
out in the runbook §6 rather than discovered later.

### Sign-in and owner scoping
`diagrams/sequence-auth.md` · NFR-008, NFR-015–017

Authentication is the platform's; authorisation is ours. Easy Auth lets
any Microsoft account authenticate — the allow-list check is the only
thing that stops them, and **it fails silently if omitted**.

### Extraction pipeline
`diagrams/ai-pipeline.md` · REQ-008–012, REQ-058, REQ-071, REQ-074

Five stages: **read (vision model + OCR cross-check, merged
deterministically)** → deterministic clean-up → identity → suppression
gate → classification and review. **The images reaching Stage 1 are
always PNG or JPEG** — any HEIC/HEIF was transcoded to lossless PNG
upstream at ingest (see *Ingest transcode*, ADR-0008), because neither
reader accepts HEIC. **The readers see only the owner's screenshot**; TMDB
is reached only afterwards, by string search. The two never meet, which
is what keeps `RSK-022` closed — and note that `RSK-022` binds **TMDB
content**, not the owner's pixels (ADR-0001 R2.4).

### Title lifecycle
`diagrams/state-title.md` · REQ-027, REQ-028, REQ-062–065, REQ-070–073

Three states, and the transition that creates a new record rather than
reactivating an old one.

---

## Security architecture

- **Authentication:** OIDC to Microsoft Entra ID, performed entirely by
  Container Apps built-in authentication at the platform edge. **nextup
  writes no authentication code and stores no credential** (NFR-015,
  NFR-016). ADR-0002.
- **Authorization:** allow-list plus ownership. A configured list of
  provider subject identifiers (`NEXTUP_ALLOWED_SUBJECTS`) gates access
  (NFR-017); every record carries an internal `ownerId` and every read
  filters on it (NFR-008). There are no roles and no admin surface
  (PRD §7.7).
- **Data classification:**

| Data | Sensitivity | Handling |
|---|---|---|
| Uploaded screenshots | **Highest** — may incidentally show a profile name or account email (RSK-014); **HEIC/HEIF additionally carries EXIF/GPS/device model (R5)** | Private container, public + shared-key access disabled, streamed only through an authenticated owner-scoped route, purged at 30 days. **R5: transcoded to lossless PNG on ingest and EXIF/GPS/device-model STRIPPED before the blob is written — an explicit, tested control (`T-SEC-032`) applied to every accepted image (HEIC, PNG, JPEG), not incidental (ADR-0008, `specs/security.md` §4.2).** ⚠ **R7 (`A45`), and this must not be misread: WebKit strips EXIF on CLIPBOARD READ but NOT on FILE UPLOAD. The free stripping therefore covers one of three ingest affordances only. `REQ-078`'s explicit strip STAYS on the upload path and stays MANDATORY; `T-SEC-032` must be asserted against an UPLOADED image carrying real EXIF/GPS, because asserting it against a pasted image would pass vacuously (ADR-0008 R3.3, ADR-0009).** Transmitted to **Azure OpenAI and Azure AI Vision** during extraction — disclosed, not glossed. ⚠ **R2: Azure OpenAI may retain prompts (i.e. these screenshots) for up to 30 days for abuse monitoring, with possible authorised human review, unless the modified-abuse-monitoring exemption is granted. This is a real privacy regression against Revision 1 — `TASK-134` applies for the exemption before first real use.** |
| Watchlist contents (titles, services, dates) | Medium — reveals viewing intentions and which services the owner subscribes to | Owner-partitioned, authenticated access only, encrypted at rest and in transit |
| Owner identity (subject id, email claim) | Medium | Subject id in configuration and on records; no other profile data stored |
| TMDB metadata | Public | Cached ≤6 months (NFR-014); **never transmitted to any AI service** (RSK-022) |
| Operational logs | Low | Request outcomes and errors only. **No product-usage events, no client telemetry SDK** (NFR-005) |
| Streaming-service credentials | **N/A — must never exist** | NFR-009. No field, no form, no configuration key |

- **Secrets:** **R4: two, possibly three under Variant A** *(R3 had one).*
  The **TMDB API key** (Container Apps secret) and the **ghcr.io pull
  PAT** (ADR-0003 R3.1 — it returns with the move off ACR, and it expires
  quietly). The **Azure SQL credential is kept secretless where possible**
  — the app authenticates to Azure SQL with an **Entra token** from its
  managed identity (Azure SQL supports this). ⚠ **Conditional:** Prisma's
  `sqlserver` connector's managed-identity support is not well-established,
  so this is proven in the **M0 smoke migration** (`RSK-031`); if it
  fails, the **defined fallback** is SQL authentication with the password
  in **Key Vault**, surfaced as a Key-Vault-referenced Container Apps
  secret — never in source, and not a silent time bomb (a SQL login
  password does not auto-expire). That fallback would make it three
  secrets. **Everything else uses the Container App's system-assigned
  managed identity with least-privilege RBAC:** no storage account key,
  no Vision API key and **no Azure OpenAI API key** exists anywhere.
  Rotation is a portal/Bicep operation.
  ⚠ **If the MI database path holds, the connection factory must refresh
  the Entra token** — a naive implementation works for an hour and then
  fails. `TASK-141` (reshaped for Azure SQL).
- **Transport and at rest:** HTTPS only with a platform-managed
  certificate, TLS 1.2 minimum, HTTP→HTTPS redirect. **Azure SQL Database
  requires encrypted connections (`Encrypt=true`) and its firewall is set
  to "Allow Azure services"** (no VNet — see ADR-0003 R2.5 for why that is
  deliberate). Service-managed Transparent Data Encryption at rest on the
  database and Blob Storage. *(R4 — was PostgreSQL TLS + public endpoint
  restricted to Azure services; the posture is identical.)*
- **Threat notes, with structural mitigations:**

| Threat | Structural mitigation |
|---|---|
| **Any Microsoft account signs in and gets the owner's data** — the highest-likelihood real failure, and it is silent | The allow-list check. Mandated test: a valid, non-allow-listed principal is refused (US-001 AC-4). **The single most important test in the product** |
| **Screenshot reachable by URL** — the failure NFR-020 was written against, and it fails silently | No blob URL or SAS is ever emitted; public and shared-key access disabled. Mandated test: no API response ever contains a `*.blob.core.windows.net` URL |
| **A local development auth shim reaches production** — an authentication bypass | Excluded from the production build at compile time, not by a runtime flag; asserted absent from the production artifact |
| Malicious upload (polyglot / oversized file) | Magic-byte format validation (not extension or client content-type) over the PNG/JPEG/**HEIF `ftyp` brand** set, per-image and per-batch ceilings. **R5: a HEIC/HEIF transcode failure (corrupt/truncated file) rejects that one file (415), never the whole request; the blob path is composed from server-generated ULIDs, never the client filename (ADR-0008, `specs/api.md` §5.1)** |
| Untrusted external payloads (vision model, OCR, TMDB) | Zod schema validation at every boundary before anything reaches domain logic; the model call additionally uses **Structured Outputs with `strict: true`** so an unexpected field is a parse failure, not a silent pass |
| **Prompt injection via screenshot text** *(new, R2)* | The image is the only untrusted input; no owner-authored text ever enters a prompt. Strict JSON Schema fixes the response shape regardless of instructions. Extracted text is consumed **only** as strings into deterministic comparison — there is no code path that interprets it. Worst case is a wrong candidate, which the review pass catches. `T-AI-044` |
| Credential-store compromise | **Eliminated by design** — no streaming credential exists (NFR-009), no password exists (NFR-016) |
| Accidental automated contact with a streaming service | NFR-010, plus a test over the allow-listed outbound host set (US-038 AC-2/AC-5) |

---

## Privacy and compliance

**No regulated category is touched.** No payment data, no health data,
no children's data, no biometrics. Personal data is limited to one
identity claim, incidental account chrome in screenshots, and the
owner's own viewing intentions — for a single-user application the
owner runs for themselves.

The architecture's privacy posture is expressed in **five** places (R5
adds the fifth): retention is bounded where it can be (screenshots, 30
days, NFR-019); access requires a session even with a URL (NFR-020);
nothing is measured (NFR-005 — there is no analytics vendor, no client
SDK, and no event schema anywhere); the highest-risk data class in the
original design — streaming-service credentials — was **eliminated rather
than protected** (NFR-009, NFR-016); **and incidental image metadata
(EXIF/GPS/device model, which HEIC/HEIF carries) is stripped on ingest,
before the bytes rest in the blob, as an explicit tested control
(ADR-0008, `T-SEC-032`).**

**Two binding third-party obligations**, both from TMDB:

1. **Attribution (NFR-013)** — the TMDB logo plus the verbatim
   disclaimer on every view rendering TMDB data. Implemented as one
   component in the application shell **with a mandated automated test**,
   because its failure is invisible from inside the app (PRD risk R-8).
2. **The 6-month cache ceiling (NFR-014)** — satisfied by `REQ-076` lazy
   refresh on access. Metadata may be stale *in storage* but is never
   stale *when seen*, which is the property the term actually requires,
   and it needs no background job (REQ-041).

**One live compliance risk, `RSK-022`:** TMDB's terms restrict use "in
connection with … a machine learning (ML) or artificial intelligence
(AI) based Application". The reading this architecture adopts is
conservative and binding: **no TMDB content is ever transmitted to any
AI or vision service, and title→work matching is deterministic, never
model-assisted.** The extraction pipeline enforces it structurally — the
readers see only the owner's screenshot, TMDB is reached only afterwards
by string search.

⚠ **Clarified in ADR-0001 R2.4:** this rule binds **TMDB content**, not
the owner's own screenshot pixels. A screenshot the owner took of their
own saved list is not TMDB content, so **the rule does not prohibit
multimodal vision extraction** — it prohibits a model-assisted
*matcher*. Revision 1 cited "maximum distance from the clause" as a
supporting argument for plain OCR; that was a *distance* preference, not
a compliance requirement, and `NFR-012a`'s quality-first ordering
settles it. The structural enforcement is **strengthened** in Revision 2:
`T-AI-013`'s network-shaped assertion now covers the Azure OpenAI host
as well as the vision host.

`NFR-010` (no automated request to any streaming service) is a
compliance obligation with an account-termination remedy attached, and it
is tested, not merely intended.

---

## Non-functional requirements → mechanisms

| NFR | Requirement | Mechanism in this design | Verified by |
|---|---|---|---|
| NFR-001 | Must not preclude <20 accounts later | `owner_id` is on every row and leads every index from day one; adding an identity is an allow-list entry (ADR-0002, ADR-0005 Rev 2) | Test: two owner ids, no cross-visibility |
| NFR-002 | Buildable by an autonomous agent without clarification | One language, one deployable, zero auth code, boring stack; every ADR names its follow-on spec obligations (ADR-0002/0003/0004). **R3: a relational store with a mainstream ORM, and a staging environment to fail in, both serve this directly** | Artifact review; agent-executable backlog |
| NFR-003 | Automated verification sufficient for an agent | Vitest + Playwright; shared domain types make contract drift a build failure. **R3: CI is no longer the only gate — a staging environment exists (ADR-0003 R2.4) — and the CI store fixture is `mcr.microsoft.com/mssql/server:2022-latest` (R4; was `postgres:16-alpine` in R3) instead of the slow, flaky Cosmos emulator, which makes the gate itself more reliable (`testing.md` §3.3a)** | CI suite green; every AC maps to a named test |
| NFR-004 | Mainstream, well-documented technology | ADR-0004 states the reasoning explicitly and applies it as a technical criterion. **R3: the one acknowledged deviation (Cosmos over SQL) is RETIRED — `Node + Prisma + PostgreSQL` is the most-represented relational stack in this ecosystem, and ACR-with-managed-identity is the most-documented ACA pull path** | ADR review |
| NFR-005 | No analytics or telemetry | No client SDK in the dependency tree; server logs carry operational outcomes only (ADR-0003, ADR-0004) | Dependency allow-list check in CI |
| NFR-006 | Usable at 320px | Tailwind mobile-first; responsive obligations visible in the markup (ADR-0004) | Playwright viewport test at 320px |
| NFR-007 | Usable at 1024px | Same | Playwright viewport test at 1024px |
| NFR-008 | Owner-scoped data, no cross-owner reads | `owner_id` on every row and leading every index; one scoping middleware; one repository layer whose every function takes `ownerId` first (ADR-0005 Rev 2, `sequence-auth.md`) | Architecture test: no handler reads the store outside the scoping middleware; no repository function without `ownerId` |
| NFR-009 | No streaming credential ever | No field, no form, no configuration key exists | Repository and schema scan (US-038 AC-1) |
| NFR-010 | No automated requests of any kind to a streaming service | Only four outbound destinations exist: TMDB, Azure OpenAI, Azure AI Vision and OMDb (ADR-0011). None is a streaming service, and only the two extractors are ever sent screenshot bytes | Outbound host allow-list test (US-038 AC-2/AC-5), `T-SEC-031` |
| NFR-011 | Images restricted to the owning identity | `ownerId` equality check before any byte is streamed (ADR-0006) | US-004 AC-3 test |
| NFR-012 | ~~Free-tier / consumption only~~ → **cost-efficiency is a SHOULD; quality and reliability outrank raw cost (A41), and the per-component monthly cost MUST be published** | **R4: §Cost summary now publishes Variant A (~$11–13/mo, the owner-selected figure at A40) as the as-designed total, with the ~$30 PostgreSQL design demoted to a documented richer variant and Variant B (~$0.65) retained. `OQ-026` is CLOSED. Each paid line still names the quality/reliability property it buys; right-sizing is enforced by exclusion.** `NFR-012a` continues to govern extraction | §Cost summary below; monthly Azure cost view (BRD M9); `T-INFRA-005` (asserts the *selected* SKUs — R4: Azure SQL Basic, ghcr.io, 0.25 vCPU / 0.5 GiB; **R6: and the paired `NEXTUP_MAX_DECODE_PIXELS=25000000`**) |
| **NFR-012a** | **Extraction: quality outranks cost; lowest reasonable price without degrading quality** | `gpt-4.1` selected over `gpt-4.1-mini` on artwork-recognition quality for a ~$0.40/mo premium; `detail: 'high'` mandated; the free OCR cross-check adds capability at $0. **A cost-motivated model downgrade is explicit non-compliance** and is called out at the point of configuration (`specs/ai.md` §2.1a) | ADR-0001 R2.8 priced comparison; the §9.5 live quality gates are the only admissible basis for changing the model |
| NFR-013 | TMDB logo + verbatim disclaimer | One shell component on every TMDB-rendering surface | **Mandated automated test** (US-011 AC-5) |
| NFR-014 | No TMDB content held >6 months unrefreshed | `tmdb_fetched_at` on every title; `REQ-076` lazy refresh scoped to rendered rows (ADR-0005, `sequence-value-loop.md`) | Test: a title with `tmdb_fetched_at` older than 6 months triggers a refresh on render |
| NFR-015 | Authenticated via an external IdP before any owner data | Container Apps built-in auth at the platform edge (ADR-0002) | US-001 AC-1 test |
| NFR-016 | No password stored, verified or reset | No authentication code exists at all (ADR-0002) | Repository and store scan (US-001 AC-3) |
| NFR-017 | Allow-list only, no registration surface | Allow-list middleware on the normalised principal (ADR-0002) | **US-001 AC-4 — the highest-value test in the product** |
| NFR-018 | Removed view usable at any size | Owner-scoped, filtered, **keyset-paginated** queries over indexed columns. **R4: title *search* over the removed view is `LIKE N'%…%'` with a case-insensitive collation (exact substring, no fuzzy/typo tolerance), not `pg_trgm`; the paginated listing stays index-backed and bounded by page size. Full-Text Search is the named escalation (ADR-0005 R3.2, `specs/data-model.md` §16.6)** | Query-plan and latency test over a large seeded removed set (`T-PERF-001` — index scan for the paginated listing; bounded scan for the search term at single-user scale) |
| NFR-019 | Screenshots purged at 30 days, nothing else affected | Blob lifecycle rule scoped to one container; availability derived from `retain_until`; **no database writer**. **R3: blob soft delete, versioning and PITR are explicitly DISABLED — enabling them would silently retain bytes past 30 days** (ADR-0006) | US-035 tests; `T-INFRA-002` extended; assertion that no scheduled deletion mechanism exists in the database |
| NFR-020 | Not retrievable by URL alone | No blob URL or SAS ever emitted; public and shared-key access disabled (ADR-0006) | Test: no API response body or header contains a storage URL |

**`OQ-014` categories — performance, availability, accessibility and
internationalisation — remain deliberately unspecified.** No numeric
target has been invented here, in R3 either. **R3 note:** the one
consequence that used to hang on `OQ-014` — whether cold start was
tolerable — is now moot, because the cold start was removed rather than
measured (ADR-0003 R2.1). That is not the same as inventing a
performance target: no threshold has been written down, a known defect
was simply deleted for ~$5/month.

---

## Observability

There is no product analytics and there will be none (`NFR-005`).
Success is measured by owner self-assessment (BRD M1–M9). The
distinction between *operability* and *analytics* is written down here
because it will otherwise be re-litigated:

| Signal | Source | Why |
|---|---|---|
| HTTP request outcome and latency | Container Apps → Log Analytics | Diagnose failures; the value-loop latency evidence |
| Unhandled errors and stack traces | stderr → Log Analytics | An autonomous implementer needs a failure signal it can read |
| Extraction outcome per batch: images in, candidates out, matched / unmatched counts, **`ocrSupport` distribution, `basis` distribution, `degradedExtraction`, `estimatedCostUsd`** | Application log + `uploadBatch.extractionStats` | **The only production evidence for `RSK-021` (is the reader actually working on the owner's surface), `RSK-028` (how many titles are unsupported inferences) and the cost model.** A rise in `ocrSupport: 'none'` with no rise in artwork-only captures is the fabrication signal |
| Outbound call outcome to TMDB, Azure OpenAI and Azure AI Vision, including rate-limit responses, plus per-call token usage | Application log | NFR-014 compliance, free-tier headroom, and prompt/token-growth regression detection |
| Azure monthly cost | Azure portal cost view | BRD M9 / `NFR-012` verification. **R3: this signal matters more than it did — spend is now real (~$30/mo) and every figure in §Cost summary is unverified. A budget alert at 1.5× the published total is one Bicep resource and costs nothing (`TASK-142`)** |
| **Container replica restart, memory working-set pressure, and a per-image decode begin/end sentinel** *(new, R6, `A43-M5`)* | ACA platform metrics + Log Analytics (`ContainerAppSystemLogs` / `ContainerAppConsoleLogs`) + application log | **The trigger for the whole A43 reactive strategy.** "Up-size only if it OOMs" requires *knowing* that it OOMed. Without this the owner just experiences a flaky app and never reaches the runbook. See §Knowing that it OOMed |

### Knowing that it OOMed *(new, R6 — `A43-M5`)*

The `A43` strategy is *reactive*: nothing happens until an OOM occurs. So
**the detection of that OOM is load-bearing**, and it must be an observed
signal, not an inference from "the import felt broken".

⚠ **First, the honest limitation, because inventing a metric here would
be worse than admitting a gap.** **Azure Container Apps does not expose
OOM-kill as a distinct, queryable signal.** There is no `OOMKilled`
metric, and no documented container-termination *reason* dimension
equivalent to Kubernetes' `reason: OOMKilled` on a pod status. A
memory-limit kill is visible only as its *consequences*: the replica
restarted, and the work in flight vanished. **Confidence: medium-high,
from model knowledge of the `Microsoft.App/containerApps` metric set;
web verification was unavailable to this role.** This is treated the same
way as every other Azure fact in this document — assumed until verified,
and the verification is owed (see below). **Nothing below depends on a
metric that may not exist, because the signal that actually names the
failing image is one we emit ourselves.**

**The four signals, in order of how much they tell you:**

| # | Signal | Emitted by | Lands in | Alert condition |
|---|---|---|---|---|
| **S1** | **Decode begin/end sentinel.** Before allocating, log `image.decode.begin` with `{batchId, imageId, filename, width, height, megapixels, declaredBytes, **source**}` where **`source ∈ {paste-event, paste-button, upload}` (R7)**; on success log `image.decode.end` with peak RSS. **A `begin` with no matching `end`, followed by a restart, identifies the exact image that killed the container.** The `source` attribute is an **operational** attribute of a request the owner initiated — it is not a product-usage event and does not engage `NFR-005` | **nextup application code** (stdout) | `ContainerAppConsoleLogs` | **Log search alert**, 5-min frequency: any `image.decode.begin` with no `image.decode.end` for the same `imageId` within 5 minutes → fire `nextup-prod-decode-abandoned` |
| **S2** | **Replica restart count.** With `minReplicas = 1`, no autoscaling rule and a single user, the app should **never** restart except on deploy. Any unplanned restart is therefore an anomaly worth waking up for — and an OOM kill always produces one. | ACA platform metric (**`RestartCount`**, "Replica Restart Count") | Azure Monitor metrics | **Metric alert** `nextup-prod-replica-restart`: aggregation **Total > 0** over a **5-minute** window, evaluated every 5 min, severity 2. Deploys will trip it; that is acceptable at one deploy per session and is the price of not missing the real one |
| **S3** | **Memory working set approaching the limit** — the *leading* indicator, which fires **before** the crash and is the one that lets the owner up-size on their own schedule instead of mid-import. | ACA platform metric (**`WorkingSetBytes`**, "Memory Working Set Bytes") | Azure Monitor metrics | **Metric alert** `nextup-prod-memory-pressure`: **Average > 400 MiB** (≈78 % of 512 MiB) over 5 minutes, severity 3. **Raise to 800 MiB if the up-size is taken** — the runbook does not currently change this and that is noted as a gap below |
| **S4** | **Platform/system log text.** A V8 heap exhaustion (`FATAL ERROR: ... JavaScript heap out of memory`) is printed to stderr and *is* captured; a kernel OOM kill of PID 1 typically prints nothing from the app, leaving only the system-log restart record. | Node runtime / ACA system logs | `ContainerAppConsoleLogs`, `ContainerAppSystemLogs` | Included in the S1 log-alert query as an additional match term. **Do not rely on this alone** — the silent-kill case produces no such line |

**Why S1 exists and is listed first.** S2/S3 tell you *that* something
died; only S1 tells you *which image*, *how big it was*, and therefore
whether the guard threshold or the container size is the right lever. It
also costs nothing — it is two log lines — and it is under our control,
which S2–S4 are not.

**A real subtlety, recorded rather than glossed:** a WASM linear-memory
allocation failure inside `libheif-js` may surface as a **catchable**
`RangeError`/abort rather than as a process kill. That is the *good*
case — it becomes `IMAGE_DECODE_OOM`, fails one image (`A43-M2`) and
reaches the owner as a named error (`A43-M3`) with **no restart at all**.
So **S2 will not fire for every OOM**, and an alert design that relied on
restarts alone would miss the common case. S1 and the application error
path cover it. Conversely, a kernel-level kill of the process produces a
restart with no application error. **Both paths must be handled; neither
alone is sufficient.** This is the single most important operational fact
in this section.

**Cost:** a metric alert rule is roughly **$0.10/rule/month** and a
5-minute log search alert roughly **$0.50/month** — call it **~$0.60–1.00
total**, inside the ±30 % uncertainty band on the ~$11–13 estimate and
not worth a variant. **Unverified, `RSK-029`.**

**Verification owed (first sprint, alongside `TASK-010`):** confirm that
`RestartCount` and `WorkingSetBytes` exist as alertable metrics for
`Microsoft.App/containerApps`, and confirm whether any
termination-reason dimension is in fact available. **If a genuine
OOM-distinct signal turns out to exist, adopt it and demote S2 to a
backstop.** If `RestartCount` does *not* exist, S1 and S3 still carry the
design — which is why S1 was made the primary signal rather than the
platform metric.

**Not collected, deliberately:** page views, session tracking, feature
usage, click events, funnels, user identifiers in any analytics context.
No client-side telemetry package is installed anywhere in the dependency
tree, and a CI dependency allow-list check should assert it.

The PRD's success criteria that *are* observable for free come from the
data itself, not from instrumentation: `REQ-039`'s per-service
last-completed-batch date already tells the owner how alive the feeder
loop is (BRD M7).

---

## Environments and deployment

**Three environments, two of them in Azure.** *(R3: staging is new —
ADR-0003 R2.4. Its blocker was the Cosmos free-tier limit, which the
datastore change removed.)*

| Environment | What it is | Data |
|---|---|---|
| Local / CI | The container built from source, plus the **`mcr.microsoft.com/mssql/server:2022-latest`** service container (`testing.md` §3.3a), Azurite, a stub `TitleExtractor` and recorded TMDB fixtures | Synthetic; the full suite runs offline and deterministically |
| `staging` | A second Container App in the **same** Container Apps environment (`minReplicas = 0` — nobody judges its cold start), a **separate serverless auto-paused Azure SQL database `nextup_staging`** (Azure SQL bills per database, so there is **no shared server** to co-locate on — it is its own logical server/database, ~$0.50/mo storage floor), a second blob container on the same storage account, its own Entra app registration, and the **stub extractor by default** | Synthetic fixtures only. **The owner's real screenshots never reach staging**, and no production data is ever copied down |
| `prod` | The always-warm Container App, the `nextup` database, the `screenshots` container | The owner's real data |

> ~~R3 (historical): CI store was **`postgres:16-alpine`**, and staging was a second **database on the same PostgreSQL server**.~~ Superseded at R4 by the Variant A rows above (mssql CI container; separate serverless Azure SQL staging database — no shared server).

**Why staging exists now.** `NFR-002` hands implementation to an
autonomous coding agent and `RSK-016` is that the agent gets something
subtly wrong. Without staging, its only place to discover an
infrastructure-shaped defect was the owner's real, never-deleted,
un-recreatable data (`REQ-028`). Emulators and CI cannot rehearse
managed-identity RBAC, Easy Auth redirect URIs, ACR pull permission or a
Bicep deployment against a real subscription — which is precisely the
list of things that break on a first deploy. Marginal cost ≈ **$0**.

**What staging deliberately is not:** no second resource group, no
second region, no second registry, no separate Log Analytics workspace,
no custom domain, no production data. The staging database is a
**separate serverless auto-paused Azure SQL database** (`nextup_staging`)
— because Azure SQL bills per database there is no shared server to
co-locate on, and the accepted give-up is only the **shared storage
account**: a Bicep change targeting the storage account rather than a
single container affects both. *(R3 historical: staging shared the
PostgreSQL server with prod; that topology no longer exists.)*

The compensating controls that stood in for staging remain, because they
are good on their own: the CI suite must pass before deployment;
Container Apps deploys as an immutable revision with **single-command
rollback**; and a post-deploy smoke test exercises sign-in, a list read,
and an image upload-and-read round trip.

**Promotion path:** push to `main` → GitHub Actions builds and tests →
image pushed to **ghcr.io** → Bicep deployment to
**staging** → staging smoke test → Bicep deployment to `prod` → new ACA
revision → prod smoke test → traffic shifted. Rollback is a revision
switch. **Database migrations run as an explicit, ordered step
(`prisma migrate deploy`) against staging first**, and a migration that
would drop a column fails CI (`REQ-028`). *(R3 historical: the image was
pushed to Azure Container Registry; superseded — the registry is now
ghcr.io, ADR-0003 R3.1.)*

**Infrastructure as code:** Bicep, in-repo, **one resource group, two
parameter files** (`prod.bicepparam`, `staging.bicepparam`), so the
entire system can be destroyed and recreated. See
`diagrams/deployment-diagram.md`.

> ⚠ **R7 (`A45`) — testing the paste path. This is a live procedure, so it
> is corrected in place, not annotated.**
>
> **`navigator.clipboard` is ABSENT on `http://`.** It is not degraded, not
> prompted — the object does not exist, so the "Paste screenshot" button
> feature-detects to *hidden*. **The failure therefore looks like a missing
> feature, not a missing certificate**, which is exactly how an hour gets
> lost.
>
> | | **LIVE RULE (R7)** |
> |---|---|
> | Test the paste affordances against | **`staging` over HTTPS** (ACA managed certificate), or a trusted HTTPS tunnel to the dev machine |
> | **Never** test them against | **`http://<LAN-IP>:<port>`** from the phone — the button will not render and the `paste` listener cannot read the clipboard |
> | The desktop `paste` listener | testable on `http://localhost` (a secure context by definition) and in CI |
> | The iOS button + callout | **MANUAL, real-device only.** It needs a real clipboard, real HTTPS and a human tap on a system callout. **CI cannot cover it** — an honest hole in the `NFR-003` automated gate, named rather than papered over (ADR-0009) |
> | Minimum iOS for the button | **13.4** (`Clipboard.read()` / `ClipboardItem`, Safari 13.1). Below that the button is hidden and **file upload is the path** |
>
> ~~Local-network testing from the phone over the dev server's LAN address
> is sufficient to exercise ingest.~~ — **superseded: it is sufficient for
> file upload only, and silently removes both clipboard affordances.**

**Region:** a single region offering **Azure SQL Database Basic**,
the Azure AI Vision F0 tier, **and a `gpt-4.1` deployment with
available quota** (East US or equivalent) — **to be confirmed as a
first-sprint task** (`TASK-010`) before the Bicep is finalised. *(R3
historical: the region constraint named PostgreSQL Flexible Server B1ms;
superseded by Azure SQL Basic. The Cosmos free-tier regional constraint
is likewise gone.)*

---

## Cost summary

> **R4: `OQ-026` is CLOSED.** Revision 3 published this table at
> ~$30/month with leaner variants, and — per `A41` — the table, not an
> abstract budget question, was the closure mechanism. **At `A40` the
> owner replied "2": Variant A, the "middle" ~$11–13/month option.** So
> the *as-designed* table below is now **Variant A**; the ~$30 PostgreSQL
> design is preserved beneath it as the **richer variant** (the R3
> as-designed), and Variant B (~$0.65 full revert) is retained. A future
> reader can still see what each dollar bought and what was traded away.

**✅ VERIFIED 2026-08-17 (TASK-010) — the total holds, but two line items
did not.** Every figure below has now been checked against the **live Azure
Retail Prices API** for `eastus2`. The verified total is **$11.77/month**,
inside the published $11–13 band, so no `OQ-026` escalation is triggered.

⚠ **The total is right partly by CANCELLATION, not because each line was
right.** Compute came in **under** the estimate and absorbed two overages:

| Line | Published | Verified (2026-08-17, `eastus2`) | Verdict |
|---|---|---|---|
| ACA 0.25 vCPU / 0.5 GiB always-warm | ~$5–8 | **$4.30** | **under** — free grant confirmed to cover idle |
| Azure SQL Basic, prod | ~$5 | **$4.90** ($0.161/day) | ✅ Basic still exists |
| Alert rules (2 metric + 1 log-search @5 min) | ~$0.60–1.00 | **$1.70** | ⚠ **over by 70–183 %** |
| Compute up-size remedy, delta | **+~$4** | **+$5.92** | ⚠ **understated by 48 %** — corrected below and in the runbook |
| `gpt-4.1` vision, ~50 images | ~$0.47 | **~$0.35** | under |
| Blob Hot LRS <1 GB | ~$0.02 | **$0.02** | ✅ |
| Log Analytics (5 GB free grant) | $0.00 | **$0.00** | ✅ |
| ghcr.io | $0.00 | **$0.00** | ✅ public package |

~~*Superseded 2026-08-17 by the verification above: "**Every figure is an
Azure list price recalled from model knowledge and is UNVERIFIED.** Web
retrieval is unavailable to this role, so no price here was checked against a
live pricing page. **`TASK-010` is extended** to re-verify all of them —
including **Azure SQL Basic** and the **serverless staging floor**. Treat them
as ±30 % until `TASK-010` lands."*~~

**Still unverified, deliberately:** item (h), whether `RestartCount` /
`WorkingSetBytes` exist as alertable metrics and whether any OOM-distinct
signal exists. Metric definitions can only be listed against a **deployed**
container app, so that leg is owed the moment staging exists — it is a
TASK-157 input, not a pricing question.

Volume assumptions are structurally bounded: there is exactly one owner
(`NFR-017`), so volume cannot grow by user acquisition.
**~50 images/month steady state; ~150 in a bulk-import month.**

### As designed (Variant A — owner-selected at A40): ~$11–13/month

| Component | Service / tier | MVP monthly | What this buys you |
|---|---|---|---|
| **Compute** | Azure Container Apps, **`minReplicas = 1`**, **0.25 vCPU / 0.5 GiB** — **as designed, owner-confirmed at `A43`** | ~~**~$5–8**~~ **$4.30** *(verified 2026-08-17)* | **The value loop still has no cold start** (`SUC-001`, `RSK-023` closed). At 0.5 GiB the extraction worker processes images **serially** and ingest applies a **pre-decode pixel guard at 25 MP** to contain OOM (`RSK-016`, ADR-0003 R3.2/R4, ADR-0008 R2). **R6/A43: the owner has seen the priced OOM risk and deliberately chose to start here.** The monthly free grant (180,000 vCPU-s + 360,000 GiB-s) is confirmed to apply to **idle** usage on an always-on replica — the single least-certain figure in the model, and it landed favourably. |
| ↳ **Known remedy (pre-authorised, reactive — NOT an alternative)** | Same app at **0.5 vCPU / 1.0 GiB**, guard raised to **50 MP** | **~$10.22** *(**+$5.92**, verified 2026-08-17)* | **Taken only when a real OOM occurs.** One `az` command + one Bicep change: **`runbooks/scale-up-memory.md`**. **System total becomes ~$17.69/month.** No re-architecture, no data migration, no downtime. ⚠ **The delta was published as +~$4 and is really +$5.92** — 48 % higher. It is quoted to the owner in the runbook, so it is corrected there too. Still pre-authorised; the decision does not change at this price. |
| **Database (prod)** | **Azure SQL Database, Basic (5 DTU, 2 GB)**, 7-day PITR | **~$5** | **The product's highest-risk silent defects stay database constraints** via filtered unique indexes (one active title per work; one listing per service; one active suppression per work). Batch close stays one transaction. Still always-warm (Basic does not auto-pause). |
| **Database (staging)** | **Azure SQL serverless, auto-pause enabled** (~storage only) | **~$0.50** | Staging keeps a *real* Azure database to rehearse RBAC/Easy-Auth/deploy; auto-pause is fine because nobody judges staging's cold start. *(Azure SQL bills per database, so this is ~$0.50, not the literal $0 the shared-PG server gave — ADR-0003 R3.3.)* |
| **Container registry** | **ghcr.io** | **$0.00** | Free. The trade is the **returning PAT** — a quietly-expiring secret (ADR-0003 R3.1). |
| **Extraction — primary reader** | Azure OpenAI `gpt-4.1` vision, Standard PAYG (~$0.0094/image) | **~$0.47** | Artwork recognition (`RSK-021` High→Low), tile-grid understanding, de-truncated titles. **Untouched by this revision (`NFR-012a`, ADR-0001 Rev 2).** |
| **Extraction — OCR cross-check** | Azure AI Vision Read, **F0** (5,000 tx/mo) | **$0.00** | Makes fabrication visible and silent omission structurally impossible. Fallback S1: *$0.05–$0.23*. |
| *(allowance)* `REQ-074` re-extraction ×1.5 | — | *+~$0.24* | Headroom for re-running a bad batch. |
| **Screenshot storage** | Blob Hot LRS, <1 GB, 30-day lifecycle | **~$0.02** | `NFR-019` with no application code and no timer. |
| **Logs** | Log Analytics, 5 GB/month free grant | **$0.00** | Operability without a telemetry SDK. |
| **Identity** | Entra ID + Container Apps built-in auth | **$0.00** | Zero authentication code. |
| **Metadata** | TMDB, free non-commercial | **$0.00** | — |
| **CI/CD** | GitHub Actions | **$0.00** | — |
| **TLS / DNS** | ACA managed certificate, default domain | **$0.00** | — |
| **Alerting** *(new, R6 — `A43-M5`)* | Azure Monitor: 2 metric alert rules + 1 log-search alert (`RestartCount`, `WorkingSetBytes`, decode-sentinel query) | ~~**~$0.60–1.00**~~ **$1.70** *(verified 2026-08-17)* | **The trigger for the reactive up-size.** "Up-size only if it OOMs" is not a strategy unless the OOM is *observed*. ⚠ **The estimate was low.** `eastus2` list: metric rule **$0.10** each, log-search alert at 5-minute frequency **$1.50** — the log-search rule is 15× a metric rule, which is what the estimate missed. Dropping to 15-minute frequency would cost $0.50 and is the lever if this ever matters; it is **not** taken now, because a 15-minute detection delay on an OOM is most of a batch. |
| **TOTAL, as designed (Variant A)** | | **≈ $11–13 / month** — **verified $11.77 on 2026-08-17** | keeps *always-warm compute, a relational store with real constraints, and staging* |
| **TOTAL if the memory remedy is taken** *(R6)* | | **≈ $15–18 / month** — **verified $17.69** | the same design, one size up — see `runbooks/scale-up-memory.md` |
| *Bulk-import month* | +~$1.40 extraction | *≈ $12–14* | |

> ### R6 — the memory question is now DECIDED (`OQ-028` closed at `A43`)
>
> **The owner's answer, verbatim: _"Start at 0.5 GiB, up-size only if it
> OOMs."_** The as-designed compute size is therefore **0.25 vCPU /
> 0.5 GiB**, and **0.5 vCPU / 1.0 GiB is the documented, priced,
> pre-authorised remedy** — a *known remedy*, not an abandoned
> alternative and never to be written as one again.
>
> The physical facts have not changed and are restated so nobody has to
> reconstruct them: `libheif-js` decodes into a full raw RGBA raster in
> WASM linear memory plus a PNG-encode buffer — the largest allocation
> nextup makes. A **typical** iPhone image (≈12–15 MP → ≈50–60 MB raw,
> ≈100 MB with the WASM copy) fits comfortably alongside the ~150–200 MB
> Node baseline. A **worst-case legal HEIC near the 10 MiB byte ceiling**
> can be ~40–48 MP, decoding to ~160–195 MB of raw RGBA — roughly
> two-thirds of a gigabyte once the WASM copy and PNG buffer are counted
> — **and would OOM 0.5 GiB.**
>
> **What changed at R6 is who is carrying that risk and with what
> instrumentation.** The owner **was told this can land mid-import** and
> accepted it. So `RSK-016` is an **owner-accepted residual risk**, and
> the five mitigations (`A43-M1`…`M5`: pre-decode pixel guard,
> one-image blast radius, self-explaining error, the runbook, and the
> OOM/restart alert) are **mandatory** — they are what makes "wait and
> see" a strategy rather than an unmonitored bet.
>
> **A user-visible consequence of the guard that must not be a
> surprise:** at 0.5 GiB the pixel guard refuses images above **25 MP**,
> which includes **48 MP iPhone Pro captures**. Those are refused
> *cleanly and explicably*, pointing at the runbook — they are not
> silently dropped and they do not crash the import. Taking the remedy
> raises the guard to 50 MP and accepts them. `NFR-012a` is unaffected —
> this bounds memory, not model choice. All figures unverified ±30 %
> (`RSK-029`).
>
> ~~**R5 — the memory question the owner must see (surfaced, not
> decided).** … the **priced remedy is a compute up-size to 0.5 vCPU /
> 1.0 GiB — ~$9–12/month, +~$4 over the as-designed ~$5–8, raising the
> as-designed total to ~$15–17.** This is a cost change and it is the
> owner's call.~~ *(superseded by R6 — the call was made: stay at
> 0.5 GiB, up-size reactively. The arithmetic was correct and is carried
> forward above.)*

> ### R7 — the `A45` paste path: **$0 direct cost delta, small favourable memory effect** *(stated explicitly rather than left silent)*
>
> **No line in the table above changes.** Both clipboard primitives are
> platform browser APIs: no new Azure resource, no new SKU, no new
> dependency, no new outbound destination. **Direct cost delta: $0.**
>
> **The favourable part is memory, not money.** A pasted screenshot is
> always `image/png`, so it **skips the WASM HEIC decode entirely** — the
> app's largest single allocation. As paste becomes the primary affordance,
> **fewer bytes are transcoded** and the `RSK-016` OOM path is **exercised
> less often**. Marginally faster ingest, too (no decode, no re-encode).
>
> ⚠ **What this does NOT buy, so that nobody spends it twice.** Reduced
> *frequency* is not reduced *severity*, and **nothing in `A43` is
> relaxed**: compute stays **0.25 vCPU / 0.5 GiB**,
> `NEXTUP_MAX_DECODE_PIXELS` stays **`25000000`**, `RSK-016` stays
> **Medium and owner-accepted**, and `A43-M1`…`M5` stay **MANDATORY**. One
> 48 MP HEIC arriving from iOS Photos by file upload still exercises every
> one of them, and that path is not going away. The pre-authorised remedy
> and its **+~$4/month** are unchanged.

**What Variant A gives up, in one place** (each detailed in the R4banner and ADR-0005 R3): the best-documented ORM path (`Prisma +
PostgreSQL` → `Prisma + Azure SQL`, **`RSK-031`**); `pg_trgm` fuzzy
removed-view search (→ `LIKE`, no typo tolerance); the fast CI container
(→ heavier `mssql/server`); 35-day → **7-day PITR**; the managed-identity
registry pull (→ **ghcr.io PAT**); and 1.0 GiB extraction headroom (→
OOM risk, mitigated by serial processing, **a mandatory pre-decode pixel
guard and an OOM alert — and, at `A43`, reversible on demand via
`runbooks/scale-up-memory.md`. This is the one give-up on the list that
the owner can buy back in a single command**).

### Richer variant — the Revision 3 PostgreSQL design: ~$30/month

*(This was the R3 "as designed" table. The owner did not select it; it is
retained so the trade-off is visible and reversible.)*

| Component | Service / tier | MVP monthly | What this buys you |
|---|---|---|---|
| **Compute** | Azure Container Apps, **`minReplicas = 1`**, 0.5 vCPU / 1.0 GiB **— note (R6): this size is also the *remedy target* of `runbooks/scale-up-memory.md`, not merely a historical richer option** | **~$9–12** | **The value loop has no cold start.** `SUC-001` is "the owner opens nextup instead of Netflix"; a 2–8 s blank first screen loses that comparison, and at one user *almost every session is a cold session*. The 1 GiB (rather than 0.5) is extraction-burst headroom — an OOM mid-batch is recoverable but undiagnosable for an autonomous implementer (`RSK-016`). **Closes `RSK-023`.** |
| **Database** | Azure Database for PostgreSQL Flexible Server, **B1ms burstable**, 32 GiB, single zone, 35-day PITR | **~$15** | **The product's highest-risk silent defects become database constraints instead of tests** (one visible title per work; one listing per service; one suppression per work). Batch close becomes one transaction, deleting a bespoke visibility protocol. Mainstream ORM path for an autonomous implementer (`NFR-004`). Reliable CI container in place of the flaky Cosmos emulator (`NFR-003`). 35-day point-in-time restore for a store that never deletes. |
| **Container registry** | Azure Container Registry, **Basic** | **~$5** | **One fewer secret, and no credential that expires silently months later** and breaks an unrelated deployment. Pull is by managed identity. Most-documented ACA path (`NFR-004`). |
| **Extraction — primary reader** | Azure OpenAI `gpt-4.1` vision, Standard PAYG (~$0.0094/image) | **~$0.47** | Artwork recognition (`RSK-021` High→Low), tile-grid understanding, de-truncated titles feeding a load-bearing matcher. Governed by `NFR-012a`. |
| **Extraction — OCR cross-check** | Azure AI Vision Read, **F0** (5,000 tx/mo) | **$0.00** | Makes fabrication visible and silent omission structurally impossible. Fallback S1: *$0.05–$0.23*. |
| *(allowance)* `REQ-074` re-extraction ×1.5 | — | *+~$0.24* | Headroom for re-running a bad batch. |
| **Screenshot storage** | Blob Hot LRS, <1 GB, 30-day lifecycle | **~$0.02** | `NFR-019` with no application code and no timer. |
| **Staging environment** | 2nd Container App (`minReplicas = 0`) + 2nd database on the same server + 2nd blob container | **~$0** | **Somewhere for an autonomous implementer to fail that is not the owner's irreplaceable data.** Drops `RSK-025` Medium→Low. |
| **Logs** | Log Analytics, 5 GB/month free grant | **$0.00** | Operability without a telemetry SDK. |
| **Identity** | Entra ID + Container Apps built-in auth | **$0.00** | Zero authentication code. |
| **Metadata** | TMDB, free non-commercial | **$0.00** | — |
| **CI/CD** | GitHub Actions | **$0.00** | — |
| **TLS / DNS** | ACA managed certificate, default domain | **$0.00** | — |
| **TOTAL, richer variant** | | **≈ $30 / month** *(range $28–34)* | |
| *Bulk-import month* | +~$1.40 extraction | *≈ $31* | |

**The delta from the richer variant to the as-designed Variant A:**

| Change | Saves | What it costs you |
|---|---|---|
| **Azure SQL Database Basic** (5 DTU, 2 GB) instead of PostgreSQL B1ms | **−$10** | Still relational, still always-warm, still constraint-enforcing, but **7-day** (not 35-day) PITR. You lose the best-documented ORM path (`Prisma + PostgreSQL`), `pg_trgm` search for the removed view, and the fastest CI container. **The smallest sacrifice on the list.** |
| **ghcr.io** instead of ACR Basic | **−$5** | The registry PAT comes back, and with it a credential that expires quietly and breaks a future deployment. |
| **0.25 vCPU / 0.5 GiB** compute (still `minReplicas = 1`) | **−$4** | Cold start stays fixed; you take on OOM risk during extraction bursts and HEIC transcode. **R6/A43: knowingly accepted by the owner, mitigated by serial processing + a mandatory 25 MP pre-decode guard + an OOM alert, and buyable back in one command (`runbooks/scale-up-memory.md`) if it ever bites.** |
| **TOTAL delta** | **≈ −$18** | ~$30 → **~$11–13**. |

### Leaner variant B — "revert to Revision 2": ~$0.65/month

| Change | Saves | What it costs you |
|---|---|---|
| `minReplicas = 0` | −$5–8 | **`RSK-023` reopens** — 2–8 s cold start on the value loop, on nearly every session. The direct threat to `SUC-001`. |
| Cosmos DB free tier | −$5 | **`RSK-024` reopens.** Invariants go back to being tests instead of constraints; batch close goes back to a bespoke visibility protocol an implementer can silently get wrong; CI goes back to the Cosmos emulator; `NFR-004` deviation returns. |
| ghcr.io | −$0 | *(Already ghcr.io under Variant A — no further saving.)* |
| No staging | −$0.50 | **`RSK-025` returns to Medium** — the only place to fail is production. |
| **TOTAL** | | **≈ $0.65 / month** (extraction + storage only). Everything else in the product is identical. |

**The honest summary of the trade:** roughly **$29/month buys three
things** — a value loop with no cold start, a datastore that enforces the
product's most dangerous invariants itself, and a safe place for an
autonomous implementer to fail. Variant A keeps all three for ~$12 by
taking a less-travelled ORM path. Variant B is the Revision 2 design and
is entirely viable if the owner would rather not spend.

**On "as low as reasonable without degrading quality" (`NFR-012a`).**
The cheapest quality-adequate extraction configuration is `gpt-4.1-mini`
plus the free cross-check at ~$0.10/month; the selected one is ~$0.50.
**The entire quality premium is about 40 cents a month**, spent to buy
artwork recognition, which is what drops `RSK-021` from High to Low.
Nothing more expensive buys anything measurable: `gpt-4o` is ~26 %
dearer for no gain on this input class, and an ensemble or two-pass
design would double the bill to duplicate what the free OCR cross-check
already does. Full arithmetic: **ADR-0001 R2.8**.

**What was considered and NOT bought, though it is now affordable.**
Zone-redundant HA on the database (roughly doubles it), a read replica,
a second region, a VNet with private endpoints, a WAF, DDoS protection,
Front Door/CDN, Application Insights APM, a queue, and any autoscaling
rule. **None of them addresses a load or a threat that can exist for a
single-user application**, and each would add resources an autonomous
implementer must get right. This is `A41`'s "not licence to over-build"
applied as a spending decision rather than quoted as a slogan.

**First-sprint verification (`TASK-010`, extended):** **Azure SQL
Database Basic** compute and PITR pricing and regional availability;
**the serverless auto-paused staging floor**; ACA idle-rate billing at
**0.25 vCPU / 0.5 GiB**; `gpt-4.1` availability, quota and token prices;
the Azure AI Vision F0 allowance. **The richer-variant figures
(PostgreSQL B1ms, ACR Basic) are verified too, so the richer variant
stays quotable from a real number.** Plus `TASK-142`: a subscription
**budget alert at 1.5× the published total**, which costs nothing and
turns an unverified estimate into a monitored one.

---

## Where this breaks

| Threshold | What breaks | Migration path | Estimated cost of the move |
|---|---|---|---|
| The capture surface renders titles as **artwork, not text** (`RSK-021`, now **Low**) | **Largely mitigated** — the primary reader identifies works from poster art | Nothing to do. If measured artwork recall is < 0.50, revisit ADR-0001 (R2.9e) | $0 |
| Measured fabrication rate > 0.05 despite the cross-check (`RSK-028`) | Owner review becomes untrustworthy rather than merely tedious | Tighten the prompt; if that fails, revert to `NEXTUP_EXTRACTOR='azure-vision-read'` (Revision 1) and accept `RSK-021` | Hours; **−$0.50/month**, **+RSK-021** |
| Modified abuse monitoring refused **and** 30-day screenshot retention judged unacceptable | Privacy posture (`RSK-014`) | Revert to `azure-vision-read` — Revision 1's behaviour, one config value | Hours; **−$0.50/month**, **+RSK-021** |
| `gpt-4.1` retired by Azure OpenAI | Extraction stops | Pin the successor model, re-run `golden:live`, record an ADR-0001 addendum | Hours; cost per the successor's rates |
| Cold start proves intolerable on the value loop | ~~`SUC-001`~~ | **RESOLVED in R3** — `minReplicas = 1` is now the design, not an escalation | *already paid (R4): ~$5–8/month* |
| >5,000 OCR cross-check transactions/month | Vision F0 exhausted | Switch to S1 | Configuration; ~$1.50 per 1,000 |
| Sustained DTU pressure on the **Azure SQL Basic (5 DTU)** database *(R4)* | Queries throttle | Next tier up (Standard S0/S1, or vCore) — a Bicep property, no schema impact | Minutes; +$5–15/month |
| **A HEIC upload above the pixel guard, or an OOM during transcode**, on 0.25 vCPU / 0.5 GiB *(R5; **decided at R6/A43**, `RSK-016`)* | **That one image fails — not the batch.** Above 25 MP it is refused *before* any allocation with a named error; a true OOM kills the in-flight request but **cannot half-commit a batch** (visibility is one transaction at close). Other images are unaffected | **The remedy is pre-authorised and documented: `runbooks/scale-up-memory.md`** — one `az containerapp update` to **0.5 vCPU / 1.0 GiB** with the guard raised to 50 MP, plus the matching `infra/aca.bicep` change. Mitigations `A43-M1`…`M5` are mandatory and ship first | Minutes; **+~$4/month** (~$5–8 → ~$9–12 compute; **~$11–13 → ~$15–18 total**) |
| **The clipboard affordances are unavailable** — iOS < 13.4, a browser without `navigator.clipboard`, or a **non-secure (`http://`) context** *(new, R7 — `A45`)* | **Nothing breaks.** The "Paste screenshot" button feature-detects to hidden and the `paste` listener simply never fires | **None needed — file upload is the floor and is always present.** This is why upload was retained rather than swapped out | **$0.** The cost is taps, not dollars: ~4 instead of ~3 |
| **The per-paste iOS callout tap proves intolerable in real use** *(new, R7 — `RSK-033`)* | The primary affordance is more annoying than the one it replaced; the owner drifts back to upload | Nothing to build — upload already works. Re-evaluate if Apple ever ships Web Share Target (WebKit bug 194593, **NEW** since 2019) or a remembered clipboard permission | $0 | Move to Standard tier (250 GB) — a Bicep property | Minutes; +$10–15/month |
| A second environment becomes necessary | ~~Cosmos free tier is one account per subscription~~ | **RESOLVED in R3** — staging exists, sharing the server and the storage account | *already paid: ~$0* |
| >20 owners, or real multi-user with self-service | The allow-list model stops fitting | Entra External ID (CIAM) and a real account model — **a scope change, not just an architecture change** | Weeks; still ~$0 at that scale |
| Extraction outgrows the request lifecycle | In-process worker blocks the API | Split into an ACA Job with a queue — **and REQ-041's guarantee needs re-examining the moment a scheduler exists** | Days |
| The removed view reaches hundreds of thousands of rows | NFR-018 pagination cost | Already bounded by keyset paging over an indexed column; title search is `LIKE` *(R4 — `pg_trgm` gone)*; a Full-Text index or dedicated search index if ever needed | Days |
| Nine services instead of two | Nothing architectural — the mechanism is service-agnostic | Configuration plus per-service capture guidance | Hours |

---

## Deliberately deferred

| Deferred | Why | Trigger that forces it |
|---|---|---|
| ~~**A staging environment**~~ | ~~Cosmos free tier is one account per subscription~~ | **NO LONGER DEFERRED (R3).** Staging exists (ADR-0003 R2.4): a second Container App, a second database on the same server, a second blob container. Its only blocker was the free tier, which the datastore change removed. Marginal cost ≈ $0 |
| ~~**`minReplicas = 1` (always-warm compute)**~~ | ~~Costs $4–6/month against an unmeasured need~~ | **NO LONGER DEFERRED (R3).** Built. The deferral was correct only while spending was gated; `RSK-023` is closed |
| **Database HA / zone redundancy / read replica** *(new deferral, R3)* | Roughly doubles the database bill to protect a single-user watchlist against an event that would be a few hours of inconvenience. There is no availability requirement (`OQ-014`) and inventing one would violate `NFR-002` | The product stops being single-user, or the owner states an availability expectation |
| **A user-controlled backup / export** | Not in the locked scope. **R3 narrows this: 35-day point-in-time restore is now included**, which is a real improvement for a store that never deletes — but PITR is not an export the owner controls | **Still recommended for early promotion.** `OQ-025` narrows, it does not close |
| ~~**A multimodal LLM extractor**~~ | ~~Option E in ADR-0001 is the right *second* decision, not the first — real-world OCR yield is currently unmeasured~~ | **NO LONGER DEFERRED.** `A40`/`NFR-012a` removed the cost gate and ADR-0001 Revision 2 **built it as the primary reader**, with OCR as a mandatory cross-check. Deferring it was correct only while spending was gated |
| **An ensemble or two-pass vision read** | ADR-0001 R2.8 — doubles the bill to duplicate what the free OCR cross-check already provides | A measured fabrication rate > 0.05 that prompt changes cannot fix |
| **Runtime filtering of unsupported ("possibly fabricated") titles** | It would silently discard exactly the artwork-read titles the decision was made to obtain, violating `REQ-012`. They are **flagged and shown**, never hidden. `T-AI-042` enforces this | Never — this is a permanent prohibition, not a deferral |
| **A user-controlled backup / export** | Not in the locked scope; Cosmos service-side backup is the only protection | ~~**Recommended for early promotion.**~~ *(superseded by the R3 row above)* |
| **Performance, availability, accessibility, i18n targets** | `OQ-014` — genuinely undecided, and `NFR-002` forbids inventing them | Before `specs/ux.md` and `specs/testing.md` are finalised |
| **Runtime filter and sort (REQ-035/037)** | v1.1, decision D2 — TMDB runtime is ambiguous for TV and the record contains no decision. Runtime is still stored, so v1.1 is additive | A decision on TV runtime semantics |
| **Editable date-added (REQ-059)** | v1.1, decision D1. Modelled now (`dateAddedEdited`) so v1.1 is additive, not a migration | ⚠ **Reinstating it reopens decision D3 and `OQ-023`** — creates-only undo rests on it being out of scope |
| **Mixed-changeset batch undo (REQ-069)** | v1.1, decision D3. `REQ-075`'s enumerated refusal plus `REQ-074` re-extraction cover v1 | v1.1, or `REQ-059` being pulled forward |
| **A general change history** | **Explicitly declined by the user at A30.** Recorded so it is not re-proposed | A user decision reversing A30 |
| **VNet, private endpoints, WAF, DDoS protection** | ~~All paid~~ **R3: now affordable, and still not warranted.** The entire data plane is reachable only by managed identity, ingress is authenticated at the platform edge, and there is one user. Each would add resources an autonomous implementer must get right in exchange for no threat this system faces | Multi-user, or regulated data entering scope |
| **A CDN / Front Door in front of the app** *(new deferral, R3)* | Static assets are a few hundred kilobytes from the same origin as the API, and `minReplicas = 1` already removed the first-paint problem a CDN would have solved | Never, at this scale |
| **The compute up-size to 0.5 vCPU / 1.0 GiB** *(new, R6 — `A43`, `OQ-028` CLOSED)* | **Not "deferred" in the usual sense — PRE-AUTHORISED and TRIGGER-GATED.** The owner has seen the price (+~$4/mo → ~$15–18 total), was told the failure can land mid-import, and chose to start at 0.5 GiB. It is a **known remedy**, fully documented and executable in one step, deliberately not paid for until it is needed | **A real OOM, or the `nextup-prod-replica-restart` / `nextup-prod-decode-abandoned` alert firing, or an `IMAGE_TOO_LARGE_TO_DECODE` refusal on an image the owner actually needs.** Procedure: `runbooks/scale-up-memory.md`. **No further owner approval is required — it is already given** |
| **PWA Web Share Target (iOS Share Sheet → nextup)** *(new, R7 — `A45`)* | ⚠ **NOT deferred — RULED OUT, and the distinction matters.** It is not a thing we chose to postpone; it **does not exist on the owner's device.** MDN BCD `manifests/webapp/share_target.json` records `safari: false` and `safari_ios: "mirror"` ⇒ also `false`; WebKit bug **194593** has been **NEW since 2019-02-13**, last touched 2026-05-23. **Do not design around the iOS Share Sheet.** *(Note: `navigator.share()` — outbound sharing — is a different API, is supported on iOS, and does not help here.)* | **Apple implementing it.** It would then beat both paste paths on tap count and ADR-0009 should be reopened |
| **Retaining the original HEIC alongside the derived PNG** *(new, R5 — `OQ-027`, still open)* | The stored artefact is the **derived lossless PNG**; whether to also keep the uploaded HEIC bytes is genuinely undecided. The spec default is **discard after a verified transcode** — it keeps `NFR-019`'s 30-day purge and `REQ-074` re-extraction operating on one artefact, and avoids retaining EXIF/GPS-bearing bytes at rest | **`OQ-027`, open.** An owner preference to keep originals, or a need to re-transcode with a different tool, would force it. ADR-0006 is made consistent with the discard default |

---

## New risks raised by this phase

| ID | Risk | Severity | Response |
|---|---|---|---|
| **RSK-021** | The owner's capture surface may render titles as **box artwork rather than text** (a poster grid with the title baked into the image) | **Low** *(was High — downgraded by ADR-0001 Revision 2)* | **Largely mitigated by design.** The primary reader is a multimodal model that identifies works from poster art; artwork-read candidates arrive flagged `inferred-unverified` with their tile thumbnail shown. `TASK-011` remains useful as evidence but **no longer gates the M3 extraction investment**. Residual: measured artwork recall, gated at ≥ 0.80 (`T-AI-035`) and re-measured by the manual live suite |
| **RSK-022** | TMDB's terms restrict use "in connection with … an AI based Application". A model-assisted matcher, or sending TMDB content to a vision service, could breach it | Medium | Binding architectural rule (ADR-0001): **no TMDB content is ever sent to any AI service; matching is deterministic.** Enforced structurally, and **strengthened in R2** — `T-AI-013` now covers both inference hosts. **Scope clarified (R2.4): the rule binds TMDB content, not the owner's screenshot pixels** |
| **RSK-028** *(new, R2)* | **Fabrication.** The primary reader can emit a fluent, plausible, confident title that is simply wrong — a failure mode that did not exist under Revision 1 and that looks identical to a correct one in a review pass | **Medium** | Four layers, none sufficient alone: (1) the **mandatory OCR cross-check** marks every unsupported title `ocrSupport: 'none'` → verdict `inferred-unverified`; (2) it is **shown beside its tile thumbnail** so verification is a glance (`T-AI-041`); (3) deterministic TMDB matching is an independent plausibility filter; (4) a **measured fabrication-rate gate ≤ 0.05** in CI (`T-AI-032`) and in the live suite. ⚠ **Never mitigated by filtering at runtime** — that would silently discard genuine artwork reads (`T-AI-042`). Accepted and named in ADR-0001 R2.7. **R5 confirmation: layer (2)'s tile-thumbnail crop operates on the stored *post-transcode PNG* bytes, never on raw HEIC — HEIC is not portably renderable client-side (only Safari), so cropping the derived PNG is what keeps this mitigation working across browsers (ADR-0008).** |
| **RSK-023** | ~~Container Apps scale-to-zero cold start (2–8s) lands on the value loop and attacks `SUC-001`~~ | **CLOSED (R3; still closed R4)** | **Cause removed, not mitigated.** `minReplicas = 1` (ADR-0003 R2.1) — **R4: at 0.25 vCPU / 0.5 GiB, ~$5–8/month.** Reopens only if the owner takes leaner variant B |
| **RSK-024** | Free-tier availability is a configuration property, not a guarantee | **Low, and narrowed (R3; unchanged R4)** | **Only one free tier is left in the design:** the Azure AI Vision F0 cross-check, with a priced S1 fallback of $0.05–$0.23/month. The Cosmos free-tier dependence is **gone** — the datastore is **Azure SQL Basic (R4)**, still a paid managed service, so this stays narrowed. `gpt-4.1` regional quota remains a first-sprint check (`TASK-010`) |
| **RSK-025** | No staging environment; a defect CI does not catch reaches the owner's real data directly | **Low** *(was Medium — downgraded by ADR-0003 R2.4; still Low R4)* | **A staging environment now exists**: a second Container App and — **R4** — a **separate serverless auto-paused Azure SQL database** (Azure SQL bills per DB, so ≈$0.50 not $0; ADR-0003 R3.3), plus a second blob container. Revision rollback and the post-deploy smoke test remain |
| **RSK-016** | Extraction/transcode OOM mid-batch. **R5: the HEIC ingest transcode adds a new, larger transient allocation (WASM decode → raw RGBA) on the same 0.5 GiB container.** **R6/`A43`: the owner was shown the priced remedy, was told plainly the failure can land mid-import, and chose to start at 0.5 GiB and up-size only if it actually OOMs** | **Medium — but now an OWNER-ACCEPTED RESIDUAL RISK, not an open one** *(status change at R6, not a severity change)* | **`OQ-028` is CLOSED (`A43`).** The risk is **accepted**, and acceptance is conditional on five **MANDATORY** mitigations — the reactive strategy is only survivable because of them: **(M1)** a **pre-decode dimension/pixel guard** that rejects >25 MP (0.5 GiB) / >16,000 px **before any decode buffer is allocated** — *explicitly retained by the owner even though "mitigate and stay" was not the selected option*; **(M2)** failure blast radius of **exactly one image** — never a partial commit, never a corrupted batch, other images unaffected, retry reconciled with `REQ-074` and the one-transaction close (§Key flows); **(M3)** a surfaced error that **names memory/decode and points at the one-line remedy** — no blind debugging; **(M4)** **`runbooks/scale-up-memory.md`**, executable in one step by someone whose import just died; **(M5)** an **OOM/restart alert** so the trigger is observed, not inferred (§Observability — and note ACA has no distinct OOM-kill signal, so proxies plus an app-emitted sentinel are used). Retained from R4/R5: strictly **serial** image processing, per-image byte ceiling, buffers released between images. **The 1.0 GiB size is the KNOWN REMEDY (+~$4/mo → ~$15–18 total), pre-authorised, not an abandoned alternative.** `NFR-012a` unaffected — this bounds memory, not model choice |
| **RSK-029** *(new, R3; updated R4)* | **The monthly bill is real and every figure in it is unverified.** ~$12/month (Variant A) estimated from model knowledge with no live price check; a materially wrong figure — or a slow drift as Azure prices change — would be discovered on a credit-card statement | **Medium** | (1) `TASK-010` re-verifies every line in the first sprint — **now including Azure SQL Basic and the serverless staging floor**; (2) `TASK-142` adds a subscription **budget alert at 1.5× the published total**, which costs nothing; (3) the cost table publishes the richer variant (~$30) and Variant B (~$0.65) so the owner can move without a re-architecture; (4) **`OQ-026` is CLOSED at `A40` — the owner selected Variant A** |
| **RSK-030** *(new, R3; re-applied R4)* | **Datastore change churn.** R3 was Cosmos → PostgreSQL; **R4 is PostgreSQL → Azure SQL**, which again invalidates the physical parts of `specs/data-model.md`, `api.md`, `testing.md` and `security.md` (types, error codes, CI container, migration tooling). An implementer reading a superseded section would build the wrong thing | **Medium** | Every superseded section is **banner-marked and cross-referenced** to its replacement rather than silently edited (`specs/data-model.md` **§16** is the authoritative Azure SQL chapter; §15 the retained PostgreSQL one). **`TASK-143`'s consistency sweep is WIDENED to cover the PostgreSQL→Azure SQL delta.** No code exists yet — this is still the cheapest this change will ever be |
| **RSK-031** *(new, R4)* | **`Prisma + Azure SQL / SQL Server` is a less-travelled path than `Prisma + PostgreSQL`** — the very training-data mass that `NFR-004` (autonomous-implementability) depends on. Specific soft spots: the `sqlserver` connector's **managed-identity / token auth** is less documented than PG's; filtered-index and `CHECK`-heavy DDL sits in **raw migration SQL**, not the Prisma modeling layer; error-code handling and connection-string form differ | **Medium** | Prisma **STANDS** (ADR-0005 R3.4 — argued, not assumed): the `sqlserver` provider is GA, the destructive-migration gate (`T-MIG-001`) depends on Prisma Migrate's greppable SQL, and SQL-Server-specific DDL is deliberately kept in raw migrations so Prisma's thinner modeling is off the critical path. Mitigations: **(1) pin `prisma` / `@prisma/client` to an exact version;** **(2) the connection string form is fixed** — `sqlserver://<server>.database.windows.net:1433;database=nextup;user=...;encrypt=true;trustServerCertificate=false;connectionLimit=5`; **(3) `M0` runs a smoke migration + a `SELECT 1` round-trip against a real Azure SQL Basic instance BEFORE any feature work** (`TASK-141` reshaped), proving both the migration path and MI-vs-SQL-auth before it can block a feature |
| **RSK-033** *(new, R7 — `A45`)* | **The primary ingest affordance is brittle on the primary device, and one platform fact behind it is UNVERIFIED.** Two distinct exposures. **(a) Brittleness, `verified`:** iOS shows a native paste callout **per invocation and never remembers it** — one extra deliberate tap per screenshot, forever — and **any stray tap, tab switch or backgrounding SILENTLY REJECTS the promise** with no error dialog. A naive implementation looks like a hang. **(b) Unverified fact, labelled rather than smoothed over:** the researcher **could not establish** whether iOS displays a paste callout over **non-editable** content after WebKit PR #38127 (merged 2025-01-07; bug 75891 closed 2026-03-13). **No primary source was found either way** — the "it does not" reading is `inferred`, and it is the single most consequential unverified item in `Context/evidence/clipboard-paste-support.md`. Which iOS release carries PR #38127 is also **unknown** (no release-notes source located) | **Low–Medium** | **(b) is neutralised by construction, not by hope: the design routes around the question rather than betting on it.** The **button + `navigator.clipboard.read()`** path is `verified` to work on iOS 13.4+ regardless of the answer, and the desktop `paste` listener is `verified` on desktop regardless. If the answer turns out to be "yes, iOS does show a callout", the button is merely *redundant on newer iOS* — never wrong. **(a) is accepted and handled in the UI, not engineered away**, because it cannot be: **promise rejection is the EXPECTED case, not an exception path** — the UI detects it and **re-offers** ("Paste cancelled — tap to try again"), never hangs and never shows a stack trace. **And the structural mitigation is the one that matters: file upload is RETAINED as the floor**, so both (a) and (b) degrade to a working, universal path rather than to a broken product. ⚠ **The inferred-not-verified status of (b) is recorded here as a standing ARCHITECTURAL ASSUMPTION** — that iOS does *not* offer a paste callout over non-editable content — **and it is owed an entry in `Context/assumptions.md` (owned by another agent, named here, not written there).** ADR-0009 §Residual uncertainty |
| **RSK-032** *(new, R5)* | **A new third-party image dependency with an LGPL-3.0 codec.** `heic-convert` → `libheif-js` (LGPL-3.0, WASM) is required to accept the owner's HEIC uploads. Two exposures: (a) an **LGPL-3.0 notice obligation** on this MIT repo — omitting it is a licence non-compliance; (b) a maintained-dependency risk (the WASM codec must keep tracking upstream `libheif`) | **Low** | **Decode-only** — no GPL `x265`, no patent-encumbered encoder (`Context/evidence/heic-support.md`). ISC wrappers, LGPL-3.0 floor. Mitigations: **retain the LGPL-3.0 notice in `NOTICE`/`THIRD-PARTY`, use the library unmodified, pin exact versions, and the dependency allow-list asserts no `x265`/encoder transitive appears** (`TASK-144`, human licence sign-off). Compatible with shipping an MIT app under these conditions — flagged for a human, this is analysis not legal advice (ADR-0008) |

---

## Architecture decision records

| ADR | Decision | Status | Forced by |
|---|---|---|---|
| [ADR-0001](adr/ADR-0001-vision-ocr-extraction.md) | **Rev 2 (current):** Azure OpenAI `gpt-4.1` multimodal vision as the primary extractor **+ Azure AI Vision `Read` OCR (F0) as a mandatory deterministic cross-check**, both behind the unchanged `TitleExtractor` interface. **~$0.50–$0.70/month. Re-closes OQ-005. Drops RSK-021 High→Low. Raises RSK-028.** <br> *Rev 1 (superseded, retained verbatim): Azure AI Vision Read OCR (F0) as the sole extractor, $0.00/month.* | **Accepted (Rev 2)** *(A41 re-examined — stands unchanged)* | **NFR-012a (A40)**, RSK-021, REQ-008, REQ-012, REQ-058, NFR-004 |
| [ADR-0002](adr/ADR-0002-identity-provider.md) | Microsoft Entra ID via Container Apps built-in auth; allow-list in middleware. **Closes OQ-019.** | Accepted *(A41 re-examined — stands; staging adds a second app registration)* | NFR-015, NFR-016, NFR-017, NFR-002 |
| [ADR-0003](adr/ADR-0003-hosting-and-compute.md) | **Rev 4 (current): compute STAYS 0.25 vCPU / 0.5 GiB (`A43`, `OQ-028` closed); 0.5 vCPU / 1.0 GiB becomes the pre-authorised REACTIVE remedy with a runbook, a mandatory pre-decode pixel guard, one-image blast radius, a self-explaining error and an OOM/restart alert. `RSK-016` → owner-accepted residual.** <br> *Rev 3 (retained verbatim): one Azure Container App, `minReplicas = 1`, 0.25 vCPU / 0.5 GiB, ghcr.io registry, serverless auto-paused staging DB, ~$5.5–8.5/month.* <br> *Rev 2 (retained verbatim): `minReplicas = 1`, 0.5/1.0 GiB, ACR Basic, staging on the shared PG server, ~$14–17.* <br> *Rev 1 (retained verbatim): scale-to-zero, ghcr.io, no staging, $0.* | **Accepted (Rev 4)** | **A43 (OQ-028)**, A40 (Variant A), SUC-001, NFR-002, NFR-004, REQ-041, RSK-016 |
| [ADR-0004](adr/ADR-0004-application-stack.md) | TypeScript end to end — React + Vite / Node + Express **+ Prisma**; NFR-004 applied as a real technical criterion | Accepted *(A41 re-examined — stands, one addition)* | NFR-002, NFR-003, NFR-004 |
| [ADR-0005](adr/ADR-0005-datastore-and-data-model.md) | **Rev 3 (current): Azure SQL Database Basic (5 DTU, 2 GB), a separate serverless staging DB, Prisma `sqlserver`.** Invariants stay filtered-unique-index constraints; batch close stays one transaction. **7-day PITR; raises RSK-031 (Prisma+SQL Server less-travelled). ~$5.5/month.** <br> *Rev 2 (retained verbatim): Azure Database for PostgreSQL Flexible Server (B1ms), two databases, Prisma, 35-day PITR, ~$15.* <br> *Rev 1 (retained verbatim): Cosmos DB for NoSQL free tier, one logical partition per owner, $0.* | **Accepted (Rev 3)** | **A40 (Variant A)**, NFR-004, NFR-003, REQ-005, REQ-028, REQ-071, RSK-031 |
| [ADR-0006](adr/ADR-0006-screenshot-storage-and-retention.md) | Private blob, authenticated streaming, lifecycle purge; **no URL that works without a session**; **blob soft delete/versioning explicitly forbidden** | Accepted *(A41 re-examined — stands, one prohibition added)* | NFR-011, NFR-019, NFR-020 |
| [ADR-0007](adr/ADR-0007-work-identity-and-unmatched-fallback.md) | Single opaque `workIdentity` with an `unmatched:<hash>` fallback that is **also** the suppression key — **now enforced by a `UNIQUE` constraint** | **Accepted as amended** (OQ-015 closed in phase 8 by SD-01/SD-05/SD-06) | REQ-024, REQ-065, REQ-071 |
| [ADR-0008](adr/ADR-0008-heic-transcode-on-ingest.md) | **Rev 3 (current, R7/`A45`): the transcode becomes CONDITIONAL ON THE SNIFFED TYPE — transcode IFF sniffed HEIC/HEIF. NOT weakened, NOT removed: the iOS Photos upload path still delivers raw HEIC. Pasted images are always `image/png`, so they take the skip branch as a CONSEQUENCE of a verified platform fact, not as an optimisation — and the branch must key on the SNIFF, never on the ingest source. `REQ-078`'s EXIF strip STAYS on the upload path (WebKit strips EXIF on clipboard read but NOT on file upload).** <br> *Rev 2 (retained verbatim, R6/`A43`): unchanged library decision, plus the now-MANDATORY memory containment — a pre-decode dimension/pixel guard (25 MP at 0.5 GiB / 50 MP at 1.0 GiB), one-image failure isolation reconciled with `REQ-074` and the transactional close, and an error text that names memory and points at `runbooks/scale-up-memory.md`.* <br> *Rev 1 (retained verbatim): accept PNG + JPEG + HEIC/HEIF; transcode HEIC/HEIF → lossless PNG server-side, inline in the upload request, before the blob is written, using `heic-convert` (WASM `libheif-js`, decode-only) chained to `sharp`; strips EXIF/GPS. LGPL-3.0 notice obligation; raises RSK-032.* | **Accepted (Rev 3)** | **A45**, A43 (OQ-028), ASM-058 (supersedes falsified ASM-034), A42, REQ-004, REQ-007, **REQ-078**, REQ-074, NFR-012a, NFR-019, RSK-016 |
| [ADR-0009](adr/ADR-0009-dual-primitive-clipboard-ingest.md) *(new, R7)* | **Dual-primitive clipboard ingest, with file upload RETAINED — three affordances, one pipeline.** (1) a document-level **`paste` event listener** for desktop Ctrl/Cmd+V (no prompt, all four browsers); (2) a visible **"Paste screenshot" button** calling `navigator.clipboard.read()` — the **only verified iOS path** (iOS 13.4+), accepting a per-invocation system callout that is never remembered; (3) **`<input type="file">` retained as the floor**, the only path serving the laptop save-then-upload case and the iOS Photos case. Hidden `contenteditable` traps **prohibited**; **Web Share Target RULED OUT** on iOS. HTTPS is a functional dependency. **$0 cost; raises RSK-033.** | **Accepted** | **A45**, REQ-004, REQ-007, REQ-078, NFR-006, NFR-015, NFR-002, NFR-004 |
| — | **Runbook (not an ADR, but load-bearing):** [`runbooks/scale-up-memory.md`](runbooks/scale-up-memory.md) — the exact reactive up-size procedure required by `A43-M4` | Active | A43, RSK-016 |

---

## Handover to `spec-writer`

> ⚠ **REVISION 7 addendum (`A45`) — six obligations. `a`–`c` are
> correctness-critical.** Clipboard paste is now the **primary** ingest
> affordance and file upload is **retained** (ADR-0009; ADR-0008 Rev 3).
> *(Specs and backlog are owned by other agents; the obligations are named
> here, not edited there.)*
>
> a. **`specs/api.md` §5 — the transcode branch keys on the SNIFFED TYPE,
>    never on the ingest source.** `if (sniffed === 'heic'|'heif')
>    transcode()`. **`if (source === 'paste') skipTranscode()` is WRONG**
>    — it trusts the caller instead of the bytes. The pre-decode pixel
>    guard (`A43-M1`) and the size ceiling apply to **pasted images
>    identically**.
> b. **`specs/security.md` §4.2 / `specs/testing.md` — `T-SEC-032` must be
>    asserted against an UPLOADED image carrying real EXIF/GPS.** WebKit
>    strips EXIF on clipboard read but **not** on file upload, so
>    asserting the control against a pasted image **passes vacuously**.
>    `REQ-078` stays on the upload path and stays mandatory.
> c. **`specs/ui.md` — the iOS affordance is a VISIBLE BUTTON, not a
>    gesture**, feature-detected on `navigator.clipboard?.read` **and** a
>    secure context. **A hidden `contenteditable` trap is prohibited.**
>    The desktop primitive is a document-level `paste` listener reading
>    `event.clipboardData.files` — **do not call `clipboard.read()` on the
>    desktop path**, it is strictly worse there.
> d. **`specs/ux-states.md` — promise rejection is the EXPECTED case.**
>    Three states owed: idle, awaiting-callout, rejected-and-re-offered
>    ("Paste cancelled — tap to try again"). Never a hang, never a stack
>    trace. A non-image clipboard item is ignored, not an error.
> e. **`specs/testing.md` — the iOS paste case is MANUAL, real-device,
>    over HTTPS.** CI covers the desktop `paste` handler and the shared
>    ingest entry point only. Record the gap; do not fake it.
> f. **`specs/api.md` — one ingest entry point takes
>    `(bytes, sniffedType, source)`** with
>    `source ∈ {paste-event, paste-button, upload}`, logged for the
>    `A43-M5` decode sentinel. **Operational, not analytics** (`NFR-005`
>    not engaged).
>
> **Requirement IDs for the paste affordance are owned by
> `requirements-clarifier`/`prd-writer`, not by this role.** This revision
> references `A45` and `REQ-004`/`REQ-007`/`REQ-078` as they stand.

> ⚠ **REVISION 6 addendum (`A43` / `OQ-028`) — five obligations, all
> MANDATORY, none of them optional.** The owner chose to start at
> 0.25 vCPU / 0.5 GiB and up-size only on a real OOM. That is only
> defensible with the containment below, so these are **acceptance
> criteria, not suggestions.** *(Specs and backlog are owned by other
> agents; the obligations are named here, not edited there.)*
>
> a. **`specs/api.md` §5.1 — the pre-decode dimension/pixel guard
>    (`A43-M1`).** Reject `width × height > NEXTUP_MAX_DECODE_PIXELS`
>    (**`25000000` at 0.5 GiB**), or either dimension `> 16000` / `< 50`,
>    or an unparseable header — **before allocating any decode buffer**,
>    reading the HEIF `ispe` box / PNG IHDR / JPEG SOFn. The byte ceiling
>    is a first filter, **not** the guard.
> b. **`specs/api.md` / `specs/ux-states.md` — two distinct error codes
>    (`A43-M3`):** `IMAGE_TOO_LARGE_TO_DECODE` and `IMAGE_DECODE_OOM`
>    both name memory and cite `runbooks/scale-up-memory.md`;
>    `IMAGE_DECODE_FAILED` (corrupt file) **must not** mention memory or
>    the up-size. Exact text: ADR-0008 R2.3.
> c. **`specs/testing.md` — three assertions:** one image failing does not
>    fail the batch and commits nothing (`A43-M2`); an oversized image is
>    refused **without** a decode allocation; and `T-INFRA-005` asserts the
>    **pair** `0.25 vCPU / 0.5 GiB` **and**
>    `NEXTUP_MAX_DECODE_PIXELS=25000000` — they must never drift apart.
> d. **Infrastructure — the `A43-M5` alert rules** (`nextup-prod-replica-
>    restart` on `RestartCount` Total > 0 / 5 min;
>    `nextup-prod-memory-pressure` on `WorkingSetBytes` Avg > 400 MiB;
>    `nextup-prod-decode-abandoned` as a log-search alert on the
>    `image.decode.begin`-without-`end` sentinel), plus the sentinel log
>    lines themselves. **~$0.60–1.00/month.**
> e. **Verification owed with `TASK-010`:** that `RestartCount` and
>    `WorkingSetBytes` exist as alertable metrics for
>    `Microsoft.App/containerApps`, and whether any OOM/termination-reason
>    dimension exists at all. **Azure Container Apps is believed NOT to
>    surface OOM-kill distinctly** — if that turns out to be wrong, adopt
>    the real signal and demote the proxies.
>
> **`REQ-074` ⇄ transactional-close reconciliation** is in §Key flows and
> ADR-0008 R2.2 and must not be re-derived: a guard rejection or decode
> OOM stores **nothing**, so `REQ-074` cannot help and the file must be
> **re-attached**; only an OOM on an **already-stored** image is a
> `REQ-074` case — and only within the 30-day `NFR-019` window.

> ⚠ **REVISION 4 addendum (supersedes the physical parts of the R3
> addendum below).** The datastore is now **Azure SQL Database Basic**,
> not PostgreSQL. The domain reasoning still survives; the physical
> deltas owed on top of R3, tracked under the **widened `TASK-143`**:
>
> a. **`specs/data-model.md` §16** — the authoritative **Azure SQL**
>    schema (added this pass). It supersedes §15 (the R3 PostgreSQL
>    chapter, retained) for all physical types, DDL and migration
>    tooling. Type mapping: `text`→`NVARCHAR(n|MAX)`, `timestamptz`→
>    `DATETIME2(3)` UTC, `uuid`/ULID→`NVARCHAR` (not `UNIQUEIDENTIFIER`),
>    `boolean`→`BIT`, `text[]`/`jsonb`→`NVARCHAR(MAX)`+`CHECK(ISJSON()=1)`,
>    `bigserial`→`BIGINT IDENTITY`. The three invariants stay **filtered
>    unique indexes** (`CREATE UNIQUE INDEX ... WHERE`).
> b. **`specs/api.md`** — constraint-violation mapping is now Azure SQL
>    error **2601/2627** (not Postgres `23505`).
> c. **`specs/testing.md`** — the integration/CI store container is
>    **`mcr.microsoft.com/mssql/server:2022-latest`** (ACCEPT_EULA,
>    `MSSQL_SA_PASSWORD`, health-wait via `sqlcmd`), not
>    `postgres:16-alpine`; `T-MIG-001`'s destructive-migration grep is
>    restated for Azure SQL DDL forms; `T-INFRA-005` asserts Azure SQL
>    Basic / ghcr.io / 0.25–0.5 compute.
> d. **`specs/security.md`** — secrets go from one to **2–3**: the
>    **ghcr.io PAT returns** (a quietly-expiring credential); the DB
>    credential is **secretless if MI works, else a Key-Vault-referenced
>    SQL password** (does not silently expire); backup row becomes
>    **7-day** PITR; RBAC loses `AcrPull`.
>
> Azure SQL Agent jobs and Elastic Jobs are **explicitly prohibited**,
> exactly as `pg_cron` was (REQ-028). See `RSK-031` for the Prisma+SQL
> Server mitigation.

> ⚠ **REVISION 3 addendum.** The phase-8 specs were written against the
> Cosmos design. They are **not** discarded — the domain reasoning in
> them is store-agnostic and survives — but the following are now owed,
> and are tracked as `TASK-143`:
>
> a. **`specs/data-model.md` §15** — the authoritative relational schema
>    (added this pass). It **supersedes** §1, the physical shapes in §3,
>    §5.4, §7.3, §10 and §13 of that document, each of which now carries a
>    banner pointing at it.
> b. **`specs/api.md`** — `cursor` is now an **opaque base64url keyset
>    cursor**, not a Cosmos continuation token; the error envelope's
>    forbidden-content rule now names Postgres diagnostics and connection
>    strings.
> c. **`specs/testing.md`** — the integration store fixture is
>    `postgres:16-alpine`, not the Cosmos emulator; `T-INV-013` is
>    repointed from "no Cosmos TTL" to "no scheduled deletion mechanism
>    exists and `DELETE` appears in exactly one module"; `T-INFRA-005`
>    now asserts the *selected* SKUs rather than that every SKU is free;
>    **new: a migration test that a `DROP COLUMN` fails CI** (REQ-028).
> d. **`specs/security.md`** — one secret instead of two; the RBAC table
>    gains `AcrPull` and the PostgreSQL Entra administrator role and
>    loses the Cosmos data-plane role; the dependency allow-list swaps
>    `@azure/cosmos` for `@prisma/client`; the backup row becomes 35-day
>    PITR; **new: the staging environment's allow-list is configured
>    independently and is not a route into production data.**
>
> An implementer who reads a superseded section without its banner will
> build the wrong thing — that is `RSK-030`, and the banners are its
> mitigation.

Obligations this architecture creates, none of which are optional:

1. **`specs/data-model.md`** — full schemas; the ADR-0007
   normalisation table as **one exported function**; the invariant list
   (at most one non-removed title per `(owner_id, work_identity)`;
   derived `state` and `sort_date_added` computed in exactly one place);
   entity names matching `diagrams/data-model-erd.md` exactly. **And an
   explicit statement of whether creates-only undo discards or
   soft-removes the records it reverses** — the architect recommends
   discard (see `sequence-batch-undo.md`); an implementer will otherwise
   pick one silently.
2. **`specs/api.md`** — route layout, error envelope, validation
   placement, the owner-scoping middleware contract, and per-image /
   per-batch upload ceilings.
3. **`specs/ai.md`** — the Stage 2 clean-up heuristics, which must
   **classify and surface, never drop and hide** (REQ-012); the
   deterministic matching strategy; and the `REQ-058` guard.
4. **`specs/security.md`** — session lifetime, the principal-adapter
   contract, the allow-list test, the dev-shim exclusion test, and the
   data-classification table above.
5. **`specs/testing.md`** — elevated to a primary deliverable by
   `NFR-003`. The non-negotiable core: US-001 AC-4 (allow-list refusal),
   US-013 AC-6 (full-update review shows already-known titles),
   US-024 AC-6 (do not de-duplicate the removed view), US-028 AC-3
   (suppress → remove → re-upload), US-011 AC-5 (TMDB attribution), plus
   the two storage assertions (no blob URL in any response; **no
   scheduled deletion mechanism anywhere in the database**).
6. ~~**`OQ-015`**~~ — **DONE in phase 8.** ADR-0007 was adopted *as amended* (SD-01/SD-05/SD-06 in `specs/data-model.md`); OQ-015 is closed. The one substantive amendment: the extracted year is EXCLUDED from the fallback hash, because a year present on one capture and absent on the next would split one work into two identities and silently bypass an existing suppression.
   Remember A34's constraint: **the fallback identity and the fallback
   suppression key are the same decision.**
7. **First-sprint verification tasks** (not blockers): **PostgreSQL
   Flexible Server B1ms pricing, storage/backup charges and regional
   availability; ACA idle-rate billing at 0.5 vCPU / 1 GiB; ACR Basic
   price;** `gpt-4.1` availability, quota and token pricing in the chosen
   region; Vision F0 allowance and region — **all under `TASK-010`,
   extended this pass.** Plus `TASK-142` (budget alert), `TASK-141`
   (Entra-token refresh for the Postgres connection), `TASK-143` (spec
   consistency sweep), and **Azure OpenAI modified abuse monitoring
   exemption (`TASK-134`) before the first real upload.**
   `OQ-024` (`TASK-011`) is still worth doing as evidence but **no
   longer gates the extraction investment**.
8. **The extraction determinism boundary is explicit and must not be
   blurred** (`specs/ai.md` §9.0, `specs/testing.md` §4/§4A): CI stays
   offline and byte-deterministic against **recorded** provider
   responses; live model quality is measured **manually**, in **bands
   over 3 runs**, and **never** by exact-equality assertions.

---

*This document uses Mermaid as the single source of truth for every
diagram (`.github/instructions/diagramming.instructions.md` §1). draw.io
and Excalidraw exports were requested as unavailable for this session and
were not produced; per §6.3 rule 4 that is stated plainly and the Mermaid
is the deliverable.*

