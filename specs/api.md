---
createdAt: 2026-08-10T20:12:02-04:00
createdBy: spec-writer
phase: 8
status: complete
sourceOfTruth: artifacts/PRD.md, artifacts/architecture.md, artifacts/adr/ADR-0002, ADR-0006
---

# specs/api.md — nextup HTTP API

> ⚠ **REVISION 6 — 2026-08-11 (`A45`) — PASTE IS THE PRIMARY INGEST PATH;
> FILE UPLOAD REMAINS FULLY SUPPORTED.**
> The owner corrected the ingestion assumption verbatim: *"for screenshots,
> I'm generally expecting that I will take a screen grab and paste it into
> the app directly rather than saving it to my device first and then
> uploading it to the app."* **Every statement that ingestion is file-upload
> only is now WRONG and has been corrected IN PLACE**, not annotated (the
> `F-001` lesson: a banner is right for rationale and wrong for text a
> machine executes).
>
> **⚠ ADD, NOT SWAP.** File upload is **not** deprecated, **not** demoted to
> a fallback in the contract, and **not** removed. It is the only path that
> delivers raw HEIC (iOS Photos) and the only path when the owner missed the
> screenshot preview's *"Copy"*. Both the laptop web-screenshot path and the
> iOS Photos path still need it.
>
> Platform facts are governed by
> **`Context/evidence/clipboard-paste-support.md`** (primary sources,
> retrieved 2026-08-11). Do not re-derive or contradict them.
>
> | # | Delta | Where |
> |---|---|---|
> | 1 | **New §5.3 — the three ingest sources** (`paste`, `upload`, `drop`), the client primitives each platform requires, and the rule that **all three post to the SAME endpoint and append to the SAME open batch**. | **§5.3** |
> | 2 | **`POST /api/batches/:batchId/images` gains an `ingestSource` multipart field** and returns `ingestSource` + `fileName` per accepted image. **The route, method, ceilings, status codes and error codes are UNCHANGED.** | §6.12 |
> | 3 | **The HEIC transcode becomes CONDITIONAL on the sniffed format — corrected in place in §5.1. It is NOT deleted**; the upload path still delivers HEIC. | §5.1 |
> | 4 | **`image.decode.begin` gains `ingestSource`** — the sentinel's field list is an exact contract, so it is corrected in place. | §9.1 |
> | 5 | **No new HTTP error codes.** Clipboard permission/empty/non-image/rejected-promise failures are **client-side, pre-request** conditions and never produce an HTTP request. §8's closed enumeration is unchanged. `ux-states.md` §4.12–§4.17 owns them. | §5.3.4, §8 |
>
> **Applying IDENTICALLY to pasted bytes, with no exception and no separate
> path:** every ceiling (§5), the magic-byte sniff (§5), the pre-decode pixel
> guard (§5.0, REQ-079), per-image isolation and both OOM paths (§5.2), the
> metadata strip (§5.1 step 3, REQ-078), 30-day retention (NFR-019), and
> re-extraction (REQ-074).


> ⚠ **REVISION 5 — 2026-08-11 (`A43` / `OQ-028` closed) — the memory
> decision, and the containment it makes MANDATORY.**
> The owner answered `OQ-028` verbatim: **"Start at 0.5 GiB, up-size only if
> it OOMs."** So **compute stays 0.25 vCPU / 0.5 GiB**; 0.5 vCPU / 1.0 GiB
> (+~$4/month) is a **pre-authorised, trigger-gated reactive remedy**
> (`runbooks/scale-up-memory.md`, ADR-0003 R4). `RSK-016` is now an
> **owner-accepted residual risk**, and acceptance is conditional on the
> containment below — these are **acceptance criteria, not advice**
> (`architecture.md` §Handover R6 addendum a/b, ADR-0008 R2).
>
> Contract deltas in this revision, all of them **instructions** and all
> corrected **in place** where they appear (never behind a banner alone):
>
> | # | Delta | Where |
> |---|---|---|
> | 1 | **New §5.0 — the pre-decode pixel guard (`A43-M1`).** Dimensions are read from the container **header** and checked **before any decode buffer is allocated**. **A byte guard is NOT a pixel guard** and the existing byte ceilings are explicitly demoted to a first cheap filter. | §5, **§5.0** |
> | 2 | **The dimension ceiling moves from *post-transcode* to *pre-decode*.** The old row said "Image dimensions (post-transcode)" — that is corrected in place; checking after the decode is checking after the allocation that kills you. | §5 table |
> | 3 | **Two new error codes** — `IMAGE_TOO_LARGE_TO_DECODE` and `IMAGE_DECODE_OOM` — both naming memory and citing the runbook. `IMAGE_DECODE_FAILED` is separated out of the `UNSUPPORTED_IMAGE_FORMAT` overload and **must not** mention memory. `IMAGE_DIMENSIONS_UNSUPPORTED` is **reused, not duplicated**, for the Read axis bounds. | §5.0, §6.12, **§8** |
> | 4 | **Both OOM paths are specified** — the *catchable* WASM `RangeError` (no container restart) and the *uncatchable* kernel OOM kill (restart, no application error). A handler that covers only one misses the common case. | §5.2 |
> | 5 | **`image.decode.begin` / `image.decode.end` sentinel log events**, with an exact field list. They are the only signal that names *which* image died. | §9.1 |
>
> **Nothing else in the HTTP contract moves.** Routes, methods and every
> other status code are unchanged from R4.

> ⚠ **REVISION 4 — the store is now Azure SQL Database (A40, Variant A).**
> ADR-0005 Rev 3 replaced PostgreSQL with **Azure SQL Database Basic**
> (`specs/data-model.md` §16). **The HTTP contract is again unchanged.**
> The only wording delta from R3: the error-envelope leak rule (§ below)
> now names **Azure SQL error `2601`/`2627`** instead of Postgres `23505`.
> The opaque-cursor and owner-scope notes below are store-agnostic and
> stand as written.

> ⚠ **REVISION 3 — 2026-08-10T21:45.** Constraint change **A41/CC-002**
> relaxed `NFR-012`, and ADR-0005 Revision 2 replaced Cosmos DB with
> **PostgreSQL** (`specs/data-model.md` §15). **The HTTP contract is
> unchanged** — no route, status code, request body or response body in
> this document moves. Three pieces of *wording* change, and each is
> marked **(R3)** where it appears:
>
> 1. **§3 `cursor` is an opaque base64url keyset cursor**, not a Cosmos
>    continuation token. Its contents were always an implementation
>    detail; they are now a different implementation detail.
> 2. **§1.1 owner scoping** is an `owner_id` **column filter** rather than
>    a partition key. The rule for handlers is identical and the test is
>    now more important, not less.
> 3. **§2 / §7.x "partition"** as a synonym for "the caller's data" is
>    replaced by "the caller's scope". No behaviour changes: a resource
>    belonging to another owner is still **404, indistinguishable from
>    nonexistent**.

**Serves:** every story. **Requirements:** all v1 functional REQs, NFR-008,
NFR-011, NFR-013, NFR-018, NFR-019, NFR-020.

---

## 1. Shape

- Single origin. The Node/Express process serves the built SPA from `/` and the
  JSON API from `/api/*` (ADR-0003). **No CORS configuration exists**; a
  cross-origin request is simply not possible. `T-API-001` asserts no
  `Access-Control-Allow-Origin` header is ever emitted.
- Routes live in `apps/api/src/routes/`, one file per resource:
  `me.ts`, `titles.ts`, `listings.ts`, `suppressions.ts`, `removed.ts`,
  `batches.ts`, `images.ts`, `serviceState.ts`, `tmdb.ts`, `removalGroups.ts`.
- Every route is registered in `apps/api/src/routes/index.ts` behind, in this
  exact order:

```ts
app.use('/api', requirePrincipal);   // 1. Easy Auth principal header → { issuer, subject, email }
app.use('/api', requireAllowList);   // 2. NEXTUP_ALLOWED_SUBJECTS  → 403 or continue
app.use('/api', attachOwnerScope);   // 3. principal.subject → req.ownerId
app.use('/api', apiRouter);          // 4. handlers
app.use('/api', errorEnvelope);      // 5. the ONLY place an error becomes a response
```

**Order is a requirement, not an implementation detail** (`specs/security.md`
§3). `T-SEC-005` asserts a request that skips step 2 cannot reach any handler.

### 1.1 Owner scoping (NFR-008)

Handlers **never** read `ownerId` from a body, a query string or a path. They
read `req.ownerId`, set by `attachOwnerScope` from the authenticated principal.
`apps/api/src/repository/ownerData.ts` accepts `ownerId` as the **first
positional parameter of every function** and applies it as an `owner_id`
equality filter on every read and write **(R3 — was: injects it as the Cosmos
partition key)**. There is no repository function without it.
`T-SEC-006` greps for `ownerId` appearing in any Zod request schema and fails
on a match.

**(R3) This test got more important.** Under Cosmos, `ownerId` was the
partition key, so a cross-owner read was structurally expensive and mostly
self-preventing. A column filter carries no such physics: a handler that
forgets it returns other owners' rows at full speed. `T-SEC-006` and the
repository-signature test are therefore **load-bearing** for `NFR-008`, not
belt-and-braces, and a change that weakens either is a blocking review
finding. (Row-level security was considered and rejected as a second, subtler
enforcement path — `specs/data-model.md` §15.9.)

### 1.2 Validation

Every request body, query string and path parameter is parsed by a Zod schema
from `packages/domain/src/schemas.ts` **in the route handler's first
statement**. An invalid payload is a **400 `VALIDATION_FAILED`** whose
`details.issues` is Zod's flattened issue list. Handlers receive parsed,
typed data and never re-check it.

### 1.3 Content types, versioning, idempotency

| | |
|---|---|
| Request/response | `application/json; charset=utf-8`, except image upload (`multipart/form-data`) and image read (`image/png` \| `image/jpeg` — served bytes are always the stored/derived format, never HEIC; see §5.1) |
| Versioning | **None in v1.** Single client, deployed with the server in one image. A breaking change is a coordinated deploy. If a second client ever appears, version by path prefix (`/api/v2`). |
| Idempotency | `POST /api/batches` accepts an optional `Idempotency-Key` header (max 64 chars); a repeat within the same open batch returns the existing batch with **200** instead of **201**. All other state-changing routes are naturally idempotent (they act on an identified resource whose post-state is asserted) or explicitly refuse a second application (409 `*_ALREADY_*`). |
| Rate limiting | None. Single owner, allow-listed. Cost ceilings are per-batch size limits (§5), not request rates. |
| Compression | `compression()` for JSON only; image responses are not re-compressed. |

---

## 2. The error envelope — one shape, everywhere

```jsonc
{
  "error": {
    "code": "SCREAMING_SNAKE_CASE",   // stable, machine-readable, enumerated in §11
    "message": "One sentence in plain English, safe to display to the owner.",
    "details": { }                    // route-specific; ALWAYS an object, may be empty
  }
}
```

- Produced **only** by `apps/api/src/middleware/errorEnvelope.ts`. No handler
  calls `res.status(...).json({ error: ... })` directly; handlers `throw` an
  `AppError(code, httpStatus, message, details)`. `T-API-002` asserts every
  4xx/5xx response in the whole suite matches the envelope schema.
