---
createdAt: 2026-08-10T20:12:02-04:00
createdBy: spec-writer
phase: 8
status: complete
sourceOfTruth: artifacts/architecture.md, artifacts/adr/ADR-0002, ADR-0003, ADR-0006
---

# specs/security.md — nextup

> ⚠ **REVISION 4 — Azure SQL + ghcr.io (A40, Variant A).** ADR-0003 Rev 3 /
> ADR-0005 Rev 3 moved the registry to **ghcr.io** and the store to **Azure
> SQL Database Basic**. This **reverses two R3 improvements** and one reader
> must see honestly:
>
> - **The system now holds 2–3 secrets, not one.** The **ghcr.io PAT
>   returns** (§7) — a credential that **expires quietly** and will break a
>   future deployment if not rotated. This is a real regression from the
>   ACR-managed-identity pull, accepted for the ~$5/mo saving.
> - **The database credential can still be secretless.** Azure SQL
>   **supports Entra / managed-identity auth**, so the *preferred* path
>   keeps the DB password out of the system entirely. But the Prisma
>   `sqlserver` MI path is less-established (`RSK-031`), so there is a
>   **defined fallback**: a least-privilege SQL login whose password lives
>   in Key Vault and is surfaced as a Key-Vault-referenced Container Apps
>   secret. **A SQL password does not auto-expire** — unlike the PAT, it is
>   not a silent time bomb. `M0` (`TASK-141`) decides MI-vs-fallback.
> - **§4 C2/C5 store name** is now **Azure SQL Database**; **§9 backup**
>   becomes **7-day** PITR (Azure SQL Basic max, down from 35-day); the
>   dependency allow-list keeps `@prisma/client` (provider `sqlserver`).
> - **The RBAC table loses `AcrPull`** (no ACR) and gains the ghcr.io PAT
>   as a Container Apps registry secret.
>
> Everything else in the R3 banner and body stands. The staging environment
> (§10) persists, now as a separate serverless Azure SQL database.

> ⚠ **REVISION 3 — 2026-08-10T21:45.** Constraint change **A41/CC-002**
> relaxed `NFR-012`; ADR-0003 Rev 2 and ADR-0005 Rev 2 re-decided hosting
> and the datastore. **The security posture is unchanged and, in two
> places, improved.** Specifically:
>
> - **The system now holds ONE secret, not two** (§7). The `ghcr.io` pull
>   credential is deleted: the image lives in Azure Container Registry and
>   is pulled with the app's managed identity. That removes a credential
>   *and* a quiet-expiry failure mode.
> - **The database has no password and no connection string.** The app
>   authenticates to PostgreSQL with an **Entra token** from its managed
>   identity; password authentication is disabled on the server.
> - **§3's enforcement point changes** from a partition key to an
>   `owner_id` column filter — a real weakening, stated plainly below, and
>   compensated by promoting two tests to load-bearing.
> - **§4 C2/C5 store name** is PostgreSQL; **§9 backup** becomes 35-day
>   point-in-time restore; the dependency allow-list swaps `@azure/cosmos`
>   for `@prisma/client`.
> - **A staging environment now exists** and gets its own paragraph (§10).

**Serves:** US-001, US-002, US-011, US-035, US-036, US-037, US-038, US-039.
**Requirements:** NFR-005, NFR-008, NFR-009, NFR-011, NFR-013, NFR-015,
NFR-016, NFR-017, NFR-019, NFR-020, REQ-001.

---

## 1. Posture in one paragraph

nextup holds one person's private list of things they want to watch, plus
screenshots of their streaming saved-lists for up to 30 days. It holds **no
streaming credentials of any kind** (NFR-009), no payment data, no third-party
personal data, and no telemetry (NFR-005). Its authentication is delegated
entirely to Microsoft Entra ID through Azure Container Apps built-in
authentication, so **the application contains zero authentication code**
(ADR-0002). The realistic threat is not a targeted attacker; it is **an
accidental exposure through a misconfiguration that nobody notices** — a public
blob container, an allow-list that stopped being enforced, a secret in a log.
Every control below is therefore paired with an automated test, because on this
project a control nobody tests is a control nobody has.

---

## 2. Authentication (US-001, REQ-001)

| | |
|---|---|
| Mechanism | Azure Container Apps **built-in authentication (Easy Auth)**, `unauthenticatedClientAction: RedirectToLoginPage` |
| Identity provider | Microsoft Entra ID (`azureActiveDirectory`) |
| Token handling | **Entirely outside the application.** The platform validates the token and injects the principal header. |
| Application auth code | **Zero.** No OIDC client, no JWT library, no session store, no password path, no cookie signing. `T-SEC-011` asserts no `jsonwebtoken`, `passport`, `openid-client`, `next-auth` or equivalent appears in any `package.json`. |
| Session lifetime | Platform default: refresh-token-backed, ~8-hour access token with silent refresh; the owner is re-prompted per Entra tenant policy. **nextup does not configure, extend or shorten it** — there is no session state to extend. Expiry surfaces as a 401, handled by `specs/ux-states.md` §10.4 with in-progress review state preserved. |
| Sign-out | `/.auth/logout` — a platform URL, linked from the header. |
| Deep links | Easy Auth's `post_login_redirect_uri` preserves the requested path (US-001 AC-2). `T-AUTH-002`. |
| HTTPS | Enforced by the Container Apps ingress (`allowInsecure: false`) with a managed certificate. HTTP is redirected. `T-SEC-012` asserts the Bicep sets `allowInsecure: false`. |

### 2.1 The principal adapter — the one contract

`apps/api/src/auth/principal.ts` is the **only** file that reads the platform
header. Everything else consumes its output.

```ts
export interface Principal {
  issuer: string;    // e.g. 'https://sts.windows.net/<tenant>/'
  subject: string;   // the stable Entra object id (oid) claim — the identity key
  email: string | null;  // preferred_username or upn; DISPLAY ONLY, never an authorisation input
}

/** Parses the X-MS-CLIENT-PRINCIPAL header. Returns null when absent or malformed. */
export function readPrincipal(headers: IncomingHttpHeaders): Principal | null;
```

