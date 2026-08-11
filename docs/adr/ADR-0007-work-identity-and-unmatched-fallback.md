# ADR-0007 — Canonical work identity, including the fallback for unmatched titles

| | |
|---|---|
| **Status** | **Accepted (as amended)** — adopted by `spec-writer` at phase 8; see the amendment note below |
| **Date** | 2026-08-10 (proposed) · 2026-08-10 (accepted as amended, phase 8) |
| **Deciders** | solution-architect (phase 7), autonomous — **this question is not the architect's to close** · accepted with amendments by spec-writer (phase 8) |
| **Forced by** | REQ-009, REQ-012, REQ-024, REQ-065, **REQ-071**, REQ-066, NFR-002 |
| **Relates to** | **OQ-015 (CLOSED at phase 8)**, OQ-013 (CLOSED at phase 8) |

> **Amendment note (spec-writer, phase 8).** This ADR was written as a
> recommendation and is now **adopted with three amendments**, recorded as
> decisions `SD-01`, `SD-05` and `SD-06` in `artifacts/specs/data-model.md` §2.
> **(1) Option B is adopted** — `workIdentity` is one opaque string,
> `tmdb:{movie|tv}:{id}` or `unmatched:<sha256(normaliseTitleText(raw))[0:16]>`,
> and the same string is the suppression key in both forms, honouring A34's
> "one decision, not two".
> **(2) Rule 6 is REJECTED (SD-05)** — the extracted year is **excluded** from
> the fallback hash. A year is present on one capture and absent on the next
> depending on the capture surface, so including it splits one work into two
> identities and thereby **silently bypasses a suppression**, which is exactly
> the failure this ADR exists to prevent. `extractedYear` is retained as a
> TMDB match *hint* only.
> **(3) A behaviour is ADDED (SD-06)** — fix-match **migrates** an active
> suppression from the old `workIdentity` to the corrected one, sets
> `migratedFrom`, and reports the migration to the owner. Without it,
> correcting a wrong match silently drops a suppression.
> **Consequence for the PRD:** unmatched works are now suppressible, which
> **supersedes US-028 AC-6**; the replacement is written as `AC-6′` in
> `specs/data-model.md` §2.3.1 and tested by `T-SUP-006`.

## Context

`OQ-015` asks what happens when an extracted title cannot be matched to
TMDB. It is owned by `requirements-clarifier` / `spec-writer` and it is
**not closed by this ADR** — but the architecture cannot be written
without accommodating it, and `A34` attached a second, heavier
consequence to it that makes a concrete recommendation worth having.

The binding constraint, stated in `requirements.md` §1.7 and repeated in
`mvp-definition.md` §17 L2:

> **Whatever fallback identity OQ-015 adopts is automatically the
> fallback suppression key — the two decisions are the same decision and
> must not be made twice, differently.**

Canonical work identity is load-bearing in four places:

| Consumer | Requirement | What breaks without a stable identity |
|---|---|---|
| Cross-service dedup — one row per work | REQ-024 | The same film appears twice, once per service |
| Suppression | **REQ-071** | A dismissed work returns on the next capture, **silently** |
| Reappearance semantics | REQ-065 | Cannot tell "the same work again" from "a different work" |
| Intra-batch overlap collapse | OQ-013 | Scroll-overlap duplicates flood the review pass |

`REQ-071` is the dangerous one. Suppression is keyed on canonical work
identity precisely because a reappearing work becomes a **new row**
(REQ-065), so a row-scoped flag is bypassed on the very next capture —
and nothing anywhere reports an error. If the fallback identity for
unmatched titles is unstable, suppression of unmatched works degrades
in exactly the same silent way.

`REQ-012` fixes only the floor: unmatched candidates are surfaced, never
discarded. It deliberately says nothing about what identity they carry.

## Options considered

### Option A — Unmatched candidates get no identity; they are held in an unmatched bucket and never become Titles until matched

| | |
|---|---|
| Summary | An unmatched candidate is surfaced for the owner to resolve (search TMDB and pick), and only becomes a `Title` once it has a TMDB id. |
| Pros | **Every `Title` has a canonical identity, always.** Dedup and suppression are exact, with no fallback path and therefore no fallback failure mode. The simplest possible invariant to state and test. |
| Cons | A work TMDB genuinely does not have — or that the owner cannot be bothered to resolve during a 300-item first import — **cannot enter the list at all**. That converts an extraction success into a list gap, which is exactly the outcome `REQ-012` exists to prevent. It also concentrates work at the worst possible moment (`OQ-011`, the abandonment risk). |
| Reversal cost | Low. |

