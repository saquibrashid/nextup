-- 0019_library_availability (#397, #410, ADR-0010 Revision 4, PRD amendment A54).
--
-- OWNER-APPROVED on 2026-09-29. Additive only: five new columns on title, one
-- nullable column on watch_intent, and their CHECKs. Nothing is dropped,
-- renamed or rewritten, and no existing row is touched.
--
--   title.availability_checked_at   when the Library availability below was
--                                   last read, NULL = never (drives the lazy
--                                   on-access refresh, PRD §7.4 process 4).
--   title.available_on              JSON array of TMDB flatrate providers.
--                                   NULL = NOT KNOWN (ADR-0010 Trap 4).
--   title.rent_on                   JSON array of rent/buy storefronts.
--                                   NULL = not known. Never availability.
--   title.availability_region       explicit region, default 'US' (A49).
--   title.availability_kept_signature
--                                   the change the owner chose to Keep
--                                   ("left=starz;joined=netflix"). The marker
--                                   stays hidden until the provider set
--                                   produces a DIFFERENT signature.
--   watch_intent.moved_from_library_at
--                                   set only by the owner's "Move to Waiting".
--                                   The intent's discovery_source stays
--                                   'search' (batchless), because widening
--                                   ck_intent_source would need DROP
--                                   CONSTRAINT, which T-MIG-001 forbids.
--
-- None of these columns is a list column: no membership, ordering or badge
-- reads them. The constraints that name the new columns run through EXEC,
-- because SQL Server compiles a batch before the ADD has created the column.
-- No GO: Prisma runs the file as one batch.

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  ALTER TABLE [dbo].[title] ADD
    [availability_checked_at] DATETIME2 NULL,
    [available_on] NVARCHAR(MAX) NULL,
    [rent_on] NVARCHAR(MAX) NULL,
    [availability_region] NVARCHAR(8) NOT NULL CONSTRAINT [df_title_region] DEFAULT 'US',
    [availability_kept_signature] NVARCHAR(400) NULL;

  ALTER TABLE [dbo].[watch_intent] ADD [moved_from_library_at] DATETIME2 NULL;

  EXEC('ALTER TABLE [dbo].[title] WITH CHECK ADD CONSTRAINT [ck_title_available_on_json]
    CHECK ([available_on] IS NULL OR ISJSON([available_on]) = 1)');
  EXEC('ALTER TABLE [dbo].[title] WITH CHECK ADD CONSTRAINT [ck_title_rent_on_json]
    CHECK ([rent_on] IS NULL OR ISJSON([rent_on]) = 1)');
  EXEC('ALTER TABLE [dbo].[title] WITH CHECK ADD CONSTRAINT [ck_title_availability_coherent]
    CHECK ([availability_checked_at] IS NOT NULL
        OR ([available_on] IS NULL AND [rent_on] IS NULL))');
  EXEC('ALTER TABLE [dbo].[watch_intent] WITH CHECK ADD CONSTRAINT [ck_intent_moved_from_library_search]
    CHECK ([moved_from_library_at] IS NULL OR [discovery_source] = ''search'')');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
