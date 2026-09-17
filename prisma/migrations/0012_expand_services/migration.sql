-- Owner-authorized service expansion: replace only the three service allow-lists.
-- Install trusted wider checks before removing restrictive checks; retain names.
-- NULL batch service still passes CHECK for discovery batches (0006).
SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  ALTER TABLE [dbo].[upload_batch] WITH CHECK ADD CONSTRAINT [ck_batch_service_expanded]
    CHECK ([service] IN ('netflix','max','prime-video','disney-plus','apple-tv-plus','paramount-plus','starz','peacock'));
  ALTER TABLE [dbo].[service_listing] WITH CHECK ADD CONSTRAINT [ck_listing_service_expanded]
    CHECK ([service] IN ('netflix','max','prime-video','disney-plus','apple-tv-plus','paramount-plus','starz','peacock'));
  ALTER TABLE [dbo].[service_state] WITH CHECK ADD CONSTRAINT [ck_state_service_expanded]
    CHECK ([service] IN ('netflix','max','prime-video','disney-plus','apple-tv-plus','paramount-plus','starz','peacock'));

  ALTER TABLE [dbo].[upload_batch] DROP CONSTRAINT [ck_batch_service];
  ALTER TABLE [dbo].[service_listing] DROP CONSTRAINT [ck_listing_service];
  ALTER TABLE [dbo].[service_state] DROP CONSTRAINT [ck_state_service];

  EXEC sp_rename N'dbo.ck_batch_service_expanded', N'ck_batch_service', N'OBJECT';
  EXEC sp_rename N'dbo.ck_listing_service_expanded', N'ck_listing_service', N'OBJECT';
  EXEC sp_rename N'dbo.ck_state_service_expanded', N'ck_state_service', N'OBJECT';

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