- Input: `X-MS-CLIENT-PRINCIPAL` — base64 JSON with a `claims[]` array.
- `subject` is the **`http://schemas.microsoft.com/identity/claims/objectidentifier`**
  claim, falling back to `sub`. **Never the email.** An email can be reassigned
  inside a tenant; an object id cannot.
- A missing, malformed or non-base64 header → `null` → **401
  `UNAUTHENTICATED`**. Never a partial principal, never a default identity.
- `readPrincipal` has a table-driven test over: absent header, empty header,
  invalid base64, valid base64 invalid JSON, JSON without claims, claims
  without oid, claims with oid only, full claims (`T-SEC-013`).

**Header spoofing.** The header is injected by the Container Apps ingress,
which strips any client-supplied copy. That is a platform guarantee, not an
application one — so the post-deploy smoke test (§10) sends a request with a
forged `X-MS-CLIENT-PRINCIPAL` and asserts it does **not** authenticate
(`T-SMOKE-003`). Locally, the dev shim (§2.3) makes forging trivially possible,
which is exactly why §2.3 exists.

### 2.2 The allow-list — the silent-failure point

`apps/api/src/middleware/allowList.ts`:

```ts
const allowed = new Set(
  (process.env.NEXTUP_ALLOWED_SUBJECTS ?? '').split(',').map(s => s.trim()).filter(Boolean)
);
```

| Rule | Behaviour |
|---|---|
| Empty or unset `NEXTUP_ALLOWED_SUBJECTS` | **Deny everyone.** Fail closed. Log one warning at start-up: *"NEXTUP_ALLOWED_SUBJECTS is empty — every request will be refused."* Never fail open. `T-SEC-014`. |
| Subject not in the set | **403 `NOT_ALLOWED`**, logged once with the rejected `subject` so the owner can copy it into configuration |
| Values are **subject ids**, never emails | An email is not an authorisation input anywhere in the codebase. `T-SEC-015` greps for `email` in `allowList.ts` and `ownerScope.ts` and fails on a match |
| Bootstrap mode | `NEXTUP_BOOTSTRAP_ALLOW_FIRST=true` (**default false**, never set in production) logs the first rejected subject id at `warn` **and still refuses the request**. It grants nothing. `T-SEC-016` asserts a request under bootstrap mode still receives 403 |

> **US-001 AC-4 is, per the architecture handover, the highest-value test in
> the product.** A signed-in Entra user outside the allow-list must receive a
> refusal and **must not** receive any list data. Its failure mode is silent:
> the app looks perfectly healthy while serving one person's watchlist to
> another tenant member. Tested three ways — `T-SEC-010` (unit: middleware
> refuses), `T-SEC-017` (integration: every one of the routes in
> `specs/api.md` §4 returns 403 for a non-allow-listed principal, enumerated
> from the router so a new route cannot be forgotten), and `T-SEC-018`
> (Playwright: the browser renders the refusal page and the network log
> contains no successful `/api/titles` response).

### 2.3 The development shim — excluded by the directory boundary

`apps/api/dev/devPrincipal.ts` synthesises a principal from
`NEXTUP_DEV_SUBJECT` for local development. ⚠ **It lives in `apps/api/dev/`,
NOT under `src/`** — that location *is* the control, and moving it is the one
change that breaks this section.

| Control | Mechanism |
|---|---|
| Compile-time exclusion | `apps/api/tsconfig.json` has `include: ["src/**/*.ts"]`. The shim is outside that root, so the production compiler **cannot** emit it — there is nothing to remember to exclude. `apps/api/tsconfig.dev.json` typechecks and runs `dev/`, emitting to a separate `dist-dev`. **Not a runtime flag, and not an exclude list.** |
| No reference from production code | `createApp({ readPrincipal })` takes the reader as an injected parameter and defaults to the real Easy Auth reader, so no file under `src/` ever names the shim. `T-SEC-019c` asserts this. |
| Test | `T-SEC-019d` **deletes `apps/api/dist`, runs `tsc --build --force`**, and asserts the strings `devPrincipal`, `NEXTUP_DEV_SUBJECT` and `readDevPrincipal` appear **nowhere** in the output. ⚠ Both the delete and `--force` are load-bearing: `tsc --build` is incremental and this test was observed to PASS against a stale `dist` while a shim sat in `src`. This test blocks the merge. |
| Belt and braces | Even if present, `readDevPrincipal` returns `null` when `NODE_ENV === 'production'` (`T-SEC-019e`) and when `NEXTUP_DEV_SUBJECT` is unset (`T-SEC-019f`). |
| Not a bypass | The shim produces a *principal*; it does **not** skip the allow-list. A dev server that skipped it would leave the refusal path as the one configuration nobody ever exercises. |

> **Superseded (R4).** The original mechanism below was written against a build
> this repo does not have: `apps/api` compiles with plain `tsc --build`, there
> is no `tsconfig.build.json` and no esbuild step, and `import.meta.env` is a
> Vite construct that is `undefined` in Node — so the guard would have been
> dead code that always took the dev branch. It is retained struck through for
> history only. **Do not implement it.**
>
> | ~~Control~~ | ~~Mechanism~~ |
> |---|---|
> | ~~Compile-time exclusion~~ | ~~The import is guarded by `if (import.meta.env?.MODE !== 'production')` **and** the file is excluded from the production build by `tsconfig.build.json`'s `exclude` and by an esbuild `external` rule. **Not a runtime flag.**~~ |
> | ~~Test~~ | ~~`T-SEC-019` builds the production bundle in CI and asserts the strings `devPrincipal`, `NEXTUP_DEV_SUBJECT` and `readDevPrincipal` appear **nowhere** in `apps/api/dist/**`. This test blocks the merge.~~ |
> | ~~Belt and braces~~ | ~~Even if present, `devPrincipal` returns `null` when `NODE_ENV === 'production'`.~~ |

### 2.4 Owner mapping

`ownerId = 'o_' + sha256(principal.issuer + '|' + principal.subject).slice(0, 16)`

- Derived, deterministic, stable, and **not** the raw Entra object id — so the
  `owner_id` is not a directory identifier and logs carrying an
  `ownerId` do not leak one.
