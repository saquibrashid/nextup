/**
 * `T-MIG-002` (`specs/testing.md` §11-R4.2, TASK-141) — the `M0` smoke
 * migration, and the concrete `RSK-031` mitigation.
 *
 * `RSK-031` is that `Prisma` + `provider = "sqlserver"` cannot in fact migrate
 * this schema, or cannot authenticate to it — a risk that would invalidate
 * `ADR-0005 Rev 3` and every task built on it. The mitigation is to prove it
 * end to end **before** feature work rather than to discover it half a backlog
 * later, so these assertions are deliberately the cheapest possible ones:
 * `prisma migrate deploy` applied every committed migration, and `SELECT 1`
 * round-trips over the same connection the application uses.
 *
 * ⚠ WHY THIS IS NOT REDUNDANT WITH "THE INTEGRATION JOB IS GREEN". CI applies
 * migrations in a job step, and a job step that silently applied only SOME of
 * the migrations still leaves a database the rest of the suite can mostly use —
 * the missing table is simply one no other test in the run happens to touch.
 * The census below reads the committed migration FOLDER NAMES off disk and
 * requires each to be recorded as applied, so the expected set grows by itself
 * with every migration added. A hand-written list would pass forever while the
 * sixth migration quietly never ran.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { closeTestPrisma, testPrisma } from './harness.js';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

/** The committed migrations, read off disk — never enumerated by hand. */
function committedMigrations(): string[] {
  return readdirSync(path.join(repoRoot, 'prisma/migrations'), { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

interface MigrationRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  applied_steps_count: number;
}

afterAll(async () => {
  await closeTestPrisma();
});

describe('T-MIG-002 · the M0 smoke migration (RSK-031)', () => {
  it('T-MIG-002a: SELECT 1 round-trips over the application connection', async () => {
    // The authentication half. A connection string that cannot authenticate,
    // or an `encrypt`/`trustServerCertificate` pair the driver rejects, fails
    // here with a connection error rather than 200 assertion failures spread
    // across the suite that each read as an application bug.
    const rows = await testPrisma().$queryRaw<Array<{ one: number }>>`SELECT 1 AS one`;
    expect(rows).toEqual([{ one: 1 }]);
  });

  it('T-MIG-002b: every committed migration is recorded as applied, none rolled back', async () => {
    const expected = committedMigrations();
    expect(expected.length, 'no migrations on disk — the census would be vacuous').toBeGreaterThan(
      0,
    );

    const rows = await testPrisma().$queryRaw<MigrationRow[]>`
      SELECT [migration_name], [finished_at], [rolled_back_at], [applied_steps_count]
      FROM [_prisma_migrations]
    `;

    const applied = rows
      .filter((r) => r.finished_at !== null && r.rolled_back_at === null)
      .map((r) => r.migration_name)
      .sort();

    expect(applied).toEqual(expected);
    // A migration recorded with zero applied steps ran as a no-op — the row
    // exists, so a presence-only check passes, and the tables do not.
    for (const row of rows) {
      expect(row.applied_steps_count, `${row.migration_name} applied no steps`).toBeGreaterThan(0);
    }
  });

  it('T-MIG-002c: the migrated schema really carries the domain tables', async () => {
    // `migrate deploy` reporting success is not the same as the schema being
    // there: a `migration_lock.toml` for the wrong provider, or a baseline
    // marked applied by hand, both produce a clean deploy over an empty
    // database. Read the actual catalogue.
    const rows = await testPrisma().$queryRaw<Array<{ name: string }>>`
      SELECT [TABLE_NAME] AS [name]
      FROM [INFORMATION_SCHEMA].[TABLES]
      WHERE [TABLE_TYPE] = 'BASE TABLE'
    `;
    const tables = new Set(rows.map((r) => r.name.toLowerCase()));

    for (const required of ['title', 'service_listing', 'upload_batch', 'extraction_candidate']) {
      expect(tables.has(required), `table ${required} is missing from the migrated schema`).toBe(
        true,
      );
    }
  });

  it('T-MIG-002d: the migrations target sqlserver, not a superseded provider', async () => {
    // ADR-0005 Rev 3. The datastore moved Cosmos → PostgreSQL → Azure SQL and
    // superseded spec sections still name PostgreSQL; a `migration_lock.toml`
    // left on `postgresql` makes `migrate deploy` refuse against this server
    // with an error about the provider rather than about the schema.
    const { readFileSync } = await import('node:fs');
    const lock = readFileSync(path.join(repoRoot, 'prisma/migrations/migration_lock.toml'), 'utf8');
    expect(lock).toContain('sqlserver');
    expect(lock).not.toContain('postgresql');
  });
});
