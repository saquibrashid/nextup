-- 0023_watched_history (#325, #465, PRD amendment A66, US-074 / REQ-140).
--
-- Additive only: one new table and one new column. Nothing is dropped,
-- renamed or rewritten, and no existing row is touched (the one NOT NULL column
-- carries a DEFAULT).
--
--   watch_record                      the owner's viewing record, keyed on
--                                     canonical WORK IDENTITY (never a listing
--                                     or title row id), one row per movie or
--                                     per show season. A record is never
--                                     deleted: "not finished" clears the
--                                     `finished` bit and keeps the date and
--                                     rating.
--   watch_preference.library_hidden   the owner's confirmed "finished, take it
--                                     off my Library". A separate relation from
--                                     suppression and from the removal log: no
--                                     listing is touched, so the work can come
--                                     back by one deliberate tap.
--
-- No title foreign key and no cascade: the record outlives every title row,
-- removal and fix-match. The title name, year, type and poster are a display
-- snapshot so the history still reads when no title row remains.

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  CREATE TABLE [dbo].[watch_record] (
    [owner_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [work_identity] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [season_number] INT NOT NULL CONSTRAINT [df_watch_record_season] DEFAULT 0,
    [finished] BIT NOT NULL CONSTRAINT [df_watch_record_finished] DEFAULT 1,
    [watched_on] DATE NULL,
    [rating] TINYINT NULL,
    [title_name] NVARCHAR(500) NULL,
    [release_year] INT NULL,
    [media_type] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NULL,
    [poster_path] NVARCHAR(400) NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [df_watch_record_created] DEFAULT SYSUTCDATETIME(),
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [df_watch_record_updated] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [pk_watch_record] PRIMARY KEY ([owner_id], [work_identity], [season_number]),
    CONSTRAINT [ck_watch_record_owner] CHECK (LEN([owner_id]) > 0),
    CONSTRAINT [ck_watch_record_identity] CHECK (
      [work_identity] LIKE N'tmdb:movie:%' OR
      [work_identity] LIKE N'tmdb:tv:%' OR
      [work_identity] LIKE N'unmatched:%'
    ),
    CONSTRAINT [ck_watch_record_season] CHECK ([season_number] >= 0),
    CONSTRAINT [ck_watch_record_rating] CHECK ([rating] IS NULL OR [rating] BETWEEN 1 AND 5)
  );

  CREATE INDEX [watch_record_recent]
    ON [dbo].[watch_record] ([owner_id], [finished], [watched_on] DESC, [updated_at] DESC);

  ALTER TABLE [dbo].[watch_preference] ADD
    [library_hidden] BIT NOT NULL CONSTRAINT [df_watch_preference_library_hidden] DEFAULT 0;

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
