# ADR-0008 — HEIC/HEIF transcode to lossless PNG on ingest

> ## ⚠ REVISION 3 — 2026-08-11T11:50 — `A45`: the transcode becomes CONDITIONAL ON THE SNIFFED TYPE. It is **not** weakened and it is **not** removed.
>
> **The decision is now, stated exactly:**
>
> > **Transcode if — and only if — the sniffed content type is HEIC/HEIF.**
> > Every other accepted type (PNG, JPEG) skips the decode, as it always
> > has. **The stage stays. The library stays. The guard stays. The
> > metadata strip stays.**
>
> **Why this changed.** At `A45` the owner corrected the expected capture
> interaction, verbatim: *"Also for screenshots, I'm generally expecting
> that I will take a screen grab and paste it into the app directly rather
> than saving it to my device first and then uploading it to the app."*
> Clipboard paste becomes the expected **primary** ingest affordance; file
> upload is **retained, fully supported, secondary** (**ADR-0009**).
>
> **The load-bearing platform fact** (`Context/evidence/clipboard-paste-support.md`,
> `verified` against the WebKit blog and MDN BCD, retrieved 2026-08-11):
> **WebKit exposes exactly four clipboard representations — `text/plain`,
> `text/html`, `text/uri-list`, `image/png`.** A pasted screenshot is
> therefore **always `image/png`**, on iOS, macOS and Windows alike.
> **HEIC cannot arrive by the paste path at all.**
>
> ### R3.1 This is a CONSEQUENCE of a verified platform fact, not an optimisation
>
> **State this precisely, because the distinction governs how the code may
> later be changed.** The paste path skips the transcode **because HEIC
> bytes are physically incapable of reaching it**, not because skipping is
> faster or cheaper. Nobody may later "extend the optimisation" to the
> upload path, and nobody may re-derive a rule like *"screenshots are PNG,
> so we can trust the type"*. The rule is, and remains:
>
> | | **LIVE RULE (R3)** |
> |---|---|
> | Decide the format by | **Magic bytes, on every path, always** — never the declared `Content-Type`, never the `ClipboardItem` type string, never the file extension |
> | Transcode | **iff** the sniffed type is **HEIC/HEIF** (`ftyp` brand in `heic`/`heix`/`heif`/`heim`/`hevc`/`mif1`/`msf1`) |
> | Skip transcode | sniffed type is PNG or JPEG — **including every pasted image**, which reaches this branch by sniff result, **not** by knowing it was pasted |
> | Reject 415 | sniffed type is anything else |
> | Pre-decode dimension/pixel guard (`A43-M1`, R2.1) | **Applies to ALL paths and ALL types**, pasted or uploaded. A pasted PNG is dimension-checked exactly like an uploaded one |
> | Metadata strip (`REQ-078`, `T-SEC-032`) | **Applies to ALL paths and ALL types** — see R3.3 |
>
> ⚠ **The branch must key on the sniff result, not on the ingest source.**
> An implementation that writes `if (source === 'paste') skipTranscode()`
> is **wrong**, even though it would appear to work: it trusts the caller
> instead of the bytes. The correct implementation —
> `if (sniffed === 'heic') transcode()` — makes the paste path's skip
> **fall out for free** and stays correct if the platform facts ever change.
>
> ### R3.2 ADR-0008 MUST NOT be deleted — the HEIC source is still live
>
> **The iOS Photos file-upload path still delivers raw HEIC**, and it is
> not going away: iOS screenshots auto-save to Photos and reach the
> clipboard only if the owner taps "Copy" on the transient preview, and iOS
> *camera photos* default to HEIC and are never on the clipboard. Add the
> laptop save-then-upload case and there remain **two live capture paths
> that only file upload serves** (ADR-0009 §Context). Removing the
> transcode would re-break the owner's own images on first use — the exact
> defect Revision 1 exists to fix.
>
> ### R3.3 ⚠ TRAP — WebKit strips EXIF on clipboard read but NOT on file upload
>
> `verified` (WebKit blog): *"Image data read from the clipboard is
> stripped of EXIF data, which may contain details such as location
> information and names."* **That covers the clipboard path only.** The
> **file-upload path delivers EXIF/GPS/device-model intact.**
>
> **Therefore `REQ-078`'s explicit, tested metadata-strip STAYS, unchanged
> and mandatory, on the upload path.** The paste path's free stripping is a
> belt on **one of three** affordances and **must never be read as making
> the control global**. Decision 4 below is unamended.
>
> ⚠ **Test hazard, named so it is not walked into:** asserting `T-SEC-032`
> against a *pasted* image would **pass vacuously** — WebKit already
> stripped the metadata, so the test would prove nothing about our code.
> **`T-SEC-032` must be asserted against an UPLOADED image carrying real
> EXIF/GPS.**
>
> ### R3.4 Cost and memory impact — small, favourable, and stated rather than assumed
>
> **Favourable, and it is worth naming rather than leaving implicit.**
> Every screenshot that arrives by paste is a PNG that **skips the WASM
> HEIC decode entirely** — the app's largest single allocation and the
> direct driver of `RSK-016`. The more the owner uses the (now primary)
> paste path, the **fewer bytes are transcoded** and the **less often the
> OOM risk is exercised**.
>
> **What does NOT change, and must not be argued away on this basis:**
> `RSK-016` stays **Medium** and stays **owner-accepted**; the compute size
> stays **0.25 vCPU / 0.5 GiB**; `NEXTUP_MAX_DECODE_PIXELS` stays
> **`25000000`**; the guard, the one-image blast radius, the
> self-explaining error, the runbook and the OOM alert (`A43-M1`…`M5`) all
> stay **MANDATORY**. A single 48 MP HEIC from Photos is still sufficient
> to exercise every one of them, and reduced *frequency* is not reduced
> *severity*. **No Azure line item changes. Direct cost delta: $0.**
>
> ### R3.5 What did NOT change
>
> Option A (`heic-convert` → WASM `libheif-js`, decode-only, chained to
> `sharp`); lossless PNG mandated by `NFR-012a`; inline in the synchronous
> ingest request before the blob write; magic-byte sniffing; EXIF/GPS
> stripped on ingest for **every** accepted image; the pre-decode
> dimension/pixel guard and its threshold; one-image failure isolation and
> the `REQ-074` reconciliation; `REQ-041` non-engagement; the LGPL-3.0
> notice obligation and `RSK-032`; `OQ-027` still **open**. **Revisions 1
> and 2 are retained verbatim below and nothing in them is repealed.**

