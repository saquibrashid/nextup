-- 0018_streaming_forecast (#380, ADR-0010 Revision 3).
--
-- OWNER-APPROVED on 2026-09-24. Additive only: six nullable columns on
-- watch_intent and their CHECKs. Nothing is dropped, renamed or rewritten,
-- and no existing row is touched.
--
--   forecast_checked_at    when the forecast facts below were last read,
--                          NULL = never (drives the lazy refresh).
--   studio_company_ids     JSON array of TMDB production-company ids.
--   theatrical_release_on  US theatrical date, from TMDB.
--   digital_release_on     US rent/buy date, from TMDB.
--   announced_service      a SERVICES member a streaming date was announced
--                          for, via Watchmode.
--   announced_on           that announced date.
--
-- The estimate itself is NOT stored: it is computed on read from these facts,
-- so a revised studio map applies at once instead of waiting for a refresh.
-- The constraints that name the new columns run through EXEC, because SQL
-- Server compiles a batch before the ADD has created the column.

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  ALTER TABLE [dbo].[watch_intent] ADD
    [forecast_checked_at] DATETIME2 NULL,
    [studio_company_ids] NVARCHAR(MAX) NULL,
    [theatrical_release_on] DATE NULL,
    [digital_release_on] DATE NULL,
    [announced_service] NVARCHAR(40) NULL,
    [announced_on] DATE NULL;

  EXEC('ALTER TABLE [dbo].[watch_intent] WITH CHECK ADD CONSTRAINT [ck_intent_announced_service]
    CHECK ([announced_service] IS NULL OR [announced_service] IN (''netflix'',''max'',''prime-video'',''disney-plus'',''apple-tv-plus'',''paramount-plus'',''starz'',''peacock''))');
  EXEC('ALTER TABLE [dbo].[watch_intent] WITH CHECK ADD CONSTRAINT [ck_intent_announced_coherent]
    CHECK (([announced_service] IS NULL AND [announced_on] IS NULL)
        OR ([announced_service] IS NOT NULL AND [announced_on] IS NOT NULL))');
  EXEC('ALTER TABLE [dbo].[watch_intent] WITH CHECK ADD CONSTRAINT [ck_intent_studio_ids_json]
    CHECK ([studio_company_ids] IS NULL OR ISJSON([studio_company_ids]) = 1)');
  EXEC('ALTER TABLE [dbo].[watch_intent] WITH CHECK ADD CONSTRAINT [ck_intent_forecast_coherent]
    CHECK ([forecast_checked_at] IS NOT NULL
        OR ([studio_company_ids] IS NULL AND [theatrical_release_on] IS NULL
            AND [digital_release_on] IS NULL AND [announced_service] IS NULL))');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
