# TASK-017 pre-implementation findings — §16.3 reconciliation

**Status: UNBLOCKED. All four owner decisions were made on 2026-08-12 and are
recorded in §2. `specs/data-model.md` §16.3/§16.4 must be corrected in place
(F-001 rule) before `prisma/schema.prisma` is written — the DDL as published
cannot execute (§1).**

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

## 2. Owner decisions — MADE (2026-08-12)

All four are settled. This section is now the authoritative record of what to
build; the reasoning is kept because each was a genuine trade-off.

| # | Decision | Ruling |
|---|---|---|
| **D-1** | I-2 filter | ✅ **Filter it.** `ON service_listing (owner_id, title_id, service) WHERE state = 'active'` |
| **D-2** | Acknowledged duplicates | ✅ **Separate `duplicate_ack_seq` column.** Do NOT widen `work_identity` |
| **D-3** | Candidate → image provenance | ✅ **Add the `candidate_source_image` join table** (a tenth table) |
| **D-4** | Extraction flags | ✅ **Persist all three** on `upload_batch` |

### D-1 — I-2 becomes a filtered unique index

`CREATE UNIQUE INDEX listing_one_per_service ON service_listing (owner_id, title_id, service) WHERE state = 'active';`

Unfiltered, I-2 forbade a title from *ever* having two listings on one service,
including one `removed` and one `active`. Because soft delete is forever, the
removed row occupies that pair permanently — so a work active on Max and
removed from Netflix could never reappear on Netflix (E-5: both the re-add path
and the new-title path were blocked).

Verified: with the filter, the reappearance is accepted **and a second genuinely
active Netflix listing is still rejected**. Also fixes an NFR-008 violation —
I-2 was the only index not leading with `owner_id`.

Consequence, accepted: many `removed` rows may accumulate for the same
`(title, service)`. That is intended — the removed view is a historical **log**,
not a recycle bin (product invariant 7).

### D-2 — a separate `duplicate_ack_seq` column, NOT a `dup:` identity prefix

```sql
-- on title:
duplicate_ack_seq NVARCHAR(200) COLLATE Latin1_General_100_BIN2
  NOT NULL CONSTRAINT df_title_dup_seq DEFAULT '',
-- and I-1 becomes:
CREATE UNIQUE INDEX title_one_active_per_work
  ON title (owner_id, work_identity, duplicate_ack_seq) WHERE state = 'active';
```

⚠ **The sentinel is `''`, not `NULL`.** Verified against SQL Server: two `NULL`s
compare **equal** in a unique index (second row rejected with `2601`), so a
nullable column would silently fail to permit the second row.

**Why not the `dup:<ulid>:` prefix §16.4 specifies:** suppression is keyed on
canonical **work identity** (REQ-071, product invariant 1). If the duplicate's
identity were `dup:01J8ZG:tmdb:movie:603` while the original's is
`tmdb:movie:603`, marking the work "not interested" would suppress one row and
**silently fail to suppress the other** — exactly the failure mode invariant 1
exists to prevent. Under this decision both rows keep the same `work_identity`,
so suppression matches both. The prefix also required changing
`WORK_IDENTITY_RE` and `title_match_coherent`, and was rejected by both (E-4).

⚠ **`T-INV-016` must be rewritten.** It currently greps for the `dup:` prefix,
a string that appears nowhere, so it passes vacuously. It should instead assert
that `duplicate_ack_seq` is set to a non-empty value only in
`createTitleAllowingDuplicate()`.

### D-3 — the `candidate_source_image` join table

```sql
CREATE TABLE candidate_source_image (
  owner_id     NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  candidate_id NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL
                 REFERENCES extraction_candidate(id),
  image_id     NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL
                 REFERENCES uploaded_image(id),
  ordinal      INT NOT NULL,   -- preserves the §7.4 (imageIndex, yTop, xLeft) order
  CONSTRAINT pk_candidate_source_image PRIMARY KEY (owner_id, candidate_id, image_id)
);
CREATE INDEX candidate_source_by_image ON candidate_source_image (owner_id, image_id);
```

The singular `source_image_id` FK contradicted four sources: the §4 cardinality
table ("many-to-many after collapse", `:790`), SD-02 ("the survivor **absorbs**
the losers", `:1014`), `T-AI-007` ("`sourceImageIds` holds both",
`testing.md:798`), and the API response shape.

**On §16.0's "nine-table logical model":** this adds no concept. It is a
physical table implementing a many-to-many that §4 already documents, which
previously had nowhere to live. Ten physical tables, nine logical entities.

### D-4 — persist all three extraction flags

```sql
-- on upload_batch:
degraded_extraction BIT NOT NULL CONSTRAINT df_batch_degraded DEFAULT 0,
low_yield           BIT NOT NULL CONSTRAINT df_batch_low_yield DEFAULT 0,
cross_check         NVARCHAR(20) NULL CONSTRAINT ck_batch_cross_check
                      CHECK (cross_check IS NULL OR
                             cross_check IN ('ok','ocr-unavailable','llm-unavailable')),
```

⚠ **This is a safety property, not bookkeeping.** `degradedExtraction` and
`lowYield` both force `computeRemovals: false` (`specs/ai.md:402-407`) — product
invariant 2, *a failed extraction must never be misread as a removal*, asserted
by `T-AI-036`. Extraction runs in one request and the review pass renders in a
later one, with the batch re-read from the database in between. **Unpersisted,
the review pass cannot know removals were withheld.**

`crossCheck` and `degradedExtraction` are not derivable at all — they record
which reader was available at extraction time, which nothing else records.

`lowYield` *is* derivable (`candidatesAfterCleanup === 0 || zeroYieldRatio >= 0.5`,
`ai.md:774`) but is stored anyway: its derivation depends on the tunable
`ZERO_YIELD_IMAGE_RATIO`, so deriving it on read would let a future tuning
silently rewrite the meaning of historical batches.

⚠ The matching TypeScript fields belong in `packages/domain/src/types.ts`, a
**contended file** — coordinator only, never a lane.

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

1. ~~Owner answers D-1 … D-4.~~ **Done, 2026-08-12 — see §2.**
2. Correct `specs/data-model.md` §16.3/§16.4 **in place** (F-001 rule:
   superseded text struck through *below* the correction, never a
   pointer-banner, because this is an instruction executed top-to-bottom):
   E-1 table order, E-2 the seven collations, E-3 `ISJSON(x, VALUE)`, D-1…D-4,
   the §3 columns, and `bounding_boxes` moving to `extraction_candidate`.
3. Also correct `specs/testing.md`: `:1439` says PostgreSQL `23505` (should be
   `2627`/`2601`, confirmed by execution) and `:1453` says "partial unique
   index" (SQL Server calls it *filtered*). Rewrite the vacuous `T-INV-016`
   per §2 D-2.
4. Write the schema with the §3 columns added.
5. Keep the raw-SQL split: collation, filtered indexes, and `CHECK`
   constraints are not expressible in Prisma and belong in the migration SQL
   (§16.8). Every id column needs `@db.NVarChar(200)` or Prisma emits
   `NVARCHAR(1000)` and blows the 900-byte index-key cap.
6. Assert the E-1/E-2/E-3 defects in tests, so a regenerated schema cannot
   reintroduce them silently. The integration harness **must** set
   `QUOTED_IDENTIFIER ON` (`sqlcmd -I`) or the filtered indexes will not be
   created and the invariant tests will pass while asserting nothing (§1a).
