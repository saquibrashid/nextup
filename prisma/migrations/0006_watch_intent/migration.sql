-- TASK-184 — `WatchIntent`: the works the owner wants that are on none of their
-- services (Epic L, ADR-0010, REQ-082 – REQ-087, `specs/data-model.md` §17).
--
-- ── Additive only (§16.8, `T-MIG-001`) ──────────────────────────────────────
--
-- One CREATE TABLE, one added column, one relaxed NOT NULL, and new CHECK
-- constraints. Nothing is dropped, renamed, truncated or backfilled.
--
-- ⚠ THE SPEC AND THE BACKLOG BOTH CALL THIS `0005_watch_intent`. It is `0006`:
-- TASK-085 took `0005_removal_decision` after Epic L was specified. Migrations
-- apply in filename order, so the number is not cosmetic.


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. A batch's source: EITHER a service OR a discovery source, never both.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ `ck_batch_service` IS NOT DROPPED, AND DOES NOT NEED TO BE.
--
-- A SQL Server CHECK rejects only a row it evaluates to FALSE. `[service] IN
-- ('netflix','max')` evaluates to UNKNOWN when `[service]` is NULL, which
-- PASSES. So relaxing the NOT NULL is sufficient on its own, and `T-MIG-001`'s
-- prohibition on `DROP CONSTRAINT` is respected rather than worked around.
--
-- ⚠ WHY `service` MUST BECOME NULLABLE RATHER THAN BORROW A VALUE.
--
-- The tempting shortcut is to store `'netflix'` on a Fandango capture and keep
-- the column NOT NULL. That would make every discovery batch a member of every
-- service-scoped query in the product: the combined list, the REQ-025 badge
-- count and full-update reconciliation all filter on this column. A discovery
-- batch has no truthful service (ADR-0010 D-1) and must not be given one.
ALTER TABLE [upload_batch] ALTER COLUMN [service] NVARCHAR(16) NULL;

-- ⚠ NOT A `SERVICES` MEMBER, AND NEVER TO BE WIDENED INTO ONE (ADR-0010 D-1).
-- `SERVICES` means "a subscription service whose saved list the owner
-- captures" and stays `('netflix','max')`, which is what keeps `listings`
-- capped at `SERVICES.length` and the badge count counting badges.
ALTER TABLE [upload_batch] ADD [discovery_source] NVARCHAR(64) NULL;