- Implemented once, in `apps/api/src/auth/ownerId.ts`. `T-SEC-020` asserts the
  same principal always maps to the same `ownerId` and two principals never
  collide across a 10,000-case fixture.
- **NFR-001**: because every row carries `owner_id` from day one *(R3 — was "partitioned on `ownerId`")*,
  adding <20 accounts later is a configuration change (extend
  `NEXTUP_ALLOWED_SUBJECTS`), not a rewrite.

---

## 3. Authorisation

v1 has exactly **one role: `owner`**, and a principal either is the owner of a
partition or has no access at all. There is no admin, no sharing, no
delegation, no read-only mode.

| Resource | Operation | `owner` (own partition) | Any other authenticated principal | Unauthenticated |
|---|---|---|---|---|
| Title | read / create / suppress / fix-match | ✅ | ❌ **404** | ❌ 401 |
| ServiceListing | read / restore | ✅ | ❌ 404 | ❌ 401 |
| Suppression | read / create / un-suppress | ✅ | ❌ 404 | ❌ 401 |
| UploadBatch | create / read / submit / close / discard / re-extract / undo | ✅ | ❌ 404 | ❌ 401 |
| UploadedImage (metadata) | read / delete-while-draft | ✅ | ❌ 404 | ❌ 401 |
| UploadedImage (**bytes**) | read | ✅ (within retention) | ❌ 404 | ❌ 401 |
| RemovalGroup | undo | ✅ | ❌ 404 | ❌ 401 |
| ServiceState | read | ✅ | ❌ 404 | ❌ 401 |
| TMDB search proxy | read | ✅ | ❌ 403 (allow-list) | ❌ 401 |

**Cross-owner access returns 404, not 403** — an id belonging to someone else
must be indistinguishable from an id that does not exist (NFR-008).
`T-SEC-002` seeds two owners and asserts every id-bearing route returns 404
for the other owner's ids, enumerated from the router.

**The enforcement point is a repository signature plus a test — and
that is weaker than Revision 1, deliberately and knowingly (R3).**

Revision 1 could write: "`ownerId` is the Cosmos partition key, so a
cross-partition read is not merely refused — it is not expressed."
That was a genuinely strong property, and the datastore change
(ADR-0005 Rev 2) gives it up. On PostgreSQL, `owner_id` is a column: a
handler that forgets its `WHERE` clause returns another owner's rows
**at full speed and with no error**.

This was weighed and accepted, because the same change makes the
invariants that actually corrupt this data into database constraints, and
because `NFR-017` means there is exactly one owner today and `NFR-001`
caps the future at under 20 known family-and-friends identities. But it
must not be papered over. The compensating controls, all mandatory:

1. **`ownerId` is the first positional parameter of every repository
   function.** There is no repository function without it — omitting it
   is a **compile error**, which is the strongest remaining structural
   defence (`specs/api.md` §1.1).
2. **`ownerId` is never accepted from a request.** `T-SEC-006` greps
   every Zod request schema and fails on a match. Unchanged.
3. **`T-SEC-021` is rewritten**: it greps `apps/api/src/repository/**` for
   any Prisma call whose `where` clause omits `ownerId`, and fails on a
   match. It replaces the Rev 1 assertion that every
   `container.items.query` passed a `partitionKey`.
4. **These two tests are load-bearing, not belt-and-braces.** A change
   that weakens, skips or deletes either is a blocking review finding.

**Row-level security was considered and rejected** (`specs/data-model.md`
§15.9): it would restore a store-level guarantee, but via per-request
session variables that interact badly with a pooled Prisma client — a
second, subtler enforcement path for an autonomous implementer to keep
correct, which is its own risk (`RSK-016`). It is recorded as the leading
candidate should `NFR-001`'s multi-owner path ever actually be taken.

---

## 4. Data classification

| Class | Data | Storage | Transit | Retention | Rules |
|---|---|---|---|---|---|
| **C1 — Personal, sensitive-ish** | Uploaded screenshots (may show a profile name, a partial viewing history) | Azure Blob, private container, encryption at rest (Microsoft-managed keys) | HTTPS only; streamed through the authenticated API | **30 days**, auto-purged (NFR-019) | Never public, never SAS, never logged, never sent anywhere but the **two extraction endpoints** (Azure OpenAI, Azure AI Vision) — see **§4.1** |
| **C2 — Personal, low sensitivity** | The watchlist: titles, listings, dates, removal and suppression history | **Azure SQL Database Basic** *(R4 — was PostgreSQL Flexible Server in R3)*, encryption at rest (TDE), TLS in transit (`Encrypt=true`) | HTTPS only | **Forever** (REQ-028) | Owner-scoped; never exported; no analytics |
| **C3 — Identity** | Entra `subject`, `email`, derived `ownerId` | `subject` in configuration (allow-list); `ownerId` in every document; `email` **not persisted at all** | HTTPS | Configuration lifetime | `email` is display-only and lives only in memory per request. Logs carry only `sha256(ownerId).slice(0,12)` |
| **C4 — Secrets** | TMDB API key **+ the ghcr.io pull PAT** *(R4 — the PAT returns; the database credential is secretless if MI works, else a Key-Vault SQL password — see §7)* | Container Apps secret / Key Vault reference | Never leaves the platform | Rotate on suspicion; **the ghcr.io PAT has a real expiry** | §7 |
| **C5 — Public / third-party** | TMDB metadata, poster paths | **Azure SQL Database Basic** *(R4 — was PostgreSQL Flexible Server in R3)* | HTTPS | Refreshed at 183 days (NFR-014) | Attribution mandatory (§6); **never sent to any AI service** (`specs/ai.md` Rule A) |

### 4.1 Third-party processing of C1 screenshots (revised — ADR-0001 Revision 2)

⚠ **This section is new and it records a genuine privacy regression.** Under
ADR-0001 Revision 1 the only extractor was Azure AI Vision `Read` OCR, which
does not retain request images. Revision 2 makes **Azure OpenAI `gpt-4.1`
vision** the primary reader, and Azure OpenAI's **abuse monitoring retains
prompts — here, the owner's screenshots — for up to 30 days**, accessible to
authorised Microsoft personnel in a suspected-abuse investigation, **unless the
Limited Access modified-abuse-monitoring exemption is granted**.