- **`message` never contains a stack trace, a database diagnostic or SQL
  fragment, a connection string, a blob path or a `workIdentity` hash.**
  `T-SEC-007`. **(R4)** **Azure SQL** driver errors are especially prone to
  leaking: a **`2627` (unique constraint) / `2601` (unique index)**
  violation carries the **index/constraint name and the duplicated key
  value** in its message. The error mapper MUST map known constraint names
  to domain codes (for example `title_one_active_per_work` →
  `DUPLICATE_WORK_IDENTITY`) and **MUST NOT pass any driver-supplied string
  through to `message`**. `T-SEC-007` is extended with a constraint-violation
  case. *(R3 wording named the Postgres `23505` equivalent — superseded by
  Azure SQL `2601`/`2627` per ADR-0005 Rev 3 / `data-model.md` §16.4.)*
- An unhandled exception becomes **500 `INTERNAL_ERROR`** with the message
  *"Something went wrong. Nothing was changed."* and a `correlationId` in
  `details`. The full error is logged server-side with that id.

---

## 3. Pagination, filtering, sorting

- **Cursor pagination only.** No offsets, no total counts (a total count over
  an ever-growing removed view would violate NFR-018).
- Query params: `limit` (integer, 1..200, default 50), `cursor` (opaque string).
  **(R3) The cursor is a base64url-encoded keyset position**
  (`{sortDateAdded, id}` for the combined list, `{removedAt, listingId}` for
  the removed view) — see `specs/data-model.md` **§16.6** *(R4: keyset
  pagination is carried over unchanged from §15.6, but §15 is now
  superseded — cite §16.6)*. It was a Cosmos
  continuation token in Revision 1. **Clients MUST treat it as opaque and MUST
  NOT parse it**; it is echoed back unmodified or not at all. An unparseable or
  tampered cursor is **400 `INVALID_CURSOR`**, never a silent reset to page 1,
  because silently restarting a paged scan is how an owner concludes rows have
  vanished. `T-API-01x` asserts the 400.
- Response envelope for every collection:

```jsonc
{ "items": [ ], "nextCursor": "eyJ0b2..." | null, "limit": 50 }
```

- An unparseable or expired `cursor` → **400 `INVALID_CURSOR`**. The client
  restarts from page 1.
- Sorting is a `sort` enum per resource; an unknown value → 400
  `VALIDATION_FAILED`.

---

## 4. Routes — index

| Method | Path | Stories |
|---|---|---|
| GET | `/api/me` | US-001, US-002, US-011 |
| GET | `/api/titles` | US-018, US-019, US-020 |
| GET | `/api/titles/:titleId` | US-018 |
| POST | `/api/titles/:titleId/fix-match` | US-030 |
| POST | `/api/titles/:titleId/suppress` | US-027 |
| GET | `/api/suppressions` | US-029 |
| POST | `/api/suppressions/:suppressionId/unsuppress` | US-029 |
| GET | `/api/removed` | US-023, US-024 |
| POST | `/api/listings/:listingId/restore` | US-025 |
| POST | `/api/batches` | US-003, US-005 |
| GET | `/api/batches` | US-031 |
| GET | `/api/batches/:batchId` | US-006, US-031 |
| POST | `/api/batches/:batchId/images` | US-004 |
| DELETE | `/api/batches/:batchId/images/:imageId` | US-004 |
| POST | `/api/batches/:batchId/submit` | US-005, US-006 |
| POST | `/api/batches/:batchId/retry-extraction` | US-006 |
| GET | `/api/batches/:batchId/review` | US-012, US-013, US-014 |
| PATCH | `/api/batches/:batchId/candidates/:candidateId` | US-007, US-008, US-012 |
| POST | `/api/batches/:batchId/candidates/confirm-all` | US-012 |
| POST | `/api/batches/:batchId/manual-entry` | US-009 |
| PATCH | `/api/batches/:batchId/removals` | US-015 |
| POST | `/api/batches/:batchId/close` | US-012, US-016, US-021 |
| POST | `/api/batches/:batchId/discard` | US-005 |
| POST | `/api/batches/:batchId/re-extract` | US-034 |
| POST | `/api/batches/:batchId/undo` | US-032, US-033 |
| POST | `/api/removal-groups/:groupId/undo` | US-017 |
| GET | `/api/images/:imageId` | US-036 |
| GET | `/api/service-state` | US-022 |
| GET | `/api/tmdb/search` | US-007, US-009, US-030 |

---

## 5. Ceilings (ADR-0006 handover; NFR-012)

**(A45) Every ceiling, sniff and guard in this section applies IDENTICALLY to
bytes that arrived by clipboard paste or drag-and-drop as to bytes that arrived
by file upload.** There is one ingest pipeline, `apps/api/src/images/ingest.ts`,
and one set of limits. A pasted image is not privileged, not exempt, and not
handled by a second code path. §5.3.

| Ceiling | Value | Violation |
|---|---|---|
| Images per batch | 40 — **counted across all three ingest sources combined** (A45): 30 pasted + 11 uploaded is 41 and is refused | 400 `TOO_MANY_IMAGES` |
| Bytes per image | 10 MiB — **a first cheap filter only. It is NOT the memory guard** (R5, `A43-M1`): HEIC's compression ratio is highly variable, so bytes do not predict raster size and a 6 MiB HEIC can be 48 MP. The guard is §5.0. | 413 `IMAGE_TOO_LARGE` |
| Bytes per batch (cumulative) | 60 MiB of **UPLOADED** bytes — **cumulative across all ingest sources** (A45). ⚠ **The unit is what the device SENT, never what is stored.** A HEIC batch stores ~8.5× its upload size after the transcode; measuring the tally in stored bytes fires this ceiling after ~7 MiB of real uploads while letting the incoming file through under-counted. There is deliberately **no stored-bytes batch ceiling** — stored total is already bounded transitively by the 40-image cap and the pixel guard (§5.3.1). | 413 `BATCH_TOO_LARGE` |
| Accepted formats | **PNG, JPEG, and HEIC/HEIF** — **determined by magic bytes**, not by extension or `Content-Type` (A42; was PNG/JPEG only). HEIC/HEIF is transcoded to lossless PNG on ingest — §5.1 | 415 `UNSUPPORTED_IMAGE_FORMAT` |
| **Decodable pixel count (`width × height`)** *(new, R5, `A43-M1`)* | **`≤ NEXTUP_MAX_DECODE_PIXELS`**, default **`25000000`** (25 MP) at 0.25 vCPU / 0.5 GiB, **`50000000`** (50 MP) at the 0.5 vCPU / 1.0 GiB remedy. Read from the **container header only** and evaluated **before any decode buffer is allocated** — §5.0 | 413 `IMAGE_TOO_LARGE_TO_DECODE` |
| **Image dimensions — evaluated PRE-DECODE, from the header** *(corrected in place, R5)* | > 50×50 px and < 16,000×16,000 px on each axis — the Azure AI Vision Read 4.0 input bounds. Rejected, **not** silently downscaled (NFR-012a is quality-first) | 400 `IMAGE_DIMENSIONS_UNSUPPORTED` |
| | ~~*R4 text: "Image dimensions (**post-transcode**) … enforced on the decoded raster."*~~ — **superseded (R5): a bounds check performed after the decode is performed after the allocation that kills the container. The check moves to the header, before allocation (§5.0). The same code, `IMAGE_DIMENSIONS_UNSUPPORTED`, is REUSED — do not introduce a second one.** | |
| **Header parseable** *(new, R5)* | The dimensions must be readable from the header. **Never "decode and find out."** | 415 `UNSUPPORTED_IMAGE_FORMAT` |
| Files per multipart request | 10 | 400 `TOO_MANY_FILES_IN_REQUEST` |
| JSON body | 1 MiB | 413 `PAYLOAD_TOO_LARGE` |
| Open batches per owner | 1 | 409 `OPEN_BATCH_EXISTS` |

Magic-byte check (`apps/api/src/images/format.ts`):
PNG `89 50 4E 47 0D 0A 1A 0A`; JPEG `FF D8 FF`; **HEIC/HEIF** — the ISO-BMFF
box structure `?? ?? ?? ?? 66 74 79 70` (`ftyp` at offset 4) with a HEIF-family
**major/compatible brand** (`heic`, `heix`, `heif`, `heim`, `hevc`, `mif1`,
`msf1`). The format is decided by these bytes, **never** by the declared
`Content-Type`: iOS/Safari frequently sends `application/octet-stream` or an
**empty** type for a `.heic` file, so trusting the declared type would reject
valid files. A file whose declared type and magic bytes disagree is resolved
**by the magic bytes**; a file matching no known signature is **rejected as
415**, never coerced. `T-IMG-006`.

**(A45) The sniff is not relaxed for pasted bytes — it is MORE necessary
there.** A clipboard `Blob`/`File` carries a `type` string the page never
validated; on the desktop `paste` path that string is supplied by whatever
application performed the copy. **Never trust `Blob.type`, `File.type` or the
multipart part's `Content-Type`, for any ingest source.** The bytes decide. A
paste whose blob claims `image/png` but whose bytes are a PDF is **415
`UNSUPPORTED_IMAGE_FORMAT`**, exactly like an uploaded one. `T-PASTE-006`.

### 5.0 The pre-decode pixel guard — MANDATORY *(new, R5; `A43-M1`, ADR-0008 R2.1)*

**Rule, stated as the implementer must execute it:** for **every** accepted
file, in `apps/api/src/images/pixelGuard.ts`, **read the pixel dimensions out
of the container header and decide accept/reject BEFORE calling any decoder
and before allocating any decode buffer.** The order in
`apps/api/src/images/ingest.ts` is fixed and is part of the contract:

```
magic-byte sniff (§5)                     ← no allocation
  → byte ceiling (§5, cheap first filter) ← no allocation
  → HEADER-ONLY dimension read (§5.0)     ← bounded read, ≤ 64 KiB, NO decode
  → pixel guard decision                  ← ACCEPT or REJECT here
  → log image.decode.begin (§9.1)
  → decode / transcode (§5.1)             ← the ONLY place a raster is allocated
  → log image.decode.end (§9.1)
  → strip metadata → blob write → staged uploadedImage row
```

**A decoder must not be constructed before the guard has passed.** `T-IMG-017`
asserts exactly this by injecting a decoder test double that throws if invoked.

#### 5.0.1 The decision, in order

```ts
// packages/domain/src/pixelGuard.ts — pure, no I/O, unit-testable
export type PixelGuardVerdict =
  | { ok: true;  width: number; height: number; megapixels: number }
  | { ok: false; code: 'IMAGE_TOO_LARGE_TO_DECODE'
                     | 'IMAGE_DIMENSIONS_UNSUPPORTED'
                     | 'UNSUPPORTED_IMAGE_FORMAT';
      width?: number; height?: number; megapixels?: number; maxMegapixels: number };

export function evaluatePixelGuard(
  dims: { width: number; height: number } | null,   // null ⇒ header unparseable
  maxDecodePixels: number,                          // NEXTUP_MAX_DECODE_PIXELS
): PixelGuardVerdict;
```

| # | Condition | Verdict | HTTP (when nothing else in the request was accepted) |
|---|---|---|---|
| 1 | `dims === null` (header unparseable/truncated) | `UNSUPPORTED_IMAGE_FORMAT` | 415 |
| 2 | `width < 50 \|\| height < 50 \|\| width > 16000 \|\| height > 16000` | `IMAGE_DIMENSIONS_UNSUPPORTED` *(reused code — the Read 4.0 axis bounds; such an image could not be extracted even if it decoded)* | 400 |
| 3 | `width * height > maxDecodePixels` | `IMAGE_TOO_LARGE_TO_DECODE` | 413 |
| 4 | otherwise | `ok: true` | — |

Conditions are evaluated **in this order** so an image that is both
out-of-axis-bounds and over the pixel budget reports the axis bound, which is
the more actionable message (up-sizing would not help it).

