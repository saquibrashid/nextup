# Product Requirements Document — nextup

**Project:** nextup
**Version:** 1.0 (v1 scope, plus a clearly-marked v1.1 section)
**Status:** Approved MVP scope — locked at the phase 4 lock (`Context/mvp-definition.md` §17–§18)
**Authoritative inputs:** `artifacts/BRD.md`, `Context/mvp-definition.md` (§17 lock addendum and §18 lock status override the body; §16 is historical/superseded), `Context/requirements.md`, `Context/assumptions.md`, `Context/open-questions.md`, `Context/research-summary.md`
**Audience:** the implementer. Implementation will be performed by GitHub Copilot in autopilot mode (ASM-028, ASM-029, NFR-002, NFR-003, NFR-004). This document, together with the specs, IS the implementation input. Acceptance criteria are written to be executable and verifiable without asking a question.
**No timeline.** Per A19 / ASM-027 this document contains no dates, durations, or sequencing commitments beyond dependency order.

---

> ## ⚠ AMENDMENT — 2026-08-11 — `A43` / `OQ-028`: the memory decision, and the user-visible limitation it creates
>
> **The owner answered `OQ-028` verbatim: *"Start at 0.5 GiB, up-size only if it OOMs."*** `OQ-028` is **CLOSED**, with the residual risk **knowingly accepted** — the owner was explicitly told the failure could land mid-import.
>
> | | |
> |---|---|
> | **Compute stays** | 0.25 vCPU / 0.5 GiB, `NEXTUP_MAX_DECODE_PIXELS=25000000` — **≈$11–14/month** (Variant A, chosen at A40). **This is what ships.** |
> | **Remedy (pre-authorised, trigger-gated)** | 0.5 vCPU / 1.0 GiB, guard → 50 MP — **+~$4/month → ≈$15–18/month**. `artifacts/runbooks/scale-up-memory.md`. **Approval is already given; it is applied reactively on a real failure and MUST NOT be taken pre-emptively.** |
>
> **Changed in this document — instructions corrected in place, not superseded by banner:**
>
> | Where | Change | Kind |
> |---|---|---|
> | **US-004 AC-9, AC-10, AC-11** | **NEW acceptance criteria** — pre-decode pixel guard, one-image blast radius, self-explaining error. | **Instruction** |
> | **US-004 AC-7** | Corrected in place: HEIC acceptance is now explicitly conditional on the AC-9 guard; the prior unconditional wording is struck through. | **Instruction** |
> | §7.5 validation table | Two new rows: image pixel dimensions, unparseable header. | **Instruction** |
> | **§7.8 (new)** | **Known limitations — `KL-1`: ~48 MP camera captures are refused at 0.5 GiB.** | Disclosure |
> | §8 NFR-012, §2.1 G-9, US-039 AC-4 | Cost band now carries **both** figures: ≈$11–14 as designed, ≈$15–18 if the remedy is taken. Both compliant. | **Instruction** |
> | US-039 AC-2 | US-004 AC-10 added to the mandatory automated-test list. | **Instruction** |
> | §9.2, §12.2, §12.3 R-12, §A.7 | Per-file rejection state; cost-creep definition; the accepted-residual risk row; `OQ-028` closed. | Rationale + status |
>
> ⚠ **One contradiction was put to this document and is rejected, not absorbed** — the claim that photographing a TV screen is a *supported* capture path. It is not: **A15-correction / ASM-021 / REQ-051** removed it. See §7.8 for the full statement.

---

> ## ⚠ AMENDMENT — 2026-08-11 — `A45`: clipboard paste is the PRIMARY ingestion interaction — and file upload stays, in full
>
> **The owner stated, verbatim:** *"Also for screenshots, I'm generally expecting that I will take a screen grab and paste it into the app directly rather than saving it to my device first and then uploading it to the app."*
>
> **This is an ADD, not a SWAP.** Clipboard paste becomes the primary, first-class ingestion interaction. **File upload remains fully supported and first-class** — it is not a fallback, not deprecated, and must not be trimmed. Two ordinary paths depend on it: the **laptop web-screenshot** path and the **iOS Photos** path, which is where an iOS screenshot lands *by default*. (This is the A42 lesson repeating: there, PNG/JPEG were nearly swapped out for HEIC when all three were needed.)
>
> Grounded in `Context/evidence/clipboard-paste-support.md` (primary-source research, **authoritative**). Load-bearing findings: paste works on iPhone **only via a visible "Paste screenshot" button calling `navigator.clipboard.read()`** (iOS 13.4+) — a document-level paste listener is not a supported iOS interaction on non-editable content; **desktop wants the opposite primitive** (a Ctrl/Cmd+V `paste` event, no prompt); **HTTPS is mandatory**; and a **PWA Web Share Target is ruled out on iOS** — do not promise a Share Sheet flow.
>
> ⚠ **The caveat that qualifies the owner's expectation, stated plainly:** iOS screenshots go to **Photos by default, not the clipboard**. The paste path exists only if the owner taps **"Copy"** on the transient screenshot preview before it fades. If they miss it, they are on the upload path. Realistic step counts are **paste ~3, upload ~4** (`inferred`, not device-measured). **Paste is an accelerant, not a replacement — which is exactly why upload stays first-class.** See §7.8 **KL-2**.
>
> **Changed in this document — instructions corrected in place, not superseded by banner:**
>
> | Where | Change | Kind |
> |---|---|---|
> | **US-004 AC-12 … AC-17** | **SIX NEW acceptance criteria** — desktop Ctrl/Cmd+V paste; the iOS "Paste screenshot" button; paste **appends** to the existing open batch (same `UploadBatch` model); rejection detected and re-offered; capability-absent degradation with upload standing alone; one shared server-side pipeline and the EXIF strip **still** mandatory. | **Instruction** |
> | **US-004 title, narrative, AC-1, AC-4, AC-6** | Corrected in place: ingestion is three input paths, not one. AC-1's superseded upload-only wording is struck through. | **Instruction** |
> | §7.5 validation table | Three new rows: input path, clipboard-read availability (HTTPS / iOS 13.4+), clipboard-read rejection. | **Instruction** |
> | §7.6 capture guidance | The "tap Copy on the screenshot preview" precondition, and both routes stated. | **Instruction** |
> | **§7.8 KL-2 (new)** | **Known limitation — the "Copy" step, the per-paste system callout, and the honest one-tap size of the win.** | Disclosure |
> | §1, §2.1 G-3, §3 P-1, §4 J-2/J-3, §8 NFR-001/NFR-006, §9.2 | Ingestion wording; the paste button falls under the 320px floor; the EXIF strip is explicitly **not** discharged by WebKit's clipboard stripping; paste/rejection states. | **Instruction** + rationale |
> | §12.3 **R-13** (new), §A.6, §A.8 | iOS paste brittleness risk; a **second source-document discrepancy** reported (REQ-001 / ASM-012 still say "upload" is the *sole* mechanism); assumption note. | Rationale + status |
>
> **Acceptance-criteria count: 236 → 242** (+6, US-004 AC-12 … AC-17). No AC was deleted and none was superseded by a struck-through row, so the arithmetic is a clean addition under the counting convention in `specs/testing.md`. **`specs/testing.md` is being edited in parallel and cannot see these six — the orchestrator must reconcile.**
>
> ⚠ **Amended again at `A46`: 242 → 241.** The list-staleness-nudge concept (REQ-040, ASM-038) is dropped entirely per the owner's verbatim answer — *"Drop the concept entirely — no staleness nudge."* US-022 AC-2 is deleted outright (not struck through — it was an instruction, not rationale). US-022's remaining ACs keep their existing numbers (AC-1, AC-3, AC-4, AC-5); the sequence deliberately skips AC-2 and MUST NOT be renumbered. REQ-039 (the factual last-updated date), NFR-014 (TMDB metadata staleness) and NFR-019 (image retention) are untouched. **`specs/testing.md`'s reconciliation banner is being updated to 241 by another agent.**
>
> ⚠ **Goal/metric check (done, result: no metric changes).** G-3 is amended to name paste, but **M5 is unaffected**: M5 measures whether the *review pass* was tolerable, and paste saves roughly one tap **per image at capture time**, not one second of review. Anyone hoping A45 answers the M5 kill risk should be told plainly that it does not.

---

## 1. Overview

nextup is a single-user, mobile-first responsive web application that gives one owner a single combined view of the titles they have saved across more than one streaming service. Streaming services do not expose saved lists to third parties and credentialed sync is non-viable (`Context/research-summary.md`), so nextup is fed by the owner: they screenshot each service's own saved list from the native phone app or the laptop web app, **get those images into nextup — normally by pasting the screen grab straight in, and equally validly by selecting or dragging the saved file (A45, US-004 AC-12 … AC-17)** — and nextup extracts the titles by OCR/vision, matches them against TMDB, and merges them into one row per work with a badge for each service that holds it. Every extraction passes through a human review pass before it changes any list state. Sign-in is federated, and the application serves exactly one allow-listed owner. v1 covers Netflix and Max.

**One-sentence MVP:** A private, mobile-first web app where the owner gets screenshots of their Netflix and Max saved lists into nextup — pasting them straight in, or uploading the files — and gets back one deduplicated, filterable, sortable combined watchlist, with every change reviewed before it lands, and nothing ever silently deleted.

The product contains two loops that must not be confused:

- **The value loop** (frequent, the reason the product exists): open nextup → filter/sort → pick something → deep-link out to the service.
- **The feeder loop** (infrequent, the cost the owner pays): screenshot → **paste it in (primary) or upload the saved file** → review → confirm.

The feeder loop's ergonomics are the single largest adoption risk (M5, OQ-011). Every design decision below that looks conservative — showing already-known titles during a full update, ticking removals by default but requiring an explicit group confirm, never hard-deleting — exists because the owner is the only source of truth and a silent data loss is unrecoverable and undetectable.

---

## 2. Goals and non-goals

### 2.1 Goals

| # | Goal | Traces to |
|---|---|---|
| G-1 | Give the owner one combined, deduplicated view of everything they have saved across Netflix and Max, one row per work with a badge per service. | OBJ-1, REQ-024, REQ-025, REQ-026 |
| G-2 | Make the combined list actually decidable: filter by service, type and genre, sort by when the title entered nextup. | OBJ-2, REQ-032, REQ-033, REQ-034, REQ-036 |
| G-3 *(amended by **A45**)* | Make feeding the list cheap enough to keep doing: **get the capture in by the shortest path the platform allows — clipboard paste as the primary interaction, with file selection and drag-and-drop equally supported** — then multi-image batching, batch review, group confirmation. ⚠ The capture-entry saving is real but **small and honest: roughly one tap per image** (§7.8 KL-2). **The dominant cost in this goal remains the review pass, and paste does not reduce it** — so this goal is still measured by M5, and M5's kill criterion is untouched by A45. | OBJ-3, M5, REQ-004, REQ-020 |
| G-4 | Never mutate list state without the owner seeing and approving the change first. | OBJ-4, REQ-013, REQ-020, REQ-041 |
| G-5 | Never lose data. Nothing is hard-deleted; removals are reversible; batches are reversible where safe and explicitly refused with a full enumeration where they are not. | OBJ-5, REQ-028, REQ-056, REQ-063, REQ-067, REQ-075 |
| G-6 | Make absence meaningful only where the owner has said it is meaningful: inside a closed full-update batch for exactly one service. | OBJ-4, REQ-002, REQ-005, REQ-022, REQ-023 |
| G-7 | Let the owner permanently stop caring about a work, in a way that survives that work reappearing in a later capture. | OBJ-6, REQ-070, REQ-071 |
| G-8 | Keep the owner's data private to the owner and keep third-party obligations met (TMDB attribution, no streaming credentials, no automated requests to streaming services). | OBJ-7, NFR-001, NFR-009, NFR-010, NFR-013, NFR-015 |
| G-9 *(amended by A41, quantified by A40, cost band widened by **A43**)* | Be buildable and verifiable by an autonomous coding agent, on a mainstream stack, at a cost that is **as low as reasonable without degrading quality** (~~within free-tier / consumption-priced Azure~~ — repealed at A41; **≈$11–14/month, owner-selected Variant A — and ≈$15–18/month if the pre-authorised memory remedy is taken**, +~$4/month, `runbooks/scale-up-memory.md`, A43). Both figures are in-goal: the remedy is **already approved**, so taking it is compliance with this goal, not a breach of it. ⚠ The selected variant puts the stack on **Prisma + Azure SQL**, a less-travelled path than Prisma + PostgreSQL — a live tension with this very goal, tracked as **RSK-031** and gated by an M0 smoke migration. | OBJ-8, OBJ-9, NFR-002, NFR-003, NFR-004, NFR-012 |

### 2.2 Non-goals (v1)

| # | Non-goal | Why | Traces to |
|---|---|---|---|
| NG-1 | Any automated retrieval of saved lists from a streaming service — no credentials, no scraping, no headless browsing, no unofficial APIs. | Non-viable and hostile to the services' terms; established in research. | NFR-009, NFR-010, REQ-042 |
| NG-2 | Multi-user accounts, sharing, household profiles, or any social feature. | Single-owner product. | REQ-043, REQ-044 |
| NG-3 | Availability/"where can I stream this" data, price tracking, or recommendations. | Out of the problem being solved. | REQ-046, REQ-047 |
| NG-4 | Watched/progress tracking or ratings. | The list is a "want to watch" list only. | REQ-048, REQ-049 |
| NG-5 | Native mobile applications. | Responsive web only. | REQ-050 |
| NG-6 | Notifications, background jobs that change list state, telemetry or analytics. | The owner is the only actor on list state. | REQ-041, REQ-051, REQ-052, NFR-005 |
| NG-7 | Services beyond Netflix and Max. | v1 scope lock. | REQ-053 |
| NG-8 | Runtime-based filtering and sorting; editing the date-added value; undo of mixed-changeset batches. | Deferred to v1.1 — see §11.2. | REQ-035, REQ-037, REQ-059, REQ-069 |

---

## 3. Personas

### P-1 — The owner (primary, and the only user)

| Attribute | Value |
|---|---|
| Role | Sole user, sole data source, sole decision-maker, and the entire feeder loop. |
| Context | Has saved lists on Netflix and Max that have drifted apart. Loses time at the point of choosing something to watch, usually on a couch, usually with someone waiting. |
| Technical level | Technically comfortable. Will tolerate a manual capture step if the payoff is real. Will not tolerate a review pass that feels like data entry. |
| Primary device | Phone (portrait). Screenshots are taken on the phone, and normally **pasted straight into nextup** from the screenshot preview's "Copy" action; when that is missed, the screenshot is in Photos and is uploaded from there (A45, §7.8 KL-2). |
| Secondary device | Laptop browser, used for the large first-run import and occasionally for bulk review. Screen grabs are pasted with **Ctrl/Cmd+V**, or the saved file is selected or dragged in. |
| Frequency | Value loop: several times a week. Feeder loop: roughly monthly, plus a large one-time first-run import. |
| Motivation | Stop the two-app shuffle. See everything in one place and decide fast. |
| Frustration | Silent data loss. A list that quietly drops titles is worse than no list, because the owner cannot detect the loss and has no backup. |

**Assumption (ASM-058 supersedes falsified ASM-034) and confirmed fact (ASM-035, A44):** the owner uploads **PNG, JPEG, or HEIC/HEIF** screenshots (A42 — the owner stated "iOS screenshots save as heic"; the phone is the primary capture device per ASM-007 / A15) and — **confirmed, not assumed, at A44** ("Newest-first — conventional, recent saves on top") — the combined list defaults to most-recently-added first. iOS delivers all three formats and **the format cannot be predicted from the capture path** — *camera photos* default to HEIC, an iOS Safari file input can hand over any of the three, and the laptop-web path produces PNG. All three are accepted; HEIC/HEIF is transcoded server-side on ingest, and the format is decided by **magic bytes, never by the declared `Content-Type`**.

⚠ **Measured at TASK-151, and it corrects this paragraph's former rationale.** The owner's own iOS screenshot fixture (`tests/fixtures/golden/ingest/ios-screenshot.jpeg`) arrived as **JPEG**, carrying an EXIF block but no GPS and no device model. The earlier wording here and at AC-4 reasoned from *"iOS screenshots are normally PNG"* — an agent-derived inference, now falsified by a real device file. ~~*screenshots* are normally PNG~~ The conclusion is unchanged and in fact **strengthened**: accept all three, and never infer the format from where the image came from. This is the same class of error as falsified `ASM-034`, one level down — the format list was right, the reason given for it was not.

### P-2 — The implementing agent (secondary, non-human consumer)

GitHub Copilot in autopilot mode consumes this document as build input (ASM-028, ASM-029). It cannot ask clarifying questions. Where behaviour is genuinely undecided, this document says so explicitly and names the open question rather than writing a criterion that would be guessed. Stories therefore carry an **Open questions** line; a story with an open dependency is still implementable up to the named boundary.

There is no third persona. There is no administrator: the owner is the administrator.

---

## 4. User journeys

### J-1 — The value loop (core; the reason the product exists)

1. Owner opens nextup on their phone and is already signed in, or signs in with the federated identity provider in one tap.
2. The combined list loads: one row per work, each row showing the title, type, year, poster, the date it was added to nextup, and one badge per service that currently holds it.
3. Owner narrows down — by service (only what is on Max tonight), by type (film, not a series), by genre.
4. Owner sorts or scans; default order is most-recently-added first.
5. Owner picks a title and follows the deep link out to the service that holds it, then watches it there.

nextup's job ends at the deep link. It never plays anything and never tracks that anything was watched.

### J-2 — First-run bulk import (one-time, front-loaded volume)

1. Owner signs in for the first time to an empty combined list with an explicit empty state that tells them what to do.
2. On a laptop or phone, they screenshot the whole Netflix saved list — several images, scrolling.
3. They start an upload batch, choose **Netflix**, choose **full update** (the list is complete, so absence is meaningful), and get every image in — **pasting each grab straight in as they take it (Ctrl/Cmd+V on the laptop, the "Paste screenshot" button on the phone), or selecting/dragging the saved files** — then submit. Each paste appends to the same open batch (US-004 AC-14).
4. nextup extracts candidates, matches them to TMDB, and presents a review pass. Because the list was empty, every candidate is an addition; there are no removals.
5. Owner confirms, corrects mismatches, discards junk, and closes the batch. Only now does list state change.
6. They repeat for Max.
7. If the whole batch was wrong — wrong service picked, wrong images — the batch is creates-only, so a single batch undo removes exactly what it created.

This is the highest-volume, highest-risk moment in the product's life, and it is also the moment where undo is safest.

### J-3 — Ongoing incremental top-up (append-only)

1. Owner has saved three new things on Netflix over the past few weeks.
2. They screenshot just the top of the Netflix saved list, tapping **"Copy"** on the screenshot preview so it is on the clipboard.
3. They start a batch, choose **Netflix** and **append-only**, **paste the grabs in one at a time (or upload them from Photos if "Copy" was missed)**, and submit.
4. Review shows only the new items. Already-known titles are not shown, and nothing at all is proposed for removal — absence in an append-only batch means nothing.
5. Owner confirms. Three rows appear (or three existing rows gain a Netflix badge).

### J-4 — Full update with removals (the dangerous one)

1. Owner has pruned their Max list and wants nextup to reflect it.
2. They capture the **entire** Max saved list and start a batch: **Max**, **full update**.
3. Review shows two sections:
   - **Additions** — new titles, needing confirmation.
   - **Already on your Max list** — every extracted title nextup already knew about, pre-confirmed and visually distinct. This section exists so that a title the OCR failed to read is visibly absent from it, rather than being silently reclassified as a removal.
   - **No longer on your Max list** — every non-removed, non-suppressed Max listing that this batch did not see, ticked by default.
4. Owner unticks anything they know is still there (rescue), then confirms the remainder as one group action.
5. Only Max badges are affected. A title that is also on Netflix keeps its Netflix badge and stays in the combined list. A title with no remaining badges disappears from the combined list and appears in the removed view.
6. If they immediately realise the confirmation was wrong, one undo restores the whole group.

### J-5 — Recovery paths

- **Restore:** owner browses the removed view, finds a title, restores it explicitly. Never automatic.
- **Fix match:** a row is pointing at the wrong work. Owner searches TMDB from the row and re-points it, without removing the row and without losing its badges or its date.
- **Batch undo:** a creates-only batch can be undone whole. A batch that also modified or removed anything is **refused** — and the refusal enumerates precisely which titles the batch created, modified and removed, with the per-title remedy for each. That enumeration is the feature.
- **Re-extraction:** within the screenshot retention window, the owner can re-run extraction on a batch's images; results come back through the normal review pass.
- **Not interested:** owner suppresses a work. It is hidden, and it is not re-created the next time it shows up in a capture, because suppression is keyed on the canonical work, not on the row.

### J-6 — Reappearance (behaviour the owner must be able to predict)

