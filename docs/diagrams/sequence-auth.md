# Sequence — federated sign-in and owner scoping

**Type:** Sequence diagram
**Shows:** how a request becomes an authenticated, allow-listed, owner-scoped operation — and where each of the two checks lives.
**Traces to:** NFR-008, NFR-015, NFR-016, NFR-017, NFR-001; US-001, US-002
> ⚠ **REVISION 4 (A40, Variant A):** the datastore participant `DB` is now **Azure SQL Database Basic** (was PostgreSQL in R3, Cosmos in R1); registry is **ghcr.io**; compute is **0.25 vCPU / 0.5 GiB**. The flow itself is unchanged — only the store, registry and compute labels move. See ADR-0005 Rev 3 / ADR-0003 Rev 3, `specs/data-model.md` §16.


```mermaid
sequenceDiagram
    actor O as Owner
    participant BR as Browser
    participant EA as Container Apps built-in auth<br/>(platform edge)
    participant IDP as Microsoft Entra ID
    participant MW as Allow-list + owner-scoping middleware
    participant APP as Application handlers
    participant DB as Azure SQL Database

    O->>BR: open any nextup URL
    BR->>EA: GET /whatever

    alt no valid session
        EA-->>BR: 302 to Entra ID
        BR->>IDP: OIDC authorization code flow
        O->>IDP: signs in with an existing Microsoft account
        IDP-->>EA: id_token
        EA->>EA: validate signature, issuer, audience, nonce
        EA-->>BR: set session cookie, redirect back
        Note over EA: ALL of this is platform behaviour.<br/>nextup writes NO authentication code.<br/>No password, hash, or reset flow exists (NFR-016).
    end

    BR->>EA: GET /api/titles (with session cookie)
    EA->>MW: forward request + X-MS-CLIENT-PRINCIPAL
    Note over EA,MW: US-001 AC-1 — no nextup content or data<br/>is rendered before this point. Enforced by the<br/>PLATFORM, not by a middleware someone could forget.

    MW->>MW: normalise principal {issuer, subject, email}
    MW->>MW: is subject in NEXTUP_ALLOWED_SUBJECTS?

    alt NOT on the allow-list (NFR-017)
        MW-->>BR: 403 "this application serves a single owner"
        Note over MW: No data is created for that identity.<br/>No self-service registration path exists.<br/>**Easy Auth lets ANY Microsoft account authenticate —<br/>THIS check is the only thing that stops them.<br/>It fails SILENTLY if omitted.**
    else on the allow-list
        MW->>MW: map subject → internal stable ownerId
        Note over MW: The internal ownerId — not the IdP subject —<br/>is stored on every record, so changing provider<br/>later does not orphan the data.
        MW->>APP: request + ownerId
        APP->>DB: query WHERE owner_id = @1
        Note over APP,DB: NFR-008 — owner_id is on EVERY table and leads<br/>EVERY index, and is the first positional parameter<br/>of every repository function. R4: the store is<br/>Azure SQL Database; the guarantee is an indexed column<br/>(COLLATE ..._BIN2) plus a lint/test rule, not a partition key.
        DB-->>APP: rows
        APP-->>BR: JSON
    end
```

## Explanation

**The single most important thing in this diagram is that
authentication and authorisation are two different checks in two
different places, and only one of them is ours.**

**Authentication is the platform's.** Container Apps built-in
authentication (ADR-0002) performs the whole OIDC code flow against
Microsoft Entra ID, validates the token, manages the session cookie, and
forwards a validated principal. nextup writes **no** authentication code
— no token library, no redirect handling, no state or nonce, no cookie
flags. That is the deciding property of ADR-0002 under `NFR-002`: the
implementer is an autonomous coding agent, and the safest authentication
implementation is the one that does not exist. It also converts
`US-001 AC-1` — no content before authentication — from an application
invariant that must be tested into a platform property that cannot be
bypassed. `NFR-016` (no password, hash or reset flow anywhere) becomes
trivially verifiable: grep the repository.

**Authorisation is ours, and it is the one place this design can fail
silently.** Easy Auth authenticates *anyone in the world with a
Microsoft account*. `NFR-017` requires access to be granted only to
identities on an explicitly configured allow-list, and that check lives
in application middleware. If it is missing or misconfigured, everything
still works perfectly for the owner while the application is open to
every Microsoft account in existence. **US-001 AC-4 is therefore the
single most important automated test in Epic A**: a valid,
non-allow-listed principal must be refused.

**Owner scoping is structural, not conventional.** The middleware maps
the provider subject to an internal, stable `ownerId`. **R4 (ADR-0005
Rev 3): the store is Azure SQL Database, so this is an `owner_id` column
present on every table (declared `COLLATE Latin1_General_100_BIN2` for
exact-match semantics), leading every index, and passed as the first
positional argument of every repository function** — rather than a Cosmos
partition key. Be honest about what that trades: the partition key made
a cross-owner read *expensive*, which is a stronger deterrent than an
indexed column, so the enforcement moves from physics to convention plus
a test. In exchange, the relational store enforces the invariants that
actually corrupt this product's data (at most one non-removed title per
`(owner_id, work_identity)`; suppression uniqueness) as **real
constraints**, which Cosmos could not. At one user, with `NFR-001`'s
ceiling under 20 identities, that is the better trade — but the
owner-scoping test in `specs/testing.md` becomes load-bearing rather than
belt-and-braces, and is called out as such. `NFR-001` remains
allow-list-plus-filter, not an account system.

**Storing the internal `ownerId` rather than the IdP subject on records
is deliberate.** It keeps a future provider swap — Entra to Google, say,
which ADR-0002 makes a configuration change — from orphaning every
record in the database.

## Notes and caveats

- **Local development has no Easy Auth**, so a development-only principal
  shim is required. That shim is an authentication bypass if it can ever
  run in the deployed environment. It must be excluded from the
  production build at compile time, not merely disabled by a runtime
  flag, and a test must assert its absence from the production artifact.
- First deployment has a small chicken-and-egg problem: the owner's
  subject identifier must be observed from a real sign-in before the
  allow-list can be populated. A bootstrap mode that logs a rejected
  principal's subject identifier (and nothing else) solves it and must
  default to off.
- Session lifetime, refresh behaviour and sign-out are platform-managed
  and belong in `specs/security.md`.
- The allow-list holds provider **subject identifiers**, not email
  addresses — email claims are mutable and re-assignable and must never
  be used as a key.
- There is exactly one principal type. There is no administrator, no
  role model and no admin surface (PRD §7.7).
