# ADR-0006 — Screenshot storage: private blob container, authenticated streaming, lifecycle purge

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-10 |
| **Deciders** | solution-architect (phase 7), autonomous |
| **Forced by** | **NFR-011, NFR-019, NFR-020**, REQ-007, REQ-074, REQ-041, NFR-012, RSK-014, **ASM-058/ADR-0008 (R5 — derived-PNG artefact)** |

## Context

Uploaded screenshots are the rawest personal data nextup holds. A
screenshot of a service's saved list may incidentally capture a profile
name, an account email, or other account chrome (`RSK-014`). Three
requirements govern them, and one of them exists specifically because
the obvious implementation is wrong:

- **NFR-011** — access is restricted to the owning owner identity.
- **NFR-019** — retained **30 days from upload**, then automatically and
  permanently deleted, with **no** consequential deletion of any title,
  listing, batch record or extraction result. This is the **only**
  automatic deletion in the entire product, and it exists only because
  the A37 rewording of `REQ-041` authorises it.
- **NFR-020** — *"MUST NOT make any stored image retrievable by an
  unauthenticated requester in possession of its URL."* The requirement
  text names its own reason: **"the default posture of blob-backed
  upload storage is exactly the wrong one here — a public container or
  an unexpiring shared-access URL satisfies NFR-011 as written from
  inside the application while leaving personal-account imagery
  world-readable to anyone with the link, and it fails silently:
  everything works."**

That last sentence is the whole design problem. Every convenient
implementation — public container, long-lived SAS URL, `<img src>`
pointing at storage — passes every functional test and violates NFR-020.

`REQ-074` requires re-extraction against a batch's images for as long as
they are retained, so the bytes must be readable by our own compute
throughout the window.

## Options considered

### Option A — Private container; bytes streamed through an authenticated API route

| | |
|---|---|
| Summary | Blob container with public access **disabled** and shared-key access **disabled**. The Container App reads blobs with its system-assigned managed identity. The browser requests `GET /api/images/:imageId`; the API authenticates the session (ADR-0002), checks `ownerId` on the `uploadedImage` document, checks `retainUntil`, then streams the bytes back. No storage URL is ever emitted to a client. |
| Pros | **NFR-020 is satisfied structurally: there is no URL that works without a session, because no storage URL is ever issued.** One authorisation decision, in one place, on the same code path as every other owner-scoped read (NFR-008). Works identically for the browser and for re-extraction. No key or SAS token exists to leak, expire, or be mis-scoped. |
| Cons | Image bytes traverse the container, consuming a little compute and bandwidth (negligible: a few hundred KB, a few times a month, and only on the review screens — never on the value loop). No CDN caching of images (irrelevant — these are private and rarely re-read). |
| Cost | ~$0.02/month storage; egress within free allowance. |
| Reversal cost | Very low. |

### Option B — Short-lived user-delegation SAS URLs issued per request

| | |
|---|---|
| Summary | The API mints a 60-second user-delegation SAS for each image and returns the URL; the browser fetches directly from storage. |
| Pros | Bytes bypass the container. Standard Azure pattern for large media. |
| Cons | **Reintroduces exactly the failure mode NFR-020 was written against, in a milder form**: for the lifetime of the token, possession of the URL *is* access, with no session required. It is also a mechanism whose safety depends entirely on getting the expiry, the permissions and the delegation-key rotation right — three parameters an autonomous implementer can silently get wrong, and where "too long" produces no visible symptom. The benefit it buys (offloading a few hundred kilobytes) is worth nothing at this volume. |
| Cost | Same. |
| Reversal cost | Low. |

### Option C — Store image bytes in Cosmos DB as base64 attachments

Rejected: consumes the 25 GB free-tier allocation with binary data, is
far more expensive in RU terms than blob storage, and Cosmos has no
lifecycle-management equivalent — the 30-day purge would need a TTL,
which means a store-level expiry mechanism sitting inside the same
container as records `REQ-028` forbids ever expiring. That is one
configuration mistake away from deleting list data. Categorically wrong
place for these bytes.

### Option D — Do not retain screenshots at all

Rejected: closed at `A35`/`OQ-009`. Retention for 30 days is what makes
`REQ-074` re-extraction possible, and re-extraction is the partial
substitute for the mixed-changeset batch undo deferred at A36.

## Decision

**We will store screenshots in a private Azure Blob Storage container
with public access and shared-key access both disabled, accessed
exclusively by the Container App's system-assigned managed identity, and
served to the browser only by streaming through an authenticated,
owner-scoped API route. No blob URL and no SAS token is ever emitted to
a client.**

**Retention is implemented as a Blob Storage lifecycle-management rule
that deletes blobs 30 days after their creation.** The application never
writes to the database as part of the purge.

Layout:

```
container: screenshots           (private, no anonymous access)
blob path: {ownerId}/{batchId}/{imageId}.{png|jpg}
```

