---
createdAt: 2026-08-10T20:12:02-04:00
createdBy: spec-writer
phase: 8
status: complete
project: nextup
projectClass: AI-enabled vision-extraction web application
---

# specs/specs.md — nextup

## Vision

**nextup turns screenshots of your streaming saved-lists into one combined
watchlist you actually use.** You open Netflix, screenshot your My List, do the
same on Max, and **paste the screen grabs straight into the app — or choose or
drag the files if you'd rather** *(A45: paste is the primary path; file upload
is unchanged and fully supported)*. nextup reads the titles out of the pictures,
matches them to TMDB for posters and metadata, shows you exactly what it is
about to do, and — only after you say yes — builds a single filterable,
sortable list of everything you have saved anywhere. It never touches your
streaming accounts, never holds a credential, never runs a background job, and
never removes anything without asking. It is one person's private tool, built
to run as inexpensively as is reasonable *without degrading quality* — the
owner selected the **Variant A ~$11–13/month** design (paid Azure SQL Database
Basic plus always-warm compute, `minReplicas=1`); see the R4 banner and the
*Platform* section below — and built to be implemented end to end by an
autonomous coding agent.

The product's core promise is **trust, not automation**: every change to the
list is something the owner initiated and confirmed, and nothing is ever
permanently deleted.

## Platform

A single containerised TypeScript application — React + Vite SPA and a Node +
Express API in one image — running on one Azure Container App (Consumption,
**`minReplicas=1`, always warm, 0.25 vCPU / 0.5 GiB, with
`NEXTUP_MAX_DECODE_PIXELS=25000000`** *(R4 — was 0.5/1.0 in
R3; owner took the ~$4 back at A40. **R5/`A43` — confirmed as the as-designed
size after the owner saw the priced OOM risk; the env var is part of the
pinned pair and moves with the memory, never independently**)*), with **Azure SQL Database Basic (5
DTU, 2 GB) via Prisma (`sqlserver` provider)** for data *(R4 — was Azure
Database for PostgreSQL Flexible Server B1ms in R3, Cosmos DB NoSQL free
tier in R1)*,
private Blob Storage
for screenshots, **Azure OpenAI `gpt-4.1` multimodal vision plus Azure AI Vision
`Read` (F0) as a deterministic cross-check** for extraction (ADR-0001
Revision 2), and Microsoft Entra ID via
Container Apps built-in authentication. The image is pulled from **ghcr.io
using a GitHub PAT** *(R4 — was Azure Container Registry Basic by managed
identity in R3; the PAT returns as a quiet-expiry credential, RSK-031)*, so
the system holds **2–3 secrets** (the ghcr.io PAT, the TMDB key, and — only
if managed-identity DB auth is not used — a Key-Vault SQL password).
Mobile-first at a 320 px floor, fully
functional on a laptop. **A staging environment exists** *(R3; R4 — now a
separate serverless auto-paused Azure SQL database rather than a second DB
on a shared PG server)*: a second Container App, a separate staging database
and a second blob container, at ~$0.50 marginal cost. CI is
still the primary gate.

> ⚠ **Revision 5 (2026-08-11 — `A43`, `OQ-028` CLOSED).** The owner answered
> the memory question verbatim: **"Start at 0.5 GiB, up-size only if it
> OOMs."** So **compute stays 0.25 vCPU / 0.5 GiB** and **0.5 vCPU /
> 1.0 GiB (+~$4/month) is a pre-authorised, trigger-gated REACTIVE remedy**
> (`runbooks/scale-up-memory.md`), not an alternative under consideration.
> `RSK-016` is now an **owner-accepted residual risk** — which makes its
> mitigations **mandatory**, because they are the only reason the reactive
> strategy is survivable: a **pre-decode pixel guard** (`api.md` §5.0), a
> **one-image blast radius** (`api.md` §5.2), an error that **names memory
> and the remedy** (`api.md` §5.2.4, `ui.md` §3.2a), and **decode sentinel
> log events** (`api.md` §9.1). Decisions: ADR-0003 Rev 4, ADR-0008 Rev 2,
> `architecture.md` Rev 6.

> **Revision 4 (A40 — owner selected Variant A).** The owner picked the
> "middle" ~**$11–13/month** variant: **Azure SQL Database Basic** replaces
> PostgreSQL B1ms, **ghcr.io** replaces ACR, and compute drops to **0.25
> vCPU / 0.5 GiB**. `OQ-026` is **CLOSED**. Always-warm compute, a
> relational store enforcing the invariants as real constraints, and
> staging are all **retained**. New risk `RSK-031` (Prisma + SQL Server is
> a less-travelled path). Decisions: ADR-0003 Rev 3, ADR-0005 Rev 3;
> authoritative schema `data-model.md` **§16**.

