ALTER TABLE [dbo].[title] ADD [tmdb_presentation] NVARCHAR(MAX) NULL;

EXEC(N'ALTER TABLE [dbo].[title] ADD CONSTRAINT [ck_title_presentation_json]
CHECK ([tmdb_presentation] IS NULL OR ISJSON([tmdb_presentation]) = 1);');
