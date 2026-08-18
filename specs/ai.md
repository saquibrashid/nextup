---
createdAt: 2026-08-10T20:12:02-04:00
createdBy: spec-writer
revisedAt: 2026-08-10T21:07:17-04:00
revisedBy: solution-architect
revision: 2
phase: 8
status: complete
sourceOfTruth: artifacts/PRD.md, artifacts/adr/ADR-0001 (Revision 2), artifacts/diagrams/ai-pipeline.md
---

# specs/ai.md — nextup extraction and matching

> **REVISION 2 (2026-08-10T21:07) — the extractor changed.** Constraint
> change `A40` added `NFR-012a`: extraction is exempt from the near-zero
> cost constraint and **quality outranks cost for this component**.
> ADR-0001 Revision 2 replaces the single OCR extractor with a **hybrid**:
> **Azure OpenAI `gpt-4.1` multimodal vision as the primary reader, with
> Azure AI Vision `Read` OCR running on every image as a mandatory
> deterministic cross-check.** §2, §3, §7, §8, §9, §10 and §11 are
> revised. **§4 (matching), §5 (suppression) and §6 (review contract) are
> unchanged** — the review pass, the data model and the API surface do not
> move.
>
> ⚠ **`NFR-012a`: do not downgrade the model to save money.** The only
> admissible reason to change the model is measured quality on §9.

**Serves:** US-006, US-007, US-008, US-009, US-013, US-014, US-034.
**Requirements:** REQ-007…REQ-012, REQ-024, REQ-029, REQ-057, REQ-058,
REQ-071, REQ-074, REQ-076, NFR-010, NFR-012, NFR-014, NFR-015, NFR-016,
NFR-017.

---

## 0. The two binding rules

> **RULE A (RSK-022, NFR-016, REQ-058) — NO TMDB CONTENT MAY EVER REACH AN AI
> SERVICE. MATCHING IS DETERMINISTIC.**
> The only bytes sent to any AI/inference service are the owner's uploaded
> screenshot bytes. TMDB titles, ids, synopses, genres, poster paths, search
> results and match candidates are **never** placed in a prompt, an embedding
> request, a re-ranking request or any other model call. Matching (§4) is
> plain deterministic string comparison in our own process. This is a TMDB
> terms-of-use obligation whose breach is **invisible from inside the app**, so
> it is enforced structurally and tested (`T-AI-012`, `T-AI-013`).
>
> **SCOPE CLARIFICATION (ADR-0001 R2.4).** Rule A binds **TMDB content**.
> It does **not** bind the owner's own screenshot pixels. A screenshot the
> owner took of their own saved list is not TMDB content, and sending it to
> a vision model is not a use of TMDB data. **Rule A does not prohibit
> multimodal vision extraction** — it prohibits a model-assisted *matcher*.
> The pipeline order is the enforcement: extraction sees only the image and
> emits only strings; TMDB is reached afterwards, deterministically; the two
> never meet. `T-AI-013` now covers **both** inference hosts (the vision
> endpoint and the Azure OpenAI endpoint).

> **RULE B (REQ-058, NFR-016) — THE EXTRACTOR NEVER LEARNS WHICH SERVICE IT IS
> LOOKING AT.** `TitleExtractor.extract()` takes image bytes and a MIME type
> (`image/png` | `image/jpeg` only — HEIC/HEIF is transcoded to PNG on ingest
> before stage 1; `api.md` §5.1).
> Nothing else. Its return type has **no** service field. The service is a
> property of the `UploadBatch`, applied *after* extraction returns. The
> compiler enforces this; `T-AI-011` additionally asserts the string
> `'netflix'` and `'max'` appear nowhere under
> `apps/api/src/extraction/`.

---

## 1. Scope of AI in this product

**Two** inference calls exist in nextup, both against the owner's own
screenshot bytes and both inside stage 1: a **multimodal vision call**
(the primary reader) and an **OCR call** (the mandatory deterministic
cross-check). Everything downstream — cleanup, cross-check merge,
identity, matching, suppression, classification — is deterministic code
in our own process. There is no embedding store, no RAG, no agent, no
chat surface, no model fine-tuning, and **no model anywhere near TMDB
content** (Rule A).

| Stage | Inference? | Metered? | Deterministic? |
|---|---|---|---|
| 1a. Vision LLM read (**primary**) | **yes** | **yes** — the only metered call | **no** — sampled model output |
| 1b. OCR read (**cross-check**) | **yes** | no — free tier | effectively yes; not relied on as such |
| 1c. Cross-check merge | no | no | **yes** — pure function of 1a + 1b |
| 2. Clean-up | no | no | yes |
| 3. Identity | no | no | yes |
| 4. Suppression gate | no | no | yes |
| 5. Classification + review staging | no | no | yes |

**The determinism boundary is between 1b and 1c.** Everything from 1c
onwards is a pure function of stage-1 output and is gated at exactly
1.0 determinism in CI (§9, `specs/testing.md` §4).

---

## 2. Stage 1 — extraction (ADR-0001 Revision 2)

### 2.0 Shape

