import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DESTRUCTIVE_PATTERNS,
  checkMigrations,
  formatViolations,
  scanSql,
} from '../../tools/check-migrations.js';

// T-MIG-001 — the destructive-migration gate (TASK-144, specs/testing.md §11.2
// and §11-R4.2).
//
// Observing that the current tree is clean proves almost nothing: before
// TASK-017 there are no migrations at all, so a gate that does nothing would
// pass exactly as loudly. Every case below therefore feeds the checker a
// deliberate violation and asserts it is CAUGHT.

describe('T-MIG-001 destructive migration gate', () => {
  it('T-MIG-001a: the committed migrations contain no destructive statement', () => {
    const violations = checkMigrations();
    expect(violations, formatViolations(violations)).toEqual([]);
  });

  const expansionPath = 'prisma/migrations/0012_expand_services/migration.sql';
  const expansionSql = readFileSync(
    fileURLToPath(new URL(`../../${expansionPath}`, import.meta.url)),
    'utf8',
  ).replace(/\r\n/g, '\n');
  const services = [
    'netflix',
    'max',
    'prime-video',
    'disney-plus',
    'apple-tv-plus',
    'paramount-plus',
    'starz',
    'peacock',
  ];
  const serviceChecks = [
    ['upload_batch', 'ck_batch_service'],
    ['service_listing', 'ck_listing_service'],
    ['service_state', 'ck_state_service'],
  ] as const;

  describe('T-SVC-003 owner-authorized service CHECK replacement', () => {
    it('T-SVC-003a: authorizes only the complete approved migration at its exact path', () => {
      expect(scanSql(expansionPath, expansionSql)).toEqual([]);
      expect(scanSql(expansionPath.replace(/\//g, '\\'), expansionSql)).toEqual([]);
      expect(scanSql(expansionPath, expansionSql.replace(/\n/g, '\r\n'))).toEqual([]);

      for (const moved of [
        'prisma/migrations/0013_expand_services/migration.sql',
        'prisma/migrations/0012_expand_services/copy.sql',
        `copy/${expansionPath}`,
        `./${expansionPath}`,
        expansionPath.toUpperCase(),
        expansionPath.replace('0012_expand_services', 'other/../0012_expand_services'),
      ]) {
        expect(
          scanSql(moved, expansionSql).map((v) => v.statement),
          moved,
        ).toEqual(['DROP CONSTRAINT', 'DROP CONSTRAINT', 'DROP CONSTRAINT']);
      }
    });

    it('T-SVC-003b: installs exactly eight trusted values before any original CHECK is removed', () => {
      const firstDrop = expansionSql.indexOf('  ALTER TABLE [dbo].[upload_batch] DROP');
      for (const [table, constraint] of serviceChecks) {
        const add = `ALTER TABLE [dbo].[${table}] WITH CHECK ADD CONSTRAINT [${constraint}_expanded]`;
        const start = expansionSql.indexOf(add);
        expect(start).toBeGreaterThan(expansionSql.indexOf('BEGIN TRANSACTION;'));
        expect(start).toBeLessThan(firstDrop);
        const check = expansionSql.slice(start, expansionSql.indexOf(';', start));
        expect([...check.matchAll(/'([^']*)'/g)].map((match) => match[1])).toEqual(services);
        expect(expansionSql).toContain(
          `EXEC sp_rename N'dbo.${constraint}_expanded', N'${constraint}', N'OBJECT';`,
        );
      }
      expect(expansionSql.match(/WITH CHECK ADD CONSTRAINT/g)).toHaveLength(3);
      expect(expansionSql.match(/DROP CONSTRAINT/g)).toHaveLength(3);
      expect(expansionSql).toContain('SET XACT_ABORT ON;');
      expect(expansionSql).toContain('COMMIT TRANSACTION;\nEND TRY\nBEGIN CATCH');
      expect(expansionSql).toContain('IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;\n  THROW;');
      expect(expansionSql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i);
      expect(expansionSql).not.toMatch(/\bALTER\s+COLUMN\b/i);
      expect(services.every((service) => service.length <= 16)).toBe(true);
    });

    it('T-SVC-003c: rejects missing safety, replacement, name, value, and transaction mutations', () => {
      const mutations: Array<readonly [string, string]> = [
        ['empty file', ''],
        ['no replacements', 'SELECT 1;'],
        ['no XACT_ABORT', expansionSql.replace('SET XACT_ABORT ON;', '')],
        ['no transaction', expansionSql.replace('BEGIN TRANSACTION;', '')],
        ['early commit', expansionSql.replace('BEGIN TRANSACTION;', 'BEGIN TRANSACTION; COMMIT;')],
        ['no commit', expansionSql.replace('COMMIT TRANSACTION;', '')],
        ['no rollback', expansionSql.replace('ROLLBACK TRANSACTION;', '')],
        ['no rethrow', expansionSql.replace('THROW;', '')],
        ['untrusted replacement', expansionSql.replace('WITH CHECK', 'WITH NOCHECK')],
        [
          'weakened predicate',
          expansionSql.replace("IN ('netflix'", "IS NULL OR 1 = 1 OR [service] IN ('netflix'"),
        ],
        ['wrong table', expansionSql.replace('[dbo].[service_state]', '[dbo].[title]')],
        ['wrong constraint', expansionSql.replace('[ck_state_service];', '[ck_state_other];')],
        ['column rename', expansionSql.replace("N'OBJECT'", "N'COLUMN'")],
        [
          'no rename',
          expansionSql.replace(
            "EXEC sp_rename N'dbo.ck_state_service_expanded', N'ck_state_service', N'OBJECT';",
            '',
          ),
        ],
        [
          'drop before replacement',
          expansionSql.replace(
            '  BEGIN TRANSACTION;',
            '  BEGIN TRANSACTION;\n  ALTER TABLE [dbo].[upload_batch] DROP CONSTRAINT [ck_batch_service];',
          ),
        ],
        ['comment injection', expansionSql.replace("N'OBJECT';", "N'OBJECT'; -- added SQL")],
        ['literal comment delimiter', expansionSql.replace("'peacock'", "'peacock--'")],
        ['whitespace inside token', expansionSql.replace("'prime-video'", "'prime-video '")],
        ['unsupported token', expansionSql.replace("'peacock'", "'hulu'")],
        ['extra token', expansionSql.replace("'peacock'", "'peacock','hulu'")],
        [
          'no discovery NULL',
          expansionSql.replace(
            'CHECK ([service] IN',
            'CHECK ([service] IS NOT NULL AND [service] IN',
          ),
        ],
        ['no restrictive drops', expansionSql.replace(/^.*DROP CONSTRAINT.*\n/gm, '')],
      ];
      for (const service of services) {
        mutations.push([
          `missing ${service}`,
          expansionSql.replace(`'${service}'`, "'unsupported'"),
        ]);
      }
      for (const [table, constraint] of serviceChecks) {
        const start = expansionSql.indexOf(`  ALTER TABLE [dbo].[${table}] WITH CHECK`);
        const end = expansionSql.indexOf(';', start) + 1;
        mutations.push([
          `missing ${constraint} replacement`,
          expansionSql.slice(0, start) + expansionSql.slice(end),
        ]);
      }
      for (const [label, sql] of mutations) {
        expect(sql, label).not.toBe(expansionSql);
        expect(
          scanSql(expansionPath, sql).map((v) => v.statement),
          label,
        ).toContain('Unapproved service expansion SQL');
      }
    });

    it('T-SVC-003d: refuses appended SQL including statements outside the destructive patterns', () => {
      for (const extra of [
        'DROP TABLE dbo.title;',
        'ALTER TABLE dbo.title DROP COLUMN state;',
        'DROP INDEX listing_one_per_service ON dbo.service_listing;',
        'TRUNCATE TABLE dbo.title;',
        'ALTER TABLE dbo.title DROP CONSTRAINT ck_title_state;',
        'ALTER TABLE dbo.upload_batch DROP CONSTRAINT ck_batch_source_exclusive;',
        "EXEC sp_rename 'dbo.title.state', 'lost', 'COLUMN';",
        'DELETE FROM dbo.title;',
        "UPDATE dbo.service_state SET service = 'netflix';",
        'ALTER TABLE dbo.service_listing NOCHECK CONSTRAINT ALL;',
        'SELECT 1;',
        '-- generic allow marker',
        'GO',
      ]) {
        expect(
          scanSql(expansionPath, `${expansionSql}\n${extra}`).map((v) => v.statement),
          extra,
        ).toContain('Unapproved service expansion SQL');
      }
    });

    it('T-SVC-003e: keeps every destructive pattern active outside the immutable exception', () => {
      const mutations = [
        ['DROP TABLE dbo.title;', 'DROP TABLE'],
        ['ALTER TABLE dbo.title DROP COLUMN state;', 'ALTER TABLE ... DROP COLUMN'],
        ['TRUNCATE TABLE dbo.title;', 'TRUNCATE TABLE'],
        ['DROP INDEX listing_one_per_service ON dbo.service_listing;', 'DROP INDEX'],
        [
          'ALTER TABLE dbo.title DROP\n/* no bypass */CONSTRAINT ck_title_state;',
          'DROP CONSTRAINT',
        ],
        ["EXEC sp_rename\n'dbo.title.state', 'lost',\n'COLUMN';", "sp_rename ... 'COLUMN'"],
        ['GO', 'GO batch separator'],
      ] as const;
      for (const [sql, statement] of mutations) {
        expect(scanSql('other/migration.sql', sql).map((v) => v.statement)).toContain(statement);
        expect(scanSql(expansionPath, `${expansionSql}\n${sql}`).map((v) => v.statement)).toContain(
          statement,
        );
      }
      expect(
        scanSql(
          'other/migration.sql',
          '-- allow-service-expansion\nALTER TABLE dbo.title DROP CONSTRAINT ck_title_state;',
        ),
      ).toHaveLength(1);
    });
  });

  it('T-MIG-001b: catches DROP TABLE', () => {
    const found = scanSql('m/migration.sql', 'DROP TABLE [dbo].[title];');
    expect(found.map((v) => v.statement)).toEqual(['DROP TABLE']);
  });

  it('T-MIG-001c: catches ALTER TABLE ... DROP COLUMN — the Prisma rename trap', () => {
    // This is the shape Prisma generates for a renamed field. It reads like a
    // rename in the schema diff and behaves like a deletion in production.
    const sql = [
      'ALTER TABLE [dbo].[title] ADD [workIdentity] NVARCHAR(400);',
      'ALTER TABLE [dbo].[title] DROP COLUMN [work_identity];',
    ].join('\n');
    const found = scanSql('m/migration.sql', sql);
    expect(found).toHaveLength(1);
    expect(found[0]?.statement).toBe('ALTER TABLE ... DROP COLUMN');
    expect(found[0]?.line).toBe(2);
  });

  it('T-MIG-001d: catches TRUNCATE TABLE', () => {
    const found = scanSql('m/migration.sql', 'TRUNCATE TABLE dbo.service_listing;');
    expect(found.map((v) => v.statement)).toEqual(['TRUNCATE TABLE']);
  });

  it('T-MIG-001e: catches DROP INDEX — the filtered unique indexes ARE the invariants', () => {
    const found = scanSql('m/migration.sql', 'DROP INDEX [I-9] ON [dbo].[suppression];');
    expect(found.map((v) => v.statement)).toEqual(['DROP INDEX']);
  });

  it('T-MIG-001f: catches DROP CONSTRAINT', () => {
    const found = scanSql(
      'm/migration.sql',
      'ALTER TABLE [dbo].[title] DROP CONSTRAINT [CK_title_status];',
    );
    expect(found.map((v) => v.statement)).toEqual(['DROP CONSTRAINT']);
  });

  it('T-MIG-001g: catches an sp_rename column rename', () => {
    const found = scanSql(
      'm/migration.sql',
      "EXEC sp_rename '[dbo].[title].[work_identity]', 'workIdentity', 'COLUMN';",
    );
    expect(found.map((v) => v.statement)).toEqual(["sp_rename ... 'COLUMN'"]);
  });

  it('T-MIG-001h: is case- and whitespace-insensitive', () => {
    const found = scanSql('m/migration.sql', 'drop    table   [dbo].[title];');
    expect(found).toHaveLength(1);
  });

  it('T-MIG-001i: does not fire on a destructive statement inside a comment', () => {
    const sql = [
      '-- We deliberately do NOT drop table [dbo].[title] here (REQ-028).',
      '/* DROP COLUMN [work_identity] was considered and rejected. */',
      'ALTER TABLE [dbo].[title] ADD [suppressed] BIT NOT NULL DEFAULT 0;',
    ].join('\n');
    expect(scanSql('m/migration.sql', sql)).toEqual([]);
  });

  it('T-MIG-001j: still reports the correct line number after a block comment', () => {
    // Comments are blanked, not removed, precisely so the reported line points
    // at the real statement.
    const sql = ['/* a', 'multi-line', 'comment */', 'DROP TABLE [dbo].[title];'].join('\n');
    const found = scanSql('m/migration.sql', sql);
    expect(found[0]?.line).toBe(4);
  });

  it('T-MIG-001m: catches a GO batch separator, which breaks the deploy rather than the data', () => {
    const sql = ['ALTER TABLE [t] ADD [c] BIGINT NULL;', 'GO', 'UPDATE [t] SET [c] = 1;'].join(
      '\n',
    );
    const found = scanSql('m/migration.sql', sql);
    expect(found.map((v) => v.statement)).toContain('GO batch separator');
    expect(found[0]?.line).toBe(2);
  });

  it('T-MIG-001n: does NOT fire on the letters GO inside an identifier or a word', () => {
    // A gate that flagged `ALTER TABLE [go_live]` would be turned off within a
    // week. The separator is a line that is ONLY `GO`.
    const sql = [
      "EXEC('UPDATE [t] SET [category] = ''GOTHIC'' WHERE [go_live] IS NOT NULL;');",
      'ALTER TABLE [logo] ADD [ago] INT NULL;',
    ].join('\n');
    expect(scanSql('m/migration.sql', sql)).toEqual([]);
  });

  it('T-MIG-001k: an additive migration passes', () => {
    const sql = [
      'CREATE TABLE [dbo].[suppression] (',
      '  [id] NVARCHAR(30) NOT NULL,',
      '  [owner_id] NVARCHAR(30) NOT NULL,',
      '  CONSTRAINT [PK_suppression] PRIMARY KEY ([id])',
      ');',
      'CREATE UNIQUE INDEX [I-9] ON [dbo].[suppression] ([owner_id], [work_identity])',
      '  WHERE [revoked_at] IS NULL;',
    ].join('\n');
    expect(scanSql('m/migration.sql', sql)).toEqual([]);
  });

  it('T-MIG-001l: every documented pattern carries a reason the failure message can print', () => {
    // The message is the whole value of the gate at 2 a.m. — a bare "failed"
    // invites someone to delete the test instead of the migration.
    for (const p of DESTRUCTIVE_PATTERNS) {
      expect(p.why.length).toBeGreaterThan(20);
    }
    const message = formatViolations(scanSql('m/migration.sql', 'DROP TABLE [dbo].[title];'));
    expect(message).toContain('REQ-028');
    expect(message).toContain('m/migration.sql:1');
    expect(message).toContain('do not work around it');
  });
});