#### 5.0.2 `NEXTUP_MAX_DECODE_PIXELS` — the one configuration value

| | |
|---|---|
| Env var | **`NEXTUP_MAX_DECODE_PIXELS`** |
| Type | positive integer, parsed by `packages/domain/src/config.ts` with `z.coerce.number().int().positive()` |
| **Default when unset** | **`25000000`** — the 0.25 vCPU / 0.5 GiB value. `T-IMG-022`. |
| Value at 0.5 vCPU / 1.0 GiB | **`50000000`** — set **in the same command** that up-sizes memory (`runbooks/scale-up-memory.md` §2) |
| Binding rule | **The guard value moves with container memory, always.** A raised guard on a small container is strictly worse than no up-size at all. `T-INFRA-005` pins the **pair** `0.25 vCPU / 0.5 GiB` **and** `NEXTUP_MAX_DECODE_PIXELS=25000000` so they can never drift apart. |
| Read at | request time from `config`, **not** captured in a module-level constant — a revision that changes the env var must take effect without a code change. `T-IMG-022`. |

**The honest cost of this value, disclosed rather than discovered:** at 25 MP,
**48 MP iPhone Pro captures are refused.** They fail cleanly, with a named
reason and a documented one-command remedy — but they do fail.

#### 5.0.3 How the dimensions are read WITHOUT decoding — per format

`apps/api/src/images/readDimensions.ts` exports
`readDimensions(buf: Buffer): { width: number; height: number } | null`.
It reads **structure, never pixels**, touches at most the first **64 KiB** of
the file, allocates no raster, and **returns `null` rather than throwing** on
anything malformed.

| Format | Header structure parsed | Mechanism (exact) |
|---|---|---|
| **PNG** | **`IHDR`** chunk | The `IHDR` chunk is mandated by the PNG spec to be the **first chunk**, at a fixed offset: bytes `0..7` are the signature, `8..11` the chunk length, `12..15` the type `IHDR`, then **`width = buf.readUInt32BE(16)`**, **`height = buf.readUInt32BE(20)`** (both big-endian). A file whose bytes `12..15` are not `IHDR` → `null`. **Total read: 24 bytes.** |
| **JPEG** | the first **`SOFn`** marker | Walk the JPEG marker segments from offset 2: each marker is `0xFF <code>` followed by a 2-byte big-endian segment length; skip `0xFF 0x01`, the `0xFFD0–0xFFD7` restart markers, and any fill `0xFF` bytes. Stop at the first **Start-of-Frame** marker — `0xFFC0–0xFFCF` **excluding `0xFFC4` (DHT), `0xFFC8` (JPG) and `0xFFCC` (DAC)**, which covers baseline (`C0`), extended (`C1`) and **progressive (`C2`)**. In that segment: **`height = readUInt16BE(offset + 5)`**, **`width = readUInt16BE(offset + 7)`** — **height precedes width, which is the classic implementation bug here.** Reaching `SOS` (`0xFFDA`) or the end of the scanned window without an `SOFn` → `null`. |
| **HEIC / HEIF** | the **`ispe`** box (ImageSpatialExtentsProperty) | Walk the ISO-BMFF box tree — each box is a 4-byte big-endian size then a 4-byte type, with `size == 1` meaning a 64-bit `largesize` follows and `size == 0` meaning "to end of file". Descend `meta` (a **FullBox**: skip its 4 version/flags bytes before reading children) → `iprp` → `ipco`, and read the `ispe` boxes inside `ipco`. `ispe` is a FullBox whose payload after the 4 version/flags bytes is **`image_width = readUInt32BE(+0)`**, **`image_height = readUInt32BE(+4)`**. **Where a file contains several `ispe` boxes** (thumbnails, auxiliary/depth images, and every frame of a burst or Live Photo), take the **MAXIMUM `width × height`** across them — never the first, which is frequently the thumbnail and would let a 48 MP master through the guard. Any box size that overruns the buffer, or no `ispe` found within the first 64 KiB → `null`. |

**Implementation note (not optional):** parse these three yourself in
`readDimensions.ts` — they are ~150 lines in total and have no dependencies.
Do **not** delegate the HEIC branch to `heic-convert`/`libheif-js` "just to
get the size": constructing that decoder is the allocation the guard exists
to prevent. `image-size`/`probe-image-size` may be used for **PNG and JPEG
only**, and only if the version in `package.json` is pinned; the HEIC branch
must be the `ispe` walk above, and it must obey the maximum-`ispe` rule.

**Rejection is per-file.** A guard verdict names that one file in
`rejected[]` (§6.12) and **never** fails the request — see §5.2.


### 5.1 HEIC/HEIF transcode on ingest (A42; **guarded, R5**; **conditional, A45**)

Neither extraction service accepts HEIC/HEIF, and no non-Safari browser can
render it, so an accepted HEIC/HEIF upload is **transcoded to lossless PNG as
part of ingest**, before the blob is written and before extraction.

> ⚠ **(A45) THE TRANSCODE STAGE IS CONDITIONAL, NOT DELETED.**
> Clipboard paste always delivers `image/png` — WebKit exposes exactly four
> clipboard representations (`text/plain`, `text/html`, `text/uri-list`,
> `image/png`) and **HEIC is not one of them**
> (`Context/evidence/clipboard-paste-support.md` Q3, `verified`). So on the
> paste path this stage is a **no-op**.
> **It MUST NOT be removed.** The **iOS Photos file-upload path still
> delivers raw HEIC** and is fully supported (A42, evidence Q5 option B).
> Deleting the stage because "screenshots are always PNG now" breaks the
> owner's own camera-roll uploads — the exact `A42` failure mode.

**The condition — stated as the implementer must execute it.** In
`apps/api/src/images/ingest.ts`, the transcode branch is entered on the
**sniffed** format and nothing else:

```ts
// api.md §5 decided `uploadedFormat` from MAGIC BYTES. Never from Blob.type,
// File.type, the multipart Content-Type, the file extension, or ingestSource.
const needsTranscode =
  uploadedFormat === 'heic' || uploadedFormat === 'heif';   // ← the whole condition

const stored = needsTranscode
  ? await transcodeHeicToPng(bytes)   // steps 1–4 below
  : bytes;                            // png | jpeg: stored as-is
// …then, for BOTH branches, unconditionally:
const clean = await stripAllMetadata(stored);   // §5.1 step 3 — NEVER conditional
```

Three rules about that condition, each of which has a way of being got wrong:

1. **The condition is on the SNIFFED FORMAT, never on `ingestSource`.**
   `if (ingestSource === 'paste') skipTranscode()` is **forbidden**. It is
   *currently* equivalent and it is *structurally* wrong: it makes a security
   decision from an untrusted client-declared field, and it silently breaks
   the moment a platform exposes another representation. `T-IMG-023`.
2. **The metadata strip (step 3) is NOT part of the condition.** It runs for
   **every** accepted image, on **every** ingest source, PNG and JPEG
   included. See §5.1a — this is the trap.
3. **The pixel guard (§5.0) is NOT part of the condition either.** It runs
   before this branch, for every image, every source. A 48 MP PNG pasted from
   a 6K desktop screenshot is refused exactly like a 48 MP HEIC.

**Step 0 (R5, mandatory, first): the pre-decode pixel guard of §5.0 has
already passed.** Steps 1–5 below run **only** for a file whose header-read
dimensions were accepted. A decoder is not constructed before that point.

1. **Decode** the HEIC/HEIF with `heic-convert` (pure JS/WASM `libheif`, no
   native build — runs in the stock Linux container) to **PNG**, then optionally
   hand the raster to prebuilt `sharp` for the clamp/re-encode below.
2. **Lossless PNG only** — never a lossy JPEG re-encode. Extraction is
   quality-first (**NFR-012a**); a lossy transcode would degrade the small tile
   captions and artwork detail the extractor depends on (`ai.md` §2.1a).
3. **Strip all metadata (EXIF/GPS/device model)** — an explicit, tested ingest
   step, applied to **every accepted image from every ingest source**, not just
   the transcoded ones, and **not** an incidental side effect
   (`security.md` §4.2, REQ-078). **(A45) This step is explicitly OUTSIDE the
   `needsTranscode` condition — see §5.1a, which is the trap.**
4. **Re-assert the Read dimension bounds on the decoded raster as a
   belt-and-braces check.** Any mismatch between the header-declared dimensions
   and the decoded raster is itself a rejection (`IMAGE_DECODE_FAILED`, §5.2) —
   a file that lies in its header is malformed, not merely large.
   ~~*R4 text: "**Enforce** the Read dimension bounds (§5 ceilings) on the
   decoded raster; out-of-bounds → 400 `IMAGE_DIMENSIONS_UNSUPPORTED`."*~~ —
   **superseded (R5): enforcement moved to §5.0, pre-decode. Enforcing here
   only would mean enforcing after the allocation that causes the OOM. This
   step is now a secondary consistency check, not the guard.**
5. The stored blob and `uploadedImage.format` are the **derived PNG**;
   `uploadedImage.uploadedFormat` records what the device sent (`data-model.md`
   §3.8). PNG and JPEG uploads — **and every pasted image, which is always PNG**
   (A45) — skip step 1 and are stored as-is (**metadata still stripped**) —
   **but they are still subject to §5.0**, whose PNG/JPEG header branches exist
   precisely for them.

**Ordering that must be preserved** (`architecture.md` §Key flows, ADR-0008
R2.2): **transcode → metadata strip → blob write → staged row.** An
interruption at any point therefore leaves either nothing or an **orphan blob
that no row references** — never a row pointing at a missing blob. Orphan blobs
are collected by the 30-day lifecycle purge (`NFR-019`); **no compensating
cleanup code exists and none is to be written.**

**Transcode is the application's largest allocation and the container is small
(0.25 vCPU / 0.5 GiB — `RSK-016` is an owner-accepted residual risk, `A43`).**
Images are processed **strictly serially** (`concurrency = 1`); the transcode
stage runs **inside that same serial path** and must not introduce per-image
concurrency, and the decode buffer for image *n* must be released before image
*n+1* begins. §5.2 specifies what happens when it fails anyway.

#### 5.1a The EXIF trap — the paste path's free stripping is NOT the control *(new, A45)*

**State this explicitly, because it is the single most likely wrong inference
from the A45 change.**

WebKit strips EXIF when a page reads an image **from the clipboard**:
*"Image data read from the clipboard is stripped of EXIF data, which may
contain details such as location information and names."*
(`Context/evidence/clipboard-paste-support.md` Q1d fact 5, `verified`.)

**WebKit does NOT strip EXIF on file upload.** A `<input type="file">`
selection from iOS Photos delivers the file **with its EXIF/GPS/device model
intact**.

Therefore:

| | |
|---|---|
| **REQ-078's explicit, tested EXIF strip STAYS on the upload path.** | It is the **only** thing removing GPS from an uploaded camera-roll photo. It is not redundant, not superseded, and not "handled by the browser". |
| **It also runs on the paste path.** | Not because it is needed there — WebKit already did it — but because the ingest pipeline has exactly one metadata-strip step applied to every accepted image, and a conditional strip is a strip someone will get the condition wrong on. Chrome/Firefox/Edge clipboard behaviour is **not** covered by the WebKit statement. |
| **The free stripping on one route MUST NOT be read as global coverage.** | The two ingest routes have **different** metadata behaviour. `T-SEC-032` therefore asserts the stored blob is EXIF-free **for both sources**, and `T-SEC-033` asserts specifically that a **HEIC upload carrying GPS** lands stripped — the case the paste path can never exercise. |

