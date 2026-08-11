# ADR-0002 — Identity provider: Microsoft Entra ID via Container Apps built-in authentication

| | |
|---|---|
| **Status** | Accepted |
| **Date** | 2026-08-10 |
| **Deciders** | solution-architect (phase 7), autonomous |
| **Forced by** | NFR-015, NFR-016, NFR-017, NFR-008, NFR-001, NFR-002, NFR-004, NFR-012 |
| **Closes** | **OQ-019** |

## Context

`A27` settled that nextup authenticates through an **external identity
provider**, stores **no password or credential of its own** (NFR-016),
and exposes **no self-service registration surface** (NFR-017). The
requirement set deliberately named no provider — `requirements.md`
records that naming one would be "a solution in disguise" — and handed
the choice to this phase as `OQ-019`.

The shape of the problem is unusually constrained, which makes the
decision easier than it looks:

- **There is exactly one user.** Not "one user initially" — one, with a
  forward-looking allowance for fewer than 20 allow-listed identities
  later (NFR-001). There is no tenant model, no roles, no invitations,
  no self-service anything.
- **The implementer is an autonomous coding agent** (ASM-028/029,
  NFR-002). Authentication is, empirically, one of the most defect-prone
  things to hand to any implementer — token validation, redirect
  handling, state/nonce, cookie flags, session fixation. The best
  outcome here is not "well-implemented auth" but **no auth code at
  all**.
- **Cost must be $0** (NFR-012), which every candidate satisfies at this
  scale.
- **Authentication and authorisation are separate obligations here.**
  NFR-015 requires an authenticated requester; NFR-017 requires that
  access be granted **only to identities on an explicitly configured
  allow-list**. Federated sign-in alone satisfies the first and not the
  second — any Microsoft, Google or GitHub account in the world can
  authenticate. The allow-list is ours to enforce regardless of
  provider (PRD US-001 AC-4).

## Options considered

### Option A — Microsoft Entra ID (incl. personal Microsoft accounts), via Container Apps built-in authentication ("Easy Auth")

| | |
|---|---|
| Summary | Enable the platform authentication feature on the Container App with the `Microsoft` provider. The platform performs the full OIDC code flow, sets the session cookie, and forwards the validated principal to the container as the `X-MS-CLIENT-PRINCIPAL` header. Unauthenticated requests are rejected or redirected **before they reach application code**. |
| Pros | **Effectively zero authentication code in the application.** No token library, no redirect handling, no cookie management, no key rotation — the highest-value property available under NFR-002. Native to the chosen host (ADR-0003) and to Azure generally; managed identity, Key Vault and RBAC all speak the same identity. Free. `NFR-015`'s "no data before authentication" (US-001 AC-1) is enforced by the *platform*, structurally, rather than by a middleware someone could forget to register — the strongest possible form of that guarantee. Supports both organisational and personal Microsoft accounts, so the owner signs in on a phone with an account they already have. |
| Cons | Couples sign-in to the hosting platform: moving off Container Apps/App Service means implementing OIDC properly for the first time. The redirect flow is server-rendered, so a pure cross-origin SPA on a separate domain would need extra work (avoided here — ADR-0003 puts the SPA and API on one origin). Easy Auth authenticates *anyone* with a Microsoft account; the NFR-017 allow-list is still ours to write. |
| Cost | **$0.** Easy Auth is a free platform feature. Entra ID's free tier is included with any Azure subscription; personal Microsoft accounts cost nothing. |
| Reversal cost | Low–moderate. Swapping the *provider* is a configuration change (Easy Auth also speaks Google, GitHub, Apple and generic OIDC). Swapping *away from Easy Auth* means writing an OIDC client — one focused piece of work. |

### Option B — Google Sign-In (OIDC), implemented in application code

| | |
|---|---|
| Summary | Register an OAuth client in Google Cloud Console; implement the authorization-code flow in the app. |
| Pros | Free. Ubiquitous — the owner certainly has a Google account, and Google's mobile sign-in UX is excellent. Provider-neutral: works on any host, so no platform coupling. |
| Cons | **All of the authentication code we were trying not to write**, handed to an autonomous agent: redirect URIs, PKCE, state/nonce, ID-token signature and claim validation, session cookie issuance and lifetime (US-001 AC-6). Introduces a second cloud vendor's console into a deployment that is otherwise entirely Azure + GitHub, for zero functional gain. |
| Cost | $0. |
| Reversal cost | Low as configuration, but the code was already written and is the sunk cost. |

