-- 0017_waiting_to_stream (#378, ADR-0010 Revision 2).
--
-- OWNER-APPROVED on 2026-09-24: widen the two discovery-source CHECKs to the
-- rental storefronts, and let a WatchIntent exist without a capture batch so
-- a single title can be added to Waiting to stream by search.
--
-- This file is pinned by path and SHA-256 in tools/check-migrations.ts, like
-- 0012. The two DROP CONSTRAINT lines are the only destructive statements it
-- may hold, and each drops a CHECK only AFTER its trusted, wider replacement
-- is installed WITH CHECK, inside one transaction. Nothing else is dropped,
-- renamed or rewritten, and no row is touched.
--
-- Additive columns:
--   rent_on          JSON array of rent/buy providers, NULL = not known.
--   streaming_since  when a subscription offer was first seen, NULL = none.
-- The constraints that name them run through EXEC, because SQL Server
-- compiles a batch before the ADD has created the column. No GO: Prisma
-- sends this file to the driver as one batch.

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  ALTER TABLE [dbo].[upload_batch] WITH CHECK ADD CONSTRAINT [ck_batch_discovery_source_expanded]
    CHECK ([discovery_source] IS NULL OR [discovery_source] IN
('fandango-at-home','apple-tv-store','prime-video-store','google-tv-store'));
  ALTER TABLE [dbo].[watch_intent] WITH CHECK ADD CONSTRAINT [ck_intent_source_expanded]
    CHECK ([discovery_source] IN
('fandango-at-home','apple-tv-store','prime-video-store','google-tv-store','search'));

  ALTER TABLE [dbo].[upload_batch] DROP CONSTRAINT [ck_batch_discovery_source];
  ALTER TABLE [dbo].[watch_intent] DROP CONSTRAINT [ck_intent_source];

  EXEC sp_rename N'dbo.ck_batch_discovery_source_expanded', N'ck_batch_discovery_source', N'OBJECT';
  EXEC sp_rename N'dbo.ck_intent_source_expanded', N'ck_intent_source', N'OBJECT';

  ALTER TABLE [dbo].[watch_intent] ALTER COLUMN [source_batch_id]
    NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NULL;

  ALTER TABLE [dbo].[watch_intent] ADD [rent_on] NVARCHAR(MAX) NULL, [streaming_since] DATETIME2(3) NULL;

  EXEC('ALTER TABLE [dbo].[watch_intent] WITH CHECK ADD CONSTRAINT [ck_intent_source_batch_coherent]
    CHECK (
        ([discovery_source] = ''search'' AND [source_batch_id] IS NULL)
     OR ([discovery_source] <> ''search'' AND [source_batch_id] IS NOT NULL)
    )');
  EXEC('ALTER TABLE [dbo].[watch_intent] WITH CHECK ADD CONSTRAINT [ck_intent_rent_on_json]
    CHECK ([rent_on] IS NULL OR ISJSON([rent_on]) = 1)');
  EXEC('ALTER TABLE [dbo].[watch_intent] WITH CHECK ADD CONSTRAINT [ck_intent_rent_on_coherent]
    CHECK ([rent_on] IS NULL OR [availability_checked_at] IS NOT NULL)');

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
