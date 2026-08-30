# Sequence — full-update batch: upload → extraction → match → review → reconcile

**Type:** Sequence diagram
**Shows:** the destructive path — the only flow in nextup that can remove something from the combined list.
**Traces to:** REQ-002, REQ-003, REQ-005, REQ-006, REQ-008, REQ-009, REQ-010, REQ-012, REQ-013, REQ-015, REQ-019, REQ-020, REQ-021, REQ-023, REQ-027, REQ-055, REQ-057, REQ-058, REQ-068, REQ-071, REQ-073, NFR-019, NFR-020
> ⚠ **REVISION 7 (A45, ADR-0009):** the owner's expected interaction is **paste, not save-then-upload**. The attach loop below now shows **TWO affordances converging on ONE pipeline** — clipboard paste (desktop `paste` event; iOS "Paste screenshot" button → `navigator.clipboard.read()`) **and file upload, which is RETAINED and fully supported** (the only path for the laptop save-then-upload case and the iOS Photos case, and the only one delivering raw HEIC). **The transcode is now CONDITIONAL on the sniffed type** (ADR-0008 Rev 3) — pasted images are always `image/png`. ⚠ **WebKit strips EXIF on clipboard read but NOT on file upload**, so `REQ-078`'s explicit strip stays on the upload path.
> ⚠ **REVISION 5 (A42, ASM-058):** ingest now accepts **PNG, JPEG *and* HEIC/HEIF**; HEIC/HEIF is transcoded to **lossless PNG on ingest, before the blob is written** (ADR-0008), and EXIF/GPS is stripped. The attach loop below carries the new transcode step; the rest of the flow is unchanged. See `diagrams/ai-pipeline.md`, ADR-0008.
> ⚠ **REVISION 4 (A40, Variant A):** the datastore participant `DB` is now **Azure SQL Database Basic** (was PostgreSQL in R3, Cosmos in R1); registry is **ghcr.io**; compute is **0.25 vCPU / 0.5 GiB**. The flow itself is unchanged — only the store, registry and compute labels move. See ADR-0005 Rev 3 / ADR-0003 Rev 3, `specs/data-model.md` §16.


