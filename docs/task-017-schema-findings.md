# TASK-017 pre-implementation findings — §16.3 reconciliation

**Status: BLOCKED on four owner decisions (§5). Do not write
`prisma/schema.prisma` from `specs/data-model.md` §16.3 until they are made.**

This is the record of a reconciliation sweep run before TASK-017, comparing the
normative Azure SQL DDL (`specs/data-model.md` §16.3) against the
already-implemented, CI-tested domain layer (`packages/domain/src/types.ts`,
`enums.ts`, `schemas.ts`) and the API contract (`specs/api.md`).

## 0. Why this exists

§16.3 is a mechanical T-SQL transliteration of §15.3, which was itself a
Cosmos→relational port. Neither port was reconciled against §3's field lists.
The result is a DDL that is *shaped* correctly and *populated* incompletely.

Four enum defects were found and fixed first (commit `1e0fd6f`): the wrong
streaming service (`'prime'` for `'max'`, ×3), underscored batch modes, a
six-value status list where §3 defines eight, and a column too narrow for
`'extraction-failed'`. Those are **already fixed**. This document covers what
was found underneath them.

## 1. Verified by execution, not by reading

Every finding in this section was reproduced against
`mcr.microsoft.com/mssql/server:2022-latest` (SQL Server 2022 RTM-CU26) by
extracting the §16.3 DDL verbatim from the spec and running it.

| # | Finding | Evidence |
|---|---|---|
| **E-1** | **The DDL cannot execute.** `title` references `upload_batch` and `service_listing` references `removal_group`, both before those tables are created. | `Msg 1767: Foreign key 'FK__title__created_b__398D8EEE' references invalid table 'upload_batch'` — 0 of 9 tables created |
| **E-2** | **Seven FK columns omit the collation §16.2.1 requires of them.** §16.2.1 says "all `*_id`" get `Latin1_General_100_BIN2`; 22 columns have it, 7 do not — and all 7 are FKs, which SQL Server requires to match. | `Msg 1757: Column 'upload_batch.id' is not of same collation as referencing column 'title.created_by_batch_id'` |
| **E-3** | **`ISJSON` returns 0 for JSON scalars**, so `batch_change.prev_value`/`next_value` reject the most common provenance write (a previous `workIdentity`, a bare string). Batch close is one transaction, so **the whole close rolls back**. | `ISJSON('"tmdb:tv:1"')` → `0`; `ISJSON('42')` → `0`; objects and arrays → `1` |
| **E-4** | **The `dup:` acknowledged-duplicate prefix is unstorable.** | `BLOCKED by ... CHECK constraint "title_match_coherent"` |
| **E-5** | **The two-service reappearance case is unrepresentable — both paths are blocked.** A work active on Max, removed from Netflix, reappearing on Netflix. | Path "re-add to existing title" → blocked by `listing_one_per_service`; path "create a new title" (what §6.1/US-026 AC-1 require) → blocked by `title_one_active_per_work` |

**After fixing E-1 (topological order) and E-2 (7 collations) only, all 9 tables
create cleanly with zero errors.** Those two fixes are settled — no decision
needed, they are unambiguous defects with one correct answer.

### 1a. Two traps found while executing, worth keeping

- **Filtered indexes require `SET QUOTED_IDENTIFIER ON`, and `sqlcmd` defaults
  it OFF.** The three invariant indexes failed with `Msg 1934` and the run
  otherwise looked fine — the subsequent inserts simply succeeded, because the
  indexes enforcing them did not exist. **A migration or test harness that
  invokes `sqlcmd` without `-I` will silently not enforce I-1, I-2 or I-9.**
  This is a green-but-asserting-nothing failure, the same class as `T-CI-008`.
- **SQL Server treats two `NULL`s as equal in a unique index** (verified:
  second `(w, NULL)` row rejected with `2601`). Any dedup column must use a
  non-null sentinel, not `NULL`, to mean "not a duplicate".
- Incidentally confirms the unique-violation error number is **`2601`**, so
  `specs/testing.md:1439`'s surviving PostgreSQL `23505` reference is stale.

## 2. Decisions required from the owner

These four cannot be resolved from the specs, because the specs contradict
themselves or are silent.

### D-1 — I-2 has no filter, and that makes reappearance impossible (E-5)

`CREATE UNIQUE INDEX listing_one_per_service ON service_listing (title_id, service)`
forbids a title from *ever* having two listings on one service — including one
`removed` and one `active`. Soft delete means the removed row stays forever, so
the pair is permanently occupied.

A work on both Netflix and Max, removed from Netflix only, keeps title state
`active` (`derive.ts` marks a title removed only when *every* listing is). When
it reappears on Netflix, both available paths are blocked (E-5).

**Verified fix:** filter it, like the other two invariants, and lead with
`owner_id` per NFR-008 (which the current form also violates):

```sql
CREATE UNIQUE INDEX listing_one_per_service
  ON service_listing (owner_id, title_id, service) WHERE state = 'active';
```

Tested: the reappearance is then accepted, **and a genuine second active
Netflix listing is still rejected** — the invariant survives.

> **Decision needed:** confirm "at most one **active** listing per service" is
> the intended reading of I-2.

### D-2 — the `dup:` duplicate mechanism does not exist (E-4)

