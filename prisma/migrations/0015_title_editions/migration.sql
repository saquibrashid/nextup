ALTER TABLE [dbo].[title] ADD [edition_labels] NVARCHAR(MAX) NOT NULL
    CONSTRAINT [df_title_editions] DEFAULT '[]';
ALTER TABLE [dbo].[extraction_candidate] ADD [corrected_display_edition] NVARCHAR(MAX) NULL;

EXEC(N'ALTER TABLE [dbo].[title] ADD CONSTRAINT [ck_title_editions_json]
CHECK (ISJSON([edition_labels]) = 1);');
EXEC(N'ALTER TABLE [dbo].[extraction_candidate] ADD CONSTRAINT [ck_candidate_edition_json]
CHECK ([corrected_display_edition] IS NULL OR ISJSON([corrected_display_edition]) = 1);');