| Destination | What it receives | Trains on it? | Retention | Notes |
|---|---|---|---|---|
| Azure OpenAI (`gpt-4.1`) | The screenshot image, base64, one call per image | **No** — Azure OpenAI does not train foundation models on customer data | **Up to 30 days** for abuse monitoring unless exempted | **TASK-134** applies for the exemption **before the first real upload** |
| Azure AI Vision (`Read`, F0) | The same screenshot, cross-check leg | **No** | Not retained | Unchanged from Revision 1 |
| TMDB | **Title strings only. Never an image, never model output framed as such.** | n/a | n/a | Rule A / RSK-022 |

**Rules that follow, all binding:**

1. **`TASK-134` is a prerequisite to the first real upload**, not a nicety. If
   the exemption is refused or still pending, the owner must be told before
   uploading personal screenshots — this is a disclosure obligation, not a
   blocker on shipping.
2. **`/about` must state both destinations by name** and must state the
   retention position plainly. `T-AI-009` is extended to assert the page names
   Azure OpenAI as well as Azure AI Vision. A page that still claims a single
   OCR destination is **wrong and is a compliance defect**.
3. This interacts with **RSK-014** — screenshots may show a profile name or
   email — so the mitigation there (crop guidance in the upload UI) becomes
   *more* valuable, not less.
4. **RSK-022 clarified (ADR-0001 §R2.4):** the TMDB restriction binds **TMDB
   content**, not the owner's own screenshot pixels. Sending a screenshot to a
   vision model is **not** sending TMDB content and is **not** prohibited.
   Rule A is unchanged and still absolute in the direction that matters: no
   TMDB-derived string, poster or identifier ever enters an inference request.

### 4.2 Metadata stripping, the HEIC transcode, and the two ingest routes (A42; **A45**)

iPhone camera photos arrive as **HEIC/HEIF**, which are accepted at upload
(`api.md` §5) and **transcoded to lossless PNG on ingest** (`api.md` §5.1 —
**conditional on the sniffed format since A45, and NOT removed**).
HEIC/HEIF files carry **EXIF metadata including GPS coordinates and device
model** — the same as a JPEG from the camera. Given the no-telemetry posture,
**RSK-014**, and the 30-day retention (NFR-019), metadata stripping is a
**required, explicit, tested ingest step** (**REQ-078**), applied to **every**
accepted image on **every** ingest route (paste, upload and drop; HEIC, PNG
and JPEG alike) — not left to incidental behaviour of the transcode **and not
left to the browser**:

> ⚠ **(A45) THE TWO INGEST ROUTES HAVE DIFFERENT METADATA BEHAVIOUR. THIS IS
> THE TRAP.**
>
> - **Clipboard paste:** WebKit strips EXIF on clipboard read — *"Image data
>   read from the clipboard is stripped of EXIF data, which may contain
>   details such as location information and names"*
>   (`Context/evidence/clipboard-paste-support.md` Q1d fact 5, `verified`).
>   A pasted screenshot therefore typically carries **no EXIF**. **A real
>   privacy win of the owner's preferred path.**
> - **File upload:** WebKit does **NOT** strip EXIF. A photo selected from
>   iOS Photos arrives with **GPS and device model intact**.
>
> **Therefore REQ-078's explicit, tested strip STAYS on the upload path.** It
> is the only thing removing GPS from an uploaded camera-roll photo. **The
> paste path's free stripping MUST NOT be read as global coverage** — it
> covers one of two routes, on one engine, and says nothing about Chrome,
> Edge or Firefox clipboards. A change that removes the strip step because
> "pasted screenshots have no EXIF anyway" deletes the control for the route
> that actually needs it. `api.md` §5.1a.

| Control | Rule |
|---|---|
| Strip EXIF/XMP/GPS/device model | On ingest, before the blob is written, the stored raster carries **no** EXIF/XMP. Applied **unconditionally to every accepted image from every ingest source** — it is **outside** the `needsTranscode` condition (`api.md` §5.1). `heic-convert` decodes to raw RGBA (dropping EXIF incidentally) and `sharp` strips metadata by default — but the guarantee is **asserted**, not assumed: `T-SEC-032` decodes the stored blob and fails if any EXIF/GPS tag is present, **for a pasted PNG and an uploaded HEIC and an uploaded JPEG** |
| **(A45) The upload path is tested for the case paste can never exercise** | `T-SEC-033`: a **HEIC file upload carrying GPS EXIF** lands stripped. This is the assertion that would still fail if someone made the strip conditional on ingest source |
| Lossless only | Transcode output is **PNG**, never a lossy JPEG re-encode (NFR-012a) |
| Serial, memory-bounded | Transcode runs inside the existing **serial** per-image path; no added concurrency (RSK-016 OOM on 0.5 GiB). Pasted images enter the same serial path |
| Original HEIC | The stored blob is the **derived PNG**; retaining the original HEIC is **OQ-027** (default: discard after a verified transcode) |
| No metadata reaches a client | The served bytes are the stripped PNG/JPEG; `blobPath` and any storage URL remain unemitted (`T-SEC-003`) |
| **(A45) Filename is never a path component, for any source** | A pasted image's name is **server-synthesised** (`data-model.md` §3.8.1) and a dropped/uploaded name is a display string only; `blobPath` is composed from server-generated ULIDs alone. Paste adds no new path-traversal surface — it removes one, since the client supplies no name at all (`T-SEC-022`) |
| **(A45) HTTPS is mandatory for the clipboard API** | `navigator.clipboard` is **absent on `http://`** (evidence Q1e caveat 6). Production is HTTPS-only via Container Apps ingress. **A local dev server reached from the phone over a LAN IP is plain HTTP and will not offer the button** — a development hazard, called out rather than discovered, and **never a reason to relax the origin requirement** |

---

## 5. Threat model (STRIDE) — threats to mechanisms