> **Pre-stage — ingest transcode (A42), guarded (R5/`A43`), conditional (A45).**
> The `image bytes`
> entering stage 1 are
> always **PNG or JPEG**. HEIC/HEIF uploads (the iPhone's default camera format)
> are accepted at the upload endpoint and transcoded to **lossless PNG** during
> ingest — before the blob is stored and before extraction — because neither
> reader accepts HEIC/HEIF (Azure OpenAI vision: PNG/JPEG/WEBP/non-animated GIF;
> Azure AI Vision Read: JPEG/PNG/GIF/BMP/WEBP/ICO/TIFF/MPO). See `api.md` §5.1.
> Lossless PNG, not lossy JPEG, is mandated by **NFR-012a** so the transcode
> cannot degrade the tile captions/artwork the readers below depend on.
>
> **(A45) Screenshots may now also arrive by clipboard paste or drag-drop
> (`api.md` §5.3). Nothing in this pipeline changes.** Pasted bytes are
> always `image/png` (WebKit exposes exactly four clipboard representations
> and HEIC is not one — `Context/evidence/clipboard-paste-support.md` Q3), so
> the transcode is a **no-op** on that path. ⚠ **The transcode stage is
> CONDITIONAL on the sniffed format, NOT deleted** — the iOS Photos
> **file-upload** path still delivers raw HEIC and still needs it (`api.md`
> §5.1, `T-IMG-023`). And, as with `service` (RULE B), **`TitleExtractor`
> never learns the ingest source**: `extract()` takes bytes and a MIME type
> and nothing else. A pasted image and an uploaded one are byte-identical
> inputs to stage 1, and extraction quality must not depend on how the file
> got here.
>
> **(R5) Two consequences of the `A43` memory decision that bind this
> pipeline, both upstream of stage 1 and neither of them optional:**
>
> 1. **A mandatory pre-decode pixel guard** (`api.md` §5.0) rejects any image
>    whose **header-declared** `width × height` exceeds
>    `NEXTUP_MAX_DECODE_PIXELS` (**25 MP** at 0.25 vCPU / 0.5 GiB) *before any
>    decode buffer is allocated*. **So every image that reaches stage 1 is
>    already ≤ 25 MP and within the Read 4.0 axis bounds (50 … 16,000 px).**
>    The extraction pipeline therefore never needs its own size defence — and
>    must not add one, because a second, differently-configured limit is how
>    the two drift apart. **The honest cost, disclosed:** a 48 MP iPhone Pro
>    capture is refused at 0.5 GiB and never becomes an extraction input.
> 2. **A failed image is one image.** A guard rejection, a decode failure or an
>    OOM removes exactly that file from the batch (`api.md` §5.2.1); the
>    remaining images are extracted normally. **A batch that lost an image to a
>    memory failure is a batch with fewer images — which matters here, because
>    fewer images is precisely the low-yield condition of §8, and in
>    full-update mode §8.2's removal suppression is what stops a missing
>    screenshot from becoming a mass removal.** The two mechanisms compose;
>    neither is weakened.

```
                image bytes  (PNG | JPEG — post-transcode; never HEIC)
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  1a. gpt-4.1 vision        1b. Vision Read OCR
  (primary reader)          (cross-check, free)
   tiles + titles            lines + boxes
        └────────────┬────────────┘
                     ▼
            1c. cross-check merge   ← deterministic, pure
                     ▼
             ExtractionResult
```

Both calls are issued **in parallel** per image. Neither waits on the
other. The merge (1c) is a pure function and is where every flag the
owner will see is computed.

### 2.1a Primary reader — Azure OpenAI `gpt-4.1` vision

| | |
|---|---|
| Service | **Azure OpenAI Service**, same region and subscription |
| Model | **`gpt-4.1`**, version **pinned explicitly** in the Bicep deployment — never `latest` |
| Deployment | `nextup-extract`, **Standard (pay-as-you-go)**, no PTU, no commitment |
| API version | `2024-10-21` or later (Structured Outputs required) |
| SDK | `openai` npm package with `AzureOpenAI` client |
| Auth | Container App **system-assigned managed identity**; RBAC role `Cognitive Services OpenAI User`. **No API key exists anywhere.** |
| Endpoint | `NEXTUP_AOAI_ENDPOINT`, `NEXTUP_AOAI_DEPLOYMENT` (config, not secrets) |
| Module | `apps/api/src/extraction/llmVisionExtractor.ts` — **the only file in the repo that may import the OpenAI SDK** (`T-AI-010b`) |

⚠ **`NFR-012a` — model selection is a quality decision, never a cost
decision.** `gpt-4.1-mini` is configurable and is ~$0.40/month cheaper.
**It must not be selected to save money.** The only admissible reason to
change `NEXTUP_AOAI_MODEL` is a measured improvement on the §9 gates,
recorded as an ADR-0001 addendum.

**Call parameters — every one of these is load-bearing:**

```ts
const response = await client.chat.completions.create({
  model: cfg.NEXTUP_AOAI_DEPLOYMENT,
  temperature: 0,          // required — see §9.5
  top_p: 1,
  seed: 1729,              // best-effort reproducibility; NOT a guarantee
  max_tokens: 4096,
  response_format: {
    type: 'json_schema',
    json_schema: { name: 'tiles', strict: true, schema: TILE_SCHEMA },
  },
  messages: [
    { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
    { role: 'user', content: [
        { type: 'text', text: EXTRACTION_USER_PROMPT },
        { type: 'image_url', image_url: { url: dataUri, detail: 'high' } },
    ]},
  ],
});
```

`detail: 'high'` is required: `'low'` downsamples to 512 px and destroys
both small tile captions and the artwork detail that §2.1a exists to
read. It is **not** a cost lever (`NFR-012a`).

**The response schema (`TILE_SCHEMA`) — `strict: true`,
`additionalProperties: false` everywhere:**

```jsonc
{
  "type": "object",
  "additionalProperties": false,
  "required": ["tiles"],
  "properties": {
    "tiles": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["visibleText", "identifiedTitle", "basis", "confidence", "box"],
        "properties": {
          "visibleText":     { "type": ["string", "null"] },  // VERBATIM glyphs, or null if none legible
          "identifiedTitle": { "type": ["string", "null"] },  // the work, or null if not identifiable
          "basis":           { "enum": ["text", "artwork", "both", "unknown"] },
          "confidence":      { "type": "number" },            // 0..1
          "box":             { "type": "object", "additionalProperties": false,
                               "required": ["x","y","w","h"],
                               "properties": { "x": {"type":"number"}, "y": {"type":"number"},
                                               "w": {"type":"number"}, "h": {"type":"number"} } }
        }
      }
    }
  }
}
```

**`REQ-058` / Rule B is enforced by this schema.** There is no service
field, no platform field, no free-text field in which one could hide,
and `strict: true` + `additionalProperties: false` means the provider
**cannot** return one. `T-AI-011b` asserts the committed schema has no
property whose name or enum contains a service name, and the system
prompt carries the negative instruction below as belt-and-braces.

**Prompt (committed as constants in
`apps/api/src/extraction/prompts.ts`; changing them requires a golden
re-run — `T-AI-038`):**

```
SYSTEM:
You read a screenshot of a saved/watch list from a video app and report
the tiles you can see. For each distinct tile, report:
  visibleText     - the text printed on or under the tile, copied EXACTLY,
                    character for character, including truncation such as a
                    trailing ellipsis. null if no text is legible.
  identifiedTitle - the film or series you believe the tile represents,
                    as its commonly used title. You may use the artwork.
                    If the text is truncated, give the complete title.
                    null if you are not confident which work it is.
  basis           - "text" if you read it from printed text only,
                    "artwork" if from the artwork only,
                    "both" if both agreed,
                    "unknown" if you could not identify the work.
  confidence      - 0..1, your confidence in identifiedTitle.
  box             - the tile's bounding box, normalised 0..1, origin top-left.

Rules:
- Report EVERY tile you can see, including ones you cannot identify.
  A tile with identifiedTitle=null and basis="unknown" is a correct and
  useful answer. NEVER omit a tile.
- Do NOT guess. If you are unsure which work a tile is, set
  identifiedTitle to null rather than offering a likely-sounding title.
- Do NOT report navigation, headings, buttons, row labels, badges,
  durations or progress indicators as tiles.
- Do NOT name, identify, infer or mention the app, service, platform or
  brand the screenshot came from, anywhere, for any reason.
- Return only the JSON object required by the schema.

USER:
Report the tiles in this screenshot.
```

**"Do not guess" is the single most important line in this prompt.** It
converts the model's default behaviour (produce something plausible)
into the behaviour the review pass needs (produce nothing rather than
something wrong). `basis: "unknown"` with `visibleText` populated is a
first-class, expected outcome and flows through as a normal candidate on
its raw text.

### 2.1b Cross-check reader — Azure AI Vision `Read` OCR

Unchanged from Revision 1 in every respect except its role. It is **not**
a fallback that sits idle: it runs on **every image, every time**.

| | |
|---|---|
| Service | Azure AI Vision **Image Analysis 4.0**, `Read` visual feature |
| SKU | **F0 (free)** — 5,000 tx/month; at ~50–150 images/month this is free forever |
| SDK | `@azure-rest/ai-vision-image-analysis` |
| Auth | Managed identity, RBAC `Cognitive Services User`. No API key. |
| Endpoint | `NEXTUP_VISION_ENDPOINT` |
| Module | `apps/api/src/extraction/azureVisionExtractor.ts` — the only file that may import the Vision SDK (`T-AI-010`) |

```ts
const result = await client.path('/imageanalysis:analyze').post({
  body: imageBytes,
  queryParameters: {
    features: 'Read',          // ONLY 'Read'. Never 'Caption', 'Tags', 'People', 'SmartCrops'.
    'model-version': 'latest',
    language: 'en',
  },
  contentType: mimeType,
  headers: { 'x-ms-client-request-id': correlationId },
});
```

`T-AI-009` still asserts `features === 'Read'` exactly. `Caption`/`Tags`
would push a generated description of a personal screenshot through a
captioning model for no product benefit (NFR-015).

### 2.1c The cross-check merge — deterministic, and the heart of this design

`apps/api/src/extraction/crossCheck.ts`. **Pure function. No I/O. No
inference.** Same inputs → byte-identical output, always (`T-AI-034`).

```ts
export function crossCheck(
  llm: LlmTile[],
  ocr: OcrLine[],
): ExtractedTextItem[]
```

**Step 1 — support classification.** For each LLM tile, compute the best
`jaroWinkler` between `normaliseTitleText(tile.visibleText ?? tile.identifiedTitle)`
and each OCR line's `normaliseTitleText(text)` **whose box overlaps the
tile's box by ≥ 20 % of the smaller area** (geometry-scoped, so a
coincidental match elsewhere on screen does not count):

| Best score | `ocrSupport` |
|---|---|
| ≥ `OCR_SUPPORT_EXACT` (0.95) | `'exact'` |
| ≥ `OCR_SUPPORT_PARTIAL` (0.75) | `'partial'` |
| otherwise, or no overlapping line | `'none'` |

**Step 2 — orphan recovery (this is `REQ-012` applied to the model
itself).** Every OCR line that (i) was not consumed in step 1 by any
tile, and (ii) survives the §3.2 length/chrome/digit gates, is emitted
as an **additional** `ExtractedTextItem` with `provider: 'ocr-only'`,
`basis: 'text'`, `ocrSupport: 'exact'`, `inferredTitle: null`.

> **This is the guarantee Revision 1 could not offer: the vision model
> cannot silently omit a title that a second, independent, deterministic
> reader saw.** Do not "optimise" this away — it is the mechanism that
> preserves ADR-0001's original reason R2 under a non-deterministic
> primary. `T-AI-039`.

**Step 3 — geometry.** Where `ocrSupport !== 'none'`, the **OCR box wins**
— it is reliable, the model's is not. Where support is `'none'`, the
model's box is used and `boxSource: 'llm'` is recorded.

**Step 4 — ordering.** Output is sorted by `(round(y*40), x, rawText)`,
a **total** order with no ties, so the merge is reproducible.

### 2.2 Timeouts, retries and failure