**A reviewer or agent that deletes the strip step on the grounds that
"pasted screenshots have no EXIF anyway" has removed the privacy control for
the route that actually needs it.** `security.md` §4.2.

### 5.2 Decode failure, OOM, and per-image isolation *(new, R5; `A43-M2`/`A43-M3`)*

#### 5.2.1 The blast radius is exactly one image

A guard rejection, a decode failure or an out-of-memory condition **fails that
image and only that image.** It is named in `rejected[]`; **every other file in
the request is still processed**; the batch stays `draft`, open and
re-attachable. **The request is not failed** — the existing §6.12 partial
acceptance rule governs: **201** whenever `accepted.length > 0`, and only when
*nothing* was accepted does the per-file code become the HTTP status.

**No partial commit is possible, and this does not depend on catching the
error.** A batch becomes user-visible in **one transaction at review-close**
(`diagrams/sequence-full-update-batch.md`); ingest and extraction only *stage*.
Even a hard OOM kill that takes the whole process mid-request cannot
half-apply a batch, because no visible list state has been written. This is a
**structural** property, not an error handler. `T-IMG-018`.

#### 5.2.2 Both OOM paths must be handled — neither alone is sufficient

This is the single most important operational fact in this section
(`architecture.md` §Observability → *Knowing that it OOMed*, ADR-0008 R2.4).
**A design that handles only one of these misses the common case.**

| Path | What actually happens | Container | Application error? | Required handling |
|---|---|---|---|---|
| **P1 — catchable** | A **WASM linear-memory allocation failure inside `libheif-js`** surfaces as a **catchable `RangeError`** (or an Emscripten `abort()`/`OOM`-flavoured `Error`) on the decode call. This is the **good** path and is expected to be the **common** one. | **No restart at all.** | **Yes** | `try { … } catch (e)` around **each individual image's** decode. Classify with `isDecodeOom(e)` (§5.2.3) → **`IMAGE_DECODE_OOM`** in `rejected[]`; **continue the loop with the next image.** `T-IMG-019`. |
| **P2 — uncatchable** | A **kernel/cgroup OOM kill** of the process, or a V8 `FATAL ERROR: … JavaScript heap out of memory`. | **Replica restarts.** | **No — there is no error to catch.** | Nothing can be caught. Containment is **structural**: serial processing, the §5.1 write ordering, and one-transaction close. Detection is the **`image.decode.begin` with no matching `image.decode.end`** sentinel (§9.1) plus the `nextup-prod-replica-restart` alert. The client sees a dropped connection and retries the attach. |

**Corollary the implementer must not "simplify" away:** because **P1 produces
no restart**, an alert or a test resting on restart count alone would never
fire for the common case; and because **P2 produces no application error**, an
error-handler-only design would never see the hard kill. **Both are specified;
both ship.**

#### 5.2.3 Classifying the caught error — `apps/api/src/images/decodeErrors.ts`

```ts
/** True when a caught decode error is a memory-exhaustion signal (path P1). */
export function isDecodeOom(e: unknown): boolean;
//   → true for: RangeError (any message), and any Error whose message matches
//     /out of memory|Cannot enlarge memory|allocation failed|abort\(OOM\)|
//      memory access out of bounds|Array buffer allocation failed/i
//   → false for everything else, which is IMAGE_DECODE_FAILED
```

| Caught | Code | HTTP (when nothing was accepted) | Mentions memory + the up-size remedy? |
|---|---|---|---|
| `isDecodeOom(e) === true` | **`IMAGE_DECODE_OOM`** | **503** | **YES — mandatory** |
| Anything else thrown by the decoder (corrupt/truncated/unsupported HEIC profile, raster/header dimension mismatch per §5.1 step 4) | **`IMAGE_DECODE_FAILED`** | **415** | **NO — forbidden. More memory will never fix a corrupt file, and saying so would send the owner to buy capacity they do not need.** |

**`IMAGE_DECODE_FAILED` is new in R5 and replaces the previous overload of
`UNSUPPORTED_IMAGE_FORMAT` for this case.**
~~*R4 text: "A transcode failure (corrupt/truncated HEIC) rejects **that file
only** with 415 `UNSUPPORTED_IMAGE_FORMAT`."*~~ — **superseded (R5): the two
must stay distinguishable in the log and in the UI (ADR-0008 R2.3), because
one is a file problem and the other is a capacity problem.**
`UNSUPPORTED_IMAGE_FORMAT` retains its original meaning: **the bytes are not a
format nextup accepts at all** (including an unparseable header, §5.0.1
condition 1). `T-IMG-015` / `T-IMG-020`.

**503, and why it is not 500.** `IMAGE_DECODE_OOM` is a capacity condition
with a **known, documented, one-command remedy**, after which the identical
request succeeds. A 500 would be a lie (the failure is understood, and
"nothing was changed" is already guaranteed by §5.2.1) and would collide with
the §7 rule that every 500 message ends *"Nothing was changed."* 503 carries
no `Retry-After`: retrying before the up-size cannot succeed.

#### 5.2.4 The exact surfaced text — verbatim, from ADR-0008 R2.3

These strings are **specified, not suggested**. They are built by
`apps/api/src/images/decodeErrorMessages.ts` and rendered verbatim by the
client (`ui.md` §3.2/§9). `T-IMG-020` asserts each contains the substring
**"memory"** and the substring **`runbooks/scale-up-memory.md`**.

**`IMAGE_TOO_LARGE_TO_DECODE`** (guard rejection, per file in `rejected[]`) —
placeholders `{fileName}`, `{mp}` (1 dp), `{width}`, `{height}`, `{memGiB}`,
`{maxMp}` (1 dp), all filled from the actual request and the actual configured
values, never hard-coded:

> **"`beach-list-03.heic` is 48.0 MP (8064 × 5952). nextup decodes images in a
> 0.5 GiB container and refuses anything above 25.0 MP *before* allocating
> memory, because decoding this one would exhaust container memory and kill
> the import. This is a memory limit, not a problem with your image. Remedy:
> up-size compute to 0.5 vCPU / 1.0 GiB (+~$4/month) — one command, see
> `runbooks/scale-up-memory.md`. No other image in this batch was affected;
> re-attach this file after up-sizing."**

**`IMAGE_DECODE_OOM`**:

> **"`beach-list-03.heic` ran out of memory while being decoded (HEIC → PNG)
> in the 0.5 GiB container. This is a memory limit, not a corrupt file.
> Remedy: up-size compute to 0.5 vCPU / 1.0 GiB (+~$4/month) —
> `runbooks/scale-up-memory.md`. Only this image failed; the rest of the batch
> is intact and nothing has been committed. Re-attach this file after
> up-sizing."**

**`IMAGE_DECODE_FAILED`** — **must not mention memory or the up-size**:

> **"`beach-list-03.heic` couldn't be read — the file appears to be corrupt or
> incomplete. Try re-exporting or re-taking the screenshot and attaching it
> again. Only this image failed; the rest of the batch is intact."**

#### 5.2.5 Retry after up-sizing — reconciled with `REQ-074`

**Mirrored from `architecture.md` §Key flows and ADR-0008 R2.2. Do not
re-derive a different answer.**

| Failure | Image stored? | Retry path after up-sizing |
|---|---|---|
| Guard rejection (`IMAGE_TOO_LARGE_TO_DECODE`) | **No** — refused before allocation and before the blob write | **Re-attach the file.** `REQ-074` **cannot** help: it re-extracts from *retained* images, and nothing was retained |
| Decode OOM/failure (`IMAGE_DECODE_OOM` / `IMAGE_DECODE_FAILED`) | **No** — the transcode precedes the blob write (§5.1) | **Re-attach the file.** `REQ-074` does not apply |
| Hard OOM kill mid-request (P2) | **Possibly an orphan blob**, never a referenced one | **Re-attach the file.** Images already accepted into the open batch remain staged and are not lost |
| Extraction OOM on an **already-stored** image | **Yes** | **`REQ-074` re-extraction** (§6.24 `POST /api/batches/:batchId/re-extract`) — exactly its designed case. No re-attach |

⚠ **`REQ-074`'s retry window is bounded by `NFR-019`'s 30-day purge.** A
reactive remedy implies a delay between failure and fix; past 30 days the
retained image is gone and a re-attach from the phone is the only path
(`runbooks/scale-up-memory.md` §6).


### 5.3 Ingest sources — paste, upload, drop *(new, A45)*

> **The owner's primary capture path is: take a screen grab → paste it
> straight into the app.** Everything specified before A45 said file upload
> only. That is corrected here and in every place it appeared as an
> instruction. **File upload remains a fully supported, first-class path** —
> it is the only route that delivers raw HEIC, and the only route available
> once the screenshot preview's *"Copy"* affordance has gone.

#### 5.3.1 One endpoint, one batch, three affordances

**All three sources post to the SAME route** —
`POST /api/batches/:batchId/images` (§6.12) — with the **same
`multipart/form-data` body**, the **same ceilings**, the **same sniff**, the
**same guard**, and the **same `rejected[]` semantics.**

**There is no `/paste` endpoint, no JSON+base64 variant, and no second batch
model.** The client turns a clipboard `Blob` into a `File` and appends it to
the same `FormData` it would have used for a file input. **A pasted image
APPENDS to the currently open batch**, exactly as attaching one more file
does — this is the existing multi-image batch model (`data-model.md` §3.8,
`UploadBatch` §3.6) and it is reused unchanged.

| Server-side consequence | Rule |
|---|---|
| Multiple pastes in succession | Each is one more `POST .../images` call appending to the same open batch. `batchTotals` accumulates **in two separately-named units** — `uploadedByteSize` and `storedByteSize`, never summed together (§6.12). The 40-image cap and the 60 MiB **uploaded**-bytes ceiling are the only stop; there is deliberately no stored-bytes ceiling, because 40 images × the pixel guard already bounds the stored total, and rejecting a legitimate 40-photo batch (≈700 MiB stored, ≈$0.01 of blob for its 30-day life) would trade a real capture path for nothing. |
| Ordering | `seqInBatch` (and therefore the synthesised name, `data-model.md` §3.8.1) is assigned **server-side in receipt order**. Two pastes racing cannot collide, because ordinals are assigned under the same write that inserts the row. |
| Mixing sources in one batch | **Explicitly allowed and normal.** A batch may hold pasted, dropped and uploaded images together; `ingestSource` is per-image, not per-batch. |
| `service`/`mode` immutability | Unchanged (§6.11, §6.14). Paste does not create a batch — a batch must already be open, exactly as for upload. Pasting with no open batch is a **client-side** condition: the client creates the batch first (`ux-states.md` §4.0a). |

#### 5.3.2 The client primitives — BOTH ship

The two platforms want **opposite** primitives, and each is the right one on
its platform (evidence Q4 design conclusion, Q2 practical read). **Building
only one gives either a broken iPhone experience or a needlessly worse
desktop one.**

| # | Primitive | Where it is the right one | Mechanism |
|---|---|---|---|
| **1** | **A document-level `paste` listener** reading `event.clipboardData.files` | **Desktop** (Chrome, Edge, Firefox, Safari macOS) — Ctrl/Cmd+V. **Zero prompts**: the keystroke *is* the user's explicit paste. | `document.addEventListener('paste', …)`; take `files` (or `items` filtered to `kind === 'file'`). Available Chrome 41+/Edge 12+/Firefox 22+/Safari 10.1+ — i.e. everywhere. **Also works on iOS 11.3+** where a paste is actually initiated. |
| **2** | **A visible "Paste screenshot" BUTTON** whose click handler calls `navigator.clipboard.read()` | **iOS Safari** — the only **verified** reliable path. WebKit responds by showing a native callout bar with a single "Paste" option. iOS 13.4+. | `await navigator.clipboard.read()` **inside** the click handler; find the `ClipboardItem` whose `types` include `image/png`; `await item.getType('image/png')`. |