| # | STRIDE | Threat | Mechanism | Test |
|---|---|---|---|---|
| T1 | **S**poofing | Someone forges `X-MS-CLIENT-PRINCIPAL` directly against the container | Ingress strips client copies; app only trusts the platform-injected header | `T-SMOKE-003` |
| T2 | Spoofing | A dev shim reaches production and lets anyone assert an identity | Compile-time exclusion (§2.3) | `T-SEC-019` |
| T3 | **T**ampering | A client sends `ownerId` in a body to read another partition | `ownerId` is never accepted from input; no schema contains it | `T-SEC-006` |
| T4 | Tampering | A malicious upload exploits the image path (polyglot file, path traversal in the filename) | Format by **magic bytes** (`specs/api.md` §5); blob path is composed from server-generated ULIDs only, the client filename is stored as a display string and never used in a path. **(A45) This applies identically to pasted and dropped bytes** — a clipboard `Blob.type` is client-supplied and untrusted exactly like a multipart `Content-Type`; the sniff decides (`api.md` §5) | `T-IMG-006`, `T-SEC-022`, `T-PASTE-006` |
| **T4a** *(new, A45)* | Tampering / **I**nformation disclosure | A page-wide `paste` listener swallows or exfiltrates clipboard content the owner meant for a text field — or fires on a screen where no upload is intended | The listener is mounted **only** on `/upload` and the open-draft attach area, removed on unmount, **returns without `preventDefault()` when the event target is an `<input>`/`<textarea>` or when the clipboard holds no image**, and reads **only** image items. Clipboard text is never read, never stored, never sent (`api.md` §5.3.3, `ui.md` §3.2b) | `T-PASTE-001` |
| **T4b** *(new, A45)* | Information disclosure | An uploaded camera-roll photo's **GPS EXIF** survives ingest because someone assumed the clipboard's free stripping covered everything | The strip step is **unconditional and outside** the transcode condition; §4.2's trap note; and the upload-specific assertion | `T-SEC-032`, `T-SEC-033` |
| T5 | **R**epudiation | A change appears with no record of what caused it | `provenance` written with every batch mutation; a change without provenance is not persisted (US-031 AC-6) | `T-PROV-001` |
| T6 | **I**nformation disclosure | The blob container is public, or a SAS URL leaks | `allowBlobPublicAccess=false`, `allowSharedKeyAccess=false`, no SAS is ever generated; bytes only via `GET /api/images/:id` | `T-SEC-023`, `T-SEC-003` |
| T7 | Information disclosure | A blob URL or path appears in an API response | No response contains `blobPath`; asserted across the whole suite | `T-SEC-003` |
| T8 | Information disclosure | Another tenant member signs in and sees the owner's list | Allow-list, fail-closed (§2.2) | `T-SEC-010/017/018` |
| T9 | Information disclosure | Screenshot content or a secret lands in a log | Logging rules (§8) | `T-SEC-024` |
| T10 | Information disclosure | Personal screenshots are used to train a third-party model (NFR-017) | Neither Azure AI Vision nor Azure OpenAI trains foundation models on customer data. ⚠ Azure OpenAI **abuse monitoring retains prompts up to 30 days** unless the exemption (**TASK-134**) is granted — see **§4.1**. Both destinations recorded verbatim in `/about` | `T-AI-009`, `T-SEC-004` |
| T11 | **D**enial of service | A huge upload exhausts the container | Per-image, per-batch and per-request ceilings (`specs/api.md` §5), streamed to blob, never buffered whole | `T-SEC-025` |
| T12 | Denial of service | Extraction runs forever and burns the ACA free grant, **or burns metered inference spend** | 30 s per image (OCR) / 60 s per image (LLM), **15 min per batch**, concurrency 2, `max_tokens` 4096, retries on transient codes only, no scheduler anywhere, `minReplicas=0`, per-batch `estimatedCostUsd` logged | `T-AI-014` |
| T13 | **E**levation of privilege | The container's managed identity is over-permissioned | Least-privilege RBAC (§7); no `Contributor`, no subscription-scope role | `T-INFRA-001` |
| T14 | Elevation of privilege | A compromised dependency exfiltrates data | Supply-chain policy (§9) | `T-SEC-026` |
| T15 | Tampering (**self-inflicted, highest likelihood**) | A future change adds a TTL or a purge job and destroys history | data-model §9; two blocking tests | `T-INV-013`, `T-INV-012` |
| T16 | Tampering (self-inflicted) | A future change sends TMDB content to an AI service | `specs/ai.md` Rule A; lint rule plus a network-shaped test, now covering **both** inference hosts (Azure OpenAI and Azure AI Vision) | `T-AI-012`, `T-AI-013` |
| T17 | Tampering *(new — R2)* | A crafted screenshot carries text that the vision model treats as instructions (**prompt injection**) | Structural: the image is the **only** untrusted input in the request; Structured Outputs `strict: true` fixes the response shape so an injected instruction cannot change it; extracted text is **never interpreted, executed or used to build a further prompt** — it goes only to a deterministic string matcher | `T-AI-044` |
| T18 | Information disclosure *(new — R2)* | Screenshot bytes reach a fourth host after a well-meaning change | Outbound host allow-list pinned to **exactly three** hosts (Azure OpenAI, Azure AI Vision, TMDB) | `T-SEC-031` |

**T15 and T16 are the two most likely real incidents on this project**, because
the implementer is an autonomous agent and both changes look like
improvements. Both are guarded by tests that fail loudly.

---

## 6. TMDB compliance (NFR-016, US-011)

| Obligation | Mechanism | Test |
|---|---|---|
| Attribution logo + verbatim disclaimer on every surface rendering TMDB data | `TmdbAttribution` in the global footer (`specs/ui.md` §8) | `T-ATTR-001/002/003` |
| Do not present TMDB as an endorser | The verbatim sentence, unmodified | `T-ATTR-001` |
| API key not exposed | TMDB is called server-side only; the key is a Container Apps secret; the client uses `/api/tmdb/search` | `T-SEC-027` asserts no bundle under `apps/web/dist/**` contains `TMDB` key material or `api.themoviedb.org` |
| No AI processing of TMDB content | `specs/ai.md` Rule A | `T-AI-012/013` |
| Metadata not held stale past ~6 months | Lazy refresh at 183 days (`specs/api.md` §6.4) | `T-TMDB-004` |