| Condition | Behaviour |
|---|---|
| Per-image LLM timeout | **60 s** (`AOAI_TIMEOUT_MS = 60_000`) |
| Per-image OCR timeout | **30 s** (`VISION_TIMEOUT_MS = 30_000`) |
| Retry (both) | **2 retries**, exponential backoff 1 s / 4 s, on 429, 500, 502, 503, 504 and network errors only. Never on 400/401/403/413. |
| Concurrency | **ONE image in flight** (`EXTRACTION_IMAGE_CONCURRENCY = 1`), with that image's **two reader legs issued together**. ⚠ **Corrected in place (R6, `A43`/TASK-145).** ~~2 images in flight, both calls per image issued together (`EXTRACTION_CONCURRENCY = 2`)~~ — two images in flight means two decoded rasters resident at once, and at **0.25 vCPU / 0.5 GiB** that is the OOM this product has already accepted as residual risk `RSK-016`. The "2" that survives is the READER concurrency (LLM + OCR for one image), which costs no additional image memory. `docs/backlog.md` TASK-145/TASK-058 is the work order and says 1; this row said 2 and was the last place the old number was still stated as current. **Do not "optimise" it back to 2 without changing the container size in the same commit (REQ-079).** |
| Whole-batch ceiling | **15 minutes** (`EXTRACTION_BATCH_TIMEOUT_MS = 900_000`) — raised from 10 for LLM latency |
| **`finish_reason === 'length'`** | **Treated as an extractor ERROR, never as a complete result.** A truncated JSON array is a silently short tile list, which in full-update mode reads as removals. `T-AI-040`. |
| Schema-invalid response after retries | extractor error, `code = 'EXTRACTOR_ERROR'` |
| Content-filter refusal | extractor error, `code = 'EXTRACTOR_REFUSED'`, message names the image. Never a silent empty result. |
| **Whole-batch 15-minute ceiling breached** | `extraction-failed`, **`code = 'EXTRACTOR_ERROR'`** *(stated here because it was previously unstated: `EXTRACTION_ERROR_CODES` is a CLOSED enum — `EXTRACTOR_UNAVAILABLE`, `EXTRACTOR_ERROR`, `IMAGES_PURGED` — and a ceiling breach mapped to none of them, so each implementer would have picked differently. `EXTRACTOR_UNAVAILABLE` is wrong: it is reserved for 429-exhaustion and tells the owner to wait, whereas a ceiling breach means the batch was too large. ⚠ **FINDING, deliberately not fixed here:** the honest code is a fourth member, e.g. `EXTRACTION_TIMEOUT`, with its own owner-facing copy in `specs/ui.md` §9 — "This upload had more images than we could read in one go. Try splitting it." Opening the closed enum is a cross-cutting change and is queued as such, not smuggled in.)* |
| **LLM unavailable after retries, OCR succeeded** | **Degraded mode — see §2.2a.** Not a failure. |
| **OCR unavailable, LLM succeeded** | Proceed. All items get `ocrSupport: 'not-checked'`, batch flagged `crossCheck: 'unavailable'`, review banner: *"The second reader wasn't available, so titles below couldn't be double-checked."* Removals are **still permitted** (the primary reader worked). |
| **Both unavailable** | Whole batch → `extraction-failed`, `code = 'EXTRACTOR_ERROR'` |
| 429 exhausted on both | `extraction-failed`, `code = 'EXTRACTOR_UNAVAILABLE'` (US-006 AC-5) |
| Images purged before re-extraction | `extraction-failed`, `code = 'IMAGES_PURGED'` (US-034 AC-5) |

**Unchanged and still absolute:** any image still failing after retries
fails the **whole batch**. **No partial extraction is ever staged for
review**, because a partially-extracted full-update batch reads as a wave
of removals. `T-AI-014`. An `extraction-failed` batch changes no list
state and retains its images (`T-AI-015`).

### 2.2a Degraded mode — OCR-only (new in Revision 2)

If the LLM is unavailable but OCR succeeded, the batch **completes** with
OCR-only extraction rather than failing. This is strictly better than
failing — but it is Revision 1's quality level, not Revision 2's, so:

| Property | Behaviour |
|---|---|
| `uploadBatch.degradedExtraction` | `true` |
| Review banner | *"The main reader wasn't available, so these titles were read by the simpler text reader only. They may be less accurate."* |
| Every candidate | flagged `degraded: true`, shown in the main list |
| **`full-update` removals** | **WITHHELD ENTIRELY**, by the same mechanism as the §8.2 low-yield path (`computeRemovals: false`). A lower-quality read must never propose mass removal. `T-AI-036`. |
| Offered actions | Re-extract (US-034), Discard, Confirm additions only |

`degradedExtraction` and `lowYield` are independent flags that both force
`computeRemovals: false`. `T-AI-036` asserts a degraded full-update batch
produces `provenance.removed.length === 0`.

### 2.3 The interface

`apps/api/src/extraction/TitleExtractor.ts` — **the interface itself is
unchanged** (US-006 AC-1). `ExtractedTextItem` gains four fields; every
call site above stage 1 is untouched.

```ts
export interface ExtractedTextItem {
  /** Verbatim visible text for this tile/line. '' when the tile had no legible text. */
  rawText: string;
  /** The vision model's identification of the work. null from OCR, and null when
   *  the model declined to guess (basis: 'unknown'). NEVER a guess. */
  inferredTitle: string | null;
  /** How the reader arrived at it. */
  basis: 'text' | 'artwork' | 'both' | 'unknown';
  /** Set by crossCheck(), NOT by any provider. 'not-checked' when OCR was unavailable. */
  ocrSupport: 'exact' | 'partial' | 'none' | 'not-checked';
  /** Which reader produced this item. */
  provider: 'llm' | 'ocr-only';
  /** Normalised device-independent box, 0..1, origin top-left. */
  boundingBox: { x: number; y: number; w: number; h: number };
  boxSource: 'ocr' | 'llm';
  /** Model or provider confidence 0..1, or null. */
  confidence: number | null;
}

export interface ExtractionResult {
  items: ExtractedTextItem[];
  /** 'ok' | 'ocr-unavailable' | 'llm-unavailable' (degraded) */
  crossCheck: 'ok' | 'ocr-unavailable' | 'llm-unavailable';
  /** Free-form provider diagnostics for logging only. MUST NOT influence behaviour. */
  providerMeta: Record<string, string | number | boolean | null>;
}

export interface TitleExtractor {
  readonly name: string;   // 'hybrid' | 'llm-vision' | 'azure-vision-read' | 'stub'
  /** `mimeType` is ONLY 'image/png' | 'image/jpeg'. HEIC/HEIF is transcoded to
   *  PNG on ingest (api.md §5.1) BEFORE bytes reach here, so the extractor never
   *  receives — and neither reader accepts — HEIC. Do not widen this union. (A42)
   *  (R5/A43) `imageBytes` has ALREADY passed the pre-decode pixel guard
   *  (api.md §5.0): dimensions are within 50…16,000 px per axis and
   *  width*height <= NEXTUP_MAX_DECODE_PIXELS. Do NOT add a second size check
   *  here — a second, separately-configured limit is how the two drift apart.
   *  (A45) `imageBytes` may have arrived by clipboard paste, drag-drop or file
   *  upload. THE EXTRACTOR IS NOT TOLD WHICH, and must not be: there is no
   *  ingestSource parameter here and none is to be added. A pasted PNG and an
   *  uploaded (transcoded) PNG are byte-equivalent inputs. */
  extract(imageBytes: Uint8Array, mimeType: 'image/png' | 'image/jpeg'): Promise<ExtractionResult>;
  // ⚠ `Uint8Array`, NOT `Buffer` (corrected in place, A48). This interface
  // lives in `packages/domain`, which `apps/web` imports verbatim (ADR-0004).
  // `Buffer` is Node-only, so typing it here makes the shared domain
  // un-importable in the browser. ~~`imageBytes: Buffer`~~ — superseded.
}
```

**Note what is still absent, deliberately:** no `service`, no `mode`, no
`ownerId`, no `batchId`, no TMDB anything. Rule B is still enforced by
the type.

```ts
// apps/api/src/extraction/factory.ts — the ONLY factory (path corrected, A48;
// ~~`extraction/index.ts`~~ — the backlog and the implementation both use
// `factory.ts`, and a barrel named `index.ts` invites re-export sprawl)
export function createExtractor(cfg: Config): TitleExtractor {
  switch (cfg.NEXTUP_EXTRACTOR) {
    case 'hybrid':            return new HybridExtractor(cfg);   // DEFAULT (ADR-0001 R2)
    case 'llm-vision':        return new LlmVisionExtractor(cfg); // no cross-check — diagnostics only
    case 'azure-vision-read': return new AzureVisionExtractor(cfg); // Revision 1 behaviour, still shipped
    case 'stub':              return new StubExtractor(cfg);      // test/dev only
  }
}
```

`NEXTUP_EXTRACTOR` defaults to **`'hybrid'`**. Stages 2–5 consume only
`ExtractionResult` and **must not change** when the extractor changes;
`T-AI-016` runs stages 2–5 twice over the same `ExtractionResult` fixture
produced by two differently-named extractors and asserts identical
`ExtractionCandidate` output. **Reverting to Revision 1 is one
configuration value** (ADR-0001 R2.9).

---

## 3. Stage 2 — deterministic clean-up

`apps/api/src/extraction/cleanup.ts`. Pure functions, no I/O, no inference.

### 3.1 The governing rule (REQ-012, ADR-0001)