```mermaid
sequenceDiagram
    actor O as Owner
    participant UI as Web UI
    participant API as API + Domain
    participant W as Extraction Worker
    participant B as Blob Storage
    participant V as Azure AI Vision (OCR)
    participant T as TMDB
    participant DB as Azure SQL Database

    O->>UI: new batch — service = Netflix, mode = full-update
    Note over UI,API: REQ-002 / REQ-003 — both chosen explicitly.<br/>The service is NEVER inferred from image content (REQ-058).
    UI->>API: POST /batches {service, mode}
    API->>DB: create UploadBatch status = draft
    loop each screenshot (REQ-004) — TWO affordances, ONE pipeline (A45, ADR-0009)
        alt PASTE — the PRIMARY affordance (A45)
            O->>UI: desktop — Ctrl/Cmd+V (document paste listener)
            Note over UI: OR iOS 13.4+ — tap the visible 'Paste screenshot' button<br/>→ navigator.clipboard.read() inside the click handler.<br/>WebKit shows a native per-invocation paste callout.<br/>Any stray tap or tab switch REJECTS the promise silently<br/>— the UI must re-offer, never hang (RSK-033).<br/>HTTPS mandatory — navigator.clipboard is absent on http.
            UI->>API: POST /batches/:id/images (image/png bytes)
            Note over UI,API: A pasted screenshot is ALWAYS image/png.<br/>HEIC CANNOT arrive by this path.<br/>WebKit has already stripped EXIF on read.
        else FILE UPLOAD — RETAINED, the floor
            O->>UI: attach PNG / JPEG / HEIC-HEIF from device or iOS Photos
            UI->>API: POST /batches/:id/images (multipart)
            Note over UI,API: The ONLY path for laptop save-then-upload<br/>and for iOS Photos. The ONLY path delivering RAW HEIC.<br/>EXIF/GPS arrives INTACT — REQ-078 strip is REQUIRED here.
        end
        API->>API: validate magic bytes — PNG / JPEG / HEIF ftyp (REQ-007)
        API->>API: pre-decode dimension-pixel guard (A43-M1) — ALL paths, ALL types
        API->>API: transcode IFF sniffed HEIC/HEIF → LOSSLESS PNG (ADR-0008 Rev 3)
        Note over API: The branch keys on the SNIFF RESULT, never on the source.<br/>Pasted PNG takes the skip branch for free — a CONSEQUENCE<br/>of a verified platform fact, not an optimisation.
        API->>API: strip EXIF/GPS/device model (REQ-078, T-SEC-032) — ALL paths
        Note over API: Ingest is inline in THIS request, before the blob write.<br/>User-initiated on every affordance, not a<br/>background process (REQ-041 not engaged).
        API->>B: put blob (private) — the PNG/JPEG (derived for HEIC)
        API->>DB: create UploadedImage, format, uploadedFormat, source, retainUntil = now + 30d
    end

    O->>UI: submit batch
    UI->>API: POST /batches/:id/submit
    API->>DB: status = submitted → extracting
    API-->>UI: 202 accepted
    Note over API,DB: REQ-005 — no Title or ServiceListing<br/>in the combined list has changed yet, and none will<br/>until the review pass closes.

    API->>W: run extraction
    loop each image
        W->>B: read bytes (managed identity)
        W->>V: Read OCR
        V-->>W: text lines + geometry
    end
    W->>W: filter chrome / headings, group reading order
    W->>W: collapse intra-batch overlap on normalised text (OQ-013)
    loop each candidate
        W->>T: search by normalised title (deterministic — never model-assisted)
        T-->>W: best match or nothing
    end
    W->>DB: point-read supp:<workIdentity> for each candidate
    Note over W,DB: REQ-071 — suppressed works are dropped BEFORE<br/>any Title or ServiceListing is created,<br/>and are never presented for confirmation.
    W->>W: classify new vs already-present-for-this-service (REQ-010)
    W->>DB: write ExtractionCandidates (pending review)
    W->>DB: status = in-review

    UI->>API: poll GET /batches/:id
    API-->>UI: in-review + review payload

    rect rgb(245,245,245)
    Note over O,UI: REVIEW PASS — two sections (REQ-013)
    UI-->>O: §1 ADDITIONS — every extracted candidate,<br/>already-known ones pre-confirmed and visually distinct (REQ-057)
    UI-->>O: §1b UNMATCHED — surfaced, never discarded (REQ-012)
    UI-->>O: §2 DISAPPEARED — active Netflix listings not extracted,<br/>ALL TICKED BY DEFAULT (REQ-019, REQ-055),<br/>excluding already-removed and suppressed works (REQ-073)
    O->>UI: confirm / correct / discard additions (REQ-016)
    O->>UI: UNTICK any title to rescue it from removal (REQ-021)
    O->>UI: single group confirmation of the remaining removals (REQ-020)
    end

    UI->>API: POST /batches/:id/close {confirmedAdditions, tickedRemovals}
    API->>DB: BEGIN — create Titles + ServiceListings
    API->>DB: set listing.state = removed, removedAt for ticked removals only
    Note over API,DB: REQ-023 — only Netflix listings are touched.<br/>REQ-027 — the Title stays in the list while any<br/>non-removed listing remains.<br/>REQ-028 — nothing is hard-deleted, ever.
    API->>DB: write batch_change provenance rows (REQ-068)
    API->>DB: set status = applied — COMMIT (one transaction)
    Note over API,DB: R3 — the TRANSACTION is the batch boundary.<br/>Before COMMIT nothing exists; after it, everything does.<br/>No visibility flag, no filter predicate to forget.<br/>REQ-006 — reconciled exactly once, against the whole batch.
    API->>DB: update serviceState.lastCompletedBatchAt (REQ-039)
    API-->>UI: applied + summary
    UI-->>O: combined list, with an undo affordance for the removal group (REQ-056)
```

## Explanation

**This is the only flow that can take something off the list by
inference, and every safety property in the requirement set converges
here.**

**Nothing is inferred.** The service and the mode are both chosen by the
owner before the batch can be submitted (REQ-002, REQ-003), and
`REQ-058` explicitly forbids deriving the service from the image
content — a misattributed screenshot would reconcile against the wrong
service and remove the wrong listings, silently and destructively. The
extractor's return type carries no service field, so the capability does
not exist to be misused.

**Suppression is checked before creation, not after.** The point-read on
`supp:<workIdentity>` happens in the worker, before any `Title` or
`ServiceListing` is created and before the candidate is presented for
confirmation (REQ-071). This ordering is the requirement: a suppressed
work that reached the review pass and was confirmed would create a new
row, and the owner's dismissal would have silently stopped working.

**The review pass shows already-known titles, and that is the single
most important safety property in the product.** In full-update mode
absence means removal, so a title whose *extraction failed* is
indistinguishable from a title genuinely removed from the service — it
lands in the disappeared section as a false positive, and confirming the
group deletes it. `REQ-057` makes the failure visible at the exact moment
it would otherwise cause data loss: the owner sees the title missing from
"already on your list" and present in the removal set, and unticks it.
The PRD mandates an automated test for this (US-013 AC-6, risk R-3),
because "optimising" the review by hiding known titles is a change that
looks like an improvement and destroys data.