> **Revision 3 (2026-08-10T21:45)** applies constraint change **A41/CC-002**,
> which relaxed `NFR-012` from a near-zero-cost MUST to a SHOULD with quality
> and reliability outranking raw cost. Estimated total ≈ **$30/month**; the
> per-component table and two leaner variants are in
> `docs/architecture.md` §Cost summary. Decisions: ADR-0003 Rev 2,
> ADR-0005 Rev 2.

## Core features (v1 — 59 functional requirements)

1. **Sign in as the single owner** through Entra ID, with an allow-list. Zero
   authentication code in the application.
2. **Get screenshots into a batch three ways — paste (the primary path),
   file upload, or drag-and-drop** — declaring exactly one service
   (Netflix / Max) and exactly one mode (append-only / full-update).
   *(A45 — was "Upload a batch of screenshots". **File upload is NOT
   removed**; it is the only path that delivers raw HEIC from iOS Photos.)*
3. **Extract candidate titles** from the images with a **multimodal vision
   model, cross-checked by OCR**, behind a swappable `TitleExtractor`
   interface. Titles read from box artwork rather than text arrive flagged
   `inferred-unverified` and are shown beside their tile thumbnail.
4. **Match candidates to TMDB** deterministically, storing type, year, runtime,
   genres and poster.
5. **Review everything before anything is written.** No silent writes, no
   accept-by-inaction. Full-update mode shows *all* extracted titles, not just
   new ones.
6. **Reconcile removals** only in full-update mode, only for that service —
   ticked by default, individually rescuable, confirmed as one group.
7. **One combined list**, one row per work, one badge per service, filterable by
   service/type/genre and sortable by date added.
8. **Soft delete forever.** A removed title goes to a permanent, browsable
   removal history. Nothing is ever purged.
9. **Restore** anything from the removal history, explicitly, with its original
   date.
10. **Not interested** — suppress a work by canonical identity so it never comes
    back, with a browsable, undoable suppressed view.
11. **Fix a wrong match** without losing badges, dates or sort position.
12. **Undo a whole batch** when it only created things; refuse and *enumerate*
    when it did more.
13. **Re-extract** a batch's images for 30 days, after which the screenshots —
    and only the screenshots — are automatically purged.
14. **TMDB attribution** on every surface, verbatim.

## v1.1 and beyond (explicitly out of v1)

| Deferred | Requirement |
|---|---|
| Edit a listing's date-added | REQ-059 (D1) — reinstating it reopens D3 and OQ-023 |
| Filter and sort by runtime | REQ-035, REQ-037 (D2) — TV runtime is ambiguous and undecided |
| Undo a mixed-changeset batch | REQ-069 (D3) — v1 refuses and enumerates instead |
| More services than Netflix and Max | REQ-053 |
| Multiple accounts (<20) | NFR-001 — not precluded; the data model is owner-scoped from day one |
| User-controlled backup / export | **OQ-025 (new)** — no export exists, in a store that never deletes |
| Richer removed-view affordances (bulk restore, date-range, per-work grouping) | Out by the OQ-022 closure |

## Companion specs