> **CLASSIFY AND SURFACE. NEVER DROP AND HIDE.**
> No heuristic in this stage may delete a candidate. Every extracted item
> becomes an
> `ExtractionCandidate` document with a `cleanupVerdict`. Filtering is a
> *presentation* decision made in the review pass, and every group is visible
> with a count. Otherwise a heuristic that is wrong about a real title removes
> it silently — the exact failure class this product is built to avoid.

### 3.1a Which string feeds matching (new in Revision 2)

```ts
const matchText = item.inferredTitle ?? item.rawText;
```

`inferredTitle` is preferred because it is the *identified work*, which
is what the §4 matcher needs and what makes truncated tile captions
matchable at all. `rawText` is **always retained verbatim** on the
candidate and is **always shown in the review card** next to the
resolved match (US-007 AC-3), so the owner can see exactly what was on
screen versus what the reader concluded. **Never discard `rawText` in
favour of `inferredTitle`.**

### 3.2 Steps, in order

| # | Step | Rule |
|---|---|---|
| 1 | **Reading-order grouping** | **Applies only to `provider: 'ocr-only'` items.** Sort by `(round(y*40), x)`. Merge two items into one candidate when their vertical centres differ by < 40 % of the taller box's height **and** their horizontal gap is < 3 % of image width. ⚠ These three constants are **uncalibrated** and are now a *secondary* path only — the primary reader groups tiles natively (ADR-0001 R2.3a). `provider: 'llm'` items are already one-per-tile and are **never** merged. |
| 2 | **Length gate** | `matchText.length < 2` or `> 200` → `chrome-suspected`. |
| 3 | **Chrome vocabulary** | Case-insensitive exact match against `CHROME_TERMS` (`apps/api/src/extraction/chromeTerms.ts`): `my list`, `continue watching`, `watchlist`, `saved`, `downloads`, `search`, `home`, `browse`, `settings`, `profile`, `new & popular`, `coming soon`, `top 10`, `trending now`, `for you`, `series`, `movies`, `sign out`, `remove from my list`, `play`, `more info`, `resume`, `episodes`, `hbo max`, `max`, `netflix`. → `chrome-suspected`. **Substring matches do not count** — "Play" as a whole line is chrome; *The Play* is a title. **Applies only to `provider: 'ocr-only'` items** — the primary reader is instructed not to report chrome as a tile, and applying a fixed vocabulary to its output would suppress a genuine title named after a UI word. |
| 4 | **Digit/symbol ratio** | > 60 % of characters are digits or punctuation → `chrome-suspected` (progress bars, durations, "1h 52m", "S2:E4"). `ocr-only` items only. |
| 5 | **Year extraction** | A trailing or parenthesised 4-digit token in `1880..currentYear+5` is lifted into `extractedYear` and **removed from the text used for matching**. It is **not** part of identity (data-model SD-05). |
| 6 | **Normalisation** | `normalisedText = normaliseTitleText(matchText)` — the single shared function (data-model §2.2). No second implementation. |
| 7 | **Low confidence** | `confidence !== null && confidence < EXTRACT_CONFIDENCE_FLOOR (0.55)` → `low-confidence`. |
| 7a | **Unsupported inference (new, R2)** | `provider === 'llm'` **and** `ocrSupport === 'none'` → `inferred-unverified`. This is the fabrication flag *and* the artwork-read flag — they are indistinguishable from inside the system, which is precisely why both are shown to the owner. |
| 7b | **Model declined (new, R2)** | `basis === 'unknown'` and `rawText !== ''` → carries on as a normal candidate on `rawText`. `basis === 'unknown'` **and** `rawText === ''` → `unreadable-tile`: the tile is surfaced with its cropped thumbnail and no text. **Never dropped.** |
| 8 | **Empty after normalisation** | `normalisedText === ''` and no thumbnail available → `chrome-suspected`. |
| 9 | **Pass A collapse** | Deterministic pre-match overlap collapse on exact `normalisedText` (data-model §7.4). When an `llm` item and an `ocr-only` item collapse together, the **`llm` item wins** and its `ocrSupport` is upgraded to `'exact'`. |

Everything not caught by 2/3/4/8 is `title-candidate`. Verdicts
`low-confidence`, `inferred-unverified` and `unreadable-tile` are
**flags on a visible candidate**, not exclusions.


### 3.3 What each verdict means downstream

| Verdict | Matched against TMDB? | Shown in review? | Default disposition |
|---|---|---|---|
| `title-candidate` | yes | in the main list | `pending` |
| `low-confidence` | yes | in the main list, with a **"low confidence — check this"** flag | `pending` |
| **`inferred-unverified`** *(new, R2)* | yes | in the main list, with a **"read from the artwork — check this"** flag **and the tile thumbnail shown next to the proposed title** | `pending` |
| **`unreadable-tile`** *(new, R2)* | no | in the main list, as a **thumbnail with no title** and a "search for this" action into manual entry (US-009) | `pending` |
| `chrome-suspected` | **no** (saves TMDB calls) | in a collapsed **"Probably not titles (N)"** group with a visible count and a one-click "this is a title" that re-runs matching for that item | `pending` |
| *(any of the above, on an `ocr-only` orphan)* | as above | additionally flagged **"the text reader saw this but the tile reader did not"** | `pending` |

**The thumbnail requirement on `inferred-unverified` is the mitigation
for `RSK-028` (fabrication).** A proposed title with no independent text
support must be shown *beside the pixels it was derived from*, so that
verifying it is a glance rather than an act of faith. An implementation
that shows the title alone reduces this decision to trusting the model,
which ADR-0001 R2.5 explicitly refuses. `T-AI-041`.

`T-AI-004` asserts that for a fixture containing one item of each
verdict, the review response contains all of them and the
`chrome-suspected` group carries a non-zero count.


---

## 4. Stage 3 — identity and matching (deterministic; Rule A)

`apps/api/src/matching/tmdbMatcher.ts`.

### 4.1 TMDB usage

- Endpoints: `GET /3/search/multi?query=&include_adult=false` and
  `GET /3/{movie|tv}/{id}` for metadata (REQ-029).
- Auth: `TMDB_API_KEY`, a Container Apps **secret**, never logged, never sent
  to the browser.
- Rate limiting: at most **4 concurrent** requests, minimum 30 ms spacing;
  retry twice on 429/5xx with 1 s / 4 s backoff.
- Results are cached in-process for the lifetime of a batch keyed on
  `normalisedText` so repeated candidates cost one call.

### 4.2 Scoring — plain string comparison, no model

```ts
score(candidate, tmdbResult): number  // 0..1
```

1. `a = candidate.normalisedText`; `b = normaliseTitleText(tmdbResult.name)`
   — **the same function**, so both sides are normalised identically.
2. Base score = `a === b ? 1.0 : jaroWinkler(a, b)` (`jaro-winkler` npm
   package; deterministic, no ML).
