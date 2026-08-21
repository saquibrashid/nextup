/**
 * TASK-141 — Azure SQL connection settings and the managed-identity path.
 *
 * `T-SEC-035` is a NEW id, minted because `T-SEC-028` — which TASK-141's row
 * cites for the token-refresh assertion — was already defined and implemented
 * as something else entirely (`specs/testing.md` §9 line 744: "every domain
 * type declares required `ownerId`"). `specs/testing.md` already records that
 * collision as a known class of defect; reusing the id would have meant one of
 * the two meanings silently losing its coverage.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  authModeFor,
  buildMssqlConfig,
  createSqlAdapter,
  describeConnection,
  parseSqlServerUrl,
} from '../../src/db/connection.js';

const PROD_URL = 'sqlserver://sql-nextup.database.windows.net:1433;database=nextup;encrypt=true';
const CI_URL =
  'sqlserver://localhost:1433;database=nextup_test;user=sa;password=pw-test-fixture-only;encrypt=true;trustServerCertificate=true';

describe('T-SEC-035 · Azure SQL connection settings (TASK-141)', () => {
  /* ---------------------------------------------------------------- *
   * Parsing. Prisma's sqlserver URL is NOT a standard URL.
   * ---------------------------------------------------------------- */

  it('T-SEC-035a · parses server, port and database from a credential-free URL', () => {
    const settings = parseSqlServerUrl(PROD_URL);
    expect(settings.server).toBe('sql-nextup.database.windows.net');
    expect(settings.port).toBe(1433);
    expect(settings.database).toBe('nextup');
    expect(settings.user).toBeUndefined();
    expect(settings.password).toBeUndefined();
  });

  it('T-SEC-035b · parses a URL that carries a SQL login', () => {
    const settings = parseSqlServerUrl(CI_URL);
    expect(settings.user).toBe('sa');
    expect(settings.password).toBe('pw-test-fixture-only');
    expect(settings.trustServerCertificate).toBe(true);
  });

  it('T-SEC-035c · defaults the port to 1433 when the URL omits it', () => {
    expect(parseSqlServerUrl('sqlserver://host;database=nextup').port).toBe(1433);
  });

  it('T-SEC-035d · defaults encrypt to TRUE when the URL omits it', () => {
    // Defaulting the other way would let a URL that simply says nothing about
    // encryption downgrade the transport, with no error anywhere.
    expect(parseSqlServerUrl('sqlserver://host;database=nextup').encrypt).toBe(true);
  });

  it('T-SEC-035e · defaults trustServerCertificate to FALSE when omitted', () => {
    expect(parseSqlServerUrl('sqlserver://host;database=nextup').trustServerCertificate).toBe(
      false,
    );
  });

  it('T-SEC-035f · honours a brace-quoted value containing a semicolon', () => {
    // Prisma brace-quotes values with reserved characters. Splitting naively on
    // ';' truncates such a password to a prefix, and the resulting login
    // failure names nothing about quoting.
    const settings = parseSqlServerUrl(
      'sqlserver://host:1433;database=nextup;user=sa;password={a;b=c}',
    );
    expect(settings.password).toBe('a;b=c');
    expect(settings.database).toBe('nextup');
  });

  it('T-SEC-035g · treats parameter names case-insensitively', () => {
    const settings = parseSqlServerUrl(
      'sqlserver://host;Database=nextup;TrustServerCertificate=true',
    );
    expect(settings.database).toBe('nextup');
    expect(settings.trustServerCertificate).toBe(true);
  });

  it('T-SEC-035h · rejects a URL that is not a sqlserver:// URL', () => {
    expect(() => parseSqlServerUrl('postgresql://host/nextup')).toThrow(/sqlserver:\/\//);
  });

  it('T-SEC-035i · rejects a URL that names no database', () => {
    expect(() => parseSqlServerUrl('sqlserver://host:1433;encrypt=true')).toThrow(/no database/);
  });

  it('T-SEC-035j · rejects a non-numeric port rather than silently using 1433', () => {
    expect(() => parseSqlServerUrl('sqlserver://host:abc;database=nextup')).toThrow(/port/);
  });

  /* ---------------------------------------------------------------- *
   * Auth mode is DERIVED, never configured separately.
   * ---------------------------------------------------------------- */

  it('T-SEC-035k · a URL with a credential means the SQL-login path', () => {
    expect(authModeFor(parseSqlServerUrl(CI_URL))).toBe('sql-login');
  });

  it('T-SEC-035l · a URL with NO credential means the managed-identity path', () => {
    expect(authModeFor(parseSqlServerUrl(PROD_URL))).toBe('managed-identity');
  });

  it('T-SEC-035m · a user with no password is the managed-identity path, not a half-login', () => {
    const settings = parseSqlServerUrl('sqlserver://host;database=nextup;user=someone');
    expect(authModeFor(settings)).toBe('managed-identity');
  });

  it('T-SEC-035n · an EMPTY user/password is absent, not a credential', () => {
    // A deploy that substitutes an unset secret produces `user=;password=`.
    // Reading that as a SQL login would attempt an anonymous login and fail
    // with an authentication error that names the wrong cause.
    const settings = parseSqlServerUrl('sqlserver://host;database=nextup;user=;password=');
    expect(authModeFor(settings)).toBe('managed-identity');
  });

  /* ---------------------------------------------------------------- *
   * The mssql configuration.
   * ---------------------------------------------------------------- */

  it('T-SEC-035o · the managed-identity path sets azure-active-directory-default', () => {
    const config = buildMssqlConfig(parseSqlServerUrl(PROD_URL));
    expect(config.authentication?.type).toBe('azure-active-directory-default');
    expect(config.user).toBeUndefined();
    expect(config.password).toBeUndefined();
  });

  it('T-SEC-035p · the managed-identity path NEVER uses a pinned access token', () => {
    // ⚠ THE TRAP TASK-141 NAMES. `azure-active-directory-access-token` takes a
    // token STRING, so the process fetches one at startup and reuses it for the
    // life of the pool: it works all day and starts failing about an hour after
    // deploy. `-default` hands the CREDENTIAL to the driver, which calls it per
    // connection, so no token lifetime exists for this code to get wrong.
    const config = buildMssqlConfig(parseSqlServerUrl(PROD_URL));
    expect(config.authentication?.type).not.toBe('azure-active-directory-access-token');
  });

  it('T-SEC-035q · the SQL-login path carries the credential and sets no Entra auth', () => {
    const config = buildMssqlConfig(parseSqlServerUrl(CI_URL));
    expect(config.user).toBe('sa');
    expect(config.authentication).toBeUndefined();
  });

  it('T-SEC-035r · encrypt and trustServerCertificate reach the driver options', () => {
    const config = buildMssqlConfig(parseSqlServerUrl(CI_URL));
    expect(config.options?.encrypt).toBe(true);
    expect(config.options?.trustServerCertificate).toBe(true);

    const prod = buildMssqlConfig(parseSqlServerUrl(PROD_URL));
    expect(prod.options?.trustServerCertificate).toBe(false);
  });

  it('T-SEC-035s · idle connections drain, so every reconnection re-authenticates', () => {
    // This is the token-refresh property, and it is structural rather than
    // timed. An Entra token is acquired during LOGIN, so a connection that is
    // never closed never re-authenticates. `min: 0` lets the pool drain, and
    // each new connection acquires a fresh token through the credential.
    const config = buildMssqlConfig(parseSqlServerUrl(PROD_URL));
    expect(config.pool?.min).toBe(0);
    expect(config.pool?.max).toBeLessThanOrEqual(5);
  });

  it('T-SEC-035t · the connection module hard-codes NO token lifetime', () => {
    // TASK-141's acceptance criterion, asserted against the source rather than
    // behaviour: any refresh timer here would be a guess at a lifetime the
    // identity provider owns and may change.
    const source = readFileSync(
      fileURLToPath(new URL('../../src/db/connection.ts', import.meta.url)),
      'utf8',
    );
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\b(3600|3599|3600000|1800|86400)\b/);
    expect(code).not.toMatch(/setTimeout|setInterval|expiresOn|refreshToken/);
  });

  /* ---------------------------------------------------------------- *
   * Logging and the factory.
   * ---------------------------------------------------------------- */

  it('T-SEC-035u · the describe helper never reveals the credential', () => {
    const described = describeConnection(parseSqlServerUrl(CI_URL));
    expect(described).not.toContain('pw-test-fixture-only');
    expect(described).toContain('nextup_test');
    expect(described).toContain('sql-login');
  });

  it('T-SEC-035v · createSqlAdapter returns a sqlserver driver-adapter factory', () => {
    const adapter = createSqlAdapter(PROD_URL);
    expect(adapter.provider).toBe('sqlserver');
    expect(typeof adapter.connect).toBe('function');
  });

  it('T-SEC-035w · createSqlAdapter surfaces a bad URL as a configuration error', () => {
    expect(() => createSqlAdapter('sqlserver://host;encrypt=true')).toThrow(/no database/);
  });
});