-- ── Why every statement below is wrapped in EXEC() ──────────────────────────
--
-- ⚠ THIS REPO HAS ALREADY BEEN BITTEN BY THIS TWICE (`0003`, `0004`).
--
-- `GO` is a SQLCMD batch separator, not T-SQL, and Prisma hands this file
-- straight to the driver. Without a batch boundary the whole file is compiled
-- before any of it runs, so every constraint naming the column added above
-- fails to compile against a table that does not have it yet — SQL Server
-- error 207, `Invalid column name 'discovery_source'`. `EXEC('...')` defers
-- compilation of its argument to execution time, which is the batch boundary
-- Prisma cannot otherwise express. Single quotes inside are doubled.
EXEC('ALTER TABLE [upload_batch] ADD CONSTRAINT [ck_batch_discovery_source]
  CHECK ([discovery_source] IS NULL OR [discovery_source] IN (''fandango-at-home''))');

-- Exactly one origin. Neither set is a batch with no provenance; both set is a
-- batch that is simultaneously a curated list and an editorial feed.
EXEC('ALTER TABLE [upload_batch] ADD CONSTRAINT [ck_batch_source_exclusive]
  CHECK (
      ([service] IS NOT NULL AND [discovery_source] IS NULL)
   OR ([service] IS NULL     AND [discovery_source] IS NOT NULL)
  )');

-- ⚠ D-2 ENFORCED IN THE STORE, NOT ONLY AT THE ROUTE.
--
-- `T-WAIT-001` asserts the API boundary refuses `full-update` for a discovery
-- source. This constraint is the second, independent line: a future route, a
-- repair script or a direct write cannot create the one batch shape that would
-- propose the owner's entire waiting list for removal on the next capture.
EXEC('ALTER TABLE [upload_batch] ADD CONSTRAINT [ck_batch_discovery_append_only]
  CHECK ([discovery_source] IS NULL OR [mode] = ''append-only'')');


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. `watch_intent` — `specs/data-model.md` §17.1
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠ THIS IS NOT A `service_listing`, AND REUSING ONE IS ADR-0010 TRAP 3.
-- A listing asserts "this work is on this service's saved list, added on this
-- date". An intent asserts the opposite: "the owner wants this and it is on no
-- service of theirs". It has no service, and its date is a DISCOVERY date.
CREATE TABLE [watch_intent] (
    [id]                      NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [owner_id]                NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [title_id]                NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    -- Denormalised for the suppression join, exactly as elsewhere (REQ-071).
    [work_identity]           NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    -- ⚠ A DISCOVERY DATE, NOT A DATE-ADDED. It must never feed the REQ-038
    -- title-level date sort, which is defined over `service_listing.date_added`
    -- (`T-WAIT-011`). The column is named to make the mistake visible in a diff.
    [discovered_at]           DATETIME2(3) NOT NULL CONSTRAINT [df_intent_discovered] DEFAULT SYSUTCDATETIME(),
    [source_batch_id]         NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [discovery_source]        NVARCHAR(64) NOT NULL,
    [state]                   NVARCHAR(16) NOT NULL,
    [satisfied_at]            DATETIME2(3),
    -- NULL = never checked. Drives the lazy refresh (REQ-086).
    [availability_checked_at] DATETIME2(3),
    -- ⚠ NULL ≠ "not streaming anywhere" — it means NOT KNOWN (ADR-0010 Trap 4).
    -- JSON array of provider identifiers reported `flatrate` for the region.
    [available_on]            NVARCHAR(MAX),
    -- ⚠ Explicit, never implicit (`T-AVAIL-010`). A hard-coded 'US' scattered
    -- through the availability path is unfindable the day it changes, and a
    -- stored value is the only way to tell an answer computed for one region
    -- from one computed for another.
    [availability_region]     NVARCHAR(8) NOT NULL CONSTRAINT [df_intent_region] DEFAULT 'US',
    CONSTRAINT [pk_watch_intent] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ck_intent_state] CHECK ([state] IN ('waiting','satisfied','suppressed')),
    CONSTRAINT [ck_intent_source] CHECK ([discovery_source] IN ('fandango-at-home')),
    CONSTRAINT [ck_intent_available_on_json] CHECK ([available_on] IS NULL OR ISJSON([available_on]) = 1),
    -- `satisfied_at` is set exactly when the state says it is. Without this the
    -- graduation path can leave a satisfied intent with no date, and the
    -- waiting view's "left on" column silently renders nothing.
    CONSTRAINT [ck_intent_satisfied_coherent] CHECK (
        ([state] = 'satisfied' AND [satisfied_at] IS NOT NULL)
     OR ([state] <> 'satisfied' AND [satisfied_at] IS NULL)
    ),
    -- Availability is a cache with an as-of date; a value without its date
    -- cannot be rendered honestly (Trap 4) and must not exist.
    CONSTRAINT [ck_intent_availability_coherent] CHECK (
        [available_on] IS NULL OR [availability_checked_at] IS NOT NULL
    )
);

-- NO ACTION on both edges, matching every other FK in this schema: a cascading
-- delete is a hard-delete mechanism, and REQ-028 does not permit one.
ALTER TABLE [watch_intent]
  ADD CONSTRAINT [fk_intent_title]
  FOREIGN KEY ([title_id]) REFERENCES [title]([id]) ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE [watch_intent]
  ADD CONSTRAINT [fk_intent_batch]
  FOREIGN KEY ([source_batch_id]) REFERENCES [upload_batch]([id]) ON UPDATE NO ACTION ON DELETE NO ACTION;

-- ⚠ FILTERED to `state = 'waiting'` — one OPEN intent per work, while still
-- allowing a historical satisfied row and a later re-discovery of the same
-- work. Unfiltered, the second discovery of a work the owner already watched
-- would fail to insert, and the feature would appear to "forget" titles.
CREATE UNIQUE INDEX [ux_intent_owner_title_waiting]
  ON [watch_intent] ([owner_id], [title_id])
  WHERE [state] = 'waiting';

-- The refresh query is "waiting intents for this owner whose check is older
-- than WATCH_PROVIDER_MAX_AGE_DAYS". Without this it table-scans, and the
-- waiting view's open gets slower with every title the owner ever discovered.
CREATE INDEX [ix_intent_owner_state_checked]
  ON [watch_intent] ([owner_id], [state], [availability_checked_at]);

-- ⚠ NO TTL, NO SCHEDULED DELETION, HERE OR ANYWHERE (§17.4, REQ-028).
-- A satisfied or suppressed intent is retained forever. `T-INV-012` must still
-- show exactly one sanctioned hard delete after this epic ships, and
-- `T-MIG-001` fails the build on any DROP/TRUNCATE added later.
