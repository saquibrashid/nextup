-- 0022_track_new_seasons (#454, PRD amendment A64, US-072 / REQ-138).
--
-- Additive only: four columns on watch_preference, two on watch_intent, and
-- their CHECKs. Nothing is dropped, renamed or rewritten, and no existing row
-- is touched (the one NOT NULL column carries a DEFAULT).
--
--   watch_preference.track_new_season  the owner's opt-in to hear about a new
--                                      season of a removed TV show.
--   watch_preference.season_checked_at when TMDB was last asked, NULL = never
--   watch_preference.season_number     the next announced season, NULL = none
--   watch_preference.season_air_on     its TMDB air date, NULL = none
--   watch_intent.season_number         set only when the intent was opened for
--   watch_intent.season_air_on         a new season of a removed show
--
-- None of these is a list column: no membership, ordering or badge reads them.
-- Constraints naming the new columns run through EXEC because SQL Server
-- compiles a batch before the ADD has created the column. No GO.

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  ALTER TABLE [dbo].[watch_preference] ADD
    [track_new_season] BIT NOT NULL CONSTRAINT [df_watch_preference_track_season] DEFAULT 0,
    [season_checked_at] DATETIME2 NULL,
    [season_number] INT NULL,
    [season_air_on] DATE NULL;

  ALTER TABLE [dbo].[watch_intent] ADD
    [season_number] INT NULL,
    [season_air_on] DATE NULL;

  EXEC('ALTER TABLE [dbo].[watch_preference] WITH CHECK ADD CONSTRAINT [ck_watch_preference_season_coherent]
    CHECK (([season_number] IS NULL AND [season_air_on] IS NULL)
        OR ([season_number] > 0 AND [season_air_on] IS NOT NULL AND [season_checked_at] IS NOT NULL))');
  EXEC('ALTER TABLE [dbo].[watch_intent] WITH CHECK ADD CONSTRAINT [ck_intent_season_coherent]
    CHECK (([season_number] IS NULL AND [season_air_on] IS NULL)
        OR ([season_number] > 0 AND [season_air_on] IS NOT NULL))');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