| Spec | What it settles |
|---|---|
| **[data-model.md](./data-model.md)** | **REVISED (R5; `A45`).** **`A45`: the `IngestSource` enum (`paste` \| `upload` \| `drop`), `UploadedImage.fileName` and `.ingestSource`, the pasted-image naming/identity rule (§3.8.1, SD-16) and the matching Azure SQL columns in §16.3.** Every entity as a typed definition, **the Azure SQL relational schema (§16, REVISION 4 — supersedes the PostgreSQL §15, which supersedes the Cosmos layout)**, the `workIdentity` scheme (**closes OQ-015**), derived fields, the invariant list, batch atomicity, undo semantics, and the binding statement that **no mechanism capable of expiring or scheduling deletion of list data exists anywhere** *(R4: also no Azure SQL Agent job / Elastic Job)* |
| **[api.md](./api.md)** | **REVISED (R5/`A43`; R6/`A45`).** **`A45`: §5.3 defines the three ingest sources against ONE endpoint and ONE batch, §5.1 makes the HEIC transcode CONDITIONAL ON THE SNIFFED FORMAT (never on `ingestSource`, and never deleted), §5.1a records the EXIF trap, and §6.12 gains the optional `ingestSource` field and the server-synthesised filename.** All 29 routes with exact request/response schemas, exact status codes, one error envelope, the closed error-code enumeration, pagination, the upload ceilings — and **the mandatory memory containment: the pre-decode pixel guard with the exact header-read mechanism for HEIC (`ispe`), PNG (`IHDR`) and JPEG (`SOFn`) (§5.0), per-image failure isolation and BOTH OOM paths — the catchable WASM `RangeError` and the uncatchable kernel kill (§5.2), the three memory/decode error codes with their verbatim text (§5.2.4, §8), and the `image.decode.begin`/`end` sentinel log events (§9.1)** |
| **[ai.md](./ai.md)** | **REVISED (ADR-0001 R2).** The five-stage extraction pipeline, the **hybrid** reader (Azure OpenAI `gpt-4.1` vision primary + Azure AI Vision `Read` OCR cross-check), the model configuration and committed prompt, the deterministic `crossCheck()` and OCR orphan recovery, the `TitleExtractor` interface, confidence thresholds, low/zero-yield and degraded-mode behaviour, the three-tier evaluation strategy, cost controls, and the two binding rules (no TMDB content to any AI service; the extractor never learns the service) |
| **[ui.md](./ui.md)** | **REVISED (R5; `A45`).** **`A45`: §3.2 now specifies THREE ingest affordances — paste (§3.2b, both primitives: the desktop `paste` event and the iOS "Paste screenshot" button), file upload (unchanged) and drag-and-drop (§3.2c) — plus nine new copy constants.** Nine screens: purpose, hierarchy, components, navigation, deep links, breakpoints, accessibility, exact copy constants, and what is deliberately absent |
| **[ux-states.md](./ux-states.md)** | **REVISED (`A43`; `A45`).** **`A45`: states 4.0a and 4.12–4.18 cover paste accepted, permission denied, empty clipboard, non-image clipboard, the silently-abandoned promise, no clipboard API / non-HTTPS, drag-over and ceiling rejection; §4.3's dropzone copy is corrected in place.** Every state of every surface — loading, empty (often two distinct empties), partial, populated, each error class, offline, submitting, success — with what the owner can do in each |
| **[security.md](./security.md)** | **REVISED (`A45`).** **`A45`: §4.2 documents THE EXIF TRAP — WebKit strips EXIF on clipboard read but NOT on file upload, so REQ-078's explicit strip stays on the upload path — plus STRIDE T4a (paste-listener scoping) and T4b (GPS EXIF surviving via the upload route).** Authentication with zero auth code, the allow-list fail-closed rule, the principal adapter contract, the authorisation matrix, data classification, a STRIDE model, secrets, logging prohibitions, and the supply-chain policy |
| **[testing.md](./testing.md)** | **ELEVATED, and REVISED (ADR-0001 R2; store R4; R7/`A45`).** **`A45`: `T-PASTE-001`–`T-PASTE-010`, `T-IMG-023`, `T-UI-014`, `T-SEC-033`, `T-RET-014` — including `T-PASTE-010`, the add-not-swap regression guard on the file-upload journey — and a §10 entry naming the iOS Safari native paste callout as NOT automatable in CI, with a compensating manual device check. ⚠ THE AC COUNT IS DELIBERATELY NOT RE-COUNTED IN THIS PASS; the PRD is being revised for `A45` in parallel. Orchestrator reconciles.** The pyramid and why, deterministic fakes for both extraction readers and TMDB, a real **`mcr.microsoft.com/mssql/server:2022-latest`** service container and Azurite for the stores *(R4 — was `postgres:16-alpine` in R3, the Cosmos emulator in R1; §3.3a gives the exact GitHub Actions config)*, golden-image fixtures replayed from **recorded** provider responses, the **manual-only live quality suite** (`golden:live`, band assertions only — never in CI), the first-class end-to-end journey test, CI as the only gate, and **the complete mapping of all **241** acceptance criteria to named tests *(R7 — reconciled by the orchestrator. This figure has drifted four times; `testing.md` carries the **binding** count, its arithmetic and the counting convention. Do not re-derive it here — read it there)***, with the 11 that are not machine-verifiable named explicitly ⚠ **(R5: this figure says 230 while `testing.md` says 232 — the A42 additions were never propagated here. AC COUNT NEEDS RECONCILING by the orchestrator across `PRD.md`, `testing.md` front-matter, `testing.md` §9/§10 and this row; deliberately not guessed in this pass because the PRD is being revised in parallel. `T-META-001` — every AC has a mapped test — is the gate that actually enforces this.)** Plus, **R5/`A43`**, the memory-containment core: `T-IMG-017` (guard refuses before allocating), `T-IMG-018` (one-image blast radius, no partial commit), `T-IMG-019` (the catchable OOM path), `T-IMG-020` (the error names memory and the remedy), `T-IMG-021` (decode sentinel events), `T-IMG-022` (guard default/config), `T-UI-013` (the client shows it verbatim) |

