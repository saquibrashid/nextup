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

/**
 * `T-AVAIL-012` — a database that is WAKING UP must not be reported as a
 * database that is BROKEN.
 *
 * ⚠ THIS IS A REGRESSION TEST FOR A LIVE INCIDENT, NOT A HYPOTHETICAL.
 * The staging database is Azure SQL serverless with `autoPauseDelay = 60`; it
 * is auto-paused ON PURPOSE (ADR-0003 Rev 3) so that an idle deployment bills
 * nothing. The first request after a pause TRIGGERS a resume that takes
 * roughly 30-60 seconds, and everything arriving during that window is
 * refused. `mssql` defaults `connectionTimeout` to 15000 ms, which is shorter
 * than the resume — so the pool gave up before the database was ever ready,
 * every time, and the owner saw "Couldn't load your list. Nothing has changed."
 * above a Retry button that could not work, because each retry hit the same
 * 15-second wall.
 *
 * Observed 2026-09-18: `resumedDate` 12:54:34Z; `titles`, `serviceState` and
 * `suppressions` all failing "Failed to connect ... in 15000ms" from 12:54:36
 * until 12:55:44, then recovering with no intervention.
 *
 * ⚠ "Nothing has changed" IS INDISTINGUISHABLE FROM DATA LOSS to the person
 * reading it. That is why a cold-start false alarm is not a cosmetic problem
 * in this product specifically.
 */
describe('T-AVAIL-012 a resuming serverless database is waited for, not failed', () => {
  it('T-AVAIL-012a · the connect timeout outlasts an Azure SQL serverless resume', () => {
    const config = buildMssqlConfig(parseSqlServerUrl(PROD_URL));

    // 15000 is the `mssql` default and the measured failure. Asserting
    // "greater than the default" rather than an exact number keeps this a test
    // of the PROPERTY — outlasting a resume — instead of a restatement of the
    // constant, which would pass for any value including a worse one.
    expect(config.connectionTimeout).toBeGreaterThan(15_000);

    // A published Azure SQL serverless resume is typically 30-60s, so anything
    // at or under 30s would still lose the race it was raised to win.
    expect(config.connectionTimeout).toBeGreaterThanOrEqual(60_000);
  });

  it('T-AVAIL-012b · the pool waits LONGER than a single connection may take', () => {
    // ⚠ WITHOUT THIS ORDERING, 012a BUYS NOTHING. `mssql` defaults the pool's
    // acquire timeout to 60000 ms — the same value the connect timeout is
    // raised to — so a connection still being established near the limit races
    // the pool giving up on waiting for it, and the caller gets a pool timeout
    // that says nothing about a resuming database. The inner timeout must
    // always be the one that reports.
    const config = buildMssqlConfig(parseSqlServerUrl(PROD_URL));

    expect(config.pool?.acquireTimeoutMillis).toBeGreaterThan(config.connectionTimeout as number);
  });

  it('T-AVAIL-012c · the timeouts apply on the managed-identity path too', () => {
    // The managed-identity branch returns EARLY from `buildMssqlConfig` on the
    // SQL-login path, so a timeout added to only one branch is a live
    // possibility rather than a contrived one — and staging, the database that
    // actually pauses, is the managed-identity one.
    const mi = buildMssqlConfig(parseSqlServerUrl(PROD_URL));
    const login = buildMssqlConfig(parseSqlServerUrl(CI_URL));

    expect(mi.authentication?.type).toBe('azure-active-directory-default');
    expect(login.authentication).toBeUndefined();

    // ⚠ ASSERTED AS DEFINED FIRST. An equality check alone is satisfied by
    // `undefined === undefined`, so with the timeouts removed entirely this
    // test would report PASS while 012a and 012b failed — a parity test that
    // agrees the two paths are equally broken.
    expect(login.connectionTimeout).toBeTypeOf('number');
    expect(login.pool?.acquireTimeoutMillis).toBeTypeOf('number');

    expect(login.connectionTimeout).toBe(mi.connectionTimeout);
    expect(login.pool?.acquireTimeoutMillis).toBe(mi.pool?.acquireTimeoutMillis);
  });
});