A title was removed months ago. It shows up again in a new capture. nextup creates a **brand-new title, dated today**. The old removed row is left exactly as it was, and any edits made on it do not carry over. The removed view therefore legitimately contains more than one row for the same work — it is a historical log, not a recycle bin, and the UI must say so.

---

## 5. Epics

| Epic | Name | Purpose | Stories |
|---|---|---|---|
| A | Access and ownership | Only the owner gets in, and all data is scoped to them. | US-001, US-002 |
| B | Upload and batch boundary | Batches are explicit, single-service, mode-scoped, and transactional. | US-003, US-004, US-005 |
| C | Extraction and matching | Turn images into TMDB-matched candidates without ever discarding anything silently. | US-006, US-007, US-008, US-009, US-010, US-011 |
| D | Review pass — additions | Nothing is added without the owner seeing it; full update shows what it already knew. | US-012, US-013 |
| E | Review pass — removals | Removals are proposed, rescuable, group-confirmed, scoped, and undoable. | US-014, US-015, US-016, US-017 |
| F | Combined list (the value loop) | The product's reason to exist: one row per work, filterable, sortable. | US-018, US-019, US-020, US-021 |
| G | Freshness | The owner can tell when each service's slice was last updated. | US-022 |
| H | Removed view and history | Soft delete forever, browsable history, explicit restore, reappearance semantics. | US-023, US-024, US-025, US-026 |
| I | Suppression | Not-interested that survives reappearance. | US-027, US-028, US-029 |
| J | Recovery | Fix match, batch undo, undo refusal, re-extraction, image retention. | US-030, US-031, US-032, US-033, US-034, US-035 |
| K | Platform guarantees | The invariants that make the rest safe. | US-036, US-037, US-038, US-039 |
| **L** *(v1.1 — specified, not scheduled)* | **Waiting to stream** | Record what I noticed on a rental storefront, and tell me when it reaches a service I have. | US-040, US-041, US-042, US-043 |

Story order within an epic is dependency order. Epic order A → K is a viable build order; see §12.1. **Epic L is v1.1 and follows the whole of A–K** — it depends on Epics C, D and I being complete. See ADR-0010 and `roadmap.md` §5.

---

## 6. User stories

All v1 stories are **must** unless stated otherwise. Priority is inherited from the MVP lock; only US-020's non-default sort control is `should`. (US-022's former `should`-priority staleness indicator, REQ-040, was retired at A46 — the story is now `must` in full, REQ-039 only.)

Terminology used throughout the acceptance criteria:

- **Title** — one canonical work (one row in the combined list).
- **ServiceListing** — the association of a Title with one service (Netflix or Max). A Title has one to two listings. A listing is `active` or `removed`.
- **Batch (UploadBatch)** — one upload event: exactly one service, exactly one mode, one or more images, one review pass, one close.
- **Suppression** — a per-owner record keyed on canonical work identity that hides a work and blocks its re-creation.
- **Closed** — the owner has completed the review pass and committed the batch. Before close, no list state has changed.

Added at `A48` for **Epic L (v1.1)** — these terms have no meaning in v1:

- **Discovery source** — a place the owner *browses*, whose contents are editorial rather than curated by them (e.g. a rental storefront's new-release page). ⚠ **Not a service:** no `SERVICES` member, no badge, no `ServiceListing`, no reconciliation, append-only always (ADR-0010 D-1/D-2).
- **WatchIntent** — a per-owner record meaning *"I want to watch this and it is not on a service I have."* It has **no service** and its date is a **discovery** date, not a date-added. It is not a `ServiceListing` and must never be modelled as one (ADR-0010 Trap 3).
- **Availability** — a **cached, region-specific** answer from TMDB's watch-provider (JustWatch-sourced) data about where a work can be streamed. It is a lagging cache, never a fact, and is always rendered with its as-of date (ADR-0010 Trap 4).
- **Graduation** — a `WatchIntent` being satisfied because the owner added the work on a real service and a capture picked it up. Always owner-initiated; never an automatic consequence of an availability refresh.

### Epic A — Access and ownership

#### US-001 — Sign in with a federated identity provider

**As** the owner
**I want to** sign in with an existing identity provider rather than a nextup-specific password
**So that** I get in quickly on my phone and nextup never stores a credential

**Traces to:** NFR-015, NFR-016, NFR-017
**Priority:** must
**Epic:** A

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | An unauthenticated visitor on any nextup URL | They request the URL | They are redirected to the federated sign-in flow; no nextup content or data is rendered before authentication completes |
| AC-2 | The sign-in flow | It completes successfully for the allow-listed owner identity | A session is established and the owner lands on the combined list |
| AC-3 | The application at rest and in transit | Any inspection of stored data or of the sign-in implementation | No password, password hash, or streaming-service credential exists anywhere in nextup's storage or configuration (NFR-016, NFR-009) |
| AC-4 (edge) | An identity that authenticates successfully with the IdP but is not on the owner allow-list | They complete sign-in | Access is denied with an explicit "this application serves a single owner" message; no data is created for that identity and no self-service registration path exists (NFR-015) |
| AC-5 (failure) | The identity provider is unreachable or returns an error | The owner attempts to sign in | An error state explains that sign-in failed and offers retry; the app does not fall back to any unauthenticated mode |
| AC-6 | An authenticated session | The owner returns to nextup on the same device within the session lifetime | They are not asked to re-authenticate (NFR-017) |

**Out of scope for this story:** account creation, multi-user support, role management, password recovery — none of these exist.
**Open questions:** OQ-019 (which identity provider; to be settled by an ADR in phase 7). The story is implementable against any OIDC-compliant provider; the provider choice must not leak into application logic beyond configuration.

#### US-002 — All data is owned by, and visible only to, the owner

**As** the owner
**I want** every record in nextup to belong to me and be unreachable by anyone else
**So that** my viewing intentions stay private

**Traces to:** NFR-001, NFR-008
**Priority:** must
**Epic:** A

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Any persisted entity (Title, ServiceListing, Suppression, UploadBatch, UploadedImage, ExtractionCandidate) | It is created | It carries an owner reference, and every read path filters on the authenticated owner |
| AC-2 | Any HTTP endpoint that reads or writes owner data, including image byte endpoints | It is called without a valid session | It returns an authentication failure and no payload (NFR-008, NFR-011) |
| AC-3 (edge) | A direct object reference (a title id, batch id, or image id) that exists but belongs to no session owner | It is requested by an unauthenticated caller | The response is an authentication failure, not a not-found that discloses existence |
| AC-4 (failure) | A request bearing an expired or tampered session token | It reaches any data endpoint | It is rejected; no partial data is returned |

**Out of scope for this story:** encryption-at-rest key management specifics, which belong to `specs/security.md`.
**Open questions:** none.

### Epic B — Upload and batch boundary

#### US-003 — Start a batch by naming exactly one service and one mode

**As** the owner
**I want to** state which service these screenshots came from and whether the capture is complete
**So that** nextup knows whether absence means anything

**Traces to:** REQ-002, REQ-003, REQ-058
**Priority:** must
**Epic:** B

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | The owner starts a new upload | The batch is being created | They must select exactly one service from {Netflix, Max}; the batch cannot be submitted without it (REQ-002) |
| AC-2 | The owner starts a new upload | The batch is being created | They must select exactly one mode from {append-only, full update}; there is no default that could be accepted by inaction, and the meaning of each mode is stated in the UI at the point of choice (REQ-003) |
| AC-3 | A batch in `full update` mode | It is submitted | Its reconciliation affects only listings for the single selected service (REQ-002) |
| AC-4 (edge) | Screenshots from two different services attached to one batch | The batch is processed | All extracted candidates are attributed to the one selected service; the owner is expected to discard the foreign ones during review. nextup does not detect or split them |
| AC-5 (failure) | Any image whose content identifies a service | Extraction runs | The service assignment is taken **only** from the owner's selection. nextup MUST NOT infer, override, or warn-and-change the service based on image content (REQ-058) |
| AC-6 | A batch already submitted | The owner attempts to change its service or mode | The change is rejected; service and mode are immutable after submission |

**Out of scope for this story:** more than two services (REQ-053), per-image service assignment.
**Open questions:** none.

#### US-004 — Add multiple screenshots to one batch — by paste, by file upload, or by drag-and-drop

**As** the owner
**I want to** get every screenshot of a long saved list into a single batch with as little handling as possible — normally by pasting the screen grab straight in, and by picking files when pasting is not available
**So that** a scrolling capture is one review, not many, and the cheapest capture path is also the default one

**Traces to:** REQ-001, REQ-004, REQ-007, NFR-001, NFR-006, NFR-011, NFR-012, NFR-020 · **A43 / OQ-028** (AC-9, AC-10, AC-11) · **A45** (AC-12 … AC-17)
**Priority:** must
**Epic:** B

⚠ **A45 — ingestion is three paths, not one, and paste is the primary one.** The owner stated verbatim: *"for screenshots, I'm generally expecting that I will take a screen grab and paste it into the app directly rather than saving it to my device first and then uploading it to the app."* **Clipboard paste is therefore the primary ingestion interaction — and file upload REMAINS a first-class, fully supported path, not a fallback to be trimmed later.** This is an **ADD, not a SWAP** (the same mistake nearly made at A42, when PNG/JPEG were nearly swapped out for HEIC). Upload is load-bearing for two real, ordinary paths: the **laptop web-screenshot** path, and the **iOS Photos** path — which is where an iOS screenshot goes *by default* unless the owner taps "Copy" on the transient preview thumbnail in time (see §7.8 **KL-2**). Any statement, here or downstream, that ingestion is file-upload-only is **wrong and must be corrected, not annotated**.

| # | Given | When | Then |
|---|---|---|---|
| AC-1 *(corrected in place — **A45**)* | A batch in progress | The owner adds images to it | They can add two or more images in one action and add further images before submitting, **by any of the three supported input paths — clipboard paste (AC-12, AC-13), file selection, or drag-and-drop on a pointer device** — and the three may be mixed freely within one batch (REQ-004). ~~*Superseded wording: "The owner attaches images → they can attach two or more images in one action", which read as though file attachment were the only input path.*~~ |
| AC-2 | Attached images | The batch is submitted | Every image is stored and associated with the batch, and remains retrievable for re-extraction within the retention window (REQ-007, US-034) |
| AC-3 | An uploaded image | It is requested from storage | The bytes are served only to the authenticated owner; there is no public, unguessable-URL, or anonymous access path (NFR-011, NFR-020) |
| AC-4 (edge) *(A42 — was PNG/JPEG only under falsified ASM-034; scope widened to all three input paths at **A45**)* | The owner adds an image that is not a PNG, JPEG, or HEIC/HEIF — **whether by file selection, drag-and-drop, or paste** | The attachment is attempted | The file is rejected before submission with a message naming the accepted formats. **Accepted formats are PNG *and* JPEG *and* HEIC/HEIF (ASM-058, A42).** ⚠ All three are accepted — do not "tidy" the list down to one: iOS camera photos default to HEIC, an iOS Safari file input may hand over any of the three, and the laptop-web path produces PNG (REQ-004). ⚠ **The format is NOT predictable from the capture path** — the owner's own iOS *screenshot* fixture (TASK-151) is **JPEG**, falsifying the "iOS screenshots are normally PNG" rationale this criterion used to give. ~~iOS screenshots are normally PNG~~ Sniff the magic bytes; never trust the declared `Content-Type` or the ingest source. **A pasted item is validated by the same rule**: a clipboard carrying no image representation (text, a URL, nothing) is refused with the same named-formats message, not silently ignored (AC-15) |
| AC-5 (edge) | The owner attaches images that overlap (the same rows captured twice while scrolling) | Extraction and review run | Duplicate candidates within one batch are collapsed to a single review item per work, so the owner does not confirm the same title twice |
| AC-6 (failure) *(scope widened at **A45**)* | Adding an image fails partway — network loss, a rejected file, **or a rejected paste (AC-15)** — by any input path | The owner retries | No partial batch is submitted; the batch remains open and re-submittable, **every image already added to it is retained**, and no list state has changed |
| AC-7 (A42; **amended by A43**) | The owner attaches a HEIC/HEIF file **whose pixel dimensions pass the AC-9 guard** | The batch is submitted | The file is accepted and transcoded server-side to PNG on ingest before extraction or storage-for-analysis, because neither extraction service accepts HEIC/HEIF; the transcoded raster is clamped to the reader limits (< 20 MB, > 50×50 and < 16,000×16,000 px) so it is analysable (REQ-004, REQ-007). ⚠ **The AC-9 pre-decode pixel guard runs FIRST and can refuse the file before any of this happens** — acceptance of HEIC/HEIF is not unconditional. ~~*Superseded wording: "The owner attaches a HEIC/HEIF file → the file is accepted and transcoded…" with no dimension precondition, which read as though every HEIC is accepted.*~~ |
| AC-8 (A42, privacy) | An ingested image carries EXIF metadata (device model, timestamps, GPS) — as HEIC from a camera does | The image is stored and analysed | EXIF/GPS is stripped on ingest; the stored blob and anything served back contain no EXIF/GPS, and an automated test asserts the absence of EXIF/GPS on the stored blob (NFR-001) |
| **AC-9 (failure) *(new — A43 / OQ-028, `A43-M1`)*** | The owner attaches an image whose **pixel dimensions** exceed what the running container can decode — `width × height > NEXTUP_MAX_DECODE_PIXELS` (**25,000,000 px at the as-designed 0.25 vCPU / 0.5 GiB**; 50,000,000 px if and only if the memory remedy has been taken), or either dimension `> 16,000` or `< 50`, or the container header cannot be parsed | The file is attached | The image is **refused before any decode buffer is allocated and before any blob is written**, with error code `IMAGE_TOO_LARGE_TO_DECODE` naming that one file. Dimensions MUST be read from the container header only (HEIF `ispe` box, PNG IHDR, JPEG SOFn) — the implementer MUST NOT "decode and find out", and MUST NOT substitute a file-size/byte ceiling for the dimension check, because HEIC compression ratio does not predict raster size (a 6 MiB HEIC can be 48 MP). The byte ceiling is retained only as a cheaper first filter. The refusal is clean and explicit: **not a silent drop, not a crash, not a truncated batch.** (`A43-M1`; ADR-0008 R2.1, ADR-0003 R4) |
| **AC-10 (edge) *(new — A43 / OQ-028, `A43-M2`)*** | A batch of several images in which exactly one is refused by AC-9, fails to decode, or exhausts container memory | The batch is submitted | **The blast radius is exactly that one image.** It appears in the attach response's `rejected[]` naming that file; **every other image in the request is processed normally**; the batch stays open and re-attachable; and no list state is changed for any image, because a batch becomes visible only in the single transaction at review-close (US-005 AC-3). An implementer MUST NOT abort, roll back or discard the remaining images. An automated test MUST assert that a batch containing one over-dimension image still processes the rest (`A43-M2`) |
| **AC-11 (failure) *(new — A43 / OQ-028, `A43-M3`)*** | An image was refused by AC-9, or decoding it ran out of memory | The owner reads the failure message | The message **names the file, states its measured megapixels and the current limit, states that the cause is the container's memory size rather than a defect in the image, and states the remedy and its price** — up-size compute to 0.5 vCPU / 1.0 GiB, **+~$4/month**, one command, `artifacts/runbooks/scale-up-memory.md` — and tells the owner that no other image in the batch was affected and that this file should be re-attached after up-sizing. `REQ-074` re-extraction MUST NOT be offered for these two codes: nothing was retained to re-extract from, so re-attaching the file is the only path (US-034). ⚠ `IMAGE_DECODE_FAILED` (a corrupt or truncated file) is a **distinct code and MUST NOT mention memory or the up-size** — more memory will never fix it, and conflating the two sends the owner to buy capacity they do not need (`A43-M3`; exact text in ADR-0008 R2.3) |
| **AC-12 *(new — A45; desktop/laptop paste)*** | The owner is on a laptop or desktop browser (Chrome, Edge, Safari or Firefox) with an open batch on screen and a screen grab on the system clipboard | They press **Ctrl+V / Cmd+V** anywhere on the batch surface | A **document-level `paste` listener** reads the image out of `event.clipboardData.files` / `.items` and adds it to the open batch (AC-14), with **no permission prompt and no extra click** — the keystroke *is* the user's explicit paste. The implementer MUST use the `paste`-event primitive on this path and MUST NOT call `navigator.clipboard.read()` here: that path is worse on desktop (Firefox only gained it in 127) and it adds a prompt the keystroke already made unnecessary (`Context/evidence/clipboard-paste-support.md` Q2, Q4) |
| **AC-13 *(new — A45; the iOS paste path — a BUTTON, not a gesture)*** | The owner is on the phone (iOS Safari, iOS 13.4+) with an open batch | The batch surface renders | A **visible, labelled "Paste screenshot" button** is present **alongside** the file-selection control — never instead of it, and never hidden behind a menu. Tapping it calls **`navigator.clipboard.read()` inside the click handler**; iOS then shows its native single-option paste callout, and on the owner tapping it the returned `ClipboardItem`'s `image/png` blob is added to the open batch (AC-14). ⚠ The implementer MUST NOT implement the iOS path as a document-level `paste` listener or expect a long-press "Paste" callout over the page: **a paste gesture on non-editable content is not a supported iOS interaction**, and the recent WebKit fix (PR #38127) addressed event *routing*, not the callout *affordance* — a point the evidence marks explicitly **unverified**, which is precisely why the button design is mandated (evidence Q1c/Q1d, verdict 1). The button is subject to NFR-006: it must be reachable and tappable at a 320px viewport (US-037 AC-1) |
| **AC-14 *(new — A45; paste APPENDS into the existing batch)*** | An open batch that already holds N images, added by any mix of upload, drag-and-drop and paste | The owner pastes another screen grab (AC-12 or AC-13) | The pasted image is **appended as image N+1 of the same `UploadBatch`** (REQ-004). **Reuse the existing batch model** — a paste MUST NOT create a new batch, MUST NOT submit on its own, MUST NOT introduce a separate "pasted image" entity, and MUST NOT reset the batch's service or mode (US-003 AC-6). Repeated pastes accumulate one by one; the pasted images are indistinguishable downstream from uploaded ones for storage (AC-2, AC-3), retention (US-035), intra-batch dedup (AC-5), extraction, review and re-extraction (US-034). Nothing whatsoever changes in the combined list until the batch is closed (US-005 AC-1) |
| **AC-15 (failure) *(new — A45; rejection must be detected and re-offered, never left hanging)*** | The owner taps the "Paste screenshot" button and the read does not deliver an image — because a stray tap, a tab switch or backgrounding Safari **silently rejected the promise**, because the callout was dismissed, or because the clipboard held no image representation | The rejection or empty result occurs | The UI **leaves the pending state within a bounded time, states plainly that nothing was pasted and what to do next, and re-offers both the paste button and the file-upload control.** It MUST NOT spin indefinitely, MUST NOT show a generic failure, and MUST NOT silently auto-retry — a retry outside a fresh user gesture rejects immediately by design. The batch is **untouched**: still open, still holding every previously added image, no list state changed (AC-6). ⚠ This is not an edge case to defer: **iOS rejects by design on any stray interaction and never remembers the callout choice, so the callout tap is paid on every single paste, forever** (evidence Q1e items 1–2, verdict 2) |
| **AC-16 (failure) *(new — A45; capability absent — upload must still carry the whole job)*** | Clipboard image read is unavailable: the page is served over **`http://` (where `navigator.clipboard` is simply absent)**, the browser predates support (iOS < 13.4), or clipboard permission is denied | The batch surface renders | The paste affordance is **hidden or disabled with a stated reason**, and **file selection remains a complete, fully functional ingestion path on its own** — the owner can still do everything. There is **no dead button** and no state in which the owner cannot add an image. Every deployed nextup environment MUST be served over **HTTPS** so this branch is not reached in normal use; the known exception is **local development reached over a LAN IP**, where paste is unavailable and upload is the only path (evidence Q1e item 6) |
| **AC-17 (edge, privacy) *(new — A45; one server-side pipeline, and the EXIF strip is NOT satisfied by paste)*** | An image that arrived by paste | It is ingested | It passes through **exactly the same server-side path as an uploaded file**: the format check (AC-4), the pre-decode pixel guard (AC-9), the one-image blast radius (AC-10), owner-scoped storage (AC-3, NFR-011, NFR-020) and 30-day retention (AC-2, US-035). Pasted screen grabs arrive as **`image/png`** — WebKit exposes only four clipboard representations and HEIC is not among them — so the HEIC transcode (AC-7) is a **conditional no-op** on this path; the transcode stage MUST be made conditional on the sniffed content type and **MUST NOT be deleted**, because the Photos file-upload path still delivers raw HEIC. ⚠ **WebKit strips EXIF on clipboard read, and a pasted screenshot typically carries none — the implementer MUST NOT read this as "EXIF stripping is handled".** It covers **one of two** ingestion routes; the file-upload route still delivers EXIF/GPS intact, so **the explicit, tested server-side EXIF/GPS strip of AC-8 remains mandatory and unconditional** (NFR-001, OQ-027) |

**Out of scope for this story:** capturing screenshots (an OS function), photographing a TV screen (unsupported input, see §7.6), image editing or cropping. **Also out of scope: automatically down-scaling an over-dimension image so it fits.** AC-9 refuses; it does not silently resize. Resizing before the guard would reintroduce the exact allocation the guard exists to prevent, and a silently down-scaled screenshot degrades extraction accuracy invisibly. **Also out of scope (A45): a PWA Share-Sheet / Web Share Target ingestion path.** It is **ruled out on iOS** — `share_target` is unimplemented in Safari and iOS Safari (WebKit bug 194593, still open after seven years). **Do not design, promise, or scaffold a Share Sheet flow** (`Context/evidence/clipboard-paste-support.md` Q5 option A). Also out of scope: `<input capture>` (it opens the *camera*, which is the wrong tool for a screenshot workflow and reaches an unsupported input class — §7.6, REQ-051), and any attempt to make one paste create or auto-submit its own batch (AC-14).
**Known limitation (A43 / OQ-028) — disclosed, not discovered:** at the as-designed 0.25 vCPU / 0.5 GiB the AC-9 guard sits at 25 MP, which means **~48 MP full-resolution iPhone Pro camera captures are refused.** They fail cleanly, per-file, with a named cause and a pre-authorised remedy — but they *do* fail. This does **not** affect ordinary screenshots, which are the supported input class and are roughly an order of magnitude below the limit (a 1290 × 2796 iPhone screenshot is ~3.6 MP). See §7.8 for the full statement and for the ASM-021 boundary this sits against.
**Known limitation (A45) — the paste path is an accelerant, not a replacement:** iOS screenshots are saved to **Photos by default, not to the clipboard**. The paste path exists only if the owner taps **"Copy" on the transient screenshot preview thumbnail before it disappears**; if they miss it — which will happen routinely — they are on the upload path, and that must be a perfectly good place to be. Realistic step counts are **~3 for paste versus ~4 for upload** (`inferred` in the evidence, not measured on a device): the win is **one tap, occasionally two**, and the paste path carries several failure modes (AC-15, AC-16) that the upload path does not have at all. **This directly qualifies the owner's stated expectation, and it is why AC-16 requires upload to stand alone.** See §7.8 **KL-2**.
**UX note (A42 — no client-side HEIC preview):** only Safari renders HEIC/HEIF in `<img>`/`<canvas>`, so there is **no portable client-side preview or crop of a raw HEIC/HEIF file** before upload. This is left as a UX note rather than its own AC because US-004 does no client-side preview or cropping in v1 (both are out of scope above); any preview/crop UI must operate on the server-transcoded PNG, not the raw HEIC. `specs/ux-states.md` and `specs/ui.md` carry the surface detail.
**Open questions:** OQ-013 — the algorithm for collapsing overlapping captures within a batch (AC-5) is not yet chosen. Implementation boundary: the requirement is that the review pass shows at most one item per canonical work per batch; the mechanism may be decided at build time and recorded as an ADR. OQ-027 — AC-8 asserts the transcode strips EXIF/GPS; the chosen decode path (`heic-convert` decode-to-raw + pure-JS re-encode, or `sharp`'s default metadata drop) drops EXIF incidentally, but this MUST be verified empirically against a real device HEIC and pinned by the AC-8 test rather than assumed. **~~OQ-028~~ — CLOSED at A43.** The owner answered verbatim *"Start at 0.5 GiB, up-size only if it OOMs."* Compute **stays** at 0.25 vCPU / 0.5 GiB with the guard at 25 MP (AC-9); the up-size is a pre-authorised, trigger-gated remedy, not a pending decision — **no further owner approval is needed to take it, and it MUST NOT be taken pre-emptively.** The owner was told plainly that the failure can land mid-import and accepted that (§12.3 R-12). **A45 introduces no new open question.** The one genuinely unverified item in the clipboard evidence — whether iOS shows a paste callout over non-editable content after WebKit PR #38127 — is **deliberately routed around** by AC-13's button-plus-`clipboard.read()` design, which is `verified` to work and does not depend on the answer. Do not reopen it as a design choice.

#### US-005 — A batch is a transaction: nothing changes until it is closed

**As** the owner
**I want** my list to stay untouched until I finish reviewing
**So that** an abandoned or interrupted upload can never corrupt it

**Traces to:** REQ-005, REQ-006
**Priority:** must
**Epic:** B

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A batch that has been submitted and extracted but not closed | The owner opens the combined list in another tab or on another device | The combined list is completely unchanged — no new titles, no changed badges, no removals (REQ-005) |
| AC-2 | A full-update batch with several images | Reconciliation runs | It runs **once, against the union of all images in the batch**, not per image (REQ-006) |
| AC-3 | A batch | The owner closes it | All confirmed additions, corrections and confirmed removals are applied together; a failure applying any of them leaves the list in its pre-close state |
| AC-4 (edge) | An open batch the owner abandons (closes the tab, never returns) | Any later read of the combined list | The list reflects no part of that batch. The batch remains visible as an open batch the owner can resume or discard |
| AC-5 (failure) | Two batches for the same service open at once | The owner attempts to submit or close the second | v1 permits only one open batch at a time; starting a new batch while one is open requires resuming or discarding the open one first |

**Out of scope for this story:** concurrent multi-device editing (there is one owner and v1 assumes one active session at a time).
**Open questions:** none.

### Epic C — Extraction and matching

#### US-006 — Extract candidate titles from the uploaded screenshots

**As** the owner
**I want** nextup to read the titles off my screenshots
**So that** I do not have to type my watchlist in

**Traces to:** REQ-008
**Priority:** must
**Epic:** C

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A submitted batch with one or more images | Extraction runs | Each image produces zero or more ExtractionCandidate records, each carrying the raw extracted text and a reference to its source image |
| AC-2 | Extraction completes | The review pass is presented | Every candidate is represented in the review pass; no candidate is dropped between extraction and review |
| AC-3 (edge) | An image from which no title text can be read at all (blurred, cropped to nothing, a non-list screen) | Extraction runs | The batch does not fail. The image is reported in the review pass as having produced no candidates, so the owner can see which image was useless |
| AC-4 (failure) | The extraction service is unavailable or errors | The batch is submitted | The batch enters an explicit `extraction failed` state, the images are retained, the owner is told extraction failed and offered retry (US-034), and no list state changes |
| AC-5 (failure fallback) *(scope clarified after A40)* | Extraction is unavailable or unusable **for an individual title** | The owner still needs that title in the list | A manual-entry path exists: the owner searches TMDB and adds the work to the batch's additions directly. **⚠ Scope note:** this is a per-title escape hatch inside a normal batch, and it REMAINS IN v1. It must not be confused with the *manual-entry fallback product* — the contingency in which manual entry replaced extraction altogether — which is **RETIRED** as of A40. Extraction is no longer at risk of being unaffordable, so the product-level fallback has no trigger |

**Out of scope for this story:** photographs of a television screen (§7.6), non-list screens, extraction of anything other than title text.
**Open questions:** ~~**OQ-005**~~ — **CLOSED.** Phase 7 chose, then the **A40** constraint change reopened and re-decided it. Final: **ADR-0001 Revision 2**, a hybrid extractor — Azure OpenAI `gpt-4.1` vision as primary with a free-tier `Read` OCR cross-check on every image, ~$0.50–$0.70/month. Extraction is now **exempt from near-zero cost (NFR-012a)** and optimises for **quality first**; it can no longer breach NFR-012. The interface contract in AC-1 still stands and is what made the swap a one-line config change. ⚠ The manual-entry fallback is **RETIRED** — do not implement it. Build to `artifacts/specs/ai.md`, not to this paragraph. **OQ-013** also touched this story and is likewise closed (SD-02, intra-batch duplicate collapse).

#### US-007 — Match each candidate to a TMDB work and store its metadata

**As** the owner
**I want** each extracted title resolved to a real work with a poster, year and genre
**So that** the combined list is recognisable and filterable

**Traces to:** REQ-009, REQ-029
**Priority:** must
**Epic:** C

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | An ExtractionCandidate with usable text | Matching runs | nextup queries TMDB and attaches the best match, retaining the TMDB identifier as the canonical work identity (REQ-009) |
| AC-2 | A matched candidate confirmed by the owner | The Title is created | nextup stores type (film or series), release year, runtime, genres and poster image reference from TMDB (REQ-029) |
| AC-3 | A matched candidate | It is shown in the review pass | The owner sees enough to judge the match — poster, title, year and type — without leaving the review screen (see US-012) |
| AC-4 (edge) | Several TMDB works match the extracted text closely (remakes, same title different year) | Matching runs | The candidate is presented with the best match plus a visible path to pick a different one; nextup does not silently pick and hide the alternatives |
| AC-5 (failure) | TMDB is unreachable or rate-limits the request | Matching runs | Affected candidates are marked unmatched rather than discarded (US-008), the batch does not fail, and the owner is told matching was incomplete and can retry |
| AC-6 | Any TMDB response | It is stored | Only the fields in AC-2 plus the TMDB identifier are stored; nextup does not mirror or bulk-cache the TMDB catalogue |

**Out of scope for this story:** availability data, ratings, cast, recommendations (REQ-046, REQ-047, REQ-049).
**Open questions:** none for matched candidates. Unmatched candidates are US-008.

#### US-008 — Unmatched candidates are surfaced, never silently discarded

**As** the owner
**I want to** see the titles nextup could not identify
**So that** a failed match never looks like a title that was never on my list

**Traces to:** REQ-012
**Priority:** must
**Epic:** C

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A candidate with no acceptable TMDB match | The review pass renders | It appears in an explicit "couldn't identify these" section showing the raw extracted text and its source image, and it is never dropped (REQ-012) |
| AC-2 | An unmatched candidate | The owner acts on it | They can (a) search TMDB manually and attach the correct work, or (b) discard it as junk. Discarding is an explicit action |
| AC-3 (edge) | An unmatched candidate in a **full-update** batch | Removal reconciliation runs | The unmatched candidate does not cause any removal, and its presence does not rescue any listing it was not matched to. Unmatched text has no effect on the removal set until the owner resolves it |
| AC-4 (failure) | The owner closes a batch leaving unmatched candidates unresolved | The batch closes | The unresolved candidates are retained against the batch and are visible from the batch record; they are not turned into Titles and not deleted |

**Out of scope for this story:** creating a Title from raw text with no TMDB work behind it.
**Open questions:** **OQ-015** — the identity model for an unmatched title is undecided, and the same decision also determines the **fallback suppression key** used when there is no TMDB identifier (see US-028). These are one decision, not two. The implementer MUST NOT invent an identity scheme here. Until OQ-015 is resolved, v1 behaviour is exactly AC-2/AC-4: an unmatched candidate can be resolved to a TMDB work or discarded, and cannot become a Title in its own right.

#### US-009 — Classify each matched candidate as new or already present for this service

**As** the owner
**I want** nextup to tell me which extracted titles it already knew about
**So that** my review is short and my removals are trustworthy

**Traces to:** REQ-010
**Priority:** must
**Epic:** C

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A matched candidate and the current list state | Classification runs | The candidate is classified as **new to this service** if there is no active ServiceListing for that work and the batch's service, otherwise **already present for this service** (REQ-010) |
| AC-2 | A work that has an active listing on the *other* service only | A batch for this service classifies it | It is **new to this service**: confirming it adds a badge to the existing Title rather than creating a second Title (see US-018) |
| AC-3 (edge) | A work whose listing for this service is `removed` | Classification runs | It is **new to this service**. Confirming it creates a brand-new Title dated today per US-026; the removed listing is not resurrected |
| AC-4 (edge) | A work that is currently suppressed | Classification runs | It is excluded from the review pass entirely and no record is created (US-028) |
| AC-5 (failure) | Classification cannot be performed because matching failed | The review pass renders | The candidate appears as unmatched (US-008) rather than being defaulted into either class |

**Out of scope for this story:** what the review pass *does* with each class — that is US-012 and US-013.
**Open questions:** none.

#### US-010 — Refresh TMDB metadata lazily, on access

**As** the owner
**I want** metadata to stay reasonably current
**So that** posters and genres are not permanently wrong, without a background job touching my list

**Traces to:** REQ-076, NFR-014
**Priority:** must
**Epic:** C

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A Title whose stored TMDB metadata is older than the staleness threshold | The owner accesses a view that renders that Title | nextup refreshes that Title's metadata from TMDB as part of serving the request (REQ-076) |
| AC-2 | A lazy refresh | It completes | Only TMDB-sourced descriptive fields (type, year, runtime, genres, poster) change. Date-added, badges, listing states, suppression state and any owner correction are untouched (NFR-014, REQ-041) |
| AC-3 (edge) | A Title whose TMDB work no longer exists or has been merged upstream | A refresh is attempted | The existing stored metadata is kept, the Title remains in the list, and the failure is not surfaced as a list change |
| AC-4 (failure) | TMDB is unreachable during a lazy refresh | The view is rendered | The view renders with the stored metadata; the refresh is skipped silently and retried on a later access. A metadata refresh failure never blocks the value loop |
| AC-5 | Any point in time with no owner request in flight | The system is inspected | No scheduled or background process is performing metadata refresh. Refresh happens only on owner access (REQ-041, NFR-005) |

**Out of scope for this story:** the numeric staleness threshold for metadata, which belongs to `specs/data-model.md`. It is **not** the same constant as NFR-019's 30-day image retention; these two MUST NOT be refactored into one shared constant. (The third constant this note formerly distinguished from — the list-staleness threshold, REQ-040/ASM-038 — is retired at A46; see US-022.)
**Open questions:** none.

#### US-011 — Display TMDB attribution wherever TMDB data appears

**As** the product owner
**I want** the mandated TMDB attribution present and correct
**So that** nextup meets its API terms

**Traces to:** NFR-013
**Priority:** must
**Epic:** C

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Any surface that renders TMDB-sourced data (combined list, review pass, removed view, suppressed view, title detail) | It is rendered | The TMDB logo and the required attribution statement are present and visible without interaction on that surface or in a persistent footer reachable from it (NFR-013) |
| AC-2 | The attribution statement | It is rendered | It uses TMDB's required wording **verbatim** — "This product uses the TMDB API but is not endorsed or certified by TMDB." — and is not paraphrased, abbreviated, or localised |
| AC-3 (edge) | A narrow mobile viewport at the 320px floor (NFR-006) | The attribution renders | The logo and statement remain legible and are not clipped, collapsed behind a toggle, or hidden by responsive rules |
| AC-4 (failure) | The TMDB logo asset fails to load | The page renders | The textual attribution statement still renders. Attribution never depends solely on a remote asset |
| AC-5 | The build | Automated verification runs | A test asserts the presence of the verbatim statement on every TMDB-data-bearing surface, because this obligation's failure is invisible from inside the application (NFR-003) |

**Out of scope for this story:** attribution for any other third-party data source; there is none in v1.
**Open questions:** none.

### Epic D — Review pass, additions

#### US-012 — Review and confirm additions before anything is added

**As** the owner
**I want to** approve, correct or discard each proposed addition
**So that** a bad extraction never lands in my list

**Traces to:** REQ-013, REQ-014, REQ-016, REQ-017, REQ-018
**Priority:** must
**Epic:** D

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A batch with matched candidates classified as new to this service | The review pass renders | An **Additions** section lists every one of them awaiting the owner's decision; none is applied yet (REQ-013) |
| AC-2 | An item in the Additions section | The owner reviews it | They can **confirm** it, **correct** the match (search TMDB and pick the right work), or **discard** it (REQ-016, REQ-017, REQ-018) |
| AC-3 | Any addition | The batch is closed | Only confirmed additions are applied. An item the owner never touched is treated as **not confirmed** and is not added — there is no auto-accept by inaction (REQ-014) |
| AC-4 | An addition item | It renders | It shows poster, title, year and type, so the owner can judge the match without opening anything (REQ-017) |
| AC-5 (edge) | The owner corrects a match to a work that already has an active listing for this service | The correction is applied | The item is re-classified as already present, moves out of Additions, and closing the batch does not create a duplicate Title |
| AC-6 (edge) | A batch that produced zero additions | The review pass renders | The Additions section shows an explicit empty state ("nothing new in this capture"), not a blank area that reads as a loading failure |
| AC-7 (failure) | The owner abandons the review pass without closing the batch | Any later read | No addition has been applied (US-005) |

**Out of scope for this story:** removals (Epic E), already-known items in full-update mode (US-013), editing date-added (REQ-059, deferred to v1.1).
**Open questions:** **OQ-011** — the interaction cost of the review pass at first-run volume is the product's principal adoption risk and the M5 kill criterion. This story fixes the required *capabilities*; the ergonomics (bulk confirm-all, keyboard/gesture affordances, pagination) are to be designed in `specs/ux-states.md` and `specs/ui.md`. The implementer MUST provide at least a confirm-all affordance for the Additions section, because the first-run import is entirely additions.

#### US-013 — In full-update mode, show already-known titles too

**As** the owner
**I want** a full-update review to show the titles it already knew about
**So that** a title the OCR failed to read is visibly missing rather than silently turned into a removal

**Traces to:** REQ-011, REQ-057
**Priority:** must
**Epic:** D

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A batch in **full update** mode | The review pass renders | It shows **all** extracted and matched titles, including those classified as already present for this service, in a distinct "Already on your list" section (REQ-057) |
| AC-2 | The "Already on your list" section | It renders | Its items are pre-confirmed and visually distinct from the Additions section; they require no action from the owner and confirming the batch does not change them |
| AC-3 | A batch in **append-only** mode | The review pass renders | Only new items are shown. Already-present titles are **not** shown, because absence has no meaning in this mode and there is nothing for the owner to verify (REQ-011) |
| AC-4 (edge) | A full-update capture in which extraction missed one known title | The owner reviews | That title is absent from "Already on your list" **and** present in the removals section, so the discrepancy is visible in both places and the owner can rescue it by unticking (US-015) |
| AC-5 (edge) | A full-update batch with a long list | The review renders | The already-known section may be collapsed by default **only if** its count is displayed and expanding it is a single action; it MUST NOT be omitted |
| AC-6 (failure) | An implementation that hides already-known items in full-update mode to shorten the review | Automated verification runs | The test fails. This is the single most important safety property in the product and MUST be asserted by an automated test (NFR-003) |

**Out of scope for this story:** the removal list itself (US-014).
**Open questions:** OQ-011 (same ergonomics risk as US-012 — the already-known section is what makes a full-update review long).

### Epic E — Review pass, removals

#### US-014 — Propose removals only from a closed full-update batch, for that service only

**As** the owner
**I want** nextup to propose removals only when I have told it the capture is complete
**So that** a partial screenshot can never delete anything

**Traces to:** REQ-015, REQ-019, REQ-073
**Priority:** must
**Epic:** E

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A batch in **full update** mode for service S | The review pass renders | A **No longer on your list** section lists every ServiceListing for S that is currently `active` and was not seen in this batch (REQ-015, REQ-019) |
| AC-2 | A batch in **append-only** mode | The review pass renders | No removals section exists and no removal can be proposed or performed by that batch, regardless of what is absent (REQ-022) |
| AC-3 | A listing for the other service | A full-update batch for service S is reconciled | It is never in the removal set. Reconciliation is scoped strictly to S (REQ-023) |
| AC-4 (edge) | A listing that is already `removed` | Reconciliation runs | It is not proposed again — the removal set contains only currently active listings |
| AC-5 (edge) | A work that is **suppressed** | Reconciliation runs | It is excluded from the removal set entirely, so a suppressed work never appears in a removal confirmation (REQ-073) |
| AC-6 (failure) | A full-update batch where extraction produced zero candidates | The review pass renders | nextup MUST NOT propose removing the entire service's list. The batch is flagged as having extracted nothing, the removal section is withheld, and the owner is prompted to re-extract (US-034) or discard the batch |

**Out of scope for this story:** the confirmation interaction (US-015), the state transition (US-016).
**Open questions:** none.

#### US-015 — Removals are ticked by default, rescuable individually, confirmed as one group

**As** the owner
**I want to** untick anything I know is still on my list and then confirm the rest in one action
**So that** a long removal list costs one decision, not fifty — without becoming automatic

**Traces to:** REQ-020, REQ-021, REQ-055
**Priority:** must
**Epic:** E

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | The removals section | It renders | Every proposed removal is **ticked by default**, reflecting that a complete capture is normally correct (REQ-055) |
| AC-2 | A ticked proposed removal the owner knows is still on the service | The owner unticks it | That listing is rescued: it stays `active` and is not touched by the confirmation (REQ-021) |
| AC-3 | The removals section with any number of ticked items | The owner confirms | All ticked removals are applied together as **one group action** (REQ-020) |
| AC-4 | Any proposed removal | The batch is closed without confirming the removals group | No removal is applied. Removal is never a side effect of closing a batch; it requires the explicit group confirmation (REQ-013, REQ-020) |
| AC-5 (edge) | The owner unticks every proposed removal | They confirm | Nothing is removed, the batch closes normally, and the confirmation is recorded as a group action with zero members (so US-017's undo has nothing to undo) |
| AC-6 (edge) | A removals section with many items | It renders | The count is shown, and a select-all / deselect-all affordance is available; the owner still has to press confirm |
| AC-7 (failure) | Applying the group confirmation fails partway | The failure occurs | No listing is left in an inconsistent state; the whole group either applies or does not, and the owner is told which outcome occurred |

**Out of scope for this story:** post-hoc undo (US-017), what removal means to the Title (US-016).
**Open questions:** OQ-011.

#### US-016 — Removal marks one service's listing removed and nothing else

**As** the owner
**I want** removing a title from one service to leave everything else alone
**So that** pruning Max never damages my Netflix list

**Traces to:** REQ-022, REQ-023, REQ-027
**Priority:** must
**Epic:** E

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A confirmed removal of a work on service S | It is applied | The ServiceListing for (work, S) transitions from `active` to `removed`, with the removal timestamp and the batch that caused it recorded (REQ-027) |
| AC-2 | A Title with badges for both Netflix and Max | Its Max listing is removed | The Max badge disappears, the Netflix badge remains, and the Title remains in the combined list (REQ-023) |
| AC-3 | A Title whose only remaining active listing is removed | The removal is applied | The Title no longer appears in the combined list and becomes visible in the removed view (US-023) |
| AC-4 | Any removal | It is applied | No record is deleted from storage. `removed` is a state, not a deletion (REQ-028) |
| AC-5 (edge) | An append-only batch for service S in which a known title is absent | The batch closes | Nothing is removed. Absence outside a closed full-update batch for that service carries no meaning whatsoever (REQ-022) |
| AC-6 (failure) | Any code path that would remove listings for a service other than the batch's service, or remove a Title outright | Automated verification runs | The test fails. Blast radius is asserted, not assumed (NFR-003) |

**Out of scope for this story:** suppression, which is a different state and a different mechanism (Epic I).
**Open questions:** none.

#### US-017 — Undo a confirmed removal group

**As** the owner
**I want to** reverse a removal confirmation I just made
**So that** a mis-tick is a two-second mistake, not a permanent one

**Traces to:** REQ-056
**Priority:** must
**Epic:** E

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A confirmed removal group | Immediately after confirmation | An undo affordance is offered that reverses the entire group (REQ-056) |
| AC-2 | The owner invokes undo | The undo is applied | Every listing in that group returns to `active`, badges reappear, affected Titles return to the combined list, and their date-added values are unchanged |
| AC-3 | A removal group | The owner navigates away without undoing | The group remains reversible from the batch record for as long as the batch record exists; undo is not limited to a transient toast |
| AC-4 (edge) | A removal group where the owner has, since confirming, suppressed one of the removed works | Undo is applied | The suppressed work is not returned to the combined list; suppression wins over restore, and the owner is told which items were held back and why |
| AC-5 (edge) | A removal group that is undone twice | The second undo | Is not offered; an already-undone group is marked as reversed and cannot be reversed again |
| AC-6 (failure) | Undo fails partway | The failure occurs | The group is left wholly reversed or wholly unreversed, and the owner is told which |

**Out of scope for this story:** undoing additions (US-032 batch undo), restoring an old removal from history (US-025).
**Open questions:** none.

### Epic F — Combined list (the value loop)

#### US-018 — One row per work, one badge per service holding it

**As** the owner
**I want** a single list where each work appears once with badges showing where I can watch it
**So that** I stop shuffling between two apps

**Traces to:** REQ-024, REQ-025, REQ-026, REQ-031
**Priority:** must
**Epic:** F

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Titles saved on one or both services | The combined list renders | Each canonical work appears exactly once (REQ-024, REQ-026) |
| AC-2 | A work with active listings on both services | Its row renders | It shows a badge for Netflix and a badge for Max (REQ-025) |
| AC-3 | A work whose listing on one service is `removed` | Its row renders | Only the remaining active service's badge is shown (REQ-025, US-016) |
| AC-4 | A work with no active listings | The combined list renders | The row is absent from the combined list (REQ-031) and appears in the removed view (US-023) |
| AC-5 | A row | It renders | It shows poster, title, type, year, the date added to nextup, and the service badges, and offers a deep link out to each service holding it (REQ-024) |
| AC-6 (edge) | The same work confirmed in two separate batches for two different services | The second batch closes | No second Title is created; the existing Title gains the second badge |
| AC-7 (edge) | The owner has no active titles at all (first run, or everything removed) | The combined list renders | An explicit empty state is shown that distinguishes "you haven't uploaded anything yet" from "everything you had has been removed", with the relevant next action |
| AC-8 (failure) | The list fails to load | The owner opens the app | An error state with retry is shown. The app does not render an empty list, which would be indistinguishable from data loss |

**Out of scope for this story:** availability information about where else a work can be streamed (REQ-046); the deep-link target format, which belongs to `specs/ui.md`.
**Open questions:** none.

#### US-019 — Filter the combined list by service, type and genre

**As** the owner
**I want to** narrow the list to what is watchable right now
**So that** I can decide in seconds instead of scrolling

**Traces to:** REQ-032, REQ-033, REQ-034
**Priority:** must
**Epic:** F

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | The combined list | The owner filters by service | Only titles with an active listing on the selected service are shown (REQ-032) |
| AC-2 | The combined list | The owner filters by type | Only films, or only series, are shown according to the selection (REQ-033) |
| AC-3 | The combined list | The owner filters by genre | Only titles carrying the selected genre are shown (REQ-034) |
| AC-4 | Several filters | They are applied together | They combine conjunctively (service AND type AND genre) |
| AC-5 (edge) | A filter combination that matches nothing | It is applied | An empty state explains that the filters matched nothing and offers a one-action clear; it is visually distinct from the "you have no titles" empty state |
| AC-6 (edge) | A title whose TMDB record carries no genre | A genre filter is applied | It is excluded from genre-filtered results and is not silently assigned a default genre. It remains visible when no genre filter is active |
| AC-7 (failure) | Filters applied on a phone at the 320px viewport floor | The list renders | The filter controls remain usable and do not occlude the list (NFR-006) |

**Out of scope for this story:** filtering by runtime (REQ-035, deferred to v1.1), free-text search of the combined list, filtering the removed view (US-024 covers that separately).
**Open questions:** none.

#### US-020 — Sort by date added, using the earliest listing date

**As** the owner
**I want** the list ordered by when things entered nextup
**So that** old saves and new saves are both findable, and the order does not jump around

**Traces to:** REQ-036, REQ-038
**Priority:** must (sort by date added); **must** (an explicit sort control offering the reverse direction — REQ-038) ~~should~~ — **promoted at `A47`**: the oldest-first control is the sole escape hatch for the newest-first-vs-SUC-003 trade-off accepted at A44, and **OQ-029's revisit path depends on it existing**. As a `should` it could have been dropped from v1, silently closing that hatch.
**Epic:** F

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A Title with more than one listing | Its sort position is computed | The Title's date-added sort value is the **earliest** date-added across its non-removed listings (REQ-036) |
| AC-2 | The combined list | It renders with no explicit sort chosen | It is ordered by date added, most recent first (**confirmed by the owner at A44 — no longer an assumption; see R-14 for the accepted trade-off against SUC-003**) |
| AC-3 | Two Titles with the identical date-added sort value | The list renders | Their relative order is stable across reloads — the sort is deterministic, with a documented tie-breaker (title identifier), so rows never shuffle between renders (REQ-036) |
| AC-4 (edge) | A Title added on Netflix long ago and on Max recently | Sorting runs | It sorts by the Netflix (earlier) date. Consequence to be made legible in the UI: adding an existing work to a second service does **not** move it to the top of the list |
| AC-5 (edge) | A Title whose earliest listing is later removed | Sorting runs after the removal | The sort value is recomputed from the remaining non-removed listings, and the row's position may change. This is intended, not a bug |
| AC-6 | The sort control | The owner reverses the direction | The list re-orders oldest-first, and the selection persists for the session (REQ-038) |
| AC-7 (failure) | A Title whose date-added is missing for any reason | The list renders | It sorts last rather than crashing or being hidden, and its date is rendered as unknown |

**Out of scope for this story:** sorting by runtime (REQ-037, deferred to v1.1); alphabetical sort (not in v1 scope).
**Open questions:** none.

#### US-021 — Date added is recorded once, never overwritten, and labelled honestly

**As** the owner
**I want** the date shown to mean "when nextup first saw this"
**So that** I am not misled into thinking it is the date I saved it on the service

**Traces to:** REQ-030, REQ-060, REQ-061
**Priority:** must
**Epic:** F

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A ServiceListing | It is created by a closed batch | Its date-added is set to the date nextup first saw that work on that service, and is stored on the listing (REQ-030) |
| AC-2 | An existing listing | It is seen again in a later batch for the same service | Its date-added is **not** updated. Re-seeing a title never changes its date (REQ-060) |
| AC-3 | Any date-added shown in the UI | It renders | It is labelled to mean nextup's own observation — for example "added to nextup" — and is never presented or captioned as the service's own saved date (REQ-061) |
| AC-4 (edge) | The owner's first-run import of a backlog saved over several years | It closes | Every title carries that import's date. The UI's labelling must make this comprehensible rather than looking like a bug; the honest label in AC-3 is what makes it comprehensible |
| AC-5 (edge) | A work re-created after removal (US-026) | It renders | Its date-added is today's date, not the original date. The old removed row retains its own original date |
| AC-6 (failure) | Any code path that writes date-added outside listing creation | Automated verification runs | The test fails. Date-added is write-once per listing in v1 |

**Out of scope for this story:** editing date-added — **REQ-059, deferred to v1.1** (§11.2). Note the coupling: reinstating date-added editing invalidates the creates-only batch-undo simplification (D3, OQ-023).
**Open questions:** none for v1.

### Epic G — Freshness

#### US-022 — Show when each service's slice was last updated

**As** the owner
**I want to** see how current each service's part of the list is
**So that** I know whether to trust it or go capture again

**Traces to:** REQ-039
**Priority:** must (REQ-039)
**Epic:** G

> ⚠ **Amended at `A46`:** the list-staleness nudge is dropped entirely, per the owner's verbatim answer — *"Drop the concept entirely — no staleness nudge."* Former AC-2 (the stale-service indicator, REQ-040, ASM-038) is **deleted outright**, not superseded by banner — it was an instruction, and a deleted instruction must be genuinely gone. The remaining ACs below keep their original numbers; the sequence deliberately skips AC-2 and MUST NOT be renumbered. REQ-039 (the factual last-updated date this story exists to show) is unaffected and remains `must`.

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Batches that have been closed | The owner views the combined list | The date of the most recent **successfully closed** batch is shown per service, for both Netflix and Max (REQ-039) |
| AC-3 (edge) | A service that has never had a closed batch | The list renders | It shows "never updated" rather than a blank or an epoch date |
| AC-4 (edge) | A batch that was submitted but abandoned or failed | The list renders | It does not update the last-updated date. Only successfully closed batches count (REQ-039) |
| AC-5 (failure) | The last-updated dates cannot be computed | The list renders | The list itself still renders; the freshness area shows an unavailable state and does not block the value loop |

**Out of scope for this story:** any prompt, reminder or notification to update (REQ-051 — notifications are out of v1).
**Open questions:** none. Note for §10: REQ-039's visible dates are how success metric M7 is observed, at no instrumentation cost.

### Epic H — Removed view and history

#### US-023 — Soft delete forever: nothing is ever hard-deleted or purged

**As** the owner
**I want** every list record kept indefinitely
**So that** no mistake I make with nextup is unrecoverable

**Traces to:** REQ-028
**Priority:** must
**Epic:** H

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Any Title, ServiceListing, Suppression, UploadBatch or ExtractionCandidate | Any owner action, including removal, batch undo and suppression | The record is state-changed, never deleted. No hard delete of a list record exists anywhere in nextup (REQ-028) |
| AC-2 | A Title with no active listings | The combined list renders | It is hidden from the combined list but retained in storage indefinitely (REQ-031, REQ-028) |
| AC-3 | The system at any time | It is inspected | There is no purge, archive, retention or clean-up job affecting list records. The **only** automatic deletion in the whole product is the screenshot image purge in NFR-019 (US-035) |
| AC-4 (edge) | Storage growth over years of use | It accumulates | It is accepted. There is no cap, no eviction and no oldest-first trimming of list records |
| AC-5 (failure) | Any code path, migration or admin script that hard-deletes a list record | Automated verification runs | The test fails (NFR-003) |

**Out of scope for this story:** the screenshot images themselves, which are the sole exception and are covered by US-035.
**Open questions:** none.

#### US-024 — Browse the removed view as a historical log

**As** the owner
**I want** a browsable record of everything that has left my list
**So that** I can find something I lost and understand what happened

**Traces to:** REQ-062, REQ-064, NFR-018
**Priority:** must
**Epic:** H

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Titles with no active listings | The owner opens the removed view | Each is listed with its title, poster, type, year, its original date-added, the service(s) it was on, and the date it was removed (REQ-062) |
| AC-2 | The removed view | It renders | It is explicitly framed as a **historical log**, not a recycle bin: the surface states that the same work may appear more than once, because a work removed and later re-added produces a new row each time (REQ-065, US-026) |
| AC-3 | The removed view with many rows | The owner searches by title text | Matching rows are returned (REQ-064) |
| AC-4 | The removed view | The owner filters by service | Only rows whose removed listing was on that service are shown (REQ-064) |
| AC-5 | The removed view at any size | It renders | Performance and usability remain acceptable as the log grows, because it grows monotonically forever (NFR-018) |
| AC-6 (edge) | Several rows in the removed view for the same canonical work | They render | They are all shown, each with its own dates, and the UI groups or annotates them so the repetition reads as history rather than as duplication. The implementer MUST NOT de-duplicate the removed view — de-duplicating destroys the feature |
| AC-7 (edge) | Nothing has ever been removed | The owner opens the removed view | An explicit empty state is shown |
| AC-8 (failure) | The removed view fails to load | The owner opens it | An error state with retry is shown, never an empty log, which would read as data loss |

**Out of scope for this story:** date-range filtering, sorting options beyond a default most-recently-removed-first ordering.
**Open questions:** **OQ-022** — which affordances beyond title search and service filter the removed view needs is undecided. v1 implements exactly AC-3 and AC-4; anything further is out of scope until OQ-022 is resolved.

#### US-025 — Restore a title from the removed view, explicitly

**As** the owner
**I want to** put something back myself
**So that** an accidental removal is recoverable and a deliberate one stays done

**Traces to:** REQ-063
**Priority:** must
**Epic:** H

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A row in the removed view | The owner chooses restore | The removed ServiceListing returns to `active`, the Title reappears in the combined list with that service's badge, and its original date-added is preserved (REQ-063) |
| AC-2 | Restore | It happens | It happens **only** as an explicit owner action. No capture, batch, match or reappearance ever restores a removed listing automatically (REQ-065) |
| AC-3 | A restored Title | The combined list renders | It takes its sort position from its original (earliest) date-added, so it does not appear at the top as if newly added (US-020) |
| AC-4 (edge) | A removed row for a work that is currently **suppressed** | The owner chooses restore | Restore is refused with an explanation that the work is suppressed, and the owner is offered the un-suppress action (US-029) as the prerequisite |
| AC-5 (edge) | A removed row for a work that already has a newer active Title (created by reappearance, US-026) | The owner chooses restore | The owner is warned that an active row for this work already exists, and told that restoring will produce two rows for the same work. The action proceeds only on confirmation |
| AC-6 (failure) | Restore fails | The failure occurs | The row remains removed, an error is shown, and no partial state is written |

**Out of scope for this story:** merging a restored row with a reappearance-created row — not in v1.
**Open questions:** none.

#### US-026 — A reappearing title becomes a brand-new title dated today

**As** the owner
**I want** predictable behaviour when something I removed shows up again
**So that** I am never surprised by a resurrected row carrying stale state

**Traces to:** REQ-065
**Priority:** must
**Epic:** H

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A work whose listing for service S was previously removed | A later batch for S extracts and the owner confirms it | A **brand-new Title with a new listing, dated today**, is created (REQ-065) |
| AC-2 | The previously removed row | The reappearance is confirmed | It is left exactly as it was: still removed, still in the removed view, with its original dates intact. It is not restored, not modified, and not linked as the same row |
| AC-3 | Owner edits made on the old removed row (a corrected match, for example) | A reappearance creates the new row | Those edits do **not** carry over. The new row is built fresh from the current extraction and TMDB match |
| AC-4 | The removed view after a reappearance | It renders | It contains both the old removed row and, once that new row is itself removed, a further row for the same work. This is expected (US-024 AC-6) |
| AC-5 (edge) | A work that is currently **suppressed** reappears in a capture | Extraction and classification run | No new Title is created and the work does not appear in the review pass at all (US-028). Suppression is checked **before** record creation, precisely because this story creates a new row rather than reusing the old one |
| AC-6 (failure) | An implementation that "helpfully" restores the old row instead of creating a new one | Automated verification runs | The test fails. Automatic restore is prohibited (REQ-063, AC-2 of US-025) |

**Out of scope for this story:** any UI for linking or merging the old and new rows.
**Open questions:** none. This behaviour is the lock addendum decision L1 / assumption A33.

### Epic I — Suppression ("not interested")

#### US-027 — Mark a title as not interested

**As** the owner
**I want to** tell nextup I am never going to watch this
**So that** it stops taking up space in my decision

**Traces to:** REQ-070
**Priority:** must
**Epic:** I

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A Title in the combined list | The owner chooses "not interested" | A Suppression record is created for that work and the Title is immediately hidden from the combined list (REQ-070) |
| AC-2 | A suppressed work | Any list surface renders | It appears in neither the combined list nor the removal-confirmation set (REQ-073); it appears only in the suppressed view (US-029) |
| AC-3 | Suppression | It is applied | It does **not** delete anything and does not mark any listing `removed`. `active`, `removed` and `suppressed` are three distinct states (see §7.1) |
| AC-4 (edge) | A work that is already suppressed | The owner suppresses it again | The action is idempotent; no duplicate Suppression is created |
| AC-5 (edge) | A work suppressed while it has active listings on both services | Suppression is applied | Both badges are hidden along with the row; suppression is per work, not per service |
| AC-6 (failure) | Suppression fails to persist | The owner acts | The row stays visible and an error is shown; the UI never shows a hidden row that is not actually suppressed |

**Out of scope for this story:** reason capture, or any use of suppression as a recommendation signal.
**Open questions:** none.

#### US-028 — Suppression is keyed on canonical work identity and checked before record creation

**As** the owner
**I want** "not interested" to survive the title showing up in a future screenshot
**So that** I do not have to dismiss the same work every month

**Traces to:** REQ-071
**Priority:** must
**Epic:** I

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A Suppression record | It is stored | It is keyed on the **canonical work identity** (the TMDB identifier), **not** on the Title row identifier (REQ-071) |
| AC-2 | A suppressed work | A later batch extracts and matches it | It is filtered out **before** any Title or ServiceListing is created, and it does not appear in the review pass at all (REQ-071, US-009 AC-4) |
| AC-3 | The rationale | Any implementation review | Because a reappearing work is created as a **new row** (US-026), a row-scoped suppression flag would be bypassed on the very next capture. The key MUST be the work, not the row. This MUST be asserted by an automated test that suppresses a work, removes it, re-uploads it, and verifies no row is created (NFR-003) |
| AC-4 (edge) | A suppressed work that is later matched to a *different* TMDB work by a corrected match | Extraction runs | Suppression does not apply, because the identity differs. This is the **known limitation**: suppression is only as reliable as matching. The limitation is documented in the suppressed view's help text rather than worked around |
| AC-5 (edge) | A work suppressed while it appears in an open batch's review pass | The batch is closed | The suppressed work is not added, even though it was extracted before suppression. The check is at record creation, not at extraction |
| AC-6 (failure) | ~~An unmatched candidate the owner wants to suppress~~ | ~~The owner tries~~ | ~~v1 offers no suppression for unmatched candidates, because there is no identity to key on.~~ **⚠ SUPERSEDED IN PHASE 8 — see AC-6′ below.** |
| **AC-6′** (replaces AC-6) | An **unmatched** candidate the owner wants to suppress | The owner suppresses it | It **is** suppressible. **OQ-015 is now CLOSED** (spec decision SD-01): `workIdentity` is a single opaque string — `tmdb:{movie\|tv}:{id}` when matched, `unmatched:<sha256(normaliseTitleText(raw))[0:16]>` when not — and **the same string is the suppression key in both forms**, one decision not two, per A34. Suppression therefore works identically for matched and unmatched works. Verified by `T-SUP-006`. Note **SD-05**: the year is deliberately EXCLUDED from the fallback hash, because a year present on one capture and absent on the next would split one work into two identities and thereby silently bypass an existing suppression — the exact failure this scheme exists to prevent |
| **AC-7** (added in phase 8, spec decision **SD-06**) | A work with an **active suppression** | The owner uses fix-match to re-point it at the correct work | The suppression **migrates** to the corrected identity and the owner is told it did. Without this, correcting a match would silently resurrect a work the owner had dismissed. Verified by `T-FIX-005`. *This criterion originates in the spec, not in an earlier user statement — it is a spec-level addition recorded here so the PRD and specs do not diverge* |

**Out of scope for this story:** suppression of works the owner has never seen in nextup (there is no pre-emptive block list).
**Open questions:** ~~OQ-015~~ — **CLOSED in phase 8.** See AC-6′ and AC-7. The identity grammar is specified in full in `artifacts/specs/data-model.md` (`workIdentity`, `normaliseTitleText`); the implementer MUST use it rather than inventing a key.

#### US-029 — Browse and undo suppressions

**As** the owner
**I want** a list of what I have suppressed and a way to change my mind
**So that** an accidental suppression is not a permanent invisible hole in my list

**Traces to:** REQ-072
**Priority:** must
**Epic:** I

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | One or more suppressions | The owner opens the suppressed view | Every suppressed work is listed with poster, title, year, type and the date it was suppressed (REQ-072) |
| AC-2 | A suppressed work | The owner un-suppresses it | The Suppression record is marked inactive (not deleted, REQ-028) and the work stops being filtered from future captures |
| AC-3 | A work un-suppressed while it still has active listings | Un-suppression is applied | It reappears in the combined list immediately, with its original date-added and badges intact |
| AC-4 (edge) | A work un-suppressed whose listings are all `removed` | Un-suppression is applied | It does **not** reappear in the combined list; it becomes visible in the removed view and can be restored from there (US-025). Un-suppression is not a restore |
| AC-5 (edge) | Immediately after suppressing from the combined list | The owner realises the mistake | An immediate undo affordance is offered at the point of action, in addition to the suppressed view |
| AC-6 (failure) | The suppressed view fails to load | The owner opens it | An error state with retry is shown, not an empty list |

**Out of scope for this story:** bulk un-suppression.
**Open questions:** none.

### Epic J — Recovery

#### US-030 — Fix a wrong match without removing the title

**As** the owner
**I want to** re-point a row at the correct work
**So that** a mismatch is corrected in place instead of being deleted and re-added

**Traces to:** REQ-066
**Priority:** must
**Epic:** J

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A Title in the combined list pointing at the wrong TMDB work | The owner chooses "fix match" | They can search TMDB from the row and select the correct work (REQ-066) |
| AC-2 | A fix-match | It is applied | The Title's canonical identity and TMDB-sourced metadata are replaced, while its listings, badges, date-added values and batch provenance are preserved. Nothing is removed and nothing is re-created (REQ-066) |
| AC-3 | A fixed Title | The combined list re-renders | Its sort position is unchanged, because date-added did not change (US-020) |
| AC-4 (edge) | Fix-match targets a work that already has an active Title | The owner confirms | The owner is warned that this will produce two rows for the same work; the action proceeds only on confirmation. v1 does not merge them |
| AC-5 (edge) | Fix-match targets a work that is currently suppressed | The owner confirms | The action is refused with an explanation and the un-suppress action is offered (US-029), because the result would be an active row for a suppressed work |
| AC-6 (failure) | The TMDB search behind fix-match is unavailable | The owner opens fix-match | An error state with retry is shown and the Title is left untouched |

**Out of scope for this story:** correcting a match during review, which is US-012 AC-2; merging duplicate rows.
**Open questions:** none.

#### US-031 — Every change records the batch that caused it

**As** the owner
**I want** each addition, modification and removal traceable to the batch that made it
**So that** batch-level undo and the undo refusal can be exact rather than approximate

**Traces to:** REQ-068
**Priority:** must
**Epic:** J

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A Title or ServiceListing created by closing a batch | It is written | It records the batch that created it (REQ-068) |
| AC-2 | A listing transitioned to `removed` by a confirmed removal group | It is written | It records the batch and the removal group that removed it (REQ-027) |
| AC-3 | A Title modified during a batch's review (a corrected match) | It is written | The modification is recorded against that batch |
| AC-4 | A batch record | The owner opens it | They can see exactly what that batch created, modified and removed |
| AC-5 (edge) | A change made outside any batch (fix-match from the list, suppression, restore) | It is written | It is recorded as owner-initiated with no batch, and is therefore never included in any batch undo |
| AC-6 (failure) | Provenance cannot be written | The batch close is attempted | The close fails atomically (US-005 AC-3). A change without provenance MUST NOT be persisted, because undo correctness depends on it |

**Out of scope for this story:** a general-purpose audit log or activity feed.
**Open questions:** none.

#### US-032 — Undo an entire batch when it only created things

**As** the owner
**I want to** reverse a whole batch that went wrong
**So that** a bad first-run import or a wrong-service mistake costs one action

**Traces to:** REQ-067
**Priority:** must
**Epic:** J

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A closed batch whose changeset contains **only** creations | The owner chooses undo | Every Title and ServiceListing that batch created is reversed — marked removed/inactive, never hard-deleted (REQ-067, REQ-028) |
| AC-2 | A batch undo | It completes | The combined list returns to exactly its pre-batch content, and the service's last-updated date reverts to the previous successfully closed batch (US-022) |
| AC-3 | A batch undo | It completes | The batch is marked reversed and cannot be undone a second time; its images and extraction candidates are retained |
| AC-4 (edge) | A creates-only batch where one created Title has since been suppressed or fix-matched by the owner | Undo is attempted | The batch is no longer creates-only from the perspective of subsequent owner edits. The undo is refused per US-033, and the refusal enumerates which titles were touched afterwards |
| AC-5 (edge) | A batch that created nothing (everything was discarded during review) | Undo is offered | Undo is a no-op that succeeds and marks the batch reversed |
| AC-6 (failure) | Undo fails partway | The failure occurs | The batch is left wholly reversed or wholly unreversed and the owner is told which |

**Out of scope for this story:** undo of batches with mixed changesets — **REQ-069, deferred to v1.1** (§11.2). This creates-only simplification is decision D3 / assumption A36 and is valid only for as long as REQ-059 (editing date-added) stays deferred.
**Open questions:** OQ-023 (interaction between batch undo and later edits) is a v1.1 concern; v1 sidesteps it via US-033.

#### US-033 — Refuse a mixed-changeset undo and enumerate exactly what the batch touched

**As** the owner
**I want** a refusal that tells me precisely what this batch did and what I can do about each item
**So that** I can unwind it by hand with confidence instead of guessing

**Traces to:** REQ-075
**Priority:** must
**Epic:** J

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A closed batch whose changeset contains any modification or removal as well as, or instead of, creations | The owner chooses undo | The undo is **refused**. No partial undo is performed (REQ-075, REQ-069 deferred) |
| AC-2 | The refusal | It is presented | It enumerates **every** title the batch touched, grouped as created / modified / removed, each named with poster, title and year — not a count, not a sample, not "some titles" (REQ-075) |
| AC-3 | Each enumerated title | It is presented | It carries the per-title remedy that does apply: remove it manually (created), fix-match it (modified), restore it from the removed view (removed), each as an actionable link from the enumeration |
| AC-4 | The refusal | It is presented | Its tone and framing treat the enumeration as the deliverable, not as an error. The copy states that whole-batch undo of a mixed changeset is a v1.1 capability (REQ-069) |
| AC-5 (edge) | A mixed batch touching a large number of titles | The refusal renders | The full enumeration is available — paginated or scrollable if necessary — and is never truncated to a summary |
| AC-6 (edge) | A mixed batch where a touched title has since been removed or suppressed by a later action | The refusal renders | That title still appears in the enumeration, annotated with its current state, so the enumeration is complete rather than filtered |
| AC-7 (failure) | The enumeration cannot be built because provenance is missing | Undo is attempted | The undo is refused and the owner is told provenance is unavailable for this batch, naming the batch. It never silently degrades to a partial undo (US-031 AC-6 makes this unreachable in practice) |

**Out of scope for this story:** performing any part of the undo; that is exactly what is refused.
**Open questions:** none.

#### US-034 — Re-extract a batch's images within the retention window

**As** the owner
**I want to** re-run extraction on screenshots I already uploaded
**So that** a bad extraction does not mean re-screenshotting everything

**Traces to:** REQ-074
**Priority:** must
**Epic:** J

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A batch whose images are still within the retention window | The owner chooses re-extract | Extraction and matching run again over the batch's stored images (REQ-074) |
| AC-2 | Re-extraction | It completes | Results are presented through the normal review pass, in the batch's original mode and for its original service. No list state changes without the owner's review (REQ-013, US-005) |
| AC-3 | Re-extraction of an already-closed batch | It runs | It is presented as a **new** batch derived from the same images, with the same service and mode. The original closed batch's provenance is not rewritten |
| AC-4 (edge) | A batch whose images have been purged (past the retention window, NFR-019) | The owner opens the batch | Re-extract is not offered; the batch shows that its images have been purged and re-extraction is no longer possible. The batch's list-state provenance is still intact (REQ-028) |
| AC-5 (failure) | Re-extraction fails | The owner attempts it | The batch is unchanged, an error with retry is shown, and no partial review pass is created |

**Out of scope for this story:** re-extraction with a different service or mode than the original batch.
**Open questions:** ~~OQ-005~~ — **CLOSED** (ADR-0001 Rev 2). Re-extraction uses the same hybrid extractor; unit cost ~$0.0094/image, and extraction is exempt from the near-zero constraint per NFR-012a.

#### US-035 — Retain screenshots for 30 days, then purge them automatically

**As** the owner
**I want** my screenshots deleted after a while
**So that** nextup does not hoard images it no longer needs

**Traces to:** NFR-019, NFR-011, NFR-020
**Priority:** must
**Epic:** J

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | An uploaded image | 30 days have elapsed since its upload | Its bytes are permanently deleted (NFR-019) |
| AC-2 | The purge | It runs | It deletes **image bytes only**. It MUST NOT delete or alter any Title, ServiceListing, Suppression, UploadBatch, ExtractionCandidate or provenance record (REQ-028, REQ-041) |
| AC-3 | The purge | It runs | It changes no user-visible list state, and is therefore one of exactly two permitted non-owner-initiated processes (REQ-041, US-036) |
| AC-4 | Image bytes at any point in their life | They are requested | They are served only to the authenticated owner over an authenticated path (NFR-011, NFR-020) |
| AC-5 (edge) | A batch still open when its images reach 30 days | The purge runs | The purge still applies; the batch is marked as having lost its images and re-extraction is no longer offered (US-034 AC-4) |
| AC-6 (failure) | The purge fails for an image | The failure occurs | It is retried on the next run; a failed purge never cascades into deleting anything else, and never blocks owner activity |
| AC-7 | The 30-day constant | The implementation is inspected | It is a distinct configuration value from `TMDB_METADATA_MAX_AGE_DAYS` (US-010's metadata staleness, NFR-014). These two MUST NOT be unified into a single shared constant. (A third such constant, `LIST_STALENESS_DAYS` / REQ-040 / ASM-038, was retired at A46 — dropped, not merely distinguished.) |

**Out of scope for this story:** any retention of list data — there is none; retention applies to images alone.
**Open questions:** none.

### Epic K — Platform guarantees

#### US-036 — Nothing but the owner changes user-visible list state

**As** the owner
**I want** to be the only thing that changes my list
**So that** what I saw last time is what I see this time

**Traces to:** REQ-041, NFR-005
**Priority:** must
**Epic:** K

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | The set of operations that mutate user-visible list state | The system is inspected | It is exactly the closed enumeration in §7.4, all of them owner-initiated (REQ-041) |
| AC-2 | Non-owner-initiated processes | The system is inspected | Exactly two exist: the lazy TMDB metadata refresh on access (REQ-076, US-010) and the screenshot image purge (NFR-019, US-035). Neither changes user-visible list state (REQ-041) |
| AC-3 | Any operation not in the §7.4 enumeration | It is proposed | It is **forbidden by default**. The enumeration is closed; extending it is an explicit amendment to REQ-041, which has already been widened five times |
| AC-4 (edge) | A convenience feature that would auto-confirm, auto-restore, auto-merge or auto-clean anything | It is considered | It is prohibited, regardless of how safe it seems |
| AC-5 (failure) | Any scheduled job, webhook, timer or background worker that writes list state | Automated verification runs | The test fails (NFR-003, NFR-005) |
| AC-6 | Telemetry, analytics and usage tracking | The system is inspected | None exists (NFR-005, REQ-052) |

**Out of scope for this story:** operational logging necessary to run the application, which must contain no owner list content.
**Open questions:** none.

#### US-037 — Work on a phone first and a laptop second

**As** the owner
**I want** nextup usable one-handed on my phone
**So that** it works where I actually decide what to watch

**Traces to:** NFR-006, NFR-007
**Priority:** must
**Epic:** K

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Any surface (combined list, upload, review, removed view, suppressed view, batch detail) | It is rendered at a 320px-wide viewport | It is fully usable: no horizontal scrolling, no clipped controls, no unreachable actions (NFR-006) |
| AC-2 | Any surface | It is rendered at a 1024px-wide viewport | It is fully usable and makes reasonable use of the extra width (NFR-007) |
| AC-3 (edge) | The review pass with a long removals list on a 320px viewport | It renders | Tick controls, the rescue action and the group confirm all remain reachable without zooming |
| AC-4 (edge) | The refusal enumeration of US-033 on a 320px viewport | It renders | The full enumeration remains readable and its per-title remedies remain tappable |
| AC-5 (failure) | A viewport narrower than 320px | It is used | Graceful degradation is acceptable; 320px is the supported floor, not the absolute minimum |

**Out of scope for this story:** native applications (REQ-050); offline support beyond the offline states in §9.
**Open questions:** **OQ-014** — accessibility, usability, performance, availability and internationalisation targets are undecided. v1 states no numeric target for these; the implementer MUST NOT invent thresholds and MUST NOT treat their absence as permission to ignore them. `specs/ux-states.md` records what is decided.

#### US-038 — Never hold streaming credentials or talk to a streaming service

**As** the product owner
**I want** nextup to have no automated relationship with Netflix or Max
**So that** the product cannot break their terms or be broken by their changes

**Traces to:** NFR-009, NFR-010
**Priority:** must
**Epic:** K

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | The application's storage and configuration | They are inspected | No streaming-service credential, cookie, token or session is stored or requested at any point (NFR-009) |
| AC-2 | The application's outbound network calls | They are inspected | nextup makes no automated request of any kind to a streaming service — no API, no scraping, no headless browsing (NFR-010) |
| AC-3 | The deep links out to a service from a title row | The owner follows one | It is a plain user-initiated navigation in the owner's browser or app, not a programmatic request made by nextup (NFR-010) |
| AC-4 (edge) | A feature proposal that would automate any part of capture | It is considered | It is out of scope by construction (REQ-042); the manual screenshot loop is the product's premise, not a limitation to be engineered away |
| AC-5 (failure) | Any outbound call to a streaming-service domain from server-side code | Automated verification runs | The test fails (NFR-003) |

**Out of scope for this story:** TMDB calls, which are permitted and governed by US-007, US-010 and US-011.
**Open questions:** none.

#### US-039 — Be buildable, verifiable and cheap

**As** the product owner
**I want** the system implementable by an autonomous coding agent on a mainstream stack, at a cost that is as low as reasonable **without degrading quality** *(amended by A41 — the original "within free-tier or consumption pricing" wording was repealed)*
**So that** it can actually get built and can keep running

**Traces to:** NFR-002, NFR-003, NFR-004, NFR-012
**Priority:** must
**Epic:** K

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | This PRD and the specs | The implementing agent reads them | Every acceptance criterion is concrete enough to implement and verify without asking a question (NFR-002, ASM-028, ASM-029) |
| AC-2 | The implementation | It is delivered | It comes with automated tests covering, at minimum, the invariants explicitly called out for automated verification: US-004 AC-8, **US-004 AC-10 *(new — A43: a batch containing one over-dimension image still processes the rest)***, US-011 AC-5, US-013 AC-6, US-016 AC-6, US-021 AC-6, US-023 AC-5, US-026 AC-6, US-028 AC-3, US-036 AC-5, US-038 AC-5 (NFR-003) |
| AC-3 | The technology choices | They are made | They are mainstream and well-represented in training data, favouring conventional patterns over novel ones (NFR-004) |
| AC-4 *(rewritten by A41, set by A40, **amended by A43**)* | The running system | Its hosting is assessed | It runs the **owner-selected Variant A** stack at approximately the per-component cost published in `architecture.md` §Cost summary (**≈$11–14/month**): Container Apps **0.25 vCPU / 0.5 GiB** at `minReplicas = 1` **with `NEXTUP_MAX_DECODE_PIXELS=25000000`**, Azure SQL Database Basic, ghcr.io, staging on an auto-paused serverless DB. ~~Free-tier or consumption-only~~ is **no longer required** (NFR-012 is now a `should`). **A43: 0.25 vCPU / 0.5 GiB is the as-designed size and MUST be what ships.** Up-sizing to **0.5 vCPU / 1.0 GiB (≈$15–18/month total, +~$4)** is **pre-authorised but trigger-gated** — it is taken **only** in response to a real OOM or an `IMAGE_TOO_LARGE_TO_DECODE` refusal the owner actually needs (US-004 AC-9/AC-11), by the procedure in `runbooks/scale-up-memory.md`. An implementer MUST NOT ship the larger size pre-emptively, and MUST NOT change the memory size without changing `NEXTUP_MAX_DECODE_PIXELS` in the same commit — the two move together, always. ⚠ It MUST still be right-sized for a **single user**: no redundancy, no multi-region, no autoscaling for load that cannot exist |
| AC-5 (edge) *(rewritten by A40)* | The extraction/vision component | Its cost is assessed | It is **exempt from NFR-012** and governed by **NFR-012a** instead: lowest reasonable cost **without degrading quality**, with quality outranking cost. ⚠ An implementer MUST NOT substitute a cheaper, lower-quality extractor to reduce spend — that is explicit non-compliance. Actual ~$0.50–$0.70/month (ADR-0001 Rev 2). ~~The manual-entry fallback~~ is **retired** |
| AC-6 (failure) | A design decision that cannot be verified automatically | It is proposed | It is recorded as an ADR with the manual verification step written out, rather than being left implicit |

**Out of scope for this story:** the technology selection itself, which belongs to the architecture phase and its ADRs.
**Open questions:** OQ-005 (AC-5), OQ-019 (identity provider).

---

### Epic L — Waiting to stream (rental-release discovery) — **v1.1**

**Status: specified, not scheduled for v1.** Promotion trigger and rationale
in `roadmap.md` §5; the load-bearing decisions and their traps in
**ADR-0010**. This epic depends on the review pass (Epic D), suppression
(Epic I) and TMDB matching (Epic C) all being complete, which is why it
follows v1 rather than joining it.

**The problem, in the owner's words (`A48`):** *"I'd also like to track movies
/ shows that are just released for rent… I wait for them to be available via
one of the streaming apps. But sometimes I lose track of what I wanted to
watch as these movies drop off of the recent rent movies list and I don't
always see them and able to connect them to the streaming apps… it's not a
formal list or app capability that I use. Instead, I just peruse the list and
make a mental list."*

Two failures, and the second is the one that justifies the epic:

- **F-1 (memory):** the title is forgotten once it rotates off the rental
  storefront's new-release page.
- **F-2 (connection):** it later lands on Netflix or Max and the owner never
  notices.

⚠ **A rental storefront is a DISCOVERY SOURCE, not a service (ADR-0010 D-1).**
It has no member in `SERVICES`, no badge and no `ServiceListing`. See the
`REQ-048` trap in ADR-0010 §5 before writing any code: the same brand name
("Fandango at Home") appears in `BRD.md` §6.2 as a deferred *service*, and
building this as that is a data-loss defect, not a shortcut.

#### US-040 — Capture a rental storefront's new-release page

**As** the owner
**I want** to screenshot the new-for-rent page and have nextup read it
**So that** a title I noticed is recorded instead of being remembered

**Traces to:** REQ-082, REQ-083
**Priority:** must *(within v1.1)*
**Epic:** L

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A batch whose source is a rental storefront | It is created | Its mode is **append-only**, and the API **refuses** `full-update` for this source with an explanatory error (REQ-083, ADR-0010 D-2) |
| AC-2 | Such a batch | Extraction runs | It uses the **same** ingest, extraction, cross-check and TMDB matching path as a service capture — no parallel pipeline exists (REQ-082) |
| AC-3 | Such a batch | It is closed | No `ServiceListing` is created, no service badge is affected, and the combined list is byte-identical before and after (ADR-0010 D-1, Trap 3) |
| AC-4 | The reconciliation logic | A discovery batch is closed | It never runs. Absence of a title from a later capture of the same page means **nothing** and can never propose a removal (REQ-083) |
| AC-5 (edge) | A work already in the combined list | It appears on the rental page and is confirmed | No `WatchIntent` is created — the owner already has it; the review pass says so rather than silently doing nothing (REQ-084) |
| AC-6 (failure) | A caller that attempts `full-update` on a discovery batch by crafting the request directly | The request is made | It is refused at the API boundary, not merely hidden in the UI (REQ-083) |

**Out of scope for this story:** adding the storefront as a service (REQ-048, v2).
**Open questions:** none.

#### US-041 — Curate the rental page down to what I actually want

**As** the owner
**I want** to keep the two or three titles I care about and never see the rest again
**So that** a page of forty new releases does not become forty rows of noise

**Traces to:** REQ-084, REQ-085
**Priority:** must *(within v1.1)*
**Epic:** L

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A discovery review pass | It is rendered | **Every** extracted title is shown, and every disposition defaults to `pending` — nothing enters the waiting list without an explicit action (REQ-014, no accept-by-inaction) |
| AC-2 | A candidate the owner **discards** in a discovery review pass | The batch is closed | A `Suppression` is created for that canonical work (REQ-085, ADR-0010 D-5) |
| AC-3 | A suppressed work | The same page is captured again next week | It does not appear in the review pass **at all** — the check is before record creation (US-028 AC-2, REQ-071) |
| AC-4 | The rationale | Any implementation review | Without AC-2, a rotating editorial feed re-presents the same rejects on every capture and the review pass is unusable within about three captures. This MUST be asserted by a test that captures the same page twice with a discard in between and verifies the second review pass is empty of it (NFR-003) |
| AC-5 (edge) | The **same** discard behaviour in a Netflix or Max review pass | A candidate is discarded | It does **not** suppress. Discard-suppresses is scoped to discovery sources only, because a curated saved list does not re-present its rejects (REQ-085) |
| AC-6 (failure) | Suppression fails to persist while closing a discovery batch | The owner closes the batch | The close fails as one transaction; no partial curation is committed |

**Out of scope for this story:** a reason or rating on the suppression.
**Open questions:** none.

#### US-042 — Be told when a waiting title starts streaming

**As** the owner
**I want** nextup to notice when something I'm waiting on reaches Netflix or Max
**So that** I stop missing the moment it becomes watchable

**Traces to:** REQ-086, REQ-087
**Priority:** must *(within v1.1 — this is the story that justifies the epic)*
**Epic:** L

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A `WatchIntent` whose availability was last checked longer ago than `WATCH_PROVIDER_MAX_AGE_DAYS` | The owner **opens the waiting view** | Its availability is refreshed from TMDB's watch-provider data for the owner's region (REQ-086, ADR-0010 D-3) |
| AC-2 | That refresh | It runs | It happens **on access only**. No scheduler, timer, queue or background worker exists for it, and if the owner never opens the view no request is ever made (REQ-041, ADR-0010 §4) |
| AC-3 | A work TMDB reports as `flatrate` on a service in `SERVICES` | The waiting view renders | It is flagged **"Now on <service> — add it to your list"** with a link, and it is **not** added to the combined list (ADR-0010 D-4, §4) |
| AC-4 | The refresh | It completes | It changes availability metadata **only**. No `Title`, `ServiceListing` or `Suppression` is created, deleted or re-stated; no combined-list membership or ordering changes (REQ-041) |
| AC-5 (edge) | A work available only to **rent or buy**, with no `flatrate` offer | The waiting view renders | It stays in the waiting state and is **not** flagged as streaming. Rent-availability is what the owner is waiting to escape, so presenting it as a hit inverts the feature |
| AC-6 (edge) | TMDB has no watch-provider data, or the region has none | The view renders | It reads *"not seen on your services as of <date>"* — never *"not streaming anywhere"*, which the data cannot support (ADR-0010 Trap 4) |
| AC-7 (failure) | TMDB is unreachable during the refresh | The owner opens the view | The view renders from the last-known availability with its as-of date, and an unobtrusive note that the refresh failed. It is never blank and never an error page (NFR-014 pattern) |
| AC-8 | `WATCH_PROVIDER_MAX_AGE_DAYS` | The source is inspected | It is a **third, independent** constant, declared separately from `TMDB_METADATA_MAX_AGE_DAYS = 183` (NFR-014) and `IMAGE_RETENTION_DAYS = 30` (NFR-019), with no shared call site — the `T-INV-008` rule extended to three (ADR-0010 Trap 5) |
| AC-9 | Any surface rendering availability | It is rendered | It carries the **JustWatch** attribution TMDB requires for watch-provider data, which is a condition of use and stricter than NFR-013's general TMDB attribution (REQ-087) |

**Out of scope for this story:** push notification or email of any kind — there is no notification channel and NFR-005 forbids the infrastructure.
**Open questions:** **OQ-030** — the owner's TMDB region is assumed `US`; if it is ever wrong, every availability answer is wrong. Confirm before build.

#### US-043 — Browse and clear the waiting list

**As** the owner
**I want** a view of everything I'm waiting on
**So that** the mental list becomes a real one I can consult

**Traces to:** REQ-082, REQ-084
**Priority:** must *(within v1.1)*
**Epic:** L

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | The waiting view | It renders | It shows one row per `WatchIntent`, with the discovery date, the storefront it was seen on, and the availability state with its as-of date |
| AC-2 | The combined list | It renders | It is **unaffected** by the waiting view's contents — no waiting title appears in it, and no badge count (REQ-025) counts a `WatchIntent` (ADR-0010 Trap 3) |
| AC-3 | A waiting work that the owner later adds to Netflix, which is then captured normally | The service capture closes | The work enters the combined list by the ordinary path, and its `WatchIntent` is satisfied and leaves the waiting view (ADR-0010, step 7) |
| AC-4 | A waiting work | The owner chooses "not interested" | It is suppressed on canonical work identity like any other work (REQ-070/071) and leaves the waiting view |
| AC-5 (edge) | A `WatchIntent` satisfied by AC-3 | The removed/history surfaces render | The satisfied intent is retained, never hard-deleted — REQ-028 applies to `WatchIntent` exactly as to every other record |
| AC-6 (failure) | An empty waiting list | The view renders | It explains what the view is for and how to fill it, rather than rendering an unexplained empty state (§9) |

**Out of scope for this story:** sorting and filtering beyond date; promote from `roadmap.md` if the list grows past roughly fifty rows.
**Open questions:** none.

#### Required amendment to Epic K when this epic is promoted

⚠ **US-036 AC-2 currently reads "exactly two" non-owner-initiated processes,
and `T-CI-005` asserts that count.** The availability refresh is a third.
Promoting Epic L therefore **requires amending US-036 AC-2 and `T-CI-005` to
three, in the same change**, naming the availability refresh explicitly and
recording that it is metadata-only and access-triggered. This is part of the
epic, not a follow-up: discovering it as a red `T-CI-005` at the end of the
build is the predictable failure. The amendment must be made **in place**, per
the editing convention in `.github/copilot-instructions.md` §5.

---

## 7. Functional detail

Everything in this section is normative and does not belong to a single story.

### 7.1 Title states

A canonical work, as seen by the owner, is in exactly one of three states. These are distinct concepts and MUST NOT be collapsed into a single flag.

| State | Meaning | Visible in combined list | Visible in removed view | Visible in suppressed view | Eligible for removal confirmation |
|---|---|---|---|---|---|
| `active` | Has at least one `active` ServiceListing and no active Suppression | Yes | No | No | Yes |
| `removed` | All its ServiceListings are `removed`, no active Suppression | No | Yes | No | No (already removed) |
| `suppressed` | An active Suppression exists for the canonical work, regardless of listing states | No | No | Yes | **No** (REQ-073) |

Suppression is evaluated on the canonical work; `active`/`removed` are evaluated per ServiceListing and rolled up to the Title. A suppressed work with active listings returns to the combined list on un-suppression; a suppressed work with only removed listings returns to the removed view (US-029 AC-3, AC-4).

**Transitions**

| From | To | Trigger | Reversible by |
|---|---|---|---|
| (none) | `active` | Owner confirms an addition in a review pass (US-012) | US-032 batch undo (creates-only), or manual removal |
| `active` | `removed` | Owner confirms a removal group in a closed full-update batch (US-015, US-016) | US-017 group undo, or US-025 restore |
| `removed` | `active` | **Owner-initiated restore only** (US-025). Never automatic (REQ-063, REQ-065) | Removal again |
| `removed` | (new `active` Title) | The work reappears in a later capture — a **brand-new** Title dated today; the old row is untouched (US-026) | US-032 batch undo (if creates-only) |
| `active` or `removed` | `suppressed` | Owner marks not interested (US-027) | US-029 un-suppress |
| `suppressed` | prior state | Owner un-suppresses (US-029) | Suppress again |

### 7.2 Upload mode semantics

| | Append-only | Full update |
|---|---|---|
| Service scope | Exactly one (REQ-002) | Exactly one (REQ-002) — absence is meaningful **only** for this service |
| Meaning of a title present in the capture | Add it if new to this service | Add it if new to this service; otherwise confirm it is still there |
| Meaning of a title **absent** from the capture | **Nothing.** Absence never removes (REQ-022) | Proposed for removal, ticked by default (REQ-015, REQ-055) |
| Review pass shows | New items only (REQ-011) | **All** extracted titles, including already-known ones, plus the removal set (REQ-057) |
| Reconciliation | None | Once, against the union of all images in the batch (REQ-006) |
| Applies at | Batch close (US-005) | Batch close, and removals additionally require the explicit group confirmation (REQ-020) |

The reason full update shows already-known titles (REQ-057) is the product's most important safety property: if extraction fails to read a title that is genuinely still on the list, the owner sees it missing from "Already on your list" *and* present in the removal set, and can rescue it. Hiding already-known items to shorten the review converts an extraction failure into silent data loss.

### 7.3 Dedup, badges and ordering

- One Title per canonical work (REQ-024, REQ-026). One ServiceListing per (work, service).
- The combined list row shows one badge per **non-removed** listing (REQ-025). A full-update removal for service S clears only S's badge (REQ-023).
- A Title with zero non-removed listings is hidden from the combined list (REQ-031) and retained forever (REQ-028).
- **Sort value = the earliest date-added across the Title's non-removed listings** (REQ-036), with a deterministic tie-breaker for stable ordering.
  - Consequence 1: adding a work that is already in nextup to a second service does not move it to the top.
  - Consequence 2: removing the earliest listing can move the row, because the sort value is recomputed.
  - Consequence 3 (v1.1): once editing date-added exists (REQ-059), editing the earliest listing's date moves the row while editing a later one does not.
- Default order is date added, most recent first (REQ-038; **confirmed by the owner at A44**, no longer assumption ASM-035). REQ-038 **is** the default-order requirement, and it also covers the reverse-direction control (AC-6) — there is no separate requirement for reversing.

**How REQ-036 (earliest date) and REQ-038 (newest-first) compose:** these two rules do not contradict each other — they compose coherently. REQ-036 fixes *which* date a Title sorts on (the earliest non-removed listing's date-added, stable regardless of later re-acquisitions on other services); REQ-038 fixes the *direction* the list is walked by default (descending — most recent sort-value first). Put together: **the list is ordered by when each work first entered the owner's world, most-recently-first.** Worked example: a work saved on Netflix in 2024 and added to Max yesterday sorts by its 2024 date (REQ-036) and stays low in the list — it does **not** jump to the top just because it was re-added on Max yesterday. "Newest-first" describes the walk direction over sort values that are themselves anchored to the earliest, not most recent, acquisition date.

### 7.4 Closed enumeration of permitted mutations (REQ-041)

**Owner-initiated operations that may change user-visible list state — this list is closed:**

1. Closing a batch, applying confirmed additions and corrections (US-005, US-012).
2. Confirming a removal group within a closed full-update batch (US-015, US-016).
3. Undoing a confirmed removal group (US-017).
4. Restoring a removed listing from the removed view (US-025).
5. Fix-match on a Title (US-030).
6. Undoing a creates-only batch (US-032).
7. Suppressing a work (US-027).
8. Un-suppressing a work (US-029).

**Non-owner-initiated processes permitted to exist — exactly two, and neither changes user-visible list state:**

1. Lazy TMDB metadata refresh on access (REQ-076, US-010) — touches TMDB-sourced descriptive fields only (NFR-014).
2. Screenshot image purge at 30 days (NFR-019, US-035) — touches image bytes only.

Anything not on these lists is **forbidden by default**. REQ-041 has already been widened five times during requirements work; widening it again is an explicit amendment, not an implementation decision.

### 7.5 Validation and input rules

| Input | Rule | On violation |
|---|---|---|
| Batch service | Required, exactly one of {Netflix, Max} (REQ-002) | Batch cannot be submitted |
| Batch mode | Required, exactly one of {append-only, full update}, no accept-by-inaction default (REQ-003) | Batch cannot be submitted |
| Images | At least one; PNG, JPEG or HEIC/HEIF (ASM-058, A42 — was PNG/JPEG only under falsified ASM-034); multiple permitted (REQ-004). HEIC/HEIF is transcoded to PNG server-side on ingest (neither reader accepts it), and EXIF/GPS is stripped on ingest (US-004 AC-7, AC-8) | Non-conforming file rejected at attach time, with the accepted formats named |
| **Input path** *(new — A45, US-004 AC-1/AC-12/AC-13/AC-14)* | An image may enter a batch by **clipboard paste** (primary), **file selection**, or **drag-and-drop**. All three MUST be available where the platform supports them, MUST be mixable within one batch, and MUST converge on the **same server-side ingest pipeline** (US-004 AC-17). **File selection MUST remain a complete path on its own** — paste is an addition, never a replacement | A paste that yields no image representation is refused with the same named-formats message as a bad file (US-004 AC-4, AC-15); the batch is unchanged |
| **Clipboard read availability** *(new — A45, US-004 AC-16)* | `navigator.clipboard` requires a **secure context — HTTPS**. Every deployed environment MUST be HTTPS. iOS clipboard read requires **iOS 13.4+** | The paste affordance is hidden or disabled with a stated reason; **file selection remains fully functional**. Never a dead button, never a state with no way to add an image |
| **Clipboard read rejection** *(new — A45, US-004 AC-15)* | An iOS clipboard read **rejects silently** on any stray tap, tab switch or backgrounding, and the system callout is **never remembered** | The pending state MUST be exited within a bounded time, the outcome stated plainly, and both paste and upload re-offered. **No indefinite spinner, no generic error, no automatic retry** |
| **Image pixel dimensions** *(new — A43, US-004 AC-9)* | `width × height` MUST be `≤ NEXTUP_MAX_DECODE_PIXELS` — **25,000,000 at the as-designed 0.25 vCPU / 0.5 GiB**, 50,000,000 only if the memory remedy has been taken — and each dimension MUST be `≥ 50` and `≤ 16,000`. Read from the container header (HEIF `ispe` / PNG IHDR / JPEG SOFn) **before any decode buffer is allocated**. A byte ceiling is NOT a substitute. **The pixel limit and the container memory size move together, always** (`runbooks/scale-up-memory.md` §2) | That **one** file rejected with `IMAGE_TOO_LARGE_TO_DECODE`, naming its megapixels, the limit, the cause (container memory) and the remedy. **The rest of the batch still processes** (US-004 AC-10, AC-11) |
| **Unparseable image header** *(new — A43)* | The header MUST be parseable to obtain dimensions | That one file rejected. Never "decode and find out" |
| Service inference from image content | **Prohibited** (REQ-058) | N/A — the capability must not be built |
| Removal group confirmation | Explicit; never implied by closing the batch (REQ-020) | Removals are not applied |
| Fix-match target | Must be a TMDB work | Refused with the reason (US-030 AC-4, AC-5) |

### 7.6 Capture guidance (non-enforced)

nextup expects screenshots taken in the service's native phone app or its laptop web app. Photographs of a television screen are not a supported input: extraction quality is not guaranteed and TV interfaces do not present the saved list in a readable, complete form. v1 does not attempt to detect or reject such images — it simply does not support them, and the upload surface says so. A TV photo will most likely produce zero or garbage candidates, which the review pass makes visible (US-006 AC-3) and the owner discards.

**Getting the capture into nextup (A45).** There are two ordinary routes, and both are supported first-class:

- **Paste (primary).** On the phone, tap **"Copy"** on the screenshot preview thumbnail that appears immediately after the capture, then tap **"Paste screenshot"** in the open batch (US-004 AC-13). On a laptop, take the grab and press **Ctrl/Cmd+V** on the batch surface (US-004 AC-12). Each paste appends to the batch already open (US-004 AC-14).
- **File selection / drag-and-drop.** Take the grab and let it save normally — to Photos on the phone, to disk on the laptop — then add it with the file control or by dragging it in.

⚠ **The guidance surface must state the "Copy" step, because it is the whole precondition for the paste route** and iOS gives no second chance once the preview thumbnail fades: the screenshot goes to Photos, and the owner is on the upload route. That is a normal, fully supported outcome, not a failure (§7.8 **KL-2**).

### 7.7 Permissions matrix

There is one principal. This is recorded because its simplicity is a design constraint, not an oversight.

| Principal | Read own data | Write own data | Read others' data | Administer |
|---|---|---|---|---|
| The owner (allow-listed identity) | Yes | Yes | N/A — there are no others | N/A — no admin surface exists |
| Any other authenticated identity | No | No | No | No |
| Unauthenticated | No | No | No | No |

### 7.8 Known limitations *(new — A43 / OQ-028; **KL-2 added at A45**)*

These are **accepted, disclosed limitations of v1**, not defects and not backlog items. They are recorded here rather than left in `architecture.md` because they are user-visible.

| # | Limitation | Who it affects | Why it exists | What happens | Remedy |
|---|---|---|---|---|---|
| **KL-1** | **Very high-resolution camera photographs are refused at upload.** At the as-designed 0.25 vCPU / 0.5 GiB the pre-decode guard (US-004 AC-9) sits at **25 MP**, so a **full-resolution ~48 MP iPhone Pro camera capture (≈8064 × 5952) is refused.** | Anyone attaching a full-resolution camera photo rather than a screenshot. | Decoding a 48 MP image to raw RGBA needs ~160–195 MB — a large fraction of a 0.5 GiB container. The owner chose to start at 0.5 GiB and up-size only on a real OOM (**A43**, verbatim: *"Start at 0.5 GiB, up-size only if it OOMs."*). The guard is what converts an unbounded crash into a bounded, explained refusal. | The **one** file is refused **before** anything is decoded or stored, with a message naming its megapixels, the limit, the cause (container memory) and the remedy. **The rest of the batch still processes** (US-004 AC-10, AC-11). Nothing is silently dropped and nothing crashes. | Take the pre-authorised up-size to 0.5 vCPU / 1.0 GiB (guard → 50 MP, which covers 48 MP captures), **+~$4/month → ≈$15–18/month total**, one command: `artifacts/runbooks/scale-up-memory.md`. Owner approval is already given (A43); it is triggered by a real failure, not taken pre-emptively. |
| **KL-2** *(new — A45)* | **Pasting a screenshot on the phone requires the owner to tap "Copy" on the transient screenshot preview *before it disappears* — and every paste then costs one extra tap on a system callout, forever.** iOS screenshots are saved to **Photos by default, not to the clipboard**, and iOS **never remembers** the paste choice. | The owner, on the phone, on every capture. Paste is the **primary stated interaction** (A45), so this is the common case, not an edge. | Platform behaviour, not a nextup choice. The clipboard is populated only if the owner acts on the transient preview thumbnail; and WebKit gates every programmatic clipboard read behind a **per-invocation native callout with no "always allow"** (`Context/evidence/clipboard-paste-support.md` Q1d, Q1e items 1–2). | If the owner misses "Copy", the screenshot is simply in Photos and they use the **file-upload path**, which is fully supported and loses nothing. If they do tap "Copy", they pay one callout tap per paste, and a stray tap, tab switch or backgrounding **silently rejects** the read — which the UI detects and re-offers rather than hanging (US-004 AC-15). | **None needed — by design.** File selection remains a complete, first-class path (US-004 AC-16), so the worst case is **one extra step**, never a blocked capture. Realistic step counts: **paste ~3, upload ~4** (`inferred`, not device-measured). |

**Scope of KL-1 — read this before treating it as serious or as trivial.**

- **Ordinary screenshots are nowhere near the limit.** A 1290 × 2796 iPhone screenshot is ~3.6 MP; a 4K laptop screenshot is ~8.3 MP. Both are well under 25 MP. **The supported input classes are unaffected in normal use.**
- **The at-risk class is the camera path.** iOS camera photos default to HEIC and can be 48 MP, and the iOS Safari file input offers the camera roll and the camera alongside screenshots — so an owner *can* reach this, even by accident.
- ⚠ **Contradiction flagged, not silently resolved.** It has been put to this document that photographing a TV screen is *"one of the supported capture paths (ASM-007/A15)"*. **It is not, and the PRD must not be edited to say so.** The **A15-correction** removed that input class outright: **ASM-021** makes the input classes exactly two, both pixel-perfect digital screenshots (service phone app, service website on a laptop); **REQ-051** marks photographs of a TV or other physical screen `wont-v1`; and §7.6 above states the same. **ASM-007** is about form factor (mobile-first responsive web), not about capture by camera. The correct statement is therefore narrower and less alarming than the claim: **the camera is not a supported capture path, so KL-1 constrains an unsupported input class plus the incidental case of a camera-roll photo attached by mistake.** If the owner *does* want camera capture supported, that is a scope change (it would reopen REQ-051, RSK-009 and RSK-015), and it should be raised as a new question rather than assumed here.
- **What KL-1 does *not* do:** it does not down-scale, does not degrade extraction quality, does not fail the batch, and does not lose anything already attached.

**Scope of KL-2 — the honest size of the paste win.**

- **Paste is an accelerant, not a replacement.** The measured-by-reasoning gap between the two routes is **one tap, occasionally two** (paste ~3 steps, upload ~4 — both `inferred` in the evidence, neither step-counted on a device). The upload route has **zero failure modes**; the paste route has several (US-004 AC-15, AC-16).
- **Therefore the file-upload path is not deprecated, not secondary in capability, and must not be trimmed.** Two ordinary paths depend on it outright: the **laptop web-screenshot** path, and the **iOS Photos** path — which is where the screenshot lands by default whenever "Copy" is missed. ⚠ Any downstream document, spec, test or implementation that treats paste as *the* ingestion mechanism, or upload as a legacy fallback, is **wrong** and must be corrected in place.
- **What KL-2 does *not* do:** it does not block any capture, does not change what the batch model is (a paste appends to the same `UploadBatch`, US-004 AC-14), and does not alter the review pass in any way.

---

## 8. Non-functional requirements

| ID | Requirement | Constrains | Verified by |
|---|---|---|---|
| NFR-001 | All owner data is private to the owner; every record is owner-scoped and every read path filters on the authenticated owner. Ingested images have EXIF/GPS stripped on ingest (US-004 AC-8) so device and location metadata never enter storage. **⚠ A45: this strip stays unconditional and server-side. WebKit strips EXIF on clipboard read, which covers the paste route for free — but it covers only ONE of the two ingestion routes, and the file-upload route still delivers EXIF/GPS intact (US-004 AC-17). Do not read the paste behaviour as "handled".** | US-002; US-004; all data surfaces | US-002 AC-1, AC-2; US-004 AC-8, AC-17 |
| NFR-002 | Requirements and specs must be precise enough for an autonomous coding agent to implement without clarification. | This document; all specs | US-039 AC-1 |
| NFR-003 | Behaviour must be automatically verifiable; the named invariants must have automated tests. | US-011, US-013, US-016, US-021, US-023, US-026, US-028, US-036, US-038 | US-039 AC-2 |
| NFR-004 | Technology choices must be mainstream and conventional. | Architecture phase | US-039 AC-3 |
| NFR-005 | No telemetry, no analytics, and no background process that changes user-visible list state. | US-036; §10 | US-036 AC-5, AC-6 |
| NFR-006 | Usable at a 320px-wide viewport. **Includes the "Paste screenshot" button of US-004 AC-13, which is a primary control on the phone and must be reachable and tappable at 320px, not tucked into an overflow menu (A45).** | Every surface; US-004 AC-13 | US-037 AC-1, AC-3, AC-4; US-011 AC-3; US-004 AC-13 |
| NFR-007 | Usable at a 1024px-wide viewport. | Every surface | US-037 AC-2 |
| NFR-008 | Every data endpoint requires an authenticated session. | US-002 | US-002 AC-2, AC-3 |
| NFR-009 | No streaming-service credentials are ever stored or requested. | US-038 | US-038 AC-1 |
| NFR-010 | No automated requests of any kind to a streaming service. | US-038 | US-038 AC-2, AC-5 |
| NFR-011 | Uploaded images are accessible only to the authenticated owner. | US-004, US-035 | US-004 AC-3; US-035 AC-4 |
| NFR-012 *(A41 — now a `should`; quantified at A40; **band widened at A43**)* | ~~Runs within Azure free-tier or consumption pricing~~ **Repealed system-wide at A41.** Cost SHOULD be as low as reasonable **without degrading quality**; quality and reliability outrank price. **Settled at A40 to the owner-selected Variant A, ≈$11–14/month — and ≈$15–18/month if and only if the pre-authorised memory remedy is taken** (+~$4/month, `runbooks/scale-up-memory.md`, A43). **Both figures are compliant.** Right-sizing for a single user still binds. | US-039; US-004 (the remedy's trigger) | US-039 AC-4; US-004 AC-9, AC-11 |
| **NFR-012a** *(new, A40)* | Extraction is **exempt** from near-zero cost and optimises for **lowest reasonable cost without degrading quality** — quality outranks cost. A cost-motivated quality downgrade is non-compliance. | US-039; ADR-0001 Rev 2 | US-039 AC-5 (rewritten) |
| NFR-013 | TMDB attribution — logo plus the verbatim disclaimer — on every surface rendering TMDB data. | US-011 | US-011 AC-1, AC-2, AC-5 |
| NFR-014 | Metadata refresh must not alter any owner-authored or list-state field. | US-010 | US-010 AC-2 |
| NFR-015 | Single-owner allow-list; no self-service registration. | US-001 | US-001 AC-4 |
| NFR-016 | No passwords or password hashes stored by nextup. | US-001 | US-001 AC-3 |
| NFR-017 | Sessions persist so the owner is not re-authenticated on every visit. | US-001 | US-001 AC-6 |
| NFR-018 | The removed view must remain usable as it grows monotonically forever. | US-024 | US-024 AC-5 |
| NFR-019 | Uploaded screenshots are retained 30 days and then automatically purged — the only automatic deletion in the product. | US-035 | US-035 AC-1, AC-2, AC-7 |
| NFR-020 | Image bytes are never publicly reachable, including by unguessable URL. | US-004, US-035 | US-004 AC-3; US-035 AC-4 |

**Undecided NFR targets:** performance, availability, accessibility conformance level, usability targets and internationalisation are **not specified** in v1 (OQ-014). The implementer MUST NOT invent numeric thresholds for these and MUST NOT read their absence as permission to disregard them; they are to be resolved before the corresponding specs are finalised.

---

## 9. UX principles and required states

### 9.1 Principles

1. **Nothing changes without the owner seeing it.** Every mutation is preceded by a rendering of what will change.
2. **Empty is never ambiguous.** "You have nothing" and "we failed to load" must never look the same — this product's failure mode is silent data loss, and an empty list that is actually an error is exactly that failure wearing a disguise.
3. **Destructive-looking actions are reversible; irreversible-looking actions are refused loudly.** See US-033.
4. **Honest labels.** Dates say what they actually mean (US-021). The removed view says it is a log, not a bin (US-024).
5. **The value loop is fast; the feeder loop is safe.** Where the two conflict, the feeder loop chooses safety (US-013).
6. **Mobile first.** 320px is the design target, not the fallback.

### 9.2 Required states per surface

Detail belongs to `specs/ux-states.md`; this is the required minimum set.

| Surface | Loading | Empty | Error | Offline | Success |
|---|---|---|---|---|---|
| Combined list | Skeleton rows; never a bare blank | Two distinct empties: "nothing uploaded yet" (with the upload call to action) and "everything has been removed" (with a link to the removed view) | Explicit load failure with retry — **never** rendered as an empty list | Last-rendered content with an offline indicator; deep links still attempted | List rendered with badges and freshness dates |
| Upload / batch setup | n/a | No images added yet, with **both input affordances present — the "Paste screenshot" button and the file-selection control (A45, US-004 AC-13/AC-16)** — and format guidance naming PNG, JPEG and HEIC/HEIF (ASM-058, A42), plus the "tap Copy on the screenshot preview" hint (§7.6) | Attach or submit failure, batch remains open and re-submittable. **Per-file rejections are rendered per file, not as a batch-level error** — an image refused by the pixel guard names its megapixels, the limit, the cause and the remedy, while the accepted images continue (US-004 AC-9/AC-10/AC-11, A43). **A rejected or empty paste is its own bounded state**: pending exits, the outcome is stated, and both paste and upload are re-offered — never an indefinite spinner (US-004 AC-15). Where clipboard read is unavailable (http://, iOS < 13.4, permission denied) the paste affordance is hidden or disabled **with a stated reason** and upload alone remains fully sufficient (US-004 AC-16) | Submission blocked with a clear "you are offline" state; nothing is lost | Batch submitted, extraction in progress. **A partially-rejected batch is a success state with a per-file rejection list, not an error state.** A successful paste is a success state that shows the newly appended image in the batch's image list alongside any uploaded ones (US-004 AC-14) |
| Extraction in progress | Progress state naming the batch | n/a | `extraction failed` state with retry / re-extract (US-006 AC-4) | Progress preserved; resumable on reconnect | Review pass ready |
| Review — additions | Loading candidates | "Nothing new in this capture" (US-012 AC-6) | Match failure banner; unmatched section populated (US-008) | Review is read-only offline; confirmations blocked, not queued | Additions confirmed |
| Review — already on your list (full update only) | Loading | Count of zero shown explicitly, section still present | As above | As above | n/a — pre-confirmed |
| Review — removals | Loading | "Nothing disappeared" | As above | Confirmation blocked offline | Group confirmed, undo offered (US-017) |
| Removed view | Loading | "Nothing has ever been removed" | Load failure with retry — never an empty log | Cached content with offline indicator | Log rendered, framed as history |
| Suppressed view | Loading | "You haven't marked anything as not interested" | Load failure with retry | Cached content with offline indicator | List rendered with un-suppress actions |
| Batch detail / undo | Loading | n/a | Undo failure, state unchanged | Undo blocked offline | Undone, or **refused with the full enumeration** (US-033) — the refusal is a success state of the enumeration feature, not an error state |

---

## 10. Analytics and instrumentation

**nextup ships with no analytics, no telemetry, and no usage tracking. NFR-005 and REQ-052 forbid them, and this is not negotiable at implementation time.** No event schema is defined here, and the implementer MUST NOT add one.

The BRD's success metrics are therefore answered by owner self-assessment, plus one signal the product already renders for free.

| Metric | How it is answered | Source |
|---|---|---|
| M1–M4 | Owner self-assessment at Checkpoint 1 | No instrumentation |
| M5 — "was the last full-update review tolerable?" | Owner self-assessment. **This is the kill/pivot criterion**: a "no" is an ergonomics failure that no additional feature fixes (OQ-011) | No instrumentation |
| M6 | Owner self-assessment | No instrumentation |
| M7 — is the list being kept current? | **Visible for free**: the per-service last-updated dates already on the combined list | REQ-039 (US-022) |
| M8–M9 | Owner self-assessment at Checkpoint 1 / Checkpoint 2 | No instrumentation |

Checkpoint 1 is assessed 30 days after the first completed import of **both** Netflix and Max; Checkpoint 2 follows later and assesses SUC-004 only. No dates are set (A19).

Operational logging sufficient to diagnose failures is permitted, provided it contains no owner list content and is not used as usage analytics.

---

## 11. Release scope

### 11.1 v1

All 39 stories below are in v1. All are `must` except where noted in the story.

| Epic | Stories |
|---|---|
| A — Access and ownership | US-001, US-002 |
| B — Upload and batch boundary | US-003, US-004, US-005 |
| C — Extraction and matching | US-006, US-007, US-008, US-009, US-010, US-011 |
| D — Review pass, additions | US-012, US-013 |
| E — Review pass, removals | US-014, US-015, US-016, US-017 |
| F — Combined list | US-018, US-019, US-020, US-021 |
| G — Freshness | US-022 |
| H — Removed view and history | US-023, US-024, US-025, US-026 |
| I — Suppression | US-027, US-028, US-029 |
| J — Recovery | US-030, US-031, US-032, US-033, US-034, US-035 |
| K — Platform guarantees | US-036, US-037, US-038, US-039 |

### 11.2 v1.1 — deferred requirements (explicitly deferred, not dropped)

These four requirements were deferred at the phase 4 lock. They are **not** in v1 and have no v1 story. They are recorded here so they are not lost.

| REQ | Requirement | Deferral decision | Revisit trigger |
|---|---|---|---|
| REQ-035 | Filter the combined list by runtime | D2 | Once the owner reports that service/type/genre filtering is insufficient to narrow a real list |
| REQ-037 | Sort the combined list by runtime | D2 | As REQ-035 — the two ship together |
| REQ-059 | Edit a title's date-added value | D1 | Once the honest "added to nextup" label (REQ-061) proves insufficient in practice. **Coupling: reinstating REQ-059 invalidates the creates-only batch-undo simplification (D3), because an edited date makes a batch's changeset mixed. REQ-059 and REQ-069 must then be reconsidered together (OQ-023).** |
| REQ-069 | Undo a batch with a mixed changeset (creations plus modifications or removals) | D3 / A36 | Once the enumerated refusal (REQ-075, US-033) proves too costly in practice, or once REQ-059 lands |

v1's substitutes are deliberate, not accidental: REQ-035/REQ-037 are substituted by service, type and genre filtering (US-019, US-020); REQ-059 by honest date labelling (US-021); REQ-069 by the enumerated refusal (US-033).

### 11.3 Explicitly out of scope, all releases considered so far

REQ-042 to REQ-054 (`wont-v1`): automated list retrieval, multi-user, sharing, availability data, price tracking, recommendations, watched/progress tracking, ratings, native apps, notifications, background list-changing jobs, telemetry, and services beyond Netflix and Max.

---

## 12. Dependencies and risks

### 12.1 Build order

1. **Epic A** — nothing is reachable without sign-in and owner scoping.
2. **Epic B** — the batch boundary must exist before anything can mutate state, because US-005 is what makes every later story safe.
3. **Epic C** — extraction and matching, behind an interface. **OQ-005 is now closed** (ADR-0001 Rev 2: hybrid `gpt-4.1` vision + `Read` OCR cross-check); the interface still matters, because it is what let the provider change after phase 7 with a one-line config edit. US-011 (attribution) can be built as soon as any TMDB data renders and MUST NOT be left to the end.
4. **Epic D**, then **Epic F** — additions plus the combined list is the first end-to-end value: the owner can import and browse. This is the earliest point at which the product is worth using.
5. **Epic E** — removals, which depend on D (US-013's already-known section) and on F (badges).
6. **Epic H** — the removed view, which only has content once E exists.
7. **Epic I** — suppression, which depends on H because its semantics are defined against reappearance (US-026).
8. **Epic J** — recovery, which depends on provenance (US-031) being written from the moment batches close; US-031 should therefore be implemented **with** Epic B/D rather than late, even though it is listed in J.
9. **Epic G** and **Epic K** — freshness and the platform invariants, verified continuously rather than at the end.

Note the one inversion: **US-031 (provenance) must be built early**, with Epic B/D, or US-032 and US-033 cannot be correct.

### 12.2 External dependencies

| Dependency | Used for | Risk | Mitigation in this document |
|---|---|---|---|
| TMDB API | Title identity, metadata, posters, search | Availability, rate limits, terms compliance | US-007 AC-5, US-010 AC-4, US-011 (attribution is a compliance obligation whose failure is invisible from inside the app) |
| Vision/OCR provider | Extraction | **Chosen: Azure OpenAI `gpt-4.1` vision + `Read` OCR cross-check (ADR-0001 Rev 2)**. Exempt from NFR-012 per NFR-012a. Residual concern is **fabrication (RSK-028)**, not cost | Interface (US-006) makes the provider swappable by config; OCR leg cross-checks every image so silent omission is structurally impossible |
| Federated identity provider | Sign-in | Unchosen (OQ-019) | OIDC-compliant; provider choice confined to configuration (US-001) |
| Azure hosting | Everything | Cost creep **beyond the ≈$11–14/month owner-selected figure** — the concern is drift from a number the owner explicitly chose, not exceeding a free tier. **A43: a move to ≈$15–18/month is NOT creep** if it is the pre-authorised memory remedy taken in response to a real failure (`runbooks/scale-up-memory.md`); it is creep if it happens without that trigger. Budget alert at 1.5× (TASK-142) — set it against whichever figure is currently live; prices unverified ±30 % (**RSK-029**, TASK-010) | NFR-012 *(now a `should`)*, US-039 AC-4, US-004 AC-9/AC-11 · ~~OQ-026~~, ~~OQ-028~~ *(closed by A40, A43)* |
| HEIC/HEIF transcode (`heic-convert` → `libheif-js`, optionally `sharp`) | Server-side decode of HEIC/HEIF to PNG on ingest, since neither extraction service accepts HEIC (US-004 AC-7) | Licence: the decode dependency chain ends at **LGPL-3.0** (`libheif-js`, decode-only); wrappers are ISC. Decode-only means no GPL `x265`/patent-encumbered encoder | Compatible with this MIT repo **provided the LGPL-3.0 notice is retained** in NOTICE/THIRD-PARTY and `libheif-js` is used unmodified. Pure JS/WASM — no native container build. Flagged for human licence sign-off (US-004 AC-7) |
| The owner | The **entire** data feed | If the feeder loop is too costly, the product dies | M5 kill criterion; US-012/US-013 ergonomics work under OQ-011 |

### 12.3 Risks

| # | Risk | Impact | Response |
|---|---|---|---|
| R-1 | The review pass is too laborious at first-run volume and the owner abandons nextup. | Fatal — this is the M5 kill criterion. | Bulk confirm affordances (US-012 open-questions note), append-only for top-ups, group removal confirm. Tracked as OQ-011. |
| R-2 *(reduced by A40)* | Extraction quality is poor, producing many unmatched candidates. | High — turns the feeder loop into data entry. | **Materially reduced**: A40 lets extraction optimise for quality over cost, and ADR-0001 Rev 2 selects a multimodal primary that reads tile layout and recovers ellipsised titles. Unmatched candidates are still surfaced, never dropped (US-008); re-extraction (US-034). ~~Manual entry fallback~~ retired. |
| R-3 | An implementer "optimises" the full-update review by hiding already-known titles. | Fatal and silent — converts extraction failure into data loss. | US-013 AC-6 mandates an automated test. |
| R-4 | An implementer de-duplicates the removed view, thinking repeated rows are a bug. | High — destroys the historical log. | US-024 AC-6 states the prohibition explicitly. |
| R-5 | Suppression implemented as a row flag rather than on canonical identity. | High and silent — bypassed on the very next capture, because reappearance creates a new row. | US-028 AC-3 mandates the suppress → remove → re-upload test. |
| ~~R-6~~ **CLOSED** | ~~OQ-005 resolves to an option that breaches NFR-012.~~ | — | Closed twice: every candidate priced under $1/month in phase 7, then **A40** carved extraction out of the constraint entirely (NFR-012a). **Replaced by RSK-028** — the multimodal primary fabricates a plausible title the owner accepts on review; mitigated by the mandatory OCR cross-check and `inferred-unverified` marking beside the cropped tile. |
| R-7 | OQ-015 is answered implicitly by an implementer inventing an identity scheme for unmatched titles. | Medium-high — it is also the fallback suppression key, so a wrong guess silently weakens suppression. | US-008 and US-028 both state the prohibition and name OQ-015 as one decision, not two. |
| R-8 | TMDB attribution is omitted or paraphrased. | Medium — a compliance failure invisible from inside the app. | US-011 AC-5 mandates an automated test. |
| R-9 | The removed view grows unboundedly and becomes slow. | Medium — it grows forever by design. | NFR-018, US-024 AC-5. |
| R-10 | REQ-041's closed enumeration is quietly widened by a convenience feature. | Medium-high — erodes the guarantee that only the owner changes the list. | §7.4 declares the list closed and forbidden-by-default; US-036 AC-3, AC-4. |
| R-11 *(new — A42)* | An agent-derived inference is left unconfirmed and encoded as a hard instruction, then falsified on first real use. | **Realised, and it was nearly fatal.** **ASM-034 ("PNG/JPEG only") was an agent inference, never owner-confirmed. As originally specified, US-004 AC-4 would have rejected the owner's own phone images at attach time, and the phone is the primary capture device (ASM-007 / A15) — v1 would have failed on first use.** This is the **third** agent-derived inference to be falsified when finally tested by the owner, after the phone-photo-of-TV inference (A15) and the reappearance-transitions-back inference (ASM-047 / A33). | Superseded by ASM-058 (accept PNG + JPEG + HEIC/HEIF, transcode on ingest — US-004 AC-4/7/8). **ASM-035 (default sort order) was subsequently CONFIRMED by the owner at A44** — the first of five tested agent-derived inferences to survive (see R-14). **ASM-038** (30-day list-staleness placeholder) was **RETIRED at A46** — the owner dropped the concept entirely rather than confirming or falsifying the threshold value, so it counts as falsified for scorecard purposes. **Final agent-derived-assumption scorecard: 6 tested, 1 confirmed (ASM-035), 5 falsified (A15 phone-photo-of-TV, ASM-047 reappearance, ASM-034 upload formats, ASM-012/013 ingestion transport, ASM-038 staleness threshold). Zero unconfirmed agent-derived assumptions remain.** |
| **R-12** *(new — A43 / OQ-028; **ACCEPTED RESIDUAL, not open**)* | **An upload dies on a memory limit at 0.25 vCPU / 0.5 GiB** — either an image refused by the 25 MP pre-decode guard (US-004 AC-9) or a genuine out-of-memory condition during HEIC transcode or extraction. Tracked in the architecture register as **`RSK-016`** (⚠ *see the naming collision note below*). | **Medium likelihood, contained impact — and the owner has knowingly accepted it.** The owner was shown the priced remedy, was **told plainly that the failure can land mid-import**, and answered verbatim: **"Start at 0.5 GiB, up-size only if it OOMs."** (`A43`). **`OQ-028` is CLOSED with the residual risk accepted by the owner.** The realistic cost of a hit is a re-attach, not data loss: no batch can be half-applied (US-005 AC-3), and other images in the batch are unaffected (US-004 AC-10). | **The remedy is documented and PRE-AUTHORISED — no further approval is required to take it, and it MUST NOT be taken pre-emptively.** Trigger: a real OOM, an OOM/restart alert, or an `IMAGE_TOO_LARGE_TO_DECODE` refusal on an image the owner actually needs. Procedure: **`artifacts/runbooks/scale-up-memory.md`** — one `az containerapp update` to 0.5 vCPU / 1.0 GiB with the guard raised to 50 MP, plus the matching `infra/aca.bicep` commit; **+~$4/month → ≈$15–18/month**. Acceptance is **conditional on five mandatory mitigations shipping** (`A43-M1`…`M5`): the pre-decode pixel guard (US-004 AC-9), one-image blast radius (US-004 AC-10), a self-explaining error naming cause and remedy (US-004 AC-11), the runbook, and an OOM/restart alert so the trigger is **observed rather than inferred**. **Shipping without them converts an accepted risk back into an unaccepted one.** User-visible consequence: **KL-1** (§7.8). |
| **R-13** *(new — A45; iOS paste brittleness)* | **The clipboard-paste path — now the owner's PRIMARY stated ingestion interaction — is brittle on iOS in ways nextup cannot fix.** Every paste costs a tap on a system callout that iOS never remembers; a stray tap, a tab switch or backgrounding Safari **rejects the read silently**, with no error; the clipboard is only populated at all if the owner caught "Copy" on the transient screenshot preview; and `navigator.clipboard` is absent entirely without HTTPS. The failure mode to fear is an implementation that **appears to hang** on a rejected read, which reads to the owner as "the app is broken" on the very interaction they said they would use most. | **Medium likelihood, low-to-medium impact — contained by design, not by luck.** No data is at risk: nothing is committed before review-close (US-005 AC-3), the batch survives a failed paste intact (US-004 AC-6, AC-15), and the file-upload path is a complete alternative that works every time. The realistic worst case is **one extra step and a moment of confusion**. The real exposure is *perceived* unreliability on the primary interaction. | **Four controls, all mandatory and all already acceptance criteria — do not treat them as polish.** (1) The iOS path is a **visible button calling `clipboard.read()`** in the click handler, never a gesture or a document-level listener (US-004 AC-13). (2) Desktop uses the **`paste` event**, which is prompt-free (US-004 AC-12). (3) **Rejection is detected, bounded and re-offered** — no spinner, no generic error, no auto-retry (US-004 AC-15). (4) **File upload remains a complete first-class path** and the paste affordance degrades to hidden/disabled-with-reason where clipboard read is unavailable (US-004 AC-16). ⚠ Removing or downgrading control (4) — "paste works now, so upload can go" — is the failure this row exists to prevent, and it would break the laptop path and the iOS Photos path outright. User-visible consequence: **KL-2** (§7.8). |
| **R-14** *(new — A44; accepted trade-off, not open)* | **The owner chose newest-first knowingly, having been told it works against SUC-003** (the success metric about *old, forgotten* saves resurfacing). Newest-first buries exactly the titles the product exists to resurface: a title saved two years ago and never watched will sit at the bottom of the default view indefinitely unless something else surfaces it. | **This is an ACCEPTED trade-off, not an error.** The owner's verbatim answer was "Newest-first — conventional, recent saves on top" (A44), confirming ASM-035 with the SUC-003 tension disclosed up front. **Nothing has been silently added to compensate** — no auto-surfacing, no "forgotten titles" widget, no change to the default was invented to offset this. | **The mitigation already exists and requires no code change:** REQ-038's reverse direction (oldest-first) is owner-selectable, so the owner can test the alternative ordering themselves. This is the **first thing to revisit** if, at the 30-day self-assessment checkpoint, the owner reports that the forgotten-titles problem persists. **Cross-reference OQ-029** (Context layer). ✅ **RESOLVED at `A47` — the flag is closed.** The owner was asked whether to promote it and answered *"Yes — promote to must"*. **REQ-038 is now `must`**, so the oldest-first control is mandatory in v1 and the escape hatch **cannot** be dropped as optional scope. ~~Previously flagged: REQ-038 carried priority `should`, meaning the sole accepted mitigation for this trade-off could legitimately have been dropped from v1, silently closing the hatch.~~ |
| **⚠ Naming collision, flagged not resolved** | **`RSK-016` means two different things in two different registers.** In `architecture.md` it is the **memory/OOM** risk (R-12 above). In `artifacts/BRD.md` §9 it is *"agent-generated code passes stated criteria while being subtly wrong at the edges"*. Both are live; neither is wrong; they are simply different registers that were numbered independently. | Medium — a reader or an implementing agent following a bare `RSK-016` reference can land on the wrong risk and mitigate the wrong thing. | **Always qualify the register when citing it** — "`RSK-016` (architecture: memory/OOM)" or "`RSK-016` (BRD: agent-code correctness)". Not renumbered here, because renumbering a risk ID across four documents mid-flight is more dangerous than the ambiguity. **Recommend the orchestrator assign one of them a fresh ID in a single co-ordinated pass.** |

---

## Appendix A — Traceability matrix

### A.1 Functional requirements in v1 scope (59)

| REQ | Covered by | Status |
|---|---|---|
| REQ-001 | US-004 | Covered |
| REQ-002 | US-003, US-014 | Covered |
| REQ-003 | US-003 | Covered |
| REQ-004 | US-004 | Covered |
| REQ-005 | US-005 | Covered |
| REQ-006 | US-005 | Covered |
| REQ-007 | US-004 | Covered |
| REQ-008 | US-006 | Covered |
| REQ-009 | US-007 | Covered |
| REQ-010 | US-009 | Covered |
| REQ-011 | US-013 | Covered |
| REQ-012 | US-008 | Covered |
| REQ-013 | US-012, US-015, US-034 | Covered |
| REQ-014 | US-012 | Covered |
| REQ-015 | US-014 | Covered |
| REQ-016 | US-012 | Covered |
| REQ-017 | US-012 | Covered |
| REQ-018 | US-012 | Covered |
| REQ-019 | US-014 | Covered |
| REQ-020 | US-015 | Covered |
| REQ-021 | US-015 | Covered |
| REQ-022 | US-014, US-016 | Covered |
| REQ-023 | US-014, US-016, US-018 | Covered |
| REQ-024 | US-018 | Covered |
| REQ-025 | US-018 | Covered |
| REQ-026 | US-018 | Covered |
| REQ-027 | US-016, US-031 | Covered |
| REQ-028 | US-023, US-016, US-029, US-032 | Covered |
| REQ-029 | US-007 | Covered |
| REQ-030 | US-021 | Covered |
| REQ-031 | US-018, US-023 | Covered |
| REQ-032 | US-019 | Covered |
| REQ-033 | US-019 | Covered |
| REQ-034 | US-019 | Covered |
| REQ-036 | US-020 | Covered |
| REQ-038 | US-020 | Covered (**`must`** — promoted from `should` at `A47`) |
| REQ-039 | US-022 | Covered |
| REQ-040 | ~~US-022~~ | **Retired at A46** — dropped entirely per the owner's verbatim answer ("Drop the concept entirely — no staleness nudge"); no longer traced to any story |
| REQ-041 | US-036, §7.4 | Covered |
| REQ-055 | US-015 | Covered |
| REQ-056 | US-017 | Covered |
| REQ-057 | US-013 | Covered |
| REQ-058 | US-003 | Covered |
| REQ-060 | US-021 | Covered |
| REQ-061 | US-021 | Covered |
| REQ-062 | US-024 | Covered |
| REQ-063 | US-025, US-026 | Covered |
| REQ-064 | US-024 | Covered |
| REQ-065 | US-026, US-024, US-025 | Covered |
| REQ-066 | US-030 | Covered |
| REQ-067 | US-032 | Covered |
| REQ-068 | US-031 | Covered |
| REQ-070 | US-027 | Covered |
| REQ-071 | US-028 | Covered |
| REQ-072 | US-029 | Covered |
| REQ-073 | US-014, US-027 | Covered |
| REQ-074 | US-034 | Covered |
| REQ-075 | US-033 | Covered |
| REQ-076 | US-010 | Covered |

### A.2 Non-functional requirements (20, all in v1)

| NFR | Covered by | Status |
|---|---|---|
| NFR-001 | US-002, US-004 | Covered |
| NFR-002 | US-039 | Covered |
| NFR-003 | US-039 (and the nine named invariant tests) | Covered |
| NFR-004 | US-039 | Covered |
| NFR-005 | US-036 | Covered |
| NFR-006 | US-037, US-011, US-019 | Covered |
| NFR-007 | US-037 | Covered |
| NFR-008 | US-002 | Covered |
| NFR-009 | US-038, US-001 | Covered |
| NFR-010 | US-038 | Covered |
| NFR-011 | US-004, US-035, US-002 | Covered |
| NFR-012 | US-039, US-004 | Covered |
| NFR-013 | US-011 | Covered |
| NFR-014 | US-010 | Covered |
| NFR-015 | US-001 | Covered |
| NFR-016 | US-001 | Covered |
| NFR-017 | US-001 | Covered |
| NFR-018 | US-024 | Covered |
| NFR-019 | US-035 | Covered |
| NFR-020 | US-004, US-035 | Covered |

### A.3 Deferred to v1.1 — deliberately without v1 stories

| REQ | Status |
|---|---|
| REQ-035 | Deferred to v1.1 (D2) — §11.2 |
| REQ-037 | Deferred to v1.1 (D2) — §11.2 |
| REQ-059 | Deferred to v1.1 (D1) — §11.2 |
| REQ-069 | Deferred to v1.1 (D3 / A36) — §11.2, substituted by US-033 |

### A.4 Out of scope

REQ-042 … REQ-054 (13 requirements marked `wont-v1`) have no stories by design. See §11.3.

### A.5 Coverage summary

**Uncovered requirements: none.** All 59 functional requirements in v1 scope and all 20 NFRs are covered by at least one story.

### A.6 Discrepancy found in the source documents

`Context/requirements.md` §1.8 and `Context/mvp-definition.md` §18 both state the headline "63 functional requirements, 62 in v1, REQ-069 deferred". That count subtracts only REQ-069. However, **REQ-035, REQ-037 and REQ-059 are each individually marked "DEFERRED TO v1.1" in their own requirement rows and in `mvp-definition.md` §5.1/§5.2**, under decisions D2 and D1 taken at the same phase 4 lock.

The correct v1 functional count is therefore **59, not 62**. This is a bookkeeping error in the headline totals, not a scope ambiguity: the per-requirement rows are unambiguous and are treated as authoritative by this PRD. No requirement's scope status is in doubt; only the summary arithmetic is wrong. Recommendation: correct the headline counts in `requirements.md` §1.8 and `mvp-definition.md` §18 to read "63 functional, 59 in v1, four deferred to v1.1 (REQ-035, REQ-037, REQ-059, REQ-069)".

**Second discrepancy — introduced by A45, and NOT fixable from this document.** `Context/requirements.md` REQ-001 carries the rationale *"Screenshot upload is the sole ingestion mechanism (ASM-012)"*, and **ASM-012/ASM-013** are phrased as *"Screenshot **upload** → OCR/vision → TMDB match → dedup is the ingestion mechanism"*. After **A45** that wording is **wrong as written**: ingestion is now **clipboard paste (primary), file selection, and drag-and-drop**, all converging on one server-side pipeline (US-004 AC-1, AC-12 … AC-17). The *substance* of REQ-001 and ASM-012 is unchanged and still correct — **owner-supplied screen captures are the sole ingestion mechanism; no automated retrieval exists (NFR-009, NFR-010)** — only the word "upload" is now too narrow for the set of input paths. `Context/` is outside this document's ownership, so this is **reported, not edited**. Recommendation to the orchestrator: amend REQ-001's rationale and ASM-012/ASM-013 to read *"owner-supplied screen captures, entered by paste or file upload"*. Until that lands, **this PRD is authoritative on the input paths** and no implementer should read "upload" in `requirements.md` as excluding paste.

### A.7 Open questions carried into implementation

| OQ | Subject | Blocks | Named in |
|---|---|---|---|
| ~~OQ-005~~ **CLOSED** | Vision/OCR approach and cost — decided in phase 7, then **re-decided after A40** relaxed the cost constraint for extraction. Final: hybrid `gpt-4.1` vision + `Read` OCR cross-check (ADR-0001 Rev 2), ~$0.50–$0.70/mo, exempt from NFR-012 via NFR-012a | — | US-006, US-034, US-039 |
| OQ-011 | Review-pass ergonomics / interaction cost — the M5 kill criterion | Review UX detail | US-012, US-013, US-015 |
| OQ-013 | Collapsing overlapping captures within a batch | Intra-batch dedup algorithm | US-004, US-006 |
| OQ-014 | Undecided NFR targets: performance, availability, accessibility, usability, i18n | Spec finalisation | US-037, §8 |
| OQ-015 | Unmatched-title identity — **also the fallback suppression key; one decision, not two** | Unmatched handling and suppression fallback | US-008, US-028 |
| OQ-019 | Which identity provider (phase 7 ADR) | Sign-in implementation | US-001 |
| OQ-022 | Removed-view affordances beyond title search and service filter | Removed-view scope | US-024 |
| OQ-023 | Batch undo versus later edits | v1.1 only (REQ-059 / REQ-069 coupling) | US-021, US-032, §11.2 |
| OQ-027 *(new — A42)* | Empirical confirmation that the HEIC/HEIF ingest transcode strips EXIF/GPS (US-004 AC-8). The chosen decode path drops EXIF incidentally, but this is `inferred` from library architecture, not guaranteed on a README; it must be verified against a real device HEIC and pinned by the AC-8 test before it is relied on as the privacy control | US-004 AC-7/AC-8 implementation | US-004 |
| ~~OQ-028~~ **CLOSED** *(A43)* | Whether to size compute for worst-case HEIC decode. **Answered verbatim: *"Start at 0.5 GiB, up-size only if it OOMs."*** Compute **stays** 0.25 vCPU / 0.5 GiB with the guard at 25 MP; 0.5 vCPU / 1.0 GiB (+~$4/mo → ≈$15–18) is a **pre-authorised, trigger-gated remedy**. Residual risk **accepted by the owner**, who was told the failure can land mid-import. **Not a pending decision — do not re-ask, and do not pre-emptively apply the remedy** | — *(nothing; closed)* | US-004 AC-9/AC-10/AC-11, US-039 AC-4, §7.8 KL-1, §12.3 R-12 |

### A.8 Assumptions relied on by this document

| ID | Assumption | Confidence | Where it bites |
|---|---|---|---|
| ASM-027 / A19 | No timeline is set; this document contains no dates | — | Throughout |
| ASM-028 / ASM-029 | Implementation is performed by an autonomous coding agent that cannot ask questions | — | NFR-002, US-039 |
| ~~ASM-034~~ **FALSIFIED — superseded by ASM-058** | ~~Uploads accept PNG and JPEG only~~ → Uploads accept **PNG *and* JPEG *and* HEIC/HEIF**; HEIC/HEIF transcoded to PNG on ingest, EXIF/GPS stripped (A42 — owner: "iOS screenshots save as heic") | Was **Medium, agent-derived, unconfirmed** → **falsified on contact with the owner.** This is the **third** agent-derived inference falsified when tested (after A15 phone-photo-of-TV and ASM-047 reappearance-transition) | US-004 AC-4/AC-7/AC-8, §7.5, R-11 |
| ~~ASM-035~~ **CONFIRMED at A44 (2026-08-11)** | Default combined-list order is date added, most recent first | **High — user-stated fact ("Newest-first — conventional, recent saves on top"), no longer an assumption.** First of five tested agent-derived inferences to survive owner confirmation (1 of 5; the other four were falsified). Creates an accepted trade-off against SUC-003 — see R-14 | US-020 AC-2, R-14 |
| ~~ASM-038~~ **RETIRED at A46 (2026-08-11)** | ~~The list staleness threshold is 30 days — explicitly a placeholder, and a distinct constant from NFR-019's image retention and from metadata staleness~~ → The list-staleness-nudge concept is **dropped entirely**: no threshold, no nag, no derived "stale" state. Owner, verbatim: *"Drop the concept entirely — no staleness nudge."* | **Retired, not confirmed or falsified as a value — the concept it described no longer exists.** Counted as falsified for scorecard purposes: **final scorecard is 6 tested, 1 confirmed (ASM-035), 5 falsified. Zero unconfirmed agent-derived assumptions remain.** | ~~US-022 AC-2~~ (deleted), US-035 AC-7 (now names only NFR-014/NFR-019), US-010 |
| A33 / L1 | Reappearance creates a brand-new title dated today; the old row is untouched | Locked | US-026 |
| A34 / L2 | Suppression is keyed on canonical work identity | Locked | US-028 |
| A36 / D3 | v1 batch undo is creates-only; mixed changesets are refused with a full enumeration | Locked | US-032, US-033 |

No new assumptions were introduced by this document, other than recording **ASM-058** (accept PNG + JPEG + HEIC/HEIF, transcode HEIC on ingest, strip EXIF/GPS), which **supersedes the falsified ASM-034** on the owner's own statement "iOS screenshots save as heic" (A42).

**A45 adds no assumption — it retires one.** The belief that ingestion is file-upload-only was never owner-confirmed; the owner has now stated the opposite directly (*"I will take a screen grab and paste it into the app directly"*), and clipboard paste is specified as the primary interaction with upload retained in full (US-004 AC-12 … AC-17). Note for the record that this is the **fourth** time an agent-derived inference about the owner's real behaviour has been corrected by the owner (after A15 phone-photo-of-TV, ASM-047 reappearance transitions, and ASM-034 PNG/JPEG-only) — and, as in the ASM-034 case, the correction was an **addition, not a substitution**: the safe response to "the owner does X" is to support X *alongside* what already works, never to delete the existing path. **R-11 and R-13 both turn on this.** The A45 design is otherwise built on `verified` primary-source findings in `Context/evidence/clipboard-paste-support.md`; the one `unverified` item in that evidence (whether iOS shows a paste callout over non-editable content) is routed around by AC-13 rather than relied on.






### A.9 Phase-8 acceptance-criteria amendments recorded in traceability (AC-6′, AC-7)

Recorded here because both criteria **originate in the specs rather than in an
owner statement**, and §A.1 traces requirements to stories, not criteria — so
without this subsection the only record of their provenance is the story body,
where a reader checking traceability would not look. This closes the errata
item raised at `docs/backlog.md` §8.1 (TASK-132).

| Criterion | Story | Requirement | Origin | Replaces | Verified by |
|---|---|---|---|---|---|
| **US-028 AC-6′** | US-028 | REQ-071 | Spec decision **SD-01** (phase 8), which closed **OQ-015** | **US-028 AC-6**, struck through in place and retained above it | `T-SUP-006` |
| **US-028 AC-7** | US-028 | REQ-071 | Spec decision **SD-06** (phase 8) | — (a new criterion; nothing superseded) | `T-FIX-005` |

**Why AC-7 has no requirement of its own.** It is a consequence of REQ-071
rather than a new capability: if suppression is keyed on canonical work
identity, then changing a work's identity via fix-match must carry the
suppression with it, or correcting a match would silently resurrect a work the
owner had dismissed. It is traced to REQ-071 for that reason, and implemented
by TASK-110 — **not** TASK-104, which implements AC-6′.

⚠ **AC-6′ is a rename, not an addition — it must not be counted twice.** The
PRD's acceptance-criteria total counts **AC-6′ and not AC-6**; AC-6 is retained
only as struck-through history. AC-7 **is** an addition and does increment the
total. Any recount of the AC headline (owned by TASK-126, and binding in
`specs/testing.md`) must apply that rule, or US-028 will appear to have gained
two criteria in phase 8 when it gained one.