## Reading order for an implementer

`specs.md` → `data-model.md` → `api.md` → `ai.md` → `ui.md` → `ux-states.md`
→ `security.md` → `testing.md`. Then build test-first: `testing.md` §9 is the
definition of done.

## Decisions this spec set owns

| ID | Decision | Where |
|---|---|---|
| SD-01 | **OQ-015 CLOSED** — `workIdentity` is `tmdb:{movie\|tv}:{id}` or `unmatched:<sha256(normalised)[0:16]>`, and it is also the suppression key | data-model §2.3 |
| SD-02 | **OQ-013 CLOSED** — two-pass deterministic intra-batch overlap collapse | data-model §7.4 |
| SD-03 | Creates-only batch undo **discards** created records rather than soft-removing them | data-model §8.3 |
| SD-04 | **No TTL anywhere** — the absence is REQ-028, restated so nobody "tidies up" | data-model §9 |
| SD-05 | The extracted year is **excluded** from the unmatched fallback identity (amends ADR-0007) | data-model §2.3.2 |
| SD-06 | Fix-match **migrates** an active suppression to the new identity and tells the owner (amends ADR-0007) | data-model §6.3 |
| — | **OQ-022 CLOSED** — the removed view ships with title search, service filter, most-recently-removed ordering and repetition ordinals; nothing else | data-model §11 |
| SD-11 | Review-pass ergonomics (confirm-all, collapsed known-titles with visible count, virtualisation, sticky action bar, locally persisted dispositions) — narrows but does not close OQ-011 | ui §5.4 |
| SD-12 | Accessibility target **WCAG 2.1 AA**, adopted provisionally because OQ-014 states none | ui §10.2 |
| **SD-13** *(new, R5)* | **`IMAGE_DECODE_OOM` is HTTP `503`, not `500`** — the cause is known, nothing was changed, and there is a documented one-command remedy; a 500 would also collide with the standing rule that every 500 message ends *"Nothing was changed."* **No `Retry-After`**: retrying before the up-size cannot succeed | api §5.2.3, §7 |
| **SD-14** *(new, R5)* | **A HEIC with multiple `ispe` boxes is judged by the MAXIMUM `width × height`, never the first.** The first is routinely a thumbnail, and taking it would let a 48 MP master straight through the guard — the exact failure the guard exists to prevent | api §5.0.3, `T-IMG-017` |
| **SD-15** *(new, R5)* | **The memory/decode message text is server-built and rendered verbatim by the client, and is deliberately NOT a client copy constant** — it interpolates the live container size and the configured guard, so a client-side copy would state the wrong limit the moment the owner up-sizes | ui §9, api §5.2.4 |
| **SD-16** *(new, `A45`)* | **A pasted image has no filename, so the server synthesises one — `pasted-<YYYYMMDD>-<HHMMSS>-<NN>.<ext>`** (server UTC receipt time, 1-based ordinal within the open batch, extension from the **sniffed** format). Storage identity needs nothing new: `blobPath` was already composed only from server ULIDs, so **no client-supplied name has ever been a path component and none becomes one now.** Provenance is the separate write-once `ingestSource` field — **never inferred from the filename prefix** | data-model §3.8.1, api §6.12 |
| **SD-17** *(new, `A45`)* | **The HEIC transcode becomes CONDITIONAL, not deleted** — and the condition is on the **sniffed `uploadedFormat`**, never on `ingestSource`. Pasted bytes are always `image/png` (WebKit exposes no HEIC representation), so the stage is a no-op for them today; but the iOS Photos **file-upload** path still delivers raw HEIC, so removing the stage would break the path the owner uses when they miss the screenshot preview's *Copy*. Branching on `ingestSource` would make a security-relevant decision from untrusted client input | api §5.1, data-model §3.8, `T-IMG-023` |

## Constraints an implementer must not quietly relax

1. **Suppression is keyed on canonical work identity, never on a row id.** A
   reappearing work is a *new row*, so a row-scoped flag is bypassed on the very
   next capture — silently.
2. **Full-update review shows every extracted title.** Hiding known titles turns
   a failed extraction into an invisible mass removal. This is the single most
   important safety property in the product.
3. **Nothing is ever hard-deleted or purged** except screenshot *bytes* at 30
   days and the records reversed by a creates-only batch undo.