**Compliance failure here is invisible from inside the app** — nothing breaks,
no error appears, and the owner would never notice. That is precisely why it is
tested rather than documented.

---

## 7. Secrets and platform identity

**1–2 secrets exist (R8 — the ghcr.io PAT is GONE again; was 2–3 in R4).**

| Secret | Storage | Consumer | Rotation |
|---|---|---|---|
| `TMDB_API_KEY` | Container Apps secret, referenced as a secret env var | `apps/api/src/matching/tmdbClient.ts` only | Manual; regenerate at TMDB, update the Container App, restart |
| ~~**`GHCR_PULL_TOKEN` (R4 — RETURNS)**~~ **DELETED at R8.** No registry credential exists. The ghcr.io **package is public**, so Container Apps pulls it anonymously and CI pushes with the built-in `GITHUB_TOKEN`. | — | — | **None — there is nothing to rotate.** |
| **DB credential (R4 — conditional)** | **Secretless if managed-identity auth works** (preferred). **Else** a least-privilege SQL login password stored in **Key Vault**, surfaced as a Key-Vault-referenced Container Apps secret. | `apps/api` Prisma `sqlserver` connection | MI: none. SQL-auth fallback: manual; **does not auto-expire** |

> ✅ **R8 — the quiet-expiry time bomb is defused, not mitigated.** The R4
> plan below specified a **fine-grained PAT**. That token **cannot
> authenticate to `ghcr.io` at all** — GitHub Packages supports **classic**
> PATs only and returns a 403 for fine-grained ones — so the "least-privilege
> form" it relied on does not exist. The only working token is a classic PAT
> whose `read:packages` scope is **account-wide**, readable across every
> private package on the account, with no way to narrow it.
>
> Storing an account-wide credential in Azure to keep private an image built
> entirely from an **already-public repository** is a worse trade than
> publishing the package. The package is therefore **public**, the credential
> is **deleted**, and the registry half of `RSK-031` is **removed rather than
> mitigated**. The compensating control is that `deploy.yml` **secret-scans
> the built image before pushing** (TASK-007), which catches the one case a
> private package would have contained: a secret hardcoded into source, where
> `.dockerignore`'s filename-based exclusions do not help. Full reasoning and
> the retained private-package fallback: `docs/ghcr-pat.md`.

> ⚠ ~~**The ghcr.io PAT is a quiet-expiry time bomb (R4, RSK-031-adjacent).**
> A GitHub PAT has an expiry date. When it lapses, a **future deployment
> fails to pull the image** for a reason unrelated to the change being
> deployed, months later, in a project with no operational budget and an
> autonomous implementer — the exact untraceable failure R3 had *removed*
> by using ACR + managed identity. It is accepted here only for the ~$5/mo
> saving of Variant A. **Mitigation:** create the PAT with the **longest
> permitted expiry**, record its expiry date in the deployment runbook, and
> add a calendar reminder; `T-INFRA-001` still asserts it is a Container
> Apps secret and never appears in the repo. A fine-grained PAT scoped to
> `read:packages` on this one package is the least-privilege form.~~
> **(Superseded by R8 above — the fine-grained PAT this relied on does not
> work with ghcr.io, and no credential is used at all.)**

**The database credential can still be secretless (R4).** Azure SQL
Database **supports Entra / managed-identity authentication**, so the
*preferred* configuration presents an Entra access token from the Container
App's managed identity and holds **no database password anywhere**. The
Prisma `sqlserver` connector's MI/token support is less-established than
PostgreSQL's (`RSK-031`), so this is **proven or rejected at `M0`**
(`TASK-141`): if MI works through Prisma, the connection string carries no
password; if not, the fallback is a Key-Vault-stored SQL login password —
which, unlike the ghcr.io PAT, **does not silently expire**. `T-SEC-028`
(reshaped) asserts whichever path is chosen: for MI, that the token-refresh
path exists (fast-forward an expiry); for SQL-auth, that the password is a
Key Vault reference and never a literal in Bicep or source.

**Everything else uses the Container App's system-assigned managed identity**
with least-privilege RBAC, declared in `infra/rbac.bicep`:

| Target | Role | Scope |
|---|---|---|
| **Azure SQL Database** *(R4 — replaces the PostgreSQL principal / Cosmos data-plane role)* | Entra database principal (contained user), granted `CONNECT` + DML on the application schema (`db_datareader`, `db_datawriter`, EXECUTE on the one delete proc). **Not `db_owner`.** Migrations run under a separate deploy principal. *If SQL-auth fallback is taken, the login has the same least-privilege grants.* | The `nextup` database (production app identity) / `nextup_staging` (staging app identity) |
| ~~**Azure Container Registry** `AcrPull`~~ | **DELETED (R4).** No ACR exists; the image is pulled from ghcr.io using the `GHCR_PULL_TOKEN` registry secret above. `T-INFRA-001` asserts **no ACR resource and no `AcrPull` role assignment** exist in the Bicep | — |
| Blob Storage | `Storage Blob Data Contributor` | The `screenshots` container **only**, not the account |
| Azure AI Vision | `Cognitive Services User` | The Vision resource |
| Azure OpenAI *(new — ADR-0001 R2)* | `Cognitive Services OpenAI User` | The Azure OpenAI resource. **Key-based auth is prohibited** — `T-INFRA-001` asserts no `AZURE_OPENAI_API_KEY` appears in any Bicep parameter, secret or env var |

`T-INFRA-001` parses the compiled Bicep and asserts: no role assignment at
subscription or resource-group scope, no `Owner`/`Contributor`/`User Access
Administrator`, and no connection string or account key in any parameter.

**No secret is ever in the repository.** `T-SEC-026` runs `gitleaks` over the
working tree and the diff; a finding blocks the merge. `.env` files are
git-ignored and `.env.example` contains only placeholder values.

---

## 8. Logging — what must NEVER be logged

**Prohibited, absolutely:**

