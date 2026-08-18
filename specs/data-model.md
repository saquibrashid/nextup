---
createdAt: 2026-08-10T20:12:02-04:00
createdBy: spec-writer
phase: 8
status: complete
sourceOfTruth: artifacts/PRD.md, artifacts/architecture.md, artifacts/adr/ADR-0005, ADR-0006, ADR-0007, artifacts/diagrams/data-model-erd.md
---

# specs/data-model.md — nextup

> ⚠ **REVISION 5 — 2026-08-11 (`A45`) — CLIPBOARD PASTE IS THE PRIMARY INGEST
> PATH, AND FILE UPLOAD REMAINS FULLY SUPPORTED.**
> The owner corrected the ingestion assumption verbatim: *"for screenshots,
> I'm generally expecting that I will take a screen grab and paste it into
> the app directly rather than saving it to my device first and then
> uploading it to the app."* Everything specified before A45 said
> **file upload only**; that is now **wrong** and has been corrected **in
> place** wherever it was an instruction, not annotated behind a banner
> (the `F-001` lesson).
>
> **⚠ This is an ADD, not a SWAP.** File upload stays fully supported: it is
> the only path that delivers raw HEIC from iOS Photos, and the only path
> available when the owner missed the screenshot preview's *"Copy"*. Both the
> laptop web-screenshot path and the iOS Photos path still need it. (The A42
> near-miss — PNG/JPEG almost swapped out for HEIC — is the same mistake.)
>
> Platform facts are governed by **`Context/evidence/clipboard-paste-support.md`**
> (primary sources, retrieved 2026-08-11). Deltas in this document:
>
> | # | Delta | Where |
> |---|---|---|
> | 1 | **New enum `INGEST_SOURCES = ['paste','upload','drop']`** and type `IngestSource` | §3.1 |
> | 2 | **`UploadedImage` gains `ingestSource` and an explicit `fileName`** — provenance of *how* the bytes arrived, following the `uploadedFormat` precedent | §3.8 |
> | 3 | **New §3.8.1 — the identity/naming rule for a pasted image**, which has no filename. Storage identity was already server-generated ULIDs and needs nothing new; the *display/provenance* name is synthesised as `pasted-YYYYMMDD-HHMMSS-NN.png` | **§3.8.1** |
> | 4 | **The HEIC transcode becomes CONDITIONAL on the sniffed format — and is NOT deleted.** The iOS Photos upload path still delivers raw HEIC | §3.8, `api.md` §5.1 |
> | 5 | **`uploaded_image` gains `file_name` and `ingest_source`** columns with a CHECK constraint; `ingest_source` defaults to `'upload'` so existing rows backfill truthfully | §16.3, §16.8 |
>
> **Unchanged and applying identically to pasted images:** the 30-day
> `retainUntil` (NFR-019), every ceiling (`api.md` §5), the magic-byte sniff,
> the pre-decode pixel guard (REQ-079), the metadata strip (REQ-078), the
> blob path scheme, and re-extraction (REQ-074). **There is no parallel
> model for pasted images and none is to be built.**

> ⚠ **REVISION 4 — THE STORE IS NOW AZURE SQL DATABASE BASIC.**
> The owner selected **Variant A** at `A40`: **ADR-0005 Revision 3 replaces
> Azure Database for PostgreSQL Flexible Server (B1ms) with Azure SQL
> Database Basic (5 DTU, 2 GB), still accessed via Prisma (`sqlserver`
> provider).** The domain reasoning is unchanged; only the *physical* store
> changes again.
>
> **The new authoritative physical chapter is §16 (Azure SQL).** §15 (the
> R3 PostgreSQL chapter) is **retained and visible** — a future reader must
> be able to see that PostgreSQL was chosen and then traded for cost — but
> §16 is authoritative wherever the two disagree:
>
> | Section | Status |
> |---|---|
> | §15 (PostgreSQL physical chapter, R3) | **SUPERSEDED by §16** for types, DDL, indexes, search and migration tooling. Retained verbatim for the reasoning trail. |
> | §16 (Azure SQL physical chapter, R4) | **AUTHORITATIVE.** |
>
> Physical deltas: `text`→`NVARCHAR`, `timestamptz`→`DATETIME2(3)`,
> ULID/`uuid`→`NVARCHAR` (not `UNIQUEIDENTIFIER`), `boolean`→`BIT`,
> `text[]`/`jsonb`→`NVARCHAR(MAX)`+`CHECK(ISJSON()=1)`, partial indexes →
> **filtered unique indexes** (`WHERE`), `pg_trgm` → `LIKE`, Prisma provider
> `postgresql`→`sqlserver`. `pg_cron` was already prohibited; **Azure SQL
> Agent jobs and Elastic Jobs are now prohibited by the same rule** (SD-04,
> REQ-028). New risk `RSK-031` (Prisma+SQL Server is less-travelled).

> ⚠ **REVISION 3 — 2026-08-10T21:45 — THE STORE IS NOW POSTGRESQL.**
> Constraint change **A41/CC-002** relaxed `NFR-012`, and the datastore was
> re-decided: **ADR-0005 Revision 2 replaces Cosmos DB for NoSQL with Azure
> Database for PostgreSQL Flexible Server (B1ms), accessed via Prisma.**
>
> **This document is NOT discarded.** Everything in it about the *domain* —
> work identity, normalisation, derived fields, state machines, batch
> lifecycle, provenance, undo, retention, the removed view — is
> store-agnostic and remains **binding exactly as written**.
>
> The following sections describe the *physical* Cosmos shape and are
> **SUPERSEDED by §15**, which is authoritative wherever the two disagree:
>
> | Section | Status |
> |---|---|
> | §1 Physical layout | **SUPERSEDED by §15.1–§15.3** |
> | §3 — the `type` discriminator, `visible`, embedding of `listings[]`, and the `id` formats | **SUPERSEDED by §15.3**; the *fields, validation rules and semantics* stand |
> | §5.4 Invariants | **SUPERSEDED by §15.4** — three of them become database constraints |
> | §7.3 Close by visibility | **DELETED by §15.5** — close is one transaction |
> | §10 Indexing and query cost | **SUPERSEDED by §15.6** |
> | §13 Migrations and versioning | **SUPERSEDED by §15.8** — Prisma Migrate |
>
> An implementer reading a superseded section without this banner will build
> the wrong thing. That is `RSK-030`; these banners are its mitigation, and
> `TASK-143` is the sweep that confirms them.

> **Entity names in this document match `artifacts/diagrams/data-model-erd.md`
> exactly.** A mismatch is a blocking review finding (architecture §Handover 1).

**Serves:** US-002, US-004, US-005, US-007, US-008, US-009, US-010, US-016,
US-018, US-020, US-021, US-023, US-024, US-025, US-026, US-027, US-028,
US-030, US-031, US-032, US-033, US-034, US-035.
**Requirements:** REQ-005…REQ-012, REQ-024…REQ-031, REQ-036, REQ-055…REQ-057,
REQ-060…REQ-076, NFR-001, NFR-008, NFR-011, NFR-014, NFR-018, NFR-019, NFR-020.

---

## 0. Decisions this document owns

| ID | Decision | Status |
|---|---|---|
| **SD-01** | **OQ-015 is CLOSED.** ADR-0007 Option B is **adopted with two amendments** (§2.3). Moves ADR-0007 from `Proposed` to `Accepted (as amended)`. | Closed here |
| **SD-02** | **OQ-013 is CLOSED.** Intra-batch overlap collapse is a two-pass deterministic collapse (§7.4). | Closed here |
| **SD-03** | Creates-only batch undo **hard-discards** the `title` documents it created and **removes the embedded listings** it created from surviving titles. It does **not** soft-remove them. Architecture §Handover 1 asked for this to be stated; the architect's recommendation is adopted. (§8.3) | Decided here |
| **SD-04** | **No mechanism capable of expiring or scheduling the deletion of list data exists anywhere.** *(R3: originally "no TTL on any Cosmos container"; restated store-neutrally in §15.7. **R4: also no Azure SQL Agent job and no Elastic Job** — see §16.7 — no TTL, no `pg_cron`, no scheduled job, no trigger, and `DELETE` in exactly one module.)* The absence *is* REQ-028. (§9, §15.7, §16.7) | Restated, binding |
| **SD-05** | The unmatched fallback identity **excludes the extracted year**, contrary to ADR-0007 normalisation rule 6. Rationale in §2.3.2. | Amendment to ADR-0007 |
| **SD-06** | Fix-match **migrates** an active `suppression` from the old `workIdentity` to the new one and reports the migration to the owner. (§6.3) | Amendment to ADR-0007, new AC |
| **SD-16** *(new, A45)* | **A pasted image gets a synthesised DISPLAY name `pasted-YYYYMMDD-HHMMSS-NN.<ext>`; its STORAGE identity is unchanged (server ULID), and `ingestSource` records `paste`/`upload`/`drop`.** Paste is an **additional** ingest affordance onto the **existing** multi-image batch model, not a parallel one. (§3.1, §3.8, §3.8.1) | Decided here |
| **SD-17** *(new, A45)* | **The HEIC→PNG transcode becomes CONDITIONAL on the sniffed `uploadedFormat` and is NOT deleted.** The paste path always delivers PNG so it skips the stage as a no-op; the iOS Photos **file-upload** path still delivers raw HEIC and still requires it. (§3.8, `api.md` §5.1) | Decided here |

---

## 1. Physical layout

> ⛔ **SUPERSEDED (R3) by §15.1–§15.3.** The table below describes the
> Cosmos DB account, container and partition key that ADR-0005 Rev 1
> selected. **Do not provision any of it.** Retained so the Rev 1
> reasoning stays legible. The blob rows at the bottom are the only
> part still current.

| | |
|---|---|
| Cosmos DB account | free tier, one per subscription (ADR-0005) |
| Database | `nextup` |
| Container | `owner-data` |
| Partition key | `/ownerId` |
| Consistency | Session |
| Throughput | free-tier 1,000 RU/s, shared |
| **TTL** | **NOT CONFIGURED — see SD-04 / §9** |
| Blob container | `screenshots`, private, `allowBlobPublicAccess=false`, `allowSharedKeyAccess=false` |
| Blob path | `{ownerId}/{batchId}/{imageId}.{png\|jpg}` |

**One container, six document types, discriminated by `type`.** Every document
carries `ownerId` (the partition key) and `type`. No cross-partition query
exists anywhere in the codebase.

| `type` | `id` format | Uniqueness enforced by |
|---|---|---|
| `title` | ULID | application (§5 invariants) |
| `suppression` | `supp:<workIdentity>` | **the store** (id uniqueness within partition) |
| `uploadBatch` | ULID | store |
| `uploadedImage` | ULID | store |
| `extractionCandidate` | `cand:<batchId>:<sourceImageId>:<seq>` | store (deterministic → retry-idempotent) |
| `serviceState` | `svcstate:<service>` | store |

**Deterministic ids for batch-created documents (REQ-005/REQ-006 resumability).**
Documents a batch creates during application use `id = ulidFromSeed(batchId + ':' + candidateId)`
(a ULID derived by hashing the seed, exported as `deterministicId(seed: string): string`
from `packages/domain/src/ids.ts`). A retry after a crash therefore **overwrites**
rather than duplicates.

---

## 2. Canonical work identity — `workIdentity`

### 2.1 The form

`workIdentity` is a single opaque string on `title` and the entire key of
`suppression`. Exactly two forms:

```
tmdb:movie:438631            // matched film
tmdb:tv:66732                // matched series
unmatched:9f2c1a7b4e0d5c83   // fallback: sha256(normaliseTitleText(rawText)) hex, first 16 chars
```

Regex (exported as `WORK_IDENTITY_RE`):

```
^(tmdb:(movie|tv):[1-9][0-9]{0,9}|unmatched:[0-9a-f]{16})$
```

**Four consumers, one string, treated identically by all of them:** dedup
(REQ-024), suppression (REQ-071), reappearance (REQ-065), intra-batch overlap
collapse (OQ-013 → SD-02). No consumer branches on the prefix except the UI,
which renders an "unidentified" marker for `unmatched:*`.

### 2.2 Normalisation — one function, no second implementation

`packages/domain/src/identity.ts`:

```ts
/**
 * The ONLY normalisation of extracted title text in nextup.
 * Used by: unmatched identity derivation, intra-batch pre-match collapse,
 * and TMDB match scoring. There MUST be no second implementation.
 */
export function normaliseTitleText(raw: string): string;
```

Steps, applied in this exact order:

| # | Step | Example |
|---|---|---|
| 1 | Unicode `NFKD` normalise, then strip combining marks (`\p{M}`) | `Amélie` → `Amelie` |
| 2 | Lowercase (`toLocaleLowerCase('en-US')`) | `DUNE` → `dune` |
| 3 | Replace every character not in `[a-z0-9 ]` with a single space | `spider-man: no way home` → `spider man  no way home` |
| 4 | Strip one leading article token from `{the, a, an}` | `the batman` → `batman` |
| 5 | Collapse runs of whitespace to one space; trim | `spider man  no way home` → `spider man no way home` |
| 6 | **No year is appended.** See §2.3.2. | — |

**Table-driven test is mandatory** (`packages/domain/test/identity.spec.ts`,
test `T-DM-001`), with at minimum these cases:

| input | expected |
|---|---|
| `"Dune"` | `"dune"` |
| `"The Batman"` | `"batman"` |
| `"A Quiet Place"` | `"quiet place"` |
| `"An American Tail"` | `"american tail"` |
| `"Amélie"` | `"amelie"` |
| `"Spider-Man: No Way Home"` | `"spider man no way home"` |
| `"WALL·E"` | `"wall e"` |
| `"9-1-1"` | `"9 1 1"` |
| `"  Dune   (2021) "` | `"dune 2021"` |
| `"Andor"` | `"andor"` |
| `"THE the"` | `"the"` *(only ONE leading article is stripped)* |
| `""` | `""` |

```ts
export function workIdentityForTmdb(mediaType: 'movie' | 'tv', tmdbId: number): string;
// => `tmdb:${mediaType}:${tmdbId}`

export function workIdentityForUnmatched(rawText: string): string;
// => `unmatched:${sha256Hex(normaliseTitleText(rawText)).slice(0, 16)}`
```

### 2.3 OQ-015 — CLOSED (SD-01)

**Resolution: adopt ADR-0007 Option B, amended.** An unmatched candidate the
owner confirms **does** become a `Title`, carrying `matchState: 'unmatched'`
and an `unmatched:<hash>` `workIdentity`. **That identity is also the
suppression key.** One decision, one scheme, one string — satisfying the A34
constraint.

#### 2.3.1 Amendment 1 — unmatched works ARE suppressible (supersedes PRD US-028 AC-6)

PRD US-028 AC-6 states "v1 offers no suppression for unmatched candidates,
because there is no identity to key on. **This is blocked on OQ-015.**"
**OQ-015 is now closed and an identity exists**, so the block is lifted:

- An unmatched `Title` **can** be suppressed exactly like a matched one
  (US-027 path, §6.2). `suppression.id = supp:unmatched:<hash>`.
- The suppression gate (`specs/ai.md` §5) point-reads that id, exactly as for
  `tmdb:*`. **No branch on prefix.**
- The **known limitation stands and must be surfaced in the UI**: an
  `unmatched:*` identity is only as stable as the OCR output, so one character
  of OCR variance yields a different identity and the suppression is bypassed
  *invisibly*. Copy is fixed in `specs/ui.md` §9.3.
- **PRD amendment note:** US-028 AC-6 is superseded by this section. The
  replacement AC is **AC-6′**: *Given an unmatched Title, when the owner
  chooses "not interested", then a Suppression keyed on its `unmatched:*`
  workIdentity is created, and the suppressed view displays the stability
  caveat for that entry.* Test `T-SUP-006`.

#### 2.3.2 Amendment 2 — the year is NOT part of the fallback identity (SD-05)

ADR-0007 normalisation rule 6 appends an extracted 4-digit year. **Rejected.**
A year is present on some captures and absent on others of the same tile, so
including it makes the identity *less* stable than the text alone — it splits
one work into two identities on the exact axis the scheme exists to hold
together, and it does so **silently** (a bypassed suppression). A year
extracted alongside a candidate is retained on
`extractionCandidate.extractedYear` and used **only** as a TMDB match hint
(`specs/ai.md` §4.2). It never enters `normaliseTitleText` and never enters a
hash.

#### 2.3.3 Residual, stated not hidden