⚠ **Do NOT rely on a document-level `paste` listener alone on iOS.** Relying
on the user long-pressing the page and finding a Paste option is **not a
supported interaction on non-editable content**. WebKit PR #38127 fixed
clipboard-event *routing* to the focused element; it does **not** establish
that iOS shows a paste callout over arbitrary non-editable content, and no
primary source confirms it either way (evidence Q1c/Q1e caveat 4, explicitly
**unverified**). The button design is mandated **because it routes around
that open question.**

⚠ **Do NOT design around Web Share Target / the iOS Share Sheet.** MDN BCD
records `share_target` as `false` for both `safari` and `safari_ios`, and
WebKit bug 194593 has been **NEW since 2019** (evidence Q5 option A,
`verified`). **RULED OUT.**

⚠ **Do NOT use `<input capture>`.** It opens the **camera**, not the photo
library, and on some browsers bypasses the picker entirely (evidence Q5
option C).

#### 5.3.3 Focus, target and HTTPS

| Rule | Detail |
|---|---|
| **Paste target** | The `paste` listener is on `document`, not on a specific element, so **no focus management is required for the desktop path** and the owner never has to click into a box first. Per the Clipboard API spec, *"the `paste` event fires regardless"* of editable context, bubbles, and is composed (evidence Q1c). |
| **Scoping** | The listener is **mounted only while `/upload` or an open draft batch screen is showing**, and is removed on unmount. A global always-on paste handler would swallow pastes into the fix-match / TMDB search inputs. **If the event target is inside an `<input>` or `<textarea>`, the handler returns without preventing default** — text pasting into search must keep working. `T-PASTE-001`. |
| **`preventDefault()`** | Called **only** when at least one image was found in `clipboardData`. A text-only paste is left entirely alone. |
| **HTTPS is MANDATORY** | **`navigator.clipboard` is simply absent on `http://`** (evidence Q1e caveat 6, `verified`). Primitive 2 therefore does not exist on a plain-HTTP origin. **This WILL bite when testing from the phone against a laptop dev server over a LAN IP** — `http://192.168.x.x:5173` has no `navigator.clipboard` and the button must degrade, not throw (§5.3.4 row `NO_CLIPBOARD_API`). Production is HTTPS-only via Container Apps ingress, so this is a **local-development** hazard, and it is called out here rather than discovered. `T-PASTE-009`. |
| **Every iOS paste costs one extra tap, forever** | iOS shows the callout **per invocation** and **never remembers** the choice (evidence Q1e caveat 1). Do not build a "don't ask again" affordance; there is nothing to remember. |

#### 5.3.4 Clipboard failures are CLIENT-SIDE — no HTTP request is made

**No new HTTP error code is introduced by A45, and §8's closed enumeration is
unchanged.** Every clipboard failure below happens **before** any request:
there are no bytes to send.

| Client condition | Detection | Behaviour — see `ux-states.md` |
|---|---|---|
| `NO_CLIPBOARD_API` | `!navigator.clipboard \|\| typeof navigator.clipboard.read !== 'function'` — non-HTTPS origin, or a browser older than Safari 13.4 / Chrome 76 / Firefox 127 | **Hide the "Paste screenshot" button entirely** and show the file-upload and drag-drop affordances, which are unaffected. Never render a button that cannot work. §4.16 |
| `PERMISSION_DENIED` | The `clipboard.read()` promise rejects with `NotAllowedError` | Re-offer the button with an explanation. §4.13 |
| `CLIPBOARD_EMPTY` | `read()` resolves with zero `ClipboardItem`s | *"There's nothing on your clipboard."* §4.14 |
| `NO_IMAGE_ON_CLIPBOARD` | Items resolve but none has `image/png` (or any `image/*`) in `.types` | *"What's on your clipboard isn't an image."* Name what was found (text/URL) if known. §4.14 |
| `PASTE_ABANDONED` | The promise rejects **without** the owner having done anything they'd recognise as a refusal | **The brittle one, and it must be handled.** *"Tapping or clicking anywhere in the page … or performing any other actions, such as switching tabs or hiding Safari, will cause the promise to be rejected"* (evidence Q1d, `verified`). **The UI MUST detect the rejection and re-offer the button — it must never appear to hang.** §4.15, `T-PASTE-008` |

**Implementation rule:** `clipboard.read()` is wrapped so that **every**
rejection resolves into one of the states above within the same tick. There is
no timeout-based spinner on this path, because there is no pending state to
time out — the promise always settles.

---

## 6. Route detail

Unless stated otherwise every route returns **401 `UNAUTHENTICATED`** without a
valid principal, **403 `NOT_ALLOWED`** for a principal outside the allow-list,
and **404 `NOT_FOUND`** for a resource id that does not exist *in the caller's
scope* (a resource belonging to another owner is indistinguishable from a
nonexistent one — NFR-008, `T-SEC-002`).

### 6.1 `GET /api/me`

**200**
```jsonc
{
  "ownerId": "o_9f2c1a7b",
  "displayName": "sam@example.com",
  "signOutUrl": "/.auth/logout",
  "attribution": {
    "tmdbDisclaimer": "This product uses the TMDB API but is not endorsed or certified by TMDB.",
    "tmdbLogoPath": "/assets/tmdb-logo.svg"
  }
}
```
The disclaimer string is served from the API — **one source, verbatim,
never re-typed in a component** (US-011 AC-2/AC-5). It is exported as
`TMDB_DISCLAIMER` from `packages/domain/src/attribution.ts`, and `T-ATTR-001`
asserts the API value, the constant and the rendered DOM text are byte-equal.

### 6.2 `GET /api/titles` — the combined list (US-018, US-019, US-020)

Query: `service` (`netflix|max`, repeatable), `type` (`movie|tv`),
`genre` (string, repeatable), `sort` (`dateAdded`, default),
`dir` (`desc` default | `asc`), `limit`, `cursor`.

Semantics:
- Returns titles with `state === 'active'` and `visible === true` only.
- **Suppressed works are excluded** (REQ-024) — enforced by a left-anti-join
  against active suppressions in the repository, not by the caller.
- `service` filters on **badges**, i.e. titles holding an `active` listing on
  any requested service (REQ-032, US-019 AC-2). It does **not** hide the
  title's other badges.
- Multiple filters combine with **AND** across dimensions and **OR** within a
  dimension (US-019 AC-4).
- `genre: []` on a title excludes it from any genre-filtered result and
  includes it when no genre filter is set (US-019 AC-6). **Genres are never
  defaulted.**
- Ordering per data-model §5.3, tie-broken by `title.id` ascending.
- **Lazy TMDB refresh runs here** — §6.4.

**200**
```jsonc
{
  "items": [
    {
      "titleId": "01J8ZC...",
      "workIdentity": "tmdb:movie:438631",
      "matchState": "matched",
      "name": "Dune",
      "mediaType": "movie",
      "releaseYear": 2021,
      "genres": ["Science Fiction", "Adventure"],
      "runtimeMinutes": 155,
      "posterPath": "/d5NXSklXo0qyIYkgV94XAgMIckC.jpg",
      "badges": [
        { "service": "netflix", "listingId": "01J8ZD...", "dateAdded": "2026-04-02" },
        { "service": "max",     "listingId": "01J8ZE...", "dateAdded": "2026-06-11" }
      ],
      "sortDateAdded": "2026-04-02",
      "dateAddedLabel": "Added to nextup 2 Apr 2026"
    }
  ],
  "nextCursor": null,
  "limit": 50
}
```

**`dateAddedLabel` is computed server-side** so the REQ-061 honest-labelling
rule has exactly one implementation. It **never** reads as a bare "Added" and
**never** implies a streaming-service date. `T-LIST-018` asserts every rendered
date label contains the substring `"to nextup"`.

`badges` contains only `active` listings (REQ-026).

### 6.3 `GET /api/titles/:titleId`

Same item shape plus `removedListings[]` (state, service, `removedAt`),
`createdByBatchId`, `createdAt`.

### 6.4 Lazy TMDB refresh (REQ-076, NFR-014) — no scheduler exists

Executed **only** inside `GET /api/titles`, `GET /api/titles/:titleId` and
`GET /api/batches/:batchId/review`, and **only for the titles in the page being
returned**:

```ts
const stale = pageItems.filter(t =>
  t.tmdb !== null &&
  ageInDays(t.tmdb.fetchedAt) > TMDB_METADATA_MAX_AGE_DAYS   // 183
);
await refreshFromTmdb(stale);   // at most `limit` items; concurrency 4; 5s budget
```

- A title never displayed is never refreshed (REQ-076).
- If TMDB is unreachable, the **stored** metadata is returned unchanged with
  `"metadataStale": true` on the item and the response still succeeds. The list
  never fails because of TMDB.
- The refresh budget is 5 seconds; items not refreshed within it are returned
  stale-flagged and retried on the next view.
- **This is not a background job.** It is synchronous within an
  owner-initiated request, which is precisely why REQ-041 is satisfied.
  `T-CI-005` (`specs/ai.md` §10) asserts no timer exists anywhere.

### 6.5 `POST /api/titles/:titleId/fix-match` (US-030)

Body: `{ "tmdbId": 438631, "mediaType": "movie", "confirmDuplicate": false }`

| Status | Code | When |
|---|---|---|
| 200 | — | applied |
| 409 | `TARGET_WORK_SUPPRESSED` | an active suppression holds the target identity; `details.suppressionId` and `details.unsuppressHref` are returned (US-030 AC-5) |
| 409 | `DUPLICATE_WORK_IDENTITY` | an active visible title already holds it and `confirmDuplicate !== true`; `details.existingTitleId` (US-030 AC-4) |
| 404 | `TMDB_WORK_NOT_FOUND` | TMDB has no such work |

**200**
```jsonc
{
  "titleId": "01J8ZC...",
  "workIdentity": "tmdb:movie:438631",
  "preserved": { "listingIds": ["01J8ZD..."], "dateAdded": { "01J8ZD...": "2026-04-02" }, "sortDateAdded": "2026-04-02" },
  "suppressionMigrated": { "from": "unmatched:9f2c1a7b4e0d5c83", "to": "tmdb:movie:438631" }
}
```
`suppressionMigrated` is `null` when nothing moved (data-model §6.3, SD-06).

### 6.6 `POST /api/titles/:titleId/suppress` (US-027)

Body: `{}`. **200** `{ "suppressionId": "supp:tmdb:movie:438631", "workIdentity": "...", "alreadySuppressed": false }`
Idempotent (US-027 AC-4). Suppression is **per work, not per service** —
suppressing a two-badge title removes the whole row (US-027 AC-5).

### 6.7 `GET /api/suppressions` (US-029)

Returns `active === true` suppressions, most recent first, with
`displaySnapshot`, and per item:
`"identityStability": "stable" | "text-derived"` — `text-derived` for
`unmatched:*`, which the UI renders with the caveat (data-model §2.3.1).

### 6.8 `POST /api/suppressions/:suppressionId/unsuppress` (US-029)

**200** `{ "suppressionId": "...", "active": false, "restoredAnything": false }`
`restoredAnything` is **always `false`** — un-suppression never restores a row
(US-029 AC-4). The field exists so the client copy can say so explicitly.
The document is never deleted (REQ-028, US-029 AC-2).

### 6.9 `GET /api/removed` (US-023, US-024)

Query: `q` (title text, 1..100), `service`, `limit`, `cursor`.
**One item per removed listing.** Never de-duplicated (data-model §11).

