-- Records the UPLOADED size of an image alongside the STORED size.
--
-- ── Why ─────────────────────────────────────────────────────────────────────
--
-- `uploaded_image.byte_size` is the STORED blob. For a HEIC upload that is the
-- lossless PNG transcode (REQ-077), which on the owner's own phone measured
-- 1.49 MiB -> 12.7 MiB and 1.76 MiB -> 17.8 MiB.
--
-- The per-batch ceiling (`MAX_BATCH_UPLOAD_BYTES`, 60 MiB, `specs/api.md` §5)
-- is an UPLOAD ceiling, but the route enforced it as
--
--     SUM(stored bytes already in the batch) + (uploaded bytes arriving)
--
-- which sums two different units. For HEIC that is wrong in both directions at
-- once: the arriving half is under-counted by the transcode ratio so the
-- ceiling never fires on the batch it exists to stop, and the already-held
-- half is inflated by the same ratio so a LATER request is refused with "a
-- batch holds at most 60 MiB" after roughly 7 MiB of files were sent.
--
-- Enforcing an upload ceiling requires a running total in the uploaded unit,
-- which is this column.
--
-- ── Additive only (§16.8, `T-MIG-001`) ──────────────────────────────────────
--
-- Nothing is dropped, renamed or rewritten. `byte_size` keeps its meaning and
-- its CHECK. Existing rows are backfilled from `byte_size` before the column
-- is made NOT NULL: every row written before this migration predates any HEIC
-- transcode reaching production, so for those rows uploaded == stored. That is
-- the true value, not a placeholder.

-- ── Why every statement after the ADD is wrapped in EXEC() ───────────────────
--
-- `GO` is a SQLCMD batch separator, not T-SQL. Prisma hands this file to the
-- driver, which rejects it with "Incorrect syntax near 'GO'" — verified by
-- running `prisma migrate deploy` against mssql/server:2022-latest, not
-- inferred. No other migration here uses it.
--
-- Removing `GO` alone is not enough: without a batch boundary the whole file
-- is compiled before any of it runs, so every statement naming
-- `uploaded_byte_size` fails to compile against a table that does not have it
-- yet. `EXEC('...')` defers compilation of the inner statement to execution
-- time, which is the batch boundary this file needs.

ALTER TABLE [uploaded_image] ADD [uploaded_byte_size] BIGINT NULL;

-- ⚠ THE BACKFILL IS CLAMPED, AND THE CLAMP IS LOAD-BEARING.
--
-- For a row that was never transcoded, stored == uploaded exactly, so
-- `byte_size` IS the true uploaded size and is already <= 10 MiB.
--
-- For a row that WAS transcoded (`uploaded_format` in heic/heif — REQ-077 is
-- already live in production), the uploaded size is unrecoverable: the source
-- HEIC was never persisted. `byte_size` there is the PNG, which measured
-- 12.7 MiB and 17.8 MiB on the owner's own phone. Backfilling it verbatim
-- writes a value that violates `ck_image_uploaded_byte_size_ceiling` and
-- FAILS THIS MIGRATION — verified by applying this file to a pre-0003
-- database holding a 17 MiB transcoded row, not reasoned about.
--
-- 10 MiB is the tight upper bound the API boundary already guaranteed for
-- those rows, so the clamp is the most accurate statement available, and it
-- errs high — which over-counts only batches that are long since closed.
EXEC('
UPDATE [uploaded_image]
SET [uploaded_byte_size] =
      CASE WHEN [byte_size] > 10485760 THEN 10485760 ELSE [byte_size] END
WHERE [uploaded_byte_size] IS NULL;');

EXEC('ALTER TABLE [uploaded_image] ALTER COLUMN [uploaded_byte_size] BIGINT NOT NULL;');

-- Mirrors `ck_image_byte_size`. A zero-byte upload is never legitimate: the
-- route rejects an empty part before ingest, so a 0 here means a write path
-- that bypassed the boundary.
EXEC('ALTER TABLE [uploaded_image] ADD CONSTRAINT [ck_image_uploaded_byte_size] CHECK ([uploaded_byte_size] > 0);');

-- The stored blob may legitimately exceed the 10 MiB upload ceiling; the
-- upload figure may not. 10 * 1024 * 1024 = 10485760, kept as a literal so the
-- constraint is readable in the database rather than only in TypeScript.
EXEC('ALTER TABLE [uploaded_image] ADD CONSTRAINT [ck_image_uploaded_byte_size_ceiling] CHECK ([uploaded_byte_size] <= 10485760);');