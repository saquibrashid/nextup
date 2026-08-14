-- TASK-047 — the `specs/data-model.md` §16.6 index set.
--
-- ⚠ §16.6 supersedes §15.6. §15.6 is the retained PostgreSQL chapter and
-- names a `pg_trgm` GIN index that MUST NOT be created here: Azure SQL Basic
-- has no trigram index, and search is a per-query `LIKE` instead (see
-- `searchRemovedListings` in the repository, and §16.6's "what is lost").
--
-- ── Why these are ADDED and nothing is replaced ──────────────────────────────
--
-- Four of the five overlap an index created by `0001_init`, and in three cases
-- the §16.6 form is strictly better. They are still ADDED rather than swapped,
-- because `T-MIG-001` fails the build on `DROP INDEX` — the additive-only rule
-- (§16.8). Retiring the narrower duplicates is an explicit, reviewed change,
-- not a side effect of a performance migration.
--
--   0001_init                                    §16.6
--   title_owner_state_sortdate                   title_list_default
--     (owner_id, state, sort_date_added)           + sort_date_added DESC, id ASC
--   service_listing_title                        listing_by_title
--     (title_id)                                   (owner_id, title_id)
--   batch_change_owner_batch                     batch_change_by_batch
--     (owner_id, batch_id)                         + kind
--   extraction_candidate_owner_batch_disposition candidate_by_batch
--     (owner_id, batch_id, review_disposition)     (owner_id, batch_id)
--
-- ⚠ `candidate_by_batch` is the one that is NOT an improvement: it is a strict
-- PREFIX of the init index, which already serves every seek it could serve, so
-- it buys nothing and costs a write. It is created because §16.6 is the
-- authoritative index set and a spec that looks wrong is a finding to report,
-- not something to quietly not build. Reported in `specs/testing.md` §23.

-- The list's default page, matching its ORDER BY exactly: newest first, ties
-- broken by id ascending (REQ-038, `T-LIST-016`). Including `id` in the key —
-- not merely as an implicit clustered-key lookup — is what lets the keyset
-- predicate `(sort_date_added, id) < (@d, @id)` resolve as one seek.
CREATE INDEX [title_list_default]
  ON [title] ([owner_id], [state], [sort_date_added] DESC, [id] ASC);

-- The removed view. A FILTERED index — the SQL Server analogue of a Postgres
-- partial index — so it stores only removed rows. That is what keeps the view
-- scale-invariant as history grows without bound (REQ-028 keeps every removal
-- for ever, so this index's selectivity IMPROVES over the product's life while
-- an unfiltered one would degrade).
CREATE INDEX [listing_removed_view]
  ON [service_listing] ([owner_id], [removed_at] DESC, [listing_id] ASC)
  WHERE [state] = 'removed';

-- Badge resolution for a page of titles. The init index is on `title_id`
-- alone, so every seek carried an owner_id residual predicate; owner-first
-- also matches the shape of every other query in this schema.
CREATE INDEX [listing_by_title]
  ON [service_listing] ([owner_id], [title_id]);

-- The batch-change ledger, read per batch and almost always narrowed by kind.
CREATE INDEX [batch_change_by_batch]
  ON [batch_change] ([owner_id], [batch_id], [kind]);

-- Review candidates for one batch.
CREATE INDEX [candidate_by_batch]
  ON [extraction_candidate] ([owner_id], [batch_id]);
