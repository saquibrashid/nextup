-- Grant this environment's Container App managed identity access to its database.
--
-- TASK-141 · specs/security.md §7 · run ONCE per database.
--
-- WHY THIS IS NOT IN THE DEPLOY PIPELINE
-- -------------------------------------
-- `CREATE USER ... FROM EXTERNAL PROVIDER` can only be executed by a session
-- authenticated with Microsoft Entra — a SQL login cannot run it, because SQL
-- has to resolve the principal through Entra and only an Entra session is
-- authorised to ask. The deploy workflow authenticates to SQL with the SQL
-- ADMIN LOGIN (that is what applies migrations), so it structurally cannot
-- run this statement.
--
-- There IS a workaround — `CREATE USER [name] WITH SID = 0x…, TYPE = E`, which
-- skips the Entra lookup and therefore works from a SQL login. It is
-- deliberately NOT used here: it requires hand-converting the identity's
-- APPLICATION id (not its object/principal id — they differ, and ARM only
-- reports the latter) into little-endian SID bytes. Get that wrong and the
-- statement SUCCEEDS, creating a user mapped to a principal that does not
-- exist; nothing fails until the app tries to log in, and the error names a
-- login failure rather than a bad SID. A one-time statement run by the owner
-- has no such failure mode: Azure SQL resolves the principal itself.
--
-- HOW TO RUN
-- ----------
-- As the server's Entra administrator (see docs/runbooks/database-access.md),
-- against the TARGET DATABASE — not `master`.

-- ⚠ Set this to the Container App name for the database you are connected to:
--     nextup          → ca-nextup-prod
--     nextup_staging  → ca-nextup-staging
-- Pointing production's database at the staging identity would hand the
-- staging app the owner's real list, so the pairing matters.
DECLARE @app sysname = N'ca-nextup-prod';

IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = @app)
BEGIN
    -- Idempotent: re-running after a successful grant is a no-op rather than
    -- an error, so this is safe to paste again when in doubt.
    EXEC ('CREATE USER [' + @app + '] FROM EXTERNAL PROVIDER');
END

-- Least privilege (specs/security.md §7). READ and WRITE only.
--
-- ⚠ NOT db_owner, and NOT db_ddladmin. The application never changes the
-- schema: `prisma migrate deploy` does, and it runs in CI as the SQL admin —
-- a separate, more-privileged, DEPLOY-TIME principal. Granting DDL here would
-- mean a defect in request-handling code could drop a table, which is the one
-- thing REQ-028's soft-delete-forever rule cannot protect against.
EXEC ('ALTER ROLE db_datareader ADD MEMBER [' + @app + ']');
EXEC ('ALTER ROLE db_datawriter ADD MEMBER [' + @app + ']');

-- Verification. Expect one row per role.
SELECT
    dp.name         AS [principal],
    dp.type_desc    AS [type],
    r.name          AS [role]
FROM sys.database_role_members drm
JOIN sys.database_principals r  ON r.principal_id  = drm.role_principal_id
JOIN sys.database_principals dp ON dp.principal_id = drm.member_principal_id
WHERE dp.name = @app;