| Residual | Visible? | Bound |
|---|---|---|
| OCR variance splits one unmatched work into two identities → duplicate row | **Visible** — owner sees two rows | Fix-match (§6.3) merges by re-pointing both at the TMDB work |
| OCR variance bypasses a suppression on an unmatched work | **Invisible** | Documented in the suppressed view help text; repaired by fix-matching the work to TMDB, which migrates the suppression (SD-06) |

---

## 3. Domain types

> ⚠ **PARTIALLY SUPERSEDED (R3).** The **fields, their validation rules and
> their semantics below are binding and unchanged** — they are the domain,
> and they are why this section is not being rewritten. What is superseded
> is the *storage* framing: the `type:` discriminator, the document `id`
> formats, `visible`, and the embedding of `listings[]` inside `Title`.
> Under §15 each interface is a **table**, `ServiceListing` is a **child
> table**, and `visible` **does not exist**. TypeScript interface names are
> retained; §15.3 gives the table and column mapping (`camelCase` in code,
> `snake_case` in the database, mapped by Prisma `@map`).

All types live in `packages/domain/src/types.ts` and are imported verbatim by
`apps/web` and `apps/api` (ADR-0004). Zod schemas mirroring them live in
`packages/domain/src/schemas.ts` and validate **every** store read and every
external payload (OCR, TMDB, HTTP body).

### 3.1 Enums — enumerated in full

```ts
export const SERVICES = ['netflix', 'max'] as const;             // REQ-002, REQ-053
export type Service = typeof SERVICES[number];

export const BATCH_MODES = ['append-only', 'full-update'] as const;  // REQ-003
export type BatchMode = typeof BATCH_MODES[number];

export const BATCH_STATUSES = [
  'draft',              // created, images being attached; nothing extracted
  'submitted',          // owner pressed submit; extraction queued in-process
  'extracting',         // OCR/matching running
  'extraction-failed',  // US-006 AC-4; images retained; retry offered
  'in-review',          // candidates staged, review pass renderable
  'applied',            // CLOSED. The only status list queries accept.
  'undone',             // reversed by US-032
  'discarded',          // abandoned by the owner before close (US-005 AC-4)
] as const;
export type BatchStatus = typeof BATCH_STATUSES[number];

export const LISTING_STATES = ['active', 'removed'] as const;    // REQ-027/028
export type ListingState = typeof LISTING_STATES[number];

export const TITLE_STATES = ['active', 'removed'] as const;      // 'suppressed' is NOT here
export type TitleState = typeof TITLE_STATES[number];

export const MATCH_STATES = ['matched', 'unmatched'] as const;
export type MatchState = typeof MATCH_STATES[number];

export const MEDIA_TYPES = ['movie', 'tv'] as const;             // REQ-033
export type MediaType = typeof MEDIA_TYPES[number];

export const CANDIDATE_CLASSIFICATIONS = [
  'new',                            // REQ-010
  'already-present-for-this-service',
] as const;
export type CandidateClassification = typeof CANDIDATE_CLASSIFICATIONS[number];

export const REVIEW_DISPOSITIONS = [
  'pending',    // default; NOT confirmed (REQ-014 / US-012 AC-3: no accept-by-inaction)
  'confirmed',
  'corrected',  // owner re-pointed the match, then it is treated as confirmed
  'discarded',
  'unresolved', // unmatched and left unresolved at close (US-008 AC-4)
] as const;
export type ReviewDisposition = typeof REVIEW_DISPOSITIONS[number];

// Formats ACCEPTED AT UPLOAD (api.md §5). An iOS Safari file input can deliver
// any of these depending on the capture/export path: camera photos default to
// HEIC, screenshots are normally PNG, "Most Compatible" photos are JPEG, and the
// laptop-web capture path produces PNG. ALL FOUR ARE ACCEPTED — do NOT "tidy" the
// list by dropping HEIC/HEIF or swapping PNG out for it; the phone is the primary
// capture device and rejecting HEIC rejects the owner's own photos at attach time.
// (A42 — ASM-034 falsified, superseded by ASM-058; was PNG/JPEG only.)
export const UPLOAD_FORMATS = ['png', 'jpeg', 'heic', 'heif'] as const;
export type UploadFormat = typeof UPLOAD_FORMATS[number];

// HOW the bytes reached nextup (A45). THREE affordances, all first-class, all
// landing on the SAME endpoint and the SAME open batch (api.md §5.3):
//   'paste'  — clipboard: a desktop `paste` event (Ctrl/Cmd+V) or the iOS
//              "Paste screenshot" button calling navigator.clipboard.read().
//              The OWNER'S PRIMARY PATH (A45). Bytes are ALWAYS image/png.
//   'upload' — <input type="file">: the iOS Photos picker and the laptop file
//              picker. STILL FULLY SUPPORTED and NOT deprecated — it is the
//              only path that delivers raw HEIC, and the only path that works
//              when the owner missed the screenshot preview's "Copy".
//   'drop'   — drag-and-drop onto the batch screen (a DataTransfer, like
//              'paste', but initiated by a drag).
// ⚠ This is an ADD, not a SWAP. Do NOT "tidy" this list by removing 'upload'
// on the grounds that paste is primary — that is the A42 mistake (PNG/JPEG
// nearly swapped out for HEIC) repeated. Evidence:
// Context/evidence/clipboard-paste-support.md Q5/VERDICT.
export const INGEST_SOURCES = ['paste', 'upload', 'drop'] as const;
export type IngestSource = typeof INGEST_SOURCES[number];

// Formats STORED and handed to extraction. Neither extraction service accepts
// HEIC/HEIF (Azure OpenAI vision: PNG/JPEG/WEBP/non-animated GIF; Azure AI Vision
// Read: JPEG/PNG/GIF/BMP/WEBP/ICO/TIFF/MPO), so HEIC/HEIF is transcoded to
// LOSSLESS PNG on ingest (api.md §5.1, security.md §4.2) BEFORE it is stored or
// analysed. By the time bytes are persisted or reach the extractor they are
// ONLY 'png' | 'jpeg', never 'heic'. (A42 — was ASM-034)
export const IMAGE_FORMATS = ['png', 'jpeg'] as const;
export type ImageFormat = typeof IMAGE_FORMATS[number];
```

**`suppressed` is deliberately absent from `TitleState`.** It is the existence
of a `suppression` document, evaluated against the *work*, never a field on the
row (REQ-071, ADR-0005). Collapsing them is the highest-risk silent defect in
the product (PRD R-5). Test `T-INV-004` asserts no `title` document schema
accepts the string `'suppressed'`.

### 3.2 `Title` (`type: 'title'`) — the central document

```ts
export interface Title {
  id: string;                  // ULID (deterministic when batch-created)
  type: 'title';
  ownerId: string;             // partition key — NFR-008
  workIdentity: string;        // §2 — required, matches WORK_IDENTITY_RE
  state: TitleState;           // DERIVED — §5.1. Never written by a caller.
  matchState: MatchState;
  rawExtractedText: string | null;   // required when matchState==='unmatched'
  normalisedText: string | null;     // required when matchState==='unmatched'
  createdByBatchId: string | null;   // null iff created outside a batch (never in v1)
  visible: boolean;            // false until the creating batch reaches 'applied'
  listings: ServiceListing[];  // 1..2 in v1; EMBEDDED (ADR-0005)
  tmdb: TmdbMetadata | null;   // null iff matchState==='unmatched'
  sortDateAdded: string | null;// DERIVED — §5.2. ISO date 'YYYY-MM-DD'. null iff every listing removed AND none had a date
  createdAt: string;           // ISO-8601 UTC
  updatedAt: string;           // ISO-8601 UTC
}
```

| Field | Required | Validation |
|---|---|---|
| `workIdentity` | yes | `WORK_IDENTITY_RE`; immutable except by fix-match (§6.3) |
| `state` | yes | derived only; write path recomputes — §5.1 |
| `matchState` | yes | `'matched'` ⟺ `workIdentity` starts `tmdb:` ⟺ `tmdb !== null` |
| `rawExtractedText` | when unmatched | 1..500 chars |
| `normalisedText` | when unmatched | must equal `normaliseTitleText(rawExtractedText)` — asserted by `T-INV-005` |
| `visible` | yes | list queries require `visible === true` |
| `listings` | yes | `1..2`; at most one per `service` (`T-INV-002`) |
| `sortDateAdded` | yes/null | derived only — §5.2 |

### 3.3 `ServiceListing` (embedded in `Title.listings[]`)

```ts
export interface ServiceListing {
  listingId: string;           // ULID — stable, referenced by batch provenance (REQ-068)
  service: Service;
  state: ListingState;
  dateAdded: string;           // 'YYYY-MM-DD' — REQ-030. WRITE-ONCE (US-021 AC-6)
  dateAddedEdited: boolean;    // v1.1 (REQ-059) — modelled now, ALWAYS false in v1
  removedAt: string | null;    // ISO-8601 UTC; null while active — REQ-062
  removedByBatchId: string | null;
  removedByGroupId: string | null;  // REQ-056 group undo — §8.2
  createdByBatchId: string;
}
```

**`dateAdded` is write-once per listing (REQ-030, REQ-060, US-021 AC-6).** The
repository exposes exactly one function able to set it — `createListing()` —
and there is no `updateDateAdded`. `T-INV-006` greps `apps/api/src` and
`packages/domain/src` for any assignment to `.dateAdded` outside
`repository/ownerData.ts#createListing` and fails on a match. In v1
`dateAddedEdited` is never written `true`; `T-INV-007` asserts it.

**`dateAdded` is never read out of an image** (REQ-030). Its value is
`batch.submittedAt` rendered as a UTC date. `specs/ai.md` §3 forbids the
extractor emitting any date field.

### 3.4 `TmdbMetadata` (embedded in `Title.tmdb`)

```ts
export interface TmdbMetadata {
  tmdbId: number;              // positive integer
  mediaType: MediaType;
  name: string;                // 1..300
  releaseYear: number | null;  // 1880..currentYear+5, or null when TMDB has none
  runtimeMinutes: number | null; // stored in v1, filtered in v1.1 (REQ-035/037)
  genres: string[];            // may be [] — US-019 AC-6: NEVER defaulted
  posterPath: string | null;   // TMDB path only, e.g. '/d5NXS.jpg'. Bytes served by TMDB's CDN, never proxied
  fetchedAt: string;           // ISO-8601 UTC — NFR-014 / REQ-076 age test
}
```

- `genres: []` means "TMDB carries no genre". It is **never** replaced by a
  default, and such a title is excluded from every genre-filtered result and
  included when no genre filter is active (US-019 AC-6, `T-LIST-011`).
- `posterPath` is a path, never a URL. The web app composes
  `https://image.tmdb.org/t/p/w342{posterPath}`.

### 3.5 `Suppression` (`type: 'suppression'`)

```ts
export interface Suppression {
  id: string;                  // `supp:${workIdentity}` — uniqueness by the STORE
  type: 'suppression';
  ownerId: string;
  workIdentity: string;
  active: boolean;             // false === un-suppressed. NEVER DELETED (REQ-028, US-029 AC-2)
  suppressedAt: string;        // ISO-8601 UTC
  unsuppressedAt: string | null;
  migratedFrom: string | null; // SD-06 — previous workIdentity if migrated by fix-match
  displaySnapshot: {           // so the suppressed view renders without a Title (US-029 AC-1)
    name: string;
    releaseYear: number | null;
    mediaType: MediaType | null;
    posterPath: string | null;
  };
}
```

- **Suppression is per work, not per service** (US-027 AC-5).
- Suppressing an already-suppressed work is **idempotent**: an upsert that
  leaves `suppressedAt` unchanged and returns 200 (US-027 AC-4).
- Un-suppression sets `active=false`; the document is never deleted (REQ-028).
- Re-suppressing an inactive suppression sets `active=true` and updates
  `suppressedAt`.

### 3.6 `UploadBatch` (`type: 'uploadBatch'`)

```ts
export interface UploadBatch {
  id: string;                  // ULID
  type: 'uploadBatch';
  ownerId: string;
  service: Service;            // IMMUTABLE after submit (US-003 AC-6)
  mode: BatchMode;             // IMMUTABLE after submit (US-003 AC-6)
  status: BatchStatus;
  derivedFromBatchId: string | null;  // set for re-extraction batches (US-034 AC-3)
  createdAt: string;
  submittedAt: string | null;
  extractionStartedAt: string | null;
  extractionError: {
    code: 'EXTRACTOR_UNAVAILABLE' | 'EXTRACTOR_ERROR' | 'IMAGES_PURGED';
    message: string;
    at: string;
  } | null;
  completedAt: string | null;  // set iff status === 'applied'
  undoneAt: string | null;
  extractionStats: {           // the ONLY evidence for RSK-021 / OQ-024
    imagesProcessed: number;
    imagesWithZeroCandidates: number;
    candidatesRaw: number;
    candidatesAfterCleanup: number;
    candidatesCollapsed: number;
    matched: number;
    unmatched: number;
    suppressedGated: number;
  } | null;
  removalGroups: RemovalGroup[];   // 0..1 in v1 — §8.2
  provenance: BatchProvenance;     // REQ-068 — §8.1
}
```

### 3.7 `BatchProvenance` and `RemovalGroup`

```ts
export interface BatchProvenance {
  created: Array<{ titleId: string; listingId: string | null; titleWasCreated: boolean }>;
  modified: Array<{ titleId: string; attr: string; before: unknown; after: unknown }>;
  removed: Array<{ titleId: string; listingId: string; beforeState: 'active'; groupId: string }>;
}

export interface RemovalGroup {
  groupId: string;             // ULID
  confirmedAt: string;
  listingIds: string[];        // may be [] — US-015 AC-5
  reversed: boolean;           // US-017 AC-5: cannot be reversed twice
  reversedAt: string | null;
  heldBackListingIds: string[];// US-017 AC-4: suppressed works not restored by undo
}
```

**`provenance.modified` records the pre-batch value of every modified
attribute** (REQ-068) even though v1 undo is creates-only, because REQ-075's
refusal enumeration reads straight out of these three arrays. A change without
provenance MUST NOT be persisted (US-031 AC-6) — the repository writes
provenance and the mutation in the same operation, and the close fails
atomically if provenance cannot be written.

**Changes made outside a batch** (fix-match, suppress, un-suppress, restore)
carry `createdByBatchId: null` on the affected record and appear in **no**
`provenance` array (US-031 AC-5). They are therefore never included in any
batch undo.

### 3.8 `UploadedImage` (`type: 'uploadedImage'`)

