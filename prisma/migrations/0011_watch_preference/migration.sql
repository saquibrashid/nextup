-- Owner preferences belong to a canonical work, not a replaceable title row.
-- No title foreign key, cascade, backfill, expiry or deletion.
CREATE TABLE [dbo].[watch_preference] (
  [owner_id] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [work_identity] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
  [watching] BIT NOT NULL CONSTRAINT [df_watch_preference_watching] DEFAULT 0,
  [priority] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL
    CONSTRAINT [df_watch_preference_priority] DEFAULT 'normal',
  CONSTRAINT [pk_watch_preference] PRIMARY KEY ([owner_id], [work_identity]),
  CONSTRAINT [ck_watch_preference_owner] CHECK (LEN([owner_id]) > 0),
  CONSTRAINT [ck_watch_preference_identity] CHECK (
    [work_identity] LIKE N'tmdb:movie:%' OR
    [work_identity] LIKE N'tmdb:tv:%' OR
    [work_identity] LIKE N'unmatched:%'
  ),
  CONSTRAINT [ck_watch_preference_priority] CHECK (
    ([priority] = N'normal' AND DATALENGTH([priority]) = 12) OR
    ([priority] IN (N'up-next', N'someday') AND DATALENGTH([priority]) = 14)
  )
);