### Option C — GitHub OAuth

| | |
|---|---|
| Summary | GitHub OAuth app; also natively supported by Easy Auth. |
| Pros | Free. The repository already lives on GitHub and the implementing agent is a GitHub product, so the identity is certainly available to the *developer*. Trivially simple OAuth app registration — the least ceremony of any option. |
| Cons | **It is a developer identity, not a consumer one.** The primary usage context is a phone, at the moment the owner sits down to watch television (`J-1`). GitHub's mobile sign-in is fine but is not an account most people are already signed into on a phone browser. GitHub OAuth is OAuth2, not full OIDC — it returns no ID token, so identity comes from an extra API call, which is a small but real deviation from the "boring standard" NFR-004 prefers. |
| Cost | $0. |
| Reversal cost | Low. |

### Option D — Microsoft Entra External ID (CIAM)

| | |
|---|---|
| Summary | Azure's customer-identity product: an external tenant with sign-up/sign-in user flows and social federation. |
| Pros | Free up to a large monthly-active-user allowance. Purpose-built for consumer identity, and would scale gracefully to the NFR-001 family-and-friends case. |
| Cons | **Solves a problem nextup does not have and is forbidden to have.** Its central feature is a *self-service sign-up surface*, which `NFR-017` explicitly prohibits. Provisioning an external tenant, user flows and branding is materially more configuration than every other option, for one user. Gold-plating, and the artifact reviewer would be right to flag it. |
| Cost | $0 at this scale. |
| Reversal cost | Moderate — a separate tenant is real infrastructure to unwind. |

## Decision

**We will use Microsoft Entra ID — accepting both organisational and
personal Microsoft accounts — as the identity provider, configured
through Azure Container Apps built-in authentication (Easy Auth), with
the NFR-017 allow-list enforced in application middleware against a
configured list of stable subject identifiers.**