**200**
```jsonc
{
  "items": [
    {
      "listingId": "01J8ZD...",
      "titleId": "01J8ZC...",
      "workIdentity": "tmdb:movie:438631",
      "name": "Dune",
      "releaseYear": 2021,
      "posterPath": "/d5NXS.jpg",
      "service": "netflix",
      "dateAdded": "2026-04-02",
      "removedAt": "2026-07-14T09:31:02.117Z",
      "removedByBatchId": "01J8YY...",
      "removalOrdinal": 2,
      "removalTotalForWork": 3,
      "restorable": true,
      "suppressed": false
    }
  ],
  "nextCursor": null, "limit": 50
}
```
`removalOrdinal`/`removalTotalForWork` are what make repetition read as history
(US-024 AC-6). Ordering: `removedAt` descending, tie-broken by `listingId`
ascending.

### 6.10 `POST /api/listings/:listingId/restore` (US-025)

Body: `{ "confirmDuplicate": false }`

| Status | Code | When |
|---|---|---|
| 200 | — | restored; `dateAdded` is the **original**, not today (US-025 AC-2) |
| 409 | `WORK_SUPPRESSED` | the work is actively suppressed; `details.unsuppressHref` (US-025 AC-6) |
| 409 | `DUPLICATE_WORK_IDENTITY` | an active title already holds this work and `confirmDuplicate !== true`; `details.existingTitleId` (US-025 AC-5) |
| 409 | `LISTING_NOT_REMOVED` | already active (US-025 AC-4) |

**200**
```jsonc
{ "listingId": "01J8ZD...", "titleId": "01J8ZC...", "state": "active",
  "dateAdded": "2026-04-02", "titleState": "active", "sortDateAdded": "2026-04-02" }
```

### 6.11 `POST /api/batches` (US-003, US-005)

Body: `{ "service": "netflix", "mode": "full-update" }` — **both required**;
there is **no default mode** (US-003 AC-5). Omitting either is 400
`VALIDATION_FAILED`.

**201**
```jsonc
{ "batchId": "01J8ZF...", "service": "netflix", "mode": "full-update",
  "status": "draft", "createdAt": "2026-08-10T20:00:00.000Z",
  "modeExplanation": "Full update: anything on Netflix that isn't in these screenshots will be offered for removal." }
```
`modeExplanation` is server-supplied so the plain-language consequence
(US-003 AC-2/AC-3) has one wording. **409 `OPEN_BATCH_EXISTS`** with
`details.batchId` when a batch is already open (US-005 AC-5).

### 6.12 `POST /api/batches/:batchId/images` (US-004)

`multipart/form-data`, field name `files` (1..10 per request).

**(A45) This is the ONE ingest route for all three sources — paste, drag-drop
and file upload.** There is no second endpoint and no JSON+base64 variant.
The request gains **one optional text field**:

| Field | Type | Rule |
|---|---|---|
| `files` | 1..10 file parts | Unchanged. A pasted image is appended to this same `FormData` as a `File` built from the clipboard `Blob`. |
| **`ingestSource`** *(new, A45)* | text, one of `paste` \| `upload` \| `drop` | **Optional. Defaults to `upload`** when absent, so an older/simpler client keeps working. Applies to **every** file part in the request; a client mixing sources sends separate requests (it naturally does — a paste is one event). Parsed by the Zod schema like any other input; an unknown value is **400 `VALIDATION_FAILED`**. |

⚠ **`ingestSource` is PROVENANCE, never a control input.** It is recorded on
the row (`data-model.md` §3.8) and emitted in the decode sentinel (§9.1). It
**MUST NOT** select a code path: it must not skip the sniff, the guard, the
metadata strip, the ceilings, or the transcode condition — that condition is
on the **sniffed format** (§5.1). `T-IMG-023`, `T-PASTE-006`.

**`fileName` for a pasted part.** The clipboard supplies no usable name, so
the **server** synthesises one per `data-model.md` §3.8.1
(`pasted-YYYYMMDD-HHMMSS-NN.png`) and echoes it in `accepted[]`/`rejected[]`.
The client **may** send `image.png`; the server **ignores** any filename on a
part whose `ingestSource === 'paste'`. For `upload`/`drop` the device-supplied
name is kept, sanitised to 255 chars, and — as always — used **only** for
display, never to compose a path (`security.md` T4). `T-PASTE-005`.

**201**
```jsonc
{ "accepted": [ { "imageId": "01J8ZG...", "fileName": "IMG_0421.PNG", "format": "png",
                  "uploadedFormat": "png", "ingestSource": "upload",
                  "byteSize": 842113, "width": 1170, "height": 2532 },
                { "imageId": "01J8ZH...", "fileName": "IMG_0500.HEIC", "format": "png",
                  "uploadedFormat": "heic", "ingestSource": "upload",
                  "byteSize": 1904221, "width": 3024, "height": 4032 },
                { "imageId": "01J8ZJ...", "fileName": "pasted-20260811-154233-03.png", "format": "png",
                  "uploadedFormat": "png", "ingestSource": "paste",
                  "byteSize": 731004, "width": 1179, "height": 2556 } ],
  "rejected": [ { "fileName": "notes.pdf", "code": "UNSUPPORTED_IMAGE_FORMAT",
                  "message": "nextup accepts PNG, JPEG and HEIC screenshots." },
                { "fileName": "beach-list-03.heic", "code": "IMAGE_TOO_LARGE_TO_DECODE",
                  "message": "beach-list-03.heic is 48.0 MP (8064 × 5952). nextup decodes images in a 0.5 GiB container and refuses anything above 25.0 MP before allocating memory, because decoding this one would exhaust container memory and kill the import. This is a memory limit, not a problem with your image. Remedy: up-size compute to 0.5 vCPU / 1.0 GiB (+~$4/month) — one command, see runbooks/scale-up-memory.md. No other image in this batch was affected; re-attach this file after up-sizing.",
                  "details": { "width": 8064, "height": 5952, "megapixels": 48.0,
                               "maxMegapixels": 25.0, "remedy": "runbooks/scale-up-memory.md" } } ],
  "batchTotals": { "imageCount": 7, "uploadedByteSize": 5931002, "storedByteSize": 41209884 } }
```
`format` is the **stored/derived** format (always `png`/`jpeg`);
`uploadedFormat` is what the device delivered (`png`/`jpeg`/`heic`/`heif`);
**`ingestSource` is how it arrived (`paste`/`upload`/`drop`)**. A HEIC/HEIF
upload is accepted, then transcoded to lossless PNG on ingest (§5.1), so
`format` is `png` while `uploadedFormat` is `heic`. **A pasted image is always
`uploadedFormat: 'png'` in practice and skips the transcode as a no-op — the
stage is still there, and still runs for the HEIC upload above** (§5.1).
`byteSize`/`width`/`height` describe the **stored** (post-transcode) bytes.
⚠ **`batchTotals` carries TWO totals and they are never summed together.**
`uploadedByteSize` is what the device sent — the unit
`MAX_BATCH_UPLOAD_BYTES` (60 MiB) bounds. `storedByteSize` is what is held in
Blob Storage after the transcode, and is **not** bounded by a batch ceiling
(§5.3.1). They differ by the transcode ratio, which is ~8.5× on real phone
HEIC (1.76 MiB in, 17.8 MiB stored), so the example above shows a 5.9 MiB
upload holding 41 MiB. ~~Superseded: a single `"byteSize"` total. It mixed the
two units into one number and compared it against the upload ceiling, so the
ceiling under-counted the incoming file and over-counted everything already
held — firing a `413 BATCH_TOO_LARGE` reading "at most 60 MiB" after ~7 MiB of
actual uploads.~~
**Partial acceptance is deliberate** (US-004 AC-6): valid files in a
multi-file request are accepted and invalid ones are named individually. The
response is **201** whenever `accepted.length > 0`, and **415/413/400/503**
with the matching code when *nothing* was accepted. Only a ceiling breach that
would be exceeded by the request as a whole (§5) rejects the request outright.
`409 BATCH_NOT_DRAFT` once the batch has been submitted.

**(R5) A `rejected[]` entry may now carry `IMAGE_TOO_LARGE_TO_DECODE`,
`IMAGE_DECODE_OOM` or `IMAGE_DECODE_FAILED` (§5.0, §5.2), with the message
given verbatim in §5.2.4. Every element of `rejected[]` has the shape
`{ fileName, code, message, details? }` and `details` — when present — is an
object; the guard/OOM entries carry `{ width, height, megapixels,
maxMegapixels, remedy }`. A memory failure on one file NEVER removes an
already-accepted file from `accepted[]` and never changes `batchTotals` for
the others (`T-IMG-018`).**

### 6.13 `DELETE /api/batches/:batchId/images/:imageId`

**204** while `status === 'draft'` (US-004 AC-4); **409 `BATCH_NOT_DRAFT`**
afterwards. Deletes the blob and the `uploadedImage` document. This is the one
place an `uploadedImage` is deleted, and it is a pre-submit correction, not
history (data-model I-7 exempts pre-submit draft images).

### 6.14 `POST /api/batches/:batchId/submit` (US-005, US-006)

**202**
```jsonc
{ "batchId": "01J8ZF...", "status": "submitted", "imageCount": 7,
  "submittedAt": "2026-08-10T20:04:11.902Z", "pollAfterMs": 2000 }
```
- **400 `NO_IMAGES`** when the batch holds zero images.
- **409 `BATCH_NOT_DRAFT`** on a second submit.
- Extraction runs **in-process, asynchronously**; the client polls
  `GET /api/batches/:batchId` (US-006 AC-1). The HTTP request does not wait.
- `service` and `mode` become immutable here (US-003 AC-6).

### 6.15 `GET /api/batches/:batchId`

**200**
```jsonc
{ "batchId": "01J8ZF...", "service": "netflix", "mode": "full-update",
  "status": "in-review", "derivedFromBatchId": null,
  "createdAt": "...", "submittedAt": "...", "completedAt": null,
  "images": [ { "imageId": "01J8ZG...", "fileName": "IMG_0421.PNG",
                "ingestSource": "upload",
                "available": true, "retainUntil": "2026-09-09T20:03:00.000Z",
                "candidateCount": 14, "href": "/api/images/01J8ZG..." } ],
  "extractionStats": { "imagesProcessed": 7, "imagesWithZeroCandidates": 1,
                       "candidatesRaw": 96, "candidatesAfterCleanup": 71,
                       "candidatesCollapsed": 6, "matched": 63, "unmatched": 2,
                       "suppressedGated": 1, "estimatedCostUsd": 0.0312 },
  "extractionError": null,
  "lowYield": false,
  "progress": { "imagesDone": 7, "imagesTotal": 7 } }
```
`progress` is present while `status` is `submitted` or `extracting`
(US-006 AC-1). `href` is an **API path**, never a blob URL (NFR-020).

### 6.16 `POST /api/batches/:batchId/retry-extraction` (US-006)

**202**, same body as submit. Valid only from `extraction-failed`; otherwise
**409 `BATCH_NOT_FAILED`**. Re-runs the **same** batch; does not create a new
one (contrast §6.21).

### 6.17 `GET /api/batches/:batchId/review` (US-012, US-013, US-014)

**409 `BATCH_NOT_IN_REVIEW`** unless `status === 'in-review'`.