> **R5 (ADR-0008) — the stored artefact is now potentially a *derived*
> PNG.** A HEIC/HEIF upload is transcoded to **lossless PNG on ingest,
> before this blob is written**, so its stored blob is a `.png` even though
> the device sent `.heic`. `uploadedImage.format` records the stored format
> (`png`); `uploadedImage.uploadedFormat` records what the device sent
> (`heic`). The **original HEIC is discarded after a verified transcode**
> (the spec default); whether to *also* retain it is **OQ-027**, open. This
> ADR is written to be consistent with the discard default — everything
> below (the 30-day purge, `retainUntil`, re-extraction) operates on the
> **stored derived PNG**, which is the only artefact that exists.

Configuration: `allowBlobPublicAccess = false`,
`allowSharedKeyAccess = false`, `minimumTlsVersion = TLS1_2`,
HTTPS-only, service-managed encryption at rest, LRS redundancy (a single
region is sufficient — `OQ-014` sets no availability requirement, and
these bytes are reproducible by re-capture).

### The retention design, and why it writes nothing

| Concern | Mechanism |
|---|---|
| Bytes are deleted at 30 days (NFR-019) | Blob lifecycle-management rule, `delete` action at 30 days after creation, scoped to the `screenshots` container by prefix. Runs in the storage service; costs nothing; touches only blobs. |
| The application knows an image is gone | `uploadedImage.retainUntil` is computed and written **once, at upload**. Availability is **derived** — `now < retainUntil` — never stored as mutable state. |
| No list record is affected (NFR-019, second half) | The rule's scope is the `screenshots` container. `Title`, `ServiceListing`, `UploadBatch` and `ExtractionCandidate` live in **the Azure SQL database** (the relational store, ADR-0005 Rev 3) and are untouched by any expiry mechanism (no TTL, no scheduled job, no Azure SQL Agent / Elastic Job — REQ-028). |
| REQ-041 is not widened | **No process anywhere in nextup writes to the database on a timer.** The permitted purge is a storage-service rule over image bytes only. |

Because lifecycle rules evaluate roughly once a day, actual deletion
occurs at 30–31 days. The *application-visible* boundary is exactly 30
days, because availability is derived from `retainUntil`. **The
application must therefore treat a missing blob and an expired
`retainUntil` as the same, expected, non-error condition** — a purged
image is "no longer available for re-extraction", never a 500.

## Consequences

### Positive
- **NFR-020 cannot be violated by accident**, because no URL that works
  without a session is ever created. The requirement's named
  silent-failure mode is eliminated rather than mitigated.
- One authorisation path shared with every other owner-scoped read
  (NFR-008), so one test covers it (US-002 AC-2, US-004 AC-3).
- No storage key, no SAS signing key, no connection string exists in
  configuration — nothing to leak or rotate.
- The 30-day purge is declarative infrastructure in Bicep, reviewable in
  a diff, and impossible to accidentally point at list data.
- Cost is effectively zero and stays zero: storage is bounded by the
  retention window, so it does not grow over time.
- `REQ-074` re-extraction works unchanged, because our compute reads
  blobs by managed identity, not by URL. **R5: re-extraction reads the
  retained *derived PNG* — the same artefact both readers accept — so no
  re-transcode is needed within the window (ADR-0008). If OQ-027 is later
  resolved to discard-only, this remains correct; if it resolves to retain
  the original HEIC, re-extraction still targets the PNG.**

### Negative
- **Image bytes flow through the application container**, consuming a
  little CPU and bandwidth and coupling image delivery to container
  availability and cold start (ADR-0003). At a few hundred kilobytes a
  few times a month this is immaterial, but it would not scale to a
  media-heavy product.
- **The 30-day boundary is 30–31 days in practice.** Lifecycle
  evaluation is not instantaneous. Stated here so it is not discovered
  as a test failure; the assertion in `specs/testing.md` must be
  "unavailable to the application at 30 days", not "the blob no longer
  exists at exactly T+30d".
- **Two sources of truth about existence** — the blob and the
  `retainUntil` field — which can disagree if a blob is deleted early or
  the rule is misconfigured. Mitigated by treating a missing blob as
  equivalent to expiry, never as an error.
- **Disabling shared-key access breaks tools that expect it**, including
  some local development flows. Local development uses Azurite with a
  development credential; the managed-identity path is exercised only in
  the deployed environment, so this is one of the few behaviours a
  single-environment deployment (ADR-0003) cannot fully rehearse before
  production. A post-deploy smoke test that uploads and re-reads one
  image is therefore required.
- Screenshots are still sent to Azure AI Vision for extraction
  (ADR-0001), so "the bytes never leave our control" is **not** true —
  only "the bytes are never publicly reachable" is. Disclosed rather
  than glossed.

