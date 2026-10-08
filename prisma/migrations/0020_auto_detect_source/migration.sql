-- 0020_auto_detect_source (#396, ADR-0010 Revision 6, PRD amendment A57).
--
-- Auto-detect import: the owner uploads WITHOUT naming a service, and each
-- extracted title's service is looked up from TMDB watch providers during
-- review, before commit. Additive: one column on upload_batch, seven nullable
-- columns on extraction_candidate, and their CHECKs. Nothing is dropped,
-- renamed or rewritten, and no existing row is touched.
--
--   upload_batch.auto_detect       1 = an auto-detect capture. BOTH service
--                                  and discovery_source are NULL: it has no
--                                  truthful single service and no storefront.
--
--   extraction_candidate.service_lookup_status
--                                  'found' | 'none' | 'unknown' | 'failed',
--                                  NULL = never looked up.
--   extraction_candidate.service_lookup_identity
--                                  the work the lookup answered for. A later
--                                  match correction makes the answer stale.
--   extraction_candidate.service_lookup_at
--   extraction_candidate.looked_up_available_on / looked_up_rent_on
--                                  the TMDB answer, JSON, so the close can
--                                  write it onto title the way Library
--                                  availability does (0019).
--   extraction_candidate.destination_kind / destination_services
--                                  the OWNER'S choice: 'services' + a JSON
--                                  list, or 'waiting'. NULL = follow the
--                                  looked-up proposal.
--
-- ⚠ WIDENING ck_batch_source_exclusive WITHOUT DROPPING IT.
--
-- 0006's ck_batch_source_exclusive says EXACTLY ONE of service and
-- discovery_source is set, and an auto-detect batch sets neither. Replacing it
-- the 0017 way needs DROP CONSTRAINT, which T-MIG-001 forbids. Instead this
-- installs ck_batch_source_kind — the SAME rule for every auto_detect = 0 row,
-- plus "both NULL" for auto_detect = 1 — WITH CHECK over every existing row,
-- and only then disables (NOCHECK) the old constraint, which stays in the
-- catalog. The NOCHECK line is the one statement T-MIG-001 pins for this file.
-- ck_batch_source_kind is strictly the old rule for every pre-#396 batch, so
-- nothing the old constraint refused becomes writable except the auto shape.
--
-- ⚠ ck_batch_auto_append_only is invariant 3 in the store: a full update is
-- scoped to ONE service, and an auto-detect batch has none. The API refuses
-- it first (T-AUTO-010); this is the independent second line.
--
-- The constraints naming the new columns run through EXEC, because SQL Server
-- compiles a batch before the ADD has created the column. No GO: Prisma runs
-- the file as one batch.

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  ALTER TABLE [dbo].[upload_batch] ADD
    [auto_detect] BIT NOT NULL CONSTRAINT [df_batch_auto_detect] DEFAULT 0;

  ALTER TABLE [dbo].[extraction_candidate] ADD
    [service_lookup_status] NVARCHAR(16) NULL,
    [service_lookup_identity] NVARCHAR(200) NULL,
    [service_lookup_at] DATETIME2 NULL,
    [looked_up_available_on] NVARCHAR(MAX) NULL,
    [looked_up_rent_on] NVARCHAR(MAX) NULL,
    [destination_kind] NVARCHAR(16) NULL,
    [destination_services] NVARCHAR(MAX) NULL;

  EXEC('ALTER TABLE [dbo].[upload_batch] WITH CHECK ADD CONSTRAINT [ck_batch_source_kind]
    CHECK (
        ([auto_detect] = 0 AND [service] IS NOT NULL AND [discovery_source] IS NULL)
     OR ([auto_detect] = 0 AND [service] IS NULL     AND [discovery_source] IS NOT NULL)
     OR ([auto_detect] = 1 AND [service] IS NULL     AND [discovery_source] IS NULL)
    )');
  EXEC('ALTER TABLE [dbo].[upload_batch] WITH CHECK ADD CONSTRAINT [ck_batch_auto_append_only]
    CHECK ([auto_detect] = 0 OR [mode] = ''append-only'')');

  ALTER TABLE [dbo].[upload_batch] NOCHECK CONSTRAINT [ck_batch_source_exclusive];

  EXEC('ALTER TABLE [dbo].[extraction_candidate] WITH CHECK ADD CONSTRAINT [ck_candidate_lookup_status]
    CHECK ([service_lookup_status] IS NULL
        OR [service_lookup_status] IN (''found'', ''none'', ''unknown'', ''failed''))');
  EXEC('ALTER TABLE [dbo].[extraction_candidate] WITH CHECK ADD CONSTRAINT [ck_candidate_lookup_coherent]
    CHECK (
        ([service_lookup_status] IS NULL AND [service_lookup_at] IS NULL
          AND [service_lookup_identity] IS NULL
          AND [looked_up_available_on] IS NULL AND [looked_up_rent_on] IS NULL)
     OR ([service_lookup_status] IS NOT NULL AND [service_lookup_at] IS NOT NULL
          AND [service_lookup_identity] IS NOT NULL)
    )');
  EXEC('ALTER TABLE [dbo].[extraction_candidate] WITH CHECK ADD CONSTRAINT [ck_candidate_looked_up_available_json]
    CHECK ([looked_up_available_on] IS NULL OR ISJSON([looked_up_available_on]) = 1)');
  EXEC('ALTER TABLE [dbo].[extraction_candidate] WITH CHECK ADD CONSTRAINT [ck_candidate_looked_up_rent_json]
    CHECK ([looked_up_rent_on] IS NULL OR ISJSON([looked_up_rent_on]) = 1)');
  EXEC('ALTER TABLE [dbo].[extraction_candidate] WITH CHECK ADD CONSTRAINT [ck_candidate_destination_kind]
    CHECK ([destination_kind] IS NULL OR [destination_kind] IN (''services'', ''waiting''))');
  EXEC('ALTER TABLE [dbo].[extraction_candidate] WITH CHECK ADD CONSTRAINT [ck_candidate_destination_coherent]
    CHECK (
        ([destination_kind] = ''services'' AND [destination_services] IS NOT NULL
          AND ISJSON([destination_services]) = 1)
     OR (([destination_kind] IS NULL OR [destination_kind] = ''waiting'')
          AND [destination_services] IS NULL)
    )');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