The deciding factor is `NFR-002`/`NFR-004`, and it is a legitimate
technical criterion here rather than a convenience: **the option that
requires the implementing agent to write no authentication code is
categorically safer than the options that require it to write good
authentication code.** Easy Auth also converts US-001 AC-1 ("no nextup
content or data is rendered before authentication completes") from an
application invariant that must be tested into a platform property that
cannot be bypassed.

Entra rather than Google or GitHub because the deployment is already
entirely Azure: the same identity plane already issues the managed
identities used for Cosmos DB, Blob Storage and Azure AI Vision
(ADR-0003, ADR-0005, ADR-0006), so this adds **zero** new vendor
relationships, consoles or secrets.

**The provider choice is confined to configuration**, as PRD US-001
requires: application code reads a normalised principal
(`{ issuer, subject, email }`) from a single adapter over the
`X-MS-CLIENT-PRINCIPAL` header. Switching to Google or GitHub is an
Easy Auth configuration change plus new allow-list values — no
application logic changes.

## Consequences

### Positive
- **No password, no password hash, no reset flow, no token-validation
  code exists in nextup.** NFR-016 is satisfied by construction, and
  US-001 AC-3 becomes trivially testable: grep the repository and the
  data store.
- US-001 AC-1 is enforced by the platform ahead of application code.
- US-001 AC-6 (session persistence without re-authentication) is a
  platform-managed session cookie — a feature, not code.
- $0, with no fixed commitment (NFR-012).
- The NFR-001 path is exactly what it was designed to be: adding a
  family member later is **appending a subject identifier to the
  allow-list**, not building an account system.
- One identity plane for both human sign-in and service-to-service
  auth (managed identity), which keeps `specs/security.md` short.

### Negative
- **Hosting lock-in.** Easy Auth is a Container Apps / App Service
  feature. Moving to a host without it (a plain VM, a different cloud,
  a static host with a serverless API elsewhere) means writing the OIDC
  client we avoided. This is a real coupling and it is accepted
  deliberately, in exchange for removing the highest-risk code from an
  autonomous build.
- **Authentication ≠ authorisation.** Easy Auth lets *any* Microsoft
  account through. If the allow-list middleware is missing or
  misconfigured, the app is open to the entire world of Microsoft
  accounts — and it **fails silently**, because everything appears to
  work for the owner. `NFR-017`/US-001 AC-4 must have a dedicated
  automated test asserting that a valid, non-allow-listed principal is
  refused (NFR-003). This is the single most important test in Epic A.
- **Local development needs a bypass.** Easy Auth does not run outside
  Azure, so local runs need a development-only principal shim. That
  shim is a foot-gun: if it can be enabled in the deployed environment,
  it is an authentication bypass. It must be compiled/tree-shaken out of
  production builds, not merely disabled by a runtime flag, and a test
  must assert its absence from the production artifact.
- **Sign-in cannot be re-skinned.** The Microsoft sign-in page is
  Microsoft's. Irrelevant for one user; noted for completeness.
- A personal Microsoft account's `oid`/`sub` claim value must be read
  from a real sign-in before the allow-list can be populated — a small
  chicken-and-egg step at first deployment. Mitigation: a first-run
  bootstrap mode that logs the rejected principal's subject identifier
  (and nothing else) so the owner can copy it into configuration; this
  mode must default to off.

### Neutral / follow-on work required
- Allow-list configuration key: `NEXTUP_ALLOWED_SUBJECTS` — a
  comma-separated list of stable provider subject identifiers (**not**
  email addresses, which are mutable and re-assignable).
- The owner identifier used for `ownerId` on every record (NFR-008) is a
  **nextup-internal, stable identifier mapped from** the provider
  subject — not the provider subject itself. This keeps a future
  provider swap from orphaning every record in the database.
- `specs/security.md` owes: session lifetime, the principal-adapter
  contract, the allow-list test, and the dev-shim exclusion test.

## Reversal

| | |
|---|---|
| **Is this a one-way door?** | **Partially.** Changing *provider* is configuration. Changing *away from Easy Auth* is a focused piece of work. |
| **Cost to reverse** | Provider swap: minutes (Easy Auth configuration + new allow-list values). Leaving Easy Auth: 1–2 days to implement and test an OIDC client — and it is bounded, because the application only ever consumes a normalised principal from one adapter. Owner data is unaffected either way, because `ownerId` is internal. |
| **Trigger to revisit** | (a) leaving Azure Container Apps / App Service; (b) the owner cannot or will not use a Microsoft account on their phone; (c) NFR-001 is exercised and the allow-list stops being the right model (i.e. real multi-user with self-service — which would be a scope change, not an architecture change). |

## Compliance and security implications

- **NFR-016** satisfied structurally — no credential material of any kind
  exists in nextup's storage or configuration.
- **NFR-015** enforced at the platform edge, before application code.
- **NFR-017** enforced in application middleware; **this is the one part
  of the auth story that is ours and that can fail silently** — see the
  mandated test above.
- **NFR-008** enforced by owner-scoped queries; every read path filters
  on the internal `ownerId` derived from the authenticated principal.
- No PII beyond a subject identifier and an email claim is stored.
- Transport is HTTPS-only; Container Apps supplies a managed certificate
  and HTTP→HTTPS redirection.

## References

- `Context/requirements.md` — NFR-015, NFR-016, NFR-017, NFR-008, NFR-001
- `Context/open-questions.md` — OQ-019 (opened at A27), C4b/C5
- `artifacts/PRD.md` §6 US-001, US-002; §7.7 permissions matrix
- ADR-0003 (hosting), ADR-0005 (datastore), ADR-0006 (image storage)

---

## ⚠ A41 / CC-002 re-examination — 2026-08-10T21:45 — **DECISION STANDS, unchanged**

Re-read for cost-driven reasoning after `NFR-012` was relaxed
system-wide. **There was none.** Container Apps built-in authentication
was chosen because it means **zero authentication code** (`NFR-002`,
`NFR-016`) and because "no content before auth" becomes a platform
property. It is also free, but the alternatives considered (Google
OIDC in app code, GitHub OAuth, Entra External ID) were rejected on
*code surface*, not on price — none of them costs money at this scale
either.

Money cannot buy anything better here: the paid options (Entra External
ID premium features, a third-party IdP) would **add** an integration to
a design whose whole value is having none.

One consequential change from elsewhere: **ADR-0003 R2.4 adds a staging
environment**, so a **second Entra app registration** now exists for
staging, with the same allow-list mechanism. `specs/security.md` must
state that the staging allow-list is configured independently and is not
a route into production data (different database, different blob
container).
