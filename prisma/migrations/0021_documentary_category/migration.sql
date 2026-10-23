-- 0021_documentary_category (#456, PRD amendment A62, US-071 / REQ-137).
--
-- Documentary joins the owner-selectable display categories. Nothing about a
-- title is stored: Documentary is DERIVED at read time from the TMDB genres
-- already held in title.tmdb_genres (genre 99), so no column is added and no
-- row is touched. The only change is the owner override's allow-list:
-- watch_preference.category_override may now also hold 'documentary'.
--
-- ⚠ WIDENING ck_watch_preference_category WITHOUT DROPPING IT.
--
-- 0016's CHECK allows movie, tv and comedy-show. Replacing it needs DROP
-- CONSTRAINT, which T-MIG-001 forbids. Instead this installs
-- ck_watch_preference_category_v2 — the same rule plus 'documentary' — WITH
-- CHECK over every existing row, and only then disables (NOCHECK) the old
-- constraint, which stays in the catalog. The NOCHECK line is the one
-- statement T-MIG-001 pins for this file. The new CHECK is strictly a
-- superset, so nothing the old one refused becomes writable except the one
-- new value.
--
-- The constraint runs through EXEC for the same reason as 0016. No GO:
-- Prisma runs the file as one batch.

SET XACT_ABORT ON;

BEGIN TRY
  BEGIN TRANSACTION;

  EXEC(N'ALTER TABLE [dbo].[watch_preference] WITH CHECK ADD CONSTRAINT [ck_watch_preference_category_v2]
    CHECK ([category_override] IS NULL
        OR [category_override] IN (N''movie'', N''tv'', N''comedy-show'', N''documentary''))');

  ALTER TABLE [dbo].[watch_preference] NOCHECK CONSTRAINT [ck_watch_preference_category];

  COMMIT TRANSACTION;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  THROW;
END CATCH;
