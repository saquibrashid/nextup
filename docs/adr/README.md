# Architecture Decision Records

Each ADR captures one significant, hard-to-reverse decision: its context, the
options weighed, the decision, and its consequences. ADRs are **append-only** —
a superseded decision is not deleted; a later revision section is added above
the retained original, and the status is updated.

> When two revisions of an ADR disagree, the **latest revision section is
> authoritative**. Struck-through or "retained verbatim" text is historical and
> must be treated as dead. The datastore decision (ADR-0005) and the hosting
> decision (ADR-0003) each changed twice — read the current revision.

| ADR | Decision | Status |
|---|---|---|
| [ADR-0001](ADR-0001-vision-ocr-extraction.md) | **Rev 2 (current):** Azure OpenAI `gpt-4.1` multimodal vision primary extractor **+** Azure AI Vision `Read` OCR (F0) deterministic cross-check, behind one `TitleExtractor` interface. | Accepted (Rev 2) |
| [ADR-0002](ADR-0002-identity-provider.md) | Microsoft Entra ID via Container Apps built-in auth (Easy Auth); allow-list in middleware. | Accepted |
| [ADR-0003](ADR-0003-hosting-and-compute.md) | **Rev 3 (current):** one Azure Container App, `minReplicas = 1`, 0.25 vCPU / 0.5 GiB, `ghcr.io` registry, serverless auto-paused staging DB; no scheduler anywhere. | Accepted (Rev 3) |
| [ADR-0004](ADR-0004-application-stack.md) | TypeScript end-to-end — React + Vite / Node + Express **+ Prisma**; NFR-004 applied as a real technical criterion. | Accepted |
| [ADR-0005](ADR-0005-datastore-and-data-model.md) | **Rev 3 (current):** Azure SQL Database Basic (5 DTU, 2 GB), separate serverless staging DB, Prisma `sqlserver`; invariants as filtered-unique-index constraints; 7-day PITR. | Accepted (Rev 3) |
| [ADR-0006](ADR-0006-screenshot-storage-and-retention.md) | Private blob, authenticated streaming, 30-day lifecycle purge; no URL that works without a session; blob soft-delete/versioning explicitly forbidden. | Accepted |
| [ADR-0007](ADR-0007-work-identity-and-unmatched-fallback.md) | Single opaque `workIdentity` with an `unmatched:<hash>` fallback that is **also** the suppression key, enforced by a `UNIQUE` constraint. | Accepted as amended |
| [ADR-0008](ADR-0008-heic-transcode-on-ingest.md) | **HEIC/HEIF transcoded to lossless PNG server-side, inline on ingest** (`heic-convert` → WASM `libheif-js`, decode-only, LGPL-3.0 notice retained). Neither extraction service accepts HEIC and only Safari renders it, so this is a required stage, not an optimisation. **Rev 3 (A45): now CONDITIONAL on the sniffed content type — pasted images are always PNG and skip it — but NOT deleted, because the iOS Photos file path still delivers raw HEIC. The condition keys on sniffed format, never on ingest source.** EXIF/GPS stripped on ingest. | Accepted |
| [ADR-0009](ADR-0009-dual-primitive-clipboard-ingest.md) | **Clipboard paste is the primary ingest affordance, built with TWO different primitives** — the `paste` event (Ctrl/Cmd+V) on desktop, and a **visible "Paste screenshot" button** calling `navigator.clipboard.read()` on iOS, because iOS offers no verified way to *initiate* a paste over non-editable content. Drag-and-drop is the third affordance. ⚠ **File selection is retained, not replaced** — `T-PASTE-010` guards against it being displaced. Web Share Target ruled out (unsupported in WebKit). | Accepted |

See [../architecture.md](../architecture.md) for the system design that these
decisions compose into.