```ts
export interface UploadedImage {
  id: string;                  // ULID
  type: 'uploadedImage';
  ownerId: string;
  batchId: string;
  blobPath: string;            // `${ownerId}/${batchId}/${id}.${ext}` (ext ∈ png|jpg — the DERIVED format) — NEVER emitted to a client
  fileName: string;            // DISPLAY ONLY, never used to build a path (security.md T4). 1..255.
                               // For ingestSource 'upload'/'drop' it is the device-supplied name.
                               // For ingestSource 'paste' the clipboard supplies NO name, so the
                               // server SYNTHESISES one — see the naming rule below. NEVER ''.
  ingestSource: IngestSource;  // 'paste' | 'upload' | 'drop' — HOW the bytes arrived (A45).
                               // Provenance, written ONCE at ingest, NEVER updated. Follows the
                               // `uploadedFormat` precedent (A42): the record of what arrived is
                               // kept distinct from what is stored.
  uploadedFormat: UploadFormat; // what the owner's DEVICE delivered (may be 'heic'/'heif'); by MAGIC BYTES, not extension/content-type
                               // ⚠ For ingestSource 'paste' this is ALWAYS 'png' in practice —
                               // WebKit exposes exactly four clipboard representations and HEIC is
                               // not one of them (evidence Q3). It is still SNIFFED, never assumed:
                               // the field records what the bytes ARE, not what the path implies.
  format: ImageFormat;         // STORED/DERIVED format actually persisted (always png|jpeg); HEIC/HEIF is transcoded to lossless PNG on ingest (api.md §5.1). by MAGIC BYTES
  byteSize: number;            // STORED bytes, post-transcode. ⚠ NOT bounded by the 10 MiB upload
                               // ceiling: a 1.76 MiB HEIC stores as a 17.8 MiB lossless PNG.
                               // Bounded by MAX_STORED_IMAGE_BYTES instead — see below.
  uploadedByteSize: number;    // what the DEVICE sent, <= 10 * 1024 * 1024. ⚠ NOT equal to
                               // byteSize even for PNG/JPEG: the metadata strip (REQ-078) rewrites
                               // every image, so a PNG stores slightly smaller and a HEIC several
                               // times larger. ⚠ THIS is the unit the 60 MiB
                               // per-batch ceiling counts (api.md §5). Never sum it with byteSize.
                               // ~~Superseded: a single `byteSize: number; // <= 10 * 1024 * 1024`
                               // — the comment described the upload but the value was the store, so
                               // the batch tally mixed units and refused batches at ~7 MiB.~~
  width: number | null;
  height: number | null;
  uploadedAt: string;          // ISO-8601 UTC
  retainUntil: string;         // uploadedAt + 30 days — WRITTEN ONCE, NEVER UPDATED (NFR-019)
  candidateCount: number | null; // null until extraction runs; 0 is meaningful (US-006 AC-3)
}
```

#### 3.8.1 Identity and naming for a PASTED image — the rule *(new, A45)*

A clipboard image **has no file name**. `DataTransfer.files[0].name` is
typically `"image.png"` — or empty, or a WebKit-generated placeholder — and
`ClipboardItem` supplies no name at all. Three different pastes would collide
on one meaningless label, in a batch that may hold 40 images and whose whole
error-reporting model (`api.md` §5.2, `ui.md` §3.2a) works by **naming the
file**. So the server synthesises one.

**Storage identity is unchanged and needs nothing new.** `UploadedImage.id` is
already a server-generated ULID and `blobPath` is already composed **only**
from server-generated ULIDs (`${ownerId}/${batchId}/${id}.${ext}`). A pasted
image is therefore *already* fully identified for storage. **The client
filename never enters a path, for any ingest source** (`security.md` T4). The
rule below governs the **display/provenance name only.**

```ts
// packages/domain/src/pastedFileName.ts — pure, deterministic, unit-testable
export function synthesisePastedFileName(
  seqInBatch: number,          // 1-based ordinal of this image WITHIN the open batch
  uploadedFormat: UploadFormat,// SNIFFED (§ api.md §5), never the declared type
  pastedAt: Date,              // server receipt time, UTC
): string;
```

**The exact format — normative:**

```
pasted-<YYYYMMDD>-<HHMMSS>-<NN>.<ext>
```

| Part | Rule |
|---|---|
| `pasted-` | Literal prefix. It is deliberately human-legible: a rejection message reading *"pasted-20260811-154233-03.png is 48.0 MP"* tells the owner which paste failed. |
| `<YYYYMMDD>-<HHMMSS>` | **Server** receipt time in **UTC**, zero-padded. Never client time (unvalidated input, and clock skew would break ordering). |
| `<NN>` | `seqInBatch`, zero-padded to **2** digits, `01`..`40`. This is the ordinal **within the open batch**, so a batch reads `…-01`, `…-02`, `…-03` in paste order. Beyond 99 it would widen — it cannot, because the per-batch ceiling is 40 (`api.md` §5). |
| `.<ext>` | From the **sniffed** `uploadedFormat`: `png`→`.png`, `jpeg`→`.jpg`, `heic`→`.heic`, `heif`→`.heif`. **From the bytes, never from the declared MIME type.** In practice a paste is always `.png` (evidence Q3), but the rule is written on the sniff so it stays correct if that ever changes. |

Uniqueness within a batch is guaranteed by `<NN>` alone; the timestamp is for
the human, not for uniqueness. **Two images pasted in the same second get
different names.** `T-PASTE-005`.

**A `drop` and an `upload` keep the device-supplied name** — they have one, it
is more useful than a synthetic one, and it is what the owner will recognise.
A dropped/uploaded file whose name is empty or whitespace-only falls back to
the same synthesiser with the prefix `dropped-` / `uploaded-` respectively, so
`fileName` is **never** empty for any source. `T-PASTE-005`.

**Provenance: `ingestSource` is the field that records how it arrived**, and it
is the only new field required. It follows the `uploadedFormat` precedent
(A42) — a small, explicit, write-once record of what the outside world handed
us, kept separate from what we stored. It is surfaced in
`POST /api/batches/:batchId/images` (`api.md` §6.12), in the `image.decode.begin`
sentinel (`api.md` §9.1) and on `GET /api/batches/:batchId` (`api.md` §6.15).
**Do not infer the ingest source from the filename prefix** — the prefix is
display copy and may be re-worded; `ingestSource` is the datum. `T-PASTE-005`.

**Everything else about a pasted image is identical to an uploaded one.** It
is an `uploadedImage` row like any other: same 30-day `retainUntil` (NFR-019),
same per-image and per-batch ceilings, same magic-byte sniff, same pre-decode
pixel guard (REQ-079), same metadata strip, same blob path scheme, same
re-extraction behaviour (REQ-074). **There is no parallel model and none is to
be built.**

- **Availability is derived, never stored as mutable state**:
  `isAvailable = Date.now() < Date.parse(retainUntil)`.
  A missing blob and an expired `retainUntil` are **the same, expected,
  non-error condition** (ADR-0006). Never a 500.
- `blobPath` must never appear in any HTTP response. `T-SEC-003` asserts no
  response body or header contains `blob.core.windows.net` or a `blobPath`.
- The 30-day constant lives in `apps/api/src/config.ts` as
  `IMAGE_RETENTION_DAYS = 30` and is **a distinct constant** from
  `TMDB_METADATA_MAX_AGE_DAYS = 183`
  (NFR-014). `T-INV-008` asserts the two are declared as two separate
  exported constants and that no constant is referenced by more than one of the
  two call sites (US-035 AC-7). *(The list-staleness threshold,
  `LIST_STALENESS_DAYS`/REQ-040, was dropped entirely at A46 — ASM-038 is
  retired — so this is now a two-constant, not a three-constant, rule.)*
- **HEIC/HEIF ingest and what is retained (A42; conditional since A45).** When
  the owner's device delivers HEIC/HEIF, the byte stream stored at `blobPath`
  is the **transcoded lossless PNG**, not the original — `format` records the
  derived format (`png`), `uploadedFormat` records what arrived (`heic`/`heif`).
  ⚠ **(A45) The transcode is CONDITIONAL on the SNIFFED `uploadedFormat`, and
  it is NOT removed.** A pasted PNG (`uploadedFormat === 'png'`) skips the
  transcode as a no-op — the paste path cannot deliver HEIC at all (evidence
  Q3/Q5) — but the **file-upload path from iOS Photos still delivers raw HEIC
  and still requires the transcode**. Deleting the transcode stage because
  "screenshots are always PNG now" breaks the owner's own camera-roll uploads.
  `api.md` §5.1, `T-IMG-023`. This
  keeps re-extraction (US-034 / REQ-074) well-defined: re-extraction reads the
  **retained derived PNG**, which the extractors already accept, so no second
  transcode is needed and no HEIC ever reaches stage 1. The single retained
  blob is also what `GET /api/images/:id` serves and what feeds every
  thumbnail (browsers other than Safari cannot render HEIC — `ui.md` §3.2).
  > **OQ-027 (open, low).** Whether to *also* retain the **original HEIC bytes**
  > alongside the derived PNG (for maximum fidelity / future re-transcode) is
  > **not determined by any existing requirement**. The spec default is
  > **discard the original after a verified transcode** — it is unusable by the
  > extractors, unrenderable outside Safari, and retaining it doubles the C1
  > footprint and the EXIF/GPS exposure surface for no v1 benefit under the
  > 30-day retention (NFR-019). **Raised as OQ-027 for
  > `Context/open-questions.md` (see this spec's change report for
  > reconciliation, since that registry is being edited concurrently);**
  > revisit only if a fidelity requirement appears.

```ts
export interface ExtractionCandidate {
  id: string;                  // `cand:${batchId}:${sourceImageId}:${seq}` — deterministic
  type: 'extractionCandidate';
  ownerId: string;
  batchId: string;
  sourceImageIds: string[];    // >=1. MORE THAN ONE after overlap collapse (§7.4)
  rawText: string;             // verbatim reader text, 1..500. '' allowed ONLY for 'unreadable-tile'
  inferredTitle: string | null;// R2: the model's structured, de-truncated title. null for ocr-only items
  basis: 'text' | 'artwork' | 'both' | 'unknown';   // R2: what the primary reader read it from
  ocrSupport: 'exact' | 'partial' | 'none' | 'not-checked'; // R2: crossCheck() verdict
  provider: 'llm' | 'ocr-only'; // R2: 'ocr-only' = an orphan the model failed to report
  normalisedText: string;      // normaliseTitleText(inferredTitle ?? rawText) — see specs/ai.md §3.1a
  extractedYear: number | null;// MATCH HINT ONLY — never enters identity (SD-05)
  boundingBoxes: Array<{ imageId: string; x: number; y: number; w: number; h: number }>;
  boxSource: 'ocr' | 'llm';    // R2: OCR geometry is preferred when available (it is exact)
  ocrConfidence: number | null;// 0..1 as reported by the provider, or null
  cleanupVerdict: CleanupVerdict;  // specs/ai.md §3.3 — classify-and-surface, never drop
  resolvedWorkIdentity: string | null;
  matchCandidates: Array<{     // US-007 AC-4: alternatives are shown, never hidden
    tmdbId: number; mediaType: MediaType; name: string;
    releaseYear: number | null; posterPath: string | null; score: number;
  }>;
  classification: CandidateClassification | null; // null while unmatched
  reviewDisposition: ReviewDisposition;
  correctedToTmdbId: number | null;
  createdAt: string;
}

export type CleanupVerdict =
  | 'title-candidate'      // passes every heuristic
  | 'low-confidence'       // surfaced in review, flagged, NOT dropped (REQ-012)
  | 'inferred-unverified'  // R2: model title with NO corroborating OCR text — artwork read
                           //     OR fabrication; indistinguishable from inside, so BOTH are
                           //     shown to the owner, with the tile thumbnail (RSK-028)
  | 'unreadable-tile'      // R2: a tile the model could not name at all — shown as a
                           //     thumbnail with a "search for this" action (US-009)
  | 'chrome-suspected';    // surfaced in a collapsed "probably not titles" group, NOT dropped
```

**No candidate is ever deleted or hidden** (REQ-012, US-006 AC-2). Every
`cleanupVerdict` value is *rendered somewhere* in the review pass;
`chrome-suspected` items are collapsed behind a labelled expander with a count,
never omitted. Test `T-AI-004`.

⚠ **Revision 2 note (ADR-0001).** `inferred-unverified` and `unreadable-tile`
are **new verdicts, not new drop paths**. Adding a filter that removes
`inferred-unverified` candidates before review would discard exactly the
artwork-read titles the extraction decision was made to obtain, and is a REQ-012
violation. `T-AI-042` asserts the fabrication-rate ceiling constant is never
referenced under `apps/api/src/`.

### 3.10 `ServiceState` (`type: 'serviceState'`)

```ts
export interface ServiceState {
  id: string;                  // `svcstate:${service}`
  type: 'serviceState';
  ownerId: string;
  service: Service;
  lastCompletedBatchAt: string | null;  // null === 'never updated' (US-022 AC-3)
  lastCompletedBatchId: string | null;
}
```

Written **only** when a batch reaches `applied` (US-022 AC-4) and rewritten to
the previous applied batch when a batch is undone (US-032 AC-2). Abandoned,
discarded and failed batches never touch it.

---

## 4. Relationships and cardinality

| From | To | Cardinality | Enforced by |
|---|---|---|---|
| Owner | Title | 1 → 0..n | `ownerId` partition key |
| Owner | Suppression | 1 → 0..n | `ownerId` |
| Owner | UploadBatch | 1 → 0..n | `ownerId` |
| Owner | ServiceState | 1 → 0..2 | `ownerId` + `id` |
| Title | ServiceListing | 1 → 1..2 (v1) | embedded array; `T-INV-002` |
| Title | TmdbMetadata | 1 → 0..1 | embedded object |
| UploadBatch | UploadedImage | 1 → 1..40 | `batchId`; ceiling in `specs/api.md` §5 |
| UploadBatch | ExtractionCandidate | 1 → 0..n | `batchId` |
| UploadedImage | ExtractionCandidate | 1 → 0..n | `candidate.sourceImageIds[]` (many-to-many after collapse) |
| UploadBatch | Title / ServiceListing | 1 → 0..n created | `provenance.created` + `createdByBatchId` |
| Suppression | Title | keyed by `workIdentity`, **never by id** | REQ-071 |
| UploadBatch | UploadBatch | 0..1 `derivedFromBatchId` | re-extraction (US-034 AC-3) |

---

## 5. Derived fields — computed in exactly one place

Both derivations live in `packages/domain/src/derive.ts` and are called by
`apps/api/src/repository/ownerData.ts` on **every** write path. No route
handler, no UI component and no test fixture computes them independently.
`T-INV-009` greps for the derivation logic appearing anywhere else.

### 5.1 `deriveTitleState`

```ts
export function deriveTitleState(listings: ServiceListing[]): TitleState {
  return listings.every(l => l.state === 'removed') ? 'removed' : 'active';
}
```
REQ-028. A `title` with zero listings cannot exist (§5.3 invariant I-3).

### 5.2 `deriveSortDateAdded`

```ts
export function deriveSortDateAdded(listings: ServiceListing[]): string | null {
  const dates = listings.filter(l => l.state !== 'removed').map(l => l.dateAdded).sort();
  return dates[0] ?? null;   // EARLIEST across NON-REMOVED listings — REQ-036
}
```

Consequences, all intended and all tested:

| Consequence | Test |
|---|---|
| Adding an existing work on a second service does **not** move the row (US-020 AC-4) | `T-LIST-014` |
| Removing the earliest listing **recomputes** the value and may move the row (US-020 AC-5) | `T-LIST-015` |
| A title with every listing removed has `sortDateAdded = null` and sorts **last** (US-020 AC-7) | `T-LIST-017` |

### 5.3 Ordering and the tie-breaker (REQ-036, REQ-038, US-020 AC-3)

Default order = `sortDateAdded` **descending** (most recent first — **`A44`:
the owner confirmed this verbatim, *"Newest-first — conventional, recent
saves on top"*; `ASM-035` is now user-confirmed, not a low-confidence
assumption**), with `null` last. **Tie-breaker: `title.id` ascending** (ULIDs
are lexicographically time-ordered, so this is stable and deterministic
across reloads). Reverse direction (**`must`** as of `A47`, REQ-038) inverts
`sortDateAdded` only; the tie-breaker stays `title.id` ascending, so
ordering is deterministic in both directions. `T-LIST-016` renders the same
fixture twice and asserts an identical id sequence.

**Nulls under `dir=asc`:** `null` stays **last in both directions**, never
first — reversing direction flips `sortDateAdded`'s comparison, not the
null-placement rule. A null `sortDateAdded` means every listing on that
title was removed, and such titles are already excluded from the combined
list by REQ-031, so this is near-moot for this view — stated explicitly
anyway so no developer resolves the comparator by guessing. `T-LIST-027`
asserts nulls sort last under both `dir=desc` and `dir=asc`.

### 5.4 Invariants (~~application-enforced; Cosmos cannot enforce them~~ — see §15.4)

> ⚠ **SUPERSEDED (R3) by §15.4.** The invariants themselves are unchanged.
> What changed is **who enforces them**: I-1, I-2 and suppression
> uniqueness are now **database constraints**, not tests hoping to catch a
> violation after the fact. The heading's parenthetical was true of Cosmos
> and is false of PostgreSQL. The tests remain — a constraint you have not
> tested is a constraint you have not got — but they now assert that the
> *database* refuses, which is a much stronger assertion.

| ID | Invariant | Test |
|---|---|---|
| **I-1** | At most one `title` per `(ownerId, workIdentity)` with `state !== 'removed'` **and** `visible === true` | `T-INV-001` |
| **I-2** | At most one `ServiceListing` per `(titleId, service)` | `T-INV-002` |
| **I-3** | Every `title` has `listings.length >= 1` | `T-INV-003` |
| **I-4** | `title.state` and `title.sortDateAdded` equal the values `derive.ts` computes from `listings` | `T-INV-010` |
| **I-5** | `matchState === 'matched'` ⟺ `workIdentity` starts `tmdb:` ⟺ `tmdb !== null` | `T-INV-011` |
| **I-6** | No `title.listings[].dateAdded` changes after creation | `T-INV-006` |
| **I-7** | No document type is ever hard-deleted **except** by creates-only batch undo (§8.3) | `T-INV-012` |
| **I-8** | No Cosmos container, database or document carries a TTL | `T-INV-013` |

**I-1 permits duplicates deliberately.** US-025 AC-5 and US-030 AC-4 both allow
the owner to *confirm* creating a second active row for the same work. In those
two paths only, the repository is called through
`createTitleAllowingDuplicate()` and the resulting documents are tagged
`provenance.modified` with `attr: 'duplicateAcknowledged'`. Every other write
path calls `createTitle()`, which throws `DuplicateWorkIdentityError` on I-1.

---

## 6. State machines

### 6.1 Listing state

```
(none) --confirm addition in a closed batch (US-012)--> active
active --confirmed removal group (US-015/016)--------> removed
removed --explicit owner restore ONLY (US-025)-------> active
removed --reappearance (US-026)---------------------> (NO TRANSITION; a NEW Title is created)
```

**There is no automatic `removed → active` transition anywhere in the
codebase.** `T-INV-014` asserts the only call site of
`repository.restoreListing()` is the restore route and the removal-group-undo
route.

### 6.2 Suppression

```
(none) --US-027 suppress--> active:true
active:true --US-029 un-suppress--> active:false   (document retained, REQ-028)
active:false --US-027 suppress again--> active:true
```

Un-suppression does **not** restore anything (US-029 AC-4). A work whose
listings are all `removed` becomes visible in the removed view only and is
restorable from there.

### 6.3 Fix-match (US-030) and suppression migration (SD-06)

`POST /api/titles/:titleId/fix-match` performs, as one repository operation:

1. Compute `newWorkIdentity = workIdentityForTmdb(mediaType, tmdbId)`.
2. **Refuse (409 `TARGET_WORK_SUPPRESSED`)** if an *active* suppression exists
   for `newWorkIdentity` (US-030 AC-5), offering the un-suppress action.
3. **Warn-and-confirm (409 `DUPLICATE_WORK_IDENTITY` unless
   `confirmDuplicate: true`)** if an active visible title already holds
   `newWorkIdentity` (US-030 AC-4).
4. Replace `workIdentity`, `matchState`, `tmdb`; set `rawExtractedText` and
   `normalisedText` to `null` when the new state is `matched`.
5. **Preserve** `listings` (every `listingId`, `dateAdded`, `state`,
   `createdByBatchId`), `id`, `createdAt`, and therefore `sortDateAdded`
   (US-030 AC-2/AC-3).
6. **SD-06 — migrate suppression.** If an *active* `suppression` exists for the
   **old** `workIdentity`, write a new suppression on `newWorkIdentity` with
   `migratedFrom = oldWorkIdentity`, set the old one `active: false`, and
   return `{ suppressionMigrated: true, from, to }`. The UI states plainly
   that the suppression moved (`specs/ui.md` §9.4). Silently dropping it would
   re-open the REQ-071 hole. Test `T-FIX-005`.
7. Record `provenance.modified` entries with `batchId: null` (owner-initiated,
   US-031 AC-5).

**Nothing is removed and nothing is re-created.** `T-FIX-002` asserts the
title's `id`, every `listingId` and every `dateAdded` are byte-identical before
and after.

---

## 7. Batch lifecycle and the write model

### 7.1 Status transitions

```
draft ──submit──> submitted ──> extracting ──> in-review ──close──> applied ──undo──> undone
  │                                   │                                │
  │                                   └──failure──> extraction-failed ─┤ (retry → extracting)
  └──discard──> discarded            (images retained; no list state changed)