### Option B — Deterministic normalised-text fallback identity

| | |
|---|---|
| Summary | An unmatched candidate becomes a `Title` whose `workIdentity` is derived deterministically from its normalised extracted text: `unmatched:sha256(normalise(text))[0:16]`. It carries `matchState: "unmatched"` and is visibly marked in the UI. |
| Pros | The work enters the list, so `REQ-012`'s intent survives all the way to the combined list rather than stopping at the review pass. Identity is **deterministic and stable across captures whenever the OCR output is stable**, so dedup, overlap collapse and — critically — **suppression all work for unmatched titles by the same mechanism as for matched ones**. It is one identity scheme, not two: `workIdentity` is a single opaque string that is either `tmdb:*` or `unmatched:*`, and every consumer treats it identically. `REQ-066` fix-match provides the repair path: re-pointing an unmatched title at a TMDB work replaces the fallback identity with a canonical one. |
| Cons | **The identity is only as stable as the OCR output.** One different character — a dropped diacritic, a colon read as a semicolon — produces a different hash and therefore a different work, so the same title can appear twice and a suppression can be bypassed. This is a genuine residual, not a defect to be coded around, and it is inherited directly from `OQ-015`'s own framing. |
| Reversal cost | Low–moderate: existing `unmatched:*` identities would need re-keying if the normalisation changed. |

### Option C — Owner-assigned identity: the owner names the work, nextup keys on that

| | |
|---|---|
| Summary | The owner types a canonical name for each unmatched title; that name is the identity. |
| Pros | Stable, human-meaningful, immune to OCR variance. |
| Cons | Manual work at exactly the moment (`OQ-011`, first import) that the product can least afford it, and it is really Option A with extra typing. |
| Reversal cost | Low. |

### Option D — Accept duplicate rows for unmatched titles

Rejected: it silently breaks `REQ-024` and, far worse, silently breaks
`REQ-071` — a dismissed unmatched title returns on every capture with no
error anywhere. This is the failure mode the whole requirement set is
organised against.

## Decision (recommended, not binding)

**Recommend Option B: a single opaque `workIdentity` string on every
`Title`, of one of two forms.**

```
tmdb:movie:438631          # matched — the canonical case
tmdb:tv:66732
unmatched:9f2c1a7b4e0d5c83 # fallback — sha256(normalise(rawText))[0:16]
```

**Normalisation** (must be specified exactly once, in
`specs/data-model.md`, and used by *every* consumer — dedup, suppression,
overlap collapse):

1. Unicode NFKD normalise; strip combining marks (`Amélie` → `Amelie`).
2. Lowercase.
3. Remove all characters outside `[a-z0-9 ]`.
4. Strip a leading article: `the`, `a`, `an`.
5. Collapse whitespace runs to a single space; trim.
6. If a 4-digit year was extracted alongside, append ` <year>`.

**Suppression keys on `workIdentity` verbatim**, for both forms. There is
one key, one scheme, one decision — satisfying the A34 constraint that
the fallback identity and the fallback suppression key must not be made
twice, differently.

**`REQ-066` fix-match is the repair path.** Re-pointing a `Title` at a
TMDB work rewrites its `workIdentity` from `unmatched:*` to `tmdb:*`.
The specification must state what happens to an existing suppression on
the old identity — the recommendation is to **migrate the suppression to
the new identity and tell the owner it was migrated**, because silently
dropping it re-opens exactly the REQ-071 hole.

**Invariant:** at most one `Title` per `(ownerId, workIdentity)` in a
state other than `removed`. Not enforceable by the store (ADR-0005), so
it must be an application invariant with a named test.

Option A was not recommended because it makes `REQ-012`'s guarantee stop
at the review pass, and because it front-loads manual work onto the
first import — the `R-1`/`OQ-011` abandonment risk.

## Consequences

### Positive
- One identity concept, one code path, four consumers. Nothing in the
  system needs to know whether an identity is canonical or fallback.
- `REQ-071` suppression works for unmatched titles by the same mechanism
  as for matched ones — degraded, but present, rather than absent.