### Neutral / follow-on work required
- Upload validation (REQ-007 / **ASM-058, supersedes falsified ASM-034**):
  accept **PNG, JPEG and HEIC/HEIF**, validated by **magic-byte sniffing**
  (including the HEIF `ftyp` brand set), not by file extension or by the
  client-supplied content type. **HEIC/HEIF is transcoded to lossless PNG
  on ingest before the blob is written (ADR-0008), so the *stored* blob is
  always PNG or JPEG.** Reject anything else at attach time, naming the
  accepted formats (PRD §7.5).
- A per-batch image-count and per-image size ceiling must be set in
  `specs/api.md` — not to save money, but because an unbounded upload is
  the only way a single user can accidentally exhaust a free tier.
- Response headers on the image route: `Cache-Control: private, no-store`
  and `X-Content-Type-Options: nosniff`.
- `specs/security.md` owes the data-classification table; screenshots
  are the most sensitive class nextup holds.

## Reversal

| | |
|---|---|
| **Is this a one-way door?** | **No.** |
| **Cost to reverse** | Hours. Switching to SAS delivery is a change to one route; switching storage backends is a blob copy. No data model changes. |
| **Trigger to revisit** | (a) image delivery through the container becomes a measurable cost or latency problem (it will not, at this volume); (b) NFR-019's window changes; (c) a future multi-owner scenario makes CDN delivery attractive — at which point NFR-020 must be re-argued, not assumed away. |

## Compliance and security implications

- **NFR-011** — enforced by an `ownerId` equality check on the
  `uploadedImage` document before a single byte is streamed.
- **NFR-020** — enforced by the absence of any anonymously-usable URL.
  A dedicated test must assert that no API response body or header ever
  contains a `*.blob.core.windows.net` URL (US-004 AC-3, US-035 AC-4).
- **NFR-019** — enforced by a lifecycle rule scoped to one container,
  with an explicit assertion that **no relational-store table (Azure SQL,
  ADR-0005 Rev 3) has a TTL or scheduled-deletion mechanism** configured
  (REQ-028). *(R1-historical: this line named "no Cosmos container has a
  TTL"; the store is now Azure SQL, and the no-expiry guarantee for list
  records stands unchanged.)*
- **RSK-014** — incidental personal data in screenshots is bounded to a
  30-day window and is never publicly reachable. It is disclosed above
  that these bytes are transmitted to Azure AI Vision during extraction.
- Storage account: HTTPS-only, TLS 1.2 minimum, public network access
  restricted where the platform allows, service-managed encryption at
  rest, no shared-key access, no anonymous container access.

## References

- `Context/requirements.md` — NFR-011, NFR-019, NFR-020, REQ-007,
  REQ-041, REQ-074; §1.8
- `Context/open-questions.md` — OQ-009 (closed at A35)
- `artifacts/PRD.md` §7.5, US-004, US-034, US-035
- ADR-0001 (extraction), ADR-0003 (hosting), ADR-0005 (datastore),
  **ADR-0008 (HEIC transcode — the stored blob is a derived PNG; EXIF/GPS
  stripped on ingest)**
- `Context/open-questions.md` — **OQ-027 (retain the original HEIC?
  default: discard after verified transcode)**

---

## ⚠ A41 / CC-002 re-examination — 2026-08-10T21:45 — **DECISION STANDS, with one prohibition made explicit**

Re-read after `NFR-012` was relaxed system-wide. This ADR was decided on
`NFR-011`/`NFR-019`/`NFR-020` — no URL that works without a session,
purge by a storage-layer lifecycle rule so that **no process writes to
the database on a timer** (`REQ-041`). **Price was never an argument**;
Blob Storage costs about two cents a month and the rejected alternatives
(user-delegation SAS, base64 in the datastore) were rejected on
security and modelling grounds.

Two things re-checked now that spending is permitted:

1. **Blob soft delete / versioning / point-in-time restore: DELIBERATELY
   NOT ENABLED, and this is now a stated prohibition rather than an
   omission.** They cost pennies, and that is exactly the trap: enabling
   any of them would **silently retain screenshot bytes past 30 days**
   and break `NFR-019`, which is a user-stated privacy requirement
   (`A35`, `RSK-014`). An implementer who "hardens" the storage account
   with soft delete has introduced a privacy defect that every test
   still passes. `T-INFRA-002` is extended to assert
   `deleteRetentionPolicy.enabled = false`, `isVersioningEnabled = false`
   and `restorePolicy.enabled = false` on the screenshots account.
   **The general "enable backups everywhere" instinct is wrong here.**
2. **A second blob container for staging** (ADR-0003 R2.4), on the same
   account, with the same lifecycle rule and the same disabled-public,
   disabled-shared-key posture. Staging holds synthetic fixtures only;
   the owner's real screenshots never leave production.

`NFR-019`'s 30-day constant and `NFR-014`'s 183-day TMDB ceiling remain
two separate constants that MUST NOT be unified. *(The former third
constant, `REQ-040`'s 30-day list-staleness threshold, is retired — `A46`
dropped the list-staleness nudge concept entirely from v1.)*