```

- Only `applied` batches contribute to the combined list. **Every list query
  filters `visible === true`.** `T-BATCH-003` submits a batch, leaves it
  `in-review`, and asserts the combined list is byte-identical to before
  (US-005 AC-1).
- **One open batch at a time** (US-005 AC-5): `POST /api/batches` returns
  409 `OPEN_BATCH_EXISTS` with the open batch id when any batch is in
  `draft|submitted|extracting|extraction-failed|in-review`.
- `service` and `mode` are rejected with 409 `BATCH_IMMUTABLE` after
  `submittedAt` is set (US-003 AC-6).

### 7.2 Reconciliation runs once, against the union of the batch (REQ-006)

`reconcile(batch, candidates, currentListings)` is a **pure function** in
`packages/domain/src/reconcile.ts` taking the *whole* candidate set. It is
called exactly once per batch. `T-BATCH-004` spies on the call count with a
6-image batch and asserts `1` (US-005 AC-2).

### 7.3 ~~Close is atomic by visibility, not by one transaction~~ — **DELETED (R3)**

> ⛔ **DELETED by ADR-0005 Revision 2. Do not implement any of the four
> steps below.** They existed only because Cosmos DB's `TransactionalBatch`
> is capped at 100 operations within a single partition, which a real
> review pass can exceed. **On PostgreSQL, close is literally one
> transaction** — see §15.5. The `visible` column does not exist, step 4
> does not exist, and the query predicate
> `visible = true OR createdByBatchId IN (@appliedBatchIds)` — which every
> future list query would have had to remember to include — does not exist.
>
> **`T-BATCH-005` survives with a new body**: kill the process mid-close and
> assert that the list is unchanged (not "eventually consistent"), because
> an uncommitted transaction leaves nothing behind.
>
> Retained below, struck through, because deleting a mechanism is a
> decision and the reader deserves to see what was deleted and why.

~~1. All documents the batch will create are written `visible: false` with~~
   `createdByBatchId`, in idempotent chunks keyed deterministically (§1).
2. Modified/removed records are staged as `pendingMutations` on the batch
   document.
3. **One atomic single-document write** sets `uploadBatch.status = 'applied'`,
   `completedAt`, and the final `provenance`.
4. A follow-up idempotent pass flips `visible: true` on the created documents
   and applies the staged mutations. **A crash between 3 and 4 is invisible to
   the owner and resumable**, because list queries additionally accept a
   document whose `createdByBatchId` points at an `applied` batch. Expressed as
   the repository query predicate:

```sql
SELECT * FROM c WHERE c.ownerId = @ownerId AND c.type = 'title'
  AND (c.visible = true OR c.createdByBatchId IN (@appliedBatchIds))
```

`T-BATCH-005` kills the process between steps 3 and 4 (simulated by a repository
fault injector) and asserts the list is complete and no duplicate appears on
resume.

### 7.4 OQ-013 — intra-batch overlap collapse — CLOSED (SD-02)

Two deterministic passes, in this order:

| Pass | Key | When | Kept |
|---|---|---|---|
| **A — pre-match** | `normalisedText` (exact equality) | after cleanup, before TMDB | first occurrence by `(imageIndex, yTop, xLeft)` |
| **B — post-match** | `resolvedWorkIdentity` | after matching | first occurrence by the same ordering |

In both passes the survivor **absorbs** the losers: `sourceImageIds` becomes the
union, `boundingBoxes` becomes the concatenation, `ocrConfidence` becomes the
max. Losing candidate documents are **not deleted** — they are written with
`cleanupVerdict` unchanged and `reviewDisposition: 'discarded'` plus
`collapsedIntoCandidateId`, so REQ-012's "nothing is silently discarded" holds
at the storage layer while the review pass shows one item per work
(US-004 AC-5). Test `T-AI-007`.

*(Schema addendum: `ExtractionCandidate` carries
`collapsedIntoCandidateId: string | null`.)*

---

## 8. Provenance, undo and removal groups

### 8.1 What is recorded (REQ-068, US-031)

| Event | `provenance` array | Also written |
|---|---|---|
| Title created by a batch | `created` (`titleWasCreated: true`) | `title.createdByBatchId` |
| Listing added to an existing title | `created` (`titleWasCreated: false`) | `listing.createdByBatchId` |
| Match corrected during review | `modified` (`attr: 'workIdentity'`, with `before`) | — |
| Listing removed by a confirmed group | `removed` (with `groupId`, `beforeState: 'active'`) | `listing.removedByBatchId`, `removedByGroupId`, `removedAt` |
| Fix-match / suppress / un-suppress / restore | **nothing** (US-031 AC-5) | `batchId: null` on the record |

### 8.2 Removal group undo (US-017)

`POST /api/removal-groups/:groupId/undo`:

- Every `listingId` in the group returns to `active`; `removedAt`,
  `removedByBatchId`, `removedByGroupId` are cleared; **`dateAdded` is
  untouched** (US-017 AC-2).
- A listing whose work has since been **suppressed** is **held back**, added to
  `heldBackListingIds`, and named in the response (US-017 AC-4). Suppression
  wins over restore.
- `reversed` is set `true`; a second undo returns 409 `GROUP_ALREADY_REVERSED`
  (US-017 AC-5).
- The whole group applies or none of it does; failures return 500
  `PARTIAL_FAILURE_PREVENTED` with `{ applied: false }` (US-017 AC-6).
- A zero-member group (US-015 AC-5) is recorded and its undo is a successful
  no-op.

### 8.3 Creates-only batch undo — DISCARD, not soft-remove (SD-03)

`isCreatesOnly(batch) === batch.provenance.modified.length === 0 && batch.provenance.removed.length === 0`
— a pure data test (`T-UNDO-001`).

When creates-only:

| The batch created | Undo does |
|---|---|
| A whole `title` (`titleWasCreated: true`) | **Hard-deletes the `title` document** |
| A `listing` on a pre-existing title | **Splices the listing out of `listings[]`** and recomputes `state`/`sortDateAdded` |
| An `extractionCandidate` / `uploadedImage` | **Retained** (US-032 AC-3) |

**This is the sole hard delete of a list record in nextup and it is not a
REQ-028 violation.** REQ-028 forbids purging *history*; undo reverses a
*creation* that, once reversed, never legitimately happened. Leaving several
hundred spurious rows in the removed view after undoing a bad first import
would poison the very view REQ-062 exists to make useful. Invariant I-7 is
written to permit exactly this call site and no other (`T-INV-012`).

Also: `serviceState.lastCompletedBatchAt` reverts to the previous `applied`
batch for that service (US-032 AC-2); `batch.status = 'undone'`; a second undo
returns 409 `BATCH_ALREADY_UNDONE` (US-032 AC-3); a batch that created nothing
succeeds as a no-op (US-032 AC-5).

**A creates-only batch whose created titles were later suppressed or
fix-matched is no longer undoable** (US-032 AC-4): the later owner edit wrote a
`modified` entry with `batchId: null`, so the repository's
`laterOwnerEdits(batch)` query — titles in `provenance.created` whose
`updatedAt > batch.completedAt` — returns non-empty and the undo is **refused
under §8.4**, enumerating those titles.

### 8.4 The refusal (REQ-075, US-033) — a feature, not an error path

`POST /api/batches/:batchId/undo` → **409** with:

```jsonc
{
  "error": {
    "code": "BATCH_NOT_CREATES_ONLY",
    "message": "This batch cannot be undone as a whole.",
    "details": {
      "batchId": "01J...",
      "reason": "modified-or-removed" | "later-owner-edits" | "provenance-unavailable",
      "created":  [{ "titleId": "...", "name": "Dune", "releaseYear": 2021, "posterPath": "/d.jpg", "currentState": "active",     "remedy": "not-interested",   "remedyHref": "/api/titles/.../suppress" }],
      "modified": [{ "titleId": "...", "name": "Andor", "releaseYear": 2022, "posterPath": "/a.jpg", "attr": "workIdentity", "before": "tmdb:tv:1", "currentState": "active", "remedy": "fix-match", "remedyHref": "/api/titles/.../fix-match" }],
      "removed":  [{ "titleId": "...", "listingId": "...", "name": "Heat", "releaseYear": 1995, "posterPath": "/h.jpg", "currentState": "removed", "remedy": "restore", "remedyHref": "/api/listings/.../restore" }],
      "truncated": false
    }
  }
}
```

- **`truncated` is always `false`.** The enumeration is never summarised
  (US-033 AC-5). The API returns every entry; the UI paginates client-side.
  `T-UNDO-006` builds a 400-title mixed batch and asserts every id is present.
- A title touched by the batch that has since been removed or suppressed
  **still appears**, annotated via `currentState` (US-033 AC-6).
- `reason: 'provenance-unavailable'` is returned when provenance is missing
  (US-033 AC-7). US-031 AC-6 makes this unreachable in practice; the branch
  exists and is tested with a hand-crafted fixture (`T-UNDO-007`).
- **Nothing is written.** `T-UNDO-005` snapshots the whole partition before and
  after and asserts equality.

---

## 9. Retention — REQ-028, and the absence that IS the requirement

> **NO TTL IS CONFIGURED ANYWHERE IN nextup's DATA LAYER.**
> Not on the Cosmos DB account, not on the `nextup` database, not on the
> `owner-data` container, and not as `ttl` on any document. **The absence of a
> TTL is REQ-028**, expressed at the deployment level. There is no purge job,
> no archive job, no retention cutoff, no eviction, no oldest-first trimming,
> and no "tidy-up" migration. Storage growth over years is **accepted**
> (US-023 AC-4).
>
> If you are reading this while considering adding a TTL, an expiry, or a
> clean-up script "for hygiene": **that is the defect this paragraph exists to
> prevent.** Two tests will fail — `T-INV-013` (Bicep + live container
> assertion that `defaultTtl` is unset and no document carries `ttl`) and
> `T-INV-012` (no hard delete outside the §8.3 call site).

**The only automatic deletion in the entire product** is the Blob Storage
lifecycle rule that deletes screenshot **bytes** 30 days after creation
(NFR-019, US-035). It:

- is declared in `infra/storage.bicep`, scoped to the `screenshots` container
  by prefix, `delete` action at 30 days after creation;
- **writes nothing to Cosmos DB** — no application code and no timer;
- deletes **bytes only**. `uploadedImage`, `extractionCandidate`,
  `uploadBatch`, `Title`, `ServiceListing` and `Suppression` are untouched
  (US-035 AC-2);
- changes **no** user-visible list state (US-035 AC-3);
- evaluates roughly daily, so real deletion lands at 30–31 days. **The
  application-visible boundary is exactly 30 days** because availability is
  derived from `retainUntil`. Tests assert *"unavailable to the application at
  30 days"*, never *"the blob is gone at exactly T+30d"* (`T-IMG-004`);
- treats a missing blob as expiry, never an error (`T-IMG-005`).

**Two unrelated 30-ish-day constants (US-035 AC-7).** Declared
separately in `apps/api/src/config.ts`, never imported by each other's call
sites. *(A46: the list-staleness nudge, `LIST_STALENESS_DAYS`/REQ-040, was
dropped entirely — no staleness threshold, no nag, no derived "stale" state.
ASM-038 is retired, so this is now two constants, not three.)*

```ts
export const IMAGE_RETENTION_DAYS = 30;        // NFR-019 — user-accepted
export const TMDB_METADATA_MAX_AGE_DAYS = 183; // NFR-014 — TMDB's ~6-month ceiling
```

---

## 10. Indexing and query cost (NFR-018)

> ⛔ **SUPERSEDED (R3) by §15.6.** Cosmos composite indexes and RU-charge
> assertions do not apply. The *claim* NFR-018 makes — cost bounded by page
> size, not by history size — is preserved and is now expressed as **keyset
> pagination over a covering B-tree index**, asserted by row-count and
> `EXPLAIN` rather than by RU charge.

Cosmos indexes every property by default. Two composite indexes are declared in
`infra/cosmos.bicep`:

| Index | Supports |
|---|---|
| `(type ASC, state ASC, sortDateAdded DESC, id ASC)` | combined list default order (REQ-038, §5.3) |
| `(type ASC, state ASC, listings[].removedAt DESC, id ASC)` | removed view default order (§11) |

Every query is **partition-scoped, filtered and paginated by continuation
token**, so cost is bounded by page size, not by history size — the
scale-invariance NFR-018 asks for, expressed as a property of the query.
`T-PERF-001` seeds 20,000 removed listings and asserts the first page's RU
charge is within 3× the RU charge of the same query over 100 removed listings.

**Default page size 50; maximum 200.**

---

## 11. Removed view — OQ-022 CLOSED

**Resolution (spec-writer owns OQ-022): v1 implements exactly four
affordances**, and no more:

1. **Title text search** (REQ-064, US-024 AC-3) — *(R3)* a case-insensitive
   trigram match on `tmdb.name` **or** on `normalised_text`, so unmatched
   rows are findable, backed by the `pg_trgm` GIN index in §15.6.
   ~~Cosmos `CONTAINS(LOWER(c.tmdb.name), @q)`.~~
2. **Service filter** (REQ-064, US-024 AC-4) — matches rows whose *removed*
   listing was on that service.
3. **Default ordering: most-recently-removed first**, tie-broken by
   `listingId` ascending (US-024, deterministic).
4. **Repetition annotation** — each row shows
   `"removal N of M for this work"` computed from the count of removed listings
   sharing its `workIdentity`, plus the surface-level framing copy
   (`specs/ui.md` §6). This is what makes repetition read as *history*.

**Explicitly NOT in v1** (recorded so nobody adds them): date-range filter,
bulk restore, grouping rows into collapsible per-work clusters, sort by
date-added.

**The removed view MUST NOT be de-duplicated** (US-024 AC-6, PRD R-4).
One row per *removed listing*, not per work. `T-REM-006` removes the same work
three times across three batches and asserts three rows.

---

## 12. Import / export

**None in v1.** There is no import format and no export format. The
architecture flags the absence of a user-controlled backup as a gap
recommended for early promotion (architecture §Deliberately deferred); it is
**not** in the locked scope and is not specified here. Recorded as
**OQ-025** (new, §14).

---

## 13. Migrations and versioning

> ⛔ **SUPERSEDED (R3) by §15.8.** "Cosmos is schemaless and Zod is the
> schema" is no longer true: **PostgreSQL is the schema**, and Prisma
> Migrate owns its evolution. Zod survives at the API boundary for request
> validation, not as the storage contract. The **additive-only rule and the
> never-delete rule below are unchanged and are now enforceable in CI**,
> because a migration is a reviewable artefact in the repository where a
> schemaless write was not.

- Every document carries no explicit schema version in v1. Cosmos is
  schemaless and **Zod is the schema**: `packages/domain/src/schemas.ts` parses
  every document on read (`repository.parseOrThrow`). A parse failure is a
  500 `STORE_SCHEMA_VIOLATION`, never a silent coercion.
- **Additive-only rule for v1.1.** `dateAddedEdited` (REQ-059) and
  `runtimeMinutes` (REQ-035/037) are already modelled and unused, so the two
  deferred features are additive, not migrations.
- If a breaking change ever becomes necessary, the procedure is: add the new
  optional field → dual-write → backfill by a one-off script run manually from
  a developer machine → make it required. **A backfill script MUST NOT delete
  anything** (I-7) and MUST NOT run on a schedule (REQ-041).

---

## 14. Open questions

| OQ | Disposition |
|---|---|
| **OQ-015** | **CLOSED here** (SD-01, §2.3) |
| **OQ-013** | **CLOSED here** (SD-02, §7.4) |
| **OQ-022** | **CLOSED here** (§11) |
| OQ-011 | Narrowed by `specs/ui.md` §5 / `specs/ux-states.md` §4; the numeric interaction budget remains open |
| OQ-014 | Accessibility answered provisionally in `specs/ui.md` §10 (SD-12); performance, availability and i18n remain open |
| OQ-023 | v1.1 only; untouched |
| OQ-024 | Untouched — `specs/ai.md` §8 specifies behaviour under both answers without assuming either |
| **OQ-025 (new)** | ~~No user-controlled backup or export exists.~~ **NARROWED (R3):** the store is now PostgreSQL Flexible Server with **35-day point-in-time restore** included, so an accidental destructive change is recoverable by the owner's operator within 35 days. What is still missing is a *user-controlled* export the owner can hold themselves, and PITR does not survive subscription loss. Severity **medium → low-medium**. Owner: the owner, post-v1. |
| **OQ-026 (A41)** | **CLOSED at `A40`: the owner selected Variant A (~$11–13/mo).** The closing mechanism was the per-component cost table in `artifacts/architecture.md` §Cost summary. This document's only cost-relevant content is that the store is now a paid **Azure SQL Basic** database (~$5/mo prod + ~$0.50/mo serverless staging) rather than PostgreSQL B1ms (~$15/mo) or a free tier. |


---

## 15. THE RELATIONAL MODEL (REVISION 3 — AUTHORITATIVE)

> **Added 2026-08-10T21:45 after constraint change A41/CC-002.** This
> chapter is the authoritative physical model. Where it disagrees with §1,
> the physical framing of §3, §5.4, §7.3, §10 or §13, **this chapter wins**.
> Decision and full reasoning: **ADR-0005 Revision 2**.

### 15.0 Why this chapter exists

Revision 1 chose Cosmos DB for NoSQL on a free tier. Its deciding objection
to a relational store was that Azure SQL's free offer depends on
**serverless auto-pause**, so a resume stall would stack on top of a
container cold start and land directly on `SUC-001`. When `NFR-012` was
relaxed at A41, that objection lost its subject: auto-pause is a property
of the *free offer*, not of relational databases. Re-argued on
data-model and operational merits — and honestly, since Rev 1's own
"Negative consequences" already listed "no referential integrity, no
uniqueness constraints, invariants enforced only by application code and
tests" — the relational store wins for this product.

Three concrete gains, each of which shows up below:

1. **The invariants that actually corrupt this data become constraints**
   (§15.4). I-1 in particular is the one that silently splits a work in
   two, and it is now a partial unique index.
2. **Batch close becomes one transaction** (§15.5), deleting the
   visibility-flag protocol and the query predicate every future reader
   would have had to remember (`REQ-005`/`REQ-006`).
3. **`NFR-004`.** The implementer is an autonomous coding agent. Node +
   TypeScript + Prisma + PostgreSQL is one of the most heavily represented
   combinations in existence; `@azure/cosmos` with a `type`-discriminated
   single container is not.

### 15.1 The server

| | |
|---|---|
| Service | Azure Database for PostgreSQL **Flexible Server** |
| Tier / SKU | **Burstable B1ms** (1 vCPU, 2 GiB) |
| Storage | 32 GiB (the smallest step; the data is megabytes) |
| Version | **PostgreSQL 16** |
| High availability | **None.** Single zone, no replica. One user (§15.9) |
| Backup | **35-day point-in-time restore**, locally redundant |
| Auth | **Microsoft Entra only.** Password authentication **disabled** |
| Network | Public endpoint, TLS required, "allow Azure services" only. No VNet, no private endpoint (ADR-0003 R2.5) |
| Extensions | `pg_trgm` only. **`pg_cron` MUST NOT be installed** (§15.7) |
| Databases | `nextup` (production) and `nextup_staging` |
| Client | **Prisma** (`@prisma/client`), one `PrismaClient` per process |

**There is no connection string and no password anywhere.** The app obtains
an Entra access token from its managed identity and presents it as the
password. The token expires, so the connection factory MUST refresh it —
`TASK-141`. A naive implementation works for roughly an hour and then
fails in production, which is exactly the class of defect an autonomous
implementer ships and nobody notices until the next morning.

### 15.2 Conventions

- **Tables and columns are `snake_case`; TypeScript stays `camelCase`.**
  Prisma `@map` / `@@map` bridges them. One convention per side, no
  hand-written translation layer.
- **`owner_id text NOT NULL` on every table**, `owner_id` **first** in
  every index, and the **first positional parameter of every repository
  function** (`NFR-008`). Cosmos made a cross-owner read structurally
  expensive; a column does not, so `T-SEC-*` owner-scoping tests move
  from belt-and-braces to load-bearing. `T-INV-014` (new) asserts every
  table has the column and every index leads with it.
- **Identifiers stay ULIDs in `text` columns**, not `bigserial` and not
  `uuid`. They are already emitted, already referenced by provenance, and
  already deterministic where §1 required determinism for retry
  idempotency (that rule is unchanged — a retried batch **upserts**).
- **Timestamps are `timestamptz`**, always UTC. Date-only values
  (`date_added`) are `date`. The API still serialises both as strings in
  the formats §3 specifies.
- **`jsonb` is used in exactly three places** and nowhere else:
  `extraction_candidate.match_candidates`, `uploaded_image.bounding_boxes`,
  and `upload_batch.extraction_stats`. These are genuinely
  document-shaped, are never filtered on, and normalising them would buy
  nothing. **Any fourth use of `jsonb` is a review finding** — it is the
  obvious way to smuggle the old document model back in.
- **`genres` is `text[]`.** `[]` still means "TMDB carries no genre" and is
  still never defaulted (US-019 AC-6).

### 15.3 Tables

Nine tables. The DDL below is normative; the Prisma schema is generated
from it and MUST match.

```sql
-- Enums mirror the TypeScript unions in §3.1 exactly.
CREATE TYPE title_state    AS ENUM ('active', 'removed');
CREATE TYPE match_state    AS ENUM ('matched', 'unmatched');
CREATE TYPE listing_state  AS ENUM ('active', 'removed');
CREATE TYPE service        AS ENUM ('netflix', 'prime');
CREATE TYPE media_type     AS ENUM ('movie', 'tv');
CREATE TYPE batch_status   AS ENUM ('draft','extracting','review','applied','undone','failed');
CREATE TYPE batch_mode     AS ENUM ('append_only', 'full_update');
CREATE TYPE change_kind    AS ENUM ('title_created','listing_added','listing_removed','attr_modified');

