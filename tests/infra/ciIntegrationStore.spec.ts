import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../..');
const ci = readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');

// Comments stripped for the checks that assert something is PRESENT in the
// executed workflow. `ci.yml` documents its own traps at length — the sqlcmd
// path, the `-C` flag, the collation — so a naive substring search finds every
// required string inside the comment that explains why it is required, and
// passes on a workflow that no longer does any of it.
const ciCode = ci
  .split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');

/**
 * `T-INFRA-006` (`specs/testing.md` §11.2 R4, §3.3a) — the integration store is
 * provisioned the way §3.3a specifies, and the explicit readiness wait is still
 * there.
 *
 * ⚠ WHY A STATIC TEST AND NOT "THE INTEGRATION JOB PASSES". The failure this
 * guards is a FLAKY gate, which `NFR-003` forbids outright, and a flaky gate is
 * green most of the time by definition. Dropping the wait step does not fail
 * CI — it fails CI roughly one run in five, on a cold runner, with a connection
 * error that reads like an application bug. The only moment that regression is
 * cheap to catch is in the diff that introduces it, which is what this asserts.
 *
 * ⚠ THE `sqlcmd` PATH IS THE TRAP THIS FILE EXISTS FOR. `/opt/mssql-tools18/bin/`
 * exists INSIDE the mssql image and nowhere on an `ubuntu-24.04` runner, and
 * `sqlcmd` refuses every connection without `-C` because the server presents a
 * self-signed certificate. A health command copied from a blog post that omits
 * `-C`, or a wait step that calls the binary directly on the runner instead of
 * through `docker exec`, never becomes ready — and the job then fails on a
 * timeout that says nothing about either cause.
 */
describe('T-INFRA-006 · the CI integration store matches specs/testing.md §3.3a', () => {
  it('T-INFRA-006a: the mssql service container is the pinned image with its required env', () => {
    expect(ciCode).toContain('image: mcr.microsoft.com/mssql/server:2022-latest');
    // ⚠ NOT postgres. The datastore moved Cosmos → PostgreSQL → Azure SQL
    // (ADR-0005 Rev 3) and superseded sections of several specs still name
    // `postgres:16-alpine`. Asserting the absence keeps a copy-paste from a
    // dead section out of the workflow.
    expect(ciCode).not.toContain('postgres:16-alpine');
    expect(ciCode).toMatch(/ACCEPT_EULA:\s*'Y'/);
    expect(ciCode).toMatch(/MSSQL_PID:\s*'Developer'/);
    expect(ciCode).toContain('MSSQL_SA_PASSWORD');
  });

  it('T-INFRA-006b: the health command uses the in-image sqlcmd path WITH -C', () => {
    const health = ciCode.split('\n').find((l) => l.includes('--health-cmd'));
    expect(health, 'no --health-cmd on the mssql service').toBeDefined();
    expect(health).toContain('/opt/mssql-tools18/bin/sqlcmd');
    // ⚠ `-C` is trust-server-certificate. Without it every probe fails on the
    // self-signed cert and the container is never reported healthy.
    expect(health).toMatch(/sqlcmd\s+-C\b/);
  });

  it('T-INFRA-006c: the EXPLICIT wait step still exists — the anti-flake half', () => {
    // Service-container health alone has raced in practice, which is why
    // §3.3a requires a wait step in addition to it. This is the assertion
    // whose deletion the spec calls out by name.
    const waitStep = ciCode.includes('SQL Server is ready');
    expect(waitStep, 'the explicit SQL Server readiness wait step is gone').toBe(true);
    expect(ciCode).toContain('SQL Server did not become ready');
  });

  it('T-INFRA-006d: the wait reaches sqlcmd through docker exec, never on the runner', () => {
    // The named half of the spec row. `/opt/mssql-tools18/bin/sqlcmd` does not
    // exist on `ubuntu-24.04`, so every direct call is a guaranteed timeout.
    const lines = ciCode.split('\n').filter((l) => l.includes('/opt/mssql-tools18/bin/sqlcmd'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      const viaDocker = line.includes('docker exec');
      const isHealthCmd = line.includes('--health-cmd');
      expect(
        viaDocker || isHealthCmd,
        `sqlcmd is called directly on the runner, where it does not exist: ${line.trim()}`,
      ).toBe(true);
    }
  });

  it('T-INFRA-006e: the database is created BIN2 and with QUOTED_IDENTIFIER on', () => {
    // Both are load-bearing and both fail silently rather than loudly:
    // a CI_AS database fails every Prisma create() with Msg 468, and a missing
    // `-I` means the three filtered unique indexes are never created, so
    // `T-INV-001`/`002`/`015` pass while asserting nothing.
    expect(ciCode).toContain('COLLATE Latin1_General_100_BIN2');
    expect(ciCode).toMatch(/sqlcmd\s+-C\s+-I\b/);
  });

  it('T-INFRA-006f: migrations are applied by the job, never by the suite', () => {
    // §3.3a. A suite that migrates itself cannot distinguish "the migration is
    // broken" from "the test is broken", and `prisma migrate dev` — which
    // generates the DROP statements `T-MIG-001` forbids — must never run here.
    expect(ciCode).toContain('prisma migrate deploy');
    expect(ciCode).not.toContain('prisma migrate dev');
  });
});