**Removals are ticked by default, individually rescuable, group
confirmed, and undoable afterwards.** Four mechanisms, not one: the
common case is a single confirm (REQ-055), the exception is unticking
(REQ-021), the commit is one group action never a per-title one
(REQ-020), and the whole group is reversible afterwards (REQ-056),
indefinitely (REQ-063). Removal is a state transition, never a delete
(REQ-027, REQ-028).

**The batch boundary is one database transaction *(R3; R4)*.** Everything
the batch creates, every listing it transitions to `removed`, its
provenance rows and its `status = applied` are written inside a **single
transaction** — a **PostgreSQL** transaction in R3, an **Azure SQL
Database** transaction in R4 (ADR-0005 Rev 2/Rev 3). `REQ-005` and
`REQ-006` are
therefore guaranteed by the database itself — a crash mid-write leaves
*nothing*, and the batch is retried from its reviewed state.

> **Superseded — kept visible.** Revision 1 achieved this differently,
> because Cosmos DB could not make a write set this large atomic:
> everything was written `visible: false`, a single-document write
> flipped `status` to `applied`, and **every list query had to include
> `visible = true OR createdByBatchId IN (appliedBatchIds)`**. That
> protocol worked, but it was a bespoke mechanism an implementer had to
> understand and a predicate they had to remember on every new query.
> Removing it is the single largest `NFR-004`/`RSK-016` gain of the A41
> re-decision — the correct behaviour is now the default behaviour.

**Provenance is written whether or not it will ever be used.** REQ-068
requires the created, modified and removed sets with pre-batch values.
A full-update batch that removes anything is not creates-only, so
`REQ-067` undo will refuse it — but `REQ-075` requires the refusal to
enumerate exactly what the batch touched, and that enumeration is read
straight out of these three arrays.

## Notes and caveats

- Failure paths are omitted for legibility. If OCR is unavailable the
  batch enters `extraction failed`, the images are retained, and the
  owner retries (US-006 AC-4, US-034). If TMDB is unreachable the
  affected candidates are marked unmatched rather than discarded and the
  batch continues (US-007 AC-5). **No failure anywhere in this flow may
  change list state.**
- The manual-entry fallback (US-006 AC-5) — the owner searches TMDB and
  adds a work directly into the batch's additions — is not drawn but
  enters at the review pass.
- **Ingest — two affordances, one pipeline (R7, ADR-0009; transcode
  conditional per ADR-0008 Rev 3)** happens in the attach step,
  synchronously, before the blob is written. The owner's **primary**
  interaction is **paste** (`A45`): a document-level `paste` listener on
  desktop, and a visible **"Paste screenshot" button** calling
  `navigator.clipboard.read()` on iOS 13.4+ — the only *verified* iOS path,
  since iOS gives the user no way to initiate a paste over non-editable
  content. ⚠ **File upload is RETAINED and fully supported**, and is the
  only path for the laptop save-then-upload case and the iOS Photos case.
  A pasted screenshot is **always `image/png`**, so **HEIC arrives only by
  upload** — which is why the transcode stage survives and why it is now
  **conditional on the sniffed type** (`transcode iff sniffed HEIC/HEIF`,
  keyed on the bytes and never on the ingest source). HEIC/HEIF →
  **lossless PNG** (never lossy — `NFR-012a`), EXIF/GPS stripped,
  dimensions clamped to the reader bounds. The **stored blob is the derived
  PNG**; a transcode failure rejects that one file (415) and is named in
  the response, never failing the whole request. It is **user-initiated
  work on every affordance, not a background process**, so `REQ-041` is not
  engaged. The WASM decode is the app's largest allocation on the 0.5 GiB
  container — `RSK-016`. **R7 reduces how often it runs, not how severe it
  is.**
- ⚠ **EXIF asymmetry (R7).** WebKit strips EXIF on **clipboard read** but
  **not** on **file upload**. `REQ-078`'s explicit, tested strip stays on
  the **upload** path and is mandatory. `T-SEC-032` must be asserted
  against an **uploaded** image carrying real EXIF/GPS — asserting it
  against a pasted image would **pass vacuously**.
- ⚠ **iOS paste is brittle, and the UI must handle it (R7, `RSK-033`).**
  The system callout is **per-invocation and never remembered**, and any
  stray tap, tab switch or backgrounding **silently rejects the promise**.
  Rejection is the **expected** case: detect and **re-offer**, never hang.
  **HTTPS is a functional dependency** — `navigator.clipboard` is absent on
  `http://`.
- The `OQ-013` overlap collapse is shown as one step; the recommended
  two-pass approach (normalised text pre-match, `workIdentity`
  post-match) is in ADR-0005.
- Polling is shown as a single call; the real interval and the progress
  states belong in `specs/ux-states.md`.
- `OQ-011` — how fast this review must be to stay tolerable — is open and
  is the product's largest abandonment risk (R-1). This diagram shows
  *what* happens, not how many taps it costs.