CREATE TABLE title (
  id                   text PRIMARY KEY,
  owner_id             text        NOT NULL,
  work_identity        text        NOT NULL,
  state                title_state NOT NULL,   -- DERIVED, §5.1
  match_state          match_state NOT NULL,
  raw_extracted_text   text,
  normalised_text      text,
  created_by_batch_id  text        REFERENCES upload_batch(id),
  sort_date_added      date,                   -- DERIVED, §5.2
  -- TMDB metadata, flattened from §3.4 (one-to-one, never queried alone)
  tmdb_id              integer,
  tmdb_media_type      media_type,
  tmdb_name            text,
  tmdb_release_year    integer,
  tmdb_runtime_minutes integer,
  tmdb_genres          text[]      NOT NULL DEFAULT '{}',
  tmdb_poster_path     text,
  tmdb_fetched_at      timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT title_match_coherent CHECK (
    (match_state = 'matched'   AND tmdb_id IS NOT NULL
        AND work_identity LIKE 'tmdb:%' AND raw_extracted_text IS NULL)
 OR (match_state = 'unmatched' AND tmdb_id IS     NULL
        AND work_identity NOT LIKE 'tmdb:%' AND raw_extracted_text IS NOT NULL)
  )
);

CREATE TABLE service_listing (
  listing_id          text PRIMARY KEY,
  owner_id            text          NOT NULL,
  title_id            text          NOT NULL REFERENCES title(id) ON DELETE CASCADE,
  service             service       NOT NULL,
  state               listing_state NOT NULL,
  date_added          date          NOT NULL,   -- WRITE-ONCE, REQ-030
  date_added_edited   boolean       NOT NULL DEFAULT false,  -- v1.1, always false in v1
  removed_at          timestamptz,
  removed_by_batch_id text          REFERENCES upload_batch(id),
  removed_by_group_id text          REFERENCES removal_group(id),
  created_by_batch_id text          NOT NULL REFERENCES upload_batch(id),
  CONSTRAINT listing_removal_coherent CHECK (
    (state = 'removed' AND removed_at IS NOT NULL)
 OR (state = 'active'  AND removed_at IS NULL)
  )
);

CREATE TABLE suppression (
  id            text PRIMARY KEY,
  owner_id      text        NOT NULL,
  work_identity text        NOT NULL,
  active        boolean     NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  lifted_at     timestamptz
);

CREATE TABLE upload_batch (
  id                  text PRIMARY KEY,
  owner_id            text         NOT NULL,
  mode                batch_mode   NOT NULL,
  service             service      NOT NULL,
  status              batch_status NOT NULL,
  submitted_at        timestamptz,
  completed_at        timestamptz,
  extraction_stats    jsonb,
  failure_reason      text,
  created_at          timestamptz  NOT NULL DEFAULT now()
);