**200**
```jsonc
{
  "batchId": "01J8ZF...", "service": "netflix", "mode": "full-update",
  "lowYield": false,
  "degradedExtraction": false,
  "crossCheck": "ok",
  "banner": null,
  "sections": {
    "additions": {
      "label": "New to your list",
      "count": 9,
      "items": [
        { "candidateId": "cand:01J8ZF...:01J8ZG...:3", "rawText": "Dune",
          "inferredTitle": "Dune", "basis": "both",
          "ocrSupport": "exact", "provider": "llm",
          "verdict": "title-candidate", "ocrConfidence": 0.97,
          "resolvedWorkIdentity": "tmdb:movie:438631",
          "match": { "tmdbId": 438631, "mediaType": "movie", "name": "Dune",
                     "releaseYear": 2021, "posterPath": "/d5NXS.jpg",
                     "score": 1.0, "uncertain": false, "ambiguous": false },
          "alternatives": [ { "tmdbId": 41733, "mediaType": "movie", "name": "Dune", "releaseYear": 1984, "posterPath": "/x.jpg", "score": 0.94 } ],
          "sourceImageIds": ["01J8ZG..."],
          "disposition": "pending" }
      ]
    },
    "alreadyOnYourList": {
      "label": "Already on your list",
      "count": 54,
      "collapsedByDefault": true,
      "omitted": false,
      "items": [ /* same item shape */ ]
    },
    "probablyNotTitles": {
      "label": "Probably not titles",
      "count": 25, "collapsedByDefault": true, "omitted": false,
      "items": [ /* verdict 'chrome-suspected' */ ]
    },
    "unmatched": {
      "label": "Couldn't identify these",
      "count": 2,
      "items": [ /* resolvedWorkIdentity starts 'unmatched:' */ ]
    },
    "unreadableTiles": {
      "label": "Couldn't read these",
      "count": 1,
      "items": [ /* verdict 'unreadable-tile': thumbnail only, rawText may be "" */ ]
    },
    "removals": {
      "label": "No longer on Netflix",
      "count": 3,
      "withheld": false,
      "withheldReason": null,
      "items": [
        { "listingId": "01J8ZD...", "titleId": "01J8ZC...", "name": "Heat",
          "releaseYear": 1995, "posterPath": "/h.jpg", "service": "netflix",
          "dateAdded": "2026-01-04", "ticked": true }
      ]
    }
  },
  "imagesWithNoText": [ { "imageId": "01J8ZH...", "fileName": "IMG_0428.PNG" } ]
}
```

**Mode contract (REQ-057, US-013 AC-6) — the safety property:**

| Section | `append-only` | `full-update` |
|---|---|---|
| `additions` | present | present |
| `alreadyOnYourList` | **`"omitted": true, "items": [], "count": 0`** | **present with the true count and all items** |
| `probablyNotTitles` | present | present |
| `unmatched` | present | present |
| `unreadableTiles` *(new, R2)* | present | present |
| `removals` | **`"omitted": true`** (REQ-022 — absence means nothing) | present unless `withheld` |

`removals.withheld === true` with
`withheldReason: "low-yield"` implements `specs/ai.md` §8.2. `T-REV-006` and
`T-AI-021`.

**Revision-2 additions to this response (ADR-0001 R2):**

| Field | Type | Meaning |
|---|---|---|
| `degradedExtraction` | `boolean` | `true` when only one of the two readers ran. Drives the non-dismissible banner in `specs/ux-states.md` §5.9/§5.10. |
| `crossCheck` | `'ok' \| 'ocr-unavailable' \| 'llm-unavailable'` | Which reader was missing, so the banner can be specific. |
| Per item: `inferredTitle` | `string \| null` | The model's structured, de-truncated title. `null` on `ocr-only` orphans. |
| Per item: `basis` | `'text' \| 'artwork' \| 'both' \| 'unknown'` | What the title was read from. `'artwork'` is the RSK-021 path. |
| Per item: `ocrSupport` | `'exact' \| 'partial' \| 'none' \| 'not-checked'` | Independent corroboration. `'none'` ⇒ verdict `inferred-unverified` ⇒ the client **must** render the tile thumbnail (`T-AI-041`). |
| Per item: `provider` | `'llm' \| 'ocr-only'` | `'ocr-only'` is an omission-recovery orphan — text the OCR leg saw and the model did not report. |

⚠ **`withheldReason` gains `"degraded-extraction"`.** When
`crossCheck === 'llm-unavailable'` in `full-update` mode, removals are
**withheld** by the same mechanism as low yield: an incomplete read would
propose removing titles that are still on the list. This is the single most
important consequence of the Revision-2 degraded path and it is asserted by
**`T-AI-036`**.

**Every removal item arrives `ticked: true`** (REQ-055, US-015 AC-1).

### 6.18 `PATCH /api/batches/:batchId/candidates/:candidateId`

Body (exactly one form):
```jsonc
{ "disposition": "confirmed" }
{ "disposition": "discarded" }
{ "disposition": "corrected", "tmdbId": 41733, "mediaType": "movie" }
{ "disposition": "pending" }
{ "reclassifyAsTitle": true }        // rescues a 'chrome-suspected' item; re-runs matching for it
```
**200** returns the updated candidate. A correction re-resolves
`workIdentity` immediately so the review pass shows the corrected match before
close (US-007 AC-3). **409 `BATCH_NOT_IN_REVIEW`** otherwise.

### 6.19 `POST /api/batches/:batchId/candidates/confirm-all`

Body: `{ "section": "additions" | "unmatched" | "alreadyOnYourList" }`
Sets every `pending` item in that section to `confirmed`. **200**
`{ "section": "additions", "confirmed": 9, "skipped": 0 }`.
This is the OQ-011 bulk affordance (`specs/ux-states.md` §4.4). It is an
explicit action, so REQ-014's no-accept-by-inaction rule is intact.

### 6.20 `POST /api/batches/:batchId/manual-entry` (US-009)

Body: `{ "tmdbId": 66732, "mediaType": "tv" }`
Adds a title the extraction missed, as part of this batch, subject to the same
review and the same suppression gate.
**201** `{ "candidateId": "cand:...:manual:1", "resolvedWorkIdentity": "tmdb:tv:66732", "disposition": "confirmed" }`
**409 `WORK_SUPPRESSED`** if actively suppressed.
**409 `ALREADY_IN_BATCH`** if the work is already a candidate in this batch.

### 6.21 `PATCH /api/batches/:batchId/removals` (US-015)

Body: `{ "untick": ["01J8ZD..."], "tick": ["01J8ZE..."] }`
**200** `{ "tickedCount": 2, "untickedCount": 1, "totalCount": 3 }`
Unticking a removal is the **rescue** path (REQ-021, US-015 AC-2). Unticking
all of them is valid and yields a zero-member removal group at close
(US-015 AC-5).

### 6.22 `POST /api/batches/:batchId/close` (US-012, US-016, US-021)

Body:
```jsonc
{ "confirmRemovals": true }   // REQUIRED in full-update when removals.count > 0 and not withheld
```

| Status | Code | When |
|---|---|---|
| 200 | — | applied |
| 409 | `PENDING_ADDITIONS` | any `additions` or `unmatched` item is still `pending`; `details.pendingCandidateIds` (US-012 AC-3) |
| 409 | `REMOVALS_NOT_CONFIRMED` | full-update, `removals.count > 0`, `confirmRemovals !== true` (REQ-020, US-016 AC-2) |
| 409 | `BATCH_NOT_IN_REVIEW` | wrong status |

**Removal is never a side effect of closing.** `confirmRemovals: true` is the
owner's single group confirmation (REQ-020). `T-REV-005` asserts a close
without it, with removals present, writes nothing.

**200**
```jsonc
{
  "batchId": "01J8ZF...", "status": "applied", "completedAt": "2026-08-10T20:19:44.007Z",
  "summary": {
    "titlesCreated": 6, "listingsCreated": 9, "listingsRemoved": 3,
    "unresolvedKept": 1, "discarded": 25, "suppressedGated": 1,
    "removalGroupId": "01J8ZK..."
  },
  "serviceState": { "service": "netflix", "lastCompletedBatchAt": "2026-08-10T20:19:44.007Z" },
  "undoable": true
}
```
`undoable` is `provenance.modified.length === 0 && provenance.removed.length === 0`
(data-model §8.3). An `unmatched` candidate left `unresolved` is **kept as an
unmatched Title, not discarded** (US-008 AC-4), and counted in
`unresolvedKept`.

### 6.23 `POST /api/batches/:batchId/discard` (US-005)

**200** `{ "batchId": "...", "status": "discarded", "listStateChanged": false }`
Valid from `draft`, `in-review`, `extraction-failed`. Images are **retained**
(NFR-019 governs them, not the discard). Writes nothing to the list.

### 6.24 `POST /api/batches/:batchId/re-extract` (US-034)

**202** `{ "batchId": "01J8ZM...", "derivedFromBatchId": "01J8ZF...", "status": "submitted", "service": "netflix", "mode": "full-update", "imageCount": 7 }`
**410 `IMAGES_PURGED`** when any image is past `retainUntil`, with
`details.purgedImageIds` and the retention explanation (US-034 AC-5).
**409 `OPEN_BATCH_EXISTS`** if another batch is open.

### 6.25 `POST /api/batches/:batchId/undo` (US-032, US-033)

**200**
```jsonc
{ "batchId": "01J8ZF...", "status": "undone", "undoneAt": "...",
  "reversed": { "titlesDeleted": 6, "listingsRemoved": 9 },
  "serviceState": { "service": "netflix", "lastCompletedBatchAt": "2026-05-02T11:00:00.000Z" } }
```
**409 `BATCH_NOT_CREATES_ONLY`** with the full enumeration — data-model §8.4.
**409 `BATCH_ALREADY_UNDONE`**. **409 `BATCH_NOT_APPLIED`**.

### 6.26 `POST /api/removal-groups/:groupId/undo` (US-017)

**200**
```jsonc
{ "groupId": "01J8ZK...", "restoredListingIds": ["01J8ZD..."],
  "heldBack": [ { "listingId": "01J8ZE...", "reason": "work-suppressed",
                  "name": "Heat", "unsuppressHref": "/api/suppressions/supp:tmdb:movie:949/unsuppress" } ] }
```
**409 `GROUP_ALREADY_REVERSED`**. **500 `PARTIAL_FAILURE_PREVENTED`** with
`{ "applied": false }` if the group cannot be applied whole (US-017 AC-6).

### 6.27 `GET /api/images/:imageId` (US-036, NFR-020, ADR-0006)

The **only** way image bytes are ever served. **No SAS token, no blob URL, no
public container** exists in the system (US-036 AC-2/AC-4).

| Status | When | Body |
|---|---|---|
| 200 | owner's image, within retention, blob present | raw bytes |
| 404 | image id not in the caller's scope | error envelope (US-036 AC-3 — indistinguishable from nonexistent) |
| 410 | `retainUntil` passed, **or** the blob is absent | `{ "error": { "code": "IMAGE_EXPIRED", "message": "This screenshot was removed 30 days after upload.", "details": { "retainUntil": "..." } } }` |

Response headers on 200 (all mandatory, `T-IMG-002`):
```
Content-Type: image/png | image/jpeg
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
Content-Disposition: inline
Content-Length: <bytes>
```
The served bytes are always the **stored/derived** format — a HEIC/HEIF upload
was transcoded to PNG on ingest (§5.1), so `image/heic` is **never** served and
every browser (not only Safari) can render the response.
**A missing blob is 410, never 500** (ADR-0006). `T-IMG-005`.

### 6.28 `GET /api/service-state` (US-022)