4. **No scheduler exists anywhere.** TMDB refresh is lazy, on access, scoped to
   what is being rendered.
5. **No TMDB content may reach any AI service.** Matching is deterministic
   string comparison.
6. **TMDB attribution is mandatory and its absence is invisible** — it is tested.
7. **The mixed-undo refusal is a feature.** It must enumerate every title the
   batch touched, with a working remedy for each, never truncated.
8. **`dateAdded` is the date nextup first saw the title**, labelled honestly,
   written once, and the title-level sort uses the *earliest* across
   non-removed listings.
9. **(R5/`A43`) The pre-decode pixel guard runs before any decode buffer is
   allocated, and a byte ceiling is not a substitute for it.** HEIC's
   compression ratio is wildly variable — a 6 MiB file can be 48 MP — so bytes
   do not predict the allocation and dimensions do. Moving this check to
   "after the decode, where the real size is known" defeats its entire
   purpose: that is *after* the allocation that kills the container.
   `api.md` §5.0, `T-IMG-017`.
10. **(R5/`A43`) `NEXTUP_MAX_DECODE_PIXELS` moves with container memory,
    always** — `25000000` at 0.5 GiB, `50000000` at 1.0 GiB, changed in the
    same command (`runbooks/scale-up-memory.md`). A raised guard on a small
    container is strictly worse than no up-size at all. `T-INFRA-005` pins the
    pair.
11. **(R5/`A43`) A memory or decode failure fails ONE image, and the error says
    so — naming memory as the cause and the up-size as the remedy.** Never a
    generic "upload failed", never a whole-batch failure, never a partial
    commit. The owner accepted the OOM risk *on these terms*; a spec change
    that weakens any of them silently withdraws the basis of that acceptance.
    `api.md` §5.2, `ui.md` §3.2a, `T-IMG-018`/`T-IMG-020`/`T-UI-013`.
12. **(R5/`A43`) Both OOM paths ship.** A WASM allocation failure is a
    **catchable** `RangeError` with **no container restart**; a kernel OOM kill
    produces a **restart with no application error**. Handling only one misses
    the common case. `api.md` §5.2.2.
13. **(`A45`) Paste is an ADD, not a SWAP — ALL THREE ingest affordances
    ship: paste, file upload and drag-and-drop.** Paste is the *primary*
    path because it is what the owner actually does, but **file upload is the
    only path that delivers raw HEIC from iOS Photos**, and it is the path the
    owner falls back to whenever they miss the screenshot preview's *Copy*.
    This is the A42 mistake in a new costume: there, HEIC support nearly
    displaced PNG/JPEG. Do not "simplify" the dropzone away once paste works.
    `ui.md` §3.2, `T-PASTE-010` exists solely to fail if this is violated.
14. **(`A45`) The HEIC transcode is conditional, never deleted, and the
    condition is the SNIFFED format — never `ingestSource`.** See SD-17. The
    metadata strip and the pre-decode pixel guard sit **outside** the
    condition and run for every image from every source. `api.md` §5.1,
    `T-IMG-023`.
15. **(`A45`) The EXIF strip STAYS on the upload path.** WebKit strips EXIF
    when it hands over clipboard bytes, but it does **not** strip it on file
    upload. The paste path's free stripping therefore covers exactly **one of
    the two routes** — it must never be read as evidence that REQ-078 is
    handled globally. Deleting the explicit strip would let a GPS-tagged
    photograph's coordinates reach storage through the upload path, and
    nothing in the paste path would reveal it. `security.md` §4.2,
    `api.md` §5.1a, `T-SEC-033`.
16. **(`A45`) Every ceiling, the magic-byte sniff, the pre-decode pixel guard
    and the 30-day retention apply IDENTICALLY to pasted and dropped bytes.**
    Pasted bytes arrive from the same untrusted client as uploaded bytes;
    `Blob.type` is exactly as untrustworthy as `Content-Type`. There is one
    ingest pipeline, not three. `api.md` §5, `T-PASTE-006`/`T-PASTE-007`.
17. **(`A45`) The iOS paste UI must detect a rejected promise and re-offer.**
    iOS never remembers the paste permission, and any stray tap, tab switch or
    backgrounding rejects `navigator.clipboard.read()` **silently**. A UI that
    shows a spinner and waits will hang forever with no error. Also:
    `navigator.clipboard` does not exist on `http://` — HTTPS is mandatory,
    including for local-network testing from the phone. `ux-states.md` 4.15,
    4.16, `T-PASTE-008`/`T-PASTE-009`.