-- Replaces the three provenance JSON arrays of §3.7 with rows.
CREATE TABLE batch_change (
  id           bigserial PRIMARY KEY,
  owner_id     text        NOT NULL,
  batch_id     text        NOT NULL REFERENCES upload_batch(id),
  kind         change_kind NOT NULL,
  title_id     text        REFERENCES title(id),
  listing_id   text        REFERENCES service_listing(listing_id),
  attr         text,        -- set iff kind = 'attr_modified'
  prev_value   jsonb,       -- pre-batch value, REQ-068
  next_value   jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE removal_group (
  id           text PRIMARY KEY,
  owner_id     text        NOT NULL,
  batch_id     text        NOT NULL REFERENCES upload_batch(id),
  undone_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE uploaded_image (
  id             text PRIMARY KEY,
  owner_id       text        NOT NULL,
  batch_id       text        NOT NULL REFERENCES upload_batch(id),
  blob_path      text        NOT NULL,
  retain_until   timestamptz NOT NULL,   -- set ONCE at upload, NFR-019
  bounding_boxes jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE extraction_candidate (
  id               text PRIMARY KEY,     -- deterministic, §1 rule retained
  owner_id         text        NOT NULL,
  batch_id         text        NOT NULL REFERENCES upload_batch(id),
  source_image_id  text        NOT NULL REFERENCES uploaded_image(id),
  raw_text         text        NOT NULL,
  normalised_text  text        NOT NULL,
  match_candidates jsonb,
  resolved_title_id text       REFERENCES title(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_state (
  owner_id                 text    NOT NULL,
  service                  service NOT NULL,
  last_completed_batch_at  timestamptz,
  PRIMARY KEY (owner_id, service)
);
```

**Two shape changes deserve calling out, because they are improvements the
document model could not express:**

- **`service_listing` is a real table**, not an array embedded in `title`.
  §3.3 already treated it as an entity with a stable `listingId` that
  provenance references by id — a foreign key is what that *meant*. The
  removed view (§11) is now a plain query over removed listings instead of
  an unnest of every title's array.
- **`batch_change` replaces `provenance.{created,modified,removed}[]`**.
  Creates-only undo (SD-03) becomes
  `DELETE FROM title WHERE id IN (SELECT title_id FROM batch_change WHERE batch_id = $1 AND kind = 'title_created')`
  inside the one permitted delete module, instead of array surgery on a
  document. The refusal enumeration (§8.4, REQ-075) becomes a `GROUP BY
  kind`. **SD-03's discard-not-soft-remove decision is unchanged.**

### 15.4 Invariants — now constraints (supersedes §5.4)

| ID | Invariant | R3 enforcement | Test |
|---|---|---|---|
| **I-1** | At most one `title` per `(owner_id, work_identity)` with `state <> 'removed'` | **`CREATE UNIQUE INDEX title_one_active_per_work ON title (owner_id, work_identity) WHERE state <> 'removed';`** — a partial unique index. *(The `visible` half of the Rev 1 predicate is gone with the flag.)* | `T-INV-001` — now asserts the **database** raises `23505` |
| **I-2** | At most one `service_listing` per `(title_id, service)` | **`CREATE UNIQUE INDEX listing_one_per_service ON service_listing (title_id, service);`** | `T-INV-002` |
| **I-9** | At most one **active** `suppression` per `(owner_id, work_identity)` | **`CREATE UNIQUE INDEX suppression_one_active ON suppression (owner_id, work_identity) WHERE active;`** (ADR-0007's uniqueness requirement, previously carried by a synthetic document id) | `T-INV-015` (new) |
| **I-3** | Every `title` has at least one listing | Application — a table cannot require a child row without a deferred trigger, and a trigger is more machinery than the rule is worth | `T-INV-003` |
| **I-4** | `state` and `sort_date_added` equal what `derive.ts` computes | Application (§5) — derived values stay in one TypeScript function; a generated column would split the logic across two languages | `T-INV-010` |
| **I-5** | `match_state = 'matched'` ⟺ `tmdb_id IS NOT NULL` ⟺ `work_identity LIKE 'tmdb:%'` | **`CHECK` constraint `title_match_coherent`** (§15.3) | `T-INV-011` |
| **I-6** | `date_added` never changes after creation | Application + the `T-INV-006` source grep. *(Deliberately not a trigger: the grep names the offending line, a trigger names a row.)* | `T-INV-006` |
| **I-7** | Nothing is hard-deleted except by creates-only undo (§8.3) | Application — `DELETE` and `deleteMany` appear in **exactly one module**, asserted by grep | `T-INV-012` |
| **I-8** | ~~No Cosmos TTL~~ **No mechanism exists that could expire or schedule deletion of list data** | §15.7 | `T-INV-013` (rewritten) |

**I-1 still permits acknowledged duplicates.** US-025 AC-5 and US-030 AC-4
let the owner confirm a second active row for the same work — and a partial
unique index would refuse it. The reconciliation is unchanged in spirit and
explicit in the schema: those two paths write `work_identity` with the
`dup:<ulid>:` prefix the normalisation function already reserves for
acknowledged duplicates, so the row is a distinct work identity by
construction and the constraint holds. `createTitleAllowingDuplicate()`
is the only function permitted to apply that prefix; every other path calls
`createTitle()`, which now surfaces the database's `23505` as
`DuplicateWorkIdentityError`. **`T-INV-016` (new) asserts the prefix is
applied nowhere else.**

### 15.5 Batch close is one transaction (supersedes and deletes §7.3)

```
BEGIN;
  INSERT titles + service_listings created by the batch
  UPDATE service_listing SET state='removed', removed_at, removed_by_batch_id,
         removed_by_group_id  -- ticked removals only (REQ-023, REQ-027)
  INSERT removal_group (if the batch removes anything)
  INSERT batch_change rows (REQ-068)
  UPDATE upload_batch SET status='applied', completed_at
  UPSERT service_state.last_completed_batch_at (REQ-039)
COMMIT;
```

That is the whole mechanism. `REQ-005` and `REQ-006` are guaranteed by the
database: **before `COMMIT` nothing exists; after it, everything does.**
There is no `visible` column, no second pass, and no predicate for a future
query to forget.

- **Isolation:** `READ COMMITTED` (the default) is sufficient. There is one
  writer and one user; `SERIALIZABLE` would add retry handling for a
  contention that cannot occur.
- **Statement timeout:** 30 s on the close transaction. A bulk first import
  of a few hundred titles is well inside it; exceeding it is a defect, and
  failing loudly beats a half-hour lock on a 1-vCPU server.
- **Retry after crash is an upsert**, using the deterministic ids of §1
  which are retained precisely for this. A rolled-back transaction plus
  deterministic ids means a retry is safe by two independent mechanisms.
- **`T-BATCH-005` is rewritten**: kill the process mid-close and assert the
  list is **byte-identical to its pre-close state**, and that a retry then
  produces exactly one copy of everything.

### 15.6 Indexing and pagination (supersedes §10)

```sql
CREATE INDEX title_list_default ON title (owner_id, state, sort_date_added DESC, id ASC);
CREATE INDEX listing_removed_view ON service_listing (owner_id, removed_at DESC, listing_id ASC)
  WHERE state = 'removed';
CREATE INDEX listing_by_title ON service_listing (owner_id, title_id);
CREATE INDEX batch_change_by_batch ON batch_change (owner_id, batch_id, kind);
CREATE INDEX candidate_by_batch ON extraction_candidate (owner_id, batch_id);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX title_name_trgm ON title USING gin (tmdb_name gin_trgm_ops);
CREATE INDEX title_norm_trgm ON title USING gin (normalised_text gin_trgm_ops);
```

**Pagination is keyset, not offset.** `OFFSET` degrades linearly with
history size and would quietly break exactly the `NFR-018` claim this
section exists to defend. The cursor is
`base64url(JSON.stringify({ sortDateAdded, id }))` for the combined list and
`base64url(JSON.stringify({ removedAt, listingId }))` for the removed view;
the query is `WHERE (sort_date_added, id) < ($cursorDate, $cursorId)`. The
cursor is **opaque to clients** and its contents are an implementation
detail (`specs/api.md` §3). Ordering and tie-breakers are unchanged from
§5.3 — the tie-breaker is what makes a keyset cursor total, so it is now
load-bearing rather than merely tidy.

**Default page size 50; maximum 200** — unchanged.

**`T-PERF-001` is rewritten**: seed 20,000 removed listings, and assert via
`EXPLAIN (ANALYZE, BUFFERS)` that the first page is an **index scan** whose
rows-read is bounded by the page size, and that no plan node is a
sequential scan on `service_listing`. That is a stronger and more stable
assertion than the Rev 1 "within 3× the RU charge", which was a proxy.

### 15.7 SD-04, restated for PostgreSQL (supersedes the Cosmos wording of §9)

`REQ-028` says nothing in the list data ever disappears. The strongest form
of that guarantee is that **the machinery capable of violating it is not
present**:

1. **No `pg_cron`.** The extension MUST NOT be installed on the server.
   `T-INFRA-005` asserts the Bicep does not enable it and that
   `pg_available_extensions`-based enablement is absent.
2. **No `DELETE` triggers, no `ON DELETE CASCADE` from anything the owner
   can reach.** The one cascade in §15.3 is `service_listing → title`, and
   it fires only from the single permitted delete path (creates-only undo,
   SD-03), where cascading is the intended behaviour.
3. **No scheduled job of any kind** in the deployment (architecture
   §Environments). The only scheduled thing in the product remains the
   blob lifecycle rule, which deletes image bytes (`NFR-019`) and never
   touches the database.
4. **`DELETE`/`deleteMany` appear in exactly one module**, asserted by
   grep (`T-INV-012`).
5. **No `TRUNCATE`, ever, including in migrations** (§15.8).

`T-INV-013` is rewritten to assert items 1, 2, 4 and 5 by static analysis
of the migrations directory and the source tree.

### 15.8 Migrations (supersedes §13)

- **Prisma Migrate.** Migrations are checked-in SQL, reviewed like code,
  and applied by `prisma migrate deploy` in the deploy workflow —
  **staging first, production second** (architecture §Environments).
- **`prisma migrate dev` and `prisma db push` MUST NOT run against any
  Azure database.** They are local-only.
- **Destructive migrations fail CI.** A new check greps every file in
  `prisma/migrations/**` for `DROP TABLE`, `DROP COLUMN`, `TRUNCATE` and
  `DROP TYPE`, and fails the build on a match. `REQ-028` forbids losing
  data, and a migration is the one place an autonomous implementer could
  lose it quietly and irreversibly — Prisma will cheerfully generate a
  `DROP COLUMN` from a renamed field. **This is `T-MIG-001` (new) and it
  is the single most valuable test this chapter adds.**
- **Additive-only rule for v1.1 is unchanged.** `date_added_edited`
  (REQ-059) and `tmdb_runtime_minutes` (REQ-035/037) are already columns,
  so both deferred features are additive.
- **Zod's role changes.** It validates API requests
  (`specs/api.md`) and external payloads (TMDB, the extractor). It is **no
  longer the storage schema** — the database is. `repository.parseOrThrow`
  is deleted; Prisma's generated types are the read contract.
  `STORE_SCHEMA_VIOLATION` as a 500 is retained only for the `jsonb`
  columns, which are the only place the database does not check shape.

### 15.9 What this deliberately does NOT include

Stated so a reader does not mistake omission for oversight. `NFR-012`'s
relaxation is not a licence to over-build (architecture §Driving forces
F1b), and this is a **single-user** application (`NFR-017`) with one bulk
import and a few small top-ups a month:

| Not included | Why |
|---|---|
| HA replica / zone redundancy | Roughly doubles the bill to protect a single-user watchlist from an outage that is a few hours of inconvenience. 35-day PITR covers the failure that actually loses data. |
| Read replica | One user. There is no read load. |
| Connection pooler (PgBouncer) | One process, one `PrismaClient`, pool size ~5. B1ms allows far more. |
| Table partitioning | Thousands of rows, forever. |
| Row-level security | Genuinely tempting for `NFR-008` — and rejected: it needs per-request session variables that interact awkwardly with a pooled Prisma client, and it would be a second, subtler enforcement path an autonomous implementer must keep correct. `owner_id` first in every function signature, plus tests, is the one obvious path. **Recorded as the leading candidate should `NFR-001`'s multi-owner path ever be taken.** |
| Materialised views | The list query is an index scan over a few thousand rows. |
| A second `jsonb` escape hatch | See §15.2. |

### 15.10 Migration from the Cosmos design

**There is none, and that is the point.** No Cosmos account was ever
provisioned; the change lands entirely in unwritten code. Had this decision
arrived after implementation it would have been expensive — which is the
argument for re-examining decisions the moment their premise is repealed,
rather than at the next convenient milestone.


---

## 16. THE AZURE SQL MODEL (REVISION 4 — AUTHORITATIVE)

> **Added after the owner selected Variant A at `A40`.** This chapter is
> the authoritative physical model. Where it disagrees with §15 (the R3
> PostgreSQL chapter) or any earlier physical framing, **this chapter
> wins**. Decision and full reasoning: **ADR-0005 Revision 3**. §15 is
> retained, unedited, so the PostgreSQL reasoning stays visible.

### 16.0 What changed from §15, and what did not

**Unchanged (still binding, verbatim from §15):** every domain rule; the
nine-table logical model; the three invariants I-1/I-2/I-9 as *database
constraints*; batch close as one transaction (§15.5); keyset pagination;
SD-04's "no scheduled deletion mechanism exists"; the additive-only
migration rule; `owner_id` first everywhere; ULID text ids; Prisma as the
client.

**Changed (this chapter):** the SKU (PostgreSQL B1ms → **Azure SQL
Database Basic, 5 DTU, 2 GB**); the Prisma provider (`postgresql` →
**`sqlserver`**); physical types; the three partial unique indexes become
**filtered unique indexes**; `pg_trgm` search becomes **`LIKE`**;
migration tooling stays Prisma Migrate but with SQL-Server DDL; PITR 35 →
**7 days**; auth prefers managed identity but has a defined SQL-auth
fallback; **`RSK-031`** is raised (Prisma + SQL Server is less-travelled).

### 16.1 The server

| | |
|---|---|
| Service | **Azure SQL Database** (single database, not Managed Instance) |
| Tier / SKU (prod) | **Basic — 5 DTU, 2 GB max size** |
| Tier / SKU (staging) | **General Purpose serverless, 0.5 vCore min, auto-pause enabled** (ADR-0003 R3.3). Azure SQL bills **per database**, so staging is ~$0.50/mo storage-floor, not the $0 the shared-PG server gave |
| Version | Azure SQL (evergreen; `Microsoft SQL Server 2022`-compatible surface) |
| High availability | **None.** No zone redundancy, no geo-replica, no failover group. One user (§16.9) |
| Backup | **7-day point-in-time restore** (Basic max; was 35-day on PG — see §16.11). LTR NOT configured (escalation only) |
| Auth | **Prefer Microsoft Entra / managed identity (secretless).** Defined fallback: a contained SQL login whose password lives in Key Vault (§16.1.1). A SQL login password does **not** silently expire |
| Network | Public endpoint, `Encrypt=true; TrustServerCertificate=false`, "Allow Azure services" only. No VNet, no private endpoint (ADR-0003 R2.5 stands) |
| Extensions | **None.** SQL Server has no extension model. `pg_trgm` and `pg_cron` are simply not concepts here (§16.7) |
| Databases | `nextup` (production) and `nextup_staging` (separate serverless DB) |
| Client | **Prisma** (`@prisma/client`, provider `sqlserver`), one `PrismaClient` per process |

#### 16.1.1 Connection and auth (RSK-031 mitigation)

The connection string form is **fixed** so an autonomous implementer does
not improvise it:

```
sqlserver://<server>.database.windows.net:1433;database=nextup;user=<app>;password=<kv-ref>;encrypt=true;trustServerCertificate=false;connectionLimit=5
```

- **Preferred: managed identity (secretless).** The Prisma `sqlserver`
  connector's token/MI support is **less established than PostgreSQL's** —
  this is the concrete `RSK-031` gap. It is **not** assumed to work: `M0`
  runs a smoke migration + `SELECT 1` round-trip against a real Azure SQL
  Basic instance **before any feature work** (`TASK-141`, reshaped). If MI
  auth proves workable through Prisma, the string carries no password.
- **Fallback (proven-safe): SQL authentication.** A least-privilege
  contained user (`nextup_app`, `db_datareader` + `db_datawriter` + EXECUTE
  on the one delete proc, **not** `db_owner`) whose password is stored in
  Key Vault and surfaced as a Key-Vault-referenced Container Apps secret.
  Unlike the ghcr.io PAT, **a SQL login password does not auto-expire**, so
  it is not a silent time bomb — rotation is a deliberate act, not a
  deadline. `TASK-141` decides MI-vs-fallback at `M0`, not at feature time.
- `connectionLimit=5` — one process, one user; Basic tolerates more but 5
  is ample and bounds the 30-worker-less footprint.

### 16.2 Conventions (deltas from §15.2)

- **Tables/columns `snake_case`, TypeScript `camelCase`**, bridged by
  Prisma `@map`/`@@map`. Unchanged.
- **`owner_id NVARCHAR(200) NOT NULL` on every table, first in every
  index, first parameter of every repository function** (`NFR-008`).
  Unchanged in spirit; `T-INV-014` still applies.
- **Identifiers stay ULIDs in `NVARCHAR(200)` columns** — **NOT
  `UNIQUEIDENTIFIER`.** ULIDs are 26-char Crockford base32, not GUIDs;
  storing them as `UNIQUEIDENTIFIER` would corrupt them. They remain
  deterministic where retry-idempotency requires it (§15.5 upsert rule).
- **Timestamps are `DATETIME2(3)`**, always UTC; the DB default is
  **`SYSUTCDATETIME()`** (not `now()`, which in T-SQL is local civil time —
  a real trap). Date-only values are `DATE`.
- **Booleans are `BIT`** (`1`/`0`). Filtered-index predicates use `= 1`.
- **The three `jsonb` columns and the `genres` array become
  `NVARCHAR(MAX)` + `CHECK (ISJSON(col) = 1)`.** `genres` defaults to
  `'[]'`; the three document columns are nullable exactly as before. **Any
  fourth `NVARCHAR(MAX)`-JSON column is a review finding** — same guard as
  §15.2, restated for the new type.
- **Enums become `NVARCHAR(n) + CHECK (col IN (...))`.** SQL Server has no
  `CREATE TYPE ... AS ENUM`; Prisma maps `enum` to a checked string column
  on `sqlserver`. Values are byte-identical to the §15.3 unions.

#### 16.2.1 Collation (the one genuinely new decision)

PostgreSQL compared text case-sensitively and byte-exactly by default,
which is what the identity invariants rely on. SQL Server databases are
**case-insensitive by default** — which would silently merge
`work_identity` values that must stay distinct. Therefore:

- **The DATABASE ITSELF is created `COLLATE Latin1_General_100_BIN2`.**
  ⚠ This is a property of `CREATE DATABASE`, not of the migration, so it
  must be set by whatever provisions the database — the Bicep
  (`collation` on `Microsoft.Sql/servers/databases`) and the CI/test
  harness alike. It cannot be retrofitted from inside the migration:
  `ALTER DATABASE ... COLLATE` needs exclusive access to the database the
  migration is already connected to.

  **This is required for Prisma to function at all, not merely for
  correctness.** Prisma's `create()` emits
  `DECLARE @generated_keys table([id] NVARCHAR(200))` and then joins that
  table variable back to the real row: `... INNER JOIN [t] ON [t].[id] =
  [g].[id]`. A table variable takes the **database default** collation,
  so if the database is `SQL_Latin1_General_CP1_CI_AS` while `[t].[id]`
  is `BIN2`, that join is a column-to-column collation conflict and every
  single `create()` fails with **`Msg 468`**. Verified by execution: with
  the default collation, 24 of 25 integration tests failed; with
  `Latin1_General_100_BIN2`, all passed. `T-INV-018` asserts it.

- **Identity/key columns** (`work_identity`, `owner_id`, all `*_id`) are
  *additionally* declared **`COLLATE Latin1_General_100_BIN2`**
  explicitly — binary, case- and accent-sensitive. This is redundant
  once the database default is BIN2 and is kept deliberately: it keeps
  the guarantee visible at the column that depends on it, and it survives
  a database being restored or recreated with the wrong default.
- **Search columns** (`tmdb_name`, `normalised_text`) are stored in the
  DB's default collation but **searched with an explicit per-query
  `COLLATE Latin1_General_100_CI_AI`** so the removed-view search stays
  forgiving of case and accents. ⚠ With the database default now BIN2,
  that per-query `COLLATE` is **load-bearing rather than cosmetic**:
  without it, search is byte-exact and a lowercase query silently matches
  nothing.

~~Superseded (Revision 5): the database default collation was left
unspecified, and only individual columns carried `BIN2`. That combination
does not work — see `Msg 468` above.~~

### 16.3 Tables (T-SQL DDL — normative; supersedes §15.3)

> ⚠ **Revision 5 (2026-08-12). This DDL was previously NOT EXECUTABLE.** It was
> extracted verbatim and run against `mcr.microsoft.com/mssql/server:2022-latest`
> (16.0.4265.3); the published form created **0 of 9 tables**. Every correction
> below was verified by execution, not by reading. The full record, including
> the reproduction, is `docs/task-017-schema-findings.md`.
>
> **A. Defects that stopped it working**
>
> | # | Defect | Correction |
> |---|---|---|
> | **E-1** | `title` referenced `upload_batch`, and `service_listing` referenced `removal_group`, **before either existed** — `Msg 1767`, nothing created. | Tables are now in dependency order. **Do not re-alphabetise them.** |
> | **E-2** | 7 FK columns omitted the `Latin1_General_100_BIN2` collation §16.2.1 mandates, so every FK failed with `Msg 1757` (collation mismatch). | Collation added to all 7. **Every `*_id` column carries it, without exception.** |
> | **E-3** | `ISJSON(x) = 1` returns **0 for a JSON scalar** (verified: `ISJSON('"tmdb:tv:1"')` → 0). `batch_change.prev_value`/`next_value` hold scalars, so the commonest provenance write was rejected — and because batch close is one transaction, **the whole close rolled back**. | `ISJSON(x, VALUE) = 1` on those two columns only. Verified supported on SQL Server 2022. |
>
> **B. Enum-value corrections (Revision 4, retained)** — each compiled and
> deployed cleanly, then rejected legitimate writes at **runtime**:
>
> | Column | Was | Now | Why the old value was wrong |
> |---|---|---|---|
> | `service` (×3) | `'netflix','prime'` | `'netflix','max'` | The spine services are Netflix and **Max** (`REQ-002`, `REQ-053`). `BRD.md` names Prime Video as one of the seven **non-spine** services that are out of scope. The old list rejected every Max listing. |
> | `mode` | `'append_only','full_update'` | `'append-only','full-update'` | Hyphenated everywhere else in the corpus (127 uses vs 7) and in `BATCH_MODES`. §16.2 requires values "byte-identical to the §15.3 unions". |
> | `status` | 6 values, incl. `'review'`, `'failed'` | 8 values | §3 (ll. 313–319) and the state machine (l. 943) both define **eight**. `'submitted'`, `'extraction-failed'`, `'in-review'` and `'discarded'` are all reachable and were unrepresentable. |
> | `status` width | `NVARCHAR(16)` | `NVARCHAR(24)` | A consequence of the row above: `'extraction-failed'` is **17 characters** and would not fit. Every other enum column was re-audited against its longest permitted value and is correctly sized. |
>
> **C. Owner decisions applied** (`docs/task-017-schema-findings.md` §2):
>
> | # | Change |
> |---|---|
> | **D-1** | `listing_one_per_service` is now **filtered** on `state = 'active'` and leads with `owner_id` (§16.4). Unfiltered it made a service reappearance permanently impossible, because the soft-deleted row occupies the pair forever. |
> | **D-2** | `title.duplicate_ack_seq` added. It replaces the `dup:<ulid>:` identity prefix, which `WORK_IDENTITY_RE` and `title_match_coherent` both reject, and which would have **silently broken suppression** (keyed on canonical work identity, REQ-071). ⚠ Its sentinel is `''`, **never `NULL`** — SQL Server treats two `NULL`s as *equal* in a unique index. |
> | **D-3** | `candidate_source_image` added, replacing the singular `extraction_candidate.source_image_id`. Intra-batch collapse makes this many-to-many (§4, SD-02, `T-AI-007`). Ten physical tables, still nine logical entities. |
> | **D-4** | `upload_batch` gains `degraded_extraction`, `low_yield`, `cross_check`. Both of the first two force `computeRemovals: false` — the invariant that a failed extraction must never be misread as a removal. Extraction and review are **separate requests**, so an unpersisted flag loses the reason removals were withheld. |
>
> **D. Columns added from §3** — these fields are queried, sorted or mutated by
> the API and had no column at all. Types are taken from the CI-tested
> `packages/domain/src/types.ts`, which is authoritative for field shape.
> `bounding_boxes` **moved** from `uploaded_image` to `extraction_candidate`
> (a box belongs to a candidate; `BoundingBox` carries its own `imageId`).
> `upload_batch.failure_reason` is **replaced** by the structured
> `extraction_error_*` triple matching `ExtractionError`.
>
> **E. Two timestamps renamed** to match their `types.ts` names exactly, because
> a silent semantic mapping is the kind of thing that gets implemented backwards:
> `uploaded_image.created_at` → **`uploaded_at`** (`retainUntil` is derived from
> it), and `suppression.created_at`/`lifted_at` → **`suppressed_at`**/
> **`unsuppressed_at`**.
>
> ~~§15.3 and Revisions 1–4 of this section are superseded and retained only as
> historical record. Do not build from them: they name `'prime'`,
> `'append_only'`, a singular `source_image_id`, an unfiltered
> `listing_one_per_service`, and a table order that does not execute.~~

The Prisma schema (`provider = "sqlserver"`) is generated to match. Enums
are modelled as checked `NVARCHAR`; the CHECK/filtered-index DDL that
Prisma cannot express lives in **raw migration SQL** (§16.8).

```sql
-- No CREATE TYPE: enums are NVARCHAR + CHECK (values identical to §3 / enums.ts).
-- ⚠ TABLE ORDER IS LOAD-BEARING (E-1). Each table references only tables above it.

CREATE TABLE upload_batch (
  id                     NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
  owner_id               NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  mode                   NVARCHAR(16)  NOT NULL CONSTRAINT ck_batch_mode    CHECK (mode IN ('append-only','full-update')),
  service                NVARCHAR(16)  NOT NULL CONSTRAINT ck_batch_service CHECK (service IN ('netflix','max')),
  status                 NVARCHAR(24)  NOT NULL CONSTRAINT ck_batch_status
                           CHECK (status IN ('draft','submitted','extracting','extraction-failed','in-review','applied','undone','discarded')),
  -- US-034 AC-3: set for re-extraction batches. Self-reference, so it is
  -- declared here and the FK is added by ALTER after the table exists.
  derived_from_batch_id  NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NULL,
  submitted_at           DATETIME2(3),
  extraction_started_at  DATETIME2(3),
  completed_at           DATETIME2(3),
  undone_at              DATETIME2(3),
  extraction_stats       NVARCHAR(MAX) CONSTRAINT ck_batch_stats_json CHECK (extraction_stats IS NULL OR ISJSON(extraction_stats) = 1),
  -- Structured ExtractionError (replaces the free-text failure_reason).
  extraction_error_code  NVARCHAR(32)  NULL CONSTRAINT ck_batch_err_code
                           CHECK (extraction_error_code IS NULL OR
                                  extraction_error_code IN ('EXTRACTOR_UNAVAILABLE','EXTRACTOR_ERROR','IMAGES_PURGED')),
  extraction_error_message NVARCHAR(MAX) NULL,
  extraction_error_at    DATETIME2(3)  NULL,
  -- D-4. degraded_extraction and low_yield each force computeRemovals = false
  -- (specs/ai.md 2.2/8.2). They are SAFETY STATE, not statistics: do not
  -- recompute them on read.
  degraded_extraction    BIT           NOT NULL CONSTRAINT df_batch_degraded  DEFAULT 0,
  low_yield              BIT           NOT NULL CONSTRAINT df_batch_low_yield DEFAULT 0,
  cross_check            NVARCHAR(20)  NULL CONSTRAINT ck_batch_cross_check
                           CHECK (cross_check IS NULL OR cross_check IN ('ok','ocr-unavailable','llm-unavailable')),
  created_at             DATETIME2(3)  NOT NULL CONSTRAINT df_batch_created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT ck_batch_error_coherent CHECK (
    (extraction_error_code IS     NULL AND extraction_error_at IS     NULL)
 OR (extraction_error_code IS NOT NULL AND extraction_error_at IS NOT NULL)
  )
);

ALTER TABLE upload_batch ADD CONSTRAINT fk_batch_derived_from
  FOREIGN KEY (derived_from_batch_id) REFERENCES upload_batch(id);

CREATE TABLE title (
  id                   NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
  owner_id             NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  work_identity        NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  -- D-2. '' means "not an acknowledged duplicate". NEVER NULL: two NULLs
  -- compare EQUAL in a SQL Server unique index, so a nullable column would
  -- silently reject the second row it exists to permit.
  duplicate_ack_seq    NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL
                                     CONSTRAINT df_title_dup_seq DEFAULT '',
  state                NVARCHAR(16)  NOT NULL CONSTRAINT ck_title_state       CHECK (state IN ('active','removed')),
  match_state          NVARCHAR(16)  NOT NULL CONSTRAINT ck_title_match_state CHECK (match_state IN ('matched','unmatched')),
  raw_extracted_text   NVARCHAR(MAX),
  normalised_text      NVARCHAR(MAX),
  created_by_batch_id  NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NULL REFERENCES upload_batch(id),
  sort_date_added      DATE,
  tmdb_id              INT,
  tmdb_media_type      NVARCHAR(16)  CONSTRAINT ck_title_media_type CHECK (tmdb_media_type IN ('movie','tv')),
  tmdb_name            NVARCHAR(500),
  tmdb_release_year    INT,
  tmdb_runtime_minutes INT,
  tmdb_genres          NVARCHAR(MAX) NOT NULL CONSTRAINT df_title_genres DEFAULT '[]'
                                     CONSTRAINT ck_title_genres_json CHECK (ISJSON(tmdb_genres) = 1),
  tmdb_poster_path     NVARCHAR(400),
  tmdb_fetched_at      DATETIME2(3),
  created_at           DATETIME2(3)  NOT NULL CONSTRAINT df_title_created DEFAULT SYSUTCDATETIME(),
  updated_at           DATETIME2(3)  NOT NULL CONSTRAINT df_title_updated DEFAULT SYSUTCDATETIME(),
  CONSTRAINT title_match_coherent CHECK (
    (match_state = 'matched'   AND tmdb_id IS NOT NULL
        AND work_identity LIKE 'tmdb:%' AND raw_extracted_text IS NULL)
 OR (match_state = 'unmatched' AND tmdb_id IS     NULL
        AND work_identity NOT LIKE 'tmdb:%' AND raw_extracted_text IS NOT NULL)
  )
);

CREATE TABLE removal_group (
  id           NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
  owner_id     NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  batch_id     NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL REFERENCES upload_batch(id),
  undone_at    DATETIME2(3),
  created_at   DATETIME2(3)  NOT NULL CONSTRAINT df_group_created DEFAULT SYSUTCDATETIME()
);

CREATE TABLE service_listing (
  listing_id          NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
  owner_id            NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  title_id            NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL
                        REFERENCES title(id) ON DELETE CASCADE,
  service             NVARCHAR(16)  NOT NULL CONSTRAINT ck_listing_service CHECK (service IN ('netflix','max')),
  state               NVARCHAR(16)  NOT NULL CONSTRAINT ck_listing_state   CHECK (state IN ('active','removed')),
  date_added          DATE          NOT NULL,   -- WRITE-ONCE, REQ-030
  date_added_edited   BIT           NOT NULL CONSTRAINT df_listing_edited DEFAULT 0,
  removed_at          DATETIME2(3),
  removed_by_batch_id NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NULL REFERENCES upload_batch(id),
  removed_by_group_id NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NULL REFERENCES removal_group(id),
  created_by_batch_id NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL REFERENCES upload_batch(id),
  CONSTRAINT listing_removal_coherent CHECK (
    (state = 'removed' AND removed_at IS NOT NULL)
 OR (state = 'active'  AND removed_at IS NULL)
  )
);

CREATE TABLE batch_change (
  id           BIGINT IDENTITY(1,1) PRIMARY KEY,
  owner_id     NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  batch_id     NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL REFERENCES upload_batch(id),
  kind         NVARCHAR(24)  NOT NULL CONSTRAINT ck_change_kind
                 CHECK (kind IN ('title_created','listing_added','listing_removed','attr_modified')),
  title_id     NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NULL REFERENCES title(id),
  listing_id   NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NULL REFERENCES service_listing(listing_id),
  attr         NVARCHAR(100),
  -- ⚠ E-3: these hold JSON *scalars* (e.g. a previous workIdentity string).
  -- ISJSON(x) = 1 REJECTS a scalar; the VALUE argument is required. Verified.
  prev_value   NVARCHAR(MAX) CONSTRAINT ck_change_prev_json CHECK (prev_value IS NULL OR ISJSON(prev_value, VALUE) = 1),
  next_value   NVARCHAR(MAX) CONSTRAINT ck_change_next_json CHECK (next_value IS NULL OR ISJSON(next_value, VALUE) = 1),
  created_at   DATETIME2(3)  NOT NULL CONSTRAINT df_change_created DEFAULT SYSUTCDATETIME()
);

CREATE TABLE uploaded_image (
  id             NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
  owner_id       NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  batch_id       NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL REFERENCES upload_batch(id),
  blob_path      NVARCHAR(400) NOT NULL,
  -- (A45) file_name is DISPLAY ONLY and is NEVER used to compose blob_path.
  -- NOT NULL and non-empty for every source: a pasted image has no device name,
  -- so the server synthesises `pasted-YYYYMMDD-HHMMSS-NN.png` (§3.8.1).
  file_name      NVARCHAR(255) NOT NULL CONSTRAINT ck_image_file_name CHECK (LEN(LTRIM(RTRIM(file_name))) > 0),
  -- (A45) HOW the bytes arrived. Written once at ingest, never updated.
  -- 'upload' is the DEFAULT for backfill because every pre-A45 row arrived that way.
  ingest_source  NVARCHAR(16)  NOT NULL CONSTRAINT df_image_ingest_source DEFAULT 'upload'
                   CONSTRAINT ck_image_ingest_source CHECK (ingest_source IN ('paste','upload','drop')),
  -- What the DEVICE delivered, by MAGIC BYTES (never Content-Type). May be heic/heif.
  uploaded_format NVARCHAR(8)  NOT NULL CONSTRAINT ck_image_uploaded_format CHECK (uploaded_format IN ('png','jpeg','heic','heif')),
  -- What is actually STORED. HEIC/HEIF is transcoded to lossless PNG on ingest,
  -- so this is only ever png|jpeg (REQ-077).
  format         NVARCHAR(8)   NOT NULL CONSTRAINT ck_image_format CHECK (format IN ('png','jpeg')),
  -- Bytes as STORED (post-transcode). The 10 MiB ingest ceiling is enforced at
  -- the API boundary against the UPLOADED bytes, not here: a lossless PNG
  -- transcode of a compliant HEIC can legitimately exceed it.
  byte_size      BIGINT        NOT NULL CONSTRAINT ck_image_byte_size CHECK (byte_size > 0),
  -- What the DEVICE sent, before any transcode. Bounded here at 10 MiB because
  -- this column IS the upload, and it is the column the per-batch 60 MiB
  -- ceiling sums (api.md §5). Migration 0003 adds it and backfills from
  -- byte_size: every pre-migration row predates the transcode, so for those
  -- rows uploaded == stored is the true value, not a placeholder.
  uploaded_byte_size BIGINT    NOT NULL
                     CONSTRAINT ck_image_uploaded_byte_size CHECK (uploaded_byte_size > 0)
                     CONSTRAINT ck_image_uploaded_byte_size_ceiling CHECK (uploaded_byte_size <= 10485760),
  width          INT           NULL,
  height         INT           NULL,
  uploaded_at    DATETIME2(3)  NOT NULL CONSTRAINT df_image_uploaded DEFAULT SYSUTCDATETIME(),
  retain_until   DATETIME2(3)  NOT NULL,   -- set ONCE at upload, NFR-019 — IDENTICAL for pasted images
  -- NULL until extraction runs; 0 is MEANINGFUL and is not NULL (US-006 AC-3).
  candidate_count INT          NULL CONSTRAINT ck_image_candidate_count CHECK (candidate_count IS NULL OR candidate_count >= 0)
);

CREATE TABLE extraction_candidate (
  id                  NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
  owner_id            NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  batch_id            NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL REFERENCES upload_batch(id),
  raw_text            NVARCHAR(MAX) NOT NULL,
  inferred_title      NVARCHAR(500) NULL,
  basis               NVARCHAR(16)  NOT NULL CONSTRAINT ck_cand_basis    CHECK (basis IN ('text','artwork','both','unknown')),
  ocr_support         NVARCHAR(16)  NOT NULL CONSTRAINT ck_cand_ocr_sup  CHECK (ocr_support IN ('exact','partial','none','not-checked')),
  provider            NVARCHAR(16)  NOT NULL CONSTRAINT ck_cand_provider CHECK (provider IN ('llm','ocr-only')),
  -- BIN2: this is a GROUPING KEY (collapse/dedup), never a search target.
  -- Under a case-insensitive collation, two texts that must stay distinct
  -- would silently group together.
  normalised_text     NVARCHAR(MAX) COLLATE Latin1_General_100_BIN2 NOT NULL,
  extracted_year      INT           NULL,   -- MATCH HINT ONLY, never enters identity (SD-05)
  bounding_boxes      NVARCHAR(MAX) CONSTRAINT ck_cand_boxes_json CHECK (bounding_boxes IS NULL OR ISJSON(bounding_boxes) = 1),
  box_source          NVARCHAR(8)   NOT NULL CONSTRAINT ck_cand_box_source CHECK (box_source IN ('ocr','llm')),
  ocr_confidence      FLOAT         NULL CONSTRAINT ck_cand_confidence CHECK (ocr_confidence IS NULL OR (ocr_confidence >= 0 AND ocr_confidence <= 1)),
  -- Classify-and-surface, NEVER drop (REQ-012, specs/ai.md 3.3).
  cleanup_verdict     NVARCHAR(24)  NOT NULL CONSTRAINT ck_cand_verdict
                        CHECK (cleanup_verdict IN ('title-candidate','low-confidence','inferred-unverified','unreadable-tile','chrome-suspected')),
  match_candidates    NVARCHAR(MAX) CONSTRAINT ck_candidate_json CHECK (match_candidates IS NULL OR ISJSON(match_candidates) = 1),
  resolved_work_identity NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NULL,
  resolved_title_id   NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NULL REFERENCES title(id),
  classification      NVARCHAR(40)  NULL CONSTRAINT ck_cand_classification
                        CHECK (classification IS NULL OR classification IN ('new','already-present-for-this-service')),
  -- Default 'pending': there is NO accept-by-inaction (REQ-014, US-012 AC-3).
  review_disposition  NVARCHAR(16)  NOT NULL CONSTRAINT df_cand_disposition DEFAULT 'pending'
                        CONSTRAINT ck_cand_disposition CHECK (review_disposition IN ('pending','confirmed','corrected','discarded','unresolved')),
  corrected_to_tmdb_id INT          NULL,
  created_at          DATETIME2(3)  NOT NULL CONSTRAINT df_candidate_created DEFAULT SYSUTCDATETIME()
);

-- D-3. Candidate -> image is MANY-TO-MANY after intra-batch overlap collapse:
-- the surviving candidate ABSORBS the losers' provenance (SD-02, T-AI-007).
CREATE TABLE candidate_source_image (
  -- ⚠ Surrogate key, not a composite PK. Three NVARCHAR(200) columns are 1200
  -- bytes, over SQL Server's 900-byte CLUSTERED key cap: it creates with only a
  -- warning and then fails at INSERT time. The natural key is kept as a
  -- NONCLUSTERED unique constraint, whose cap is 1700 bytes. Same pattern as
  -- batch_change.
  id           BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT pk_candidate_source_image PRIMARY KEY,
  owner_id     NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  candidate_id NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL
                 REFERENCES extraction_candidate(id) ON DELETE CASCADE,
  image_id     NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL
                 REFERENCES uploaded_image(id),
  -- Preserves the §7.4 (imageIndex, yTop, xLeft) reading order.
  ordinal      INT NOT NULL,
  CONSTRAINT uq_candidate_source_image UNIQUE NONCLUSTERED (owner_id, candidate_id, image_id)
);

CREATE TABLE service_state (
  owner_id                 NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  service                  NVARCHAR(16) NOT NULL CONSTRAINT ck_state_service CHECK (service IN ('netflix','max')),
  -- NULL === "never updated" (US-022 AC-3). REQ-039 / FreshnessStrip reads both.
  last_completed_batch_at  DATETIME2(3),
  last_completed_batch_id  NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NULL REFERENCES upload_batch(id),
  CONSTRAINT pk_service_state PRIMARY KEY (owner_id, service)
);

CREATE TABLE suppression (
  id              NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL PRIMARY KEY,
  owner_id        NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  -- REQ-071: keyed on canonical WORK IDENTITY, never on a row id.
  work_identity   NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  active          BIT           NOT NULL CONSTRAINT df_suppression_active DEFAULT 1,
  suppressed_at   DATETIME2(3)  NOT NULL CONSTRAINT df_suppression_created DEFAULT SYSUTCDATETIME(),
  unsuppressed_at DATETIME2(3),
  -- SD-06: the previous workIdentity if migrated by fix-match.
  migrated_from   NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NULL,
  -- SuppressionDisplaySnapshot, flattened. Lets the suppressed view render
  -- WITHOUT a Title row (US-029 AC-1) — which is the whole point of it.
  display_name         NVARCHAR(500) NOT NULL,
  display_release_year INT           NULL,
  display_media_type   NVARCHAR(16)  NULL CONSTRAINT ck_suppression_media_type
                         CHECK (display_media_type IS NULL OR display_media_type IN ('movie','tv')),
  display_poster_path  NVARCHAR(400) NULL
);
```

> **Index-key length note.** SQL Server caps a nonclustered index key at
> **900 bytes**; `NVARCHAR` is 2 bytes/char, so an indexed key column must
> stay ≤ 450 chars. All indexed identity columns are `NVARCHAR(200)` = 400
> bytes, safely inside the limit. This is *why* the ids are `NVARCHAR(200)`
> and not `NVARCHAR(MAX)` (which cannot be an index key at all).
>
> ⚠ `extraction_candidate.normalised_text` is `NVARCHAR(MAX)` and therefore
> **cannot be an index key**. Group on it in application code, or add a
> computed `NVARCHAR(450)` prefix column if a covering index is ever needed.

### 16.4 Invariants as filtered unique indexes (supersedes §15.4)

All three of the invariants that were partial unique indexes in PostgreSQL
express cleanly in Azure SQL as **filtered unique indexes**
(`CREATE UNIQUE INDEX ... WHERE`). Each was verified individually against
`mssql/server:2022-latest`, in both directions — the violating write is
rejected, and the legitimate write that superficially resembles it is
accepted.

> ⚠ **`SET QUOTED_IDENTIFIER ON` is REQUIRED to create a filtered index, and
> `sqlcmd` defaults it OFF.** Without it every statement below fails with
> `Msg 1934` — and the failure is easy to miss, because subsequent inserts
> then succeed *precisely because the index enforcing them does not exist*.
> A run in that state looks green while asserting nothing. Pass **`-I`** to
> `sqlcmd` (alongside the `-C` required by §3.3a of `specs/testing.md`), and
> assert the indexes exist in the harness rather than assuming they do.

| ID | Invariant | Azure SQL enforcement | Test |
|---|---|---|---|
| **I-1** | At most one `title` per `(owner_id, work_identity, duplicate_ack_seq)` with `state <> 'removed'` | `CREATE UNIQUE INDEX title_one_active_per_work ON title (owner_id, work_identity, duplicate_ack_seq) WHERE state = 'active';` — **the predicate uses `= 'active'`, not `<> 'removed'`.** The enum is only `active`/`removed`, so the two are equivalent, and SQL Server's filtered-index predicates unambiguously allow `=` while `<>` is disallowed. Equivalence holds by the CHECK constraint. | `T-INV-001` — asserts the DB raises **2601/2627** |
| **I-2** | At most one **active** `service_listing` per `(owner_id, title_id, service)` | `CREATE UNIQUE INDEX listing_one_per_service ON service_listing (owner_id, title_id, service) WHERE state = 'active';` | `T-INV-002` |
| **I-9** | At most one **active** `suppression` per `(owner_id, work_identity)` | `CREATE UNIQUE INDEX suppression_one_active ON suppression (owner_id, work_identity) WHERE active = 1;` — filter on the `BIT` column | `T-INV-015` |

**I-2 must be filtered (D-1).** ~~Unfiltered — `ON service_listing (title_id,
service)` with no `WHERE` — it was previously specified as "a plain unique
index, no filter needed".~~ That form is **wrong** and was verified to break a
real user journey: because soft delete is forever (REQ-028), a `removed` row
occupies the `(title, service)` pair permanently, so a work removed from
Netflix could **never reappear on Netflix**. Both available paths were blocked —
re-adding the listing by `listing_one_per_service`, and creating a fresh title
by `title_one_active_per_work`. Filtering resolves it, and a genuine second
*active* Netflix listing is still rejected. It also leads with `owner_id`,
which the unfiltered form failed to do (NFR-008).

The two **CHECK** constraints (`title_match_coherent`,
`listing_removal_coherent`) port **verbatim** — SQL Server's CHECK syntax
is identical for these predicates. I-3/I-4/I-6/I-7 stay application-enforced
exactly as in §15.4. I-8 is §16.7.

**Duplicate acknowledgement (US-025 AC-5 / US-030 AC-4) uses the
`title.duplicate_ack_seq` column (D-2).** An acknowledged duplicate keeps the
**same** `work_identity` and is distinguished by a ULID in
`duplicate_ack_seq`, so the filtered unique index holds by construction.
`createTitle()` surfaces the DB's **2627** (unique constraint) / **2601**
(unique index) as `DuplicateWorkIdentityError`; only
`createTitleAllowingDuplicate()` may write a non-empty `duplicate_ack_seq`,
which is what `T-INV-016` must assert.

~~**Superseded:** "the `dup:<ulid>:` prefix makes an acknowledged duplicate a
distinct `work_identity`… only `createTitleAllowingDuplicate()` may apply the
prefix." This never worked and could not be made to work: `WORK_IDENTITY_RE`
(`identity.ts:24`) rejects the prefix, `title_match_coherent` rejects it at the
database (verified: *"BLOCKED by CHECK constraint title_match_coherent"*), and
— decisively — a prefixed identity would **silently break suppression**, which
is keyed on canonical work identity (REQ-071). Marking the work "not
interested" would suppress one row and quietly miss the other. `T-INV-016` as
written greps for a string that appears nowhere in the codebase, so it passes
vacuously.~~

### 16.5 Batch close is one transaction (unchanged from §15.5)

The transaction body, isolation choice (`READ COMMITTED`), 30-second
statement timeout (SQL Server: `SET LOCK_TIMEOUT` / a command timeout on
the close call), deterministic-id upsert-on-retry, and `T-BATCH-005` all
carry over **unchanged**. `MERGE` is **not** used for the upsert — it has
known correctness sharp edges in SQL Server; the retry path does an
explicit `UPDATE`-then-`INSERT`-if-zero-rows inside the transaction, same
shape as §15.5.

### 16.6 Indexing, pagination, and search (supersedes §15.6)

```sql
CREATE INDEX title_list_default ON title (owner_id, state, sort_date_added DESC, id ASC);
CREATE INDEX listing_removed_view ON service_listing (owner_id, removed_at DESC, listing_id ASC)
  WHERE state = 'removed';                       -- filtered index, same as PG partial index
CREATE INDEX listing_by_title ON service_listing (owner_id, title_id);
CREATE INDEX batch_change_by_batch ON batch_change (owner_id, batch_id, kind);
CREATE INDEX candidate_by_batch ON extraction_candidate (owner_id, batch_id);
```

**Pagination is keyset, unchanged** (§15.6): same cursor shape, same
`WHERE (sort_date_added, id) < (@cursorDate, @cursorId)` predicate, opaque
to clients. The listing path is **fully index-backed and UNAFFECTED** by
the datastore change.

**Search loses `pg_trgm` — this is a real behaviour cost (NFR-018).** The
removed-view title search becomes:

```sql
WHERE tmdb_name COLLATE Latin1_General_100_CI_AI LIKE N'%' + @term + N'%'
```

- **What is lost:** fuzzy / typo tolerance and trigram ranking. `LIKE
  '%term%'` is **exact substring only** and is **not index-backed** (a
  leading wildcard cannot use a B-tree). At single-user scale (a few
  thousand rows) a scan is fine; `T-PERF-001` no longer asserts an index
  scan for *search* (it still does for the *listing* path).
- **`@term` MUST be escaped** for `LIKE` metacharacters (`%`, `_`, `[`)
  via `ESCAPE`, and parameterised — never string-concatenated (SQLi).
- **Named escalation:** if search quality is judged insufficient, add a
  **SQL Server Full-Text index** on `tmdb_name`/`normalised_text` and use
  `CONTAINS`/`FREETEXT`. Basic tier supports full-text search. This is an
  ADR-level escalation, not silent scope.

### 16.7 SD-04, restated for Azure SQL (supersedes §15.7)

`REQ-028` says nothing in the list data ever disappears; the guarantee is
that **the machinery capable of violating it is not present**:

1. **No Azure SQL Agent job and no Elastic Job.** This is the direct
   Azure-SQL analogue of the `pg_cron` prohibition. Basic tier has no SQL
   Agent, and **no Elastic Jobs agent may be provisioned** against this
   database. `T-INFRA-005` asserts the Bicep provisions neither.
2. **No `DELETE` triggers.** The one `ON DELETE CASCADE`
   (`service_listing → title`) fires only from the single permitted delete
   path (creates-only undo, SD-03).
3. **No scheduled job of any kind** in the deployment. The only scheduled
   thing in the product remains the blob lifecycle rule (`NFR-019`), which
   never touches the database.
4. **`DELETE`/`deleteMany` appear in exactly one module** (`T-INV-012`).
5. **No `TRUNCATE`, ever, including in migrations** (§16.8).

`T-INV-013` is restated to assert items 1, 2, 4 and 5 by static analysis of
the migrations directory and the source tree — **including a grep that no
migration or Bicep file creates an Agent/Elastic job.**

### 16.8 Migrations (supersedes §15.8)

- **Prisma Migrate, provider `sqlserver`.** Migrations are checked-in
  T-SQL, reviewed like code, applied by `prisma migrate deploy` —
  **staging first, production second**.
- **The SQL-Server-specific DDL Prisma cannot model** (filtered unique
  indexes, multi-column CHECK constraints, `ISJSON` CHECKs, explicit
  collations) lives in **raw SQL migration steps**
  (`prisma migrate ... --create-only`, then hand-edited). This is
  deliberate: it keeps Prisma's thinner `sqlserver` modeling off the
  critical path (`RSK-031`).
- **`prisma migrate dev` / `prisma db push` MUST NOT run against any Azure
  database.** Local-only.
- **Destructive migrations fail CI — restated for SQL Server (T-MIG-001).**
  The CI grep over `prisma/migrations/**` now matches the T-SQL destructive
  forms: **`DROP TABLE`, `DROP COLUMN` / `ALTER TABLE ... DROP COLUMN`,
  `TRUNCATE TABLE`, and `DROP INDEX`** (there is no `DROP TYPE` in SQL
  Server — enums are CHECK constraints, so its analogue is a CHECK-drop
  that widens a domain, which the reviewer flags but is not
  data-destructive). A match fails the build. This remains the single most
  valuable test this chapter adds.
- **Additive-only rule for v1.1 unchanged.**
- **(A45) The `uploaded_image` A45 columns are an ADDITIVE migration.**
  `file_name NVARCHAR(255) NOT NULL` and `ingest_source NVARCHAR(16) NOT NULL
  DEFAULT 'upload'` are added with `ALTER TABLE ... ADD` plus their CHECK
  constraints. `ingest_source` defaults to **`'upload'`** deliberately: every
  row that exists before A45 *did* arrive by upload, so the default is a true
  statement about history, not a placeholder. `file_name` backfills from the
  API-layer value (it was always carried in the response) and, where genuinely
  absent, from the §3.8.1 synthesiser with the `uploaded-` prefix. **No column
  is dropped and no row is rewritten.** `T-MIG-001` is unaffected.
- **Zod's role unchanged** from §15.8; the DB is the storage schema.

### 16.9 What this deliberately does NOT include (deltas from §15.9)

Same single-user right-sizing. The table carries over; the SQL-Server
notes: **no failover group / geo-replication / zone redundancy; no read
scale-out replica; no elastic pool** (one database, not a fleet); **no
Managed Instance** (Basic single database is the whole need); no
partitioning; no Row-Level Security (still the leading `NFR-001` candidate,
and SQL Server RLS via security predicates is well-supported should that
path ever be taken).

### 16.10 Migration from the PostgreSQL design

**There is none in running systems** — no PostgreSQL server was ever
provisioned (§15.10). The change lands entirely in unwritten code and
un-run migrations: swap the Prisma provider, port the DDL to T-SQL per this
chapter, and re-run the `M0` smoke migration. `RSK-030` (churn) is why §15
is retained rather than overwritten, and why `TASK-143`'s sweep is widened
to the PostgreSQL→Azure SQL delta.

### 16.11 The 7-day PITR consequence (honest statement)

PostgreSQL B1ms gave **35-day** point-in-time restore; Azure SQL **Basic
caps PITR at 7 days**. Because `REQ-028` forbids any hard delete or TTL,
the store is **append-mostly and effectively irreplaceable** — there is no
second copy of the owner's history anywhere. The consequence is blunt:

> **A silent corruption or a bad migration that is not noticed within 7
> days is unrecoverable from PITR.**

Mitigations, none of which fully restores the 35-day window:

- **`OQ-025` RE-WIDENS.** It had been narrowing (35 days felt generous);
  at 7 days the "how is the irreplaceable store protected" question is open
  again and is recorded as such.
- **`TASK-131` (periodic logical export) is recommended EARLY**, not
  deferred — a weekly `BACPAC`/logical export to the blob account gives a
  cheap out-of-band copy that outlives the 7-day window. This is the real
  mitigation and it is nearly free.
- **Long-Term Retention (LTR)** is the named escalation if exports prove
  insufficient; it is not configured at MVP (cost/complexity).