§16.4 says acknowledged duplicates use a `dup:<ulid>:` prefix on
`work_identity`, "the prefix the normalisation function already reserves". It
reserves no such prefix: `WORK_IDENTITY_RE` (`identity.ts:24`) rejects it, and
`title_match_coherent` rejects it at the database (E-4). `T-INV-016` tests for
a string that never appears, so it **passes vacuously**.

> **Decision needed:** either widen `work_identity`'s permitted forms, or add a
> separate `duplicate_ack_seq` column (with a non-null sentinel — see §1a).
> This is a schema decision, so it must be made now: §16.8 forbids
> non-additive migrations later.

### D-3 — `sourceImageIds` is an array; the column is a singular FK

Four sources say the relationship is many-to-many after intra-batch collapse:
§7.4/SD-02, the §4 cardinality table ("many-to-many after collapse"), named
test `T-AI-007` ("`sourceImageIds` holds both"), and the API response shape.
The DDL has `source_image_id` singular. A join table fixes it — but that is a
**tenth table**, and §16.0 asserts a "nine-table logical model".

> **Decision needed:** approve the tenth table (a pure join table), or rule
> that collapse does not merge provenance.

### D-4 — three batch-level extraction flags have no home anywhere

`degradedExtraction`, `crossCheck` and `lowYield` appear in `specs/ai.md` and
`specs/api.md` but in neither `UploadBatch` nor `upload_batch`.

⚠ **`degradedExtraction` forcing `computeRemovals: false` is a safety
property** — product invariant 2, "a failed extraction must never be misread as
a removal". If it is not persisted, a batch re-read from the database loses the
reason removals were withheld.

> **Decision needed:** confirm these persist. (`lowYield` may be derivable from
> the existing `extraction_stats` JSON; the other two are not derivable — they
> record which reader was available at extraction time.)

## 3. Gaps needing columns — no decision, just work

~33 fields the application must persist have no column. Full per-field evidence
(file:line, REQ id, consequence, proposed DDL) is in the audit; the headline
groups:

| Group | Missing | Why it matters |
|---|---|---|
| `extraction_candidate` | 13 fields incl. `cleanupVerdict`, `reviewDisposition`, `classification`, `resolvedWorkIdentity` | `GET /review` **partitions sections by these** and `PATCH /candidates/:id` mutates them — they cannot live in the `match_candidates` JSON blob or neither the filters nor the close-refusal predicate can be expressed in SQL |
| `uploaded_image` | `uploadedFormat`, `format`, `byteSize`, `width`, `height`, `candidateCount` | `uploadedFormat` vs `format` are two different facts under REQ-077/ADR-0008 — losing them loses the HEIC→PNG transcode provenance. `candidateCount` is **not** derivable: `null` (not run) vs `0` (found nothing) is US-006 AC-3 |
| `suppression` | `displaySnapshot` (4 flat columns), `migratedFrom` | Suppression is keyed on **work identity**, not a row (REQ-071), so there may be no `Title` to join to. Without the snapshot the suppressed view renders unidentifiable rows |
| `upload_batch` | `derivedFromBatchId`, `extractionStartedAt`, `undoneAt`, structured `extractionError` | `T-REX-012` asserts `derivedFromBatchId`; squashing the error into free-text `failure_reason` makes `IMAGES_PURGED` a prose string-match |
| `service_state` | `lastCompletedBatchId` | `GET /api/service-state` returns it; **REQ-039/FreshnessStrip** depends on it |
| `service_listing` | `heldBackByGroupId` | `T-GRP-012`; recomputable at undo time but lost forever afterwards |

`bounding_boxes` is also on the **wrong table** — it belongs on
`extraction_candidate` (each `BoundingBox` carries its own `imageId` precisely
because a collapsed candidate spans images). Moving it spends no extra JSON
budget.

**JSON-column budget is not breached by any of this:** 0 new JSON columns.
`displaySnapshot` is deliberately flattened to four columns, mirroring how
`TmdbMetadata` is already flattened into `tmdb_*`.

## 4. Not defects — recorded so they are not "fixed" later

- `Title.visible` — **abolished**, not merely derived. §15.5: "There is no
  `visible` column, no second pass, and no predicate for a future query to
  forget." Do not create it.
- `Title.tmdb` flattens 1:1 to the eight `tmdb_*` columns; `Title.listings` is
  the `service_listing` child table; `UploadBatch.provenance` is deliberately
  replaced by `batch_change` rows.
- Every `type` discriminator is the `OwnerDocument` union tag — a table *is* the
  discriminant. Never a column.
- `batch_change` legitimately has no TS type.
- `Title.state` and `sortDateAdded` are derived **and** stored, correctly: the
  filtered index and the default sort need them as columns.

## 5. Recommended order of work

1. Owner answers D-1 … D-4.
2. Apply E-1 and E-2 (settled).
3. Write the schema with the §3 columns added.
4. Keep the raw-SQL split: collation, filtered indexes, and `CHECK`
   constraints are not expressible in Prisma and belong in the migration SQL
   (§16.8). Every id column needs `@db.NVarChar(200)` or Prisma emits
   `NVARCHAR(1000)` and blows the 900-byte index-key cap.
5. Assert the E-1/E-2/E-3 defects in tests, so a regenerated schema cannot
   reintroduce them silently.
