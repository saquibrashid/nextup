-- REQ-119 / REQ-035 / REQ-037 — a runtime of zero is UNKNOWN, structurally.
--
-- ── What CI proved ──────────────────────────────────────────────────────────
--
-- TMDB returns `runtime: 0` for works it has no runtime for, so `0` is a real
-- stored value, not a hypothetical. The application code was made to treat it
-- as unknown in three places — display (`formatRuntime`), filtering (the
-- `> 0` floor on the open-ended bucket) and counting (`countRuntimeUnknown`
-- matches `NULL` OR `<= 0`). All three passed their tests.
--
-- The FOURTH consumer, ORDERING, could not be fixed the same way, and
-- `T-API-019e` failed in CI on exactly that:
--
--   expected [ 'r-zero', 'r-045' ] to deeply equal [ 'r-045', 'r-zero' ]
--
-- A zero-runtime title sorted FIRST under "Shortest first" while every other
-- surface called it unknown. `ORDER BY` in SQL Server sees a number; there is
-- no `CASE` expression available through Prisma's `orderBy`, and rewriting the
-- list query as raw SQL would take it out of reach of `T-SEC-021`'s textual
-- `ownerId` check — trading a display defect for a tenancy one.
--
-- ── The fix is to delete the state, not to special-case it in a fourth place ─
--
-- Four consumers agreeing by convention is a rule that holds only while every
-- future reader remembers it. A fifth consumer would have to be told too, and
-- nothing would tell them. `NULL` already means unknown, is already handled
-- correctly by all four, and is already sorted last explicitly. So `0` simply
-- stops existing:
--
--   1. existing rows are normalised to `NULL`;
--   2. a CHECK constraint stops any new one arriving.
--
-- `clients/tmdbClient.ts#readRuntime` already normalises `<= 0` to `null` at
-- the TMDB boundary, so the constraint is not expected to fire in normal
-- operation. That is the point: it is the proof the boundary holds, and it
-- turns a silent ordering defect into a loud write failure.
--
-- ⚠ The `> 0` filter floor and the `<= 0` count predicate STAY. They are now
-- defence in depth rather than the primary rule, and they are what keeps the
-- two halves consistent if this constraint is ever relaxed. Removing them
-- because "zero cannot happen now" would make the next change that relaxes
-- the constraint silently wrong again.
--
-- ⚠ NON-DESTRUCTIVE. No column, table, index or constraint is dropped. The
-- UPDATE rewrites a metadata field that is DERIVED — `NFR-014`'s lazy refresh
-- overwrites it from TMDB on next access anyway — and it replaces a value that
-- every read path already renders as "Runtime unknown". No user-entered data
-- and no list membership is touched (REQ-028).

-- 1. Normalise the rows that already carry the unrepresentable value.
UPDATE [dbo].[title]
SET [tmdb_runtime_minutes] = NULL
WHERE [tmdb_runtime_minutes] <= 0;

-- 2. Stop another one being written. NULL passes: unknown is spelled NULL.
ALTER TABLE [dbo].[title]
  ADD CONSTRAINT [ck_title_runtime_positive]
  CHECK ([tmdb_runtime_minutes] IS NULL OR [tmdb_runtime_minutes] > 0);