> ## ⚠ REVISION 2 — 2026-08-11T10:50 — `A43` / `OQ-028`: the memory consequence is DECIDED, and containment becomes MANDATORY
>
> **Revision 1 is retained verbatim below and its library decision is
> unchanged.** What changes is the open memory question Revision 1
> deliberately left to the owner. The owner answered, verbatim:
> **"Start at 0.5 GiB, up-size only if it OOMs."** (`A43`.)
>
> So: **compute stays 0.25 vCPU / 0.5 GiB; 0.5 vCPU / 1.0 GiB is the
> pre-authorised reactive remedy** (`ADR-0003 R4`,
> `docs/runbooks/scale-up-memory.md`, +~$4/mo → ~$15–18 total). Where
> Revision 1's §Consequences says the remedy is "surfaced, not decided",
> read: **decided — start small, up-size on a real OOM.**
>
> Because the strategy is reactive, the three containment mechanisms below
> are **MANDATORY acceptance criteria**, not recommendations.
>
> ### R2.1 Pre-decode dimension/pixel guard — `A43-M1`
>
> Revision 1 named "a pre-decode input-byte guard" as an *additional cheap
> guard*. **That is corrected in place: a byte guard is insufficient and is
> not the requirement.** HEIC's compression ratio is highly variable, so
> bytes are a poor predictor of raster size — a 6 MiB HEIC can be 48 MP.
> **The requirement is a DIMENSION/PIXEL guard, evaluated before any decode
> buffer is allocated.**
>
> | | **LIVE RULE (R2)** |
> |---|---|
> | Source of dimensions | **HEIF `ispe` box** (HEIC/HEIF), **IHDR** (PNG), **SOFn** (JPEG) — parsed from the container header only |
> | Reject if | `width × height > NEXTUP_MAX_DECODE_PIXELS` |
> | | `width > 16000 \|\| height > 16000 \|\| width < 50 \|\| height < 50` (Azure AI Vision Read 4.0 bounds — such an image could not be extracted even if it decoded) |
> | | the header is unparseable (**never** "decode and find out") |
> | `NEXTUP_MAX_DECODE_PIXELS` | **`25000000`** at 0.5 GiB · `50000000` at 1.0 GiB — **moves with container memory, always** |
> | When | **Before** `heic-convert` is called, before any buffer is allocated, and before the blob write |
> | Byte ceiling | **Retained, but as a first cheap filter only — it is NOT the guard** |
>
> ~~*R1 framing: "Additional cheap guard: reject over-bound HEIC by the
> input byte ceiling before decode."*~~ — **superseded: bytes do not
> predict the allocation; dimensions do.**
>
> **This guard is retained at the owner's explicit instruction, even
> though the "buy more memory now and mitigate" option was NOT the one
> selected.** It is precisely what makes the reactive option survivable:
> without it, "reactive" means the container dies first and explains
> nothing.
>
> **Its honest cost:** at 0.5 GiB, **48 MP iPhone Pro captures are
> refused.** They fail cleanly with a named reason and a documented remedy,
> but they do fail. This is a real limitation, disclosed rather than
> discovered.
>
> ### R2.2 Failure is isolated to ONE image — `A43-M2`
>
> A guard rejection, a decode failure, or an out-of-memory condition
> **fails that image and only that image.** It appears in the attach
> response's `rejected[]` naming that one file; every other image in the
> request proceeds; the batch stays open and re-attachable.
>
> **No partial commit is possible, and this does not depend on catching
> the error.** A batch becomes visible only in **one transaction at
> review-close**; ingest and extraction merely stage. Even a hard OOM kill
> that takes the whole process mid-request cannot half-apply a batch,
> because no visible list state has been written.
>
> **Ordering that must be preserved:** transcode → blob write → staged row.
> An interruption therefore leaves either nothing or an orphan blob that no
> row references — never a row pointing at a missing blob. Orphan blobs are
> collected by the 30-day lifecycle purge (`NFR-019`); no compensating
> cleanup code exists, which is one fewer thing to get wrong.
>
> **Reconciliation with `REQ-074` (re-extraction from retained images) —
> stated explicitly rather than left ambiguous:**
>
> | Failure | Image retained? | Retry path |
> |---|---|---|
> | Guard rejection (`IMAGE_TOO_LARGE_TO_DECODE`) | **No** — refused before allocation and before the blob write | **Re-attach.** `REQ-074` **cannot** apply — it re-extracts from *retained* images, and nothing was retained |
> | Decode OOM/failure (`IMAGE_DECODE_OOM` / `IMAGE_DECODE_FAILED`) | **No** — transcode precedes the blob write | **Re-attach.** `REQ-074` does not apply |
> | Hard OOM kill mid-request | **Orphan blob at most**, never a referenced one | **Re-attach.** Already-accepted images in the open batch remain staged |
> | Extraction OOM on an **already-stored** image | **Yes** | **`REQ-074` re-extraction** — exactly its designed case. No re-attach |
>
> ⚠ **New interaction created by the reactive strategy:** `REQ-074`'s
> retry window is bounded by `NFR-019`'s **30-day purge**. A reactive fix
> implies a delay between failure and remedy; if that delay exceeds 30
> days the retained image is gone and re-attaching from the phone is the
> only path. Called out in `runbooks/scale-up-memory.md` §6.
>
> ### R2.3 The surfaced error names memory and points at the remedy — `A43-M3`
>
> **No blind debugging.** `RSK-016`'s complaint was never "it runs out of
> memory" — it was "the failure is undiagnosable". The error text is
> therefore part of the design, not a UX detail. Live text:
>
> **Guard rejection** — `IMAGE_TOO_LARGE_TO_DECODE`, per file in
> `rejected[]`:
>
> > **"`beach-list-03.heic` is 48.0 MP (8064 × 5952). nextup decodes
> > images in a 0.5 GiB container and refuses anything above 25.0 MP
> > *before* allocating memory, because decoding this one would exhaust
> > container memory and kill the import. This is a memory limit, not a
> > problem with your image. Remedy: up-size compute to
> > 0.5 vCPU / 1.0 GiB (+~$4/month) — one command, see
> > `runbooks/scale-up-memory.md`. No other image in this batch was
> > affected; re-attach this file after up-sizing."**
>
> **Decode OOM** — `IMAGE_DECODE_OOM`:
>
> > **"`beach-list-03.heic` ran out of memory while being decoded (HEIC →
> > PNG) in the 0.5 GiB container. This is a memory limit, not a corrupt
> > file. Remedy: up-size compute to 0.5 vCPU / 1.0 GiB (+~$4/month) —
> > `runbooks/scale-up-memory.md`. Only this image failed; the rest of the
> > batch is intact and nothing has been committed. Re-attach this file
> > after up-sizing."**
>
> **Distinct from both** — `IMAGE_DECODE_FAILED` (corrupt or truncated
> HEIC) must **not** mention memory or the up-size, because more memory
> will never fix it. Conflating the two would send the owner to buy
> capacity they do not need. **The two codes must stay distinguishable in
> the log and in the UI.**
>
> ### R2.4 Observability — `A43-M5`, and one thing implementers get wrong
>
> The OOM/restart signal design lives in `architecture.md` §Observability
> → *Knowing that it OOMed*. The ADR-level point that belongs here:
>
> **A WASM linear-memory allocation failure inside `libheif-js` may
> surface as a *catchable* `RangeError`/abort rather than as a process
> kill.** That is the good path — it becomes `IMAGE_DECODE_OOM`, fails one
> image, reaches the owner as a named error, and **produces no container
> restart at all**. A kernel-level OOM kill produces the opposite: a
> restart with no application error. **Both paths must be handled;
> neither alone is sufficient**, and an alert design resting only on
> restart count would miss the common case. Hence the
> application-emitted `image.decode.begin` / `image.decode.end` sentinel,
> which is the only signal that names *which* image died.
>
> ### R2.5 What did NOT change
>
> Option A (`heic-convert` → WASM `libheif-js`, decode-only, chained to
> `sharp`); lossless PNG mandated by `NFR-012a`; inline in the synchronous
> upload request before the blob write; EXIF/GPS stripped on ingest;
> `REQ-041` non-engagement; the LGPL-3.0 notice obligation and `RSK-032`;
> `OQ-027` (retain the original HEIC?) still **open**. Serial processing
> and per-image buffer release remain required — the guard is **in
> addition to** them, not instead of them.