3. **Year hint (SD-05's only use of `extractedYear`):** if
   `candidate.extractedYear !== null` and TMDB's year is within ±1, add
   `0.05`; if it differs by more than 1, subtract `0.15`. Clamp to `0..1`.
4. Popularity is **not** used in scoring — it would make the result
   time-varying and untestable. Ties are broken by **lower `tmdbId`**, which is
   stable forever.

### 4.3 Thresholds

```ts
export const MATCH_AUTO_THRESHOLD  = 0.92;  // >= : resolved to that TMDB work
export const MATCH_REVIEW_FLOOR    = 0.70;  // [floor, auto) : resolved, but flagged 'uncertain match'
                                            // <  floor      : UNMATCHED
```

| Outcome | `resolvedWorkIdentity` | `matchCandidates` |
|---|---|---|
| top score ≥ 0.92, and the runner-up is ≥ 0.05 behind | `tmdb:{type}:{id}` | top 5, still returned |
| top score ≥ 0.92 but the runner-up is within 0.05 (an ambiguity, e.g. a remake) | `tmdb:{type}:{id}` of the top, **flagged `ambiguous: true`** | top 5 |
| 0.70 ≤ top score < 0.92 | `tmdb:{type}:{id}`, flagged `uncertain: true` | top 5 |
| top score < 0.70, or TMDB returned nothing | `unmatched:<hash>` (data-model §2) | top 5 (may be `[]`) |

**Alternatives are always returned, never hidden** (US-007 AC-4). Even an
auto-matched candidate carries its top-5 alternates, so a one-tap correction is
always available in the review pass.

**TMDB unreachable** → every candidate in the batch resolves to
`unmatched:<hash>`, the batch **still reaches `in-review`**, and the review pass
displays a banner: *"Couldn't reach TMDB — nothing was matched. You can still
confirm these as unidentified titles, or discard the batch and try again
later."* (US-007 AC-6). Extraction does **not** fail. `T-AI-017`.

### 4.4 Structural enforcement of Rule A

- `apps/api/src/matching/` has **no import path** to `apps/api/src/extraction/`
  other than the `ExtractionCandidate` type. Enforced by an ESLint
  `no-restricted-imports` rule declared in `eslint.config.cjs` and by
  `T-AI-012`. ~~declared in `.eslintrc.cjs`~~ — ESLint 10 removed `.eslintrc.*`
  support entirely and the repo now uses flat config; a rule added to the old
  file would be silently ignored, and `T-AI-012` would fail with no obvious
  cause.
- `T-AI-013` is a **network-shaped** test: it runs a full extraction with a
  recording HTTP fake, then asserts that **no request whose host is the vision
  endpoint carries a body or header containing any string from the TMDB
  fixture set** (title names, ids, overviews). This is the test that catches a
  future "let's ask the LLM to pick the right TMDB result" change.

---

## 5. Stage 4 — the suppression gate (REQ-071)

**Position in the pipeline is the requirement.** The gate runs **after**
identity resolution and **before any record is created or any candidate is
staged for review**.

```ts
// apps/api/src/extraction/suppressionGate.ts
const suppressed = await repo.pointReadSuppression(ownerId, candidate.resolvedWorkIdentity);
if (suppressed?.active === true) {
  batch.extractionStats.suppressedGated++;
  continue;   // no ExtractionCandidate staged, no Title, no ServiceListing, nothing shown
}
```

- Cost is one **primary-key lookup** per candidate against *(R4 — a single
  indexed row lookup on Azure SQL; was a Postgres PK lookup in R3, a Cosmos
  point read in R1; ADR-0005 Rev 3)*
  the `suppression` row for `(owner_id, work_identity)` — an index seek, no
  scan.
- Applies identically to `tmdb:*` and `unmatched:*` (data-model §2.3.1). **No
  branch on prefix.** `T-SUP-005`.
- Applies in **both** modes and in re-extraction (US-034 AC-6).
- In `full-update` mode, suppressed works are additionally excluded from the
  disappeared/removal section (REQ-073), which follows automatically because
  they were never present as active listings — plus an explicit filter for the
  case where the work was suppressed *while* holding an active listing
  (`T-SUP-004`).
- **The mandated test (US-028 AC-3, PRD R-5):** suppress a work → run a
  `full-update` batch that removes it → run a later batch that contains it
  again → assert **no** `Title` and **no** `ServiceListing` were created and
  the work appears nowhere in the review pass. `T-SUP-003`. This is the test
  that catches a row-scoped suppression flag, which would otherwise pass every
  other test in the suite.

---

## 6. Stage 5 — classification and the human-in-the-loop contract

### 6.1 Classification (REQ-010)

For each surviving candidate, against the *current* listings of the batch's
service:

```
classification = existsActiveListing(workIdentity, batch.service)
  ? 'already-present-for-this-service'
  : 'new'
```

### 6.2 The review contract — nothing is written without a human (REQ-013/014)

| Property | Guarantee |
|---|---|
| No silent write | Extraction writes **only** `extractionCandidate` and `uploadBatch` documents. It never writes a `title` or a `ServiceListing`. `T-BATCH-003`. |
| No accept-by-inaction | Default `reviewDisposition` is `pending`. Closing a batch with pending additions is refused (`specs/api.md` §7.9, 409 `PENDING_ADDITIONS`). US-012 AC-3. |
| Removals are opt-out, not opt-in | Every removal is **ticked by default** (REQ-055), individually untickable (REQ-021), and confirmed **as one group** (REQ-020). Never a side effect of closing. `T-REV-004`. |
| Abandonment is safe | Discarding or abandoning an `in-review` batch writes nothing to the list (US-005 AC-4). `T-BATCH-006`. |

### 6.3 Mode-dependent review scope — the single most important safety property

> **In `full-update` mode the review pass shows ALL extracted titles**,
> including those already present for that service. In `append-only` mode it
> shows **only the new ones.** (REQ-057, US-013 AC-6.)

**Why the full-update rule is load-bearing.** In a full-update batch, absence
means removal. If the review pass hid already-known titles, the owner would
have no way to see that a title *they know is on the service* failed to
extract — and its absence would be silently reconciled as a removal. Showing
all extracted titles turns a silent data-loss bug into a visible discrepancy
the owner can act on. **This is the most important safety property in the
product** and it has a dedicated test, `T-REV-006`: a full-update batch where
one already-present title is extracted and one already-present title is not,
asserting the extracted one appears in an "Already on your list (N)" section
and the un-extracted one appears in the removal section.

Presentation of the two modes (detail in `specs/ux-states.md` §4):

| Section | `append-only` | `full-update` |
|---|---|---|
| Additions (new) | shown, expanded | shown, expanded |
| Already on your list | **not shown** | **shown**, collapsible, **never omitted**, with a visible count |
| Probably not titles | shown collapsed with count | shown collapsed with count |
| Disappeared / removals | **not shown at all** (REQ-022) | shown, expanded, all ticked |

---

## 7. Confidence handling — every threshold in one place

`apps/api/src/config.ts`:

```ts
export const EXTRACT_CONFIDENCE_FLOOR = 0.55;  // below → cleanupVerdict 'low-confidence'
export const OCR_SUPPORT_EXACT        = 0.95;  // crossCheck: ocrSupport 'exact'
export const OCR_SUPPORT_PARTIAL      = 0.75;  // crossCheck: ocrSupport 'partial'
export const OCR_BOX_OVERLAP_MIN      = 0.20;  // geometry scoping for the cross-check
export const MATCH_AUTO_THRESHOLD     = 0.92;
export const MATCH_REVIEW_FLOOR       = 0.70;
export const MATCH_AMBIGUITY_DELTA    = 0.05;
export const ZERO_YIELD_IMAGE_RATIO   = 0.5;   // §8
export const FABRICATION_RATE_CEILING = 0.05;  // §9 gate only — never a runtime filter
```

Every threshold is an exported constant with a named test asserting the
behaviour at the boundary (`T-AI-018`, table-driven over
`[0.54, 0.55, 0.69, 0.70, 0.74, 0.75, 0.91, 0.92, 0.94, 0.95]`). **A
threshold is never inlined at a call site**; `T-AI-019` greps for numeric
literals in the matcher, cleanup and cross-check modules.

**Nothing in this list ever removes a candidate.** Low confidence flags.
Absent OCR support flags. `FABRICATION_RATE_CEILING` is an
**evaluation gate in §9 only** — ⚠ it must **never** be used at runtime
to drop or hide a candidate, because doing so would silently discard
exactly the artwork-read titles this decision was made to obtain
(`REQ-012`). `T-AI-042` asserts `FABRICATION_RATE_CEILING` is not
referenced anywhere under `apps/api/src/`.


---

## 8. Low- and zero-yield extraction — the OQ-024 behaviour

> **REVISION 2 note.** `OQ-024`'s original framing — *"does the capture
> surface render title text at all?"* — was existential under Revision 1,
> because artwork-only tiles defeated the extractor entirely (`RSK-021`,
> **High**). Under Revision 2 the primary reader identifies works from
> artwork, so `RSK-021` drops to **Low** and `OQ-024` becomes a
> *measurement* question: **how well does the model identify artwork-only
> tiles?** — answered by the §9.5 live suite, not by an owner's ten-minute
> inspection. **The low-yield behaviour below is retained in full and
> unchanged**, because it is the safety net for *any* poor read — a
> degraded batch, a provider outage, a bad capture — not just for the
> artwork case.


### 8.1 Detection

After stage 5, using `uploadBatch.extractionStats`:

```ts
const zeroYieldRatio = imagesWithZeroCandidates / imagesProcessed;
const lowYield  = candidatesAfterCleanup === 0
               || zeroYieldRatio >= ZERO_YIELD_IMAGE_RATIO;   // 0.5
```

### 8.2 Behaviour

| Case | Behaviour |
|---|---|
| **Any image yields zero candidates** (any mode) | That image is named in the review pass: *"No text was found in `screenshot-3.png`."* The image thumbnail is shown. **Never a silent skip.** (US-006 AC-3.) `T-AI-020`. |
| **`lowYield` in `append-only`** | Review pass renders normally with a banner: *"Only N titles were read from M screenshots. Check the list below before confirming."* No safety risk — absence means nothing here. |
| **`lowYield` in `full-update`** | **The removal/disappeared section is WITHHELD ENTIRELY.** The batch is flagged `lowYield: true`, the review pass shows the additions and the "already on your list" sections, and displays: *"Not enough titles were read from these screenshots to safely work out what's been removed, so nothing will be removed by this batch. You can re-extract these images, add more screenshots, or discard this batch."* Actions offered: **Re-extract** (US-034), **Discard**, **Confirm additions only**. (US-014 AC-6.) `T-AI-021`. |
| **Zero candidates in total, `full-update`** | Same as above; the additions section is empty and the batch can only be re-extracted or discarded. |

**Reconciliation MUST NOT run over the removal half of a `lowYield`
full-update batch.** The check happens *before* `reconcile()` is called, and
`reconcile()` receives `computeRemovals: false`. `T-AI-022` asserts a
zero-candidate full-update batch produces `provenance.removed.length === 0`.

### 8.3 Escalation and degradation paths (Revision 2)

The escalation direction has **reversed**. Under Revision 1 the plan was
OCR-primary escalating *to* an LLM. Under Revision 2 the LLM **is** the
primary and OCR is the always-on cross-check, so the only remaining path
is *downward*:

| Situation | Response |
|---|---|
| LLM provider unavailable | **§2.2a degraded mode** — OCR-only extraction, banner, removals withheld in full-update. Configuration-free, automatic. |
| Owner or operator wants Revision 1's behaviour permanently | `NEXTUP_EXTRACTOR='azure-vision-read'`. One value. That implementation still ships and is still tested. |
| Measured artwork-only recall < 0.50 on §9.5 | The decision bought nothing — an ADR-0001 revisit trigger (R2.9e). |
| Measured fabrication rate > `FABRICATION_RATE_CEILING` despite the cross-check | ADR-0001 revisit trigger (R2.9a). **Do not respond by filtering at runtime** — see §7. |

Manual entry via TMDB search (US-009,
`POST /api/batches/:id/manual-entry`) remains a normal, permanently
available product feature. Per `A40(e)` it is **no longer framed as a
contingency product**: the feeder loop is not at risk and the locked cut
line is not in play.


---

## 9. Evaluation — golden fixtures and the determinism strategy

> **READ THIS FIRST.** The primary reader is a **sampled model** and its
> output is **not** reproducible. The determinism guarantee has therefore
> *moved*, not vanished. An implementer who tries to assert exact equality
> against a live model response will produce a flaky suite and will
> "fix" it by weakening the gates. Do not.

### 9.0 The three test tiers

| Tier | What it covers | Determinism | Network | Runs |
|---|---|---|---|---|
| **T1 — pipeline** | Stages 1c–5 (cross-check merge, cleanup, identity, suppression, classification) | **Byte-identical. Gate = 1.0. Non-negotiable.** | none | CI, every PR |
| **T2 — stage-1 contract** | The two providers' request/response handling: schema parsing, strict-schema rejection, `finish_reason: 'length'`, refusals, 429/5xx retry, timeouts, degraded mode | **Byte-identical** — replayed from *recorded* HTTP fixtures via `msw` | none | CI, every PR |
| **T3 — stage-1 quality** | Recall, fabrication, chrome, match accuracy, cross-run stability | **Band assertions over N=3 live runs. Never equality.** | live Azure | **manual only**, never CI |

**T1 and T2 keep CI exactly as it was: offline, free, deterministic, on
every pull request.** Only T3 is new, and T3 never gates a merge.

### 9.1 The fixture set

`tests/fixtures/golden/` — committed to the repository.

```
tests/fixtures/golden/
  manifest.json
  images/
    netflix-mylist-mobile-01.png
    netflix-mylist-mobile-02.png
    netflix-mylist-desktop-01.png
    netflix-continue-watching-01.png     # chrome-heavy negative case
    max-saved-mobile-01.png
    max-saved-desktop-01.png
    max-artwork-only-01.png              # the RSK-021 case — see 9.4
    blank-no-content-01.png              # NEW (R2): genuinely empty; drives the low-yield path
    truncated-titles-01.png              # NEW (R2): ellipsised captions; drives the R2.3b case
    low-quality-jpeg-01.jpg
    rotated-01.png
    dark-mode-01.png
  llm/
    <modelId>/<image>.llm.json           # RECORDED primary-reader response (raw HTTP body)
  ocr/
    <image>.ocr.json                     # RECORDED Vision Read response
  expected/
    <image>.expected.json                # the ASSERTED pipeline output
```

⚠ **`llm/` is scoped BY MODEL, `ocr/` and `expected/` are not** — and the
asymmetry is the point. `expected/` is ground truth about the *image*: it must
be identical for every model, or a comparison between two models is really a
comparison between two answer keys. `ocr/` is the deterministic cross-check and
does not vary with the primary reader. Only the reader's own response is
model-specific. The incumbent's directory is `llm/gpt-4.1/`.

~~`llm/<image>.llm.json` — recorded `gpt-4.1` response~~ *(superseded: a flat
`llm/` directory can hold exactly one model's recordings, so evaluating a
replacement reader would mean overwriting the incumbent's evidence and losing
the ability to compare. See §9.7.)*

`manifest.json` records, per image: `id`, `service`, `surface`,
`deviceClass`, `captureNotes`, `expectedTitleCount`, `expectedArtworkOnly`,
and a `provenance` note confirming the image is a synthetic or
owner-authorised capture.

`expected/<image>.expected.json`:

```jsonc
{
  "imageId": "netflix-mylist-mobile-01",
  "expectedCandidates": [
    { "normalisedText": "dune", "verdict": "title-candidate",
      "expectedWorkIdentity": "tmdb:movie:438631", "expectedBasis": "text" },
    { "normalisedText": "andor", "verdict": "title-candidate",
      "expectedWorkIdentity": "tmdb:tv:83867", "expectedBasis": "both" }
  ],
  "expectedChrome": ["my list", "continue watching"],
  "minRecall": 0.9,
  "maxFalseTitles": 1,
  "maxFabricated": 0
}
```

### 9.2 T1 — the offline pipeline suite (`T-AI-030`, `T-AI-031`)

`StubExtractor` replays `llm/<image>.llm.json` **and**
`ocr/<image>.ocr.json`, keyed on the sha256 of the image bytes, through
the **real** `crossCheck()` and the real stages 2–5. No network, no Azure
account, no cost, every PR.

| Metric | Definition | Gate |
|---|---|---|
| **Title recall** | expected titles produced as `title-candidate`, `low-confidence` or `inferred-unverified` ÷ expected titles | per-image `minRecall`; **aggregate ≥ 0.95** *(raised from 0.90 — `NFR-012a` buys quality, so the gate must reflect it; `max-artwork-only-01` is now **included**)* |
| **False-title rate** | candidates verdicted `title-candidate` that are not expected titles | per-image `maxFalseTitles`; aggregate ≤ **0.10** |
| **Fabrication rate** *(new, R2)* | candidates with `ocrSupport === 'none'` that are **neither** an expected title **nor** a TMDB match ÷ total candidates | ≤ **0.05** (`FABRICATION_RATE_CEILING`) — `T-AI-032` |
| **Omission recovery** *(new, R2)* | expected titles present in the OCR recording but absent from the LLM recording that **are** recovered as `ocr-only` orphans | **1.0, non-negotiable** — `T-AI-039` |
| **Chrome rejection** | expected chrome strings verdicted `chrome-suspected` | ≥ **0.80** — deliberately not 1.0, because over-rejecting is worse than under-rejecting (§3.1) |
| **Match accuracy** | correct `workIdentity` ÷ expected titles, against recorded TMDB fixtures | ≥ **0.90** |
| **Determinism (1c–5)** | same recordings in → identical `ExtractionCandidate[]` out, across 3 runs | **1.0, non-negotiable** — `T-STUB-001`, `T-AI-034` |

### 9.3 T2 — the stage-1 contract suite (`T-AI-033`, offline)

Recorded HTTP bodies replayed through `msw` against the **real**
`LlmVisionExtractor` and `AzureVisionExtractor`. Byte-deterministic
because the response is a recording. Cases, each a committed fixture:

| Fixture | Asserted |
|---|---|
| `valid.response.json` | Parses; every field mapped; `basis`/`confidence`/`box` carried through |
| `unknown-field.response.json` | An unexpected property → **rejected**, `EXTRACTOR_ERROR`. Never silently ignored. |
| `service-field.response.json` | A response containing a service/platform field → rejected; `T-AI-011b` |
| `truncated.response.json` (`finish_reason: 'length'`) | → `EXTRACTOR_ERROR`. **Never treated as a complete tile list.** `T-AI-040` |
| `refusal.response.json` (content filter) | → `EXTRACTOR_REFUSED`, image named. Never an empty success. |
| `429.response.json` | 2 retries at 1 s / 4 s, then `EXTRACTOR_UNAVAILABLE` |
| `llm-down + ocr-ok` | → **degraded mode**, `crossCheck: 'llm-unavailable'`, removals withheld in full-update. `T-AI-036` |
| `ocr-down + llm-ok` | → proceeds, all items `ocrSupport: 'not-checked'`, banner shown |
| `both-down` | → `extraction-failed`; list byte-identical (`T-AI-015`) |

### 9.4 The artwork-only fixture — its meaning has inverted

Under Revision 1, `max-artwork-only-01.png` had
`expectedTitleCount: 0` and existed to prove the **low-yield path**
fired. Under Revision 2 the primary reader is expected to **read it**.

> ⚠ **The single most likely implementation error in this revision.**
> `max-artwork-only-01.png` is **no longer** the low-yield fixture. Its
> `expectedTitleCount` becomes the real number of works in the image and
> it becomes the headline `RSK-021` fixture:
>
> - `T-AI-035`: recall on `max-artwork-only-01.png` ≥ **0.80**, with
>   every recovered candidate carrying `basis: 'artwork'` and
>   `cleanupVerdict: 'inferred-unverified'`.
> - **A new fixture, `blank-no-content-01.png`** (a genuinely
>   contentless image), takes over as the low-yield driver for
>   `T-AI-021` / `T-AI-022`.
>
> Do not delete `T-AI-021`. Do not point it at the artwork fixture.
> Repoint it at `blank-no-content-01.png`.

`truncated-titles-01.png` is the R2.3b fixture: `T-AI-043` asserts that
an ellipsised caption resolves to the **complete** TMDB work, that
`rawText` retains the ellipsis verbatim, and that the candidate is
matched rather than `unmatched:<hash>`.

### 9.5 T3 — the live quality suite (`npm run golden:live`) — **manual only**

Replaces Revision 1's `golden:record`. Requires `NEXTUP_AOAI_ENDPOINT`,
`NEXTUP_VISION_ENDPOINT` and a signed-in Azure identity. `T-CI-004`
asserts **neither** script is referenced by any workflow file.

It runs each golden image **N = 3 times** against the live model and
asserts **bands**, never equality:

| # | Assertion | Gate |
|---|---|---|
| L1 | Per-image title recall ≥ that image's `minRecall` | must hold in **3 of 3** runs |
| L2 | **Set stability** — Jaccard similarity of the normalised accepted-title sets between every pair of runs | ≥ **0.95** |
| L3 | **Unstable titles** — expected titles appearing in fewer than 3 of 3 runs | ≤ **5 %** of expected titles, **and each is printed by name** in the report |
| L4 | Fabrication rate per run (§9.2 definition) | ≤ **0.05** |
| L5 | False-title rate per run | ≤ **0.10** |
| L6 | Artwork-only recall (`max-artwork-only-01.png`) | ≥ **0.80** in 3 of 3 |
| L7 | **Cost of the whole run**, computed from reported token usage | ≤ **$0.50** — a regression guard on prompt/token growth |

> **The prohibitions, stated so they cannot be misread:**
> - **Never** assert exact string equality against a live model response.
> - **Never** assert exact ordering; compare **sorted sets**.
> - **Never** assert an exact candidate count; assert recall and false-rate.
> - **Never** run T3 in CI, on a schedule, or in a pre-commit hook. It
>   costs money and it is allowed to be flaky. It is a **human-run
>   measurement**, and its output is a report, not a pass/fail gate on a
>   merge.

Its output is written to `docs/evaluation/golden-<ISO date>.md` and
committed. **A drop between two such reports is the only early warning
of model drift the product has** — the same mechanism Revision 1 relied
on, now with an explicit artefact.

### 9.6 Refreshing the recordings

`npm run golden:record` re-records `llm/<modelId>/*.llm.json` and
`ocr/*.ocr.json` from the live services and is **manual and human-reviewed**.
It takes `--model <deployment>` and writes into that model's directory only;
with no flag it targets the incumbent (`gpt-4.1`). Because the LLM response is
sampled, a refresh **will** produce a diff even with no provider change — so
the review question is *"did the metrics in §9.2 move?"*, never *"is the diff
empty?"*. `T-CI-004`.

### 9.7 Choosing the primary reader — the bake-off protocol (`T-AI-045`)

The model named in ADR-0001 is a **quality** decision (`NFR-012a`). This
section defines how it may be changed, so that the change is driven by measured
evidence rather than by price or novelty. It applies to any candidate primary
reader — `gpt-5.4-mini` is the first one to be evaluated under it.

**⚠ The decision rule below is PRE-COMMITTED. It is written here, and must be
merged, BEFORE any candidate's numbers are known.** Deciding the rule after
seeing the results is not evaluation; it is choosing the threshold that
selects the answer you already preferred, and the cheaper model will always be
the one that benefits. If the rule needs to change, change it in a separate
commit that states why, before the run.

**Stage 0 — disqualifiers, checked before a single image is spent.**
A candidate is rejected outright, with no measurement, if it does not support
all of: vision input, **strict** Structured Outputs (`additionalProperties:
false` honoured, per §2.1a), `temperature: 0`, `seed`, and availability in the
deployment region. Any of these missing changes the *contract*, not the
quality, and §2.1a's guarantees stop holding.

**Stage 1 — identical inputs.** Both models are recorded against the **same**
`images/`, scored against the **same** `expected/`, and cross-checked against
the **same** `ocr/`. The prompt (`EXTRACTION_SYSTEM_PROMPT`), the schema
(`TILE_SCHEMA`), `detail: 'high'`, `max_tokens`, `temperature` and `seed` are
byte-identical between arms. **The only permitted difference is the deployment
name.** A prompt tuned for one arm invalidates the comparison.

**Stage 2 — three runs per image per model.** `temperature: 0` and a fixed
seed make a hosted service *nearly* deterministic, not deterministic. Report
per-run variation; a candidate whose own three runs disagree more than the
incumbent's is less suitable regardless of its mean, because §9.5's stability
floor (Jaccard ≥ 0.95) is a product requirement.

**Stage 3 — the decision rule.**

| Metric | Rule for the challenger |
|---|---|
| **Omission recovery** | **= 1.0. No trade, no exception.** REQ-012 |
| **Fabrication rate** | ≤ 0.05 **and** ≤ the incumbent's |
| Title recall (aggregate) | ≥ 0.95 **and** ≥ the incumbent's |
| Artwork-only recall | ≥ 0.80 **and** ≥ the incumbent's |
| False-title rate | ≤ 0.10 **and** ≤ the incumbent's |
| Chrome rejection | ≥ 0.80 |
| Run-to-run stability | Jaccard ≥ 0.95, and ≥ the incumbent's |
| **Cost** | **Tie-breaker ONLY.** Never a reason to accept a worse reader |

**The challenger replaces the incumbent only if it wins or ties on every row.**
Better-on-some / worse-on-others means **the incumbent stays** — a mixed result
is not an upgrade, and defaulting to the incumbent under uncertainty is what
keeps `NFR-012a` from being eroded one small regression at a time.

**Stage 4 — what counts as a difference.** The corpus is **12 images**. One
title found or missed moves aggregate recall by roughly 1/N of a surface's
titles, so **a single-title delta is noise, not evidence.** The report states
per-image counts, not only aggregates, and any conclusion drawn from a
difference smaller than two titles on any single metric must say so
explicitly. If the two arms differ only inside that band, the honest finding is
**"no measured difference"** — which, by Stage 3, means the incumbent stays.

**Outputs.** A report at `docs/evaluation/model-bakeoff-<date>.md` carrying
both arms' full metric tables, the per-image deltas, the observed cost of the
run, and the resulting decision — **including when the decision is "no
change", which is a result worth recording and not a wasted run.** A change of
reader additionally requires an ADR-0001 revision; the model is named there,
in this section, in §10's cost model and in `.env.example`.

**Cost and safety of running it.** 12 images × 3 runs × 2 arms = **72 vision
calls**, ≈ **$0.68** at §10's per-image figure. This is manual-only and never
runs in CI — `T-CI-007` forbids egress from the test run, and these are real
calls carrying real screenshots.


---

## 10. Cost controls (NFR-012a)

> **`NFR-012a` inverts the ordering for this component: quality outranks
> cost.** The controls below exist to stop *runaway* or *accidental*
> spend — a retry loop, an oversized batch, a prompt regression. **None
> of them may be tightened, and no model may be downgraded, in order to
> reduce the ordinary per-image cost.** That is explicit non-compliance.

**Projected spend (ADR-0001 R2.8):** **~$0.50–$0.70/month** steady state
(~50 images), **~$1.40–$2.10** in a bulk-import month (~150), **~$0.56**
for the one-off first import. `gpt-4.1` at ~$0.0094/image; the `Read`
cross-check is $0.00 on F0.

| Control | Value | Where |
|---|---|---|
| Model deployment | `gpt-4.1`, **Standard pay-as-you-go**, explicit pinned version, **no PTU and no commitment** — `NFR-012` still forbids fixed monthly charges | `infra/aoai.bicep`; `T-INFRA-005` asserts the SKU is `Standard`, never `ProvisionedManaged` |
| Vision SKU | **F0 free tier** (cross-check) | `infra/vision.bicep`, SKU pinned |
| `max_tokens` | **4096** — bounds output cost per call | `config.ts` |
| Images per batch | **40** | `specs/api.md` §5; a 41st → 400 `TOO_MANY_IMAGES` |
| Bytes per image / per batch | **10 MiB / 60 MiB** | 413 `IMAGE_TOO_LARGE` / `BATCH_TOO_LARGE` |
| Concurrent images in flight | **2** | serialised worker; also keeps the 0.25 vCPU container within budget |
| Retries | **2**, on transient codes only, never on 4xx | §2.2 |
| Re-extraction | **manual only**, one at a time, creates a new batch so its cost is visible in `extractionStats` | US-034 |
| Scheduled/background inference | **none exists** — no scheduler anywhere (REQ-041). *(R3: `minReplicas` is now 1, so the container is always warm; that removed the cold start, NOT the no-scheduler rule. An always-on container makes a background timer easier to add by accident, so `T-CI-005` matters more, not less.)* | `T-CI-005` asserts no cron/timer/`setInterval` in `apps/api/src` |
| Token accounting | Every call logs `promptTokens`, `completionTokens` and a computed cost into `uploadBatch.extractionStats.estimatedCostUsd` | Observability; surfaces a prompt regression as a number |
| Prompt-growth guard | §9.5 **L7**: a whole live golden run must cost ≤ $0.50 | `golden:live` report |
| Quota exhaustion | 429 after retries → **degraded OCR-only mode** (§2.2a), not failure, not silence | `T-AI-036` |

**`NFR-012` still holds for everything else.** Compute, database,
storage, auth, logging and CI remain free-tier or consumption with no
fixed commitment. The Azure OpenAI deployment is consumption-billed and
**adds no fixed monthly charge** — the carve-out relaxes the *magnitude*
for extraction, not the no-commitment rule.

**First-sprint verification (`TASK-010`, re-scoped):** confirm `gpt-4.1`
availability and quota in the chosen region, confirm the token prices
above against the live pricing page, and confirm Vision F0 availability.
Web retrieval was unavailable to the architect, so every figure here is
model knowledge (`RSK-024`).


---

## 11. Privacy and guardrails (NFR-009, NFR-015, NFR-016, NFR-017)

| Guardrail | Mechanism |
|---|---|
| No credentials of any kind reach us (NFR-009) | The product only ever accepts image bytes. There is no service-login flow. `T-SEC-001`. |
| Screenshot bytes leave only for extraction (NFR-015) | **Two** destinations now: the Azure OpenAI endpoint and the Vision endpoint. `T-SEC-004` asserts no *other* outbound request carries an `image/*` content type or a data URI; `T-SEC-031` pins the outbound host allow-list to exactly three hosts (Azure OpenAI, Azure AI Vision, TMDB). |
| **Azure OpenAI abuse-monitoring retention (new, R2 — a real regression)** | Azure OpenAI may retain prompts (**i.e. the owner's screenshots**) for up to **30 days** for abuse monitoring, with possible authorised human review, unless the **modified abuse monitoring / limited-access data-processing exemption** is granted. `Read` OCR has no equivalent. Given `RSK-014` (a screenshot may incidentally show a profile name or account email) this is disclosed, not glossed. **`TASK-134`: apply for the exemption before the first real upload.** Until granted, the exposure stands and is documented in `specs/security.md` §8 and in the owner-facing privacy note. |
| Same-region, no-training | Both services are deployed in the subscription's own region; Azure's no-training-on-customer-data commitment applies to both. |
| **Prompt injection (new, R2 — the surface now exists)** | A screenshot could contain text such as *"ignore previous instructions"*. Mitigations, all structural: (a) the image is the **only** untrusted input — no owner-authored free text ever enters a prompt; (b) **Structured Outputs with `strict: true`** means the response must satisfy the schema regardless of what the model was told, so an injection cannot change the response *shape*; (c) the output is consumed **only** as strings into deterministic string comparison — there is **no code path where extracted text is interpreted, executed, or used to build a request**; (d) `T-AI-044` runs a committed injection-attempt fixture and asserts the response still parses and no field escapes the schema. Worst case, an injection produces a wrong candidate — which the review pass catches. |
| PII in screenshots | Stored privately (ADR-0006), sent only to the two inference endpoints, purged at 30 days. Never logged: `rawText` and `inferredTitle` are logged **truncated to 40 characters at debug level only**; `providerMeta` is logged without image content; the prompt is never logged. `specs/security.md` §8. |
| Content policy | No generative prose is produced or displayed. The model returns only title strings, an enum and numbers. A content-filter refusal is surfaced as an extractor error (§2.2), never as an empty success. |
| Owner isolation (NFR-008) | Extraction runs under the batch's `ownerId`; the suppression gate and matcher never read across partitions. |

**Human-in-the-loop is still the whole safety model**, and it now carries
more weight than it did under Revision 1, because the primary reader can
fabricate. Nothing reaches the owner's list without explicit confirmation
(`REQ-013`); every unsupported inference is flagged and shown beside its
tile thumbnail (§3.3); and every omission the model makes is recovered by
the OCR cross-check (§2.1c step 2). There is no autonomous-action surface.


---

## 12. Re-extraction (US-034, REQ-074)

- `POST /api/batches/:batchId/re-extract` creates a **new** `uploadBatch` with
  `derivedFromBatchId = :batchId`, the **same `service` and `mode`**
  (US-034 AC-3), referencing the same `uploadedImage` documents. The images are
  not re-uploaded and not copied.
- The original batch's status, provenance and history are **not rewritten**
  (US-034 AC-4).
- Results enter only through the normal review pass (REQ-074, US-034 AC-2).
- Available only while images are retained; past `retainUntil`, the endpoint
  returns **410 `IMAGES_PURGED`** with the retention explanation
  (US-034 AC-5).
- The suppression gate applies unchanged (US-034 AC-6).

### 12.1 What re-extraction can and cannot recover from a memory failure *(new, R5; `A43-M2`)*

**Mirrored from `architecture.md` §Key flows / ADR-0008 R2.2 / `api.md`
§5.2.5. This is the authoritative answer for the extraction side and must not
be re-derived differently.** `REQ-074` re-extracts from **retained images** —
so the only question that matters is *was the image ever stored?*

| Failure | Image stored? | Recovery |
|---|---|---|
| `IMAGE_TOO_LARGE_TO_DECODE` (pre-decode guard) | **No** — refused before any allocation and before the blob write | **Re-attach the file to a new batch.** Re-extraction **cannot** help: there is nothing retained to re-extract |
| `IMAGE_DECODE_OOM` / `IMAGE_DECODE_FAILED` | **No** — the transcode precedes the blob write | **Re-attach.** Re-extraction does not apply |
| Hard OOM kill mid-request (path P2, `api.md` §5.2.2) | **Orphan blob at most**, never a referenced one | **Re-attach.** Images already accepted into the open batch remain staged and are not lost |
| **OOM during *extraction* of an already-stored image** | **Yes** | **This is re-extraction's designed case.** Up-size (`runbooks/scale-up-memory.md`), then `POST /api/batches/:batchId/re-extract`. No re-attach |

⚠ **The recovery window is 30 days.** `NFR-019` purges the retained bytes at
`retainUntil`, after which re-extraction returns **410 `IMAGES_PURGED`**. A
*reactive* up-size strategy implies a delay between the failure and the fix,
so this bound is real and new with `A43`: an OOM left unfixed for more than 30
days loses the retained artefact and forces a re-attach from the phone
(`runbooks/scale-up-memory.md` §6).

---

## 13. Traceability

| Requirement | Where satisfied |
|---|---|
| REQ-007/008 (extraction of titles from images) | §2, §3 |
| REQ-009 (both services, no service-specific logic) | Rule B, §2.1a schema + prompt, §2.3 |
| REQ-010 (classify new vs present) | §6.1 |
| REQ-011 (match to TMDB) | §4 |
| REQ-012 (nothing silently discarded) | §3.1, §3.3, **§2.1c step 2 (orphan recovery — now enforced against the model too)**, §7 (no runtime fabrication filter), data-model §7.4 |
| REQ-013/014 (review pass, no silent write) | §6.2 |
| REQ-024 (one row per canonical work) | §4, data-model §2 |
| REQ-029 (TMDB metadata stored) | §4.1 |
| REQ-057 (full-update shows all) | §6.3 |
| REQ-058 (extractor is service-agnostic) | Rule B, §2.1a strict schema + negative prompt instruction |
| REQ-071 (suppression gate before creation) | §5 |
| REQ-074 (re-extraction) | §12 |
| REQ-076 (lazy TMDB refresh) | `specs/api.md` §6.4 — **there is no scheduler** |
| NFR-002/003 (agent-implementable, testable) | §9.0 three-tier strategy; the determinism boundary is explicit |
| NFR-010 (extraction latency is not on the value loop) | §2.2 — extraction is asynchronous; the client polls |
| **NFR-012 (near-zero cost, everything except extraction)** | §10 — no fixed commitment anywhere; Standard SKU, not PTU |
| **NFR-012a (extraction: quality over cost, lowest reasonable price)** | §2.1a model selection + warning, §10 preamble, ADR-0001 R2.8 |
| NFR-014 (TMDB retention) | `specs/api.md` §6.4 |
| NFR-015/016/017 (privacy, TMDB terms, no third-party AI training data) | Rule A (+ R2.4 scope clarification), §11 |