- `REQ-012`'s intent reaches the combined list, not just the review pass.
- Deterministic and cheap: a point-read on `supp:<workIdentity>`
  (ADR-0005) answers the suppression check with no query.

### Negative
- **Fallback identity is only as stable as OCR output.** A single
  character of variance splits one work into two identities. Consequences:
  a duplicate row (visible, tolerable — the owner sees it) and a bypassed
  suppression (**invisible** — the dismissed title simply returns). This
  is the acknowledged residual of `OQ-015` and this ADR does not remove
  it; it bounds it and gives it a repair path.
- Hash-based identities are opaque and undebuggable by eye. The raw text
  and the normalised form must both be persisted on the `Title` so a
  human — or an agent — can see why two things did or did not match.
- The normalisation rules are a specification surface an autonomous
  implementer could re-derive slightly differently in a second place.
  They must exist as **one exported function with a table-driven test**,
  and no other implementation.
- Suppression migration on fix-match is an extra behaviour the PRD does
  not currently cover; it needs a story or an acceptance criterion.

### Neutral / follow-on work required
- **`OQ-015` remains OPEN.** This ADR is `Proposed`. `spec-writer`
  should adopt, amend or reject it, and record the outcome as OQ-015's
  closure.
- If adopted, `specs/data-model.md` owes the normalisation table and the
  invariant; `specs/ai.md` owes the matching strategy (deterministic
  only — see `RSK-022` in ADR-0001: no TMDB content may be sent to any
  AI service, so the matcher must not be model-assisted); the PRD owes
  an acceptance criterion for suppression migration on fix-match.
- The same normalisation function serves the `OQ-013` pre-match overlap
  collapse, so adopting it closes part of that question too.

## Reversal

| | |
|---|---|
| **Is this a one-way door?** | **No**, but it leaves a trace: identities already assigned are embedded in stored documents. |
| **Cost to reverse** | Low if done early; a data-migration script re-keying `unmatched:*` identities (and their suppressions) if done late. Matched `tmdb:*` identities are unaffected by any change to the fallback scheme, which is most of the data. |
| **Trigger to revisit** | (a) `spec-writer` closes OQ-015 differently; (b) observed OCR variance splits works often enough to be a nuisance; (c) a fuzzy-match or edit-distance identity is needed — noting it must remain deterministic and non-model-assisted. |

## Compliance and security implications

- No TMDB content is used to build the fallback identity; it is derived
  purely from the owner's own screenshot text. This keeps the identity
  scheme clear of the TMDB AI-application clause (`RSK-022`).
- Identities are per-owner by construction (`ownerId` is the partition
  key, ADR-0005), so no identity is shared across owners (NFR-008).

## References

- `Context/requirements.md` §1.7 (the "one decision, not two"
  constraint), REQ-009, REQ-012, REQ-024, REQ-065, REQ-066, REQ-071
- `Context/mvp-definition.md` §17 L2, §9.2
- `Context/open-questions.md` — OQ-015 (high, open), OQ-013
- `artifacts/PRD.md` US-008, US-026, US-028, US-030; §12.3 R-5, R-7
- ADR-0001 (deterministic matching), ADR-0005 (identity in the model)

---

## ⚠ A41 / CC-002 re-examination — 2026-08-10T21:45 — **DECISION STANDS; the store now enforces it**

`workIdentity` was never a cost decision, and the datastore change
(ADR-0005 Revision 2, Cosmos → PostgreSQL) does not touch the identity
scheme: `tmdb:<mediaType>:<id>` and `unmatched:<hash>` are opaque
strings in a column, exactly as they were opaque strings in a document.
SD-01, SD-05 (the extracted year is EXCLUDED from the fallback hash) and
SD-06 (fix-match migrates an active suppression) are unaffected.

**What improves.** Revision 1 of ADR-0005 obtained per-work suppression
uniqueness by encoding the identity into the document id
(`supp:<workIdentity>`). Relationally this becomes
`UNIQUE (owner_id, work_identity)` on `suppression` — the same
guarantee, stated as what it is, and legible without knowing Cosmos id
semantics. And A34's constraint — that the fallback identity and the
fallback suppression key are **one decision, not two** — is now enforced
by a **foreign-key-shaped relationship on a single canonical column**
rather than by a naming convention.