**200**
```jsonc
{ "services": [
    { "service": "netflix", "lastCompletedBatchAt": "2026-08-10T20:19:44.007Z",
      "lastCompletedBatchId": "01J8ZF...", "ageDays": 0,
      "label": "Netflix updated today" },
    { "service": "max", "lastCompletedBatchAt": null, "lastCompletedBatchId": null,
      "ageDays": null,
      "label": "Max has never been updated" }
  ] }
```
`lastCompletedBatchAt: null` renders as **"never updated"**, explicitly not as
an error (US-022 AC-3). Only `applied` batches count
(US-022 AC-4/AC-5). *(REQ-040, the list-staleness nudge, and the `stale` /
`stalenessThresholdDays` fields it drove, were dropped entirely at A46 — no
staleness threshold, no nag, no derived "stale" state. ASM-038 is retired.)*

### 6.29 `GET /api/tmdb/search` (US-007, US-009, US-030)

Query: `q` (1..100, required), `type` (`movie|tv`, optional), `limit` (1..20,
default 10).
**200** `{ "items": [ { "tmdbId": 438631, "mediaType": "movie", "name": "Dune", "releaseYear": 2021, "posterPath": "/d5NXS.jpg" } ] }`
**502 `TMDB_UNAVAILABLE`** when TMDB cannot be reached — *"Couldn't reach TMDB.
Try again in a moment."* The API key is never proxied to the client.

---

## 7. Status-code policy

| Code | Meaning in nextup |
|---|---|
| 200 | Applied / returned |
| 201 | Created (batch, images, manual entry) |
| 202 | Accepted for asynchronous extraction |
| 204 | Deleted (draft image only) |
| 400 | Malformed or invalid input, ceiling breach that is not a size breach |
| 401 | No valid principal |
| 403 | Authenticated but not allow-listed |
| 404 | Not found **in the caller's scope** |
| 409 | State conflict — the resource exists but the operation is not valid **now**. **Every 409 body names the remedy.** |
| 410 | The resource existed and is permanently gone by design (expired image) |
| 413 | Size ceiling — **including the pre-decode pixel ceiling** `IMAGE_TOO_LARGE_TO_DECODE` (R5, §5.0) |
| 415 | Unsupported image format — bytes that are not an accepted format, an unparseable header, **or a corrupt/truncated file that failed to decode (`IMAGE_DECODE_FAILED`, R5)** |
| 500 | Unexpected. Message always ends "Nothing was changed." |
| **503** *(new, R5)* | **`IMAGE_DECODE_OOM` only.** The decode exhausted container memory. **Not a 500**: the cause is known, nothing was changed (§5.2.1), and there is a documented one-command remedy (`runbooks/scale-up-memory.md`). **No `Retry-After` header** — retrying before the up-size cannot succeed. |
| 502 | Upstream (TMDB) unavailable |

**No 3xx from `/api/*`.** Authentication redirects are issued by Container Apps
Easy Auth on non-API paths; an unauthenticated `/api/*` call receives **401 with
a JSON envelope**, never an HTML sign-in page (`T-SEC-008`).

---

## 8. Error codes — the closed enumeration

`packages/domain/src/errorCodes.ts`:

```
VALIDATION_FAILED, INVALID_CURSOR, UNAUTHENTICATED, NOT_ALLOWED, NOT_FOUND,
INTERNAL_ERROR, STORE_SCHEMA_VIOLATION,
OPEN_BATCH_EXISTS, BATCH_NOT_DRAFT, BATCH_NOT_IN_REVIEW, BATCH_NOT_FAILED,
BATCH_NOT_APPLIED, BATCH_IMMUTABLE, BATCH_ALREADY_UNDONE,
BATCH_NOT_CREATES_ONLY, NO_IMAGES, PENDING_ADDITIONS, REMOVALS_NOT_CONFIRMED,
ALREADY_IN_BATCH,
TOO_MANY_IMAGES, IMAGE_TOO_LARGE, BATCH_TOO_LARGE, TOO_MANY_FILES_IN_REQUEST,
PAYLOAD_TOO_LARGE, UNSUPPORTED_IMAGE_FORMAT, IMAGE_DIMENSIONS_UNSUPPORTED,
IMAGE_TOO_LARGE_TO_DECODE, IMAGE_DECODE_OOM, IMAGE_DECODE_FAILED,
IMAGE_EXPIRED, IMAGES_PURGED,
DUPLICATE_WORK_IDENTITY, WORK_SUPPRESSED, TARGET_WORK_SUPPRESSED,
LISTING_NOT_REMOVED, GROUP_ALREADY_REVERSED, PARTIAL_FAILURE_PREVENTED,
TMDB_WORK_NOT_FOUND, TMDB_UNAVAILABLE
```
`T-API-003` asserts every code thrown anywhere in `apps/api/src` is a member of
this union (type-level) and that every member has at least one test.

**(R5, `A43-M3`) The three memory/decode codes — corrected in place in the
union above, because this list is an instruction a machine executes:**

| Code | HTTP | Meaning | Message MUST name memory + `runbooks/scale-up-memory.md`? |
|---|---|---|---|
| **`IMAGE_TOO_LARGE_TO_DECODE`** *(new)* | 413 | `width × height > NEXTUP_MAX_DECODE_PIXELS`, decided **pre-decode** from the header (§5.0) | **Yes — mandatory** |
| **`IMAGE_DECODE_OOM`** *(new)* | 503 | The decode was attempted and exhausted memory — the catchable path P1 (§5.2.2) | **Yes — mandatory** |
| **`IMAGE_DECODE_FAILED`** *(new)* | 415 | Corrupt/truncated/unsupported-profile file; header/raster dimension mismatch | **NO — forbidden.** More memory will never fix it |
| `IMAGE_DIMENSIONS_UNSUPPORTED` *(existing, A42 — **reused, not duplicated**)* | 400 | An axis outside the Read 4.0 bounds (`<50` or `>16000`), now decided **pre-decode** (§5.0.1 condition 2) | No |

`T-IMG-020` asserts the first two messages contain both "memory" and
`runbooks/scale-up-memory.md`, **and that the third contains neither.**
`T-API-003` covers the three new members like any other.

---

## 9. Logging and correlation (NFR-005)

- One structured log line per request:
  `{ ts, level, correlationId, method, path, status, durationMs, ownerIdHash }`.
- `ownerIdHash` is `sha256(ownerId).slice(0,12)` — never the raw subject, never
  the email (`specs/security.md` §8).
- **No analytics, no telemetry, no product instrumentation** (NFR-005). Logs
  exist for debugging only and go to Container Apps' default log stream. No
  Application Insights, no third-party SDK. `T-SEC-009` asserts no telemetry
  package is present in any `package.json`.

### 9.1 Decode sentinel events — MANDATORY *(new, R5; `A43-M5`)*

**These two log lines are the only signal that names WHICH image died, and the
only one under our control** (the platform's `RestartCount` /
`WorkingSetBytes` are proxies, and ACA exposes no distinct OOM-kill signal —
`architecture.md` §Observability → *Knowing that it OOMed*). They are **not
telemetry**: they contain no user content, no analytics, and are emitted to
stdout only, exactly like the per-request line above. `NFR-005` is unaffected.

Emitted by `apps/api/src/images/ingest.ts` via `apps/api/src/log.ts`, one JSON
object per line on **stdout** (lands in `ContainerAppConsoleLogs`).

```ts
// IMMEDIATELY BEFORE the decode call — i.e. after the §5.0 guard has PASSED
// and before any decode buffer is allocated.
{
  event: 'image.decode.begin',      // literal, exact
  ts: string,                       // ISO-8601 UTC, ms precision
  level: 'info',
  correlationId: string,            // same id as the request line
  batchId: string,                  // ULID
  imageId: string,                  // ULID — the join key for begin ⇄ end
  fileName: string,                 // as uploaded, or the SYNTHESISED name for a
                                    // pasted image (data-model.md §3.8.1) — never ''
  ingestSource: 'paste' | 'upload' | 'drop',  // (A45) how the bytes arrived
  uploadedFormat: 'png' | 'jpeg' | 'heic' | 'heif',
  width: number,                    // header-declared (§5.0.3)
  height: number,                   // header-declared
  megapixels: number,               // (width*height)/1e6, 1 dp
  declaredBytes: number,            // the uploaded byte length
  maxDecodePixels: number           // the NEXTUP_MAX_DECODE_PIXELS in force
}

// IMMEDIATELY AFTER the decode returns or throws — in a `finally`, so it is
// emitted on the failure path too (path P1). It is NOT emitted for path P2,
// and that absence is exactly the signal.
{
  event: 'image.decode.end',        // literal, exact
  ts: string,
  level: 'info' | 'error',          // 'error' when outcome !== 'ok'
  correlationId: string,
  batchId: string,
  imageId: string,                  // MUST equal the begin line's imageId
  outcome: 'ok' | 'oom' | 'failed', // 'oom' ⇒ IMAGE_DECODE_OOM (P1)
  durationMs: number,
  peakRssBytes: number,             // process.memoryUsage().rss sampled at end
  errorName?: string                // e.g. 'RangeError' — the class only
}
```

Binding rules, all asserted by `T-IMG-021`:

1. **Every `image.decode.begin` has a matching `image.decode.end` with the
   same `imageId`** — on success, on `IMAGE_DECODE_FAILED`, and on the
   catchable OOM (path P1). The `end` line is emitted from a `finally` block.
2. **A `begin` with no `end` means the process died mid-decode (path P2), and
   names the image that killed it.** That is the whole point; the log-search
   alert `nextup-prod-decode-abandoned` fires on exactly this condition over a
   5-minute window (`architecture.md` §Observability, signal S1).
3. **No `begin` line is emitted for an image the guard rejected** — there was
   no decode. A guard rejection is carried by the response's `rejected[]` and
   by the ordinary request log line.
4. **`event` names are literal strings** (`'image.decode.begin'` /
   `'image.decode.end'`) held as exported constants in
   `packages/domain/src/logEvents.ts`. The alert query matches on them, so
   renaming one silently disables the alert.
5. **No file contents, no pixel data, no owner identity.** `fileName` is the
   name the owner chose — **or, for a pasted image, the name the server
   synthesised (`data-model.md` §3.8.1), which contains no user content** —
   and is already in the response; `ownerIdHash` comes
   from the request line via `correlationId` and is **not** repeated here.
6. **(A45) `ingestSource` is included** so a decode failure can be read
   against the route that produced it. It is provenance in a log line, not
   analytics; `NFR-005` is unaffected for the same reason as the rest of
   this event. `T-PASTE-007`.

---

## 10. Traceability summary

| REQ | Route(s) |
|---|---|
| REQ-002/003 | §6.11 |
| REQ-004/005/006 | §6.12, §6.14 |
| REQ-013/014 | §6.17, §6.18, §6.22 |
| REQ-019/020/021/055 | §6.17, §6.21, §6.22 |
| REQ-022/023 | §6.17 mode contract |
| REQ-024/026/031…034/036/038 | §6.2 |
| REQ-027/028/062/063/064 | §6.9, §6.10 |
| REQ-039/040 | §6.28 |
| REQ-056 | §6.26 |
| REQ-057 | §6.17 |
| REQ-066 | §6.5 |
| REQ-067/068/075 | §6.22, §6.25 |
| REQ-070/071/072 | §6.6, §6.7, §6.8, `specs/ai.md` §5 |
| REQ-074 | §6.24, **§5.2.5 (which failures it can and cannot recover — R5)** |
| REQ-076 | §6.4 |
| NFR-019/020 | §6.27 |
| **RSK-016 / `A43-M1`…`M3`/`M5`** *(R5)* | **§5.0** (pre-decode pixel guard), **§5.2** (isolation, both OOM paths, exact error text), **§8** (the three codes), **§9.1** (decode sentinel) |
