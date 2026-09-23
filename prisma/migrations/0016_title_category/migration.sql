ALTER TABLE [title] ADD [tmdb_comedy_show] BIT NULL;
ALTER TABLE [title] ADD [category_checked_at] DATETIME2 NULL;
ALTER TABLE [watch_preference] ADD [category_override] NVARCHAR(16) COLLATE Latin1_General_100_BIN2 NULL;
ALTER TABLE [watch_preference] ADD CONSTRAINT [ck_watch_preference_category]
  CHECK ([category_override] IS NULL OR [category_override] IN (N'movie', N'tv', N'comedy-show'));