| | |
|---|---|
| **Status** | **Accepted — Revision 3 (current)**; Revisions 1 and 2 retained verbatim |
| **Date** | 2026-08-11 (Rev 1), 2026-08-11 (Rev 2, `A43`), **2026-08-11 (Rev 3, `A45`)** |
| **Deciders** | solution-architect (phase 8, R5/R6/**R7**), owner (`A43` — the memory decision; **`A45` — the ingest-interaction correction**) |
| **Forced by** | **A45 (clipboard paste becomes the primary ingest affordance — ADR-0009)**, **A43 / OQ-028 (memory)**, **ASM-058 (supersedes falsified ASM-034), A42**, REQ-004, REQ-007, **REQ-078**, REQ-074, NFR-012a, NFR-019, NFR-011, RSK-014, RSK-016 |

## Context

**ASM-034 — "accepted upload formats are PNG and JPEG only" — was an
agent-derived inference that was never owner-confirmed, and it has been
falsified.** The owner stated verbatim *"iOS screenshots save as heic."*
The phone is the primary capture device (ASM-007 / A15), so the design as
originally specified would have **rejected the owner's own images on
first use**. **ASM-058 supersedes ASM-034: ingest accepts PNG *and* JPEG
*and* HEIC/HEIF.** All three arrive depending on the capture path — iOS
*screenshots* are normally PNG, iOS *camera photos* default to HEIC, an
iOS Safari file input may hand over any of the three, and the laptop-web
path produces PNG. PNG is **not** swapped out; three formats are accepted.

This creates a new, load-bearing problem the pipeline did not previously
have. **Neither extraction service accepts HEIC/HEIF** (verified,
`Context/evidence/heic-support.md`):

- **Azure OpenAI vision** (`gpt-4.1`) documents PNG, JPEG, WEBP and
  non-animated GIF. HEIC/HEIF is on neither Azure's nor the model
  provider's list.
- **Azure AI Vision Read 4.0** documents JPEG/PNG/GIF/BMP/WEBP/ICO/TIFF/MPO,
  **< 20 MB**, **> 50×50 and < 16,000×16,000 px**. HEIC/HEIF is absent.

Additionally, **only Safari renders HEIC** in a browser `<img>`/`<canvas>`;
Chrome, Firefox and Edge cannot. So a raw HEIC is unusable for both
readers *and* for any cross-browser client-side preview/crop.

**Therefore a server-side HEIC/HEIF → raster transcode stage is required
before the image is stored for analysis and before extraction.** This ADR
records the library decision, the licence obligation it places on this
MIT-licensed repository, and the memory consequence on the
0.25 vCPU / 0.5 GiB container (`RSK-016`).

HEIC/HEIF also carries **EXIF including GPS and device model** — the same
as a JPEG from the camera. Given the no-telemetry posture (`NFR-005`),
`RSK-014`, and 30-day retention (`NFR-019`), stripping metadata on ingest
is now an **explicit architectural responsibility**, not an incidental
side effect (see `specs/security.md` §4.2).

## Options considered

### Option A — `heic-convert` (pure JS/WASM `libheif-js`), optionally chained to prebuilt `sharp`

| | |
|---|---|
| Summary | Decode HEIC/HEIF with `heic-convert` (which wraps `heic-decode` → `libheif-js`, an Emscripten/WASM build of `libheif`) to **PNG**, then optionally hand the raster to prebuilt `sharp` for the dimension check/clamp. Runs in the **stock Linux container** with no native build step. |
| Pros | **No native compilation, no OS package** — pure JS/WASM, so the existing container image and CI are unchanged. **Decode-only**: uses `libde265` under `libheif`, so the GPL/patent-encumbered `x265` *encoder* is never involved. Metadata drops incidentally (decode-to-raw-RGBA + pure-JS re-encoders carry no EXIF), reinforcing the privacy control. `sharp` (prebuilt, already the raster tool for resize/strip) handles the downstream clamp. |
| Cons | **Licence floor is LGPL-3.0** (`libheif-js`) — see below. **WASM decode is memory-hungry**: it materialises the full raw RGBA raster in WASM linear memory, then a second buffer for the PNG encode — the dominant allocation in the whole app and the direct driver of the `RSK-016` OOM concern on 0.5 GiB. Pure-JS PNG encoding is slower than a native path (irrelevant at this volume, serial). EXIF-drop is architecturally expected but **must be asserted**, not assumed (`T-SEC-032`). |
| Cost | $0 in services. Memory pressure may force a compute up-size — **decided at R2/`A43`: stay at 0.5 GiB, up-size reactively (+~$4/mo, `runbooks/scale-up-memory.md`)**. ~~surfaced, not decided, in §Consequences and in `architecture.md` §Cost summary~~ |
| Reversal cost | Low — the transcode sits behind the ingest boundary; swapping the library is a one-module change. |

### Option B — `sharp` with a custom source-built libvips (HEIF enabled)

| | |
|---|---|
| Summary | Build libvips from source with `libheif`, set `SHARP_FORCE_GLOBAL_LIBVIPS`, and point `sharp` at it so a single library both decodes HEIC and does the raster work. Prebuilt `sharp` **cannot** decode HEIC — its bundled libvips excludes HEIF for licensing/patent reasons. |
| Pros | One image library for decode + resize + strip; native speed. |
| Cons | **An exotic container build step**: source-compiling libvips inside the image, an ongoing maintenance and CI burden that directly attacks `NFR-002`/`NFR-004` (buildable by an autonomous agent from mainstream, documented paths). Same LGPL codec footprint as Option A with none of its zero-native-build convenience. |
| Cost | $0 services; real engineering and CI cost. |
| Reversal cost | Medium — the custom build is baked into the image. |

### Option C — ImageMagick with a HEIC delegate (`libheif`), shelled out from Node

| | |
|---|---|
| Summary | `apt-get install` an ImageMagick built with the HEIC delegate (or libheif directly), shell out from Node to convert. |
| Pros | Works; well-known tool. |
| Cons | Heavier image, an **OS-package dependency** to keep patched, and a shell-out surface — for the same libheif/LGPL footprint as Option A without its convenience. More for an autonomous implementer to get right (`NFR-002`). |
| Cost | $0 services. |
| Reversal cost | Medium. |

### Option D — Client-side conversion (transcode HEIC→PNG in the browser before upload)

| | |
|---|---|
| Summary | Run a WASM HEIC decoder in the browser and upload PNG, so the server never sees HEIC. |
| Pros | Moves the memory cost off the small server container onto the client. |
| Cons | **Ships a heavy WASM decoder to every client, on every platform**, and the crop/preview problem (`RSK-028` tile thumbnail) would still need it because only Safari renders HEIC natively. It puts a correctness- and privacy-critical step (EXIF/GPS stripping) on the **untrusted client**, where it cannot be guaranteed — the server would have to re-verify anyway. It also complicates the mobile-web path that is the owner's primary one. |
| Cost | $0 services; larger client bundle, worse mobile UX. |
| Reversal cost | Medium. |

### Option E — Reject HEIC outright and tell the owner to change their iPhone settings

| | |
|---|---|
| Summary | Keep "PNG/JPEG only" and instruct the owner to set *Camera ▸ Formats ▸ Most Compatible* (JPEG). |
| Pros | Zero new code, zero new dependency, zero new memory cost. |
| Cons | **This is user-hostile and it is the exact failure this correction exists to undo.** It pushes a setup burden onto the owner for the app's convenience, it does not even fully work (screenshots can still be HEIC under iOS 17+ HDR screen capture, and the Files/"Browse" path passes the original HEIC through regardless of the camera setting), and it would silently reject the owner's own images on first use for anything it missed. Asking a single owner to reconfigure their phone so our ingest can stay simpler inverts who serves whom. **Rejected on principle.** |
| Cost | $0. |
| Reversal cost | n/a. |

## Decision

**We will accept PNG, JPEG and HEIC/HEIF at ingest, and transcode
HEIC/HEIF to lossless PNG server-side as part of the upload/attach
request, using `heic-convert` (pure JS/WASM `libheif-js`) for the decode,
chained to prebuilt `sharp` for the dimension clamp and metadata strip
(Option A).** PNG and JPEG uploads skip the decode step and are stored
as-is (still metadata-stripped).

> ⚠ **R3 correction, in place.** Read "upload/attach request" as **"ingest
> request, from ANY of the three affordances — the desktop `paste` event,
> the iOS 'Paste screenshot' button, or file upload"** (`A45`, ADR-0009).
> And read the transcode as **conditional on the SNIFFED type**: transcode
> **iff** sniffed HEIC/HEIF. Pasted images are always `image/png` and
> therefore always take the skip branch — **by sniff result, never by
> knowing they were pasted** (R3.1). ~~"upload/attach request" as the only
> entry point~~ — **superseded: ingest has three entry points and one
> pipeline.**

Key properties of the decision, each load-bearing:

1. **Lossless PNG, never a lossy JPEG re-encode.** Extraction is
   quality-first (`NFR-012a`); a lossy transcode would degrade exactly the
   small tile captions and box artwork the readers depend on. This is not
   a size optimisation opportunity — the output format is mandated.
2. **The transcode runs inline in the synchronous upload/attach request,
   before the blob is written — not in the async extraction worker.** Three
   reasons: (a) the stored artefact must already be a raster both readers
   accept, so storing raw HEIC and transcoding later would persist bytes no
   reader can use and would complicate `REQ-074` re-extraction; (b) EXIF/GPS
   must be stripped *before* the personal-data bytes come to rest in the
   blob, not after; (c) a transcode failure (corrupt/truncated HEIC) is
   surfaced **synchronously in the attach response's `rejected[]`**, naming
   that one file, at the moment the owner can re-pick it — rather than as a
   mysterious extraction failure minutes later. The UX cost is that a HEIC
   attach takes a little longer to return than a PNG attach; that is the
   right trade against a batch that looks fine and then fails downstream.
3. **This is user-initiated work that is part of upload — it is NOT a
   background process** and does not engage `REQ-041` at all. `REQ-041`
   governs processes that change user-visible *list* state without the
   owner; a transcode the owner triggered by attaching a file, that writes
   no list row, is categorically outside it. Stated explicitly here so no
   later reader mistakes it for a violation.
4. **Metadata stripping is an explicit, tested ingest step** applied to
   every accepted image — HEIC, PNG and JPEG alike (`specs/security.md`
   §4.2, `T-SEC-032`).
5. **The original HEIC is discarded after a verified transcode** — the
   stored blob is the derived PNG (`uploadedImage.format = 'png'`,
   `uploadedImage.uploadedFormat = 'heic'`). Whether to *also* retain the
   original HEIC is **OQ-027**, still open; the spec default is discard,
   and ADR-0006 is made consistent with that default.

### Licence obligation — LGPL-3.0 on an MIT repository

The dependency chain and its licences, read from each `package.json`
(verified in `Context/evidence/heic-support.md`):

| Package | Licence | Role |
|---|---|---|
| `heic-convert` | **ISC** | HEIC → PNG/JPEG wrapper |
| `heic-decode` | **ISC** | decode HEIC → raw RGBA |
| `libheif-js` | **LGPL-3.0** | WASM build of `libheif` (the codec) |
| `sharp` | Apache-2.0 (prebuilt) | downstream resize / clamp / strip |

The wrappers are ISC (permissive, no obligations). **The codec
`libheif-js` is LGPL-3.0 — weak copyleft.** Used as an **unmodified npm
dependency** (the normal case), LGPL-3.0 does **not** make this MIT app
copyleft; the obligation is to **retain the LGPL-3.0 licence notice for
that component** (in `NOTICE`/`THIRD-PARTY`) and not to prevent its
replacement. Because only the **decode** path is used, there is **no GPL
`x265` encoder and no patent-encumbered encoder** in the tree — the
licence floor is LGPL-3.0, not GPL. **Obligation, not a blocker:** ship
the notice, keep the library unmodified. Flagged for a human licence
sign-off (this is analysis, not legal advice) — `TASK-144`.

## Consequences

### Positive
- The owner's own iPhone images are accepted on first use — the defect
  this correction exists to remove is gone.
- Both readers receive a format they accept, from a single upstream
  transcode; no per-reader special-casing.
- EXIF/GPS/device-model is stripped before the bytes rest in the blob — a
  privacy improvement (`RSK-014`), now made an explicit tested control.
- No native build, no OS package, stock container and unchanged CI
  (`NFR-002`/`NFR-004`).
- Decode-only means the dangerous licence/patent surface (`x265`) is never
  present.

### Negative
- **Memory. This is the real cost.** `libheif-js` decodes HEIC into a full
  raw RGBA raster in WASM linear memory, then a second buffer for the PNG
  encode — the largest single allocation in the app. On the
  **0.25 vCPU / 0.5 GiB** container, a *typical* iPhone screenshot or photo
  (≈12–15 MP → ≈50–60 MB raw, ≈100 MB with the WASM copy) fits comfortably
  alongside the ~150–200 MB Node/static baseline. **But a worst-case *legal*
  HEIC — near the 10 MiB per-image byte ceiling, which for an efficient
  HEIC can be ~40–48 MP — decodes to ~160–195 MB of raw RGBA, ~two-thirds
  of a gigabyte once the WASM copy and PNG buffer are counted, and can OOM
  the 0.5 GiB container during decode.** That is exactly the undiagnosable
  `RSK-016` failure shape, now made *more* likely because transcode adds a
  large transient raster the design did not previously allocate.
  **Primary mitigation, retained and stated as such: images are processed
  serially (one in flight), and each image's buffers are released before
  the next** — so the peak is one raster, not many. **Additional guard —
  R2 correction, in place: a pre-decode DIMENSION/PIXEL guard
  (`NEXTUP_MAX_DECODE_PIXELS`, 25 MP at 0.5 GiB), evaluated before any
  buffer is allocated (R2.1). MANDATORY.**
  ~~Additional cheap guard: reject over-bound HEIC by the input byte
  ceiling before decode.~~ *(superseded at R2 — bytes do not predict
  raster size; the byte ceiling survives only as a first cheap filter.)*
  **Neither fully removes the pathological-file OOM.**
  ~~If serial processing proves insufficient in practice, the priced
  remedy is a compute up-size to 0.5 vCPU / 1.0 GiB (~$9–12/month,
  +~$4 over the as-designed ~$5–8) — the richer-variant compute size.
  This is a cost change the owner must see; it is surfaced in
  `architecture.md` §Cost summary and §Where this breaks, and is
  deliberately NOT decided here.~~ **→ R2/`A43`: DECIDED by the owner —
  stay at 0.5 GiB, up-size REACTIVELY on a real OOM. The up-size is
  pre-authorised and documented in `runbooks/scale-up-memory.md`; no
  further approval is needed.** (`RSK-016` — now an owner-accepted
  residual risk; ADR-0003 R3.2 and **R4**.)
- A new third-party dependency and its **LGPL-3.0 notice obligation**
  (above) — a small, permanent maintenance and compliance duty (`TASK-144`).
- HEIC attach latency is higher than PNG attach latency (decode + encode),
  paid synchronously in the upload request. Immaterial at this volume,
  disclosed so it is not a surprise.
- EXIF-drop is architecturally expected but not contractually guaranteed by
  the library, so it must be **asserted by test** (`T-SEC-032`), not
  assumed.

### Neutral / follow-on work required
- **`NOTICE`/`THIRD-PARTY`** must carry the `libheif-js` LGPL-3.0 notice;
  `TASK-144` (human licence sign-off).
- Pin `heic-convert` and its transitive codec to exact versions.
- The dependency allow-list check gains `heic-convert` (and its chain) as
  known, and asserts no encoder-side (`x265`) transitive dependency appears.
- The magic-byte sniff must recognise the HEIF `ftyp` brand set
  (`heic`/`heix`/`heif`/`heim`/`hevc`/`mif1`/`msf1`) and decide format by
  bytes, never by the declared `Content-Type` (iOS/Safari often sends
  `application/octet-stream` or an empty type) — `specs/api.md` §5.
- `OQ-027` (retain the original HEIC?) is referenced, not closed; default
  is discard after verified transcode.

## Reversal

| | |
|---|---|
| **Is this a one-way door?** | **No.** |
| **Cost to reverse** | Low. The transcode lives behind the ingest boundary in one module; swapping `heic-convert` for another decoder, or (in a hypothetical multi-user future) moving conversion client-side, is a contained change. Removing HEIC support entirely is not an option — it would re-break the owner's primary capture path. |
| **Trigger to revisit** | (a) ~~the memory mitigation proves insufficient and the compute up-size is taken~~ **→ R2/`A43`: this is no longer a trigger to revisit the ADR — it is the documented reactive remedy, `runbooks/scale-up-memory.md`, and taking it requires no new decision**; (b) a maintained pure-JS decoder with a more permissive licence appears; (c) `libheif-js` stops tracking upstream `libheif`; **(d) NEW — the pixel guard refuses images the owner genuinely needs even at 1.0 GiB, which would mean the guard threshold or the decode strategy, not the container size, is wrong.** |

## Compliance and security implications

- **Privacy (`RSK-014`, `NFR-005`, `NFR-019`):** EXIF/GPS/device-model is
  stripped on ingest for every accepted image, before the blob is written;
  asserted by `T-SEC-032`.
- **`REQ-041`:** transcode is user-initiated upload work, not a background
  process, and writes no list state — explicitly outside the closed
  enumeration.
- **Licence:** LGPL-3.0 (`libheif-js`, decode-only) notice obligation on
  this MIT repo; no GPL `x265`, no patent-encumbered encoder. Human
  sign-off `TASK-144`.
- **Malicious upload:** format is decided by magic bytes, not extension or
  `Content-Type`; a file matching no known signature is rejected 415; a
  transcode failure rejects that one file, never the whole request
  (`specs/api.md` §5/§5.1, `specs/security.md` T4).

## References

- `Context/evidence/heic-support.md` — the verified format, library,
  licence and browser-support facts this ADR rests on.
- `Context/requirements.md` — REQ-004, REQ-007, REQ-074; ASM-058 / A42.
- `docs/PRD.md` §7.5, US-004 AC-4/AC-7/AC-8, R-11.
- `specs/api.md` §5 / §5.1; `specs/ai.md` §2.0; `specs/security.md` §4.2;
  `specs/data-model.md` §3.8.
- ADR-0001 (extraction), ADR-0003 (hosting/compute — `RSK-016`),
  ADR-0006 (screenshot storage — derived-PNG artefact).
- `Context/open-questions.md` — OQ-027 (retain original HEIC?), **OQ-028
  (memory sizing — CLOSED at `A43`)**.
- **`docs/runbooks/scale-up-memory.md`** — the reactive up-size
  procedure this ADR's error messages point at (`A43-M4`).