- Image bytes, base64 image data, or any `image/*` payload
- Blob paths, blob URLs, SAS tokens, storage account keys
- `TMDB_API_KEY`, any Entra access token (the database password is one), any `Authorization` header, any cookie
- The raw `X-MS-CLIENT-PRINCIPAL` header or its decoded claims
- `principal.email`, `principal.subject`, or the raw `ownerId`
- **(R4)** Database connection details, SQL fragments, or driver diagnostics. Note specifically that an **Azure SQL `2627`/`2601` unique violation** carries the **index/constraint name and the duplicated key value** in its message, and a **`245`/`242` conversion error** carries the offending literal. Neither may be logged raw or returned (`specs/api.md` §2). *(R3 named the Postgres `23505`/`22P02` equivalents — superseded.)*
- Full `rawText` of an extracted candidate (a screenshot's content)

**Permitted:**

- `correlationId`, `method`, `path`, `status`, `durationMs`
- `sha256(ownerId).slice(0,12)`, `batchId`, `imageId`, `titleId`, `listingId`
- `workIdentity` (an opaque identifier; the `unmatched:` form is a truncated
  hash and is not reversible to text)
- `extractionStats` counters
- `rawText` **truncated to 40 characters, at `debug` level only, never at
  `info` or above, and disabled in production** (`LOG_LEVEL=info` by default)

`T-SEC-024` runs the full e2e journey with a log capture and asserts the
captured output contains none of: the fixture screenshot's base64 prefix, the
fixture TMDB key, the string `blob.core.windows.net`, the test principal's
email, the raw subject, or `X-MS-CLIENT-PRINCIPAL`.

**No telemetry, no analytics, no APM** (NFR-005). `T-SEC-009` asserts no
`applicationinsights`, `@microsoft/applicationinsights-*`, `posthog`,
`mixpanel`, `segment`, `sentry`, `datadog` or `newrelic` package appears in any
`package.json`, and no third-party script tag appears in `index.html`. This is
a **CI allow-list check**, not a review convention.

---

## 9. Dependencies and supply chain

| Control | Rule |
|---|---|
| Lockfile | `package-lock.json` committed; CI uses `npm ci`, never `npm install` |
| Vulnerability gate | `npm audit --audit-level=high` in CI. **High or critical blocks the merge.** Moderate and below are reported, not blocking |
| Dependabot | Enabled for npm and GitHub Actions, weekly, grouped; PRs run the full suite and are auto-mergeable only when green |
| Actions pinning | Every GitHub Action pinned to a full commit SHA, not a tag. `T-CI-006` |
| New dependency policy | Any new runtime dependency must be justified in the PR description against NFR-004 (mainstream, well-documented). The set is deliberately small: `express`, `zod`, **`@prisma/client` + `prisma`** *(R4 — provider `sqlserver`; still Prisma, see RSK-031 / ADR-0005 R3.4)*, `@azure/storage-blob`, `@azure/identity`, `@azure-rest/ai-vision-image-analysis`, `ulid`, `jaro-winkler`, `compression`, `multer`, **`heic-convert`** *(A42 — HEIC/HEIF decode → PNG on ingest; pure JS/WASM, no native build; see the licence row below)* and **`sharp`** *(A42 — resize / dimension-clamp / metadata-strip of the decoded raster; prebuilt binaries, no HEIC decode needed from it. **⚠ TASK-147, corrected against the installed tree: `sharp` is Apache-2.0, NOT MIT, and its `@img/sharp-libvips-*` binaries are LGPL-3.0-or-later — so `sharp` carries a notice obligation of exactly the same kind as `libheif-js`, and `T-LICENSE-001` enforces it. Its 25 platform binaries are OPTIONAL dependencies, which is why the runtime container stage must copy `node_modules/@img` from the build stage — see `T-INFRA-006`.**)*, plus the SPA's own **`react`, `react-dom`, `react-router-dom`** (ADR-0004) and **`@noble/hashes`** *(audited SHA-256 for canonical id derivation in `packages/domain`; deliberately not `node:crypto`, because the domain package is isomorphic and these ids are computed in the browser too)*. **This list is now a CI gate, not prose: `T-DEP-001` fails the build on any direct runtime dependency that is not on it** (`tools/check-deps.mjs`, `RUNTIME_DEPENDENCY_ALLOWLIST`). Adding a runtime dependency means editing this row first. **The Prisma `sqlserver` provider needs no extra npm package — it is built into `prisma`;** Microsoft's `mssql`/`tedious` driver is pulled in transitively by Prisma, not added directly |
| **LGPL-3.0 notice obligation (A42)** | `heic-convert` (ISC) → `heic-decode` (ISC) → **`libheif-js` (LGPL-3.0)**, the WASM codec, is **decode-only** (uses `libde265`; **no GPL `x265`, no patent-encumbered encoder**). LGPL-3.0 is weak copyleft: used as an **unmodified** dependency it does **not** relicense this MIT app, but its **licence notice must be retained** in `THIRD-PARTY`/`NOTICE`. `T-LICENSE-001` (defined in `testing.md` §9A) asserts `THIRD-PARTY-NOTICES.md` matches the installed **production** dependency tree byte for byte, that any weak-copyleft package is listed in it, and that a **strong**-copyleft (GPL/AGPL/SSPL) runtime dependency is refused outright — listing it in the notice file does **not** clear it. **The tree is read from `package-lock.json`, not via `npm sbom`:** Node 22 refuses to spawn `npm.cmd` without a shell (the CVE-2024-27980 fix), so an `npm` subprocess fails on Windows while passing on Linux CI — the gate would be unrunnable for the maintainer yet look green. The lockfile is the same source `npm sbom` reads; the release SBOM (row above) still records the licence. **The owner APPROVED this obligation at TASK-153**, recorded in `NOTICE` and `CHANGELOG.md`. Flagged for a human licence sign-off (this is analysis, not legal advice) |
| Telemetry allow-list check | §8 — `T-SEC-009` |
| Secret scanning | `gitleaks` in CI; GitHub secret scanning and push protection enabled on the repository |
| SBOM | `npm sbom --sbom-format cyclonedx` produced on release and attached to the GitHub release |
| Base image | `node:20-alpine` pinned by digest; rebuilt weekly by a scheduled workflow. **This is a CI schedule, not an application scheduler** — it changes no list state and satisfies REQ-041, which governs the running system |

---

## 10. Deployment and operations (RSK-025)

**There is no staging environment.** CI is the only gate (architecture
§Environments). The compensating controls are:

| Control | Detail |
|---|---|
| Immutable revisions | Every deploy creates a new Container Apps revision. Rollback is one command: `az containerapp ingress traffic set --revision-weight <previous>=100` |
| Post-deploy smoke test | `tests/smoke/` runs against the deployed revision **before** traffic is shifted to 100 %: (1) unauthenticated `/api/titles` returns 401 JSON (`T-SMOKE-001`); (2) an allow-listed principal reads the list (`T-SMOKE-002`); (3) a forged principal header is refused (`T-SMOKE-003`); (4) an image upload + authenticated read round trip succeeds and returns the mandated headers (`T-SMOKE-004`); (5) the TMDB disclaimer is present in the served HTML shell (`T-SMOKE-005`). Any failure aborts the traffic shift |
| Infrastructure assertions | `T-INFRA-001` (RBAC), `T-INFRA-002` (`allowBlobPublicAccess=false`, `allowSharedKeyAccess=false`, `minimumTlsVersion=TLS1_2`), `T-INFRA-003` (`allowInsecure=false`), `T-INV-013` (**R4:** no Azure SQL Agent job, no Elastic Job, no delete trigger, no scheduled job, no `TRUNCATE` in any migration, `DELETE` in exactly one module), **`T-MIG-001` (no destructive migration)**, `T-INFRA-004` (the lifecycle rule exists, targets only `screenshots`, and its action is `delete` at 30 days) |
| Backup | **(R4 — SHORTENED)** **Azure SQL Database Basic gives 7-day point-in-time restore** (the Basic maximum), locally redundant. This is **down from PostgreSQL's 35-day window** (R3) — the accepted cost of Variant A. Because `REQ-028` forbids any hard delete or TTL, the store is append-mostly and **effectively irreplaceable**, so a corruption or bad migration **not noticed within 7 days is unrecoverable from PITR**. **`OQ-025` RE-WIDENS** (it had been narrowing). Mitigation: `TASK-131` (a weekly logical `BACPAC` export to the blob account) is **recommended early**, giving a cheap out-of-band copy that outlives the 7-day window; Long-Term Retention is the named escalation. See `data-model.md` §16.11 |

---

## 11. Incident playbook (one page, because there is one operator)

| Symptom | First action |
|---|---|
| Someone else's account can sign in | Remove their subject from `NEXTUP_ALLOWED_SUBJECTS`, restart the app, then check logs for their `ownerIdHash` |
| A secret is suspected leaked | **(R4)** Rotate the affected one: `TMDB_API_KEY` at TMDB; the **`GHCR_PULL_TOKEN`** at GitHub (regenerate the PAT, update the Container Apps registry secret); the DB SQL-auth password (if the fallback is in use) in Key Vault. **If MI database auth is in use there is no DB password to rotate.** |
| Unexpected Azure cost | Check `extractionStats` totals and the ACA free-grant usage; the only metered inference is OCR (`specs/ai.md` §10) |
| Data appears lost | **Do not run a repair script.** Check `/removed` (nothing is ever deleted), then batch provenance at `/batches`, then **Azure SQL point-in-time restore (7 days)** — restore to a NEW database and compare before repointing anything. **If the loss is older than 7 days, use the latest `TASK-131` `BACPAC` export** *(R4 — window shortened from 35 days; see data-model §16.11)* |
| A TTL or purge is discovered in the codebase | Revert it. `T-INV-013`/`T-INV-012` should have blocked it; if they did not, fix the test first |


---

## 10. The staging environment (REVISION 3)

> **New.** A staging environment did not exist in Revision 1: the Cosmos
> free tier is one account per subscription, so a second environment would
> have consumed the thing that made the architecture free. The datastore
> change (ADR-0005 Rev 2) removed that blocker and staging was added
> (ADR-0003 R2.4) at a marginal cost of roughly **$0**. It has security
> consequences, and they are stated here rather than discovered later.

**Staging is a second Container App in the same Container Apps
environment, a separate serverless Azure SQL database (`nextup_staging`
with auto-pause enabled), and a second blob container
(`screenshots-staging`) on the same storage account.** *(R4 — was a second
database on the shared PostgreSQL server. Azure SQL bills per database, so
staging is a distinct serverless DB at ≈$0.50/mo storage-floor, not the $0
the shared PG server gave; ADR-0003 R3.3. Auto-pause is acceptable because
nobody judges staging's cold start.)*

The rules, all mandatory:

1. **No production data is ever copied to staging.** Not a subset, not
   anonymised, not "just to reproduce a bug". The owner's screenshots are
   C3 data and the watchlist is C2; neither leaves production. Staging
   holds **synthetic fixtures only**. `T-SMOKE-*` seeds them.
2. **Staging has its own Entra app registration and its own allow-list.**
   It is not a second door into production identity. A subject allowed in
   staging is not thereby allowed in production, and vice versa.
3. **Staging has its own managed identity**, granted access to
   `nextup_staging` and `screenshots-staging` **only**. `T-INFRA-001` is
   extended to assert the staging identity has **no** grant on the
   production database or the production blob container. This is the most
   important assertion in this section: the two environments share a
   server and a storage account, so the isolation is entirely a matter of
   correct RBAC scoping, and correct RBAC scoping is exactly the sort of
   thing an autonomous implementer gets subtly wrong.
4. **Staging runs the stub extractor by default.** It does not call Azure
   OpenAI or Azure AI Vision with real images, which keeps `specs/ai.md`
   Rule A and the abuse-monitoring exemption (`TASK-134`) out of scope
   there entirely.
5. **Staging is not publicly advertised** and runs at `minReplicas = 0`.
   It is still authenticated at the platform edge like production —
   an unauthenticated staging environment would be a genuine exposure,
   and it is not one.

**The honest give-up:** the two environments are now **separate Azure SQL
databases** (R4), so a database-level failure no longer affects both — a
small improvement over the R3 shared-server design. They still share a
**storage account**, so a Bicep change that targets the *account* rather
than the *container* affects both. At one user, with the alternative being
a second storage account, this was judged the right trade. A migration is
still applied to staging first and production second, and `T-MIG-001` (no
destructive migration) is the control that matters most.
