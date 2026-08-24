-- Epic M — the IMDb rating (REQ-088..095, ADR-0011).
--
-- Three columns on `title`: the IMDb id TMDB gives us, the rating OMDb gives
-- us for that id, and when that rating was read.
--
-- ── Additive only (§16.8, `T-MIG-001`) ──────────────────────────────────────
--
-- Nothing is dropped, renamed or rewritten. All three columns are nullable
-- with no backfill, because NULL is the true value for every existing row:
-- no rating has ever been read, and REQ-091 already requires "no rating" to
-- be a first-class displayable state rather than an error. There is no
-- placeholder to invent here and inventing one would be a lie a later refresh
-- could not distinguish from a real reading.

-- ── Why every statement after the ADDs is wrapped in EXEC() ─────────────────
--
-- `GO` is a SQLCMD batch separator, not T-SQL, and Prisma hands this file
-- straight to the driver. Without a batch boundary the whole file is compiled
-- before any of it runs, so every constraint naming a column added above
-- fails to compile against a table that does not have it yet. `EXEC('...')`
-- defers compilation of the inner statement to execution time. Same reasoning
-- as 0003; see that file for the verification note.

ALTER TABLE [title] ADD [imdb_id] NVARCHAR(20) NULL;
ALTER TABLE [title] ADD [imdb_rating_tenths] INT NULL;
ALTER TABLE [title] ADD [imdb_rating_fetched_at] DATETIME2 NULL;

-- ⚠ THE RATING IS STORED IN TENTHS, AS AN INTEGER, AND THAT IS DELIBERATE.
--
-- OMDb's `imdbRating` is always one decimal place ("8.8"). Stored as FLOAT it
-- round-trips as 8.800000000000001 and formats differently depending on which
-- layer does the formatting; stored as DECIMAL it arrives in the Prisma client
-- as a `Decimal` object that JSON-serialises to a string, quietly changing the
-- type of an API field. Tenths is exact, is a plain `number` everywhere, and
-- the one division belongs at the display edge.
--
-- 1..100 == 0.1..10.0. Zero is excluded on purpose: OMDb returns "N/A", not
-- "0", for a film with no rating, so a 0 here would mean a parse that turned
-- "unknown" into "the worst film ever made" — the exact failure `parseRating`
-- in `omdbClient.ts` refuses, asserted again here at the database boundary.
EXEC('ALTER TABLE [title] ADD CONSTRAINT [ck_title_imdb_rating_range]
      CHECK ([imdb_rating_tenths] IS NULL
             OR ([imdb_rating_tenths] >= 1 AND [imdb_rating_tenths] <= 100));');

-- ⚠ A RATING WITHOUT A TIMESTAMP CAN NEVER BE REFRESHED.
--
-- The lazy refresh (REQ-093) selects on age: `imdb_rating_fetched_at` older
-- than IMDB_RATING_MAX_AGE_DAYS. A row holding a rating but no timestamp is
-- therefore either permanently frozen or permanently re-fetched, depending on
-- which way the age predicate treats NULL — and both are silent. The pairing
-- is an invariant, so the database enforces it.
--
-- The converse is allowed and is a real state: a timestamp with no rating
-- records "we asked OMDb on this date and it had none", which is what stops
-- an unrated work being re-queried on every single render.
EXEC('ALTER TABLE [title] ADD CONSTRAINT [ck_title_imdb_rating_dated]
      CHECK ([imdb_rating_tenths] IS NULL OR [imdb_rating_fetched_at] IS NOT NULL);');

-- Defence in depth against a malformed id reaching an OMDb URL. `readImdbId`
-- in `tmdbClient.ts` already rejects anything that is not `tt` + 7 or more
-- digits; this makes a write path that bypassed it fail loudly at the store
-- rather than spend the daily OMDb budget on a request that cannot succeed.
-- SQL Server LIKE has no `+` quantifier, so seven digit classes plus a
-- trailing `%` expresses "at least seven".
EXEC('ALTER TABLE [title] ADD CONSTRAINT [ck_title_imdb_id_shape]
      CHECK ([imdb_id] IS NULL
             OR [imdb_id] LIKE ''tt[0-9][0-9][0-9][0-9][0-9][0-9][0-9]%'');');

-- ⚠ NO INDEX ON THE RATING, AND ITS ABSENCE IS THE SPEC.
--
-- Sorting or filtering the list by rating was considered and declined by the
-- owner (ADR-0011 OQ-A): the rating is display-only. An index here would exist
-- solely to serve a query product invariant 6 does not permit, and would be
-- read by a future contributor as permission to add one.
