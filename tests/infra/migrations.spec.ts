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
